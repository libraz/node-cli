import {
  describeReceived,
  InvalidOptionError,
  ParseError,
  UnknownOptionError,
  usageError,
} from "../errors.js";
import type { ArgDef, CommandDefinition, OptionDef, ParseResult } from "../types.js";
import type { CommandRegistry } from "./registry.js";

/**
 * Strips the leading dashes from an option flag (`--name` → `name`, `-n` → `n`).
 * The single source of truth for prefix normalization so the builder, parser,
 * and completion cannot drift.
 *
 * @param flag - The flag token, with or without leading dashes.
 * @returns The flag name without any leading dashes.
 */
export function stripOptionPrefix(flag: string): string {
  return flag.replace(/^-+/, "");
}

/**
 * The one rule option names (long, short and long aliases) and positional
 * argument names follow: ASCII letters and digits in parts joined by single dashes.
 */
export const NAME_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

/**
 * Converts an option or argument name to its `ctx.options` / `ctx.args` key:
 * split at `-`, keep the first part, and capitalize the first letter of each
 * later part (`dry-run` → `dryRun`, `x-1` → `x1`, `Foo` → `Foo`).
 *
 * @param name - A name matching {@link NAME_PATTERN}.
 * @returns The camelCase key.
 */
export function toCamelKey(name: string): string {
  return name.replace(/-([A-Za-z0-9])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Formats an option alias the way the parser accepts it: one dash for a
 * single-character alias, two for a longer one.
 *
 * @param alias - The alias without leading dashes.
 * @returns The alias spelled as a flag.
 */
export function formatOptionFlag(alias: string): string {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
}

/**
 * Resolves a flag name (long name or alias) to its option definition. The one
 * lookup the parser, help and completion share, so they cannot disagree.
 *
 * @param name - The flag name without leading dashes.
 * @param options - The command's option definitions.
 * @param aliasMap - Optional prebuilt alias map for `options`.
 * @returns The matching definition, or `undefined` when no option owns the name.
 */
export function resolveOptionName(
  name: string,
  options: Map<string, OptionDef>,
  aliasMap?: Map<string, string>,
): OptionDef | undefined {
  const direct = options.get(name);
  if (direct) return direct;
  const long = (aliasMap ?? buildAliasMap(options)).get(name);
  return long === undefined ? undefined : options.get(long);
}

/**
 * Builds an alias → canonical-long-name map for a command's options. Shared by
 * the parser and completion so both resolve aliases identically.
 *
 * @param options - The command's option definitions.
 * @returns A map from each alias to its option's long name.
 */
export function buildAliasMap(options: Map<string, OptionDef>): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const [, def] of options) {
    for (const alias of def.aliases) {
      aliasMap.set(alias, def.long);
    }
  }
  return aliasMap;
}

/**
 * Decides whether a flag name is a `--no-<name>` negation. The single place the
 * negation spelling is defined, so the parser, help and completion agree.
 * A name that an option owns literally (long name or alias) is not a negation.
 *
 * @param name - The flag name without leading dashes (e.g. `no-color`).
 * @param options - The command's option definitions.
 * @param aliasMap - Optional prebuilt alias map for `options`.
 * @returns `undefined` when `name` is not a negation; otherwise the typed target
 *   name and the option it resolves to (`undefined` when no such option exists).
 */
export function resolveNegation(
  name: string,
  options: Map<string, OptionDef>,
  aliasMap?: Map<string, string>,
): { typed: string; def: OptionDef | undefined } | undefined {
  const map = aliasMap ?? buildAliasMap(options);
  if (!name.startsWith("no-") || resolveOptionName(name, options, map)) return undefined;
  const typed = name.slice(3);
  return { typed, def: resolveOptionName(typed, options, map) };
}

/**
 * Returns the `--no-<long>` flag help and completion may advertise for an option,
 * or `undefined` when parsing that spelling would not set the option to false.
 *
 * @param def - The option definition.
 * @param options - The command's option definitions.
 * @returns The negated flag, or `undefined`.
 */
export function negatedFlag(def: OptionDef, options: Map<string, OptionDef>): string | undefined {
  if (def.schema.type !== "boolean") return undefined;
  const name = `no-${def.long}`;
  return resolveNegation(name, options)?.def === def ? `--${name}` : undefined;
}

/**
 * Reports whether a command's own options bind the built-in help flags. The
 * parser only falls back to built-in help for `--help` / `-h` when the long name
 * `help` / short alias `h` are unbound, so the help generator and completion
 * consult this to advertise exactly the forms that actually trigger help.
 *
 * @param options - The command's option definitions.
 * @returns Flags indicating whether `--help` (long) and `-h` (short) are bound.
 */
export function helpFlagBindings(options: Map<string, OptionDef>): {
  long: boolean;
  short: boolean;
} {
  const aliasMap = buildAliasMap(options);
  return {
    long: resolveOptionName("help", options, aliasMap) !== undefined,
    short: resolveOptionName("h", options, aliasMap) !== undefined,
  };
}

/** One word of an input line as the tokenizer sees it. */
export interface ScannedWord {
  /** The word with quotes and escapes resolved. */
  value: string;
  /** The word exactly as typed, quotes and escapes included. */
  raw: string;
  /** Index of the word's first character in the input. */
  start: number;
}

/** Result of {@link scanWords}. */
export interface WordScan {
  /** Every word, including the one still being typed. */
  words: ScannedWord[];
  /** The quote left open at the end of the input, if any. */
  openQuote?: "single" | "double";
  /** True when the input ends between words, so the next character starts a new one. */
  atBoundary: boolean;
}

/**
 * The single quote- and escape-aware word scan. Whitespace splits words only
 * outside quotes and when not backslash-escaped; single quotes are literal and
 * double quotes honour `\"`, `\\`, `\$`, `` \` `` and `\<newline>`. Both
 * {@link tokenize} and tab-completion derive word boundaries from it.
 *
 * @param input - The raw input string.
 * @returns The words, any open quote, and whether the input ends at a word boundary.
 */
export function scanWords(input: string): WordScan {
  const words: ScannedWord[] = [];
  let value = "";
  let start = -1;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const flush = (end: number) => {
    if (start >= 0) words.push({ value, raw: input.slice(start, end), start });
    value = "";
    start = -1;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      value += ch;
      escaped = false;
      continue;
    }

    if (start < 0 && (inSingle || inDouble || !/\s/.test(ch))) start = i;

    if (ch === "\\") {
      if (inSingle) {
        // Single quotes are fully literal: a backslash inside them is ordinary.
        value += ch;
      } else if (inDouble) {
        const next = input[i + 1];
        if (next !== undefined && ['"', "\\", "$", "`", "\n"].includes(next)) {
          escaped = true;
        } else {
          value += ch;
        }
      } else {
        escaped = true;
      }
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      flush(i);
      continue;
    }

    value += ch;
  }

  if (escaped) value += "\\";
  const openQuote = inSingle ? "single" : inDouble ? "double" : undefined;
  const atBoundary = start < 0;
  flush(input.length);
  return { words, openQuote, atBoundary };
}

/**
 * Rejects a standalone, unquoted `<` or `>` word before the `--` separator in
 * string input. Argv input never goes through here: its elements are literal.
 *
 * @param input - The raw input string.
 * @throws {ParseError} When a redirection operator is present.
 */
function assertNoRedirection(input: string): void {
  for (const { raw } of scanWords(input).words) {
    if (raw === "--") return;
    if (raw === "<" || raw === ">") {
      throw new ParseError(`Redirection operator "${raw}" is not supported`);
    }
  }
}

/**
 * Splits a pipeline string into segments at top-level `|` characters, keeping
 * quotes and escapes verbatim so each segment can be tokenized again later.
 *
 * @param input - The raw input string.
 * @returns The trimmed, non-empty segments.
 */
function splitAtPipes(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  const flush = () => {
    const seg = current.trim();
    if (seg.length > 0) segments.push(seg);
    current = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    // A backslash escapes only outside single quotes; single quotes are literal.
    if (ch === "\\" && !inSingle) {
      current += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "|" && !inSingle && !inDouble) {
      flush();
      continue;
    }
    current += ch;
  }

  if (inSingle || inDouble) {
    const quote = inSingle ? "single" : "double";
    throw new ParseError(`Unclosed ${quote} quote in input`, { quote });
  }

  flush();
  return segments;
}

/**
 * Splits one command, without a pipeline, into argv tokens: single quotes,
 * double quotes and backslash escapes, delimited by unquoted whitespace. A `|`
 * is an ordinary character here, while `CLI.execLine()` splits a line at an
 * unquoted `|` first, so `exec(tokenize(line))` differs from `execLine(line)`
 * when the line contains one.
 *
 * @param input - The raw input string to tokenize.
 * @returns The tokens.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `input` is not a string.
 * @throws {ParseError} `PARSE_FAILED` for an unclosed quote.
 * @example
 * ```ts
 * tokenize(`deploy "my app" --force`); // ["deploy", "my app", "--force"]
 * ```
 */
export function tokenize(input: string): readonly string[] {
  if (typeof input !== "string") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "input" argument of tokenize() must be a string. Received ${describeReceived(input)}`,
    );
  }
  const { words, openQuote } = scanWords(input);
  if (openQuote) {
    throw new ParseError(`Unclosed ${openQuote} quote in input`, { quote: openQuote });
  }
  return words.map((word) => word.value);
}

/**
 * Parses a command definition string into its constituent parts.
 *
 * A definition string has the form `"parent sub command <required> [optional] [...variadic]"`.
 * Non-bracketed tokens are treated as the command path; bracketed tokens become argument definitions.
 *
 * @param definition - The command definition string to parse.
 * @returns An object containing the parent command path, the command name, and argument definitions.
 */
export function parseDefinitionString(definition: string): {
  parentPath: string[];
  name: string;
  argDefs: ArgDef[];
} {
  const tokens = definition.trim().split(/\s+/).filter(Boolean);
  const names: string[] = [];
  const argDefs: ArgDef[] = [];

  let seenArg = false;
  for (const token of tokens) {
    if (token.startsWith("<") || token.startsWith("[")) {
      argDefs.push(parseArgToken(token));
      seenArg = true;
    } else {
      // Once an argument token has appeared, a later bare name is not a command
      // name but a silent ambiguity (it would become an unreachable subcommand).
      // Reject it so the mistake surfaces at definition time.
      if (seenArg) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Invalid command definition: command name "${token}" cannot follow an argument in "${definition}"`,
        );
      }
      if (!NAME_PATTERN.test(token)) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Invalid command definition: command name ${JSON.stringify(token)} must be letters and digits joined by single dashes`,
        );
      }
      names.push(token);
    }
  }

  const name = names.pop();
  if (!name) {
    throw usageError(
      "state",
      "ERR_INVALID_DEFINITION",
      `Invalid command definition: missing command name in "${definition}"`,
    );
  }

  const argumentKeys = new Set<string>();
  let seenOptional = false;
  for (const arg of argDefs) {
    if (argumentKeys.has(toCamelKey(arg.name))) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Invalid command definition: duplicate argument name "${arg.name}" in "${definition}"`,
      );
    }
    argumentKeys.add(toCamelKey(arg.name));
    if (!arg.required) seenOptional = true;
    if (arg.required && seenOptional) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Invalid command definition: required argument "${arg.name}" cannot follow an optional argument in "${definition}"`,
      );
    }
  }

  // A variadic argument must be the last argument; nothing after it is reachable.
  for (let i = 0; i < argDefs.length - 1; i++) {
    if (argDefs[i].variadic) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Invalid command definition: variadic argument "...${argDefs[i].name}" must be last in "${definition}"`,
      );
    }
  }

  return { parentPath: names, name, argDefs };
}

/**
 * Parses a single argument token (e.g., `<name>`, `[name]`, `<...files>`) into an ArgDef.
 *
 * @param token - The bracketed argument token string.
 * @returns The parsed argument definition.
 */
function parseArgToken(token: string): ArgDef {
  const required = token.startsWith("<");
  const closer = required ? ">" : "]";
  if (!token.endsWith(closer)) {
    throw usageError(
      "state",
      "ERR_INVALID_DEFINITION",
      `Invalid command definition: argument token "${token}" is missing its closing "${closer}"`,
    );
  }
  const inner = token.slice(1, -1); // remove < > or [ ]
  const variadic = inner.startsWith("...");
  const name = variadic ? inner.slice(3) : inner;
  if (name.length === 0) {
    throw usageError(
      "state",
      "ERR_INVALID_DEFINITION",
      `Invalid command definition: empty argument name in "${token}"`,
    );
  }
  if (!NAME_PATTERN.test(name)) {
    throw usageError(
      "state",
      "ERR_INVALID_DEFINITION",
      `Invalid command definition: argument name "${name}" must be letters and digits joined by single dashes`,
    );
  }

  return { name, required, variadic };
}

/**
 * Parses an option flags string into its long name, short aliases, and whether it accepts a value.
 *
 * Supports formats like `"-p, --port <number>"` or `"--verbose"`. The first
 * long flag is the canonical name and later ones are long aliases; without a
 * long flag the first short flag is the canonical name.
 *
 * @param flags - A comma-separated string of option flags.
 * @returns An object with the long option name, an array of short aliases, and a boolean indicating whether the option takes a value.
 */
export function parseOptionFlags(flags: string): {
  long: string;
  aliases: string[];
  longAliases: string[];
  takesValue: boolean;
  valueName?: string;
} {
  const parts: string[] = [];
  let part = "";
  let placeholderDepth = 0;
  for (const ch of flags) {
    if (ch === "<" || ch === "[") placeholderDepth++;
    if (ch === ">" || ch === "]") placeholderDepth = Math.max(0, placeholderDepth - 1);
    if (ch === "," && placeholderDepth === 0) {
      parts.push(part.trim());
      part = "";
    } else {
      part += ch;
    }
  }
  parts.push(part.trim());
  let long = "";
  const aliases: string[] = [];
  const longAliases: string[] = [];
  let takesValue = false;
  let valueName: string | undefined;

  for (let part of parts) {
    // Check for value placeholder
    const valueMatch = part.match(/\s+(?:<([^>\s]+)>|\[([^\]\s]+)\])$/);
    if (valueMatch) {
      takesValue = true;
      valueName = valueMatch[1] ?? valueMatch[2];
      part = part.slice(0, -valueMatch[0].length);
    }

    if (part.startsWith("--")) {
      const name = part.slice(2);
      if (long) longAliases.push(name);
      else long = name;
    } else if (part.startsWith("-")) {
      aliases.push(part.slice(1));
    }
  }

  if (!long && aliases.length > 0) {
    long = aliases[0];
  }

  return { long, aliases, longAliases, takesValue, valueName };
}

/**
 * Parses raw CLI input into a structured {@link ParseResult}.
 *
 * Resolves the command path from the registry, separates options from
 * positional arguments, and maps positional arguments to their definitions.
 *
 * @param input - The raw input string or pre-tokenized array.
 * @param registry - The command registry used to resolve command paths.
 * @param options.usage - Usage line of the matched command, carried by every
 *   option error raised while scanning its tokens.
 * @returns The fully parsed result including command path, arguments, and options.
 */
export function parse(
  input: string | readonly string[],
  registry: CommandRegistry,
  options: { usage?: string } = {},
): ParseResult {
  if (typeof input === "string") assertNoRedirection(input);
  const rawInput = typeof input === "string" ? input : input.join(" ");
  const tokens = typeof input === "string" ? [...tokenize(input)] : [...input];
  const rawArgv = typeof input === "string" ? null : [...input];

  if (tokens.length === 0) {
    return {
      commandPath: [],
      args: Object.create(null),
      options: Object.create(null),
      rawInput,
      rawArgv,
    };
  }

  // Resolve command path
  const match = registry.matchCommandPath(tokens);
  if (!match) {
    return {
      commandPath: [],
      args: Object.create(null),
      options: Object.create(null),
      rawInput,
      rawArgv,
    };
  }

  const { command, consumed } = match;
  const commandPath = tokens.slice(0, consumed);
  const remaining = tokens.slice(consumed);

  // Separate options and positional args
  const {
    positional,
    options: parsedOptions,
    builtInHelp,
  } = extractOptionsAndArgs(remaining, command, options.usage);

  // Map positional args
  const { args, extraArgs } = mapPositionalArgs(positional, command.argDefs);

  return {
    commandPath,
    args,
    options: parsedOptions,
    extraArgs,
    rawInput,
    rawArgv,
    command,
    builtInHelp,
  };
}

/**
 * Separates an array of tokens into positional arguments and parsed options.
 *
 * Handles long options (`--name`), short options (`-n`), negated booleans (`--no-verbose`),
 * combined short flags (`-abc`), `=` value syntax, and the `--` separator.
 *
 * @param tokens - The remaining tokens after the command path has been consumed.
 * @param command - The matched command definition containing option metadata.
 * @param usage - Usage line of the command, carried by any option error raised.
 * @returns An object with the positional argument values and a record of parsed options.
 */
function extractOptionsAndArgs(
  tokens: string[],
  command: CommandDefinition,
  usage: string | undefined,
): { positional: string[]; options: Record<string, unknown>; builtInHelp: boolean } {
  const positional: string[] = [];
  const options: Record<string, unknown> = Object.create(null);
  // An unbound --help / -h anywhere before `--` wins over every other parse error;
  // whatever was collected before the error is kept.
  const builtInHelp = hasBuiltInHelpToken(tokens, command.options, buildAliasMap(command.options));
  try {
    scanTokens(tokens, command, positional, options, usage);
  } catch (error) {
    if (!builtInHelp) throw error;
  }
  if (builtInHelp) options.help = true;
  return { positional, options, builtInHelp };
}

/** Walks the tokens, filling `positional` and `options` and throwing on the first error. */
function scanTokens(
  tokens: string[],
  command: CommandDefinition,
  positional: string[],
  options: Record<string, unknown>,
  usage: string | undefined,
): void {
  let pastDoubleDash = false;
  const optionDefs = command.options;
  const aliasMap = buildAliasMap(optionDefs);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (pastDoubleDash) {
      positional.push(token);
      i++;
      continue;
    }

    if (token === "--") {
      pastDoubleDash = true;
      i++;
      continue;
    }

    // Negated boolean (--no-x), unless an option is literally named "no-x".
    const negatedEqIndex = token.indexOf("=");
    const flagName = token.slice(2, negatedEqIndex === -1 ? undefined : negatedEqIndex);
    const negation = token.startsWith("--")
      ? resolveNegation(flagName, optionDefs, aliasMap)
      : undefined;
    if (negation) {
      const spelling = `--${flagName}`;
      const def = negation.def;
      if (!def) {
        throw new UnknownOptionError(spelling, { usage });
      }
      if (def.schema.type !== "boolean") {
        throw new InvalidOptionError(`Option ${spelling} can only be used with boolean options`, {
          optionName: def.long,
          usage,
        });
      }
      if (negatedEqIndex !== -1) {
        throw new InvalidOptionError(`Option ${spelling} does not accept a value`, {
          optionName: def.long,
          usage,
          value: token.slice(negatedEqIndex + 1),
        });
      }
      options[toCamelKey(def.long)] = false;
      i++;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const typed = token.slice(2, eqIndex);
        const def = resolveOptionName(typed, optionDefs, aliasMap);
        if (!def) {
          throw new UnknownOptionError(`--${typed}`, { usage });
        }
        appendOption(options, toCamelKey(def.long), token.slice(eqIndex + 1), def);
        i++;
        continue;
      }

      const typed = token.slice(2);
      const def = resolveOptionName(typed, optionDefs, aliasMap);
      if (!def) {
        // Help itself is raised by the caller's pre-scan; just skip the token.
        if (typed === "help") {
          i++;
          continue;
        }
        throw new UnknownOptionError(`--${typed}`, { usage });
      }
      const name = def.long;
      const isBool = def.schema.type === "boolean";

      if (isBool) {
        options[toCamelKey(name)] = true;
        i++;
      } else {
        const nextToken = tokens[i + 1];
        if (nextToken !== undefined && !looksLikeOption(nextToken, def)) {
          appendOption(options, toCamelKey(name), nextToken, def);
          i += 2;
        } else {
          throw new InvalidOptionError(
            `Option --${name} expects a value; use --${name}=<value> for values starting with "-"`,
            { optionName: name, usage },
          );
        }
      }
      continue;
    }

    // A bare negative number (e.g. "-5", "-3.14", "-1e3") is a positional value,
    // not an option — unless an option with that exact name/alias is defined.
    // (A negative value bound to a preceding number option is already consumed as
    // that option's value, so reaching here means it stands on its own.)
    if (
      token.startsWith("-") &&
      Number.isFinite(Number(token)) &&
      !optionDefs.has(token.slice(1)) &&
      !aliasMap.has(token.slice(1))
    ) {
      positional.push(token);
      i++;
      continue;
    }

    if (token.startsWith("-") && token.length > 1 && !token.startsWith("-", 1)) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1 && eqIndex <= 2) {
        const alias = token.slice(1, eqIndex);
        const def = resolveOptionName(alias, optionDefs, aliasMap);
        if (!def) {
          throw new UnknownOptionError(`-${alias}`, { usage });
        }
        appendOption(options, toCamelKey(def.long), token.slice(eqIndex + 1), def);
        i++;
        continue;
      }

      // A cluster written with `=value` is read as the cluster first, so `-xyz=1`
      // means what `-xyz` means.
      const chars = token.slice(1, eqIndex === -1 ? undefined : eqIndex);
      if (chars.length === 1) {
        const def = resolveOptionName(chars, optionDefs, aliasMap);
        if (!def) {
          if (chars === "h") {
            i++;
            continue;
          }
          throw new UnknownOptionError(`-${chars}`, { usage });
        }
        const name = def.long;
        const isBool = def.schema.type === "boolean";

        if (isBool) {
          options[toCamelKey(name)] = true;
          i++;
        } else {
          const nextToken = tokens[i + 1];
          if (nextToken !== undefined && !looksLikeOption(nextToken, def)) {
            appendOption(options, toCamelKey(name), nextToken, def);
            i += 2;
          } else {
            throw new InvalidOptionError(
              `Option -${chars} expects a value; use --${name}=<value> for values starting with "-"`,
              { optionName: name, usage },
            );
          }
        }
      } else {
        // Multiple short booleans: -abc → -a -b -c
        for (const ch of chars) {
          const def = resolveOptionName(ch, optionDefs, aliasMap);
          if (!def) {
            if (ch === "h") continue;
            throw new UnknownOptionError(`-${ch}`, { usage });
          }
          const name = def.long;
          if (def.schema.type !== "boolean") {
            throw new InvalidOptionError(
              `Option -${ch} expects a value and cannot be combined with other short flags`,
              { optionName: name, usage },
            );
          }
          options[toCamelKey(name)] = true;
        }
        if (eqIndex !== -1) {
          // The value attaches to the last flag of the cluster; an unbound `h`
          // has no definition, so the flag itself names it.
          const last = chars[chars.length - 1];
          throw new InvalidOptionError(`Option -${chars} does not accept a value`, {
            optionName: resolveOptionName(last, optionDefs, aliasMap)?.long ?? last,
            usage,
            value: token.slice(eqIndex + 1),
          });
        }
        i++;
      }
      continue;
    }

    positional.push(token);
    i++;
  }
}

/**
 * Reports whether a token list asks for the built-in help: an unbound `--help`,
 * or an `h` in a single-dash cluster while `-h` is unbound, before any `--`.
 */
function hasBuiltInHelpToken(
  tokens: string[],
  options: Map<string, OptionDef>,
  aliasMap: Map<string, string>,
): boolean {
  const longBound = resolveOptionName("help", options, aliasMap) !== undefined;
  const shortBound = resolveOptionName("h", options, aliasMap) !== undefined;
  for (const token of tokens) {
    if (token === "--") return false;
    if (token === "--help" && !longBound) return true;
    if (
      !shortBound &&
      token.length > 1 &&
      token.startsWith("-") &&
      !token.startsWith("--") &&
      !token.includes("=") &&
      Number.isNaN(Number(token)) &&
      token.includes("h")
    ) {
      return true;
    }
  }
  return false;
}

function looksLikeOption(token: string, currentDef: { schema: { type?: string } }): boolean {
  if (token === "--") return true;
  if (!token.startsWith("-") || token === "-") return false;
  if (currentDef.schema.type === "number" || currentDef.schema.type === "number[]") {
    return Number.isNaN(Number(token));
  }
  return true;
}

/**
 * Appends or sets a value on the options record.
 *
 * For array-typed options (`string[]` or `number[]`), values are accumulated into an array.
 * For all other types the value is set directly.
 *
 * @param options - The mutable options record to update.
 * @param name - The option's key in the record.
 * @param value - The string value to append or set.
 * @param def - Optional option definition used to determine the expected type.
 */
function appendOption(
  options: Record<string, unknown>,
  name: string,
  value: string,
  def?: { schema: { type?: string } },
): void {
  const type = def?.schema.type;
  if (type === "string[]" || type === "number[]") {
    const existing = options[name];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      options[name] = [value];
    }
  } else {
    options[name] = value;
  }
}

/**
 * Maps an array of positional argument values to their corresponding argument definitions.
 *
 * Variadic arguments consume all remaining positional values from their position onward.
 * Missing required arguments are set to `undefined` so that validation can detect them later.
 *
 * @param positional - The ordered array of positional argument strings.
 * @param argDefs - The argument definitions declared by the command.
 * @returns A record mapping argument keys to their parsed values.
 */
function mapPositionalArgs(
  positional: string[],
  argDefs: ArgDef[],
): { args: Record<string, unknown>; extraArgs: string[] } {
  const args: Record<string, unknown> = Object.create(null);

  for (let i = 0; i < argDefs.length; i++) {
    const def = argDefs[i];

    const key = toCamelKey(def.name);
    if (def.variadic) {
      args[key] = positional.slice(i);
      return { args, extraArgs: [] };
    }

    if (i < positional.length) {
      args[key] = positional[i];
    } else if (def.required) {
      // Will be caught by validation in router
      args[key] = undefined;
    }
  }

  return { args, extraArgs: positional.slice(argDefs.length) };
}

/**
 * Splits a raw input string into pipe-separated command segments.
 * Respects quoting so that pipe characters inside quotes are not split.
 *
 * @param input - The raw input string.
 * @returns An array of trimmed command strings.
 */
export function splitPipes(input: string): string[] {
  assertNoRedirection(input);
  let previousPipe = true;
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      escaped = false;
      previousPipe = false;
      continue;
    }
    // A backslash escapes only outside single quotes; single quotes are literal
    // (matching splitAtPipes), so quote state stays balanced.
    if (ch === "\\" && !inSingle) {
      escaped = true;
      previousPipe = false;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      previousPipe = false;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      previousPipe = false;
      continue;
    }
    if (ch === "|" && !inSingle && !inDouble) {
      if (previousPipe) throw new ParseError("Invalid empty pipe segment");
      previousPipe = true;
      continue;
    }
    if (!/\s/.test(ch)) previousPipe = false;
  }
  if (previousPipe && input.trim() !== "") {
    throw new ParseError("Invalid trailing pipe");
  }
  // Preserve quotes/escapes so each segment can be tokenized again downstream.
  return splitAtPipes(input);
}

/**
 * Returns the active pipeline segment of an input line: the substring after the
 * last top-level (unquoted) `|`, with leading whitespace removed but trailing
 * whitespace preserved. Used by tab-completion so it operates on the command the
 * cursor is in rather than the whole pipeline (mirroring {@link splitPipes} for
 * execution). Unlike {@link splitPipes}, a trailing empty segment is preserved
 * (e.g. `"a | "` yields `""`) so completion can offer commands after a pipe.
 *
 * @param input - The raw input line.
 * @returns The trailing pipeline segment.
 */
export function activePipeSegment(input: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let lastPipeEnd = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    // A backslash escapes only outside single quotes (single quotes are literal).
    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "|" && !inSingle && !inDouble) {
      lastPipeEnd = i + 1;
    }
  }

  return input.slice(lastPipeEnd).replace(/^\s+/, "");
}

import { InvalidOptionError, ParseError, UnknownOptionError } from "../errors.js";
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
 * Builds an alias → canonical-long-name map for a command's options. Shared by
 * the parser and completion so both resolve short aliases identically.
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
  let long = false;
  let short = false;
  for (const [, def] of options) {
    if (def.long === "help") long = true;
    if (def.aliases.includes("h")) short = true;
  }
  return { long, short };
}

/**
 * Splits an input string into segments at top-level delimiter characters,
 * respecting single quotes, double quotes, and backslash escaping. This is the
 * shared scanner behind both {@link tokenize} and {@link splitPipes}.
 *
 * @param input - The raw input string.
 * @param isDelimiter - Returns true for characters that separate segments at top level.
 * @param preserveSyntax - When false, quote and escape characters are consumed
 *   (used for tokenizing). When true, they are kept verbatim so the segment can
 *   be re-tokenized later (used for pipe splitting).
 * @returns The list of segments (empty segments are dropped).
 */
function splitRespectingQuotes(
  input: string,
  isDelimiter: (ch: string) => boolean,
  preserveSyntax: boolean,
): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let tokenStarted = false;

  const flush = () => {
    const seg = preserveSyntax ? current.trim() : current;
    if (seg.length > 0 || (!preserveSyntax && tokenStarted)) segments.push(seg);
    current = "";
    tokenStarted = false;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      tokenStarted = true;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      tokenStarted = true;
      if (inSingle) {
        // Single quotes are fully literal in BOTH modes: a backslash inside them
        // is an ordinary character, never an escape. Treating it as an escape
        // (the preserveSyntax path used by pipe-splitting) made splitPipes reject
        // inputs like `echo 'a\'` that tokenize accepts.
        current += ch;
        continue;
      }
      if (inDouble && !preserveSyntax) {
        const next = input[i + 1];
        if (next !== undefined && ['"', "\\", "$", "`", "\n"].includes(next)) {
          escaped = true;
        } else {
          current += ch;
        }
        continue;
      }
      if (preserveSyntax) current += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      tokenStarted = true;
      if (preserveSyntax) current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      tokenStarted = true;
      if (preserveSyntax) current += ch;
      continue;
    }

    if (!inSingle && !inDouble && isDelimiter(ch)) {
      flush();
      continue;
    }

    current += ch;
    tokenStarted = true;
  }

  if (escaped && !preserveSyntax) {
    current += "\\";
  }
  if (inSingle || inDouble) {
    const quote = inSingle ? "single" : "double";
    throw new ParseError(`Unclosed ${quote} quote in input`, { quote });
  }

  flush();
  return segments;
}

/**
 * Tokenizes a raw input string into an array of tokens.
 *
 * Handles single quotes, double quotes, and backslash escaping.
 * Whitespace outside of quotes is used as the delimiter.
 *
 * @param input - The raw input string to tokenize.
 * @returns An array of parsed tokens.
 */
export function tokenize(input: string): string[] {
  return splitRespectingQuotes(input, (ch) => /\s/.test(ch), false);
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
        throw new Error(
          `Invalid command definition: command name "${token}" cannot follow an argument in "${definition}"`,
        );
      }
      names.push(token);
    }
  }

  const name = names.pop();
  if (!name) {
    throw new Error(`Invalid command definition: missing command name in "${definition}"`);
  }

  const argumentNames = new Set<string>();
  let seenOptional = false;
  for (const arg of argDefs) {
    if (argumentNames.has(arg.name)) {
      throw new Error(
        `Invalid command definition: duplicate argument name "${arg.name}" in "${definition}"`,
      );
    }
    argumentNames.add(arg.name);
    if (!arg.required) seenOptional = true;
    if (arg.required && seenOptional) {
      throw new Error(
        `Invalid command definition: required argument "${arg.name}" cannot follow an optional argument in "${definition}"`,
      );
    }
  }

  // A variadic argument must be the last argument; nothing after it is reachable.
  for (let i = 0; i < argDefs.length - 1; i++) {
    if (argDefs[i].variadic) {
      throw new Error(
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
    throw new Error(
      `Invalid command definition: argument token "${token}" is missing its closing "${closer}"`,
    );
  }
  const inner = token.slice(1, -1); // remove < > or [ ]
  const variadic = inner.startsWith("...");
  const name = variadic ? inner.slice(3) : inner;
  if (name.length === 0) {
    throw new Error(`Invalid command definition: empty argument name in "${token}"`);
  }

  return { name, required, variadic };
}

/**
 * Parses an option flags string into its long name, short aliases, and whether it accepts a value.
 *
 * Supports formats like `"-p, --port <number>"` or `"--verbose"`.
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
      if (long) longAliases.push(long);
      long = name;
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
 * @returns The fully parsed result including command path, arguments, and options.
 */
export function parse(input: string | string[], registry: CommandRegistry): ParseResult {
  const rawInput = Array.isArray(input) ? input.join(" ") : input;
  const tokens = Array.isArray(input) ? input : tokenize(input);
  const rawArgv = Array.isArray(input) ? [...input] : undefined;

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
  const { positional, options, builtInHelp } = extractOptionsAndArgs(remaining, command);

  // Map positional args
  const { args, extraArgs } = mapPositionalArgs(positional, command.argDefs);

  return { commandPath, args, options, extraArgs, rawInput, rawArgv, command, builtInHelp };
}

/**
 * Separates an array of tokens into positional arguments and parsed options.
 *
 * Handles long options (`--name`), short options (`-n`), negated booleans (`--no-verbose`),
 * combined short flags (`-abc`), `=` value syntax, and the `--` separator.
 *
 * @param tokens - The remaining tokens after the command path has been consumed.
 * @param command - The matched command definition containing option metadata.
 * @returns An object with the positional argument values and a record of parsed options.
 */
function extractOptionsAndArgs(
  tokens: string[],
  command: CommandDefinition,
): { positional: string[]; options: Record<string, unknown>; builtInHelp: boolean } {
  const positional: string[] = [];
  const options: Record<string, unknown> = Object.create(null);
  let pastDoubleDash = false;
  let builtInHelp = false;

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

    if (token === "<" || token === ">") {
      throw new ParseError(`Redirection operator "${token}" is not supported`);
    }

    if (token === "--") {
      pastDoubleDash = true;
      i++;
      continue;
    }

    // Negated boolean (--no-x), unless an option is literally named "no-x".
    const negatedEqIndex = token.indexOf("=");
    const negatedLiteralName = token.slice(2, negatedEqIndex === -1 ? undefined : negatedEqIndex);
    if (token.startsWith("--no-") && !optionDefs.has(negatedLiteralName)) {
      const name = token.slice(5, negatedEqIndex === -1 ? undefined : negatedEqIndex);
      if (negatedEqIndex !== -1) {
        throw new InvalidOptionError(`Option --no-${name} does not accept a value`, {
          optionName: name,
          value: token.slice(negatedEqIndex + 1),
        });
      }
      const def = optionDefs.get(name);
      if (!def) {
        throw new UnknownOptionError(`--no-${name}`);
      }
      if (def.schema.type !== "boolean") {
        throw new InvalidOptionError(`Option --no-${name} can only be used with boolean options`, {
          optionName: name,
        });
      }
      options[name] = false;
      i++;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const name = token.slice(2, eqIndex);
        const def = optionDefs.get(name);
        if (!def) {
          throw new UnknownOptionError(`--${name}`);
        }
        appendOption(options, name, token.slice(eqIndex + 1), def);
        i++;
        continue;
      }

      const name = token.slice(2);
      const def = optionDefs.get(name);
      if (!def) {
        if (name === "help") {
          builtInHelp = true;
          options.help = true;
          i++;
          continue;
        }
        throw new UnknownOptionError(`--${name}`);
      }
      const isBool = def.schema.type === "boolean";

      if (isBool) {
        options[name] = true;
        i++;
      } else {
        const nextToken = tokens[i + 1];
        if (nextToken !== undefined && !looksLikeOption(nextToken, def)) {
          appendOption(options, name, nextToken, def);
          i += 2;
        } else {
          throw new InvalidOptionError(
            `Option --${name} expects a value; use --${name}=<value> for values starting with "-"`,
            { optionName: name },
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
      if (eqIndex !== -1) {
        const alias = token.slice(1, eqIndex);
        const name = aliasMap.get(alias) ?? alias;
        if (!optionDefs.has(name)) {
          throw new UnknownOptionError(`-${alias}`);
        }
        appendOption(options, name, token.slice(eqIndex + 1), optionDefs.get(name));
        i++;
        continue;
      }

      const chars = token.slice(1);
      if (chars.length === 1) {
        const name = aliasMap.get(chars) ?? chars;
        const def = optionDefs.get(name);
        if (!def) {
          // Mirror the long `--help` fallback so `-h` works on every command
          // unless the user has explicitly bound `-h` to another option.
          if (chars === "h") {
            builtInHelp = true;
            options.help = true;
            i++;
            continue;
          }
          throw new UnknownOptionError(`-${chars}`);
        }
        const isBool = def.schema.type === "boolean";

        if (isBool) {
          options[name] = true;
          i++;
        } else {
          const nextToken = tokens[i + 1];
          if (nextToken !== undefined && !looksLikeOption(nextToken, def)) {
            appendOption(options, name, nextToken, def);
            i += 2;
          } else {
            throw new InvalidOptionError(
              `Option -${chars} expects a value; use --${name}=<value> for values starting with "-"`,
              { optionName: name },
            );
          }
        }
      } else {
        // Multiple short booleans: -abc → -a -b -c
        for (const ch of chars) {
          const name = aliasMap.get(ch) ?? ch;
          const def = optionDefs.get(name);
          if (!def) {
            // Mirror the single-flag `-h` fallback so help works inside a cluster
            // (e.g. `-vh`) unless the user has bound `-h` to another option.
            if (ch === "h") {
              builtInHelp = true;
              options.help = true;
              continue;
            }
            throw new UnknownOptionError(`-${ch}`);
          }
          if (def.schema.type !== "boolean") {
            throw new InvalidOptionError(
              `Option -${ch} expects a value and cannot be combined with other short flags`,
              { optionName: name },
            );
          }
          options[name] = true;
        }
        i++;
      }
      continue;
    }

    positional.push(token);
    i++;
  }

  return { positional, options, builtInHelp };
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
 * @param name - The option name (long form).
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
 * @returns A record mapping argument names to their parsed values.
 */
function mapPositionalArgs(
  positional: string[],
  argDefs: ArgDef[],
): { args: Record<string, unknown>; extraArgs: string[] } {
  const args: Record<string, unknown> = Object.create(null);

  for (let i = 0; i < argDefs.length; i++) {
    const def = argDefs[i];

    if (def.variadic) {
      args[def.name] = positional.slice(i);
      return { args, extraArgs: [] };
    }

    if (i < positional.length) {
      args[def.name] = positional[i];
    } else if (def.required) {
      // Will be caught by validation in router
      args[def.name] = undefined;
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
    // (matching splitRespectingQuotes), so quote state stays balanced.
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
  return splitRespectingQuotes(input, (ch) => ch === "|", true);
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

import { InvalidOptionError, UnknownOptionError } from "../errors.js";
import type { ArgDef, CommandDefinition, ParseResult } from "../types.js";
import type { CommandRegistry } from "./registry.js";

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

  const flush = () => {
    const seg = preserveSyntax ? current.trim() : current;
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

    if (ch === "\\") {
      if (preserveSyntax) current += ch;
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      if (preserveSyntax) current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      if (preserveSyntax) current += ch;
      continue;
    }

    if (!inSingle && !inDouble && isDelimiter(ch)) {
      flush();
      continue;
    }

    current += ch;
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
  return splitRespectingQuotes(input, (ch) => ch === " ", false);
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

  for (const token of tokens) {
    if (token.startsWith("<") || token.startsWith("[")) {
      argDefs.push(parseArgToken(token));
    } else {
      names.push(token);
    }
  }

  const name = names.pop();
  if (!name) {
    throw new Error(`Invalid command definition: missing command name in "${definition}"`);
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
  const inner = token.slice(1, -1); // remove < > or [ ]
  const variadic = inner.startsWith("...");
  const name = variadic ? inner.slice(3) : inner;

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
  takesValue: boolean;
} {
  const parts = flags.split(",").map((p) => p.trim());
  let long = "";
  const aliases: string[] = [];
  let takesValue = false;

  for (let part of parts) {
    // Check for value placeholder
    const valueMatch = part.match(/\s+<[^>]+>$/);
    if (valueMatch) {
      takesValue = true;
      part = part.slice(0, -valueMatch[0].length);
    }

    if (part.startsWith("--")) {
      long = part.slice(2);
    } else if (part.startsWith("-")) {
      aliases.push(part.slice(1));
    }
  }

  return { long, aliases, takesValue };
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

  if (tokens.length === 0) {
    return { commandPath: [], args: {}, options: {}, rawInput };
  }

  // Resolve command path
  const match = registry.matchCommandPath(tokens);
  if (!match) {
    return { commandPath: [], args: {}, options: {}, rawInput };
  }

  const { command, consumed } = match;
  const commandPath = tokens.slice(0, consumed);
  const remaining = tokens.slice(consumed);

  // Separate options and positional args
  const { positional, options } = extractOptionsAndArgs(remaining, command);

  // Map positional args
  const { args, extraArgs } = mapPositionalArgs(positional, command.argDefs);

  return { commandPath, args, options, extraArgs, rawInput, command };
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
): { positional: string[]; options: Record<string, unknown> } {
  const positional: string[] = [];
  const options: Record<string, unknown> = {};
  let pastDoubleDash = false;

  // Build alias map
  const aliasMap = new Map<string, string>();
  const optionDefs = command.options;
  for (const [, def] of optionDefs) {
    for (const alias of def.aliases) {
      aliasMap.set(alias, def.long);
    }
  }

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
    if (token.startsWith("--no-") && token.indexOf("=") === -1 && !optionDefs.has(token.slice(2))) {
      const name = token.slice(5);
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
          throw new InvalidOptionError(`Option --${name} expects a value`, { optionName: name });
        }
      }
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
            throw new InvalidOptionError(`Option -${chars} expects a value`, { optionName: name });
          }
        }
      } else {
        // Multiple short booleans: -abc → -a -b -c
        for (const ch of chars) {
          const name = aliasMap.get(ch) ?? ch;
          const def = optionDefs.get(name);
          if (!def) {
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

  return { positional, options };
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
  const args: Record<string, unknown> = {};

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
  // Preserve quotes/escapes so each segment can be tokenized again downstream.
  return splitRespectingQuotes(input, (ch) => ch === "|", true);
}

import type { ArgDef, CommandDefinition, ParseResult } from "../types.js";
import type { CommandRegistry } from "./registry.js";

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
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
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

    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
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
  const tokens = definition.trim().split(/\s+/);
  const names: string[] = [];
  const argDefs: ArgDef[] = [];

  for (const token of tokens) {
    if (token.startsWith("<") || token.startsWith("[")) {
      argDefs.push(parseArgToken(token));
    } else {
      names.push(token);
    }
  }

  const name = names.pop() as string;
  const parentPath = names;

  return { parentPath, name, argDefs };
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
  const args = mapPositionalArgs(positional, command.argDefs);

  return { commandPath, args, options, rawInput, command };
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

    if (token.startsWith("--no-")) {
      const name = token.slice(5);
      options[name] = false;
      i++;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const name = token.slice(2, eqIndex);
        options[name] = token.slice(eqIndex + 1);
        i++;
        continue;
      }

      const name = token.slice(2);
      const def = optionDefs.get(name);
      const isBool = def?.schema.type === "boolean" || (!def?.takesValue && !def);

      if (isBool) {
        options[name] = true;
        i++;
      } else {
        const nextToken = tokens[i + 1];
        if (nextToken !== undefined) {
          appendOption(options, name, nextToken, def);
          i += 2;
        } else {
          options[name] = true;
          i++;
        }
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1 && !token.startsWith("-", 1)) {
      const eqIndex = token.indexOf("=");
      if (eqIndex !== -1) {
        const alias = token.slice(1, eqIndex);
        const name = aliasMap.get(alias) ?? alias;
        options[name] = token.slice(eqIndex + 1);
        i++;
        continue;
      }

      const chars = token.slice(1);
      if (chars.length === 1) {
        const name = aliasMap.get(chars) ?? chars;
        const def = optionDefs.get(name);
        const isBool = def?.schema.type === "boolean" || (!def?.takesValue && !def);

        if (isBool) {
          options[name] = true;
          i++;
        } else {
          const nextToken = tokens[i + 1];
          if (nextToken !== undefined) {
            appendOption(options, name, nextToken, def);
            i += 2;
          } else {
            options[name] = true;
            i++;
          }
        }
      } else {
        // Multiple short booleans: -abc → -a -b -c
        for (const ch of chars) {
          const name = aliasMap.get(ch) ?? ch;
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
function mapPositionalArgs(positional: string[], argDefs: ArgDef[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (let i = 0; i < argDefs.length; i++) {
    const def = argDefs[i];

    if (def.variadic) {
      args[def.name] = positional.slice(i);
      return args;
    }

    if (i < positional.length) {
      args[def.name] = positional[i];
    } else if (def.required) {
      // Will be caught by validation in router
      args[def.name] = undefined;
    }
  }

  return args;
}

/**
 * Splits a raw input string into pipe-separated command segments.
 * Respects quoting so that pipe characters inside quotes are not split.
 *
 * @param input - The raw input string.
 * @returns An array of trimmed command strings.
 */
export function splitPipes(input: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === "|" && !inSingle && !inDouble) {
      segments.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  const last = current.trim();
  if (last.length > 0) {
    segments.push(last);
  }

  return segments;
}

import { InvalidOptionError, MissingOptionError, ValidationError } from "../errors.js";
import type { CommandContext, OptionDef } from "../types.js";

/**
 * Resolves raw parsed option values against their definitions.
 *
 * Performs alias normalization, type coercion, custom parsing, default
 * application, required-value checks, choice validation, and custom
 * validation. Unknown options (not present in `defs`) are passed through
 * unchanged.
 *
 * @param raw - The raw key/value pairs obtained from the argument parser.
 * @param defs - A map of canonical option names to their definitions.
 * @param ctx - The current command execution context.
 * @returns A record of fully resolved option values keyed by their long names.
 * @throws {MissingOptionError} If a required option is not provided.
 * @throws {InvalidOptionError} If a value fails type coercion or choice validation.
 * @throws {ValidationError} If a custom `validate` function rejects the value.
 */
export function resolveOptions(
  raw: Record<string, unknown>,
  defs: Map<string, OptionDef>,
  ctx: CommandContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  // Build alias → long mapping
  const aliasMap = new Map<string, string>();
  for (const [, def] of defs) {
    for (const alias of def.aliases) {
      aliasMap.set(alias, def.long);
    }
  }

  // Normalize aliases in raw
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const long = aliasMap.get(key) ?? key;
    normalized[long] = value;
  }

  for (const [, def] of defs) {
    const { long, schema } = def;
    let value = normalized[long];

    if (value !== undefined) {
      if (schema.parse) {
        // A custom parser is the user's escape hatch: it receives the raw
        // string(s) and fully owns coercion. Built-in coercion is skipped.
        try {
          value = Array.isArray(value)
            ? value.map((v) => schema.parse?.(String(v), ctx))
            : schema.parse(String(value), ctx);
        } catch (err) {
          if (err instanceof Error) throw new ValidationError(err.message, err);
          throw err;
        }
      } else {
        value = coerce(value, schema.type, long);
      }
    }

    // Apply default
    if (value === undefined && schema.default !== undefined) {
      value = schema.default;
    }

    // Required check
    if (value === undefined && schema.required) {
      throw new MissingOptionError(long);
    }

    // Choices check (compare leniently so declared string choices match
    // coerced numeric values and vice versa).
    if (value !== undefined && schema.choices) {
      const allowed = schema.choices;
      const matches =
        allowed.includes(value) || allowed.map(String).includes(String(value as unknown));
      if (!matches) {
        throw new InvalidOptionError(
          `Invalid value "${value}" for --${long}. Allowed: ${allowed.join(", ")}`,
          { optionName: long, value },
        );
      }
    }

    // Validate
    if (value !== undefined && schema.validate) {
      try {
        schema.validate(value, ctx);
      } catch (err) {
        if (err instanceof Error) {
          throw new ValidationError(err.message, err);
        }
        throw err;
      }
    }

    if (value !== undefined) {
      resolved[long] = value;
    }
  }

  // Pass through unknown options (not defined in schema)
  for (const [key, value] of Object.entries(normalized)) {
    if (!defs.has(key) && !(key in resolved)) {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Coerces a raw option value to the expected type.
 *
 * Supports `"string"`, `"boolean"`, `"number"`, `"string[]"`, and `"number[]"`.
 * When `type` is `undefined` the value is returned as-is (treated as a string).
 *
 * @param value - The raw value to coerce.
 * @param type - The target type declared in the option schema.
 * @param name - The long option name, used in error messages.
 * @returns The coerced value.
 * @throws {InvalidOptionError} If numeric coercion results in `NaN`.
 */
/**
 * Converts a value to a finite number, returning null for empty/blank strings
 * or non-numeric input so callers can reject them instead of silently producing 0.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function coerce(value: unknown, type: string | undefined, name: string): unknown {
  if (type === undefined || type === "string") return value;

  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return Boolean(value);
  }

  if (type === "number") {
    const num = toNumber(value);
    if (num === null) {
      throw new InvalidOptionError(`Option --${name} expects a number, got "${value}"`, {
        optionName: name,
        value,
      });
    }
    return num;
  }

  if (type === "string[]") {
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }

  if (type === "number[]") {
    const arr = Array.isArray(value) ? value : [value];
    return arr.map((v) => {
      const num = toNumber(v);
      if (num === null) {
        throw new InvalidOptionError(`Option --${name} expects numbers, got "${v}"`, {
          optionName: name,
          value: v,
        });
      }
      return num;
    });
  }

  return value;
}

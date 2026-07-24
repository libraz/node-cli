import { buildAliasMap } from "../command/parser.js";
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
 * @throws {ValidationError} If a custom `parse` or `validate` function rejects the value.
 */
export function resolveOptions(
  raw: Record<string, unknown>,
  defs: Map<string, OptionDef>,
  ctx: CommandContext,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = Object.create(null);

  // Build alias → long mapping (shared with the parser so both resolve aliases
  // identically).
  const aliasMap = buildAliasMap(defs);

  // Normalize aliases in raw
  const normalized: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(raw)) {
    const long = aliasMap.get(key) ?? key;
    normalized[long] = value;
  }

  // Make raw cross-option values visible during custom parsing. Each canonical
  // value replaces its raw counterpart as the first pass progresses.
  Object.assign(resolved, normalized);
  ctx.options = resolved;

  // First pass: parse/coerce/default/required for every option.
  for (const [, def] of defs) {
    const { long, schema } = def;
    const rawValue = normalized[long];
    // Presence is tracked from the raw (pre-parse) value so it is decoupled from
    // the resolved value: a flag the user explicitly passed whose custom `parse`
    // returns `undefined` is still present. Default application and the required
    // check are driven by presence, never by whether the resolved value happens
    // to be `undefined`, keeping scalar and array options consistent.
    const present = rawValue !== undefined;
    let value = rawValue;

    if (present) {
      if (schema.parse) {
        // A custom parser is the user's escape hatch: it receives the raw
        // string(s) and fully owns coercion. Built-in coercion is skipped.
        try {
          value = Array.isArray(value)
            ? value.map((v) => schema.parse?.(String(v), ctx))
            : schema.parse(String(value), ctx);
        } catch (err) {
          if (err instanceof Error) throw new ValidationError(err.message, err);
          throw new ValidationError(String(err), err);
        }
      } else {
        value = coerce(value, schema.type, long);
      }
    } else if (schema.required) {
      throw new MissingOptionError(long);
    } else if (schema.default !== undefined) {
      // Apply the default only when the flag was absent, and run it through the
      // same built-in coercion an explicit value receives so the runtime type
      // matches (e.g. a string default on a `number` option becomes a number).
      // A default already in its final type is left unchanged. Custom `parse` is
      // not re-applied: a default is an already-resolved value, not raw input.
      value = coerce(schema.default, schema.type, long);
    }

    // Keep the flag present whenever it was supplied — even if its resolved
    // value is `undefined` — so an explicit parse-to-undefined is preserved
    // rather than being dropped and re-triggering defaults downstream.
    if (present || value !== undefined) resolved[long] = value;
    else delete resolved[long];
  }

  // Second pass: every validator sees the complete, canonical option set.
  for (const [, def] of defs) {
    const { long, schema } = def;
    const value = resolved[long];

    // Choices check (compare leniently so declared string choices match
    // coerced numeric values and vice versa). For array-typed options each
    // element is validated individually rather than the joined array.
    if (value !== undefined && schema.choices) {
      const allowed = schema.choices;
      const allowedStrings = allowed.map(String);
      const isAllowed = (v: unknown) => allowed.includes(v) || allowedStrings.includes(String(v));
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (!isAllowed(candidate)) {
          throw new InvalidOptionError(
            `Invalid value "${candidate}" for --${long}. Allowed: ${allowed.join(", ")}`,
            { optionName: long, value: candidate },
          );
        }
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
        throw new ValidationError(String(err), err);
      }
    }
  }

  // Pass through unknown options (not defined in schema)
  for (const [key, value] of Object.entries(normalized)) {
    if (!defs.has(key) && !Object.hasOwn(resolved, key)) {
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
 * Converts a value to a finite number, returning null for empty/blank strings
 * or non-finite/non-numeric input so callers can reject them instead of
 * silently producing 0 or accepting Infinity.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function coerce(value: unknown, type: string | undefined, name: string): unknown {
  if (type === undefined || type === "string") return value;

  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    // Coerce common truthy/falsey spellings explicitly so `--cache=0` means false
    // (JavaScript's `Boolean("0")` is `true`) and an unrecognized value such as
    // `--verbose=hello` is rejected rather than silently treated as `true`.
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    throw new InvalidOptionError(`Option --${name} expects a boolean, got "${value}"`, {
      optionName: name,
      value,
    });
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

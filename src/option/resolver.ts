import { InvalidOptionError, MissingOptionError, ValidationError } from "../errors.js";
import type { MutableCommandContext, OptionDef } from "../types.js";

/**
 * Resolves raw parsed option values against their definitions.
 *
 * Performs alias normalization, type coercion, custom parsing, default
 * application, required-value checks, choice validation, and custom
 * validation. A custom `parse` or `validate` may return a Promise, which is
 * awaited before the next option is processed; when none does, the result is
 * returned synchronously. Unknown options (not present in `defs`) are passed
 * through unchanged.
 *
 * @param raw - The raw key/value pairs obtained from the argument parser.
 * @param defs - A map of canonical option names to their definitions.
 * @param ctx - The current command execution context.
 * @returns The fully resolved option values keyed by their long names, or a
 *   promise of them once a custom callback returned a Promise.
 * @throws {MissingOptionError} If a required option is not provided.
 * @throws {InvalidOptionError} If a value fails type coercion or choice validation.
 * @throws {ValidationError} If a custom `parse` or `validate` function rejects the value.
 */
export function resolveOptions(
  raw: Record<string, unknown>,
  defs: Map<string, OptionDef>,
  ctx: MutableCommandContext,
): Record<string, unknown> | Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = Object.create(null);

  // The parser is the sole alias-normalization point. Keeping this function on
  // canonical keys avoids a second, divergent mapping path. Make raw
  // cross-option values visible during custom parsing; each canonical
  // value replaces its raw counterpart as the first pass progresses.
  Object.assign(resolved, raw);
  ctx.options = resolved;

  // First pass: parse/coerce/default/required for every option. Second pass:
  // every validator sees the complete, canonical option set.
  const steps: (() => void | Promise<void>)[] = [];
  for (const [, def] of defs) steps.push(() => resolveValue(def, raw, resolved, ctx));
  for (const [, def] of defs) steps.push(() => checkValue(def, resolved, ctx));
  return runInOrder(steps, 0, resolved);
}

/**
 * Runs steps in order, staying synchronous until a step returns a Promise, so
 * synchronous callbacks keep the action starting in the same tick as before.
 */
function runInOrder<T>(
  steps: readonly (() => void | Promise<void>)[],
  start: number,
  result: T,
): T | Promise<T> {
  for (let i = start; i < steps.length; i++) {
    const pending = steps[i]();
    if (pending instanceof Promise) return pending.then(() => runInOrder(steps, i + 1, result));
  }
  return result;
}

/** Wraps a custom `parse` or `validate` failure in a {@link ValidationError}. */
function validationFailure(long: string, err: unknown): ValidationError {
  const message = err instanceof Error ? err.message : String(err);
  return new ValidationError(`Invalid value for --${long}: ${message}`, {
    optionName: long,
    cause: err,
  });
}

/**
 * Calls a custom callback, turning a throw or a rejection into a
 * {@link ValidationError} and handing the (possibly awaited) result to `then`.
 */
function guardCustom<T>(
  long: string,
  call: () => T | Promise<T>,
  then: (value: T) => void,
): void | Promise<void> {
  let result: T | Promise<T>;
  try {
    result = call();
  } catch (err) {
    throw validationFailure(long, err);
  }
  if (!(result instanceof Promise)) {
    then(result);
    return;
  }
  return result.then(then, (err: unknown) => {
    throw validationFailure(long, err);
  });
}

/** First-pass step: parses or coerces one option, or applies its default. */
function resolveValue(
  def: OptionDef,
  raw: Record<string, unknown>,
  resolved: Record<string, unknown>,
  ctx: MutableCommandContext,
): void | Promise<void> {
  const { long, schema } = def;
  const rawValue = raw[long];
  // Presence is tracked from the raw (pre-parse) value so it is decoupled from
  // the resolved value: a flag the user explicitly passed whose custom `parse`
  // returns `undefined` is still present. Default application and the required
  // check are driven by presence, never by whether the resolved value happens
  // to be `undefined`, keeping scalar and array options consistent.
  const present = rawValue !== undefined;

  // Keep the flag present whenever it was supplied — even if its resolved
  // value is `undefined` — so an explicit parse-to-undefined is preserved
  // rather than being dropped and re-triggering defaults downstream.
  const store = (value: unknown) => {
    if (present || value !== undefined) resolved[long] = value;
    else delete resolved[long];
  };

  if (present && schema.parse) {
    // A custom parser is the user's escape hatch: it receives the raw
    // string(s) and fully owns coercion. Built-in coercion is skipped.
    const parse = schema.parse;
    return guardCustom(
      long,
      () => {
        if (!Array.isArray(rawValue)) return parse(String(rawValue), ctx);
        const parsed = rawValue.map((element) => parse(String(element), ctx));
        return parsed.some((element) => element instanceof Promise) ? Promise.all(parsed) : parsed;
      },
      store,
    );
  }

  if (present) {
    store(coerceOptionValue(rawValue, schema.type, long));
  } else if (schema.required) {
    throw new MissingOptionError(long);
  } else if (schema.default !== undefined) {
    // Apply the default only when the flag was absent, and run it through the
    // same built-in coercion an explicit value receives so the runtime type
    // matches (e.g. a string default on a `number` option becomes a number).
    // The builder coerces a declared default too, but only to reject a bad one
    // at definition time; this call is what makes resolveOptions correct for a
    // definition it did not build. Custom `parse` is not re-applied: a default
    // is an already-resolved value, not raw input.
    store(coerceOptionValue(schema.default, schema.type, long));
  } else {
    store(undefined);
  }
}

/** Second-pass step: checks one resolved option against its choices and validator. */
function checkValue(
  def: OptionDef,
  resolved: Record<string, unknown>,
  ctx: MutableCommandContext,
): void | Promise<void> {
  const { long, schema } = def;
  if (!Object.hasOwn(resolved, long)) return;
  const value = resolved[long];

  // Choices check (compare leniently so declared string choices match
  // coerced numeric values and vice versa). For array-typed options each
  // element is validated individually rather than the joined array.
  if (schema.choices) {
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

  const validate = schema.validate;
  if (validate) {
    return guardCustom(
      long,
      () => validate(value, ctx),
      () => {},
    );
  }
}

/**
 * Converts a value to a number, returning null for anything callers must reject
 * rather than silently accept: empty or blank strings, non-numeric text,
 * non-finite values, and magnitudes beyond `Number.MAX_SAFE_INTEGER`, whose
 * decimal digits a JavaScript number cannot represent exactly.
 *
 * @param value - The raw value to convert.
 * @returns The number, or null when the value is not an exactly representable one.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
  }
  if (typeof value !== "string") return null;
  // Accept ordinary decimal notation (including scientific notation), but not
  // JavaScript's hexadecimal/octal/binary forms, padded integers, or strings
  // whose precision Number cannot represent safely.
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?(?:0|[1-9]\d*))?$/.test(value)) {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) && Math.abs(num) <= Number.MAX_SAFE_INTEGER ? num : null;
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
 */
export function coerceOptionValue(value: unknown, type: string | undefined, name: string): unknown {
  if (type === undefined) return value;
  if (type === "string") return String(value);

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
      // Say which constraint actually rejected the value. A magnitude past the
      // safe-integer range is a number; calling it "not a number" sends the
      // caller looking for a typo that is not there.
      const asNumber = Number(value);
      const reason =
        Number.isFinite(asNumber) && Math.abs(asNumber) > Number.MAX_SAFE_INTEGER
          ? `is outside the safe integer range (max ${Number.MAX_SAFE_INTEGER})`
          : `expects a number, got "${value}"`;
      throw new InvalidOptionError(`Option --${name} ${reason}`, {
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

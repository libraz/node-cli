/**
 * Guards for values and callbacks the framework receives from the CLI author or
 * from data the CLI renders. Render loops, completion and the shell session go
 * through these instead of open-coding a try/catch, an own-property check or a
 * finiteness test, so a new call site cannot pick a different policy.
 */

/**
 * Calls a caller-supplied function and returns `fallback(error)` when it throws.
 * Use it for every invocation of a provider, formatter, filter or conversion
 * whose failure must not end a render or session loop.
 */
export function guardCall<T>(fn: () => T, fallback: (error: unknown) => T): T {
  try {
    return fn();
  } catch (error) {
    return fallback(error);
  }
}

/**
 * Reads `key` from `record` only when it is an own property, so names such as
 * `constructor` or `toString` never resolve to inherited members.
 */
export function ownValue<T = unknown>(record: unknown, key: string): T | undefined {
  if (record === null || (typeof record !== "object" && typeof record !== "function")) {
    return undefined;
  }
  return Object.hasOwn(record, key) ? ((record as Record<string, unknown>)[key] as T) : undefined;
}

/** Widest span any width, padding or size option may request, in cells; far above a real terminal. */
export const MAX_RENDER_WIDTH = 4096;

/**
 * Returns `value` floored to an integer when it is finite and at least `min`,
 * otherwise `undefined`. Callers decide whether `undefined` means "use the
 * default" or "reject the option".
 */
export function finiteInteger(value: unknown, min: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer >= min ? integer : undefined;
}

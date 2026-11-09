import { type Readable, Writable } from "node:stream";
import { CancelledError, describeReceived, InputEndedError, usageError } from "../errors.js";
import type { StdioOptions } from "../types.js";
import {
  type color as c,
  createColorizer,
  isControlCode,
  isTTY,
  renderSafe,
  splitAnsi,
  splitGraphemes,
  stripAnsi,
} from "./color.js";
import { type LineReader, openLineReader } from "./line-reader.js";
import { writeThrough } from "./region.js";

// ── Types ──

/**
 * Options shared by all prompt types. Questions are written to `stderr` so a
 * prompt never pollutes piped stdout; the members match {@link StdioOptions},
 * so a command context can be passed as the options object.
 */
export type PromptOptions<T = unknown> = Pick<StdioOptions, "stdin" | "stderr" | "signal"> & {
  /**
   * Validation function; throw (or reject) to refuse the value and ask again.
   * The thrown error's message is shown below the question. Defaults to no validation.
   */
  validate?: ((value: T) => void | Promise<void>) | undefined;
  /** Symbol displayed before the question, rendered on one line. Defaults to "?". */
  marker?: string | undefined;
};

/**
 * Options for a text input prompt.
 */
export interface TextOptions extends PromptOptions<string> {
  /**
   * Text used when the answer is empty; it also satisfies `required`, and an
   * empty string counts. Defaults to none: an empty answer is then refused while
   * `required` is true.
   */
  default?: string | undefined;
  /** Example text shown after the question as `(e.g. …)`; ignored when `default` is set. */
  placeholder?: string | undefined;
  /** Whether to trim leading/trailing whitespace. Defaults to true. */
  trim?: boolean | undefined;
  /** Whether a non-empty value is required. Defaults to true. */
  required?: boolean | undefined;
}

/**
 * Options for a yes/no confirmation prompt.
 */
export interface ConfirmOptions extends PromptOptions<boolean> {
  /** Default boolean value. Defaults to false. */
  default?: boolean | undefined;
}

/**
 * Represents a single selectable choice with a display label and underlying value.
 */
export interface SelectChoice<T> {
  /** Display label shown to the user. */
  label: string;
  /** Value returned when this choice is selected. */
  value: T;
  /** Hint text displayed alongside the label. Defaults to none. */
  hint?: string | undefined;
}

/**
 * Options for a single-select prompt.
 */
export interface SelectOptions<T> extends PromptOptions<T> {
  /**
   * Default selected value, returned when the user presses Enter with no input.
   * It must equal the value of one of the choices. Defaults to none: an empty
   * answer is then asked again.
   */
  default?: T | undefined;
}

/**
 * Options for a multiselect prompt.
 */
export interface MultiselectOptions<T> extends PromptOptions<readonly T[]> {
  /**
   * Pre-selected values, returned in choice order on an empty answer. Each must
   * equal the value of one of the choices, and the number of distinct values must
   * fall within `min` and `max`. Defaults to none: an empty answer returns `[]`.
   */
  default?: readonly T[] | undefined;
  /**
   * Minimum number of distinct items that must be selected. Defaults to no
   * minimum: an empty answer (with no `default`) returns `[]`.
   */
  min?: number | undefined;
  /**
   * Maximum number of distinct items that may be selected. Defaults to no
   * maximum.
   */
  max?: number | undefined;
}

/** Options for a password prompt. Passwords intentionally have no default value. */
export interface PasswordOptions extends PromptOptions<string> {
  /** Whether to trim leading/trailing whitespace. Defaults to false. */
  trim?: boolean | undefined;
  /** Whether a non-empty value is required. Defaults to true. */
  required?: boolean | undefined;
}

/**
 * A choice can be either a raw value or a descriptor object that has both
 * `label` and `value`. A value object that itself has a `label` member is not
 * accepted bare: wrap it as `{ label, value }`. Objects with only a `label`
 * are rejected at runtime so ordinary domain objects are never silently
 * converted to `undefined`.
 */
export type Choice<T> = SelectChoice<T> | Exclude<T, { label: unknown }>;

// ── Helpers ──

/** Rejects a message that is not a string, before anything is written. */
function checkMessage(fn: string, message: unknown): void {
  if (typeof message !== "string") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "message" argument of prompt.${fn}() must be a string. Received ${describeReceived(message)}`,
    );
  }
}

/** Rejects a `validate` option that is neither omitted nor a function. */
function checkValidate(fn: string, validate: unknown): void {
  if (validate !== undefined && typeof validate !== "function") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "validate" option of prompt.${fn}() must be a function. Received ${describeReceived(validate)}`,
    );
  }
}

/** Rejects an option that is neither omitted nor of the expected primitive type. */
function checkOptionType(
  fn: string,
  name: string,
  value: unknown,
  type: "string" | "boolean",
): void {
  if (value !== undefined && typeof value !== type) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "${name}" option of prompt.${fn}() must be a ${type}. Received ${describeReceived(value)}`,
    );
  }
}

/** Rejects a stream-like option that is not an object with the given method. */
function checkStream(fn: string, name: string, value: unknown, method: string, nullable: boolean) {
  if (value === undefined || (nullable && value === null)) return;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>)[method] !== "function"
  ) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "${name}" option of prompt.${fn}() must be a ${nullable ? "readable stream or null" : "writable stream"}. Received ${describeReceived(value)}`,
    );
  }
}

/**
 * Validates the options shared by every prompt kind (and the per-kind members
 * named in `booleans` and `strings`) before anything is written.
 *
 * @param fn - Name of the calling prompt, for error messages.
 * @param options - The options object as passed.
 * @param members - Per-kind members to check by primitive type.
 */
function checkOptions(
  fn: string,
  options: unknown,
  members: { booleans?: string[]; strings?: string[] } = {},
): void {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "options" argument of prompt.${fn}() must be an object. Received ${describeReceived(options)}`,
    );
  }
  const o = options as Record<string, unknown>;
  checkValidate(fn, o.validate);
  checkOptionType(fn, "marker", o.marker, "string");
  for (const name of members.strings ?? []) checkOptionType(fn, name, o[name], "string");
  for (const name of members.booleans ?? []) checkOptionType(fn, name, o[name], "boolean");
  checkStream(fn, "stdin", o.stdin, "on", true);
  checkStream(fn, "stderr", o.stderr, "write", false);
  if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "signal" option of prompt.${fn}() must be an AbortSignal. Received ${describeReceived(o.signal)}`,
    );
  }
}

/** Rejects `choices` that is not an array. */
function checkChoices(fn: string, choices: unknown): void {
  if (!Array.isArray(choices)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "choices" argument of prompt.${fn}() must be an array. Received ${describeReceived(choices)}`,
    );
  }
}

/**
 * Normalizes an array of raw values or SelectChoice objects into a uniform SelectChoice array.
 *
 * @param fn - Name of the calling prompt, for error messages.
 * @param choices - Array of choices to normalize.
 * @returns Normalized array of SelectChoice objects.
 */
function normalizeChoices<T>(fn: string, choices: readonly Choice<T>[]): SelectChoice<T>[] {
  return choices.map((ch) => {
    if (typeof ch === "object" && ch !== null && "label" in (ch as Record<string, unknown>)) {
      if (!("value" in (ch as Record<string, unknown>))) {
        throw usageError(
          "type",
          "ERR_INVALID_ARG_TYPE",
          `The "choices" argument of prompt.${fn}() has a descriptor with a label but no value`,
        );
      }
      const choice = ch as SelectChoice<T>;
      if (choice.hint !== undefined && typeof choice.hint !== "string") {
        throw usageError(
          "type",
          "ERR_INVALID_ARG_TYPE",
          `The "hint" member of a choice of prompt.${fn}() must be a string. Received ${describeReceived(choice.hint)}`,
        );
      }
      return {
        ...choice,
        label: renderSafe(choice.label),
        hint: choice.hint === undefined ? undefined : renderSafe(choice.hint),
      };
    }
    return { label: renderSafe(String(ch)), value: ch as T };
  });
}

/**
 * Finds the index of the choice matching a default value.
 *
 * The default may be a raw value, the underlying choice value, or the
 * SelectChoice object itself. Matching prefers reference/primitive equality on
 * the value and also accepts a default that is the choice object, so object
 * values are honored even though structural equality is not attempted.
 *
 * @param normalized - Normalized choices to search.
 * @param defaultValue - The configured default, or undefined when none is set.
 * @returns The matching index, or -1 when there is no default or no match.
 */
function findDefaultIndex<T>(normalized: SelectChoice<T>[], defaultValue: unknown): number {
  if (defaultValue === undefined) return -1;
  return normalized.findIndex(
    (ch) => Object.is(ch.value, defaultValue) || Object.is(ch, defaultValue),
  );
}

/**
 * Rejects a default that matches none of the choices.
 *
 * @param fn - Name of the calling prompt, for error messages.
 * @param normalized - Normalized choices to search.
 * @param defaultValue - One configured default value.
 */
function checkDefaultMatches<T>(
  fn: string,
  normalized: SelectChoice<T>[],
  defaultValue: unknown,
): void {
  if (defaultValue !== undefined && findDefaultIndex(normalized, defaultValue) < 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "default" option of prompt.${fn}() must match one of the choices. Received ${describeReceived(defaultValue, "range")}`,
    );
  }
}

/**
 * Logs a warning for any label that appears more than once. Duplicate labels
 * are only reachable by their (unique) index, so callers are advised to use the
 * displayed numbers to disambiguate.
 *
 * @param normalized - Normalized choices to inspect.
 * @param stderr - Stream the warning is written to.
 */
function warnDuplicateLabels<T>(
  normalized: SelectChoice<T>[],
  stderr: Writable,
  col: typeof c,
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ch of normalized) {
    if (seen.has(ch.label)) duplicates.add(ch.label);
    seen.add(ch.label);
  }
  for (const label of duplicates) {
    writeThrough(
      stderr,
      `${col.yellow("!")} Duplicate label "${label}"; select it by its number\n`,
    );
  }
}

/**
 * A prompt's line-reader session plus a cancellation signal that is aborted on
 * Ctrl+C (SIGINT) or when the caller's signal aborts.
 */
interface CancelableReader {
  reader: LineReader;
  signal: AbortSignal;
  /** Builds the cancellation error, carrying the caller's abort reason when there is one. */
  cancelError: () => CancelledError;
  dispose: () => void;
}

/**
 * Builds the question line every prompt kind shows. Caller-supplied marker and
 * message pass through the rendered-region boundary here, so a control sequence
 * in either cannot move the cursor or leave styling open around the answer.
 */
function promptHeading(
  col: ReturnType<typeof createColorizer>,
  marker: string,
  message: string,
): string {
  return `${col.green(renderSafe(marker))} ${col.bold(renderSafe(message))}`;
}

/** Renders a validation failure below the question, without trusting its text. */
function validationLine(col: ReturnType<typeof createColorizer>, err: unknown): string {
  return `${col.red("\u2716")} ${renderSafe(err instanceof Error ? err.message : String(err))}\n`;
}

/**
 * Opens a line reader plus a cancellation signal that is aborted when the user
 * presses Ctrl+C (SIGINT) or `externalSignal` aborts. Unanswered lines stay with
 * the input for the next prompt when the session is disposed.
 *
 * @param input - Input stream, already resolved by {@link resolveInput}.
 * @param output - Output stream the questions are written to.
 * @returns The reader, an abort signal, and teardown.
 */
function createCancelableReader(
  input: Readable,
  output: Writable,
  terminalOverride?: boolean,
  externalSignal?: AbortSignal,
): CancelableReader {
  // Terminal mode follows the input alone. Readline's own SIGINT hook and
  // character-level editing exist only in that mode, so deciding it from the
  // output too meant `mycli init | tee log` silently downgraded a prompt on a
  // real terminal: Ctrl-C killed the process instead of raising
  // CancelledError, and arrow keys arrived as raw escape sequences.
  const terminal = terminalOverride ?? isTTY(input);
  const reader = openLineReader({ input, output, terminal });
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  const onAbort = () => controller.abort(externalSignal?.reason);
  reader.rl.on("SIGINT", onSigint);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });

  const dispose = () => {
    reader.rl.off("SIGINT", onSigint);
    externalSignal?.removeEventListener("abort", onAbort);
    reader.close();
  };

  const cancelError = () =>
    new CancelledError(externalSignal?.aborted ? { cause: externalSignal.reason } : {});

  return { reader, signal: controller.signal, cancelError, dispose };
}

/**
 * Resolves the input stream: only an omitted `stdin` means process.stdin. A
 * `null` one has no input to read, so the prompt fails before it writes anything.
 */
function resolveInput(stdin: Readable | null | undefined, message: string): Readable {
  if (stdin === null) throw new InputEndedError(message);
  return stdin ?? process.stdin;
}

/**
 * Asks a single question. A Ctrl+C or signal abort becomes a {@link CancelledError},
 * the end of input (Ctrl+D, EOF, a destroyed stream) an {@link InputEndedError},
 * and an input I/O error is rethrown as it is.
 */
async function ask(session: CancelableReader, query: string, message: string): Promise<string> {
  const { reader, signal } = session;
  if (signal.aborted) throw session.cancelError();
  reader.prompt(query);
  let line: string | null;
  try {
    line = await reader.read(signal);
  } catch (err) {
    if (signal.aborted) throw session.cancelError();
    throw err;
  }
  if (line === null) {
    if (signal.aborted) throw session.cancelError();
    throw new InputEndedError(message);
  }
  return line;
}

// ── Text ──

/** Implements {@link PromptNamespace.text}. */
async function text(message: string, options: TextOptions = {}): Promise<string> {
  checkMessage("text", message);
  checkOptions("text", options, {
    booleans: ["trim", "required"],
    strings: ["default", "placeholder"],
  });
  const { default: defaultValue, validate, required = true, marker = "?", trim = true } = options;
  const stderr = options.stderr ?? process.stderr;
  const input = resolveInput(options.stdin, message);
  const col = createColorizer(stderr);

  const session = createCancelableReader(input, stderr, undefined, options.signal);
  const hint =
    defaultValue !== undefined
      ? col.dim(` (${renderSafe(String(defaultValue))})`)
      : options.placeholder
        ? col.dim(` (e.g. ${renderSafe(options.placeholder)})`)
        : "";

  try {
    while (true) {
      const answer = await ask(session, `${promptHeading(col, marker, message)}${hint} `, message);

      let value = trim ? answer.trim() : answer;
      // An explicit default (including an empty string) fills an empty
      // submission and bypasses the required-empty check below.
      const usedDefault = value === "" && defaultValue !== undefined;
      if (usedDefault) {
        value = String(defaultValue);
      }

      if (!usedDefault && required && value === "") {
        writeThrough(stderr, `${col.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          await validate(value);
        } catch (err) {
          writeThrough(stderr, validationLine(col, err));
          continue;
        }
      }

      return value;
    }
  } finally {
    session.dispose();
  }
}

// ── Confirm ──

/** Implements {@link PromptNamespace.confirm}. */
async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  checkMessage("confirm", message);
  checkOptions("confirm", options);
  if (options.default !== undefined && typeof options.default !== "boolean") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "default" option of prompt.confirm() must be a boolean. Received ${describeReceived(options.default)}`,
    );
  }
  const { default: defaultValue = false, marker = "?" } = options;
  const stderr = options.stderr ?? process.stderr;
  const input = resolveInput(options.stdin, message);
  const col = createColorizer(stderr);

  const session = createCancelableReader(input, stderr, undefined, options.signal);
  const hint = defaultValue ? col.dim(" (Y/n)") : col.dim(" (y/N)");

  try {
    while (true) {
      const answer = await ask(session, `${promptHeading(col, marker, message)}${hint} `, message);
      const trimmed = answer.trim().toLowerCase();
      if (trimmed !== "" && !["y", "yes", "n", "no"].includes(trimmed)) {
        writeThrough(stderr, `${col.red("✖")} Please enter yes or no\n`);
        continue;
      }
      const value = trimmed === "" ? defaultValue : trimmed === "y" || trimmed === "yes";
      if (options.validate) {
        try {
          await options.validate(value);
        } catch (err) {
          writeThrough(stderr, validationLine(col, err));
          continue;
        }
      }
      return value;
    }
  } finally {
    session.dispose();
  }
}

// ── Select ──

/** Implements {@link PromptNamespace.select}. */
async function select<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options: SelectOptions<NoInfer<T>> = {},
): Promise<T> {
  checkMessage("select", message);
  checkChoices("select", choices);
  checkOptions("select", options);
  const { marker = "?", default: defaultValue, validate } = options;
  const stderr = options.stderr ?? process.stderr;

  const normalized = normalizeChoices("select", choices);
  if (normalized.length === 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      'The "choices" argument of prompt.select() must not be empty',
    );
  }
  checkDefaultMatches("select", normalized, defaultValue);
  const defaultIndex = findDefaultIndex(normalized, defaultValue);

  const input = resolveInput(options.stdin, message);
  const col = createColorizer(stderr);
  const session = createCancelableReader(input, stderr, undefined, options.signal);

  try {
    writeThrough(stderr, `${promptHeading(col, marker, message)}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const isDefault = i === defaultIndex;
      const hint = ch.hint ? col.dim(` (${ch.hint})`) : "";
      const tag = isDefault ? col.dim(" [default]") : "";
      writeThrough(stderr, `  ${col.cyan(`${i + 1})`)} ${ch.label}${hint}${tag}\n`);
    }
    warnDuplicateLabels(normalized, stderr, col);

    const promptLabel =
      defaultIndex >= 0 ? `Enter number (default ${defaultIndex + 1}):` : "Enter number:";

    while (true) {
      const answer = await ask(session, `${col.dim(promptLabel)} `, message);
      const trimmed = answer.trim();

      let chosen: SelectChoice<T> | undefined;
      if (trimmed === "" && defaultIndex >= 0) {
        chosen = normalized[defaultIndex];
      } else {
        // An in-range number picks by index; anything else matches a label
        // case-insensitively.
        const num = Number.parseInt(trimmed, 10);
        if (/^\d+$/.test(trimmed) && num >= 1 && num <= normalized.length) {
          chosen = normalized[num - 1];
        } else {
          // Match the first choice whose label equals the input. Duplicate
          // labels resolve to the first occurrence; use the number to reach a
          // later one (a warning is shown above when duplicates exist).
          chosen = normalized.find(
            (ch) => stripAnsi(ch.label).toLowerCase() === trimmed.toLowerCase(),
          );
        }
      }

      if (!chosen) {
        writeThrough(
          stderr,
          `${col.red("✖")} Please enter a number between 1 and ${normalized.length}, or a choice label\n`,
        );
        continue;
      }

      if (validate) {
        try {
          await validate(chosen.value);
        } catch (err) {
          writeThrough(stderr, validationLine(col, err));
          continue;
        }
      }

      return chosen.value;
    }
  } finally {
    session.dispose();
  }
}

// ── Multiselect ──

/** Implements {@link PromptNamespace.multiselect}. */
async function multiselect<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options: MultiselectOptions<NoInfer<T>> = {},
): Promise<readonly T[]> {
  checkMessage("multiselect", message);
  checkChoices("multiselect", choices);
  checkOptions("multiselect", options);
  const { marker = "?", min, max, default: defaults, validate } = options;
  if (defaults !== undefined && !Array.isArray(defaults)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "default" option of prompt.multiselect() must be an array. Received ${describeReceived(defaults)}`,
    );
  }
  const stderr = options.stderr ?? process.stderr;

  const normalized = normalizeChoices("multiselect", choices);
  if (normalized.length === 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      'The "choices" argument of prompt.multiselect() must not be empty',
    );
  }
  for (const [name, value] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (value !== undefined && typeof value !== "number") {
      throw usageError(
        "type",
        "ERR_INVALID_ARG_TYPE",
        `The "${name}" option of prompt.multiselect() must be a number. Received ${describeReceived(value)}`,
      );
    }
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        `The "${name}" option of prompt.multiselect() must be a non-negative safe integer. Received ${describeReceived(value, "range")}`,
      );
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      'The "min" option of prompt.multiselect() must not exceed "max"',
    );
  }
  if (min !== undefined && min > normalized.length) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      'The "min" option of prompt.multiselect() must not exceed the number of choices',
    );
  }
  for (const d of defaults ?? []) checkDefaultMatches("multiselect", normalized, d);
  const defaultIndexes = new Set((defaults ?? []).map((d) => findDefaultIndex(normalized, d)));
  const defaultCount = defaultIndexes.size;
  if (
    defaultCount > 0 &&
    ((min !== undefined && defaultCount < min) || (max !== undefined && defaultCount > max))
  ) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "default" option of prompt.multiselect() selects ${defaultCount} distinct ${defaultCount === 1 ? "item" : "items"}, outside the min/max range. Received ${describeReceived(defaults, "range")}`,
    );
  }

  const input = resolveInput(options.stdin, message);
  const col = createColorizer(stderr);
  const session = createCancelableReader(input, stderr, undefined, options.signal);

  try {
    writeThrough(
      stderr,
      `${promptHeading(col, marker, message)} ${col.dim("(comma-separated numbers)")}\n`,
    );
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const hint = ch.hint ? col.dim(` (${ch.hint})`) : "";
      const tag = defaultIndexes.has(i) ? col.dim(" [default]") : "";
      writeThrough(stderr, `  ${col.cyan(`${i + 1})`)} ${ch.label}${hint}${tag}\n`);
    }
    warnDuplicateLabels(normalized, stderr, col);

    while (true) {
      const answer = await ask(session, `${col.dim("Enter numbers:")} `, message);
      const trimmed = answer.trim();

      // Deduplicate selected indices so min/max count distinct items.
      let indices: number[];
      let numericInputValid = true;
      if (trimmed === "") {
        indices = [...defaultIndexes].sort((x, y) => x - y);
      } else {
        const tokens = trimmed.split(",").map((s) => s.trim());
        numericInputValid = tokens.every((token) => /^\d+$/.test(token));
        const nums = numericInputValid ? tokens.map((token) => Number.parseInt(token, 10)) : [];
        indices = [...new Set(nums.map((n) => n - 1))];
      }

      const valid = numericInputValid && indices.every((i) => i >= 0 && i < normalized.length);
      if (!valid) {
        writeThrough(
          stderr,
          `${col.red("✖")} Please enter valid numbers between 1 and ${normalized.length}\n`,
        );
        continue;
      }

      if (min !== undefined && indices.length < min) {
        writeThrough(
          stderr,
          `${col.red("✖")} Select at least ${min} ${min === 1 ? "item" : "items"}\n`,
        );
        continue;
      }

      if (max !== undefined && indices.length > max) {
        writeThrough(
          stderr,
          `${col.red("✖")} Select at most ${max} ${max === 1 ? "item" : "items"}\n`,
        );
        continue;
      }

      const values = indices.map((i) => normalized[i].value);

      if (validate) {
        try {
          await validate(values);
        } catch (err) {
          writeThrough(stderr, validationLine(col, err));
          continue;
        }
      }

      return values;
    }
  } finally {
    session.dispose();
  }
}

// ── Password ──

/**
 * Masks a chunk of readline echo output: ANSI escape sequences and line breaks
 * pass through unchanged, while every other run of visible characters is
 * replaced with one asterisk per grapheme. A wide or multi-code-point grapheme
 * (e.g. an emoji with a skin-tone modifier) is still masked with one asterisk,
 * so the masked output does not reveal its display width or scalar count.
 *
 * @param chunk - The raw output chunk readline is about to echo.
 * @returns The masked chunk.
 */
export function maskInput(chunk: string): string {
  let result = "";

  // Reuse the shared ANSI recognizer so every escape sequence — CSI cursor/erase
  // codes as well as OSC sequences (ESC ] ... BEL) — passes through verbatim and
  // only visible text is masked.
  for (const segment of splitAnsi(chunk)) {
    if (segment.ansi) {
      result += segment.text;
      continue;
    }

    // Within a plain-text run, mask each visible grapheme with one asterisk,
    // while passing line breaks through unchanged.
    let visible = "";
    const flushVisible = () => {
      if (visible !== "") {
        result += "*".repeat(splitGraphemes(visible).length);
        visible = "";
      }
    };
    for (const ch of segment.text) {
      if (ch === "\r" || ch === "\n") {
        flushVisible();
        result += ch;
      } else {
        visible += ch;
      }
    }
    flushVisible();
  }

  return result;
}

/** Implements {@link PromptNamespace.password}. */
async function password(message: string, options: PasswordOptions = {}): Promise<string> {
  checkMessage("password", message);
  checkOptions("password", options, { booleans: ["trim", "required"] });
  const { validate, required = true, marker = "?", trim = false } = options;
  const stdin = resolveInput(options.stdin, message);
  const stdinIsTTY = isTTY(stdin);
  const promptOutput = options.stderr ?? process.stderr;
  const col = createColorizer(promptOutput);

  // Masking is scoped to this prompt: readline echoes to a private wrapper
  // stream that masks visible characters and forwards everything to the real
  // stderr. The shared stream's own `write` is never replaced, so concurrent
  // spinner/logger output is untouched and re-entrant prompts cannot corrupt it.
  let masking = false;
  // The exact (colored) prompt string readline echoes. Kept for the whole prompt
  // lifetime — not just the first render — so that when readline redraws the line
  // on backspace/arrow keys (rewriting the prompt label plus the input in one
  // chunk), the label is passed through unmasked and only the typed value after
  // it is masked. Previously the label was masked into asterisks on every redraw.
  let promptQuery = "";
  let promptRendered = false;
  // Readline sends the escape sequences that reposition the cursor in a write()
  // of their own, then rewrites the label and the line in the next one. Without
  // remembering that the first chunk arrived, the second looks untrustworthy and
  // the label is masked into asterisks on every backspace, arrow key, wrap and
  // validation retry.
  let refreshing = false;
  const maskingOutput = new Writable({
    write(chunk: string | Buffer, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      if (!masking) {
        promptOutput.write(text);
        callback();
        return;
      }
      const hasVisibleText = (value: string) =>
        splitAnsi(value).some(
          (segment) =>
            !segment.ansi &&
            [...segment.text].some(
              (character) => !isControlCode(character.codePointAt(0) as number),
            ),
        );

      // A chunk with nothing visible in it is readline preparing to redraw, so
      // the label that arrives next is still the one we rendered. Masking it is
      // a no-op (escapes and line breaks pass through) but the flag matters.
      if (!hasVisibleText(text)) {
        refreshing = true;
        promptOutput.write(maskInput(text));
        callback();
        return;
      }

      // If this chunk carries the prompt label, everything up to and including it
      // is passed through verbatim; only the user's input after it is masked.
      const idx = promptQuery ? text.indexOf(promptQuery) : -1;
      const prefix = idx === -1 ? "" : text.slice(0, idx);
      const prefixHasVisibleText = hasVisibleText(prefix);
      const prefixHasTerminalEscape = splitAnsi(prefix).some((segment) => segment.ansi);
      const trustedPrompt =
        idx !== -1 &&
        !prefixHasVisibleText &&
        (!promptRendered || prefixHasTerminalEscape || refreshing);
      refreshing = false;
      if (trustedPrompt) {
        const boundary = idx + promptQuery.length;
        promptRendered = true;
        promptOutput.write(text.slice(0, boundary) + maskInput(text.slice(boundary)));
      } else {
        promptOutput.write(maskInput(text));
      }
      callback();
    },
  });
  // Mirror TTY status/size so readline keeps terminal echo behavior.
  const ttyPromptOutput = promptOutput as Partial<NodeJS.WriteStream>;
  (maskingOutput as unknown as Record<string, unknown>).isTTY = stdinIsTTY;
  (maskingOutput as unknown as Record<string, unknown>).columns = ttyPromptOutput.columns ?? 80;
  (maskingOutput as unknown as Record<string, unknown>).rows = ttyPromptOutput.rows ?? 24;

  const session = createCancelableReader(stdin, maskingOutput, stdinIsTTY, options.signal);

  try {
    while (true) {
      const query = `${promptHeading(col, marker, message)} `;
      masking = true;
      promptQuery = query;
      promptRendered = false;

      let answer: string;
      try {
        answer = await ask(session, query, message);
      } finally {
        masking = false;
        promptQuery = "";
        promptRendered = false;
      }

      const value = trim ? answer.trim() : answer;

      if (required && value === "") {
        writeThrough(promptOutput, `${col.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          await validate(value);
        } catch (err) {
          writeThrough(promptOutput, validationLine(col, err));
          continue;
        }
      }

      return value;
    }
  } finally {
    masking = false;
    session.dispose();
  }
}

// ── Public API ──

/** The members of {@link prompt}; the documentation here is what a consumer sees on hover. */
interface PromptNamespace {
  /**
   * Prompts the user for a line of text. An empty answer takes `default` when one
   * is set, otherwise it is refused while `required` is true; a `validate` that
   * throws shows its message and asks again.
   *
   * @param message - The question, rendered on one line (a newline becomes a space and cursor control is removed).
   * @param options - Text prompt options.
   * @returns The entered text value.
   * @throws {CancelledError} If the user presses Ctrl-C or `options.signal` aborts; `cause` is the signal's reason.
   * @throws {InputEndedError} If `options.stdin` is `null`, or the input ends before an answer (also while re-asking).
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if an argument or option has the wrong type; nothing is written first.
   * @throws {Error} `ERR_INPUT_BUSY` if another prompt is already reading from the same input stream.
   * An input I/O error rejects with the stream's own error, unwrapped.
   * @example
   * ```ts
   * const name = await prompt.text("Project name", { ...ctx, default: "app" });
   * ```
   */
  text(message: string, options?: TextOptions): Promise<string>;

  /**
   * Prompts the user for a yes/no confirmation. Accepts `y`, `yes`, `n` and `no`
   * in any case; an empty answer takes `default` (false unless set).
   *
   * @param message - The question, rendered on one line (a newline becomes a space and cursor control is removed).
   * @param options - Confirmation prompt options.
   * @returns True if the user confirmed, false otherwise.
   * @throws {CancelledError} If the user presses Ctrl-C or `options.signal` aborts; `cause` is the signal's reason.
   * @throws {InputEndedError} If `options.stdin` is `null`, or the input ends before an answer (also while re-asking).
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if an argument or option has the wrong type; nothing is written first.
   * @throws {Error} `ERR_INPUT_BUSY` if another prompt is already reading from the same input stream.
   * An input I/O error rejects with the stream's own error, unwrapped.
   * @example
   * ```ts
   * if (!(await prompt.confirm("Deploy to production?", ctx))) return;
   * ```
   */
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;

  /**
   * Prompts the user to select a single item from a list of choices.
   *
   * Users may enter a number or a matching label to make their selection.
   * Pressing Enter with no input selects the configured default, if any.
   *
   * @param message - The question, rendered on one line (a newline becomes a space and cursor control is removed).
   * @param choices - Available choices: raw values, or `{ label, value, hint? }` descriptors.
   *   A value object that has a `label` member must be wrapped in a descriptor.
   * @param options - Prompt options. `default` must equal the value of one choice.
   * @returns The value of the selected choice.
   * @throws {CancelledError} If the user presses Ctrl-C or `options.signal` aborts; `cause` is the signal's reason.
   * @throws {InputEndedError} If `options.stdin` is `null`, or the input ends before an answer (also while re-asking).
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` if `choices` is empty or `default` matches no choice; nothing is written first.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if an argument or option has the wrong type; nothing is written first.
   * @throws {Error} `ERR_INPUT_BUSY` if another prompt is already reading from the same input stream.
   * An input I/O error rejects with the stream's own error, unwrapped.
   * @example
   * ```ts
   * const env = await prompt.select("Environment", ["dev", "staging", "prod"], {
   *   ...ctx,
   *   default: "dev",
   * });
   * ```
   */
  select<const T = string>(
    message: string,
    choices: readonly Choice<T>[],
    options?: SelectOptions<NoInfer<T>>,
  ): Promise<T>;

  /**
   * Prompts the user to select one or more items from a list of choices.
   *
   * Users enter comma-separated numbers to select items. Pressing Enter with no
   * input accepts the configured defaults, if any.
   *
   * @param message - The question, rendered on one line (a newline becomes a space and cursor control is removed).
   * @param choices - Available choices: raw values, or `{ label, value, hint? }` descriptors.
   *   A value object that has a `label` member must be wrapped in a descriptor.
   * @param options - Multiselect prompt options. Each `default` element must equal the value of one choice.
   * @returns The selected values, in the order of the numbers entered.
   * @throws {CancelledError} If the user presses Ctrl-C or `options.signal` aborts; `cause` is the signal's reason.
   * @throws {InputEndedError} If `options.stdin` is `null`, or the input ends before an answer (also while re-asking).
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` if `choices` is empty, a `default` element matches no choice, or `min`/`max` is out of range; nothing is written first.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if an argument or option has the wrong type; nothing is written first.
   * @throws {Error} `ERR_INPUT_BUSY` if another prompt is already reading from the same input stream.
   * An input I/O error rejects with the stream's own error, unwrapped.
   * @example
   * ```ts
   * const features = await prompt.multiselect("Features", ["lint", "test", "docs"], {
   *   ...ctx,
   *   min: 1,
   * });
   * ```
   */
  multiselect<const T = string>(
    message: string,
    choices: readonly Choice<T>[],
    options?: MultiselectOptions<NoInfer<T>>,
  ): Promise<readonly T[]>;

  /**
   * Prompts the user for a password with masked input.
   *
   * Characters are replaced with asterisks as they are typed (on TTY streams).
   * Passwords have no default and are not trimmed unless `trim` is set.
   *
   * @param message - The question, rendered on one line (a newline becomes a space and cursor control is removed).
   * @param options - Prompt options.
   * @returns The entered password string.
   * @throws {CancelledError} If the user presses Ctrl-C or `options.signal` aborts; `cause` is the signal's reason.
   * @throws {InputEndedError} If `options.stdin` is `null`, or the input ends before an answer (also while re-asking).
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if an argument or option has the wrong type; nothing is written first.
   * @throws {Error} `ERR_INPUT_BUSY` if another prompt is already reading from the same input stream.
   * An input I/O error rejects with the stream's own error, unwrapped.
   * @example
   * ```ts
   * const token = await prompt.password("API token", ctx);
   * ```
   */
  password(message: string, options?: PasswordOptions): Promise<string>;
}

/**
 * Interactive prompt utilities for CLI applications.
 *
 * Provides functions for text input, confirmation, single/multi selection,
 * and password entry with masked input. Questions are written to `stderr`, so
 * a command context can be passed as the options object.
 */
export const prompt: PromptNamespace = {
  text,
  confirm,
  select,
  multiselect,
  password,
};

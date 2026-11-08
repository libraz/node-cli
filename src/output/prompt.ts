import { type Readable, Writable } from "node:stream";
import { CancelledError, usageError } from "../errors.js";
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
  /** Validation function; throw (or reject) to refuse the value and ask again. */
  validate?: (value: T) => void | Promise<void>;
  /** Symbol displayed before the question. Defaults to "?". */
  marker?: string;
};

/**
 * Options for a text input prompt.
 */
export interface TextOptions extends PromptOptions<string> {
  /** Default text value. */
  default?: string;
  /** Example text shown after the question as `(e.g. …)`; ignored when `default` is set. */
  placeholder?: string;
  /** Whether to trim leading/trailing whitespace. Defaults to true. */
  trim?: boolean;
  /** Whether a non-empty value is required. Defaults to true. */
  required?: boolean;
}

/**
 * Options for a yes/no confirmation prompt.
 */
export interface ConfirmOptions extends PromptOptions<boolean> {
  /** Default boolean value. Defaults to false. */
  default?: boolean;
}

/**
 * Represents a single selectable choice with a display label and underlying value.
 */
export interface SelectChoice<T> {
  /** Display label shown to the user. */
  label: string;
  /** Value returned when this choice is selected. */
  value: T;
  /** Optional hint text displayed alongside the label. */
  hint?: string;
}

/**
 * Options for a single-select prompt.
 */
export interface SelectOptions<T> extends PromptOptions<T> {
  /** Default selected value, returned when the user presses Enter with no input. */
  default?: T;
}

/**
 * Options for a multiselect prompt.
 */
export interface MultiselectOptions<T> extends PromptOptions<T[]> {
  /** Pre-selected default values. */
  default?: readonly T[];
  /** Minimum number of items that must be selected. */
  min?: number;
  /** Maximum number of items that may be selected. */
  max?: number;
}

/** Options for a password prompt. Passwords intentionally have no default value. */
export interface PasswordOptions extends PromptOptions<string> {
  /** Whether to trim leading/trailing whitespace. Defaults to false. */
  trim?: boolean;
  /** Whether a non-empty value is required. Defaults to true. */
  required?: boolean;
}

/**
 * A choice can be either a raw value or a descriptor object that has both
 * `label` and `value`. Objects with only a `label` are rejected at runtime so
 * ordinary domain objects are never silently converted to `undefined`.
 */
export type Choice<T> = T | SelectChoice<T>;

// ── Helpers ──

/**
 * Normalizes an array of raw values or SelectChoice objects into a uniform SelectChoice array.
 *
 * @param choices - Array of choices to normalize.
 * @returns Normalized array of SelectChoice objects.
 */
function normalizeChoices<T>(choices: readonly Choice<T>[]): SelectChoice<T>[] {
  return choices.map((ch) => {
    if (typeof ch === "object" && ch !== null && "label" in (ch as Record<string, unknown>)) {
      if (!("value" in (ch as Record<string, unknown>))) {
        throw usageError(
          "type",
          "ERR_INVALID_ARG_TYPE",
          "Choice descriptors must include both label and value",
        );
      }
      const choice = ch as SelectChoice<T>;
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
 * @param stdin - Input stream. Defaults to process.stdin when null or undefined.
 * @param stderr - Output stream. Defaults to process.stderr.
 * @returns The reader, an abort signal, and teardown.
 */
function createCancelableReader(
  stdin?: Readable | null,
  stderr?: Writable,
  terminalOverride?: boolean,
  externalSignal?: AbortSignal,
): CancelableReader {
  const input = stdin ?? process.stdin;
  const output = stderr ?? process.stderr;
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
 * Asks a single question, translating a Ctrl+C abort, the end of input (Ctrl+D,
 * EOF, a destroyed stream) or an input error into a {@link CancelledError}.
 */
async function ask(session: CancelableReader, query: string): Promise<string> {
  const { reader, signal } = session;
  if (signal.aborted) throw session.cancelError();
  reader.prompt(query);
  let line: string | null;
  try {
    line = await reader.read(signal);
  } catch {
    throw session.cancelError();
  }
  if (line === null) throw session.cancelError();
  return line;
}

// ── Text ──

/**
 * Prompts the user for text input.
 *
 * @param message - The question to display.
 * @param options - Text prompt options.
 * @returns The entered text value.
 * @throws CancelledError if the user cancels (e.g., Ctrl+C).
 */
async function text(message: string, options: TextOptions = {}): Promise<string> {
  const { default: defaultValue, validate, required = true, marker = "?", trim = true } = options;
  const stderr = options.stderr ?? process.stderr;
  const col = createColorizer(stderr);

  const session = createCancelableReader(options.stdin, stderr, undefined, options.signal);
  const hint =
    defaultValue !== undefined
      ? col.dim(` (${renderSafe(String(defaultValue))})`)
      : options.placeholder
        ? col.dim(` (e.g. ${renderSafe(options.placeholder)})`)
        : "";

  try {
    while (true) {
      const answer = await ask(session, `${promptHeading(col, marker, message)}${hint} `);

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

/**
 * Prompts the user for a yes/no confirmation.
 *
 * @param message - The question to display.
 * @param options - Confirmation prompt options.
 * @returns True if the user confirmed, false otherwise.
 * @throws CancelledError if the user cancels.
 */
async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { default: defaultValue = false, marker = "?" } = options;
  const stderr = options.stderr ?? process.stderr;
  const col = createColorizer(stderr);

  const session = createCancelableReader(options.stdin, stderr, undefined, options.signal);
  const hint = defaultValue ? col.dim(" (Y/n)") : col.dim(" (y/N)");

  try {
    while (true) {
      const answer = await ask(session, `${promptHeading(col, marker, message)}${hint} `);
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

/**
 * Prompts the user to select a single item from a list of choices.
 *
 * Users may enter a number or a matching label to make their selection.
 * Pressing Enter with no input selects the configured default, if any.
 *
 * @param message - The question to display.
 * @param choices - Available choices.
 * @param options - Prompt options.
 * @returns The value of the selected choice.
 * @throws CancelledError if the user cancels.
 */
async function select<T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options: SelectOptions<T> = {},
): Promise<T> {
  const { marker = "?", default: defaultValue, validate } = options;
  const stderr = options.stderr ?? process.stderr;
  const col = createColorizer(stderr);

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw usageError("range", "ERR_INVALID_ARG_VALUE", "select() requires at least one choice");
  }
  const defaultIndex = findDefaultIndex(normalized, defaultValue);

  const session = createCancelableReader(options.stdin, stderr, undefined, options.signal);

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
      const answer = await ask(session, `${col.dim(promptLabel)} `);
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
          `${col.red("✖")} Please enter a number between 1 and ${normalized.length}\n`,
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

/**
 * Prompts the user to select one or more items from a list of choices.
 *
 * Users enter comma-separated numbers to select items. Pressing Enter with no
 * input accepts the configured defaults, if any.
 *
 * @param message - The question to display.
 * @param choices - Available choices.
 * @param options - Multiselect prompt options (default/min/max constraints).
 * @returns An array of selected values.
 * @throws CancelledError if the user cancels.
 */
async function multiselect<T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options: MultiselectOptions<T> = {},
): Promise<T[]> {
  const { marker = "?", min, max, default: defaults, validate } = options;
  const stderr = options.stderr ?? process.stderr;
  const col = createColorizer(stderr);

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      "multiselect() requires at least one choice",
    );
  }
  for (const [name, value] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        `multiselect() ${name} must be a non-negative safe integer`,
      );
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw usageError("range", "ERR_INVALID_ARG_VALUE", "multiselect() min cannot exceed max");
  }
  if (min !== undefined && min > normalized.length) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      "multiselect() min cannot exceed the number of choices",
    );
  }
  const defaultIndexes = new Set(
    (defaults ?? []).map((d) => findDefaultIndex(normalized, d)).filter((i) => i >= 0),
  );

  const session = createCancelableReader(options.stdin, stderr, undefined, options.signal);

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
      const answer = await ask(session, `${col.dim("Enter numbers:")} `);
      const trimmed = answer.trim();

      // Deduplicate selected indices so min/max count distinct items.
      let indices: number[];
      let numericInputValid = true;
      if (trimmed === "") {
        indices = [...defaultIndexes];
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
        writeThrough(stderr, `${col.red("✖")} Select at least ${min} items\n`);
        continue;
      }

      if (max !== undefined && indices.length > max) {
        writeThrough(stderr, `${col.red("✖")} Select at most ${max} items\n`);
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

/**
 * Prompts the user for a password with masked input.
 *
 * Characters are replaced with asterisks as they are typed (on TTY streams).
 *
 * @param message - The question to display.
 * @param options - Prompt options.
 * @returns The entered password string.
 * @throws CancelledError if the user cancels.
 */
async function password(message: string, options: PasswordOptions = {}): Promise<string> {
  const { validate, required = true, marker = "?", trim = false } = options;
  const stdin = options.stdin ?? process.stdin;
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
        answer = await ask(session, query);
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

/**
 * Interactive prompt utilities for CLI applications.
 *
 * Provides functions for text input, confirmation, single/multi selection,
 * and password entry with masked input.
 */
export const prompt = {
  /** Prompts for free-form text input. */
  text,
  /** Prompts for a yes/no confirmation. */
  confirm,
  /** Prompts the user to select one item from a list. */
  select,
  /** Prompts the user to select multiple items from a list. */
  multiselect,
  /** Prompts for password input with character masking. */
  password,
};

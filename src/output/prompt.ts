import { createInterface, type Interface } from "node:readline/promises";
import { type Readable, Writable } from "node:stream";
import { PromptCancelError } from "../errors.js";
import {
  type color as c,
  createColorizer,
  sanitizeTerminalText,
  splitAnsi,
  splitGraphemes,
  streamIsTTY,
} from "./color.js";

// ── Types ──

/**
 * Base options shared by all prompt types.
 */
export interface PromptBaseOptions<T = unknown> {
  /** Validation function; throw an Error to reject the value. */
  validate?: (value: T) => void;
  /** Whether a non-empty value is required. Defaults to true for text/password prompts. */
  required?: boolean;
  /** Prefix symbol displayed before the prompt message. Defaults to "?". */
  prefix?: string;
  /** Writable stream for output. Defaults to process.stdout. */
  stdout?: Writable;
  /** Writable stream for interactive prompts when stdout is redirected. Defaults to process.stderr. */
  stderr?: Writable;
  /** Readable stream for input. Defaults to process.stdin. */
  stdin?: Readable;
  /** Cancels the pending prompt when aborted. */
  signal?: AbortSignal;
}

/**
 * Options for a text input prompt.
 */
export interface TextOptions extends PromptBaseOptions<string> {
  /** Default text value. */
  default?: string;
  /** Placeholder text displayed as a hint. */
  placeholder?: string;
  /** Whether to trim leading/trailing whitespace. Defaults to true. */
  trim?: boolean;
}

/**
 * Options for a yes/no confirmation prompt.
 */
export interface ConfirmOptions extends PromptBaseOptions<boolean> {
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
export interface SelectOptions<T> extends PromptBaseOptions<T> {
  /** Default selected value, returned when the user presses Enter with no input. */
  default?: T;
}

/**
 * Options for a multiselect prompt.
 */
export interface MultiselectOptions<T> extends PromptBaseOptions<T[]> {
  /** Pre-selected default values. */
  default?: T[];
  /** Minimum number of items that must be selected. */
  min?: number;
  /** Maximum number of items that may be selected. */
  max?: number;
}

/** Options for a password prompt. Passwords intentionally have no default value. */
export interface PasswordOptions extends PromptBaseOptions<string> {
  /** Whether to trim leading/trailing whitespace. Defaults to false. */
  trim?: boolean;
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
function normalizeChoices<T>(choices: Choice<T>[]): SelectChoice<T>[] {
  return choices.map((ch) => {
    if (typeof ch === "object" && ch !== null && "label" in (ch as Record<string, unknown>)) {
      if (!("value" in (ch as Record<string, unknown>))) {
        throw new TypeError("Choice descriptors must include both label and value");
      }
      const choice = ch as SelectChoice<T>;
      return {
        ...choice,
        label: sanitizeTerminalText(choice.label),
        hint: choice.hint === undefined ? undefined : sanitizeTerminalText(choice.hint),
      };
    }
    return { label: sanitizeTerminalText(String(ch)), value: ch as T };
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
 * @param stdout - Stream the warning is written to.
 */
function warnDuplicateLabels<T>(
  normalized: SelectChoice<T>[],
  stdout: Writable,
  col: typeof c,
): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ch of normalized) {
    if (seen.has(ch.label)) duplicates.add(ch.label);
    seen.add(ch.label);
  }
  for (const label of duplicates) {
    stdout.write(`${col.yellow("!")} Duplicate label "${label}"; select it by its number\n`);
  }
}

/**
 * A cancelable readline session: the interface, a cancellation signal that is
 * aborted on Ctrl+C (SIGINT), and a flag/promise tracking end-of-input (EOF,
 * Ctrl+D) so a pending or future question can reject rather than hang.
 */
interface CancelableRl {
  rl: Interface;
  signal: AbortSignal;
  /** Whether the input stream has ended (EOF / Ctrl+D). */
  isClosed: () => boolean;
  dispose: () => void;
}

const activePromptInputs = new WeakSet<Readable>();

/**
 * Creates a readline interface plus a cancellation signal that is aborted when
 * the user presses Ctrl+C (SIGINT). Callers pass `signal` to `rl.question` so a
 * cancellation rejects the pending question rather than hanging. The interface's
 * `close` event (EOF / Ctrl+D) is tracked so questions reject instead of hanging
 * when input ends without a submitted line.
 *
 * @param stdin - Input stream. Defaults to process.stdin.
 * @param stdout - Output stream. Defaults to process.stdout.
 * @returns The readline interface, an abort signal, a closed flag, and teardown.
 */
function createCancelableRl(
  stdin?: Readable,
  stdout?: Writable,
  terminalOverride?: boolean,
  externalSignal?: AbortSignal,
): CancelableRl {
  const input = stdin ?? process.stdin;
  if (activePromptInputs.has(input)) {
    throw new Error("Another prompt is already reading from this input stream");
  }
  activePromptInputs.add(input);
  const output = stdout ?? process.stdout;
  const terminal = terminalOverride ?? (streamIsTTY(input) && streamIsTTY(output));
  const rl = createInterface({
    input,
    output,
    terminal,
  });
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  const onAbort = () => controller.abort(externalSignal?.reason);
  rl.on("SIGINT", onSigint);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener("abort", onAbort, { once: true });

  let closed = false;
  const onClose = () => {
    closed = true;
  };
  rl.on("close", onClose);

  const dispose = () => {
    rl.off("SIGINT", onSigint);
    rl.off("close", onClose);
    externalSignal?.removeEventListener("abort", onAbort);
    activePromptInputs.delete(input);
    rl.close();
  };

  return { rl, signal: controller.signal, isClosed: () => closed, dispose };
}

/**
 * Asks a single readline question, translating a Ctrl+C abort or an EOF
 * (Ctrl+D, end of input) into a {@link PromptCancelError}. The question is raced
 * against the interface's `close` event so an EOF that arrives while the
 * question is pending settles the promise instead of hanging forever.
 */
async function ask(
  rl: Interface,
  query: string,
  signal: AbortSignal,
  isClosed: () => boolean,
): Promise<string> {
  if (isClosed()) {
    throw new PromptCancelError();
  }
  const closeMarker = Symbol("rl-closed");
  const onClose = (resolve: (value: typeof closeMarker) => void) => () => resolve(closeMarker);
  let resolveClose: (() => void) | undefined;
  const closed = new Promise<typeof closeMarker>((resolve) => {
    const handler = onClose(resolve);
    rl.once("close", handler);
    resolveClose = () => rl.off("close", handler);
  });

  try {
    const result = await Promise.race([rl.question(query, { signal }), closed]);
    if (result === closeMarker) {
      throw new PromptCancelError();
    }
    return result;
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new PromptCancelError();
    }
    throw err;
  } finally {
    resolveClose?.();
  }
}

// ── Text ──

/**
 * Prompts the user for text input.
 *
 * @param message - The question to display.
 * @param options - Text prompt options.
 * @returns The entered text value.
 * @throws PromptCancelError if the user cancels (e.g., Ctrl+C).
 */
async function text(message: string, options: TextOptions = {}): Promise<string> {
  const { default: defaultValue, validate, required = true, prefix = "?", trim = true } = options;
  const stdout = options.stdout ?? process.stdout;
  const col = createColorizer(stdout);

  const { rl, signal, isClosed, dispose } = createCancelableRl(
    options.stdin,
    stdout,
    undefined,
    options.signal,
  );
  const hint =
    defaultValue !== undefined
      ? col.dim(` (${defaultValue})`)
      : options.placeholder
        ? col.dim(` (${options.placeholder})`)
        : "";

  try {
    while (true) {
      const answer = await ask(
        rl,
        `${col.green(prefix)} ${col.bold(message)}${hint} `,
        signal,
        isClosed,
      );

      let value = trim ? answer.trim() : answer;
      // An explicit default (including an empty string) fills an empty
      // submission and bypasses the required-empty check below.
      const usedDefault = value === "" && defaultValue !== undefined;
      if (usedDefault) {
        value = String(defaultValue);
      }

      if (!usedDefault && required && value === "") {
        stdout.write(`${col.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          validate(value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${col.red("✖")} ${msg}\n`);
          continue;
        }
      }

      return value;
    }
  } finally {
    dispose();
  }
}

// ── Confirm ──

/**
 * Prompts the user for a yes/no confirmation.
 *
 * @param message - The question to display.
 * @param options - Confirmation prompt options.
 * @returns True if the user confirmed, false otherwise.
 * @throws PromptCancelError if the user cancels.
 */
async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { default: defaultValue = false, prefix = "?" } = options;
  const stdout = options.stdout ?? process.stdout;
  const col = createColorizer(stdout);

  const { rl, signal, isClosed, dispose } = createCancelableRl(
    options.stdin,
    stdout,
    undefined,
    options.signal,
  );
  const hint = defaultValue ? col.dim(" (Y/n)") : col.dim(" (y/N)");

  try {
    while (true) {
      const answer = await ask(
        rl,
        `${col.green(prefix)} ${col.bold(message)}${hint} `,
        signal,
        isClosed,
      );
      const trimmed = answer.trim().toLowerCase();
      if (trimmed !== "" && !["y", "yes", "n", "no"].includes(trimmed)) {
        stdout.write(`${col.red("✖")} Please enter yes or no\n`);
        continue;
      }
      const value = trimmed === "" ? defaultValue : trimmed === "y" || trimmed === "yes";
      if (options.validate) {
        try {
          options.validate(value);
        } catch (err) {
          const validationMessage = err instanceof Error ? err.message : String(err);
          stdout.write(`${col.red("✖")} ${validationMessage}\n`);
          continue;
        }
      }
      return value;
    }
  } finally {
    dispose();
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
 * @throws PromptCancelError if the user cancels.
 */
async function select<T = string>(
  message: string,
  choices: Choice<T>[],
  options: SelectOptions<T> = {},
): Promise<T> {
  const { prefix = "?", default: defaultValue, validate } = options;
  const stdout = options.stdout ?? process.stdout;
  const col = createColorizer(stdout);

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw new Error("select() requires at least one choice");
  }
  const defaultIndex = findDefaultIndex(normalized, defaultValue);

  const { rl, signal, isClosed, dispose } = createCancelableRl(
    options.stdin,
    stdout,
    undefined,
    options.signal,
  );

  try {
    stdout.write(`${col.green(prefix)} ${col.bold(message)}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const isDefault = i === defaultIndex;
      const hint = ch.hint ? col.dim(` (${ch.hint})`) : "";
      const marker = isDefault ? col.dim(" [default]") : "";
      stdout.write(`  ${col.cyan(`${i + 1})`)} ${ch.label}${hint}${marker}\n`);
    }
    warnDuplicateLabels(normalized, stdout, col);

    const promptLabel =
      defaultIndex >= 0 ? `Enter number (default ${defaultIndex + 1}):` : "Enter number:";

    while (true) {
      const answer = await ask(rl, `${col.dim(promptLabel)} `, signal, isClosed);
      const trimmed = answer.trim();

      let chosen: SelectChoice<T> | undefined;
      if (trimmed === "" && defaultIndex >= 0) {
        chosen = normalized[defaultIndex];
      } else {
        // Number entry is the canonical selector; a numeric input always picks
        // by index, so numeric-looking labels remain reachable by their number.
        const num = Number.parseInt(trimmed, 10);
        if (/^\d+$/.test(trimmed) && num >= 1 && num <= normalized.length) {
          chosen = normalized[num - 1];
        } else {
          // Match the first choice whose label equals the input. Duplicate
          // labels resolve to the first occurrence; use the number to reach a
          // later one (a warning is shown above when duplicates exist).
          chosen = normalized.find((ch) => ch.label.toLowerCase() === trimmed.toLowerCase());
        }
      }

      if (!chosen) {
        stdout.write(`${col.red("✖")} Please enter a number between 1 and ${normalized.length}\n`);
        continue;
      }

      if (validate) {
        try {
          validate(chosen.value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${col.red("✖")} ${msg}\n`);
          continue;
        }
      }

      return chosen.value;
    }
  } finally {
    dispose();
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
 * @throws PromptCancelError if the user cancels.
 */
async function multiselect<T = string>(
  message: string,
  choices: Choice<T>[],
  options: MultiselectOptions<T> = {},
): Promise<T[]> {
  const { prefix = "?", min, max, default: defaults, validate } = options;
  const stdout = options.stdout ?? process.stdout;
  const col = createColorizer(stdout);

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw new Error("multiselect() requires at least one choice");
  }
  for (const [name, value] of [
    ["min", min],
    ["max", max],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError(`multiselect() ${name} must be a non-negative safe integer`);
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new RangeError("multiselect() min cannot exceed max");
  }
  if (min !== undefined && min > normalized.length) {
    throw new RangeError("multiselect() min cannot exceed the number of choices");
  }
  const defaultIndexes = new Set(
    (defaults ?? []).map((d) => findDefaultIndex(normalized, d)).filter((i) => i >= 0),
  );

  const { rl, signal, isClosed, dispose } = createCancelableRl(
    options.stdin,
    stdout,
    undefined,
    options.signal,
  );

  try {
    stdout.write(
      `${col.green(prefix)} ${col.bold(message)} ${col.dim("(comma-separated numbers)")}\n`,
    );
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const marker = defaultIndexes.has(i) ? col.dim(" [default]") : "";
      stdout.write(`  ${col.cyan(`${i + 1})`)} ${ch.label}${marker}\n`);
    }
    warnDuplicateLabels(normalized, stdout, col);

    while (true) {
      const answer = await ask(rl, `${col.dim("Enter numbers:")} `, signal, isClosed);
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
        stdout.write(
          `${col.red("✖")} Please enter valid numbers between 1 and ${normalized.length}\n`,
        );
        continue;
      }

      if (min !== undefined && indices.length < min) {
        stdout.write(`${col.red("✖")} Select at least ${min} items\n`);
        continue;
      }

      if (max !== undefined && indices.length > max) {
        stdout.write(`${col.red("✖")} Select at most ${max} items\n`);
        continue;
      }

      const values = indices.map((i) => normalized[i].value);

      if (validate) {
        try {
          validate(values);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${col.red("✖")} ${msg}\n`);
          continue;
        }
      }

      return values;
    }
  } finally {
    dispose();
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
 * @throws PromptCancelError if the user cancels.
 */
async function password(message: string, options: PasswordOptions = {}): Promise<string> {
  const { validate, required = true, prefix = "?", trim = false } = options;
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const stdinIsTTY = streamIsTTY(stdin);
  const stdoutIsTTY = streamIsTTY(stdout);
  // A password prompt must keep using raw mode when its input is a terminal,
  // even when command output is redirected. Send the prompt to stderr in that
  // case so stdout remains suitable for machine-readable output and logs.
  const promptOutput = stdinIsTTY && !stdoutIsTTY ? (options.stderr ?? process.stderr) : stdout;
  const col = createColorizer(promptOutput);

  // Masking is scoped to this prompt: readline echoes to a private wrapper
  // stream that masks visible characters and forwards everything to the real
  // stdout. The shared stdout's own `write` is never replaced, so concurrent
  // spinner/logger output is untouched and re-entrant prompts cannot corrupt it.
  let masking = false;
  // The exact (colored) prompt string readline echoes. Kept for the whole prompt
  // lifetime — not just the first render — so that when readline redraws the line
  // on backspace/arrow keys (rewriting the prompt label plus the input in one
  // chunk), the label is passed through unmasked and only the typed value after
  // it is masked. Previously the label was masked into asterisks on every redraw.
  let promptQuery = "";
  let promptRendered = false;
  const maskingOutput = new Writable({
    write(chunk: string | Buffer, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      if (!masking) {
        promptOutput.write(text);
        callback();
        return;
      }
      // If this chunk carries the prompt label, everything up to and including it
      // is passed through verbatim; only the user's input after it is masked.
      const idx = promptQuery ? text.indexOf(promptQuery) : -1;
      const prefixSegments = idx === -1 ? [] : splitAnsi(text.slice(0, idx));
      const prefixHasVisibleText = prefixSegments.some(
        (segment) =>
          !segment.ansi &&
          [...segment.text].some((character) => {
            const code = character.codePointAt(0) as number;
            return code > 0x1f && !(code >= 0x7f && code <= 0x9f);
          }),
      );
      const prefixHasTerminalEscape = prefixSegments.some((segment) => segment.ansi);
      const trustedPrompt =
        idx !== -1 && !prefixHasVisibleText && (!promptRendered || prefixHasTerminalEscape);
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

  const { rl, signal, isClosed, dispose } = createCancelableRl(
    stdin,
    maskingOutput,
    stdinIsTTY,
    options.signal,
  );

  try {
    while (true) {
      const query = `${col.green(prefix)} ${col.bold(message)} `;
      masking = true;
      promptQuery = query;
      promptRendered = false;

      let answer: string;
      try {
        answer = await ask(rl, query, signal, isClosed);
      } finally {
        masking = false;
        promptQuery = "";
        promptRendered = false;
      }

      const value = trim ? answer.trim() : answer;

      if (required && value === "") {
        promptOutput.write(`${col.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          validate(value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          promptOutput.write(`${col.red("✖")} ${msg}\n`);
          continue;
        }
      }

      return value;
    }
  } finally {
    masking = false;
    dispose();
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

import { createInterface, type Interface } from "node:readline/promises";
import { type Readable, Writable } from "node:stream";
import { PromptCancelError } from "../errors.js";
import { color as c, splitAnsi, stringWidth } from "./color.js";

// ── Types ──

/**
 * Base options shared by all prompt types.
 */
export interface PromptBaseOptions {
  /** Default value returned when the user provides no input. */
  default?: unknown;
  /** Validation function; throw an Error to reject the value. */
  validate?: (value: unknown) => void;
  /** Whether a non-empty value is required. Defaults to true for text/password prompts. */
  required?: boolean;
  /** Prefix symbol displayed before the prompt message. Defaults to "?". */
  prefix?: string;
  /** Writable stream for output. Defaults to process.stdout. */
  stdout?: Writable;
  /** Readable stream for input. Defaults to process.stdin. */
  stdin?: Readable;
}

/**
 * Options for a text input prompt.
 */
export interface TextOptions extends PromptBaseOptions {
  /** Default text value. */
  default?: string;
  /** Placeholder text displayed as a hint. */
  placeholder?: string;
}

/**
 * Options for a yes/no confirmation prompt.
 */
export interface ConfirmOptions extends PromptBaseOptions {
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
export interface SelectOptions<T> extends PromptBaseOptions {
  /** Default selected value, returned when the user presses Enter with no input. */
  default?: T;
}

/**
 * Options for a multiselect prompt.
 */
export interface MultiselectOptions<T> extends PromptBaseOptions {
  /** Pre-selected default values. */
  default?: T[];
  /** Minimum number of items that must be selected. */
  min?: number;
  /** Maximum number of items that may be selected. */
  max?: number;
}

/**
 * A choice can be either a raw value or a SelectChoice object with label/value/hint.
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
      return ch as SelectChoice<T>;
    }
    return { label: String(ch), value: ch as T };
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
function warnDuplicateLabels<T>(normalized: SelectChoice<T>[], stdout: Writable): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const ch of normalized) {
    if (seen.has(ch.label)) duplicates.add(ch.label);
    seen.add(ch.label);
  }
  for (const label of duplicates) {
    stdout.write(`${c.yellow("!")} Duplicate label "${label}"; select it by its number\n`);
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
function createCancelableRl(stdin?: Readable, stdout?: Writable): CancelableRl {
  const rl = createInterface({
    input: stdin ?? process.stdin,
    output: stdout ?? process.stdout,
    terminal: true,
  });
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  rl.on("SIGINT", onSigint);

  let closed = false;
  const onClose = () => {
    closed = true;
  };
  rl.on("close", onClose);

  const dispose = () => {
    rl.off("SIGINT", onSigint);
    rl.off("close", onClose);
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
  const { default: defaultValue, validate, required = true, prefix = "?" } = options;
  const stdout = options.stdout ?? process.stdout;

  const { rl, signal, isClosed, dispose } = createCancelableRl(options.stdin, stdout);
  const hint =
    defaultValue !== undefined
      ? c.dim(` (${defaultValue})`)
      : options.placeholder
        ? c.dim(` (${options.placeholder})`)
        : "";

  try {
    while (true) {
      const answer = await ask(
        rl,
        `${c.green(prefix)} ${c.bold(message)}${hint} `,
        signal,
        isClosed,
      );

      let value = answer.trim();
      // An explicit default (including an empty string) fills an empty
      // submission and bypasses the required-empty check below.
      const usedDefault = value === "" && defaultValue !== undefined;
      if (usedDefault) {
        value = String(defaultValue);
      }

      if (!usedDefault && required && value === "") {
        stdout.write(`${c.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          validate(value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${c.red("✖")} ${msg}\n`);
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

  const { rl, signal, isClosed, dispose } = createCancelableRl(options.stdin, stdout);
  const hint = defaultValue ? c.dim(" (Y/n)") : c.dim(" (y/N)");

  try {
    const answer = await ask(rl, `${c.green(prefix)} ${c.bold(message)}${hint} `, signal, isClosed);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") return defaultValue;
    return trimmed === "y" || trimmed === "yes";
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

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw new Error("select() requires at least one choice");
  }
  const defaultIndex = findDefaultIndex(normalized, defaultValue);

  const { rl, signal, isClosed, dispose } = createCancelableRl(options.stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const isDefault = i === defaultIndex;
      const hint = ch.hint ? c.dim(` (${ch.hint})`) : "";
      const marker = isDefault ? c.dim(" [default]") : "";
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}${hint}${marker}\n`);
    }
    warnDuplicateLabels(normalized, stdout);

    const promptLabel =
      defaultIndex >= 0 ? `Enter number (default ${defaultIndex + 1}):` : "Enter number:";

    while (true) {
      const answer = await ask(rl, `${c.dim(promptLabel)} `, signal, isClosed);
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
        stdout.write(`${c.red("✖")} Please enter a number between 1 and ${normalized.length}\n`);
        continue;
      }

      if (validate) {
        try {
          validate(chosen.value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${c.red("✖")} ${msg}\n`);
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

  const normalized = normalizeChoices(choices);
  if (normalized.length === 0) {
    throw new Error("multiselect() requires at least one choice");
  }
  const defaultIndexes = new Set(
    (defaults ?? []).map((d) => findDefaultIndex(normalized, d)).filter((i) => i >= 0),
  );

  const { rl, signal, isClosed, dispose } = createCancelableRl(options.stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)} ${c.dim("(comma-separated numbers)")}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const marker = defaultIndexes.has(i) ? c.dim(" [default]") : "";
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}${marker}\n`);
    }
    warnDuplicateLabels(normalized, stdout);

    while (true) {
      const answer = await ask(rl, `${c.dim("Enter numbers:")} `, signal, isClosed);
      const trimmed = answer.trim();

      // Deduplicate selected indices so min/max count distinct items.
      let indices: number[];
      if (trimmed === "" && defaultIndexes.size > 0) {
        indices = [...defaultIndexes];
      } else {
        const nums = trimmed
          .split(",")
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n));
        indices = [...new Set(nums.map((n) => n - 1))];
      }

      const valid = indices.length > 0 && indices.every((i) => i >= 0 && i < normalized.length);
      if (!valid) {
        stdout.write(
          `${c.red("✖")} Please enter valid numbers between 1 and ${normalized.length}\n`,
        );
        continue;
      }

      if (min !== undefined && indices.length < min) {
        stdout.write(`${c.red("✖")} Select at least ${min} items\n`);
        continue;
      }

      if (max !== undefined && indices.length > max) {
        stdout.write(`${c.red("✖")} Select at most ${max} items\n`);
        continue;
      }

      const values = indices.map((i) => normalized[i].value);

      if (validate) {
        try {
          validate(values);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${c.red("✖")} ${msg}\n`);
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
 * replaced with as many asterisks as its visual column width. A wide character
 * (e.g. an emoji) is masked with two asterisks, and zero-width or combining
 * characters add none, so the masked output keeps the same visible width as the
 * input without leaking the original characters.
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

    // Within a plain-text run, mask each run of visible characters with as many
    // asterisks as its visual width, while passing line breaks through unchanged.
    let visible = "";
    const flushVisible = () => {
      if (visible !== "") {
        result += "*".repeat(stringWidth(visible));
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
async function password(message: string, options: PromptBaseOptions = {}): Promise<string> {
  const { validate, required = true, prefix = "?" } = options;
  const stdout = options.stdout ?? process.stdout;

  // Masking is scoped to this prompt: readline echoes to a private wrapper
  // stream that masks visible characters and forwards everything to the real
  // stdout. The shared stdout's own `write` is never replaced, so concurrent
  // spinner/logger output is untouched and re-entrant prompts cannot corrupt it.
  let masking = false;
  const maskingOutput = new Writable({
    write(chunk: string | Buffer, _encoding, callback) {
      const text = typeof chunk === "string" ? chunk : chunk.toString();
      stdout.write(masking ? maskInput(text) : text);
      callback();
    },
  });
  // Mirror TTY status/size so readline keeps terminal echo behavior.
  const ttyStdout = stdout as Partial<NodeJS.WriteStream>;
  (maskingOutput as unknown as Record<string, unknown>).isTTY = ttyStdout.isTTY ?? true;
  (maskingOutput as unknown as Record<string, unknown>).columns = ttyStdout.columns ?? 80;
  (maskingOutput as unknown as Record<string, unknown>).rows = ttyStdout.rows ?? 24;

  const { rl, signal, isClosed, dispose } = createCancelableRl(options.stdin, maskingOutput);

  try {
    while (true) {
      // Write the (unmasked) prompt straight to stdout before masking begins.
      stdout.write(`${c.green(prefix)} ${c.bold(message)} `);
      masking = true;

      let answer: string;
      try {
        answer = await ask(rl, "", signal, isClosed);
      } finally {
        masking = false;
      }
      stdout.write("\n");

      const value = answer.trim();

      if (required && value === "") {
        stdout.write(`${c.red("✖")} Value is required\n`);
        continue;
      }

      if (validate) {
        try {
          validate(value);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          stdout.write(`${c.red("✖")} ${msg}\n`);
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

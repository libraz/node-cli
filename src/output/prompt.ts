import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { PromptCancelError } from "../errors.js";
import { color as c } from "./color.js";

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
 * Creates a readline interface plus a cancellation signal that is aborted when
 * the user presses Ctrl+C (SIGINT). Callers pass `signal` to `rl.question` so a
 * cancellation rejects the pending question rather than hanging.
 *
 * @param stdin - Input stream. Defaults to process.stdin.
 * @param stdout - Output stream. Defaults to process.stdout.
 * @returns The readline interface, an abort signal, and a teardown function.
 */
function createCancelableRl(
  stdin?: Readable,
  stdout?: Writable,
): { rl: Interface; signal: AbortSignal; dispose: () => void } {
  const rl = createInterface({
    input: stdin ?? process.stdin,
    output: stdout ?? process.stdout,
    terminal: true,
  });
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  rl.on("SIGINT", onSigint);

  const dispose = () => {
    rl.off("SIGINT", onSigint);
    rl.close();
  };

  return { rl, signal: controller.signal, dispose };
}

/**
 * Asks a single readline question, translating a Ctrl+C abort into a
 * {@link PromptCancelError}.
 */
async function ask(rl: Interface, query: string, signal: AbortSignal): Promise<string> {
  try {
    return await rl.question(query, { signal });
  } catch (err) {
    if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      throw new PromptCancelError();
    }
    throw err;
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

  const { rl, signal, dispose } = createCancelableRl(options.stdin, stdout);
  const hint =
    defaultValue !== undefined
      ? c.dim(` (${defaultValue})`)
      : options.placeholder
        ? c.dim(` (${options.placeholder})`)
        : "";

  try {
    while (true) {
      const answer = await ask(rl, `${c.green(prefix)} ${c.bold(message)}${hint} `, signal);

      let value = answer.trim();
      if (value === "" && defaultValue !== undefined) {
        value = defaultValue;
      }

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

  const { rl, signal, dispose } = createCancelableRl(options.stdin, stdout);
  const hint = defaultValue ? c.dim(" (Y/n)") : c.dim(" (y/N)");

  try {
    const answer = await ask(rl, `${c.green(prefix)} ${c.bold(message)}${hint} `, signal);
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
  const defaultIndex =
    defaultValue !== undefined ? normalized.findIndex((ch) => ch.value === defaultValue) : -1;

  const { rl, signal, dispose } = createCancelableRl(options.stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const isDefault = i === defaultIndex;
      const hint = ch.hint ? c.dim(` (${ch.hint})`) : "";
      const marker = isDefault ? c.dim(" [default]") : "";
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}${hint}${marker}\n`);
    }

    const promptLabel =
      defaultIndex >= 0 ? `Enter number (default ${defaultIndex + 1}):` : "Enter number:";

    while (true) {
      const answer = await ask(rl, `${c.dim(promptLabel)} `, signal);
      const trimmed = answer.trim();

      let chosen: SelectChoice<T> | undefined;
      if (trimmed === "" && defaultIndex >= 0) {
        chosen = normalized[defaultIndex];
      } else {
        const num = Number.parseInt(trimmed, 10);
        if (num >= 1 && num <= normalized.length) {
          chosen = normalized[num - 1];
        } else {
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
    (defaults ?? []).map((d) => normalized.findIndex((ch) => ch.value === d)).filter((i) => i >= 0),
  );

  const { rl, signal, dispose } = createCancelableRl(options.stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)} ${c.dim("(comma-separated numbers)")}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const marker = defaultIndexes.has(i) ? c.dim(" [default]") : "";
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}${marker}\n`);
    }

    while (true) {
      const answer = await ask(rl, `${c.dim("Enter numbers:")} `, signal);
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
 * pass through unchanged, while every other visible character (including digits,
 * `;` and `[`) is replaced with an asterisk.
 *
 * @param chunk - The raw output chunk readline is about to echo.
 * @returns The masked chunk.
 */
export function maskInput(chunk: string): string {
  let result = "";
  let i = 0;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (ch === "\x1b") {
      // Pass through an ANSI escape sequence (ESC [ ... final-byte).
      let j = i + 1;
      if (chunk[j] === "[") {
        j++;
        while (j < chunk.length && !/[A-Za-z]/.test(chunk[j])) j++;
        if (j < chunk.length) j++; // include final byte
      }
      result += chunk.slice(i, j);
      i = j;
    } else if (ch === "\r" || ch === "\n") {
      result += ch;
      i++;
    } else {
      result += "*";
      i++;
    }
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

  const { rl, signal, dispose } = createCancelableRl(options.stdin, stdout);

  const writeOriginal = (stdout as NodeJS.WriteStream).write;
  let masking = false;

  const restoreWrite = () => {
    (stdout as NodeJS.WriteStream).write = writeOriginal;
  };

  try {
    // Mask every echoed character while a password question is active.
    (stdout as NodeJS.WriteStream).write = function (
      this: NodeJS.WriteStream,
      chunk: string | Uint8Array,
      ...args: [BufferEncoding?, ((err?: Error | null) => void)?]
    ): boolean {
      if (masking && typeof chunk === "string") {
        return writeOriginal.call(stdout, maskInput(chunk), ...args);
      }
      return writeOriginal.call(stdout, chunk, ...args);
    } as typeof writeOriginal;

    while (true) {
      // Write the (unmasked) prompt before enabling masking.
      masking = false;
      stdout.write(`${c.green(prefix)} ${c.bold(message)} `);
      masking = true;

      const answer = await ask(rl, "", signal);
      masking = false;
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
    restoreWrite();
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

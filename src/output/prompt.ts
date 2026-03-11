import { createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { PromptCancelError } from "../errors.js";
import { color as c } from "./color.js";

// ── Types ──

/**
 * Base options shared by all prompt types.
 */
interface PromptBaseOptions {
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
interface TextOptions extends PromptBaseOptions {
  /** Default text value. */
  default?: string;
  /** Placeholder text displayed as a hint. */
  placeholder?: string;
}

/**
 * Options for a yes/no confirmation prompt.
 */
interface ConfirmOptions extends PromptBaseOptions {
  /** Default boolean value. Defaults to false. */
  default?: boolean;
}

/**
 * Represents a single selectable choice with a display label and underlying value.
 */
interface SelectChoice<T> {
  /** Display label shown to the user. */
  label: string;
  /** Value returned when this choice is selected. */
  value: T;
  /** Optional hint text displayed alongside the label. */
  hint?: string;
}

/**
 * Options for a multiselect prompt.
 */
interface MultiselectOptions<T> extends PromptBaseOptions {
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
type Choice<T> = T | SelectChoice<T>;

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
 * Creates a readline interface for interactive prompts.
 *
 * @param stdin - Input stream. Defaults to process.stdin.
 * @param stdout - Output stream. Defaults to process.stdout.
 * @returns A readline Interface instance.
 */
function createRl(stdin?: Readable, stdout?: Writable): Interface {
  return createInterface({
    input: stdin ?? process.stdin,
    output: stdout ?? process.stdout,
    terminal: true,
  });
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
  const {
    default: defaultValue,
    validate,
    required = true,
    prefix = "?",
    stdout = process.stdout,
    stdin = process.stdin,
  } = options;

  const rl = createRl(stdin, stdout);
  const hint = defaultValue !== undefined ? c.dim(` (${defaultValue})`) : "";

  try {
    while (true) {
      const answer = await rl.question(`${c.green(prefix)} ${c.bold(message)}${hint} `);

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

      rl.close();
      return value;
    }
  } catch {
    rl.close();
    throw new PromptCancelError();
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
  const {
    default: defaultValue = false,
    prefix = "?",
    stdout = process.stdout,
    stdin = process.stdin,
  } = options;

  const rl = createRl(stdin, stdout);
  const hint = defaultValue ? c.dim(" (Y/n)") : c.dim(" (y/N)");

  try {
    const answer = await rl.question(`${c.green(prefix)} ${c.bold(message)}${hint} `);
    rl.close();

    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "") return defaultValue;
    return trimmed === "y" || trimmed === "yes";
  } catch {
    rl.close();
    throw new PromptCancelError();
  }
}

// ── Select ──

/**
 * Prompts the user to select a single item from a list of choices.
 *
 * Users may enter a number or a matching label to make their selection.
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
  options: PromptBaseOptions = {},
): Promise<T> {
  const { prefix = "?", stdout = process.stdout, stdin = process.stdin } = options;

  const normalized = normalizeChoices(choices);

  // Simple fallback: number-based selection
  const rl = createRl(stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      const hint = ch.hint ? c.dim(` (${ch.hint})`) : "";
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}${hint}\n`);
    }

    while (true) {
      const answer = await rl.question(`${c.dim("Enter number:")} `);
      const num = Number.parseInt(answer.trim(), 10);

      if (num >= 1 && num <= normalized.length) {
        rl.close();
        return normalized[num - 1].value;
      }

      // Also accept by label
      const byLabel = normalized.find(
        (ch) => ch.label.toLowerCase() === answer.trim().toLowerCase(),
      );
      if (byLabel) {
        rl.close();
        return byLabel.value;
      }

      stdout.write(`${c.red("✖")} Please enter a number between 1 and ${normalized.length}\n`);
    }
  } catch {
    rl.close();
    throw new PromptCancelError();
  }
}

// ── Multiselect ──

/**
 * Prompts the user to select one or more items from a list of choices.
 *
 * Users enter comma-separated numbers to select items.
 *
 * @param message - The question to display.
 * @param choices - Available choices.
 * @param options - Multiselect prompt options (min/max constraints).
 * @returns An array of selected values.
 * @throws PromptCancelError if the user cancels.
 */
async function multiselect<T = string>(
  message: string,
  choices: Choice<T>[],
  options: MultiselectOptions<T> = {},
): Promise<T[]> {
  const { prefix = "?", stdout = process.stdout, stdin = process.stdin, min, max } = options;

  const normalized = normalizeChoices(choices);
  const rl = createRl(stdin, stdout);

  try {
    stdout.write(`${c.green(prefix)} ${c.bold(message)} ${c.dim("(comma-separated numbers)")}\n`);
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      stdout.write(`  ${c.cyan(`${i + 1})`)} ${ch.label}\n`);
    }

    while (true) {
      const answer = await rl.question(`${c.dim("Enter numbers:")} `);
      const nums: number[] = answer
        .split(",")
        .map((s: string) => Number.parseInt(s.trim(), 10))
        .filter((n: number) => !Number.isNaN(n));

      const valid = nums.every((n: number) => n >= 1 && n <= normalized.length);
      if (!valid || nums.length === 0) {
        stdout.write(
          `${c.red("✖")} Please enter valid numbers between 1 and ${normalized.length}\n`,
        );
        continue;
      }

      if (min !== undefined && nums.length < min) {
        stdout.write(`${c.red("✖")} Select at least ${min} items\n`);
        continue;
      }

      if (max !== undefined && nums.length > max) {
        stdout.write(`${c.red("✖")} Select at most ${max} items\n`);
        continue;
      }

      rl.close();
      return nums.map((n: number) => normalized[n - 1].value);
    }
  } catch {
    rl.close();
    throw new PromptCancelError();
  }
}

// ── Password ──

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
  const {
    validate,
    required = true,
    prefix = "?",
    stdout = process.stdout,
    stdin = process.stdin,
  } = options;

  const rl = createRl(stdin, stdout);

  // Mask input by intercepting keypress
  const writeOriginal = (stdout as NodeJS.WriteStream).write;
  let masking = false;

  try {
    while (true) {
      stdout.write(`${c.green(prefix)} ${c.bold(message)} `);
      masking = true;

      // Override write to mask characters
      let inputLength = 0;
      (stdout as NodeJS.WriteStream).write = function (
        this: NodeJS.WriteStream,
        chunk: string | Uint8Array,
        ...args: [BufferEncoding?, ((err?: Error | null) => void)?]
      ): boolean {
        if (masking && typeof chunk === "string") {
          // Replace visible characters with *
          const masked = chunk.replace(/[^\r\n\x1b[\d;]*[^\r\n\x1b[\d;]/g, (match: string) => {
            inputLength += match.length;
            return "*".repeat(match.length);
          });
          return writeOriginal.call(stdout, masked, ...args);
        }
        return writeOriginal.call(stdout, chunk, ...args);
      } as typeof writeOriginal;

      const answer = await rl.question("");
      masking = false;
      (stdout as NodeJS.WriteStream).write = writeOriginal;

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

      rl.close();
      return value;
    }
  } catch {
    masking = false;
    (stdout as NodeJS.WriteStream).write = writeOriginal;
    rl.close();
    throw new PromptCancelError();
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

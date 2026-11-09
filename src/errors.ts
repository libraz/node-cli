import type { Writable } from "node:stream";
import { inspect } from "node:util";
import { sanitizeTerminalText } from "./output/color.js";
import { writeThrough } from "./output/region.js";

/** Exit code for a mistake in how the command was invoked (sysexits `EX_USAGE`). */
const EXIT_USAGE = 64;
/** Exit code for a prompt that ran out of input (sysexits `EX_NOINPUT`). */
const EXIT_NO_INPUT = 66;
/** Exit code for a cancellation, as a shell reports a process ended by SIGINT. */
const EXIT_CANCELLED = 130;

/**
 * Machine-readable error codes carried by the built-in {@link CLIError}
 * subclasses. A bare `CLIError` defaults to `"FAILED"`, which is deliberately
 * not part of this union.
 */
export type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_FAILED"
  | "PARSE_FAILED"
  | "CANCELLED"
  | "INPUT_ENDED";

/** Options accepted by the {@link CLIError} constructor. */
export interface CLIErrorOptions {
  /** Machine-readable error code. Defaults to `"FAILED"`. */
  code?: CLIErrorCode | (string & {}) | undefined;
  /**
   * Suggested process exit code, an integer from 1 to 255. Defaults to 1.
   * Zero would read as success, and 256 wraps to 0 on POSIX systems.
   */
  exitCode?: number | undefined;
  /** The underlying error, forwarded to `Error`. */
  cause?: unknown;
}

/**
 * Base error class for all CLI-related errors.
 * Each instance carries a machine-readable error code and a suggested
 * process exit code.
 *
 * @example
 * ```ts
 * throw new CLIError("Deployment target is locked", { code: "LOCKED", exitCode: 75 });
 * ```
 */
export class CLIError extends Error {
  /** Machine-readable error code (e.g. "COMMAND_NOT_FOUND"). Defaults to `"FAILED"`. */
  readonly code: CLIErrorCode | (string & {});
  /** Suggested process exit code when this error is fatal, from 1 to 255. Defaults to 1. */
  readonly exitCode: number;

  /**
   * Creates a new CLIError.
   * @param message - Human-readable error message.
   * @param options - Code, exit code and cause. Every member is optional.
   * @throws {TypeError} ERR_INVALID_ARG_TYPE when `exitCode` is not a number.
   * @throws {RangeError} ERR_INVALID_ARG_VALUE when `exitCode` is not an integer from 1 to 255.
   */
  constructor(message: string, options: CLIErrorOptions = {}) {
    const exitCode = checkExitCode(options.exitCode);
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CLIError";
    this.code = options.code ?? "FAILED";
    this.exitCode = exitCode;
    // Preserve the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Validates a {@link CLIErrorOptions.exitCode}, returning the default when it is omitted. */
function checkExitCode(exitCode: unknown): number {
  if (exitCode === undefined) return 1;
  if (typeof exitCode !== "number") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "exitCode" option of CLIError must be a number. Received ${exitCode === null ? "null" : `type ${typeof exitCode}`}`,
    );
  }
  if (!Number.isInteger(exitCode) || exitCode < 1 || exitCode > 255) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "exitCode" option of CLIError must be an integer from 1 to 255. Received ${exitCode}`,
    );
  }
  return exitCode;
}

/** Appends the usage hint shared by every command-resolution error. */
function withUsage(message: string, usage: string | undefined): string {
  return usage ? `${message}\n\n  Usage: ${usage}` : message;
}

/**
 * Renders a value for an error message: a string as a JSON string literal (so
 * quotes and newlines are escaped), anything else through `util.inspect` on one
 * line. Either way the result is safe to write to a terminal.
 *
 * @param value - The value to render.
 * @returns The quoted, terminal-safe rendering.
 */
export function quoteValue(value: unknown): string {
  const text =
    typeof value === "string"
      ? JSON.stringify(value)
      : inspect(value, { depth: 1, breakLength: Number.POSITIVE_INFINITY });
  return sanitizeTerminalText(text, { singleLine: true, allowHyperlinks: false });
}

/**
 * Thrown when the user enters a command that does not exist.
 */
export class CommandNotFoundError extends CLIError {
  declare readonly code: "COMMAND_NOT_FOUND";
  /** The unrecognized command string, as typed. */
  readonly input: string;
  /** Commands available at the point the lookup failed, when known. */
  readonly available?: readonly string[];

  /**
   * @param input - The unrecognized command string.
   * @param options.available - Commands available at the point the lookup
   * failed, listed under `Available commands:` in the message.
   * @param options.cause - The underlying error.
   */
  constructor(
    input: string,
    options: { available?: readonly string[] | undefined; cause?: unknown } = {},
  ) {
    const available = options.available?.length
      ? `\nAvailable commands: ${options.available.join(", ")}`
      : "";
    super(`Command not found: ${quoteValue(input)}${available}`, {
      code: "COMMAND_NOT_FOUND",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "CommandNotFoundError";
    this.input = input;
    this.available = options.available;
  }
}

/**
 * Thrown when a required positional argument is missing.
 */
export class MissingArgumentError extends CLIError {
  declare readonly code: "MISSING_ARGUMENT";
  /** The name of the missing argument. */
  readonly argName: string;
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param argName - The name of the missing argument.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The underlying error.
   */
  constructor(argName: string, options: { usage?: string | undefined; cause?: unknown } = {}) {
    const { usage } = options;
    super(withUsage(`Missing required argument: <${argName}>`, usage), {
      code: "MISSING_ARGUMENT",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "MissingArgumentError";
    this.argName = argName;
    this.usage = usage;
  }
}

/**
 * Thrown when unexpected extra positional arguments are provided.
 */
export class ExtraArgumentError extends CLIError {
  declare readonly code: "EXTRA_ARGUMENT";
  /** Every unexpected argument value, in input order. Never empty. */
  readonly extras: readonly string[];
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param extras - The unexpected argument values. Must not be empty.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The underlying error.
   * @throws {TypeError} ERR_INVALID_ARG_TYPE when `extras` is not an array of strings.
   * @throws {RangeError} ERR_INVALID_ARG_VALUE when `extras` is empty.
   */
  constructor(
    extras: readonly string[],
    options: { usage?: string | undefined; cause?: unknown } = {},
  ) {
    if (!Array.isArray(extras) || extras.some((value) => typeof value !== "string")) {
      throw usageError(
        "type",
        "ERR_INVALID_ARG_TYPE",
        'The "extras" argument of ExtraArgumentError must be an array of strings',
      );
    }
    if (extras.length === 0) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        'The "extras" argument of ExtraArgumentError must not be empty',
      );
    }
    const { usage } = options;
    const quoted = extras.map(quoteValue).join(", ");
    super(withUsage(`Unexpected argument${extras.length > 1 ? "s" : ""}: ${quoted}`, usage), {
      code: "EXTRA_ARGUMENT",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "ExtraArgumentError";
    this.extras = [...extras];
    this.usage = usage;
  }
}

/**
 * Thrown when a required option is not provided.
 */
export class MissingOptionError extends CLIError {
  declare readonly code: "MISSING_OPTION";
  /**
   * The option's canonical long name, without dashes and in its kebab-case
   * spelling (`dry-run`). Its key in `ctx.options` is the camelCase form.
   */
  readonly optionName: string;
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param optionName - The canonical long name of the missing option, without dashes.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The underlying error.
   */
  constructor(optionName: string, options: { usage?: string | undefined; cause?: unknown } = {}) {
    const { usage } = options;
    super(withUsage(`Missing required option: --${optionName}`, usage), {
      code: "MISSING_OPTION",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "MissingOptionError";
    this.optionName = optionName;
    this.usage = usage;
  }
}

/**
 * Thrown when an option value is invalid (e.g. wrong type or not in choices).
 */
export class InvalidOptionError extends CLIError {
  declare readonly code: "INVALID_OPTION";
  /**
   * The option's canonical long name, without dashes and in its kebab-case
   * spelling (`dry-run`), if known. Its key in `ctx.options` is the camelCase form.
   */
  readonly optionName?: string;
  /** The rejected value, if known. */
  readonly value?: unknown;
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param message - Description of why the option value is invalid.
   * @param options.optionName - The canonical long name of the option, without dashes.
   * @param options.value - The rejected value.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The underlying error.
   */
  constructor(
    message: string,
    options: {
      optionName?: string | undefined;
      value?: unknown;
      usage?: string | undefined;
      cause?: unknown;
    } = {},
  ) {
    const { usage } = options;
    super(withUsage(message, usage), {
      code: "INVALID_OPTION",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "InvalidOptionError";
    this.optionName = options.optionName;
    this.value = options.value;
    this.usage = usage;
  }
}

/**
 * Thrown when an unrecognized option flag is encountered.
 */
export class UnknownOptionError extends CLIError {
  declare readonly code: "UNKNOWN_OPTION";
  /**
   * The one unknown flag, normalized: `--xyz=3` is reported as `--xyz`, and an
   * unknown `x` inside the cluster `-vx` as `-x`.
   */
  readonly flag: string;
  /**
   * The flag as typed without its leading dashes. No definition exists, so
   * there is no canonical name to report.
   */
  readonly optionName: string;
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param flag - The unknown flag, normalized as described on {@link UnknownOptionError.flag}.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The underlying error.
   */
  constructor(flag: string, options: { usage?: string | undefined; cause?: unknown } = {}) {
    const { usage } = options;
    super(withUsage(`Unknown option: ${quoteValue(flag)}`, usage), {
      code: "UNKNOWN_OPTION",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "UnknownOptionError";
    this.flag = flag;
    this.optionName = flag.replace(/^-+/, "");
    this.usage = usage;
  }
}

/**
 * Thrown when a custom validation check fails.
 */
export class ValidationError extends CLIError {
  declare readonly code: "VALIDATION_FAILED";
  /**
   * The canonical long name of the option whose `parse` or `validate` failed,
   * without dashes and in its kebab-case spelling (`dry-run`). Absent for a
   * command-level validation failure.
   */
  readonly optionName?: string;
  /**
   * The rejected value: the raw input string when an option's `parse` failed,
   * the value handed to `validate` when its validation failed.
   */
  readonly value?: unknown;
  /** Usage line of the command, appended to the message when present. */
  readonly usage?: string;

  /**
   * @param message - Description of the validation failure.
   * @param options.optionName - The canonical long name of the option, without dashes.
   * @param options.value - The rejected value.
   * @param options.usage - Usage line of the command, appended to the message.
   * @param options.cause - The original error that caused the failure, if any.
   */
  constructor(
    message: string,
    options: {
      optionName?: string | undefined;
      value?: unknown;
      usage?: string | undefined;
      cause?: unknown;
    } = {},
  ) {
    const { usage } = options;
    super(withUsage(message, usage), {
      code: "VALIDATION_FAILED",
      exitCode: EXIT_USAGE,
      cause: options.cause,
    });
    this.name = "ValidationError";
    this.optionName = options.optionName;
    this.value = options.value;
    this.usage = usage;
  }
}

/**
 * Thrown when work is cancelled: a prompt interrupted with Ctrl-C, or a
 * command whose `AbortSignal` was aborted.
 */
export class CancelledError extends CLIError {
  declare readonly code: "CANCELLED";

  /**
   * @param options.cause - What triggered the cancellation, such as the abort
   * signal's `reason`.
   */
  constructor(options: { cause?: unknown } = {}) {
    super("Cancelled", { code: "CANCELLED", exitCode: EXIT_CANCELLED, cause: options.cause });
    this.name = "CancelledError";
  }
}

/** Thrown when a prompt has no input to read an answer from. */
export class InputEndedError extends CLIError {
  declare readonly code: "INPUT_ENDED";
  /** The message of the prompt that could not be answered. */
  readonly promptMessage: string;

  /**
   * @param promptMessage - The message of the prompt that could not be answered.
   * @param options.cause - The underlying error.
   */
  constructor(promptMessage: string, options: { cause?: unknown } = {}) {
    super(`No input available for the prompt: ${promptMessage}`, {
      code: "INPUT_ENDED",
      exitCode: EXIT_NO_INPUT,
      cause: options.cause,
    });
    this.name = "InputEndedError";
    this.promptMessage = promptMessage;
  }
}

/** Thrown when a command line cannot be tokenized or split into pipeline stages. */
export class ParseError extends CLIError {
  declare readonly code: "PARSE_FAILED";
  /** Quote left open by the input, when applicable. */
  readonly quote?: "single" | "double";

  /**
   * @param message - Description of the parse failure.
   * @param options.quote - Quote left open by the input.
   * @param options.cause - The underlying error.
   */
  constructor(
    message: string,
    options: { quote?: "single" | "double" | undefined; cause?: unknown } = {},
  ) {
    super(message, { code: "PARSE_FAILED", exitCode: EXIT_USAGE, cause: options.cause });
    this.name = "ParseError";
    this.quote = options.quote;
  }
}

/**
 * Union of the error classes the framework itself throws for user-input
 * failures, cancellation and exhausted input, one per {@link CLIErrorCode}.
 * Discriminate on `code` after narrowing with {@link isBuiltinCLIError}.
 */
export type BuiltinCLIError =
  | CommandNotFoundError
  | MissingArgumentError
  | ExtraArgumentError
  | MissingOptionError
  | InvalidOptionError
  | UnknownOptionError
  | ValidationError
  | ParseError
  | CancelledError
  | InputEndedError;

/**
 * Reports whether a value is one of the built-in {@link CLIError} subclasses.
 * Custom subclasses and a bare `CLIError` do not match; test those with
 * `instanceof`.
 */
export function isBuiltinCLIError(e: unknown): e is BuiltinCLIError {
  return (
    e instanceof CommandNotFoundError ||
    e instanceof MissingArgumentError ||
    e instanceof ExtraArgumentError ||
    e instanceof MissingOptionError ||
    e instanceof InvalidOptionError ||
    e instanceof UnknownOptionError ||
    e instanceof ValidationError ||
    e instanceof ParseError ||
    e instanceof CancelledError ||
    e instanceof InputEndedError
  );
}

/**
 * Codes carried by errors that report programmer misuse of the API, as opposed
 * to a failure caused by user input.
 */
export type UsageErrorCode =
  | "ERR_INVALID_ARG_TYPE"
  | "ERR_INVALID_ARG_VALUE"
  | "ERR_INVALID_DEFINITION"
  | "ERR_DEFINITION_CONFLICT"
  | "ERR_COMMAND_REMOVED"
  | "ERR_ALREADY_STARTED"
  | "ERR_OUTPUT_BUSY"
  | "ERR_INPUT_BUSY"
  | "ERR_PLUGIN_FAILED";

/**
 * Creates an error for programmer misuse, carrying a {@link UsageErrorCode}.
 *
 * @param kind - `"type"` yields a `TypeError`, `"range"` a `RangeError`, and
 * `"state"` a plain `Error`.
 * @param code - The machine-readable code.
 * @param message - Human-readable description.
 * @param options.cause - The underlying failure, forwarded to `Error`.
 */
export function usageError(
  kind: "type" | "range" | "state",
  code: UsageErrorCode,
  message: string,
  options: { cause?: unknown } = {},
): Error & { readonly code: UsageErrorCode } {
  const init = options.cause === undefined ? undefined : { cause: options.cause };
  let err: Error;
  if (kind === "type") {
    err = new TypeError(message, init); // usage-error-exempt: helper
  } else if (kind === "range") {
    err = new RangeError(message, init); // usage-error-exempt: helper
  } else {
    err = new Error(message, init); // usage-error-exempt: helper
  }
  return Object.assign(err, { code });
}

/**
 * Reports whether a value is the standard rejection produced by aborting an
 * `AbortSignal`. This is a low-level shape test with no notion of *whose*
 * cancellation it was; use {@link isCancellationError} to decide whether a
 * failure should be presented to the user as a cancellation.
 */
export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

/**
 * Reports whether an error represents a cancellation rather than a genuine
 * failure: any {@link CancelledError}, whatever the state of `signal`, or an
 * `AbortError` raised while `signal` is aborted. Used to present a clean
 * "Cancelled" message and the conventional 130 exit code instead of an
 * `Error:` line.
 */
export function isCancellationError(err: unknown, signal: AbortSignal): boolean {
  if (err instanceof CancelledError) return true;
  return signal.aborted && isAbortError(err);
}

/**
 * Formats an unknown error value for user-facing CLI output: the message of an
 * `Error`, otherwise the same rendering {@link toError} gives a non-Error.
 * The text is sanitized for a terminal, as the framework's own `Error:` line
 * is: control sequences and hyperlinks are removed and styling is closed.
 * Newlines are kept, so the result may span several lines.
 */
export function formatErrorMessage(err: unknown): string {
  return sanitizeDiagnostic(err instanceof Error ? err.message : describeThrown(err));
}

/**
 * Normalizes an unknown thrown value into an `Error`, so every failure that
 * reaches an event listener or a presenter has the same shape. A string becomes
 * the message; any other value is rendered with `util.inspect`. The original
 * value is always kept as `cause`.
 */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(describeThrown(err), { cause: err }); // usage-error-exempt: helper
}

/** Renders a thrown value that is not an `Error` as message text. */
function describeThrown(value: unknown): string {
  return typeof value === "string" ? value : inspect(value, { depth: 2 });
}

/**
 * Renders a failure for a human on the given stream and returns the exit code it
 * implies. Every user-facing failure boundary goes through here, so the direct
 * CLI path and the interactive shell cannot drift apart in how they present the
 * same error.
 *
 * The caller decides whether to apply the returned code: the direct path sets
 * `process.exitCode`, while the interactive shell keeps running and ignores it.
 *
 * @param err - The thrown value.
 * @param options.stream - Where to write. Callers with an execution-local stderr
 * pass it here rather than reaching for `process.stderr`. The text is sanitized,
 * since messages quote argv and thrown values, and written around a live frame.
 * @param options.interrupted - True when the failure followed a user interrupt,
 * which is presented as a clean `Cancelled` line regardless of the error value.
 * @param options.debugStack - Whether `NODE_CLI_DEBUG=1` may print a stack, with
 * each `cause` in the chain after it as `[cause] <stack>`. Documented as a
 * direct-argv-path behaviour, so the shell leaves it off.
 */
export function presentError(
  err: unknown,
  options: {
    stream: Writable;
    interrupted?: boolean;
    debugStack?: boolean;
  },
): number {
  const { stream, interrupted = false, debugStack = false } = options;
  if (interrupted || err instanceof CancelledError) {
    writeDiagnostic(stream, "Cancelled");
    return EXIT_CANCELLED;
  }
  if (debugStack && process.env.NODE_CLI_DEBUG === "1" && err instanceof Error && err.stack) {
    writeDiagnostic(stream, stackWithCauses(err));
  } else {
    writeDiagnostic(stream, `Error: ${formatErrorMessage(err)}`);
  }
  return err instanceof CLIError ? err.exitCode : 1;
}

/** Renders an error's stack followed by each cause in its chain, stopping at a cycle. */
function stackWithCauses(err: Error): string {
  const lines = [err.stack ?? describeThrown(err)];
  const seen = new Set<unknown>([err]);
  let current: unknown = err;
  while (current instanceof Error && "cause" in current && !seen.has(current.cause)) {
    const cause: unknown = current.cause;
    seen.add(cause);
    const text = cause instanceof Error ? (cause.stack ?? cause.message) : describeThrown(cause);
    lines.push(`[cause] ${text}`);
    current = cause;
  }
  return lines.join("\n");
}

/**
 * Writes one framework diagnostic line. Every error report goes through here:
 * its text quotes argv and thrown values, so control sequences and hyperlinks
 * are stripped and styling closed, and it is written around any frame a
 * renderer has drawn.
 */
export function writeDiagnostic(stream: Writable, text: string): void {
  writeThrough(stream, `${sanitizeDiagnostic(text)}\n`);
}

/** Sanitizes diagnostic text for a terminal, keeping its line structure. */
function sanitizeDiagnostic(text: string): string {
  return sanitizeTerminalText(text, { singleLine: false, allowHyperlinks: false });
}

import type { Writable } from "node:stream";
import { renderSafe } from "./output/color.js";
import { writeThrough } from "./output/region.js";

/**
 * Machine-readable error codes carried by {@link CLIError} instances.
 */
export type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_ERROR"
  | "PARSE_ERROR"
  | "PROMPT_CANCELLED";

/**
 * Base error class for all CLI-related errors.
 * Each instance carries a machine-readable error code and a suggested
 * process exit code.
 */
export class CLIError extends Error {
  /** Machine-readable error code (e.g. "COMMAND_NOT_FOUND"). */
  readonly code: CLIErrorCode | (string & {});
  /** Suggested process exit code when this error is fatal. Defaults to 1. */
  readonly exitCode: number;

  /**
   * Creates a new CLIError.
   * @param message - Human-readable error message.
   * @param options.code - Machine-readable error code.
   * @param options.exitCode - Suggested process exit code. Defaults to 1.
   * @param options.cause - The underlying error, forwarded to `Error`.
   */
  constructor(
    message: string,
    options: { code: CLIErrorCode | (string & {}); exitCode?: number; cause?: unknown },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CLIError";
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
    // Preserve the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the user enters a command that does not exist.
 */
export class CommandNotFoundError extends CLIError {
  declare readonly code: "COMMAND_NOT_FOUND";
  /** The unrecognized command string. */
  readonly input: string;
  /** Available subcommands at the point the lookup failed, when known. */
  readonly available?: readonly string[];

  /**
   * @param input - The unrecognized command string.
   * @param options.available - Available subcommands at the point the lookup failed.
   * @param options.cause - The underlying error.
   */
  constructor(input: string, options: { available?: readonly string[]; cause?: unknown } = {}) {
    const available = options.available?.length
      ? `\nAvailable subcommands: ${options.available.join(", ")}`
      : "";
    super(`Command not found: "${input}"${available}`, {
      code: "COMMAND_NOT_FOUND",
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
  /** Usage string shown alongside the error, if available. */
  readonly usage?: string;

  /**
   * @param argName - The name of the missing argument.
   * @param options.usage - Optional usage string to display alongside the error.
   * @param options.cause - The underlying error.
   */
  constructor(argName: string, options: { usage?: string; cause?: unknown } = {}) {
    const { usage } = options;
    const msg = usage
      ? `Missing required argument: <${argName}>\n\n  Usage: ${usage}`
      : `Missing required argument: <${argName}>`;
    super(msg, { code: "MISSING_ARGUMENT", cause: options.cause });
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
  /** The first unexpected argument value. */
  readonly extra: string;
  /** Every unexpected argument value, in input order. */
  readonly extras: readonly string[];

  /**
   * @param extras - The unexpected argument values.
   * @param options.cause - The underlying error.
   */
  constructor(extras: readonly string[], options: { cause?: unknown } = {}) {
    const quoted = extras.map((value) => `"${value}"`).join(", ");
    super(`Unexpected argument${extras.length > 1 ? "s" : ""}: ${quoted}`, {
      code: "EXTRA_ARGUMENT",
      cause: options.cause,
    });
    this.name = "ExtraArgumentError";
    this.extra = extras[0];
    this.extras = extras;
  }
}

/**
 * Thrown when a required option is not provided.
 */
export class MissingOptionError extends CLIError {
  declare readonly code: "MISSING_OPTION";
  /** The long name of the missing option (without "--"). */
  readonly optionName: string;

  /**
   * @param optionName - The long name of the missing option (without "--").
   * @param options.cause - The underlying error.
   */
  constructor(optionName: string, options: { cause?: unknown } = {}) {
    super(`Option --${optionName} is required`, { code: "MISSING_OPTION", cause: options.cause });
    this.name = "MissingOptionError";
    this.optionName = optionName;
  }
}

/**
 * Thrown when an option value is invalid (e.g. wrong type or not in choices).
 */
export class InvalidOptionError extends CLIError {
  declare readonly code: "INVALID_OPTION";
  /** The long name of the offending option, if known. */
  readonly optionName?: string;
  /** The rejected value, if known. */
  readonly value?: unknown;

  /**
   * @param message - Description of why the option value is invalid.
   * @param options.optionName - The long name of the offending option.
   * @param options.value - The rejected value.
   * @param options.cause - The underlying error.
   */
  constructor(
    message: string,
    options: { optionName?: string; value?: unknown; cause?: unknown } = {},
  ) {
    super(message, { code: "INVALID_OPTION", cause: options.cause });
    this.name = "InvalidOptionError";
    this.optionName = options.optionName;
    this.value = options.value;
  }
}

/**
 * Thrown when an unrecognized option flag is encountered.
 */
export class UnknownOptionError extends CLIError {
  declare readonly code: "UNKNOWN_OPTION";
  /** The unrecognized option flag, exactly as typed (with its leading dashes). */
  readonly flag: string;
  /** The flag without its leading dashes. */
  readonly optionName: string;

  /**
   * @param flag - The unrecognized option flag.
   * @param options.cause - The underlying error.
   */
  constructor(flag: string, options: { cause?: unknown } = {}) {
    super(`Unknown option: ${flag}`, { code: "UNKNOWN_OPTION", cause: options.cause });
    this.name = "UnknownOptionError";
    this.flag = flag;
    this.optionName = flag.replace(/^-+/, "");
  }
}

/**
 * Thrown when a custom validation check fails.
 */
export class ValidationError extends CLIError {
  declare readonly code: "VALIDATION_ERROR";
  /** The long option name whose custom parser or validator failed, if known. */
  readonly optionName?: string;

  /**
   * @param message - Description of the validation failure.
   * @param options.optionName - The long option name whose parser or validator failed.
   * @param options.cause - The original error that caused the failure, if any.
   */
  constructor(message: string, options: { optionName?: string; cause?: unknown } = {}) {
    super(message, { code: "VALIDATION_ERROR", cause: options.cause });
    this.name = "ValidationError";
    this.optionName = options.optionName;
  }
}

/**
 * Thrown when the user cancels an interactive prompt.
 */
export class PromptCancelError extends CLIError {
  declare readonly code: "PROMPT_CANCELLED";

  /**
   * @param options.cause - What triggered the cancellation (e.g. an abort reason).
   */
  constructor(options: { cause?: unknown } = {}) {
    super("Prompt cancelled", { code: "PROMPT_CANCELLED", exitCode: 130, cause: options.cause });
    this.name = "PromptCancelError";
  }
}

/** Thrown when a command line cannot be tokenized or split into pipeline stages. */
export class ParseError extends CLIError {
  declare readonly code: "PARSE_ERROR";
  /** Quote left open by the input, when applicable. */
  readonly quote?: "single" | "double";

  /**
   * @param message - Description of the parse failure.
   * @param options.quote - Quote left open by the input.
   * @param options.cause - The underlying error.
   */
  constructor(message: string, options: { quote?: "single" | "double"; cause?: unknown } = {}) {
    super(message, { code: "PARSE_ERROR", cause: options.cause });
    this.name = "ParseError";
    this.quote = options.quote;
  }
}

/**
 * Union of the error classes the framework itself throws for user-input
 * failures. Discriminate on `code` after narrowing with {@link isBuiltinCLIError}.
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
  | PromptCancelError;

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
    e instanceof PromptCancelError
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
  | "ERR_INPUT_BUSY";

/**
 * Creates an error for programmer misuse, carrying a {@link UsageErrorCode}.
 *
 * @param kind - `"type"` yields a `TypeError`, `"range"` a `RangeError`, and
 * `"state"` a plain `Error`.
 * @param code - The machine-readable code.
 * @param message - Human-readable description.
 */
export function usageError(
  kind: "type" | "range" | "state",
  code: UsageErrorCode,
  message: string,
): Error & { readonly code: UsageErrorCode } {
  let err: Error;
  if (kind === "type") {
    err = new TypeError(message); // usage-error-exempt: helper
  } else if (kind === "range") {
    err = new RangeError(message); // usage-error-exempt: helper
  } else {
    err = new Error(message); // usage-error-exempt: helper
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
 * Reports whether an error represents a user-initiated cancellation rather than
 * a genuine failure: a {@link PromptCancelError}, or an `AbortError` associated
 * with the command's aborted signal. Used to present a clean "Cancelled"
 * message and the conventional 130 exit code instead of an `Error:` line and
 * exit 1.
 */
export function isCancellationError(err: unknown, signal: AbortSignal): boolean {
  if (err instanceof PromptCancelError) return true;
  return signal.aborted && isAbortError(err);
}

/**
 * Formats an unknown error value for user-facing CLI output.
 */
export function formatErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalizes an unknown thrown value into an `Error`, so every failure that
 * reaches an event listener or a presenter has the same shape.
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err)); // usage-error-exempt: helper
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
 * @param options.debugStack - Whether `NODE_CLI_DEBUG=1` may print a stack.
 * Documented as a direct-argv-path behaviour, so the shell leaves it off.
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
  if (interrupted || err instanceof PromptCancelError) {
    writeDiagnostic(stream, "Cancelled");
    return 130;
  }
  if (debugStack && process.env.NODE_CLI_DEBUG === "1" && err instanceof Error && err.stack) {
    writeDiagnostic(stream, err.stack);
  } else {
    writeDiagnostic(stream, `Error: ${formatErrorMessage(err)}`);
  }
  return err instanceof CLIError ? err.exitCode : 1;
}

/**
 * Writes one framework diagnostic line. Every error report goes through here:
 * its text quotes argv and thrown values, so control sequences are stripped and
 * styling closed, and it is written around any frame a renderer has drawn.
 */
export function writeDiagnostic(stream: Writable, text: string): void {
  writeThrough(stream, `${renderSafe(text, { singleLine: false })}\n`);
}

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
  code: CLIErrorCode;
  /** Suggested process exit code when this error is fatal. Defaults to 1. */
  exitCode: number;

  /**
   * Creates a new CLIError.
   * @param message - Human-readable error message.
   * @param code - Machine-readable error code.
   * @param exitCode - Suggested process exit code. Defaults to 1.
   */
  constructor(message: string, code: CLIErrorCode, exitCode = 1) {
    super(message);
    this.name = "CLIError";
    this.code = code;
    this.exitCode = exitCode;
    // Preserve the prototype chain so `instanceof` works after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the user enters a command that does not exist.
 */
export class CommandNotFoundError extends CLIError {
  /** The unrecognized command string. */
  readonly input: string;
  /** Available subcommands at the point the lookup failed, when known. */
  readonly available?: readonly string[];

  /**
   * @param input - The unrecognized command string.
   */
  constructor(input: string, options: { available?: readonly string[] } = {}) {
    const available = options.available?.length
      ? `\nAvailable subcommands: ${options.available.join(", ")}`
      : "";
    super(`Command not found: "${input}"${available}`, "COMMAND_NOT_FOUND");
    this.name = "CommandNotFoundError";
    this.input = input;
    this.available = options.available;
  }
}

/**
 * Thrown when a required positional argument is missing.
 */
export class MissingArgumentError extends CLIError {
  /** The name of the missing argument. */
  readonly argName: string;
  /** Usage string shown alongside the error, if available. */
  readonly usage?: string;

  /**
   * @param argName - The name of the missing argument.
   * @param usage - Optional usage string to display alongside the error.
   */
  constructor(argName: string, usage?: string) {
    const msg = usage
      ? `Missing required argument: <${argName}>\n\n  Usage: ${usage}`
      : `Missing required argument: <${argName}>`;
    super(msg, "MISSING_ARGUMENT");
    this.name = "MissingArgumentError";
    this.argName = argName;
    this.usage = usage;
  }
}

/**
 * Thrown when an unexpected extra positional argument is provided.
 */
export class ExtraArgumentError extends CLIError {
  /** The unexpected argument value. */
  readonly extra: string;

  /**
   * @param extra - The unexpected argument value.
   */
  constructor(extra: string) {
    super(`Unexpected argument: "${extra}"`, "EXTRA_ARGUMENT");
    this.name = "ExtraArgumentError";
    this.extra = extra;
  }
}

/**
 * Thrown when a required option is not provided.
 */
export class MissingOptionError extends CLIError {
  /** The long name of the missing option (without "--"). */
  readonly optionName: string;

  /**
   * @param optionName - The long name of the missing option (without "--").
   */
  constructor(optionName: string) {
    super(`Option --${optionName} is required`, "MISSING_OPTION");
    this.name = "MissingOptionError";
    this.optionName = optionName;
  }
}

/**
 * Thrown when an option value is invalid (e.g. wrong type or not in choices).
 */
export class InvalidOptionError extends CLIError {
  /** The long name of the offending option, if known. */
  readonly optionName?: string;
  /** The rejected value, if known. */
  readonly value?: unknown;

  /**
   * @param message - Description of why the option value is invalid.
   * @param details - Optional structured details about the offending option.
   */
  constructor(message: string, details?: { optionName?: string; value?: unknown }) {
    super(message, "INVALID_OPTION");
    this.name = "InvalidOptionError";
    this.optionName = details?.optionName;
    this.value = details?.value;
  }
}

/**
 * Thrown when an unrecognized option flag is encountered.
 */
export class UnknownOptionError extends CLIError {
  /** The unrecognized option flag (with its leading dashes). */
  readonly flag: string;

  /**
   * @param flag - The unrecognized option flag.
   */
  constructor(flag: string) {
    super(`Unknown option: ${flag}`, "UNKNOWN_OPTION");
    this.name = "UnknownOptionError";
    this.flag = flag;
  }
}

/**
 * Thrown when a custom validation check fails.
 */
export class ValidationError extends CLIError {
  /** The original error that triggered validation failure, if any. */
  readonly cause?: unknown;
  /** The long option name whose custom parser or validator failed, if known. */
  readonly optionName?: string;

  /**
   * @param message - Description of the validation failure.
   * @param cause - The original error that caused the failure, if any.
   * @param details - Structured context for the validation failure.
   */
  constructor(message: string, cause?: unknown, details?: { optionName?: string }) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.cause = cause;
    this.optionName = details?.optionName;
  }
}

/**
 * Thrown when the user cancels an interactive prompt.
 */
export class PromptCancelError extends CLIError {
  constructor() {
    super("Prompt cancelled", "PROMPT_CANCELLED", 130);
    this.name = "PromptCancelError";
  }
}

/** Thrown when a command line cannot be tokenized or split into pipeline stages. */
export class ParseError extends CLIError {
  /** Quote left open by the input, when applicable. */
  readonly quote?: "single" | "double";

  constructor(message: string, options: { quote?: "single" | "double" } = {}) {
    super(message, "PARSE_ERROR");
    this.name = "ParseError";
    this.quote = options.quote;
  }
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
export function isCancellationError(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof PromptCancelError) return true;
  return signal?.aborted === true && isAbortError(err);
}

/**
 * Formats an unknown error value for user-facing CLI output.
 */
export function formatErrorMessage(err: unknown, signal?: AbortSignal): string {
  if (isCancellationError(err, signal)) {
    return "Cancelled";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalizes an unknown thrown value into an `Error`, so every failure that
 * reaches an event listener or a presenter has the same shape.
 */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
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
 * pass it here rather than reaching for `process.stderr`.
 * @param options.interrupted - True when the failure followed a user interrupt,
 * which is presented as a clean `Cancelled` line regardless of the error value.
 * @param options.debugStack - Whether `NODE_CLI_DEBUG=1` may print a stack.
 * Documented as a direct-argv-path behaviour, so the shell leaves it off.
 */
export function presentError(
  err: unknown,
  options: {
    stream: { write(chunk: string): unknown };
    interrupted?: boolean;
    debugStack?: boolean;
  },
): number {
  const { stream, interrupted = false, debugStack = false } = options;
  if (interrupted || isCancellationError(err)) {
    stream.write(`${interrupted ? "Cancelled" : formatErrorMessage(err)}\n`);
    return 130;
  }
  if (debugStack && process.env.NODE_CLI_DEBUG === "1" && err instanceof Error && err.stack) {
    stream.write(`${err.stack}\n`);
  } else {
    stream.write(`Error: ${formatErrorMessage(err)}\n`);
  }
  return err instanceof CLIError ? err.exitCode : 1;
}

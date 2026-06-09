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

  /**
   * @param input - The unrecognized command string.
   */
  constructor(input: string) {
    super(`Command not found: "${input}"`, "COMMAND_NOT_FOUND");
    this.name = "CommandNotFoundError";
    this.input = input;
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

  /**
   * @param message - Description of the validation failure.
   * @param cause - The original error that caused the failure, if any.
   */
  constructor(message: string, cause?: unknown) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.cause = cause;
    // Preserve the original stack trace when wrapping an Error.
    if (cause instanceof Error && cause.stack) {
      this.stack = cause.stack;
    }
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

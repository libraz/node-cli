/**
 * Base error class for all CLI-related errors.
 * Each instance carries a machine-readable error code.
 */
export class CLIError extends Error {
  /** Machine-readable error code (e.g. "COMMAND_NOT_FOUND"). */
  code: string;

  /**
   * Creates a new CLIError.
   * @param message - Human-readable error message.
   * @param code - Machine-readable error code.
   */
  constructor(message: string, code: string) {
    super(message);
    this.name = "CLIError";
    this.code = code;
  }
}

/**
 * Thrown when the user enters a command that does not exist.
 */
export class CommandNotFoundError extends CLIError {
  /**
   * @param input - The unrecognized command string.
   */
  constructor(input: string) {
    super(`Command not found: "${input}"`, "COMMAND_NOT_FOUND");
    this.name = "CommandNotFoundError";
  }
}

/**
 * Thrown when a required positional argument is missing.
 */
export class MissingArgumentError extends CLIError {
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
  }
}

/**
 * Thrown when an unexpected extra positional argument is provided.
 */
export class ExtraArgumentError extends CLIError {
  /**
   * @param extra - The unexpected argument value.
   */
  constructor(extra: string) {
    super(`Unexpected argument: "${extra}"`, "EXTRA_ARGUMENT");
    this.name = "ExtraArgumentError";
  }
}

/**
 * Thrown when a required option is not provided.
 */
export class MissingOptionError extends CLIError {
  /**
   * @param optionName - The long name of the missing option (without "--").
   */
  constructor(optionName: string) {
    super(`Option --${optionName} is required`, "MISSING_OPTION");
    this.name = "MissingOptionError";
  }
}

/**
 * Thrown when an option value is invalid (e.g. wrong type or not in choices).
 */
export class InvalidOptionError extends CLIError {
  /**
   * @param message - Description of why the option value is invalid.
   */
  constructor(message: string) {
    super(message, "INVALID_OPTION");
    this.name = "InvalidOptionError";
  }
}

/**
 * Thrown when an unrecognized option flag is encountered.
 */
export class UnknownOptionError extends CLIError {
  /**
   * @param flag - The unrecognized option flag.
   */
  constructor(flag: string) {
    super(`Unknown option: ${flag}`, "UNKNOWN_OPTION");
    this.name = "UnknownOptionError";
  }
}

/**
 * Thrown when a custom validation check fails.
 */
export class ValidationError extends CLIError {
  /**
   * @param message - Description of the validation failure.
   */
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

/**
 * Thrown when the user cancels an interactive prompt.
 */
export class PromptCancelError extends CLIError {
  constructor() {
    super("Prompt cancelled", "PROMPT_CANCELLED");
    this.name = "PromptCancelError";
  }
}

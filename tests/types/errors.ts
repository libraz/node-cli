import {
  CLIError,
  type CLIErrorCode,
  type CLIErrorOptions,
  ExtraArgumentError,
  isBuiltinCLIError,
  isCancellationError,
} from "../../src/index.js";

declare const e: unknown;

// Narrowing from `unknown` reaches subclass fields without a cast.
if (isBuiltinCLIError(e)) {
  switch (e.code) {
    case "MISSING_ARGUMENT": {
      const name: string = e.argName;
      const usage: string | undefined = e.usage;
      void name;
      void usage;
      break;
    }
    case "EXTRA_ARGUMENT": {
      const extras: readonly string[] = e.extras;
      const usage: string | undefined = e.usage;
      void extras;
      void usage;
      break;
    }
    case "UNKNOWN_OPTION": {
      const flag: string = e.flag;
      const name: string = e.optionName;
      const usage: string | undefined = e.usage;
      void flag;
      void name;
      void usage;
      break;
    }
    case "COMMAND_NOT_FOUND": {
      const input: string = e.input;
      const available: readonly string[] | undefined = e.available;
      void input;
      void available;
      break;
    }
    case "MISSING_OPTION": {
      const name: string = e.optionName;
      const usage: string | undefined = e.usage;
      void name;
      void usage;
      break;
    }
    case "INVALID_OPTION": {
      const name: string | undefined = e.optionName;
      const value: unknown = e.value;
      const usage: string | undefined = e.usage;
      void name;
      void value;
      void usage;
      break;
    }
    case "VALIDATION_FAILED": {
      const name: string | undefined = e.optionName;
      const value: unknown = e.value;
      const usage: string | undefined = e.usage;
      void name;
      void value;
      void usage;
      break;
    }
    case "PARSE_FAILED": {
      const quote: "single" | "double" | undefined = e.quote;
      void quote;
      break;
    }
    case "CANCELLED":
      break;
    case "INPUT_ENDED": {
      const promptMessage: string = e.promptMessage;
      void promptMessage;
      break;
    }
    default: {
      const unreachable: never = e;
      void unreachable;
    }
  }
}

// The union has exactly the ten built-in codes.
const codes: Record<CLIErrorCode, true> = {
  COMMAND_NOT_FOUND: true,
  MISSING_ARGUMENT: true,
  EXTRA_ARGUMENT: true,
  MISSING_OPTION: true,
  INVALID_OPTION: true,
  UNKNOWN_OPTION: true,
  VALIDATION_FAILED: true,
  PARSE_FAILED: true,
  CANCELLED: true,
  INPUT_ENDED: true,
};
void codes;

// @ts-expect-error the default code is not a built-in code.
const failed: CLIErrorCode = "FAILED";
void failed;

// A message alone builds a CLIError; the options bag is a named type.
new CLIError("x");
const options: CLIErrorOptions = { code: "MINE", exitCode: 2, cause: new Error("root") };
const err = new CLIError("m", options);
const code: CLIErrorCode | (string & {}) = err.code;
void code;

// @ts-expect-error `code` is readonly.
err.code = "PARSE_FAILED";

// @ts-expect-error the positional constructor shape is gone.
new CLIError("m", "VALIDATION_FAILED");

// @ts-expect-error the signal argument is required.
isCancellationError(err);

// @ts-expect-error `extra` is gone; read `extras[0]`.
void new ExtraArgumentError(["a"]).extra;

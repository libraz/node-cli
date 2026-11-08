import {
  CLIError,
  type CLIErrorCode,
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
      const first: string = e.extra;
      void extras;
      void first;
      break;
    }
    case "UNKNOWN_OPTION": {
      const flag: string = e.flag;
      const name: string = e.optionName;
      void flag;
      void name;
      break;
    }
    case "COMMAND_NOT_FOUND": {
      const input: string = e.input;
      void input;
      break;
    }
    case "MISSING_OPTION": {
      const name: string = e.optionName;
      void name;
      break;
    }
    case "INVALID_OPTION": {
      const name: string | undefined = e.optionName;
      void name;
      break;
    }
    case "VALIDATION_FAILED": {
      const name: string | undefined = e.optionName;
      void name;
      break;
    }
    case "PARSE_FAILED": {
      const quote: "single" | "double" | undefined = e.quote;
      void quote;
      break;
    }
    case "CANCELLED":
      break;
    default: {
      const unreachable: never = e;
      void unreachable;
    }
  }
}

const err = new CLIError("m", { code: "VALIDATION_FAILED" });
const code: CLIErrorCode | (string & {}) = err.code;
void code;

// @ts-expect-error `code` is readonly.
err.code = "PARSE_FAILED";

// @ts-expect-error the positional constructor shape is gone.
new CLIError("m", "VALIDATION_FAILED");

// @ts-expect-error the signal argument is required.
isCancellationError(err);

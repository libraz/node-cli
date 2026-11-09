import {
  CLIError,
  type CLIErrorOptions,
  CommandNotFoundError,
  ExtraArgumentError,
  InputEndedError,
  InvalidOptionError,
  MissingArgumentError,
  MissingOptionError,
  ParseError,
  UnknownOptionError,
  ValidationError,
} from "../../dist/index.js";

declare const text: string | undefined;
declare const size: number | undefined;
declare const list: readonly string[] | undefined;
declare const quote: "single" | "double" | undefined;

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into every options bag.
const options: CLIErrorOptions = { code: text, exitCode: size, cause: undefined };
new CLIError("m", options);
new CommandNotFoundError("x", { available: list, cause: undefined });
new MissingArgumentError("a", { usage: text });
new ExtraArgumentError(["a"], { usage: text });
new MissingOptionError("o", { usage: text });
new InvalidOptionError("m", { optionName: text, value: undefined, usage: text });
new UnknownOptionError("--x", { usage: text });
new ValidationError("m", { optionName: text, value: undefined, usage: text });
new ParseError("m", { quote });
new InputEndedError("Name?", { cause: undefined });

import { describe, expect, it } from "vitest";
import { usageError } from "../src/errors.js";
import {
  CLIError,
  CommandNotFoundError,
  ExtraArgumentError,
  formatErrorMessage,
  InvalidOptionError,
  isBuiltinCLIError,
  isCancellationError,
  MissingArgumentError,
  MissingOptionError,
  ParseError,
  PromptCancelError,
  UnknownOptionError,
  ValidationError,
} from "../src/index.js";

describe("CLIError", () => {
  it("takes message and an options object", () => {
    const cause = new Error("root");
    const e = new CLIError("boom", { code: "CUSTOM", exitCode: 7, cause });
    expect(e.code).toBe("CUSTOM");
    expect(e.exitCode).toBe(7);
    expect(e.cause).toBe(cause);
    expect(e).toBeInstanceOf(Error);
  });

  it("defaults exitCode to 1", () => {
    expect(new CLIError("boom", { code: "VALIDATION_ERROR" }).exitCode).toBe(1);
  });
});

describe("built-in error classes", () => {
  const cause = new Error("root");

  it("carries a literal code and forwards cause for every class", () => {
    const cases: [CLIError, string][] = [
      [new CommandNotFoundError("x", { cause }), "COMMAND_NOT_FOUND"],
      [new MissingArgumentError("a", { cause }), "MISSING_ARGUMENT"],
      [new ExtraArgumentError(["a"], { cause }), "EXTRA_ARGUMENT"],
      [new MissingOptionError("o", { cause }), "MISSING_OPTION"],
      [new InvalidOptionError("m", { cause }), "INVALID_OPTION"],
      [new UnknownOptionError("--x", { cause }), "UNKNOWN_OPTION"],
      [new ValidationError("m", { cause }), "VALIDATION_ERROR"],
      [new ParseError("m", { cause }), "PARSE_ERROR"],
      [new PromptCancelError({ cause }), "PROMPT_CANCELLED"],
    ];
    for (const [e, code] of cases) {
      expect(e.code).toBe(code);
      expect(e.cause).toBe(cause);
      expect(e).toBeInstanceOf(CLIError);
    }
  });

  it("PromptCancelError exits 130 and needs no arguments", () => {
    const e = new PromptCancelError();
    expect(e.exitCode).toBe(130);
    expect(e.cause).toBeUndefined();
  });

  it("keeps structured fields", () => {
    const m = new MissingArgumentError("env", { usage: "deploy <env>" });
    expect(m.argName).toBe("env");
    expect(m.usage).toBe("deploy <env>");
    const c = new CommandNotFoundError("x", { available: ["a", "b"] });
    expect(c.input).toBe("x");
    expect(c.available).toEqual(["a", "b"]);
    const i = new InvalidOptionError("m", { optionName: "port", value: 3 });
    expect(i.optionName).toBe("port");
    expect(i.value).toBe(3);
    const v = new ValidationError("m", { optionName: "port" });
    expect(v.optionName).toBe("port");
    expect(new ParseError("m", { quote: "single" }).quote).toBe("single");
  });

  it("ExtraArgumentError exposes extras and extra", () => {
    const one = new ExtraArgumentError(["a"]);
    expect(one.extra).toBe("a");
    expect(one.extras).toEqual(["a"]);
    expect(one.message).toBe('Unexpected argument: "a"');
    const two = new ExtraArgumentError(["a", "b"]);
    expect(two.extra).toBe("a");
    expect(two.extras).toEqual(["a", "b"]);
    expect(two.message).toBe('Unexpected arguments: "a", "b"');
  });

  it("UnknownOptionError exposes flag and optionName without dashes", () => {
    const long = new UnknownOptionError("--dry-run");
    expect(long.flag).toBe("--dry-run");
    expect(long.optionName).toBe("dry-run");
    const short = new UnknownOptionError("-v");
    expect(short.flag).toBe("-v");
    expect(short.optionName).toBe("v");
  });
});

describe("isBuiltinCLIError", () => {
  it("accepts built-in classes", () => {
    expect(isBuiltinCLIError(new ParseError("m"))).toBe(true);
    expect(isBuiltinCLIError(new PromptCancelError())).toBe(true);
  });

  it("rejects custom subclasses and non-errors", () => {
    class Mine extends CLIError {}
    expect(isBuiltinCLIError(new Mine("m", { code: "MINE" }))).toBe(false);
    expect(isBuiltinCLIError(new CLIError("m", { code: "VALIDATION_ERROR" }))).toBe(false);
    expect(isBuiltinCLIError(new Error("m"))).toBe(false);
    expect(isBuiltinCLIError("x")).toBe(false);
    expect(isBuiltinCLIError(null)).toBe(false);
  });
});

describe("usageError", () => {
  it("maps kind to the error class and carries code", () => {
    const t = usageError("type", "ERR_INVALID_ARG_TYPE", "m");
    expect(t).toBeInstanceOf(TypeError);
    expect(t.code).toBe("ERR_INVALID_ARG_TYPE");
    const r = usageError("range", "ERR_INVALID_ARG_VALUE", "m");
    expect(r).toBeInstanceOf(RangeError);
    expect(r.code).toBe("ERR_INVALID_ARG_VALUE");
    const s = usageError("state", "ERR_ALREADY_STARTED", "m");
    expect(s).toBeInstanceOf(Error);
    expect(s).not.toBeInstanceOf(TypeError);
    expect(s).not.toBeInstanceOf(RangeError);
    expect(s.code).toBe("ERR_ALREADY_STARTED");
    expect(s).not.toBeInstanceOf(CLIError);
  });
});

describe("isCancellationError / formatErrorMessage", () => {
  const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

  it("treats PromptCancelError as cancellation", () => {
    expect(isCancellationError(new PromptCancelError(), new AbortController().signal)).toBe(true);
  });

  it("treats AbortError as cancellation only when the signal is aborted", () => {
    const ac = new AbortController();
    expect(isCancellationError(abortError(), ac.signal)).toBe(false);
    ac.abort();
    expect(isCancellationError(abortError(), ac.signal)).toBe(true);
    expect(isCancellationError(new Error("x"), ac.signal)).toBe(false);
  });

  it("formatErrorMessage returns the message without special cases", () => {
    expect(formatErrorMessage(new Error("plain"))).toBe("plain");
    expect(formatErrorMessage(new PromptCancelError())).toBe(new PromptCancelError().message);
    expect(formatErrorMessage(abortError())).toBe("aborted");
    expect(formatErrorMessage("str")).toBe("str");
  });
});

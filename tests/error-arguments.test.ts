import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  CancelledError,
  CLIError,
  CommandNotFoundError,
  ExtraArgumentError,
  InputEndedError,
  InvalidOptionError,
  isCancellationError,
  MissingArgumentError,
  MissingOptionError,
  ParseError,
  UnknownOptionError,
  ValidationError,
} from "../src/index.js";

const ARG_TYPE = { code: "ERR_INVALID_ARG_TYPE" };

function abortedSignal(reason?: unknown): AbortSignal {
  const controller = new AbortController();
  if (reason === undefined) controller.abort();
  else controller.abort(reason);
  return controller.signal;
}

describe("isCancellationError", () => {
  it("accepts a CancelledError whatever the signal state", () => {
    expect(isCancellationError(new CancelledError(), new AbortController().signal)).toBe(true);
    expect(isCancellationError(new CancelledError(), abortedSignal())).toBe(true);
  });

  it("accepts an AbortError only while the signal is aborted", () => {
    const abortError = new DOMException("aborted", "AbortError");
    expect(isCancellationError(abortError, abortedSignal())).toBe(true);
    expect(isCancellationError(abortError, new AbortController().signal)).toBe(false);
  });

  it("accepts the signal's own reason, whatever its shape", () => {
    for (const reason of [new Error("custom"), "stop", 42, null, { a: 1 }]) {
      const signal = abortedSignal(reason);
      expect(isCancellationError(reason, signal)).toBe(true);
    }
  });

  it("accepts the TimeoutError produced by AbortSignal.timeout", async () => {
    const signal = AbortSignal.timeout(5);
    await sleep(30);
    expect(signal.aborted).toBe(true);
    expect(isCancellationError(signal.reason, signal)).toBe(true);
  });

  it("accepts a timers/promises rejection after the signal aborts", async () => {
    const controller = new AbortController();
    const pending = sleep(1000, undefined, { signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(isCancellationError(err, controller.signal)).toBe(true);
  });

  it("rejects the same values when the signal has not aborted", () => {
    const signal = new AbortController().signal;
    for (const value of [new Error("custom"), "stop", 42, null, undefined]) {
      expect(isCancellationError(value, signal)).toBe(false);
    }
  });

  it("does not treat an unrelated failure as a cancellation after an abort", () => {
    const signal = abortedSignal(new Error("reason"));
    expect(isCancellationError(new Error("real failure"), signal)).toBe(false);
    expect(isCancellationError("other", signal)).toBe(false);
  });

  it("rejects a signal that is not an AbortSignal, even for a CancelledError", () => {
    for (const bad of [undefined, null, {}, { aborted: true }, "signal", 0, Number.NaN, true]) {
      for (const err of [new CancelledError(), new Error("x")]) {
        let thrown: unknown;
        try {
          isCancellationError(err, bad as never);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(TypeError);
        expect(thrown).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
        expect((thrown as Error).message).toContain("isCancellationError()");
      }
    }
  });
});

describe("CommandNotFoundError", () => {
  it("copies available", () => {
    const available = ["a", "b"];
    const err = new CommandNotFoundError("x", { available });
    expect(err.available).toEqual(["a", "b"]);
    expect(err.available).not.toBe(available);
    available.push("c");
    expect(err.available).toEqual(["a", "b"]);
  });

  it("leaves available undefined when it is not given", () => {
    expect(new CommandNotFoundError("x").available).toBeUndefined();
  });
});

describe("error constructor argument validation", () => {
  const firstArgument: Array<[string, (v: never) => unknown]> = [
    ["CLIError", (v) => new CLIError(v)],
    ["CommandNotFoundError", (v) => new CommandNotFoundError(v)],
    ["MissingArgumentError", (v) => new MissingArgumentError(v)],
    ["MissingOptionError", (v) => new MissingOptionError(v)],
    ["InvalidOptionError", (v) => new InvalidOptionError(v)],
    ["UnknownOptionError", (v) => new UnknownOptionError(v)],
    ["ValidationError", (v) => new ValidationError(v)],
    ["ParseError", (v) => new ParseError(v)],
    ["InputEndedError", (v) => new InputEndedError(v)],
  ];

  it.each(firstArgument)("%s rejects a non-string first argument", (name, make) => {
    for (const bad of [undefined, null, 0, 1.5, Number.NaN, true, {}, ["a"]]) {
      let thrown: unknown;
      try {
        make(bad as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(thrown).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect((thrown as Error).message).toContain(name);
    }
  });

  it.each(firstArgument)("%s accepts an empty string first argument", (_name, make) => {
    expect(() => make("" as never)).not.toThrow();
  });

  const withOptions: Array<[string, (o: never) => unknown]> = [
    ["CLIError", (o) => new CLIError("m", o)],
    ["CommandNotFoundError", (o) => new CommandNotFoundError("x", o)],
    ["MissingArgumentError", (o) => new MissingArgumentError("x", o)],
    ["ExtraArgumentError", (o) => new ExtraArgumentError(["x"], o)],
    ["MissingOptionError", (o) => new MissingOptionError("x", o)],
    ["InvalidOptionError", (o) => new InvalidOptionError("m", o)],
    ["UnknownOptionError", (o) => new UnknownOptionError("--x", o)],
    ["ValidationError", (o) => new ValidationError("m", o)],
    ["CancelledError", (o) => new CancelledError(o)],
    ["InputEndedError", (o) => new InputEndedError("p", o)],
    ["ParseError", (o) => new ParseError("m", o)],
  ];

  it.each(withOptions)("%s rejects a non-object options", (name, make) => {
    for (const bad of [null, [], ["a"], "x", 0, true]) {
      let thrown: unknown;
      try {
        make(bad as never);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect(thrown).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect((thrown as Error).message).toContain(name);
    }
  });

  it.each(withOptions)("%s accepts omitted and empty options", (_name, make) => {
    expect(() => make(undefined as never)).not.toThrow();
    expect(() => make({} as never)).not.toThrow();
  });

  it("CLIError validates code", () => {
    expect(() => new CLIError("m", { code: 1 as never })).toThrow(
      expect.objectContaining(ARG_TYPE),
    );
    expect(() => new CLIError("m", { code: null as never })).toThrow(TypeError);
    expect(new CLIError("m", { code: "" }).code).toBe("");
  });

  it("usage must be a string where accepted", () => {
    const makers: Array<[string, (u: never) => unknown]> = [
      ["MissingArgumentError", (u) => new MissingArgumentError("x", { usage: u })],
      ["ExtraArgumentError", (u) => new ExtraArgumentError(["x"], { usage: u })],
      ["MissingOptionError", (u) => new MissingOptionError("x", { usage: u })],
      ["InvalidOptionError", (u) => new InvalidOptionError("m", { usage: u })],
      ["UnknownOptionError", (u) => new UnknownOptionError("--x", { usage: u })],
      ["ValidationError", (u) => new ValidationError("m", { usage: u })],
    ];
    for (const [name, make] of makers) {
      for (const bad of [1, null, {}, ["u"]]) {
        let thrown: unknown;
        try {
          make(bad as never);
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(TypeError);
        expect(thrown).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
        expect((thrown as Error).message).toContain(name);
      }
      expect(() => make("app run" as never)).not.toThrow();
      expect(() => make(undefined as never)).not.toThrow();
    }
  });

  it("optionName must be a string where accepted", () => {
    const makers: Array<(n: never) => unknown> = [
      (n) => new InvalidOptionError("m", { optionName: n }),
      (n) => new ValidationError("m", { optionName: n }),
    ];
    for (const make of makers) {
      for (const bad of [1, null, {}, ["n"]]) {
        expect(() => make(bad as never)).toThrow(expect.objectContaining(ARG_TYPE));
        expect(() => make(bad as never)).toThrow(TypeError);
      }
      expect(() => make("dry-run" as never)).not.toThrow();
    }
  });

  it("available must be an array of strings", () => {
    for (const bad of ["a", null, 1, {}, [1], ["a", null]]) {
      expect(() => new CommandNotFoundError("x", { available: bad as never })).toThrow(TypeError);
      expect(() => new CommandNotFoundError("x", { available: bad as never })).toThrow(
        expect.objectContaining(ARG_TYPE),
      );
    }
    expect(() => new CommandNotFoundError("x", { available: [] })).not.toThrow();
  });

  it("ParseError quote must be single or double", () => {
    for (const bad of ["", "backtick", "SINGLE", 1, null]) {
      let thrown: unknown;
      try {
        new ParseError("m", { quote: bad as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RangeError);
      expect(thrown).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
      expect((thrown as Error).message).toContain("ParseError");
    }
    expect(new ParseError("m", { quote: "single" }).quote).toBe("single");
    expect(new ParseError("m", { quote: "double" }).quote).toBe("double");
    expect(new ParseError("m").quote).toBeUndefined();
  });

  it("keeps the existing exitCode checks", () => {
    expect(() => new CLIError("m", { exitCode: "1" as never })).toThrow(TypeError);
    expect(() => new CLIError("m", { exitCode: 0 })).toThrow(RangeError);
  });
});

describe("errors.ts documentation", () => {
  const source = readFileSync(new URL("../src/errors.ts", import.meta.url), "utf8");

  it("documents the signal's reason near isCancellationError", () => {
    const at = source.indexOf("export function isCancellationError");
    expect(at).toBeGreaterThan(0);
    const doc = source.slice(Math.max(0, at - 1500), at);
    expect(doc).toContain("signal.reason");
  });

  it("documents @throws {TypeError} on every constructor", () => {
    const constructors = source.match(/^ {2}constructor\(/gm) ?? [];
    expect(constructors.length).toBe(11);
    const throwsCount = source.match(/@throws \{TypeError\}/g) ?? [];
    // One per constructor, plus the checkExitCode-independent isCancellationError entry.
    expect(throwsCount.length).toBeGreaterThanOrEqual(constructors.length);
    // Every constructor's TSDoc block holds the tag.
    const blocks = source.split(/\n(?= {2}\/\*\*)/).filter((b) => /^ {2}constructor\(/m.test(b));
    expect(blocks.length).toBe(11);
    for (const block of blocks) {
      const head = block.slice(0, block.search(/^ {2}constructor\(/m));
      expect(head).toContain("@throws {TypeError}");
    }
  });

  it("explains the program name in every usage description", () => {
    const mentions = source.match(/program name/g) ?? [];
    // Six classes declare `usage`; each member and constructor param says it.
    expect(mentions.length).toBeGreaterThanOrEqual(12);
  });
});

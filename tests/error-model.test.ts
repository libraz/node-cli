import { afterEach, describe, expect, it, vi } from "vitest";
import * as root from "../src/index.js";
import {
  CancelledError,
  CLIError,
  CommandNotFoundError,
  createCLI,
  ExtraArgumentError,
  formatErrorMessage,
  InputEndedError,
  InvalidOptionError,
  isBuiltinCLIError,
  isCancellationError,
  MissingArgumentError,
  MissingOptionError,
  ParseError,
  UnknownOptionError,
  ValidationError,
} from "../src/index.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

restoreProcessStateAfterEach(["NODE_CLI_DEBUG"]);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs a line and returns what it rejected with. */
async function failure(cli: ReturnType<typeof createCLI>, line: string): Promise<unknown> {
  const sink = createMockStdout();
  return cli.execLine(line, { stdout: sink, stderr: sink }).then(
    () => {
      throw new Error("expected a rejection");
    },
    (err: unknown) => err,
  );
}

describe("error class shapes", () => {
  const rows: [CLIError, string, number, string][] = [
    [new CommandNotFoundError("x"), "COMMAND_NOT_FOUND", 64, "CommandNotFoundError"],
    [new MissingArgumentError("a"), "MISSING_ARGUMENT", 64, "MissingArgumentError"],
    [new ExtraArgumentError(["a"]), "EXTRA_ARGUMENT", 64, "ExtraArgumentError"],
    [new MissingOptionError("o"), "MISSING_OPTION", 64, "MissingOptionError"],
    [new InvalidOptionError("m"), "INVALID_OPTION", 64, "InvalidOptionError"],
    [new UnknownOptionError("--x"), "UNKNOWN_OPTION", 64, "UnknownOptionError"],
    [new ValidationError("m"), "VALIDATION_FAILED", 64, "ValidationError"],
    [new ParseError("m"), "PARSE_FAILED", 64, "ParseError"],
    [new CancelledError(), "CANCELLED", 130, "CancelledError"],
    [new InputEndedError("Name?"), "INPUT_ENDED", 66, "InputEndedError"],
  ];

  it.each(rows)("%o carries its code, exit code and name", (error, code, exitCode, name) => {
    expect(error.code).toBe(code);
    expect(error.exitCode).toBe(exitCode);
    expect(error.name).toBe(name);
    expect(error).toBeInstanceOf(CLIError);
    expect(isBuiltinCLIError(error)).toBe(true);
  });

  it("forwards cause from every options bag", () => {
    const cause = new Error("root");
    const errors: CLIError[] = [
      new CommandNotFoundError("x", { cause }),
      new MissingArgumentError("a", { cause }),
      new ExtraArgumentError(["a"], { cause }),
      new MissingOptionError("o", { cause }),
      new InvalidOptionError("m", { cause }),
      new UnknownOptionError("--x", { cause }),
      new ValidationError("m", { cause }),
      new ParseError("m", { cause }),
      new CancelledError({ cause }),
      new InputEndedError("Name?", { cause }),
    ];
    for (const error of errors) expect(error.cause).toBe(cause);
  });

  it("keeps the class-specific fields", () => {
    expect(new CommandNotFoundError("x", { available: ["a"] }).available).toEqual(["a"]);
    expect(new ExtraArgumentError(["a", "b"]).extras).toEqual(["a", "b"]);
    expect(new MissingOptionError("dry-run").optionName).toBe("dry-run");
    const invalid = new InvalidOptionError("m", { optionName: "port", value: "x" });
    expect([invalid.optionName, invalid.value]).toEqual(["port", "x"]);
    const validation = new ValidationError("m", { optionName: "port", value: 3 });
    expect([validation.optionName, validation.value]).toEqual(["port", 3]);
    const unknown = new UnknownOptionError("--dry-run");
    expect([unknown.flag, unknown.optionName]).toEqual(["--dry-run", "dry-run"]);
    expect(new UnknownOptionError("-x").optionName).toBe("x");
    expect(new InputEndedError("Name?").promptMessage).toBe("Name?");
  });

  it("drops ExtraArgumentError.extra", () => {
    expect("extra" in new ExtraArgumentError(["a"])).toBe(false);
  });
});

describe("ExtraArgumentError construction", () => {
  it("rejects an empty list with ERR_INVALID_ARG_VALUE", () => {
    expect(() => new ExtraArgumentError([])).toThrow(RangeError);
    expect(() => new ExtraArgumentError([])).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("rejects a non-array or a non-string element with ERR_INVALID_ARG_TYPE", () => {
    for (const bad of [null, "a", ["a", 1], ["a", undefined]]) {
      expect(() => new ExtraArgumentError(bad as never)).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
      );
    }
  });
});

describe("CLIError construction", () => {
  it("builds from a message alone with code FAILED and exit code 1", () => {
    const error = new CLIError("boom");
    expect(error.message).toBe("boom");
    expect(error.code).toBe("FAILED");
    expect(error.exitCode).toBe(1);
    expect(isBuiltinCLIError(error)).toBe(false);
  });

  it("accepts exit codes 1 through 255", () => {
    expect(new CLIError("m", { exitCode: 1 }).exitCode).toBe(1);
    expect(new CLIError("m", { exitCode: 255 }).exitCode).toBe(255);
    expect(new CLIError("m", { exitCode: undefined }).exitCode).toBe(1);
  });

  it("rejects an exit code out of range or not an integer", () => {
    for (const exitCode of [0, -0, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
      expect(() => new CLIError("m", { exitCode })).toThrow(
        expect.objectContaining({ name: "RangeError", code: "ERR_INVALID_ARG_VALUE" }),
      );
    }
  });

  it("rejects an exit code that is not a number", () => {
    for (const exitCode of ["2", true, null]) {
      expect(() => new CLIError("m", { exitCode: exitCode as never })).toThrow(
        expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
      );
    }
  });
});

describe("messages", () => {
  it("appends the usage line to the command-resolution errors", () => {
    const usage = "deploy <env> [options]";
    const errors: CLIError[] = [
      new MissingArgumentError("env", { usage }),
      new ExtraArgumentError(["x"], { usage }),
      new MissingOptionError("tag", { usage }),
      new InvalidOptionError("bad", { usage }),
      new UnknownOptionError("--x", { usage }),
      new ValidationError("bad", { usage }),
    ];
    for (const error of errors) {
      expect(error.message).toContain(`\n\n  Usage: ${usage}`);
      expect((error as { usage?: string }).usage).toBe(usage);
    }
  });

  it("quotes user input and leaves author names bare", () => {
    expect(new UnknownOptionError("--x").message).toBe('Unknown option: "--x"');
    expect(new MissingOptionError("x").message).toBe("Missing required option: --x");
    expect(new ExtraArgumentError(["a"]).message).toBe('Unexpected argument: "a"');
    expect(new CommandNotFoundError("nope").message).toBe('Command not found: "nope"');
  });

  it("lists available commands under one heading only when given", () => {
    expect(new CommandNotFoundError("x", { available: ["a", "b"] }).message).toContain(
      "Available commands: a, b",
    );
    expect(new CommandNotFoundError("x").message).not.toContain("Available");
  });

  it("names the cancellation and the exhausted prompt", () => {
    expect(new CancelledError().message).toBe("Cancelled");
    expect(new InputEndedError("Name?").message).toBe("No input available for the prompt: Name?");
  });
});

describe("isCancellationError", () => {
  it("is true for a CancelledError whatever the signal", () => {
    expect(isCancellationError(new CancelledError(), new AbortController().signal)).toBe(true);
    const aborted = new AbortController();
    aborted.abort();
    expect(isCancellationError(new CancelledError(), aborted.signal)).toBe(true);
  });
});

describe("raised through execLine", () => {
  function app() {
    const cli = createCLI({ name: "test" });
    cli
      .command("deploy <env>")
      .option("--tag <tag>", { required: true })
      .option("--port <n>", { type: "number" })
      .option("--level <level>", {
        validate: (value) => {
          if (value === "bad") throw new Error("not allowed");
        },
      })
      .action(() => {});
    return cli;
  }

  it("exits 64 for an unknown command", async () => {
    const error = await failure(app(), "nope");
    expect(error).toMatchObject({ code: "COMMAND_NOT_FOUND", exitCode: 64 });
  });

  it("carries the command usage on every resolution failure", async () => {
    const usage = "\n\n  Usage: deploy <env> [options]";
    const cases: [string, string][] = [
      ["deploy", "MISSING_ARGUMENT"],
      ["deploy prod extra --tag t", "EXTRA_ARGUMENT"],
      ["deploy prod", "MISSING_OPTION"],
      ["deploy prod --tag t --port x", "INVALID_OPTION"],
      ["deploy prod --tag t --nope", "UNKNOWN_OPTION"],
      ["deploy prod --tag t --level bad", "VALIDATION_FAILED"],
    ];
    for (const [line, code] of cases) {
      const error = await failure(app(), line);
      expect(error, line).toMatchObject({ code, exitCode: 64 });
      expect((error as Error).message, line).toContain(usage);
    }
  });

  it("normalizes a non-Error throw from an action and keeps the value as cause", async () => {
    const cli = createCLI({ name: "test" });
    const thrown = { code: 42 };
    cli.command("boom").action(() => {
      throw thrown;
    });
    const error = await failure(cli, "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CLIError);
    expect((error as Error).message).toContain("code: 42");
    expect((error as Error).cause).toBe(thrown);
  });

  it("uses a thrown string as the message and keeps it as cause", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("boom").action(() => {
      throw "plain words";
    });
    const error = await failure(cli, "boom");
    expect((error as Error).message).toBe("plain words");
    expect((error as Error).cause).toBe("plain words");
  });

  it("exits 1 for an Error thrown by the action itself", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("boom").action(() => {
      throw new Error("broken");
    });
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    expect(await cli.start(["boom"])).toBe(1);
    expect(writes.join("")).toContain("Error: broken");
  });
});

describe("formatErrorMessage and diagnostics", () => {
  it("removes control sequences and hyperlinks but keeps newlines", () => {
    const text = formatErrorMessage(
      new Error("one\x1b[2J\nlink: \x1b]8;;https://example.com\x07here\x1b]8;;\x07\x07"),
    );
    expect(text).toContain("one\nlink: here");
    expect(text).not.toContain("\x1b]8");
    expect(text).not.toContain("\x1b[2J");
    expect(text).not.toContain("\x07");
  });

  it("closes a style the message leaves open", () => {
    expect(formatErrorMessage(new Error("\x1b[31mred"))).toBe("\x1b[31mred\x1b[39m");
  });

  it("strips hyperlinks from the framework's own diagnostic", async () => {
    const cli = createCLI({ name: "test" });
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    const code = await cli.start(["\x1b]8;;https://example.com\x07name\x1b]8;;\x07"]);
    expect(code).toBe(64);
    const out = writes.join("");
    expect(out).toContain("name");
    expect(out).not.toContain("\x1b]8");
  });

  it("prints the cause chain under NODE_CLI_DEBUG", async () => {
    const cli = createCLI({ name: "test" });
    const inner = new Error("inner failure");
    inner.stack = "Error: inner failure\n    at inner";
    const outer = new Error("outer failure", { cause: inner });
    outer.stack = "Error: outer failure\n    at outer";
    cli.command("boom").action(() => {
      throw outer;
    });
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    process.env.NODE_CLI_DEBUG = "1";
    await cli.start(["boom"]);
    const out = writes.join("");
    expect(out).toContain("at outer");
    expect(out).toContain("[cause] Error: inner failure\n    at inner");
  });
});

describe("root surface", () => {
  it("does not export quoteValue", () => {
    expect("quoteValue" in root).toBe(false);
  });
});

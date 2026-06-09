import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { parse, parseDefinitionString, splitPipes, tokenize } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import {
  CLIError,
  CommandNotFoundError,
  ExtraArgumentError,
  InvalidOptionError,
  MissingArgumentError,
  MissingOptionError,
  UnknownOptionError,
  ValidationError,
} from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import { resolveOptions } from "../src/option/resolver.js";
import {
  color,
  createColorizer,
  resetColorEnabled,
  setColorEnabled,
  stringWidth,
  stripAnsi,
} from "../src/output/color.js";
import { logger } from "../src/output/logger.js";
import { progress } from "../src/output/progress.js";
import { maskInput, prompt } from "../src/output/prompt.js";
import { table } from "../src/output/table.js";
import { ShellCompleter } from "../src/shell/completion.js";
import type { CommandContext } from "../src/types.js";
import { createMockStdin, createMockStdout, createMockTTY } from "./helpers.js";

function ctxStub(): CommandContext {
  const out = createMockStdout();
  return {
    args: {},
    options: {},
    rawInput: "",
    commandPath: [],
    shell: null,
    stdin: null,
    stdout: out,
    stderr: out,
  };
}

// ── Structured errors (T-2) ──

describe("structured errors", () => {
  it("carry machine-readable fields", () => {
    expect(new CommandNotFoundError("foo").input).toBe("foo");
    expect(new MissingArgumentError("name", "use x").argName).toBe("name");
    expect(new ExtraArgumentError("extra").extra).toBe("extra");
    expect(new MissingOptionError("port").optionName).toBe("port");
    expect(new UnknownOptionError("--x").flag).toBe("--x");
    expect(new InvalidOptionError("bad", { optionName: "p", value: "x" }).optionName).toBe("p");
    expect(new InvalidOptionError("bad", { value: 7 }).value).toBe(7);
  });

  it("default exitCode is 1; subclasses keep instanceof", () => {
    const err = new MissingArgumentError("name");
    expect(err.exitCode).toBe(1);
    expect(err).toBeInstanceOf(CLIError);
    expect(err).toBeInstanceOf(MissingArgumentError);
    expect(err.code).toBe("MISSING_ARGUMENT");
  });

  it("ValidationError preserves the wrapped cause and stack", () => {
    const original = new Error("nope");
    const wrapped = new ValidationError("nope", original);
    expect(wrapped.cause).toBe(original);
    expect(wrapped.stack).toBe(original.stack);
  });
});

// ── version / top-level help interception (H-2, #90) ──

describe("version and top-level help", () => {
  function router() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "greet <name>").action(() => {});
    const r = new CommandRouter(registry);
    r.setVersion("1.2.3");
    r.setHelpGenerator(new HelpGenerator(registry, { name: "app", version: "1.2.3" }));
    return r;
  }

  it("--version and -V print the version", async () => {
    for (const flag of ["--version", "-V"]) {
      const out = createMockStdout();
      await router().execute(flag, { stdout: out, stderr: out });
      expect(out.getOutput().trim()).toBe("1.2.3");
    }
  });

  it("bare --help / -h print the index", async () => {
    for (const flag of ["--help", "-h"]) {
      const out = createMockStdout();
      await router().execute(flag, { stdout: out, stderr: out });
      expect(out.getOutput()).toContain("Available commands");
    }
  });
});

// ── alias collisions & wiring (H-3, T-4) ──

describe("alias handling", () => {
  it("throws when an alias collides with an existing command", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "list").action(() => {});
    const ls = new CommandBuilder(registry, "ls").action(() => {});
    expect(() => ls.alias("list")).toThrow(/conflicts/);
  });

  it("does not let aliases inflate subcommand counts", () => {
    const registry = new CommandRegistry();
    const user = new CommandBuilder(registry, "user");
    user
      .command("create <n>")
      .alias("c", "new")
      .action(() => {});
    const cmd = registry.resolve(["user"]);
    // One real subcommand, regardless of its two aliases.
    expect(cmd?.subcommands.size).toBe(1);
    expect(registry.resolve(["user", "c"])?.name).toBe("create");
    expect(registry.resolve(["user", "new"])?.name).toBe("create");
  });

  it("dedupes repeated aliases and the command's own name", () => {
    const registry = new CommandRegistry();
    const b = new CommandBuilder(registry, "deploy").alias("d", "d", "deploy").action(() => {});
    expect(b.command).toBeTypeOf("function");
    expect(registry.resolve(["deploy"])?.aliases).toEqual(["d"]);
  });
});

// ── OptionSchema.alias wiring (H-4) & schema isolation (#3) ──

describe("option schema wiring", () => {
  it("honours schema.alias as a short flag", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "serve").option("--port <n>", {
      type: "number",
      alias: "p",
    });
    const result = parse(["serve", "-p", "8080"], registry);
    expect(result.options.port ?? result.options.p).toBeDefined();
  });

  it("does not mutate the caller's schema object", () => {
    const registry = new CommandRegistry();
    const schema = {} as Record<string, unknown>;
    new CommandBuilder(registry, "x").option("--flag", schema);
    expect(schema.type).toBeUndefined();
    expect(schema.default).toBeUndefined();
  });
});

// ── option resolver (H-5, #6/#20, #19) ──

describe("option resolver", () => {
  function defs(flags: string, schema: Record<string, unknown>) {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "c").option(flags, schema);
    return registry.resolve(["c"])?.options ?? new Map();
  }

  it("rejects empty-string numbers instead of coercing to 0", () => {
    expect(() =>
      resolveOptions({ port: "" }, defs("--port <n>", { type: "number" }), ctxStub()),
    ).toThrow(InvalidOptionError);
  });

  it("runs a custom parse on the raw string before built-in coercion", () => {
    const seen: string[] = [];
    const d = defs("--tags <v>", {
      type: "string[]",
      parse: (v: string) => {
        seen.push(v);
        return v.toUpperCase();
      },
    });
    const out = resolveOptions({ tags: ["a", "b"] }, d, ctxStub());
    expect(seen).toEqual(["a", "b"]);
    expect(out.tags).toEqual(["A", "B"]);
  });

  it("matches choices leniently across string/number", () => {
    const d = defs("--level <n>", { type: "number", choices: ["1", "2", "3"] });
    const out = resolveOptions({ level: "2" }, d, ctxStub());
    expect(out.level).toBe(2);
  });
});

// ── router error emission across phases (M-1) ──

describe("router error events", () => {
  function router() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .option("--count <n>", { type: "number" })
      .action(() => {});
    return new CommandRouter(registry);
  }

  it("emits commandError + error for a missing required argument", async () => {
    const r = router();
    const cmdErr: Error[] = [];
    const generic: Error[] = [];
    r.on("commandError", (e) => cmdErr.push(e));
    r.on("error", (e) => generic.push(e));
    const out = createMockStdout();
    await expect(r.execute("deploy", { stdout: out, stderr: out })).rejects.toBeInstanceOf(
      MissingArgumentError,
    );
    expect(cmdErr[0]).toBeInstanceOf(MissingArgumentError);
    expect(generic[0]).toBeInstanceOf(MissingArgumentError);
  });

  it("emits error for command-not-found", async () => {
    const r = router();
    const generic: Error[] = [];
    r.on("error", (e) => generic.push(e));
    const out = createMockStdout();
    await expect(r.execute("nope", { stdout: out, stderr: out })).rejects.toBeInstanceOf(
      CommandNotFoundError,
    );
    expect(generic[0]).toBeInstanceOf(CommandNotFoundError);
  });

  it("a throwing event listener does not abort command flow", async () => {
    const registry = new CommandRegistry();
    let ran = false;
    new CommandBuilder(registry, "deploy <env>").action(() => {
      ran = true;
    });
    const r = new CommandRouter(registry);
    r.on("beforeExecute", () => {
      throw new Error("listener boom");
    });
    const out = createMockStdout();
    await r.execute("deploy prod", { stdout: out, stderr: out });
    expect(ran).toBe(true);
  });
});

// ── required variadic (#1) ──

describe("required variadic argument", () => {
  it("fails when zero values are provided", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "add <...files>").action(() => {});
    const r = new CommandRouter(registry);
    const out = createMockStdout();
    await expect(r.execute("add", { stdout: out, stderr: out })).rejects.toBeInstanceOf(
      MissingArgumentError,
    );
  });
});

// ── command cancellation (H-1) ──

describe("command cancellation", () => {
  it("invokes the active command's cancel handler via triggerCancel()", async () => {
    const registry = new CommandRegistry();
    const cancel = vi.fn();
    new CommandBuilder(registry, "work").cancel(cancel).action(async () => {
      // The handler should be reachable while the action is in flight.
      expect(r.triggerCancel()).toBe(true);
    });
    const r = new CommandRouter(registry);
    const out = createMockStdout();
    await r.execute("work", { stdout: out, stderr: out });
    expect(cancel).toHaveBeenCalledOnce();
    // No active command after completion.
    expect(r.triggerCancel()).toBe(false);
  });
});

// ── definition-time validation (D-2) ──

describe("definition parsing validation", () => {
  it("rejects an empty command name", () => {
    expect(() => parseDefinitionString("   ")).toThrow(/missing command name/);
  });
  it("rejects a non-final variadic argument", () => {
    expect(() => parseDefinitionString("cp <...src> <dest>")).toThrow(/must be last/);
  });
});

// ── tokenize / splitPipes unification (D-1) ──

describe("tokenize and splitPipes", () => {
  it("tokenize strips quotes and escapes", () => {
    expect(tokenize(`run "a b" c\\ d`)).toEqual(["run", "a b", "c d"]);
  });
  it("splitPipes preserves quoting and ignores quoted pipes", () => {
    expect(splitPipes(`echo "a | b" | grep a`)).toEqual([`echo "a | b"`, "grep a"]);
  });
});

// ── color: nesting, width, strip, per-stream (T-1) ──

describe("color and width", () => {
  beforeEach(() => setColorEnabled(true));
  afterEach(() => resetColorEnabled());

  it("re-opens the outer color after a nested reset (no bleed)", () => {
    const nested = color.red(`a ${color.green("b")} c`);
    // After the inner green close, red must resume before "c".
    const lastReset = nested.lastIndexOf("\x1b[39m");
    expect(nested.slice(0, lastReset)).toContain("\x1b[31m c");
  });

  it("measures wide, zero-width and emoji characters", () => {
    expect(stringWidth("あいう")).toBe(6); // 3 wide CJK
    expect(stringWidth("á")).toBe(1); // combining accent = 0 width
    expect(stringWidth("😀")).toBe(2); // emoji
    expect(stringWidth("\x1b[31mhi\x1b[39m")).toBe(2); // ANSI stripped
  });

  it("stripAnsi removes OSC and cursor sequences", () => {
    expect(stripAnsi("\x1b[2K\x1b[1mhi\x1b[0m")).toBe("hi");
  });

  it("createColorizer disables color for a non-TTY stream", () => {
    resetColorEnabled();
    const plain = createColorizer(createMockStdout());
    expect(plain.red("x")).toBe("x");
    const tty = createColorizer(createMockTTY());
    expect(tty.red("x")).toContain("\x1b[31m");
  });
});

// ── table robustness (H-7) ──

describe("table robustness", () => {
  it("truncates an over-wide header to keep the frame aligned", () => {
    const out = table([{ name: "alice" }], {
      border: "single",
      headerLabels: { name: "Full Name" },
      maxWidth: { name: 5 },
    });
    const lines = out.split("\n").map((l) => stripAnsi(l).length);
    // All rendered lines share the same visual width.
    expect(new Set(lines).size).toBe(1);
  });

  it("sanitizes embedded newlines so rows do not break the frame", () => {
    const out = table([{ msg: "line1\nline2" }], { border: "single" });
    expect(out).not.toContain("line1\nline2");
    expect(out).toContain("line1 line2");
  });

  it("includes keys present only on later rows", () => {
    const out = table([{ a: 1 }, { a: 2, b: 3 }], { border: "none" });
    expect(out).toContain("b");
    expect(out).toContain("3");
  });
});

// ── progress hygiene (M-6, #62, #63) ──

describe("progress hygiene", () => {
  it("spinner.stop() is idempotent and clears its timer", () => {
    const stream = createMockTTY();
    const sp = progress.spinner({ stream, label: "x" });
    sp.start();
    sp.succeed("done");
    // Second terminal call must be a no-op (no extra output).
    const before = stream.getOutput();
    sp.fail("again");
    expect(stream.getOutput()).toBe(before);
  });

  it("bar.update clamps within [0, total]", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stream });
    bar.update(999);
    expect(stream.getOutput()).toContain("10/10");
  });
});

// ── prompt masking & selection (H-8, M-5) ──

describe("prompt fixes", () => {
  it("maskInput masks digits and symbols but preserves ANSI/newlines", () => {
    expect(maskInput("pass123")).toBe("*******");
    expect(maskInput("a;[1")).toBe("****");
    expect(maskInput("\x1b[2Kx\n")).toBe("\x1b[2K*\n");
  });

  it("select returns the default on empty input", async () => {
    const stdin = createMockStdin();
    const stdout = createMockStdout();
    const p = prompt.select("Pick", ["a", "b", "c"], {
      default: "b",
      stdin,
      stdout,
    });
    setTimeout(() => stdin.feed("\n"), 5);
    await expect(p).resolves.toBe("b");
  });

  it("select rejects empty choices", async () => {
    await expect(prompt.select("Pick", [])).rejects.toThrow(/at least one/);
  });
});

// ── logger child level propagation (#70) ──

describe("logger child level", () => {
  it("propagates setLevel to existing children", () => {
    const stream = createMockStdout();
    const log = logger({ level: "info", stream });
    const child = log.child("db");
    log.setLevel("debug");
    child.debug("hello");
    expect(stream.getOutput()).toContain("hello");
  });
});

// ── help completeness (M-11) ──

describe("help completeness", () => {
  function help() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .alias("d")
      .option("--force", { type: "boolean", default: true })
      .action(() => {});
    return new HelpGenerator(registry);
  }

  it("always advertises --help and shows canonical name", () => {
    const out = help().generateCommand(["d"]); // resolve via alias
    expect(out).toContain("--help");
    expect(out).toMatch(/Usage:\s+deploy/);
  });

  it("shows a boolean default of true", () => {
    expect(help().generateCommand(["deploy"])).toContain("default: true");
  });
});

// ── completion improvements (M-10) ──

describe("completion improvements", () => {
  function completer() {
    const registry = new CommandRegistry();
    const b = new CommandBuilder(registry, "git");
    b.command("commit")
      .option("--message <m>", { type: "string" })
      .action(() => {});
    return new ShellCompleter(registry);
  }

  it("offers option flags even when a command has subcommands", () => {
    const [candidates] = completer().complete("git commit -") as [string[], string];
    expect(candidates).toContain("--message");
  });
});

// ── completer context population (#38, #40) ──

describe("custom completer context", () => {
  it("receives parsed args/options and is prefix-filtered", () => {
    const registry = new CommandRegistry();
    let received: { options: Record<string, unknown> } | null = null;
    new CommandBuilder(registry, "run")
      .option("--env <e>", { type: "string" })
      .complete((c) => {
        received = c;
        return ["alpha", "beta"];
      })
      .action(() => {});
    const completer = new ShellCompleter(registry);
    const [candidates] = completer.complete("run --env prod a") as [string[], string];
    expect(received?.options.env).toBe("prod");
    expect(candidates).toEqual(["alpha"]);
  });
});

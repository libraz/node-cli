import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { parse, parseDefinitionString, splitPipes, tokenize } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import {
  CancelledError,
  CLIError,
  CommandNotFoundError,
  ExtraArgumentError,
  formatErrorMessage,
  InvalidOptionError,
  isCancellationError,
  MissingArgumentError,
  MissingOptionError,
  UnknownOptionError,
  ValidationError,
} from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import { createCLI } from "../src/index.js";
import { resolveOptions } from "../src/option/resolver.js";
import {
  color,
  createColorizer,
  setColorEnabled,
  stringWidth,
  stripAnsi,
} from "../src/output/color.js";
import { createLogger } from "../src/output/logger.js";
import { progress } from "../src/output/progress.js";
import { maskInput, prompt } from "../src/output/prompt.js";
import { table } from "../src/output/table.js";
import { ShellCompleter } from "../src/shell/completion.js";
import type { CommandContext } from "../src/types.js";
import {
  createMockStdin,
  createMockStdout,
  createMockTTY,
  restoreProcessStateAfterEach,
} from "./helpers.js";

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
    signal: new AbortController().signal,
  };
}

// ── Structured errors ──

describe("structured errors", () => {
  it("carry machine-readable fields", () => {
    expect(new CommandNotFoundError("foo").input).toBe("foo");
    expect(new MissingArgumentError("name", { usage: "use x" }).argName).toBe("name");
    expect(new ExtraArgumentError(["extra"]).extras).toEqual(["extra"]);
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

  it("ValidationError preserves the wrapped cause without replacing its own stack", () => {
    const original = new Error("nope");
    const wrapped = new ValidationError("nope", { cause: original });
    expect(wrapped.cause).toBe(original);
    expect(wrapped.stack).toContain("ValidationError: nope");
    expect(wrapped.stack).not.toBe(original.stack);
  });
});

// ── version / top-level help interception ──

describe("version and top-level help", () => {
  function router() {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "greet <name>").action(() => {});
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

// ── alias collisions and wiring ──

describe("alias handling", () => {
  it("throws when an alias collides with an existing command", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "list").action(() => {});
    const ls = CommandBuilder.create(registry, "ls").action(() => {});
    expect(() => ls.alias("list")).toThrow(/conflicts/);
  });

  it("does not let aliases inflate subcommand counts", () => {
    const registry = new CommandRegistry();
    const user = CommandBuilder.create(registry, "user");
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
    const b = CommandBuilder.create(registry, "deploy")
      .alias("d", "d", "deploy")
      .action(() => {});
    expect(b.command).toBeTypeOf("function");
    expect(registry.resolve(["deploy"])?.aliases).toEqual(["d"]);
  });
});

// ── OptionSchema.alias wiring and schema isolation ──

describe("option schema wiring", () => {
  it("honours schema.alias as a short flag", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "serve").option("--port <n>", {
      type: "number",
      alias: "p",
    });
    const result = parse(["serve", "-p", "8080"], registry);
    expect(result.options).toMatchObject({ port: "8080" });
    expect(result.options).not.toHaveProperty("p");
  });

  it("does not mutate the caller's schema object", () => {
    const registry = new CommandRegistry();
    const schema = {} as Record<string, unknown>;
    CommandBuilder.create(registry, "x").option("--flag", schema);
    expect(schema.type).toBeUndefined();
    expect(schema.default).toBeUndefined();
  });

  it("rejects invalid defaults while the option is being defined", () => {
    const registry = new CommandRegistry();
    expect(() =>
      CommandBuilder.create(registry, "serve").option("--port <port>", {
        type: "number",
        default: "not-a-number",
      }),
    ).toThrow(/Invalid default for --port/);
    expect(() =>
      CommandBuilder.create(registry, "mode").option("--env <env>", {
        choices: ["dev", "prod"],
        default: "test",
      }),
    ).toThrow(/declared choices/);
  });
});

// ── option resolver ──

describe("option resolver", () => {
  function defs(flags: string, schema: Record<string, unknown>) {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "c").option(flags, schema);
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

// ── router error emission across phases ──

describe("router error events", () => {
  function router() {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy <env>")
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
    CommandBuilder.create(registry, "deploy <env>").action(() => {
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

// ── required variadic ──

describe("required variadic argument", () => {
  it("fails when zero values are provided", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "add <...files>").action(() => {});
    const r = new CommandRouter(registry);
    const out = createMockStdout();
    await expect(r.execute("add", { stdout: out, stderr: out })).rejects.toBeInstanceOf(
      MissingArgumentError,
    );
  });
});

// ── command cancellation ──

describe("command cancellation", () => {
  it("invokes the active command's cancel handler via triggerCancel()", async () => {
    const registry = new CommandRegistry();
    const cancel = vi.fn();
    CommandBuilder.create(registry, "work")
      .onCancel(cancel)
      .action(async () => {
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

// ── definition-time validation ──

describe("definition parsing validation", () => {
  it("rejects an empty command name", () => {
    expect(() => parseDefinitionString("   ")).toThrow(/missing command name/);
  });
  it("rejects a non-final variadic argument", () => {
    expect(() => parseDefinitionString("cp <...src> <dest>")).toThrow(/must be last/);
  });
  it("rejects duplicate positional argument names", () => {
    expect(() => parseDefinitionString("copy <file> <file>")).toThrow(/duplicate argument/);
  });
  it("rejects a required positional after an optional positional", () => {
    expect(() => parseDefinitionString("copy [source] <destination>")).toThrow(
      /cannot follow an optional/,
    );
  });
});

// ── tokenize / splitPipes unification ──

describe("tokenize and splitPipes", () => {
  it("tokenize strips quotes and escapes", () => {
    expect(tokenize(`run "a b" c\\ d`)).toEqual(["run", "a b", "c d"]);
  });
  it("splitPipes preserves quoting and ignores quoted pipes", () => {
    expect(splitPipes(`echo "a | b" | grep a`)).toEqual([`echo "a | b"`, "grep a"]);
  });
});

// ── color: nesting, width, strip, per-stream ──

describe("color and width", () => {
  restoreProcessStateAfterEach(["NO_COLOR", "FORCE_COLOR", "TERM"]);
  beforeEach(() => setColorEnabled(true));
  afterEach(() => setColorEnabled("auto"));

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
    setColorEnabled("auto");
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.TERM = "xterm";
    const plain = createColorizer(createMockStdout());
    expect(plain.red("x")).toBe("x");
    const tty = createColorizer(createMockTTY());
    expect(tty.red("x")).toContain("\x1b[31m");
  });
});

// ── table robustness ──

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

// ── progress hygiene ──

describe("progress hygiene", () => {
  it("a finished spinner ignores further terminal calls and holds no timer", () => {
    vi.useFakeTimers();
    try {
      const stream = createMockTTY();
      const sp = progress.spinner({ stderr: stream, label: "x" });
      expect(vi.getTimerCount()).toBe(1);
      sp.succeed("done");
      expect(vi.getTimerCount()).toBe(0);
      // Second terminal call must be a no-op (no extra output).
      const before = stream.getOutput();
      sp.fail("again");
      sp.stop();
      expect(stream.getOutput()).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bar.update clamps within [0, total]", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stderr: stream });
    try {
      bar.update(-5);
      expect(stream.getOutput()).toContain("0/10");
      bar.update(999);
      expect(stream.getOutput()).toContain("10/10");
      expect(stream.getOutput()).not.toContain("999");
      expect(stream.getOutput()).not.toContain("-5");
    } finally {
      bar.stop();
    }
  });
});

// ── prompt masking and selection ──

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

// ── logger child level propagation ──

describe("logger child level", () => {
  it("propagates setLevel to existing children", () => {
    const stream = createMockStdout();
    const log = createLogger({ level: "info", stderr: stream });
    const child = log.child("db");
    log.setLevel("debug");
    child.debug("hello");
    expect(stream.getOutput()).toContain("hello");
  });
});

// ── help completeness ──

describe("help completeness", () => {
  function help() {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy <env>")
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

// ── completion behavior ──

describe("completion improvements", () => {
  function completer() {
    const registry = new CommandRegistry();
    const b = CommandBuilder.create(registry, "git");
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

// ── completer context population ──

describe("custom completer context", () => {
  it("receives parsed args/options and is prefix-filtered", () => {
    const registry = new CommandRegistry();
    let received: { options: Record<string, unknown> } | null = null;
    CommandBuilder.create(registry, "run")
      .option("--env <e>", { type: "string" })
      .completer((c) => {
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

// ── Pipeline early termination ──

describe("pipeline early termination", () => {
  it("does not fail when a downstream stage stops early and the producer is signal-aware", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "produce").action(
      (ctx) =>
        new Promise<void>((_resolve, reject) => {
          const timer = setInterval(() => ctx.stdout.write("data\n"), 5);
          // The documented idiom: reject when cancellation is signalled, as fetch/timers do.
          ctx.signal.addEventListener("abort", () => {
            clearInterval(timer);
            reject(ctx.signal.reason ?? new Error("aborted"));
          });
        }),
    );
    CommandBuilder.create(registry, "head1").action(async (ctx) => {
      if (ctx.stdin) await new Promise<void>((resolve) => ctx.stdin?.once("data", () => resolve()));
      ctx.stdout.write("ok");
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    await expect(
      router.execute("produce | head1", { stdout: stream, stderr: stream }),
    ).resolves.toBeUndefined();
    expect(stream.getOutput()).toContain("ok");
  });
});

// ── Subcommands shadowed by a positional argument ──

describe("subcommands shadowed by a positional argument", () => {
  const build = () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy <env>").action(() => {});
    CommandBuilder.create(registry, "deploy status").action(() => {});
    return registry;
  };

  it("are omitted from help", () => {
    const help = new HelpGenerator(build()).generateCommand(["deploy"]);
    expect(help).not.toContain("status");
  });

  it("are not offered by completion", () => {
    const [candidates] = new ShellCompleter(build()).complete("deploy ") as [string[], string];
    expect(candidates).not.toContain("status");
  });

  it("still dispatch to the argument-taking command", () => {
    const result = parse(["deploy", "status"], build());
    expect(result.command?.name).toBe("deploy");
    expect(result.args.env).toBe("status");
  });
});

// ── Quote handling in pipe splitting ──

describe("quote handling in pipe splitting", () => {
  it("treats a backslash inside single quotes as literal, matching tokenize", () => {
    expect(() => splitPipes("echo 'a\\'")).not.toThrow();
    expect(splitPipes("echo 'a\\'")).toEqual(["echo 'a\\'"]);
    expect(tokenize("echo 'a\\'")).toEqual(["echo", "a\\"]);
  });
});

// ── Negative-number arguments ──

describe("negative-number arguments", () => {
  it("parses a bare negative number as a positional value, not an unknown option", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "calc <n>").action(() => {});
    expect(parse(["calc", "-5"], registry).args.n).toBe("-5");
    expect(parse(["calc", "-.5"], registry).args.n).toBe("-.5");
    expect(parse(["calc", "-3.14"], registry).args.n).toBe("-3.14");
    expect(parse(["calc", "-1e3"], registry).args.n).toBe("-1e3");
  });

  it("gives an exact numeric-looking option alias precedence over positional parsing", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "calc [n]")
      .option("-1, --one")
      .action(() => {});
    const result = parse(["calc", "-1"], registry);
    expect(result.options.one).toBe(true);
    expect(result.args.n).toBeUndefined();
  });
});

// ── Built-in help flag ──

describe("built-in help flag", () => {
  it("still triggers help inside a short-flag cluster", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "x").option("-v, --verbose");
    const result = parse(["x", "-vh"], registry);
    expect(result.builtInHelp).toBe(true);
    expect(result.options.verbose).toBe(true);
  });

  const withBoundShort = () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "srv").option("-h, --host <host>");
    return registry;
  };

  it("is advertised as --help alone when -h is bound to another option", () => {
    const help = new HelpGenerator(withBoundShort()).generateCommand(["srv"]);
    expect(help).toContain("Show help for this command");
    expect(help).not.toContain("-h, --help");
  });

  it("is not duplicated in completion when -h is bound to another option", () => {
    const [candidates] = new ShellCompleter(withBoundShort()).complete("srv -") as [
      string[],
      string,
    ];
    expect(candidates).toContain("--help");
    expect(candidates.filter((c) => c === "-h")).toHaveLength(1);
  });

  it("still resolves --help via the parser fallback when -h is bound", () => {
    expect(parse(["srv", "--help"], withBoundShort()).builtInHelp).toBe(true);
  });
});

// ── Definition parsing: name after an argument ──

describe("definition parsing: name after an argument", () => {
  it("rejects a command name that follows an argument token", () => {
    expect(() => parseDefinitionString("deploy <env> prod")).toThrow(/cannot follow an argument/);
  });
});

// ── Completion after the -- terminator ──

describe("completion after the -- terminator", () => {
  it("offers no option flags", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "srv").option("--host <host>");
    const [candidates] = new ShellCompleter(registry).complete("srv -- ") as [string[], string];
    expect(candidates).not.toContain("--help");
    expect(candidates).not.toContain("--host");
  });
});

// ── Help discoverability ──

describe("help discoverability", () => {
  it("notes command aliases in the top-level index", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "list").alias("ls").description("List things");
    expect(new HelpGenerator(registry).generateIndex()).toContain("alias: ls");
  });

  it("advertises the --no- negation of a boolean option", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "build").option("--minify", { type: "boolean" });
    expect(new HelpGenerator(registry).generateCommand(["build"])).toContain("--no-minify");
  });
});

// ── Async plugin failures ──

describe("async plugin failures", () => {
  it("stay a sticky failure even when the plugin rejects with undefined", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("foo").action(() => {});
    cli.use(() => Promise.reject(undefined));

    await expect(cli.execLine("foo")).rejects.toBeUndefined();
    // The failure must persist rather than degrade into a silent command-not-found.
    await expect(cli.execLine("foo")).rejects.toBeUndefined();
  });
});

// ── Cancellation classification ──

describe("cancellation classification", () => {
  it("classifies AbortError as cancellation only for its aborted command signal", () => {
    const abortError = Object.assign(new Error("This operation was aborted"), {
      name: "AbortError",
    });
    const controller = new AbortController();
    expect(isCancellationError(abortError, controller.signal)).toBe(false);
    controller.abort();
    expect(isCancellationError(abortError, controller.signal)).toBe(true);
    expect(formatErrorMessage(abortError)).toBe("This operation was aborted");
    expect(isCancellationError(new Error("boom"), controller.signal)).toBe(false);
  });
});

// ── Cancel-handler failures ──

describe("cancel handler failures", () => {
  it("routes a rejected async cancel handler to the error event", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "hang")
      .onCancel(async () => {
        throw new Error("cleanup failed");
      })
      .action(
        (ctx) =>
          new Promise<void>((resolve) => ctx.signal?.addEventListener("abort", () => resolve())),
      );
    const r = new CommandRouter(registry);
    const errors: Error[] = [];
    r.on("error", (err) => {
      errors.push(err);
    });

    const running = r.execute("hang");
    // Let the router register the active entry before interrupting it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(r.triggerCancel()).toBe(true);
    await running;
    // The rejection is adopted, not awaited, so it settles one turn later.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errors.map((err) => err.message)).toEqual(["cleanup failed"]);
  });
});

// ── Prompting after end of input ──

describe("prompting after end of input", () => {
  it("cancels instead of hanging when the input stream already ended", async () => {
    const stdin = createMockStdin();
    stdin.push(null);
    await new Promise((resolve) => stdin.once("end", resolve).resume());

    await expect(prompt.text("name", { stdin, stderr: createMockStdout() })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });
});

// ── Logging never throws ──

describe("logging with non-string messages", () => {
  it("renders an object or an Error instead of throwing", () => {
    const out = createMockStdout();
    const log = createLogger({ stderr: out });

    // Reachable from plain JavaScript, where the `string` type is not enforced.
    const info = log.info as unknown as (value: unknown) => void;
    const error = log.error as unknown as (value: unknown) => void;
    expect(() => info({ msg: "x" })).not.toThrow();
    expect(() => error(new Error("boom"))).not.toThrow();

    const written = out.getOutput();
    expect(written).toContain("msg");
    expect(written).toContain("boom");
  });
});

// ── Shell commands the help footer advertises ──

describe("help for the shell's own commands", () => {
  it("describes exit and quit instead of failing as unknown", async () => {
    for (const name of ["exit", "quit"]) {
      const cli = createCLI({ name: "test" });
      const out = createMockStdout();
      await cli.execLine(`help ${name}`, { stdout: out, stderr: out });
      expect(out.getOutput()).toContain(`Usage: ${name}`);
    }
  });

  it("offers them when completing the help target", () => {
    const cli = createCLI({ name: "test" });
    const registry = (cli as unknown as { registry: CommandRegistry }).registry;
    const [candidates] = new ShellCompleter(registry).complete("help ex") as [string[], string];
    expect(candidates).toContain("exit");
  });

  it("lets an application command of the same name win", async () => {
    const cli = createCLI({ name: "test" });
    cli
      .command("exit <code>")
      .description("Leave with a status")
      .action(() => {});
    const out = createMockStdout();

    await cli.execLine("help exit", { stdout: out, stderr: out });
    expect(out.getOutput()).toContain("Leave with a status");
    expect(out.getOutput()).not.toContain("Exit the interactive shell.");
  });
});

// ── Prompt terminal mode ──

describe("prompt terminal mode", () => {
  it("keeps readline's Ctrl-C handling when only stdout is redirected", async () => {
    const stdin = createMockStdin();
    (stdin as unknown as Record<string, boolean>).isTTY = true;
    // A captured stdout, as produced by `mycli init | tee setup.log`.
    const stdout = createMockStdout();

    const pending = prompt.text("name", { stdin, stdout });
    // Readline only translates the ETX byte into a SIGINT event in terminal
    // mode; without it the byte would be swallowed and the prompt would hang.
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.feed("\u0003");

    await expect(pending).rejects.toBeInstanceOf(CancelledError);
  });
});

// ── Numeric option bounds ──

describe("numeric option bounds", () => {
  function numberDefs() {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "size").option("--bytes <n>", { type: "number" });
    return registry.resolve(["size"])?.options ?? new Map();
  }

  it("names the constraint that actually rejected the value", () => {
    let thrown: unknown;
    try {
      resolveOptions({ bytes: "1e20" }, numberDefs(), ctxStub());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InvalidOptionError);
    // 1e20 is a finite number; saying it is "not a number" misstates the reason.
    expect((thrown as Error).message).toContain("safe integer range");
  });

  it("rejects the same value as a declared default", () => {
    expect(() =>
      CommandBuilder.create(new CommandRegistry(), "size").option("--bytes <n>", {
        type: "number",
        default: "1e20",
      }),
    ).toThrow(/safe integer range/);
  });
});

// ── Actionless command groups ──

describe("actionless command groups", () => {
  function group(withChild: boolean) {
    const registry = new CommandRegistry();
    const db = CommandBuilder.create(registry, "db");
    if (withChild) db.command("status").action(() => {});
    return new CommandRouter(registry);
  }

  it("gives the catch handler the first chance whether or not children exist", async () => {
    for (const withChild of [true, false]) {
      const router = group(withChild);
      const seen: string[] = [];
      router.setCatchHandler((input) => {
        seen.push(input);
      });

      await router.execute("db nope");
      expect(seen).toEqual(["db nope"]);
    }
  });

  it("throws the same error class either way when nothing catches", async () => {
    const thrown: string[] = [];
    for (const withChild of [true, false]) {
      const router = group(withChild);
      router.on("error", () => {});
      try {
        await router.execute("db nope");
      } catch (err) {
        thrown.push((err as Error).constructor.name);
      }
    }
    expect(thrown).toEqual(["CommandNotFoundError", "CommandNotFoundError"]);
  });
});

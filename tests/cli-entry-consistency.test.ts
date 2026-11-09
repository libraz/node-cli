/**
 * Core routing, help and lifecycle behaviour of the CLI.
 *
 * The help surface is exercised as pairwise rows over three factors:
 *   entry    ∈ {start, exec, execLine, shell}
 *   spelling ∈ {help X, X --help, --help X, group}
 *   outcome  ∈ {ok, unknown}
 * No constraints. 16 rows cover every pair (each entry × spelling once; the
 * outcome alternates so every entry and every spelling meets both outcomes).
 *
 * Expectations:
 *   - ok, direct entries: the usage line starts with the program name, and a
 *     group's footer reads `Run "app help <path> <command>" …`.
 *   - ok, shell: no program name, and the footer reads `Type "help …" …`.
 *   - unknown: CommandNotFoundError with the router's input and available list
 *     (start reports it on stderr with a non-zero code instead).
 */
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import type { CommandRouter } from "../src/command/router.js";
import { HelpGenerator } from "../src/help/generator.js";
import {
  CancelledError,
  type CLI,
  CommandNotFoundError,
  createCLI,
  MissingArgumentError,
} from "../src/index.js";
import type { Shell } from "../src/shell/repl.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

restoreProcessStateAfterEach();

const SHELL = {} as Shell;

/** The CLI's own router, for running input the way the interactive shell does. */
function routerOf(cli: CLI): CommandRouter {
  return (cli as unknown as { router: CommandRouter }).router;
}

/** Runs one line as the interactive shell would and returns its stdout. */
async function inShell(cli: CLI, line: string): Promise<string> {
  const stdout = createMockStdout();
  await routerOf(cli).execute(line, { shell: SHELL, stdout, stderr: createMockStdout() });
  return stdout.getOutput();
}

function demoCLI(): CLI {
  const cli = createCLI({ name: "app", version: "1.0.0", description: "Demo" });
  cli
    .command("dep <env>")
    .description("Deploy")
    .action(() => {});
  cli.command("db").alias("d").description("Database");
  cli
    .command("db migrate")
    .description("Migrate")
    .action(() => {});
  cli.command("greet").action(() => {});
  return cli;
}

/** Captures `process.stdout`/`process.stderr` writes for a `start()` call. */
function captureProcess(): { out: () => string; err: () => string } {
  let out = "";
  let err = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  return { out: () => out, err: () => err };
}

async function failure(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("cancellation by the signal's own reason", () => {
  class Custom extends Error {}

  function counting() {
    const cli = createCLI({ name: "app" });
    const events = { commandError: 0, error: 0 };
    cli.on("commandError", () => {
      events.commandError++;
    });
    cli.on("error", () => {
      events.error++;
    });
    return { cli, events };
  }

  it.each([
    ["a custom Error", new Custom("stop")],
    ["a string", "stop"],
    ["a number", 42],
  ])("treats throwIfAborted() with %s as a cancellation", async (_label, reason) => {
    const { cli, events } = counting();
    const controller = new AbortController();
    cli.command("work").action((ctx) => {
      controller.abort(reason);
      ctx.signal.throwIfAborted();
    });
    const error = await failure(cli.exec(["work"], { signal: controller.signal }));
    expect(error).toBeInstanceOf(CancelledError);
    expect((error as CancelledError).cause).toBe(reason);
    expect(events).toEqual({ commandError: 0, error: 0 });
  });

  it("treats a fetch-style rejection with an AbortSignal.timeout reason as a cancellation", async () => {
    const { cli, events } = counting();
    cli.command("work").action(
      (ctx) =>
        new Promise<void>((_resolve, rejectRun) => {
          ctx.signal.addEventListener("abort", () => rejectRun(ctx.signal.reason), { once: true });
        }),
    );
    const error = await failure(cli.exec(["work"], { signal: AbortSignal.timeout(5) }));
    expect(error).toBeInstanceOf(CancelledError);
    expect(events).toEqual({ commandError: 0, error: 0 });
  });

  it("treats a timers/promises AbortError as a cancellation", async () => {
    const { cli, events } = counting();
    const controller = new AbortController();
    cli.command("work").action(async (ctx) => {
      setTimeout(() => controller.abort(), 5);
      await sleep(10_000, undefined, { signal: ctx.signal });
    });
    const error = await failure(cli.exec(["work"], { signal: controller.signal }));
    expect(error).toBeInstanceOf(CancelledError);
    expect(events).toEqual({ commandError: 0, error: 0 });
  });

  it.each([
    ["a custom Error", new Custom("stop")],
    ["a string", "stop"],
  ])("keeps %s a failure when the signal has not aborted", async (_label, thrown) => {
    const { cli, events } = counting();
    cli.command("work").action(() => {
      throw thrown;
    });
    const error = await failure(cli.exec(["work"], { signal: new AbortController().signal }));
    expect(error).not.toBeInstanceOf(CancelledError);
    expect(events).toEqual({ commandError: 1, error: 1 });
  });
});

describe("a leading end-of-options marker", () => {
  function withFallback() {
    const cli = createCLI({ name: "app" });
    const fallback = vi.fn();
    cli.fallback(fallback);
    const greet = vi.fn();
    cli.command("greet <name>").action((ctx) => greet(ctx.args.name, ctx.rawArgv));
    return { cli, fallback, greet };
  }

  it.each([[[]], [[""]], [["", ""]], [["--"]]])(
    "exec(%j) resolves without running the fallback",
    async (argv) => {
      const { cli, fallback } = withFallback();
      await expect(cli.exec(argv)).resolves.toBeUndefined();
      expect(fallback).not.toHaveBeenCalled();
    },
  );

  it.each([[""], ["--"]])("execLine(%j) resolves without running the fallback", async (line) => {
    const { cli, fallback } = withFallback();
    await expect(cli.execLine(line)).resolves.toBeUndefined();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs nothing for "--" in the shell, even with a fallback', async () => {
    const { cli, fallback } = withFallback();
    await inShell(cli, "--");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("is removed once before the command is resolved", async () => {
    const { cli, greet } = withFallback();
    await cli.exec(["--", "greet", "x"]);
    await cli.execLine("-- greet y");
    await inShell(cli, "-- greet z");
    expect(greet.mock.calls.map((call) => call[0])).toEqual(["x", "y", "z"]);
    // rawArgv stays the exact argv.
    expect(greet.mock.calls[0][1]).toEqual(["--", "greet", "x"]);
  });

  it("is removed only once", async () => {
    const cli = createCLI({ name: "app" });
    const error = await failure(cli.exec(["--", "--"]));
    expect(error).toBeInstanceOf(CommandNotFoundError);
    expect(error).toHaveProperty("input", "--");
  });

  it('reports a leading "" before a command as an unknown command', async () => {
    const cli = createCLI({ name: "app" });
    cli.command("greet").action(() => {});
    const error = await failure(cli.exec(["", "greet"]));
    expect(error).toBeInstanceOf(CommandNotFoundError);
    expect(error).toHaveProperty("input", "");
  });

  it("start() still prints the index for a lone marker", async () => {
    process.exitCode = undefined;
    const cli = createCLI({ name: "app" });
    cli.command("greet").action(() => {});
    const io = captureProcess();
    await expect(cli.start(["--"])).resolves.toBe(0);
    expect(io.out()).toContain("Available commands:");
  });
});

describe("help for an unknown target", () => {
  it("reports a top-level miss like the router", async () => {
    const error = await failure(demoCLI().exec(["help", "zz"]));
    expect(error).toBeInstanceOf(CommandNotFoundError);
    expect(error).toHaveProperty("input", "zz");
    expect(error).toHaveProperty("available", ["db", "dep", "greet", "help"]);
    expect((error as Error).message).toContain("Available commands: db, dep, greet, help");
  });

  it("reports a nested miss with the canonical path and the group's children", async () => {
    const error = await failure(demoCLI().exec(["help", "d", "zz"]));
    expect(error).toHaveProperty("input", "db zz");
    expect(error).toHaveProperty("available", ["migrate"]);
  });

  it("omits available beneath a leaf command", async () => {
    const error = await failure(demoCLI().exec(["help", "greet", "extra"]));
    expect(error).toBeInstanceOf(CommandNotFoundError);
    expect(error).toHaveProperty("input", "greet extra");
    expect((error as CommandNotFoundError).available).toBeUndefined();
    expect((error as Error).message).not.toContain("Available commands");
  });

  it("omits available on the router's nested miss when no child is visible", async () => {
    const cli = createCLI({ name: "app" });
    cli.command("grp");
    cli
      .command("grp secret")
      .hidden()
      .action(() => {});
    const error = await failure(cli.exec(["grp", "zz"]));
    expect(error).toHaveProperty("input", "grp zz");
    expect((error as CommandNotFoundError).available).toBeUndefined();
  });

  it("does not describe exit and quit outside the shell", async () => {
    const cli = demoCLI();
    for (const name of ["exit", "quit"]) {
      const error = await failure(cli.exec(["help", name]));
      expect(error).toBeInstanceOf(CommandNotFoundError);
      expect(error).toHaveProperty("input", name);
    }
    expect(await inShell(cli, "help exit")).toContain("Usage: exit");
  });
});

describe("help and version fire no command events", () => {
  function counted(cli: CLI) {
    const counts = { beforeExecute: 0, afterExecute: 0, commandError: 0, error: 0 };
    for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
      cli.on(name, () => {
        counts[name]++;
      });
    }
    return counts;
  }

  it.each([
    [["help"]],
    [["help", "dep"]],
    [["--help"]],
    [["-h"]],
    [["--help", "dep"]],
    [["dep", "--help"]],
    [["db"]],
    [["--version"]],
    [["-V"]],
  ])("%j", async (argv) => {
    const cli = demoCLI();
    const counts = counted(cli);
    await cli.exec(argv, { stdout: createMockStdout() });
    expect(counts).toEqual({ beforeExecute: 0, afterExecute: 0, commandError: 0, error: 0 });
  });

  it("an unknown help target fires error only", async () => {
    const cli = demoCLI();
    const counts = counted(cli);
    await failure(cli.exec(["help", "zz"]));
    expect(counts).toEqual({ beforeExecute: 0, afterExecute: 0, commandError: 0, error: 1 });
  });

  it("a help command the application replaced fires the events", async () => {
    const cli = demoCLI();
    const mine = vi.fn();
    cli.command("help [...command]").action(mine);
    const counts = counted(cli);
    await cli.exec(["help"]);
    expect(mine).toHaveBeenCalledTimes(1);
    expect(counts).toEqual({ beforeExecute: 1, afterExecute: 1, commandError: 0, error: 0 });
  });
});

describe("help text names the program in direct runs", () => {
  type Entry = "start" | "exec" | "execLine" | "shell";
  type Spelling = "help X" | "X --help" | "--help X" | "group";
  type Outcome = "ok" | "unknown";

  const ROWS: readonly (readonly [Entry, Spelling, Outcome])[] = [
    ["start", "help X", "ok"],
    ["start", "X --help", "unknown"],
    ["start", "--help X", "ok"],
    ["start", "group", "unknown"],
    ["exec", "help X", "unknown"],
    ["exec", "X --help", "ok"],
    ["exec", "--help X", "unknown"],
    ["exec", "group", "ok"],
    ["execLine", "help X", "ok"],
    ["execLine", "X --help", "unknown"],
    ["execLine", "--help X", "ok"],
    ["execLine", "group", "unknown"],
    ["shell", "help X", "unknown"],
    ["shell", "X --help", "ok"],
    ["shell", "--help X", "unknown"],
    ["shell", "group", "ok"],
  ];

  const LINES: Record<Spelling, Record<Outcome, string>> = {
    "help X": { ok: "help dep", unknown: "help zz" },
    "X --help": { ok: "dep --help", unknown: "zz --help" },
    "--help X": { ok: "--help dep", unknown: "--help zz" },
    group: { ok: "db", unknown: "db zz" },
  };

  async function run(entry: Entry, line: string) {
    const cli = demoCLI();
    const stdout = createMockStdout();
    try {
      if (entry === "start") {
        const io = captureProcess();
        const code = await cli.start(line.split(" "));
        return { out: io.out(), err: io.err(), code, error: undefined };
      }
      if (entry === "exec") await cli.exec(line.split(" "), { stdout });
      else if (entry === "execLine") await cli.execLine(line, { stdout });
      else await routerOf(cli).execute(line, { shell: SHELL, stdout, stderr: createMockStdout() });
      return { out: stdout.getOutput(), err: "", code: 0, error: undefined };
    } catch (error) {
      return { out: stdout.getOutput(), err: "", code: 1, error };
    }
  }

  it.each(ROWS)("%s × %s × %s", async (entry, spelling, outcome) => {
    const result = await run(entry, LINES[spelling][outcome]);
    const direct = entry !== "shell";
    if (outcome === "ok") {
      expect(result.error).toBeUndefined();
      if (spelling === "group") {
        expect(result.out).toContain(
          direct ? "Usage: app db <command> [options]" : "Usage: db <command> [options]",
        );
        expect(result.out).toContain(
          direct
            ? 'Run "app help db <command>" for more information.'
            : 'Type "help db <command>" for more information.',
        );
      } else {
        expect(result.out).toContain(
          direct ? "Usage: app dep <env> [options]" : "Usage: dep <env> [options]",
        );
      }
      return;
    }
    const input = spelling === "group" ? "db zz" : "zz";
    if (entry === "start") {
      expect(result.code).not.toBe(0);
      expect(result.err).toContain(`Command not found: "${input}"`);
      return;
    }
    expect(result.error).toBeInstanceOf(CommandNotFoundError);
    expect(result.error).toHaveProperty("input", input);
    expect(result.error).toHaveProperty(
      "available",
      spelling === "group" ? ["migrate"] : ["db", "dep", "greet", "help"],
    );
  });

  it("prints the direct index in the documented layout", async () => {
    const cli = createCLI({ name: "app", version: "1.0.0", description: "Demo" });
    cli
      .command("dep <env>")
      .description("Deploy")
      .action(() => {});
    const stdout = createMockStdout();
    await cli.exec(["--help"], { stdout });
    expect(stdout.getOutput()).toBe(
      [
        "app v1.0.0",
        "Demo",
        "",
        "Usage: app <command> [options]",
        "",
        "Available commands:",
        "",
        "  dep <env>            Deploy",
        "  help [...command]    Show help information",
        "",
        "Options:",
        "  -h, --help       Show help",
        "  -V, --version    Show the CLI version",
        "",
        'Run "app help <command>" for more information.',
        "",
      ].join("\n"),
    );
  });

  it("keeps the shell index without a usage line", async () => {
    const out = await inShell(demoCLI(), "help");
    expect(out).not.toContain("Usage:");
    expect(out).toContain(
      'Shell commands: exit, quit\nType "help <command>" for more information.',
    );
  });

  it("leaves a nameless generator unprefixed", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "x <a>").action(() => {});
    CommandBuilder.create(registry, "g");
    CommandBuilder.create(registry, "g y").action(() => {});
    const generator = new HelpGenerator(registry);
    const index = generator.generateIndex();
    expect(index).not.toContain("Usage:");
    expect(index).toContain('Type "help <command>" for more information.');
    expect(generator.generateCommand(["x"])).toContain("Usage: x <a> [options]");
    expect(generator.generateCommand(["g"])).toContain(
      'Type "help g <command>" for more information.',
    );
    const command = registry.matchCommandPath(["x"])?.command;
    expect(command && generator.formatUsageFor(command)).toBe("x <a> [options]");
  });

  it("prefixes the usage carried by resolution errors in direct runs only", async () => {
    const cli = demoCLI();
    const direct = await failure(cli.exec(["dep"]));
    expect(direct).toBeInstanceOf(MissingArgumentError);
    expect(direct).toHaveProperty("usage", "app dep <env> [options]");
    expect((direct as Error).message).toContain("Usage: app dep <env> [options]");

    const shell = await failure(
      routerOf(cli).execute("dep", { shell: SHELL, stdout: createMockStdout() }),
    );
    expect(shell).toHaveProperty("usage", "dep <env> [options]");
  });

  it("indents a lone --help like the other long-only options when -h is taken", async () => {
    const cli = createCLI({ name: "app" });
    cli
      .command("conn")
      .option("-h, --host <h>", { description: "Host" })
      .option("--port <p>", { description: "Port" })
      .action(() => {});
    const stdout = createMockStdout();
    await cli.exec(["conn", "--help"], { stdout });
    const out = stdout.getOutput();
    expect(out).toMatch(/\n {2}-h, --host <h> +Host\n/);
    expect(out).toMatch(/\n {6}--port <p> +Port\n/);
    expect(out).toMatch(/\n {6}--help +Show help for this command/);
  });
});

describe("the exit event carries the exit code", () => {
  it("passes 0 after a success", async () => {
    process.exitCode = undefined;
    const cli = createCLI({ name: "app" });
    cli.command("ok").action(() => {});
    const onExit = vi.fn();
    cli.on("exit", onExit);
    captureProcess();
    expect(await cli.start(["ok"])).toBe(0);
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("passes the failure's code, the same value start() resolves to", async () => {
    process.exitCode = undefined;
    const cli = createCLI({ name: "app" });
    cli.command("fail").action(() => {
      throw new Error("boom");
    });
    const onExit = vi.fn();
    cli.on("exit", onExit);
    captureProcess();
    const code = await cli.start(["fail"]);
    expect(code).not.toBe(0);
    expect(onExit).toHaveBeenCalledWith(code);
  });

  it("passes a process.exitCode carried over from before", async () => {
    process.exitCode = 3;
    const cli = createCLI({ name: "app" });
    cli.command("ok").action(() => {});
    const onExit = vi.fn();
    cli.on("exit", onExit);
    captureProcess();
    expect(await cli.start(["ok"])).toBe(3);
    expect(onExit).toHaveBeenCalledWith(3);
  });

  it("passes the index path's code too", async () => {
    process.exitCode = undefined;
    const cli = createCLI({ name: "app" });
    const onExit = vi.fn();
    cli.on("exit", onExit);
    captureProcess();
    await cli.start([""]);
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("passes terminate()'s code, and the first emission wins", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const first = createCLI({ name: "app" });
      const onFirst = vi.fn();
      first.on("exit", onFirst);
      routerOf(first).terminate(143);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(143));
      expect(onFirst).toHaveBeenCalledWith(143);

      const second = createCLI({ name: "app" });
      const onSecond = vi.fn();
      second.on("exit", onSecond);
      await routerOf(second).emitExit(5);
      routerOf(second).terminate(130);
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
      expect(onSecond).toHaveBeenCalledTimes(1);
      expect(onSecond).toHaveBeenCalledWith(5);
    } finally {
      exit.mockRestore();
    }
  });
});

describe("createCLI checks its display options", () => {
  it.each(["version", "prompt", "description", "banner"])("rejects a non-string %s", (key) => {
    for (const value of [2, null, true, {}]) {
      let error: unknown;
      try {
        createCLI({ name: "app", [key]: value } as never);
      } catch (thrown) {
        error = thrown;
      }
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect((error as Error).message).toContain(`The "${key}" option of createCLI()`);
    }
    expect(() => createCLI({ name: "app", [key]: undefined })).not.toThrow();
    expect(() => createCLI({ name: "app", [key]: "" })).not.toThrow();
  });
});

describe("TSDoc", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  const cli = readFileSync(new URL("../src/cli.ts", import.meta.url), "utf8");

  /** The doc comment immediately before the first occurrence of `marker` after `from`, plus the marker. */
  function docOf(source: string, marker: string, from = 0): string {
    const at = source.indexOf(marker, from);
    expect(at, marker).toBeGreaterThanOrEqual(0);
    return source.slice(source.lastIndexOf("/**", at), at + marker.length);
  }

  it("types.ts", () => {
    const rawArgv = docOf(types, "readonly rawArgv: readonly string[] | null;");
    expect(rawArgv).toContain("execLine");
    expect(rawArgv).not.toContain("`exec()` with an array");
    expect(docOf(types, "readonly rawInput: string;")).toContain("lossy");
    expect(docOf(types, "readonly commandPath: readonly string[];")).toContain("alias");
    const completion = types.indexOf("export interface CompletionContext");
    expect(docOf(types, "readonly commandPath: readonly string[];", completion)).toContain("alias");
    const events = docOf(types, "export interface CLIEventMap");
    expect(events).toContain("help");
    expect(events).toContain("version");
    expect(docOf(types, "  exit:")).toContain("exitCode");
    expect(docOf(types, "export type Completer")).toContain("throw");
    expect(docOf(types, "export type CancelHandler")).toContain("throw");
    const plugin = types.indexOf("export interface PluginContext");
    for (const member of ["  command<D extends string>", "  off<K", "  fallback(handler"]) {
      expect(docOf(types, member, plugin), member).toContain("@throws");
    }
  });

  it("cli.ts", () => {
    const create = docOf(cli, "export function createCLI");
    expect(create).toContain("@throws");
    expect(create).toContain("historySize");
    expect(create).toContain("version");
    const execLine = docOf(cli, "async execLine(");
    expect(execLine).toContain("pipe");
    expect(execLine).toContain("redirection");
    const start = docOf(cli, "async start(");
    expect(start.slice(start.indexOf("@returns"))).toContain("unchanged");
    expect(docOf(cli, "async exec(")).toContain('"--"');
  });
});

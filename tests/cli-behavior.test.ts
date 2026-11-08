import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { activePipeSegment, parse, parseDefinitionString } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { CancelledError, CLIError, InvalidOptionError, MissingOptionError } from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import { createCLI } from "../src/index.js";
import { ShellCompleter } from "../src/shell/completion.js";
import { History } from "../src/shell/history.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

restoreProcessStateAfterEach(["NODE_CLI_DEBUG"]);

function setup() {
  const registry = new CommandRegistry();
  const router = new CommandRouter(registry);
  const helpGenerator = new HelpGenerator(registry);
  router.setHelpGenerator(helpGenerator);
  return { registry, router, helpGenerator };
}

describe("parse-phase errors emit the error event", () => {
  it("emits error for an unknown option", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>").action(() => {});
    const onError = vi.fn();
    const onCommandError = vi.fn();
    router.on("error", onError);
    router.on("commandError", onCommandError);

    await expect(router.execute("deploy prod --bogus")).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onCommandError).toHaveBeenCalledOnce();
    expect(onCommandError.mock.calls[0][1].commandPath).toEqual(["deploy"]);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("emits error for a value-less option that expects a value", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});
    const onError = vi.fn();
    const onCommandError = vi.fn();
    router.on("error", onError);
    router.on("commandError", onCommandError);

    await expect(router.execute("deploy prod --tag")).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onCommandError).toHaveBeenCalledOnce();
  });

  it.each(['deploy "', "deploy |"])(
    "emits error exactly once for syntax input %j",
    async (input) => {
      const { registry, router } = setup();
      CommandBuilder.create(registry, "deploy").action(() => {});
      const onError = vi.fn();
      router.on("error", onError);

      await expect(router.execute(input)).rejects.toThrow();
      expect(onError).toHaveBeenCalledOnce();
    },
  );
});

describe("fallback catch handler errors", () => {
  it("emits error when the catch handler throws", async () => {
    const { router } = setup();
    const onError = vi.fn();
    router.on("error", onError);
    router.setCatchHandler(() => {
      throw new Error("catch failed");
    });

    await expect(router.execute("unknown")).rejects.toThrow("catch failed");
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("required boolean option", () => {
  it("throws MissingOptionError when a required boolean flag is omitted", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "confirm")
      .option("--accept", { type: "boolean", required: true })
      .action(() => {});

    await expect(router.execute("confirm")).rejects.toThrow(MissingOptionError);
  });

  it("passes when the required boolean flag is present", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "confirm")
      .option("--accept", { type: "boolean", required: true })
      .action(action);

    await router.execute("confirm --accept");
    expect(action.mock.calls[0][0].options.accept).toBe(true);
  });
});

describe("missing variadic arguments", () => {
  it("formats the missing argument name the same way as usage", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <...envs>").action(() => {});

    await expect(router.execute("deploy")).rejects.toThrow("Missing required argument: <...envs>");
  });
});

describe("direct mode prompt cancellation display", () => {
  it("prints Cancelled instead of a raw CancelledError message", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("ask").action(() => {
      throw new CancelledError();
    });
    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["ask"]);
    expect(process.exitCode).toBe(130);

    // A user cancellation is presented as a clean "Cancelled" line without the
    // "Error:" prefix, matching how the interactive shell reports the same event.
    expect(stderr.getOutput()).toBe("Cancelled\n");
  });

  it("uses a CLIError's custom exit code in direct mode", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("fail").action(() => {
      throw new CLIError("custom failure", { code: "VALIDATION_FAILED", exitCode: 42 });
    });
    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["fail"]);
    expect(process.exitCode).toBe(42);
    expect(stderr.getOutput()).toBe("Error: custom failure\n");
  });
});

describe("empty direct argv", () => {
  it.each([[[""]], [["--"]]])("shows help for explicit argv %j", async (argv) => {
    const cli = createCLI({ name: "test" });
    const stdout = createMockStdout();
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(argv);
    expect(stdout.getOutput()).toContain("Available commands:");
  });

  it("passes an empty string through as a positional argument value", async () => {
    const cli = createCLI({ name: "test" });
    let received: string | undefined;
    cli.command("say <text>").action((ctx) => {
      received = ctx.args.text as string;
    });

    await cli.start(["say", ""]);
    expect(received).toBe("");
  });

  it("passes an empty string through as an option value", async () => {
    const cli = createCLI({ name: "test" });
    let received: string | undefined;
    cli
      .command("greet")
      .option("-n, --name <name>")
      .action((ctx) => {
        received = ctx.options.name as string;
      });

    await cli.start(["greet", "--name", ""]);
    expect(received).toBe("");
  });
});

describe("public CLI lifecycle APIs", () => {
  it("removes a CLI event listener with off()", async () => {
    const cli = createCLI({ name: "test" });
    const handler = vi.fn();
    cli.command("run").action(() => {});
    cli.on("beforeExecute", handler).off("beforeExecute", handler);

    await cli.execLine("run");
    expect(handler).not.toHaveBeenCalled();
  });

  it("exposes PluginContext.off and fallback", async () => {
    const cli = createCLI({ name: "test" });
    const handler = vi.fn();
    const stdout = createMockStdout();
    cli.use((ctx) => {
      ctx.on("beforeExecute", handler);
      ctx.off("beforeExecute", handler);
      ctx.fallback((input, context) => context.stdout.write(`caught:${input}`));
    });

    await cli.execLine("unknown", { stdout });
    expect(handler).not.toHaveBeenCalled();
    expect(stdout.getOutput()).toBe("caught:unknown");
  });

  it("rejects a second start call and errors for unknown help targets", async () => {
    const cli = createCLI({ name: "test" });
    await cli.start(["help"]);
    await expect(cli.start(["help"])).rejects.toThrow("already been called");
    await expect(createCLI({ name: "test" }).execLine("help unknown")).rejects.toThrow(
      'Command not found: "unknown"',
    );
  });
});

describe("direct mode stdin", () => {
  it("passes process.stdin to command context", async () => {
    const originalStdin = process.stdin;
    const stdin = new PassThrough();
    const cli = createCLI({ name: "test" });
    const action = vi.fn((ctx) => {
      expect(ctx.stdin).toBe(stdin);
    });
    cli.command("read").action(action);
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });

    try {
      await cli.start(["read"]);
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
    }

    expect(action).toHaveBeenCalledOnce();
  });
});

describe("short -h help flag", () => {
  it("parses -h as help on a command with options", () => {
    const { registry } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});

    const result = parse("deploy prod -h", registry);
    expect(result.options.help).toBe(true);
  });

  it("shows help text for `deploy -h`", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .description("Deploy app")
      .action(() => {});

    const stdout = createMockStdout();
    await router.execute("deploy -h", { stdout });
    expect(stdout.getOutput()).toContain("Deploy app");
  });
});

describe("tab completion respects pipes", () => {
  it("completes the command in the last pipe segment", () => {
    const { registry } = setup();
    CommandBuilder.create(registry, "grep <pattern>").action(() => {});
    CommandBuilder.create(registry, "list").action(() => {});
    const completer = new ShellCompleter(registry);

    const [candidates] = completer.complete("list | gr") as [string[], string];
    expect(candidates).toContain("grep");
  });
});

describe("cancellation across concurrent commands", () => {
  it("triggerCancel cancels every active command", async () => {
    const { registry, router } = setup();
    const cancelled: string[] = [];
    let release1: () => void = () => {};
    let release2: () => void = () => {};

    CommandBuilder.create(registry, "slow1")
      .onCancel(() => cancelled.push("slow1"))
      .action(() => new Promise<void>((r) => (release1 = r)));
    CommandBuilder.create(registry, "slow2")
      .onCancel(() => cancelled.push("slow2"))
      .action(() => new Promise<void>((r) => (release2 = r)));

    const p1 = router.execute("slow1");
    const p2 = router.execute("slow2");
    await new Promise((r) => setTimeout(r, 5));

    expect(router.triggerCancel()).toBe(true);
    expect(cancelled.sort()).toEqual(["slow1", "slow2"]);

    release1();
    release2();
    await Promise.all([p1, p2]);
  });

  it("exposes an AbortSignal on ctx that aborts when the command is cancelled", async () => {
    const { registry, router } = setup();
    let observedSignal: AbortSignal | undefined;
    let abortedDuringRun = false;
    let release: () => void = () => {};

    CommandBuilder.create(registry, "task").action((ctx) => {
      observedSignal = ctx.signal;
      // The signal is live but not yet aborted while the action runs.
      ctx.signal.addEventListener("abort", () => {
        abortedDuringRun = true;
      });
      return new Promise<void>((r) => (release = r));
    });

    const p = router.execute("task");
    await new Promise((r) => setTimeout(r, 5));

    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);

    router.triggerCancel();
    expect(abortedDuringRun).toBe(true);
    expect(observedSignal?.aborted).toBe(true);

    release();
    await p;
  });

  it("tears the whole pipe chain down when a stage fails", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "produce").action((ctx) => {
      ctx.stdout.write("data\n");
    });
    CommandBuilder.create(registry, "boom").action(() => {
      throw new Error("stage failed");
    });

    const stdout = createMockStdout();
    await expect(router.execute("produce | boom", { stdout })).rejects.toThrow("stage failed");
  });
});

describe("option value coercion", () => {
  it("coerces --cache=0 to false rather than a JS-truthy true", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "build").option("--cache", { type: "boolean" }).action(action);

    await router.execute("build --cache=0");
    expect(action.mock.calls[0][0].options.cache).toBe(false);
  });

  it("accepts --cache=off and coerces to false", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "build").option("--cache", { type: "boolean" }).action(action);

    await router.execute("build --cache=off");
    expect(action.mock.calls[0][0].options.cache).toBe(false);
  });

  it("normalizes schema-declared option aliases to their long key before actions run", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "serve").option("--port <port>", { alias: "p" }).action(action);

    await router.execute("serve -p 8080");

    expect(action.mock.calls[0][0].options).toMatchObject({ port: "8080" });
    expect(action.mock.calls[0][0].options).not.toHaveProperty("p");
  });

  it("rejects an unrecognized boolean value instead of silently using true", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "build")
      .option("--cache", { type: "boolean" })
      .action(() => {});

    await expect(router.execute("build --cache=hello")).rejects.toThrow(InvalidOptionError);
  });

  it("treats an explicitly string-typed flag without a placeholder as value-taking", () => {
    const { registry, helpGenerator } = setup();
    CommandBuilder.create(registry, "run")
      .option("--name", { type: "string" })
      .action(() => {});

    // Parser consumes the next token as the value.
    const result = parse("run --name alice", registry);
    expect(result.options.name).toBe("alice");

    // Help advertises a value placeholder, consistent with the parser.
    const help = helpGenerator.generateCommand(["run"]);
    expect(help).toContain("--name <name>");
  });
});

describe("choices validation on array options", () => {
  it("validates each element of a repeated option", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "deploy")
      .option("--env <env>", { type: "string[]", choices: ["prod", "staging", "dev"] })
      .action(action);

    await router.execute("deploy --env prod --env staging");
    expect(action.mock.calls[0][0].options.env).toEqual(["prod", "staging"]);
  });

  it("rejects an invalid element", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy")
      .option("--env <env>", { type: "string[]", choices: ["prod", "staging"] })
      .action(() => {});

    await expect(router.execute("deploy --env prod --env nope")).rejects.toThrow(
      InvalidOptionError,
    );
  });
});

describe("positional value matching a subcommand name", () => {
  it("treats `task list` as the task argument, not the list subcommand", async () => {
    const { registry, router } = setup();
    const taskAction = vi.fn();
    const listAction = vi.fn();
    CommandBuilder.create(registry, "task <name>").action(taskAction);
    CommandBuilder.create(registry, "task list").action(listAction);

    await router.execute("task list");
    expect(taskAction).toHaveBeenCalledOnce();
    expect(taskAction.mock.calls[0][0].args.name).toBe("list");
    expect(listAction).not.toHaveBeenCalled();
  });
});

describe("alias never shadows a real command", () => {
  it("rejects a real command that would shadow an existing alias", () => {
    const { registry } = setup();
    const startAction = vi.fn();
    CommandBuilder.create(registry, "start").alias("stop").action(startAction);

    expect(() => CommandBuilder.create(registry, "stop")).toThrow(/conflicts with alias/);
  });
});

describe("command definition validation", () => {
  it("throws on a missing closing bracket", () => {
    expect(() => parseDefinitionString("cmd <name")).toThrow();
  });

  it("throws on an empty argument name", () => {
    expect(() => parseDefinitionString("cmd <>")).toThrow();
  });
});

describe("short option inline value completion", () => {
  it("completes a value after -o=", () => {
    const { registry } = setup();
    CommandBuilder.create(registry, "serve")
      .option("-m, --mode <mode>", { type: "string", completer: ["dev", "prod"] })
      .action(() => {});
    const completer = new ShellCompleter(registry);

    const [candidates] = completer.complete("serve -m=d") as [string[], string];
    expect(candidates).toContain("dev");
  });
});

describe("canonical command path in custom completer", () => {
  it("passes the real name even when an alias was typed", () => {
    const { registry } = setup();
    const completer = vi.fn(() => ["x"]);
    CommandBuilder.create(registry, "deploy <env>")
      .alias("d")
      .completer(completer)
      .action(() => {});
    const sc = new ShellCompleter(registry);

    sc.complete("d prod ");
    expect(completer).toHaveBeenCalled();
    expect(completer.mock.calls[0][0].commandPath).toEqual(["deploy"]);
  });
});

describe("canonical command path in actions", () => {
  it("passes canonical names when the command is invoked through aliases", async () => {
    const { registry, router } = setup();
    const paths: string[][] = [];
    CommandBuilder.create(registry, "deploy run")
      .alias("r")
      .action((ctx) => paths.push(ctx.commandPath));

    await router.execute("deploy r");
    expect(paths).toEqual([["deploy", "run"]]);
  });
});

describe("usage string consistency", () => {
  it("includes [options] in the missing-argument usage", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});

    await expect(router.execute("deploy")).rejects.toThrow(/\[options\]/);
  });

  it("lists arguments in declaration order in help", () => {
    const { registry, helpGenerator } = setup();
    CommandBuilder.create(registry, "copy <from> [to]").action(() => {});

    const help = helpGenerator.generateCommand(["copy"]);
    expect(help.indexOf("from")).toBeLessThan(help.indexOf("to"));
  });
});

describe("async plugin rejection", () => {
  it("surfaces a failing async plugin to the caller", async () => {
    const cli = createCLI({ name: "t" });
    cli.use(async () => {
      throw new Error("plugin boom");
    });

    const stdout = createMockStdout();
    const run = cli.execLine.bind(cli);
    await expect(run("help", { stdout })).rejects.toThrow("plugin boom");
  });
});

describe("non-interactive start with no arguments", () => {
  it("prints the help index when stdin is not a TTY and no args are given", async () => {
    const cli = createCLI({ name: "demo" });
    CommandBuilder.create(
      (cli as unknown as { registry: CommandRegistry }).registry,
      "ping",
    ).action(() => {});

    const originalIsTTY = process.stdin.isTTY;
    let captured = "";
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await cli.start([]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }

    expect(captured).toContain("Available commands");
  });

  it("prints plain help when stdin is a TTY but stdout is redirected", async () => {
    const cli = createCLI({ name: "demo" });
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    let captured = "";
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await cli.start([]);
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalStdinIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutIsTTY,
        configurable: true,
      });
    }

    expect(captured).toContain("Available commands");
    expect(captured).not.toContain("\x1b[");
    expect(captured).not.toContain("demo> ");
  });
});

describe("history save error formatting", () => {
  it("formats a save failure without [object Object]", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "node-cli-history-warning-"));
    const regularFileParent = join(fixtureDir, "not-a-directory");
    await writeFile(regularFileParent, "fixture");
    const history = new History({ filePath: join(regularFileParent, "history") });
    history.add("ls");

    let captured = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      await history.save();
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }

    expect(captured).toContain("Warning: Could not save history");
    expect(captured).not.toContain("[object Object]");
  });
});

describe("activePipeSegment", () => {
  it("returns the last segment after a top-level pipe", () => {
    expect(activePipeSegment("ls | grep foo")).toBe("grep foo");
  });
  it("preserves a trailing empty segment after a pipe", () => {
    expect(activePipeSegment("ls | ")).toBe("");
  });
  it("ignores pipes inside quotes", () => {
    expect(activePipeSegment("echo 'a | b'")).toBe("echo 'a | b'");
  });
});

describe("option flag completion after positional arguments", () => {
  it("offers option flags once a positional argument has been entered", () => {
    const { registry } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--force", { type: "boolean" })
      .option("--tag <tag>", { type: "string" })
      .action(() => {});
    const completer = new ShellCompleter(registry);

    const [candidates] = completer.complete("deploy prod ") as [string[], string];
    expect(candidates).toContain("--force");
    expect(candidates).toContain("--tag");
  });
});

describe("group boundary completion", () => {
  it("offers both subcommands and the group's own options", () => {
    const { registry } = setup();
    CommandBuilder.create(registry, "db").option("--verbose", { type: "boolean" });
    CommandBuilder.create(registry, "db migrate").action(() => {});
    const completer = new ShellCompleter(registry);

    const [candidates] = completer.complete("db ") as [string[], string];
    expect(candidates).toContain("migrate");
    expect(candidates).toContain("--verbose");
  });
});

describe("usage string is shared between help and errors", () => {
  it("missing-argument usage matches the help Usage line", async () => {
    const { registry, router, helpGenerator } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});

    const help = helpGenerator.generateCommand(["deploy"]);
    const usageLine = help.split("\n")[0].replace(/^Usage:\s*/, "");

    let thrown: Error | undefined;
    await router.execute("deploy").catch((err) => {
      thrown = err as Error;
    });
    expect(thrown?.message).toContain(usageLine);
  });
});

describe("CLI history configuration", () => {
  it("applies historySize from the options", () => {
    const cli = createCLI({ name: "test", historySize: 25 });
    expect((cli as unknown as { historySizeLimit: number }).historySizeLimit).toBe(25);
  });
});

describe("fatal error diagnostics", () => {
  it("prints an error stack when NODE_CLI_DEBUG is enabled", () => {
    const cli = createCLI({ name: "test" });
    const error = new Error("broken command");
    error.stack = "Error: broken command\n  at test";
    const writes: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    process.env.NODE_CLI_DEBUG = "1";
    (cli as unknown as { reportFatal(error: unknown): void }).reportFatal(error);
    expect(writes.join("")).toContain("  at test");
  });
});

describe("help completion through a shadowed parent", () => {
  it("offers nothing below a command whose arguments consume its subcommands", () => {
    const cli = createCLI({ name: "test" });
    const list = cli.command("task list").action(() => {});
    list.command("x").action(() => {});
    cli.command("task <name>").action(() => {});
    const { registry } = cli as unknown as { registry: CommandRegistry };
    const completer = new ShellCompleter(registry);

    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      expect(completer.complete("help task list ")).toEqual([[], ""]);
      expect(completer.complete("help task list x")).toEqual([[], "x"]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("direct mode error presentation", () => {
  it("strips control sequences from argv-derived messages and closes styling", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("deploy").action(() => {});
    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    await cli.start(["deploy", "--\x1b[2Jbogus"]);
    const cliNotFound = createCLI({ name: "test" });
    const notFound = createMockStdout();
    process.stderr.write = notFound.write.bind(notFound) as typeof process.stderr.write;
    await cliNotFound.start(["\x1b[31mred"]);

    expect(stderr.getOutput()).toContain("bogus");
    expect(stderr.getOutput()).not.toContain("\x1b[2J");
    expect(notFound.getOutput()).toContain("red");
    // A colour the message opened is closed before the line ends.
    expect(notFound.getOutput().endsWith('"\x1b[39m\n')).toBe(true);
  });
});

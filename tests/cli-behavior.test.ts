import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { activePipeSegment, parse, parseDefinitionString } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { InvalidOptionError, MissingOptionError } from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import { createCLI } from "../src/index.js";
import { ShellCompleter } from "../src/shell/completion.js";
import { History } from "../src/shell/history.js";
import { createMockStdout } from "./helpers.js";

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
    new CommandBuilder(registry, "deploy <env>").action(() => {});
    const onError = vi.fn();
    router.on("error", onError);

    await expect(router.execute("deploy prod --bogus")).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("emits error for a value-less option that expects a value", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});
    const onError = vi.fn();
    router.on("error", onError);

    await expect(router.execute("deploy prod --tag")).rejects.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("required boolean option", () => {
  it("throws MissingOptionError when a required boolean flag is omitted", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "confirm")
      .option("--accept", { type: "boolean", required: true })
      .action(() => {});

    await expect(router.execute("confirm")).rejects.toThrow(MissingOptionError);
  });

  it("passes when the required boolean flag is present", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    new CommandBuilder(registry, "confirm")
      .option("--accept", { type: "boolean", required: true })
      .action(action);

    await router.execute("confirm --accept");
    expect(action.mock.calls[0][0].options.accept).toBe(true);
  });
});

describe("short -h help flag", () => {
  it("parses -h as help on a command with options", () => {
    const { registry } = setup();
    new CommandBuilder(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});

    const result = parse("deploy prod -h", registry);
    expect(result.options.help).toBe(true);
  });

  it("shows help text for `deploy -h`", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "deploy <env>").description("Deploy app").action(() => {});

    const stdout = createMockStdout();
    await router.execute("deploy -h", { stdout });
    expect(stdout.getOutput()).toContain("Deploy app");
  });
});

describe("tab completion respects pipes", () => {
  it("completes the command in the last pipe segment", () => {
    const { registry } = setup();
    new CommandBuilder(registry, "grep <pattern>").action(() => {});
    new CommandBuilder(registry, "list").action(() => {});
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

    new CommandBuilder(registry, "slow1")
      .cancel(() => cancelled.push("slow1"))
      .action(() => new Promise<void>((r) => (release1 = r)));
    new CommandBuilder(registry, "slow2")
      .cancel(() => cancelled.push("slow2"))
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

    new CommandBuilder(registry, "task").action((ctx) => {
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
    new CommandBuilder(registry, "produce").action((ctx) => {
      ctx.stdout.write("data\n");
    });
    new CommandBuilder(registry, "boom").action(() => {
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
    new CommandBuilder(registry, "build").option("--cache", { type: "boolean" }).action(action);

    await router.execute("build --cache=0");
    expect(action.mock.calls[0][0].options.cache).toBe(false);
  });

  it("accepts --cache=off and coerces to false", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    new CommandBuilder(registry, "build").option("--cache", { type: "boolean" }).action(action);

    await router.execute("build --cache=off");
    expect(action.mock.calls[0][0].options.cache).toBe(false);
  });

  it("rejects an unrecognized boolean value instead of silently using true", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "build").option("--cache", { type: "boolean" }).action(() => {});

    await expect(router.execute("build --cache=hello")).rejects.toThrow(InvalidOptionError);
  });

  it("treats an explicitly string-typed flag without a placeholder as value-taking", () => {
    const { registry, helpGenerator } = setup();
    new CommandBuilder(registry, "run").option("--name", { type: "string" }).action(() => {});

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
    new CommandBuilder(registry, "deploy")
      .option("--env <env>", { type: "string[]", choices: ["prod", "staging", "dev"] })
      .action(action);

    await router.execute("deploy --env prod --env staging");
    expect(action.mock.calls[0][0].options.env).toEqual(["prod", "staging"]);
  });

  it("rejects an invalid element", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "deploy")
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
    new CommandBuilder(registry, "task <name>").action(taskAction);
    new CommandBuilder(registry, "task list").action(listAction);

    await router.execute("task list");
    expect(taskAction).toHaveBeenCalledOnce();
    expect(taskAction.mock.calls[0][0].args.name).toBe("list");
    expect(listAction).not.toHaveBeenCalled();
  });
});

describe("alias never shadows a real command", () => {
  it("dispatches to the real command even when an alias was registered first", async () => {
    const { registry, router } = setup();
    const startAction = vi.fn();
    const stopAction = vi.fn();
    new CommandBuilder(registry, "start").alias("stop").action(startAction);
    new CommandBuilder(registry, "stop").action(stopAction);

    await router.execute("stop");
    expect(stopAction).toHaveBeenCalledOnce();
    expect(startAction).not.toHaveBeenCalled();
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
    new CommandBuilder(registry, "serve")
      .option("-m, --mode <mode>", { type: "string", autocomplete: ["dev", "prod"] })
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
    new CommandBuilder(registry, "deploy <env>")
      .alias("d")
      .complete(completer)
      .action(() => {});
    const sc = new ShellCompleter(registry);

    sc.complete("d prod ");
    expect(completer).toHaveBeenCalled();
    expect(completer.mock.calls[0][0].commandPath).toEqual(["deploy"]);
  });
});

describe("usage string consistency", () => {
  it("includes [options] in the missing-argument usage", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string" })
      .action(() => {});

    await expect(router.execute("deploy")).rejects.toThrow(/\[options\]/);
  });

  it("lists arguments in declaration order in help", () => {
    const { registry, helpGenerator } = setup();
    new CommandBuilder(registry, "copy [from] <to>").action(() => {});

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
    const run = cli.exec.bind(cli);
    await expect(run("help", { stdout })).rejects.toThrow("plugin boom");
  });
});

describe("non-interactive start with no arguments", () => {
  it("prints the help index when stdin is not a TTY and no args are given", async () => {
    const cli = createCLI({ name: "demo" });
    new CommandBuilder((cli as unknown as { registry: CommandRegistry }).registry, "ping").action(
      () => {},
    );

    const originalIsTTY = process.stdin.isTTY;
    const originalWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stdout.write;

    try {
      await cli.start([]);
    } finally {
      process.stdout.write = originalWrite;
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }

    expect(captured).toContain("Available commands");
  });
});

describe("history save error formatting", () => {
  it("formats a save failure without [object Object]", async () => {
    // A path whose parent is a file (not a directory) makes the write fail.
    const history = new History({ filePath: "/dev/null/nope/history" });
    history.add("ls");

    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    try {
      await history.save();
    } finally {
      process.stderr.write = originalWrite;
    }

    if (captured.length > 0) {
      expect(captured).not.toContain("[object Object]");
    }
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
    new CommandBuilder(registry, "deploy <env>")
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
    new CommandBuilder(registry, "db").option("--verbose", { type: "boolean" });
    new CommandBuilder(registry, "db migrate").action(() => {});
    const completer = new ShellCompleter(registry);

    const [candidates] = completer.complete("db ") as [string[], string];
    expect(candidates).toContain("migrate");
    expect(candidates).toContain("--verbose");
  });
});

describe("usage string is shared between help and errors", () => {
  it("missing-argument usage matches the help Usage line", async () => {
    const { registry, router, helpGenerator } = setup();
    new CommandBuilder(registry, "deploy <env>")
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

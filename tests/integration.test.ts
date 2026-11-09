import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CLI } from "../src/cli.js";
import { createCLI } from "../src/index.js";
import { createMockStdout, createMockTTY, restoreProcessStateAfterEach } from "./helpers.js";

describe("CLI (integration)", () => {
  restoreProcessStateAfterEach();

  it("creates CLI via factory function", () => {
    const cli = createCLI({ name: "test" });
    expect(cli).toBeInstanceOf(CLI);
  });

  it("executes direct CLI mode", async () => {
    const cli = createCLI({ name: "test" });
    const action = vi.fn();
    cli.command("greet <name>").action(action);

    // Redirect stderr to avoid error output
    const _stderr = createMockStdout();

    await cli.start(["greet", "world"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.name).toBe("world");
  });

  it("emits exit once for direct and non-interactive start paths", async () => {
    const direct = createCLI({ name: "test" });
    const directExit = vi.fn();
    direct.on("exit", directExit);
    direct.command("run").action(() => {});
    await direct.start(["run"]);
    expect(directExit).toHaveBeenCalledOnce();

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const help = createCLI({ name: "test" });
    const helpExit = vi.fn();
    help.on("exit", helpExit);
    try {
      await help.start([]);
      expect(helpExit).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  it("uses exit status 130 after a cooperative SIGINT cancellation", async () => {
    const cli = createCLI({ name: "test" });
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    cli.command("wait").action(
      (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", resolve, { once: true });
          started();
        }),
    );

    const execution = cli.start(["wait"]);
    await running;
    process.emit("SIGINT");
    await execution;
    expect(process.exitCode).toBe(130);
  });

  it("uses exit status 130 when a SIGINT-aborted action rejects", async () => {
    const cli = createCLI({ name: "test" });
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    cli.command("abort").action(
      (ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            { once: true },
          );
          started();
        }),
    );

    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    const execution = cli.start(["abort"]);
    await running;
    process.emit("SIGINT");
    await execution;
    expect(process.exitCode).toBe(130);
    expect(stderr.getOutput()).toBe(
      "\nInterrupted. Press Ctrl-C again to force quit.\nCancelled\n",
    );
  });

  it("handles command not found in direct mode", async () => {
    const cli = createCLI({ name: "test" });
    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["nonexistent"]);
    expect(process.exitCode).toBe(64);
    expect(stderr.getOutput()).toContain("Command not found");
  });

  it("built-in help command works", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("deploy <env>").description("Deploy app");

    const stdout = createMockStdout();
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help"]);
    expect(stdout.getOutput()).toContain("deploy <env>");
    expect(stdout.getOutput()).toContain("Deploy app");
  });

  it("built-in help for specific command", async () => {
    const cli = createCLI({ name: "test" });
    cli
      .command("deploy <env>")
      .description("Deploy to environment")
      .option("--force", { type: "boolean", description: "Skip confirmation" });

    const stdout = createMockStdout();
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help", "deploy"]);
    expect(stdout.getOutput()).toContain("Deploy to environment");
    expect(stdout.getOutput()).toContain("--force");
  });

  it("subcommands work end-to-end", async () => {
    const cli = createCLI({ name: "test" });
    const action = vi.fn();
    cli
      .command("user create <name>")
      .description("Create user")
      .option("--role <role>", { default: "user" })
      .action(action);

    await cli.start(["user", "create", "alice", "--role", "admin"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.name).toBe("alice");
    expect(action.mock.calls[0][0].options.role).toBe("admin");
  });

  it("nested command builder style works", async () => {
    const cli = createCLI({ name: "test" });
    const action = vi.fn();
    const user = cli.command("config").description("Config management");
    user.command("set <key> <value>").action(action);

    await cli.start(["config", "set", "theme", "dark"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.key).toBe("theme");
    expect(action.mock.calls[0][0].args.value).toBe("dark");
  });

  it("option validation works", async () => {
    const cli = createCLI({ name: "test" });
    cli
      .command("login")
      .option("--token <token>", {
        required: true,
        validate(value) {
          if (typeof value === "string" && value.length < 5) {
            throw new Error("Token too short");
          }
        },
      })
      .action(() => {});

    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["login", "--token", "abc"]);
    expect(stderr.getOutput()).toContain("Token too short");
  });

  it("passes historyFilter from CLI through Shell to persisted history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "node-cli-history-filter-"));
    const historyFile = join(directory, "history");
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough() as PassThrough & { isTTY: true };
    stdin.isTTY = true;
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const cli = createCLI({
      name: "test",
      historyFile,
      historyFilter: (line) => line.replace(/secret/g, "[redacted]"),
    });
    cli.command("login <token>").action(() => {});

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });
    try {
      const started = cli.start([]);
      setTimeout(() => stdin.end("login secret\nquit\n"), 10);
      await started;

      const savedHistory = await readFile(historyFile, "utf8");
      expect(savedHistory).toContain("login [redacted]");
      expect(savedHistory).not.toContain("login secret");
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("createCLI option validation", () => {
  function historyFileOf(cli: ReturnType<typeof createCLI>): string {
    return (cli as unknown as { historyFile: string }).historyFile;
  }

  it.each([0, -0, 1, 2 ** 31, 2 ** 32, Number.MAX_SAFE_INTEGER])(
    "accepts historySize %s",
    (historySize) => {
      expect(() => createCLI({ name: "test", historySize })).not.toThrow();
    },
  );

  it.each([Number.NaN, Infinity, -Infinity, -1, Number.MAX_SAFE_INTEGER + 1, 1.5])(
    "rejects historySize %s with ERR_INVALID_ARG_VALUE",
    (historySize) => {
      const error = captureThrow(() => createCLI({ name: "test", historySize }));
      expect(error).toBeInstanceOf(RangeError);
      expect(error).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
    },
  );

  it.each([null, true, "10"])("rejects historySize %s with ERR_INVALID_ARG_TYPE", (value) => {
    const error = captureThrow(() => createCLI({ name: "test", historySize: value as number }));
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });

  it.each([null, "redact", 1])("rejects historyFilter %s with ERR_INVALID_ARG_TYPE", (value) => {
    const error = captureThrow(() =>
      createCLI({ name: "test", historyFilter: value as unknown as (line: string) => string }),
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });

  it.each(["", null, 42])("rejects historyFile %s with ERR_INVALID_ARG_TYPE", (value) => {
    const error = captureThrow(() => createCLI({ name: "test", historyFile: value as string }));
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });

  it.each([
    ["~", homedir()],
    ["~/history", join(homedir(), "history")],
    ["~\\history", join(homedir(), "history")],
    ["~other/history", "~other/history"],
    ["/var/tmp/~/history", "/var/tmp/~/history"],
  ])("resolves historyFile %s to %s", (historyFile, expected) => {
    expect(historyFileOf(createCLI({ name: "test", historyFile }))).toBe(expected);
  });

  it("defaults historyFile to the name in the home directory", () => {
    expect(historyFileOf(createCLI({ name: "app" }))).toBe(join(homedir(), ".app_history"));
  });
});

describe("start() argument checks", () => {
  restoreProcessStateAfterEach();

  it.each([
    ["null", null],
    ["a string", "help"],
    ["an array with a number", ["help", 1]],
    ["an array with undefined", ["help", undefined]],
  ])("rejects %s as argv with ERR_INVALID_ARG_TYPE", async (_label, argv) => {
    const cli = createCLI({ name: "test" });
    const error = await cli.start(argv as string[]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });

  it("rejects a second start with ERR_ALREADY_STARTED", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("run").action(() => {});
    await cli.start(["run"]);
    const error = await cli.start(["run"]).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty("code", "ERR_ALREADY_STARTED");
  });
});

function captureThrow(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

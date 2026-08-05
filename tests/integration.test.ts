import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CLI } from "../src/cli.js";
import { createCLI } from "../src/index.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

describe("CLI (integration)", () => {
  it("creates CLI via factory function", () => {
    const cli = createCLI({ name: "test" });
    expect(cli).toBeInstanceOf(CLI);
  });

  it("executes direct CLI mode", async () => {
    const cli = createCLI();
    const action = vi.fn();
    cli.command("greet <name>").action(action);

    // Redirect stderr to avoid error output
    const _stderr = createMockStdout();
    const _origStderr = process.stderr.write;

    await cli.start(["greet", "world"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.name).toBe("world");
  });

  it("emits exit once for direct and non-interactive start paths", async () => {
    const direct = createCLI();
    const directExit = vi.fn();
    direct.on("exit", directExit);
    direct.command("run").action(() => {});
    await direct.start(["run"]);
    expect(directExit).toHaveBeenCalledOnce();

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const help = createCLI();
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
    const cli = createCLI();
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

    try {
      const execution = cli.start(["wait"]);
      await running;
      process.emit("SIGINT");
      await execution;
      expect(process.exitCode).toBe(130);
    } finally {
      process.exitCode = 0;
    }
  });

  it("uses exit status 130 when a SIGINT-aborted action rejects", async () => {
    const cli = createCLI();
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
    const originalWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    try {
      const execution = cli.start(["abort"]);
      await running;
      process.emit("SIGINT");
      await execution;
      expect(process.exitCode).toBe(130);
      expect(stderr.getOutput()).toBe(
        "\nInterrupted. Press Ctrl-C again to force quit.\nCancelled\n",
      );
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = 0;
    }
  });

  it("handles command not found in direct mode", async () => {
    const cli = createCLI();
    const stderr = createMockStdout();
    const origWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["nonexistent"]);

    process.stderr.write = origWrite;
    expect(process.exitCode).toBe(1);
    expect(stderr.getOutput()).toContain("Command not found");

    // Reset exit code
    process.exitCode = 0;
  });

  it("built-in help command works", async () => {
    const cli = createCLI();
    cli.command("deploy <env>").description("Deploy app");

    const stdout = createMockStdout();
    const origWrite = process.stdout.write;
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help"]);

    process.stdout.write = origWrite;
    expect(stdout.getOutput()).toContain("deploy <env>");
    expect(stdout.getOutput()).toContain("Deploy app");
  });

  it("built-in help for specific command", async () => {
    const cli = createCLI();
    cli
      .command("deploy <env>")
      .description("Deploy to environment")
      .option("--force", { type: "boolean", description: "Skip confirmation" });

    const stdout = createMockStdout();
    const origWrite = process.stdout.write;
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help", "deploy"]);

    process.stdout.write = origWrite;
    expect(stdout.getOutput()).toContain("Deploy to environment");
    expect(stdout.getOutput()).toContain("--force");
  });

  it("subcommands work end-to-end", async () => {
    const cli = createCLI();
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
    const cli = createCLI();
    const action = vi.fn();
    const user = cli.command("config").description("Config management");
    user.command("set <key> <value>").action(action);

    await cli.start(["config", "set", "theme", "dark"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.key).toBe("theme");
    expect(action.mock.calls[0][0].args.value).toBe("dark");
  });

  it("option validation works", async () => {
    const cli = createCLI();
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
    const origWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["login", "--token", "abc"]);

    process.stderr.write = origWrite;
    expect(stderr.getOutput()).toContain("Token too short");

    // Reset exit code
    process.exitCode = 0;
  });

  it("prompt and history methods are chainable", () => {
    const cli = createCLI({ name: "test" });
    const result = cli.prompt("$ ").history("test-history");
    expect(result).toBe(cli);
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
    const cli = createCLI({ historyFile });
    cli.command("login <token>").action(() => {});
    cli.historyFilter((line) => line.replace(/secret/g, "[redacted]"));

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

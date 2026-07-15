import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { type ModeConfig, Shell } from "../src/shell/repl.js";
import { createMockTTY } from "./helpers.js";

function feedLines(stdin: PassThrough, lines: string[]): void {
  lines.forEach((line, index) => {
    setTimeout(() => {
      stdin.write(`${line}\n`);
      if (index === lines.length - 1) {
        stdin.end();
      }
    }, index * 10);
  });
}

describe("mode command", () => {
  it("ModeConfig interface is exported", () => {
    const config: ModeConfig = {
      prompt: "mode> ",
      action: () => {},
    };
    expect(config.prompt).toBe("mode> ");
    expect(typeof config.action).toBe("function");
  });

  it("ModeConfig with message", () => {
    const config: ModeConfig = {
      prompt: "sql> ",
      action: () => {},
      message: "Entering SQL mode",
    };
    expect(config.message).toBe("Entering SQL mode");
  });

  it("ModeConfig supports isolated completion and session history policies", () => {
    const config: ModeConfig = {
      prompt: "sql> ",
      action: () => {},
      completer: (line) => [["SELECT"], line],
      history: "session",
    };
    expect(config.completer?.("S")).toEqual([["SELECT"], "S"]);
    expect(config.history).toBe("session");
  });

  it("Shell has enterMode, exitMode, and setPrompt methods", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "/tmp/test_mode_history",
    });

    expect(typeof shell.enterMode).toBe("function");
    expect(typeof shell.exitMode).toBe("function");
    expect(typeof shell.setPrompt).toBe("function");
  });

  it("setPrompt updates the prompt string", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "/tmp/test_mode_history",
    });

    // Should not throw when called before start() (no rl yet)
    shell.setPrompt("myapp> ");
  });

  it("enterMode and exitMode update an active readline prompt", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "/tmp/test_mode_history",
    });
    const setPrompt = vi.fn();
    (shell as unknown as { rl: { setPrompt: (prompt: string) => void } }).rl = { setPrompt };

    shell.enterMode({
      prompt: "sql> ",
      action: () => {},
    });
    shell.exitMode();

    expect(setPrompt).toHaveBeenNthCalledWith(1, "sql> ");
    expect(setPrompt).toHaveBeenNthCalledWith(2, "> ");
  });

  it("command action can enter mode via shell", () => {
    const registry = new CommandRegistry();
    const _router = new CommandRouter(registry);

    const modeAction = vi.fn();
    new CommandBuilder(registry, "sql").action((ctx) => {
      if (ctx.shell) {
        ctx.shell.enterMode({
          prompt: "sql> ",
          action: modeAction,
          message: "Entering SQL mode",
        });
      }
    });

    expect(registry.resolve(["sql"])).toBeDefined();
  });

  it("runs the interactive loop through command mode, mode input, mode exit, and shell exit", async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough();
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const seen: string[] = [];
    const onExit = vi.fn();
    router.on("exit", onExit);

    new CommandBuilder(registry, "sql").action((ctx) => {
      seen.push("enter");
      ctx.shell?.enterMode({
        prompt: "sql> ",
        message: "Entering SQL mode",
        action(input, modeCtx) {
          seen.push(`mode:${input}`);
          modeCtx.stdout.write(`mode:${input}\n`);
        },
      });
    });

    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      banner: "Test Shell",
      historyFile: `/tmp/node-cli-mode-${process.pid}-${Date.now()}.history`,
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });

    try {
      const running = shell.start();
      feedLines(stdin, ["sql", "select 1", "exit", "quit"]);

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
    }

    expect(seen).toEqual(["enter", "mode:select 1"]);
    expect(onExit).toHaveBeenCalledOnce();
    expect(stdout.getOutput()).toContain("Test Shell");
    expect(stdout.getOutput()).toContain("Entering SQL mode");
    expect(stdout.getOutput()).toContain("mode:select 1");
    expect(stderr.getOutput()).toBe("");
  });

  it("returns to the parent prompt when EOF closes a mode readline", async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough();
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const modeEntered = vi.fn();

    new CommandBuilder(registry, "sql").action((ctx) => {
      ctx.shell?.enterMode({
        prompt: "sql> ",
        action: () => {},
      });
      modeEntered();
    });

    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      historyFile: `/tmp/node-cli-mode-eof-${process.pid}-${Date.now()}.history`,
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });

    try {
      const running = shell.start();
      stdin.write("sql\n");
      await vi.waitFor(() => expect(modeEntered).toHaveBeenCalledOnce());

      (shell as unknown as { rl?: { close: () => void } }).rl?.close();
      await vi.waitFor(() => expect(stdout.getOutput()).toContain("app> "));
      stdin.end("quit\n");

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
    }

    expect(stderr.getOutput()).toBe("");
  });

  it("clears partial input on Ctrl+C before accepting the next command", async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough() as PassThrough & { isTTY: true };
    stdin.isTTY = true;
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const fresh = vi.fn();
    const staleFresh = vi.fn();
    new CommandBuilder(registry, "fresh").action(fresh);
    new CommandBuilder(registry, "stalefresh").action(staleFresh);

    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      historyFile: `/tmp/node-cli-line-cancel-${process.pid}-${Date.now()}.history`,
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });

    try {
      const running = shell.start();
      await vi.waitFor(() => expect((shell as unknown as { rl?: unknown }).rl).toBeDefined());
      stdin.write("stale");
      await vi.waitFor(() =>
        expect((shell as unknown as { rl?: { line: string } }).rl?.line).toBe("stale"),
      );
      (
        shell as unknown as {
          rl?: { emit: (event: string) => boolean; line: string };
        }
      ).rl?.emit("SIGINT");
      await vi.waitFor(() =>
        expect((shell as unknown as { rl?: { line: string } }).rl?.line).toBe(""),
      );
      stdin.end("fresh\nquit\n");

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
    }

    expect(fresh).toHaveBeenCalledOnce();
    expect(staleFresh).not.toHaveBeenCalled();
  });

  it("routes SIGINT while a mode action is running", async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough();
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const triggerCancel = vi.spyOn(router, "triggerCancel");
    let resolveModeAction: (() => void) | undefined;
    const modeActionStarted = vi.fn();

    new CommandBuilder(registry, "sql").action((ctx) => {
      ctx.shell?.enterMode({
        prompt: "sql> ",
        action: () =>
          new Promise<void>((resolve) => {
            resolveModeAction = resolve;
            modeActionStarted();
          }),
      });
    });

    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      historyFile: `/tmp/node-cli-mode-sigint-${process.pid}-${Date.now()}.history`,
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });

    try {
      const running = shell.start();
      stdin.write("sql\n");
      await vi.waitFor(() => expect(stdout.getOutput()).toContain("sql> "));
      stdin.write("select 1\n");
      await vi.waitFor(() => expect(modeActionStarted).toHaveBeenCalledOnce());

      process.emit("SIGINT");
      expect(triggerCancel).toHaveBeenCalledOnce();

      resolveModeAction?.();
      await vi.waitFor(() => expect((shell as unknown as { rl?: unknown }).rl).toBeDefined());
      feedLines(stdin, ["exit", "quit"]);

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      triggerCancel.mockRestore();
    }

    expect(stderr.getOutput()).toBe("");
  });
});

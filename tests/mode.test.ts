import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function createHistoryFixture(): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "node-cli-mode-"));
  return {
    filePath: join(directory, "history"),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
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

  it("falls back to no mode completions when its completer rejects", async () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "mode-history-test",
    });
    shell.enterMode({
      prompt: "mode> ",
      action: () => {},
      completer: async () => Promise.reject(new Error("completion failed")),
    });
    const internal = shell as unknown as {
      openReadline(history: string[]): void;
      rl?: { completer?: (line: string) => Promise<[string[], string]>; close(): void };
    };

    internal.openReadline([]);
    try {
      await expect(internal.rl?.completer?.("sel")).resolves.toEqual([[], "sel"]);
    } finally {
      internal.rl?.close();
    }
  });

  it("passes mode completion requests to its configured completer", async () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const completer = vi.fn(async (line: string) => [["SELECT"], line] as [string[], string]);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "mode-history-test",
    });
    shell.enterMode({ prompt: "sql> ", action: () => {}, completer });
    const internal = shell as unknown as {
      openReadline(history: string[]): void;
      rl?: { completer?: (line: string) => Promise<[string[], string]>; close(): void };
    };

    internal.openReadline([]);
    try {
      await expect(internal.rl?.completer?.("SEL")).resolves.toEqual([["SELECT"], "SEL"]);
      expect(completer).toHaveBeenCalledWith("SEL");
    } finally {
      internal.rl?.close();
    }
  });

  it("honors mode history policies and trims session history during the shell loop", async () => {
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough();
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const historyFixture = await createHistoryFixture();
    const observedHistories: string[][] = [];
    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      historyFile: historyFixture.filePath,
      historySize: 2,
    });
    shell.enterMode({
      prompt: "sql> ",
      history: "session",
      action: () => {
        observedHistories.push([...(shell as unknown as { modeHistory: string[] }).modeHistory]);
      },
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });
    try {
      const running = shell.start();
      feedLines(stdin, ["one", "two", "three", "exit", "quit"]);
      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      await historyFixture.cleanup();
    }

    expect(observedHistories).toEqual([["one"], ["one", "two"], ["two", "three"]]);

    const noHistoryFixture = await createHistoryFixture();
    const noHistoryInput = new PassThrough();
    const noHistoryShell = new Shell({
      router: new CommandRouter(new CommandRegistry()),
      registry: new CommandRegistry(),
      prompt: "app> ",
      historyFile: noHistoryFixture.filePath,
    });
    const observedNoHistory: string[][] = [];
    noHistoryShell.enterMode({
      prompt: "secret> ",
      history: "none",
      action: () => {
        observedNoHistory.push([
          ...(noHistoryShell as unknown as { modeHistory: string[] }).modeHistory,
        ]);
      },
    });
    Object.defineProperty(process, "stdin", { configurable: true, value: noHistoryInput });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });
    try {
      const running = noHistoryShell.start();
      feedLines(noHistoryInput, ["password", "exit", "quit"]);
      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      await noHistoryFixture.cleanup();
    }
    expect(observedNoHistory).toEqual([[]]);
  });

  it("Shell has enterMode, exitMode, and setPrompt methods", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "mode-history-test",
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
      historyFile: "mode-history-test",
    });

    // Should not throw when called before start() (no rl yet)
    shell.setPrompt("myapp> ");
  });

  it("updates an active parent prompt and stops the shell", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "mode-history-test",
    });
    const setPrompt = vi.fn();
    const close = vi.fn();
    const internal = shell as unknown as {
      rl: { setPrompt(prompt: string): void; close(): void };
      running: boolean;
    };
    internal.rl = { setPrompt, close };
    internal.running = true;

    shell.setPrompt("app> ");
    shell.stop();

    expect(setPrompt).toHaveBeenCalledWith("app> ");
    expect(close).toHaveBeenCalledOnce();
    expect(internal.running).toBe(false);
  });

  it("enterMode and exitMode update an active readline prompt", () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const shell = new Shell({
      router,
      registry,
      prompt: "> ",
      historyFile: "mode-history-test",
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
    const historyFixture = await createHistoryFixture();
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
    const sigintListeners = process.listenerCount("SIGINT");
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
      historyFile: historyFixture.filePath,
    });

    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: stderr });

    try {
      const running = shell.start();
      await vi.waitFor(() =>
        expect(process.listenerCount("SIGINT")).toBeGreaterThan(sigintListeners),
      );
      feedLines(stdin, ["sql", "select 1", "exit", "quit"]);

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      await historyFixture.cleanup();
    }

    expect(seen).toEqual(["enter", "mode:select 1"]);
    expect(onExit).toHaveBeenCalledOnce();
    expect(stdout.getOutput()).toContain("Test Shell");
    expect(stdout.getOutput()).toContain("Entering SQL mode");
    expect(stdout.getOutput()).toContain("mode:select 1");
    expect(stderr.getOutput()).toBe("");
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
  });

  it("returns to the parent prompt when EOF closes a mode readline", async () => {
    const historyFixture = await createHistoryFixture();
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
      historyFile: historyFixture.filePath,
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
      await historyFixture.cleanup();
    }

    expect(stderr.getOutput()).toBe("");
  });

  it("clears partial input on Ctrl+C before accepting the next command", async () => {
    const historyFixture = await createHistoryFixture();
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
      historyFile: historyFixture.filePath,
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
      await historyFixture.cleanup();
    }

    expect(fresh).toHaveBeenCalledOnce();
    expect(staleFresh).not.toHaveBeenCalled();
  });

  it("routes SIGINT while a mode action is running", async () => {
    const historyFixture = await createHistoryFixture();
    const originalStdin = process.stdin;
    const originalStdout = process.stdout;
    const originalStderr = process.stderr;
    const stdin = new PassThrough();
    const stdout = createMockTTY();
    const stderr = createMockTTY();
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    let resolveModeAction: (() => void) | undefined;
    let modeSignal: AbortSignal | undefined;
    const modeActionStarted = vi.fn();

    new CommandBuilder(registry, "sql").action((ctx) => {
      ctx.shell?.enterMode({
        prompt: "sql> ",
        action: (_input, modeCtx) =>
          new Promise<void>((resolve) => {
            modeSignal = modeCtx.signal;
            resolveModeAction = resolve;
            modeActionStarted();
          }),
      });
    });

    const shell = new Shell({
      router,
      registry,
      prompt: "app> ",
      historyFile: historyFixture.filePath,
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

      // A first Ctrl-C aborts the mode action's cancellation signal cooperatively.
      // Mode actions bypass router.execute, so cancellation runs through a
      // dedicated AbortController rather than router.triggerCancel.
      process.emit("SIGINT");
      expect(modeSignal?.aborted).toBe(true);

      resolveModeAction?.();
      await vi.waitFor(() => expect((shell as unknown as { rl?: unknown }).rl).toBeDefined());
      feedLines(stdin, ["exit", "quit"]);

      await expect(running).resolves.toBeUndefined();
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
      Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
      await historyFixture.cleanup();
    }

    // The first interrupt writes the force-quit hint to stderr.
    expect(stderr.getOutput()).toContain("Press Ctrl-C again to force quit");
  });
});

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { progress, restoreCursor } from "../src/output/progress.js";
import { InteractiveShell } from "../src/shell/repl.js";
import { createMockStdout, createMockTTY, restoreProcessStateAfterEach } from "./helpers.js";

type ShellIO = {
  stdin: PassThrough & { isTTY?: boolean };
  stdout: ReturnType<typeof createMockTTY>;
  stderr: ReturnType<typeof createMockTTY>;
};

/** Runs `body` with process stdio replaced by in-memory streams. */
async function withShellIO(
  options: { tty?: boolean },
  body: (io: ShellIO) => Promise<void>,
): Promise<ShellIO> {
  const original = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  const stdin = new PassThrough() as ShellIO["stdin"];
  if (options.tty) stdin.isTTY = true;
  const io: ShellIO = { stdin, stdout: createMockTTY(), stderr: createMockTTY() };
  for (const name of ["stdin", "stdout", "stderr"] as const) {
    Object.defineProperty(process, name, { configurable: true, value: io[name] });
  }
  try {
    await body(io);
  } finally {
    for (const name of ["stdin", "stdout", "stderr"] as const) {
      Object.defineProperty(process, name, { configurable: true, value: original[name] });
    }
  }
  return io;
}

async function withHistoryFile(body: (historyFile: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "node-cli-repl-"));
  try {
    await body(join(directory, "history"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function readerOf(shell: InteractiveShell): { rl: { line: string } } | undefined {
  return (shell as unknown as { reader?: { rl: { line: string } } }).reader;
}

describe("Shell error and termination handling", () => {
  restoreProcessStateAfterEach();

  it("releases its process listeners even when the loop throws", async () => {
    const signals = ["SIGINT", "SIGTERM", "unhandledRejection", "uncaughtException"] as const;
    const before = signals.map((name) => process.listenerCount(name));
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    let exited = 0;
    router.on("exit", () => {
      exited++;
    });
    const shell = new InteractiveShell({
      router,
      registry,
      prompt: "> ",
      historyFile: join(tmpdir(), "node-cli-teardown-history"),
    });
    // Fail inside the loop rather than at a boundary the teardown already
    // guards, so the assertion is about the teardown running at all.
    (shell as unknown as { openReader: (history: string[]) => void }).openReader = () => {
      throw new Error("loop failed");
    };

    await expect(shell.start()).rejects.toThrow("loop failed");

    expect(signals.map((name) => process.listenerCount(name))).toEqual(before);
    expect(exited).toBe(1);
  });

  it("formats command errors for the interactive stderr stream", () => {
    const shell = new InteractiveShell({
      router: new CommandRouter(new CommandRegistry()),
      registry: new CommandRegistry(),
      prompt: "> ",
      historyFile: "unused-history",
    });
    const stderr = createMockStdout();
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    (shell as unknown as { reportError(error: unknown): void }).reportError(new Error("broken"));
    expect(stderr.getOutput()).toBe("Error: broken\n");
  });

  it("flushes pending history before SIGTERM exits the shell", async () => {
    const directory = await mkdtemp(join(tmpdir(), "node-cli-sigterm-history-"));
    const historyFile = join(directory, "history");
    const child = spawn(
      process.execPath,
      [resolve("tests/fixtures/sigterm-pending-history-child.mjs"), historyFile],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timeout = setTimeout(
          () => rejectReady(new Error(`child did not start: ${output}`)),
          3_000,
        );
        const check = () => {
          if (output.includes("SIGTERM_HISTORY_READY")) {
            clearTimeout(timeout);
            resolveReady();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
      child.kill("SIGTERM");
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      expect({ code, signal }).toEqual({ code: 143, signal: null });
      expect(await readFile(historyFile, "utf8")).toBe("pending-before-sigterm\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports unhandled process errors without ending the REPL session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "node-cli-repl-errors-"));
    const historyFile = join(directory, "history");
    const child = spawn(
      process.execPath,
      [resolve("tests/fixtures/repl-process-errors-child.mjs"), historyFile],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    try {
      await new Promise<void>((resolveReady, rejectReady) => {
        const timeout = setTimeout(
          () => rejectReady(new Error(`child did not report both errors: ${output}`)),
          3_000,
        );
        const check = () => {
          if (
            output.includes("Error: unhandled rejection") &&
            output.includes("Error: uncaught exception")
          ) {
            clearTimeout(timeout);
            resolveReady();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
      child.stdin.write("quit\n");
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes the reader before teardown and keeps signals handled until it ends", async () => {
    await withHistoryFile(async (historyFile) => {
      const registry = new CommandRegistry();
      const router = new CommandRouter(registry);
      const shell = new InteractiveShell({ router, registry, prompt: "> ", historyFile });
      const sigintBefore = process.listenerCount("SIGINT");
      const sigtermBefore = process.listenerCount("SIGTERM");
      const observed: { reader: unknown; sigint: number; sigterm: number; promptAfter: boolean }[] =
        [];
      await withShellIO({ tty: true }, async (io) => {
        router.on("exit", async () => {
          const before = io.stdout.getOutput().length;
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
          observed.push({
            reader: readerOf(shell),
            sigint: process.listenerCount("SIGINT"),
            sigterm: process.listenerCount("SIGTERM"),
            promptAfter: io.stdout.getOutput().slice(before).includes("> "),
          });
        });
        const running = shell.start();
        await vi.waitFor(() => expect(readerOf(shell)).toBeDefined());
        io.stdin.write("quit\r");
        await running;
      });
      expect(observed).toEqual([
        {
          reader: undefined,
          sigint: sigintBefore + 1,
          sigterm: sigtermBefore + 1,
          promptAfter: false,
        },
      ]);
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    });
  });

  it("ends the session when stdin is destroyed with an error at the prompt or in a mode", async () => {
    for (const inMode of [false, true]) {
      await withHistoryFile(async (historyFile) => {
        const registry = new CommandRegistry();
        const router = new CommandRouter(registry);
        const onExit = vi.fn();
        router.on("exit", onExit);
        CommandBuilder.create(registry, "sql").action((ctx) => {
          ctx.shell?.enterMode({ prompt: "sql> ", action: () => {} });
        });
        const shell = new InteractiveShell({ router, registry, prompt: "> ", historyFile });
        await withShellIO({}, async (io) => {
          const running = shell.start();
          if (inMode) {
            io.stdin.write("sql\n");
            await vi.waitFor(() => expect(io.stdout.getOutput()).toContain("sql> "));
          } else {
            await vi.waitFor(() => expect(readerOf(shell)).toBeDefined());
          }
          io.stdin.destroy(new Error("EIO: i/o error"));
          await expect(running).resolves.toBeUndefined();
        });
        expect(onExit).toHaveBeenCalledOnce();
      });
    }
  });

  it("runs a line whose history filter throws, without recording it", async () => {
    await withHistoryFile(async (historyFile) => {
      const registry = new CommandRegistry();
      const router = new CommandRouter(registry);
      const ran: string[] = [];
      CommandBuilder.create(registry, "boom <x>").action((ctx) => {
        ran.push(`boom ${ctx.args.x}`);
      });
      CommandBuilder.create(registry, "ok").action(() => {
        ran.push("ok");
      });
      const shell = new InteractiveShell({
        router,
        registry,
        prompt: "> ",
        historyFile,
        historyFilter: (line) => {
          if (line.startsWith("boom")) throw new Error("filter broke");
          return line;
        },
      });
      const io = await withShellIO({}, async ({ stdin }) => {
        const running = shell.start();
        stdin.end("boom x\nok\nquit\n");
        await expect(running).resolves.toBeUndefined();
      });
      expect(ran).toEqual(["boom x", "ok"]);
      expect(io.stderr.getOutput().match(/filter broke/g)).toHaveLength(1);
      expect(await readFile(historyFile, "utf8")).toBe("ok\n");
    });
  });

  it("reports a failing mode action below a live progress frame, not on its row", async () => {
    await withHistoryFile(async (historyFile) => {
      const registry = new CommandRegistry();
      const router = new CommandRouter(registry);
      const shell = new InteractiveShell({ router, registry, prompt: "> ", historyFile });
      shell.enterMode({
        prompt: "sql> ",
        action: () => {
          progress.spinner({ label: "querying", stderr: process.stderr });
          throw new Error("query failed");
        },
      });
      try {
        const io = await withShellIO({}, async ({ stdin }) => {
          const running = shell.start();
          stdin.end("select 1\n");
          await running;
        });
        const output = io.stderr.getOutput();
        const report = output.indexOf("Error: query failed");
        expect(report).toBeGreaterThan(-1);
        // The frame row is erased or ended between the frame and the report.
        const afterFrame = output.slice(output.lastIndexOf("querying"), report);
        expect(afterFrame.includes("\x1b[K") || afterFrame.includes("\n")).toBe(true);
      } finally {
        restoreCursor();
      }
    });
  });

  it("restarts the completion iteration after any edit", async () => {
    await withHistoryFile(async (historyFile) => {
      const registry = new CommandRegistry();
      const router = new CommandRouter(registry);
      const iterations: number[] = [];
      CommandBuilder.create(registry, "connect [host]")
        .completer(({ iteration }) => {
          iterations.push(iteration);
          return ["west", "wide"];
        })
        .action(() => {});
      const shell = new InteractiveShell({ router, registry, prompt: "> ", historyFile });
      await withShellIO({ tty: true }, async ({ stdin }) => {
        const running = shell.start();
        await vi.waitFor(() => expect(readerOf(shell)).toBeDefined());
        const type = async (text: string) => {
          stdin.write(text);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        };
        await type("connect w");
        await type("\t");
        await type("\x7f");
        await type("w");
        await type("\t");
        await type("\t");
        await vi.waitFor(() => expect(iterations).toHaveLength(3));
        stdin.end();
        await running;
      });
      expect(iterations).toEqual([1, 1, 2]);
    });
  });
});

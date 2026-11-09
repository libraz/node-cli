import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createCLI, progress, prompt, type Shell } from "../src/index.js";
import { createMockTTY, restoreProcessStateAfterEach } from "./helpers.js";

const SHOW_CURSOR = "\x1b[?25h";

type ShellIO = {
  stdin: PassThrough & { isTTY?: boolean };
  stdout: ReturnType<typeof createMockTTY>;
  stderr: ReturnType<typeof createMockTTY>;
};

/** Runs `body` with process stdio replaced by in-memory terminals. */
async function withTerminal(body: (io: ShellIO, historyFile: string) => Promise<void>) {
  const original = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
  const stdin = new PassThrough() as ShellIO["stdin"];
  stdin.isTTY = true;
  const io: ShellIO = { stdin, stdout: createMockTTY(), stderr: createMockTTY() };
  const directory = await mkdtemp(join(tmpdir(), "node-cli-shell-surface-"));
  for (const name of ["stdin", "stdout", "stderr"] as const) {
    Object.defineProperty(process, name, { configurable: true, value: io[name] });
  }
  try {
    await body(io, join(directory, "history"));
  } finally {
    for (const name of ["stdin", "stdout", "stderr"] as const) {
      Object.defineProperty(process, name, { configurable: true, value: original[name] });
    }
    await rm(directory, { recursive: true, force: true });
  }
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Shell methods", () => {
  restoreProcessStateAfterEach();

  it("returns the shell from setPrompt, enterMode and exitMode, and nothing from stop", async () => {
    await withTerminal(async (io, historyFile) => {
      const results: unknown[] = [];
      let shellRef: Shell | null = null;
      const cli = createCLI({ name: "app", historyFile });
      cli.command("probe").action((ctx) => {
        const shell = ctx.shell as Shell;
        shellRef = shell;
        results.push(
          shell.setPrompt("p> "),
          shell.enterMode({ prompt: "m> ", action: () => {} }),
          shell.exitMode(),
          shell.stop(),
        );
      });
      const running = cli.start([]);
      io.stdin.write("probe\n");
      await vi.waitFor(() => expect(results).toHaveLength(4));
      await running;
      expect(results[0]).toBe(shellRef);
      expect(results[1]).toBe(shellRef);
      expect(results[2]).toBe(shellRef);
      expect(results[3]).toBeUndefined();
    });
  });
});

describe("commands in the shell", () => {
  restoreProcessStateAfterEach();

  it("hands a command the shell's stdin, readable through prompt.text", async () => {
    await withTerminal(async (io, historyFile) => {
      const answers: string[] = [];
      const cli = createCLI({ name: "app", historyFile });
      cli.command("ask").action(async (ctx) => {
        expect(ctx.stdin).toBe(process.stdin);
        answers.push(await prompt.text("name?", ctx));
      });
      const running = cli.start([]);
      io.stdin.write("ask\n");
      await tick(60);
      io.stdin.write("ada\n");
      await vi.waitFor(() => expect(answers).toEqual(["ada"]));
      io.stdin.end();
      await running;
    });
  });
});

describe("mode in the shell", () => {
  restoreProcessStateAfterEach();

  /** Enters a mode with the given completer, types `text` plus Tab, and returns what the action got. */
  async function completeInMode(
    completer: NonNullable<Parameters<Shell["enterMode"]>[0]["completer"]>,
    text: string,
  ): Promise<string[]> {
    const inputs: string[] = [];
    await withTerminal(async (io, historyFile) => {
      const cli = createCLI({ name: "app", historyFile });
      cli.command("go").action((ctx) => {
        ctx.shell?.enterMode({
          prompt: "m> ",
          completer,
          action: (input) => void inputs.push(input),
        });
      });
      const running = cli.start([]);
      io.stdin.write("go\n");
      await tick(60);
      io.stdin.write(`${text}\t`);
      await tick(60);
      io.stdin.write("\n");
      await tick(60);
      io.stdin.end();
      await running;
    });
    return inputs;
  }

  it("filters a static completer list by the word under the cursor", async () => {
    expect(await completeInMode(["select", "insert", "update"], "ins")).toEqual(["insert"]);
  });

  it("filters the candidates a function completer returns by ctx.current", async () => {
    const seen: string[] = [];
    const inputs = await completeInMode((ctx) => {
      seen.push(ctx.current);
      return ["select", "insert", "update"];
    }, "up");
    expect(seen).toContain("up");
    expect(inputs).toEqual(["update"]);
  });

  it("hands the action the shell's stdin, readable through prompt.text", async () => {
    await withTerminal(async (io, historyFile) => {
      const answers: string[] = [];
      const cli = createCLI({ name: "app", historyFile });
      cli.command("go").action((ctx) => {
        ctx.shell?.enterMode({
          prompt: "m> ",
          action: async (_input, modeCtx) => {
            expect(modeCtx.stdin).toBe(process.stdin);
            answers.push(await prompt.text("name?", modeCtx));
          },
        });
      });
      const running = cli.start([]);
      io.stdin.write("go\n");
      await tick(60);
      io.stdin.write("ask\n");
      await tick(60);
      io.stdin.write("ada\n");
      await vi.waitFor(() => expect(answers).toEqual(["ada"]));
      io.stdin.end();
      await running;
    });
  });

  it("releases only the indicators the mode action created", async () => {
    await withTerminal(async (io, historyFile) => {
      const outside = createMockTTY();
      const inside = createMockTTY();
      const cli = createCLI({ name: "app", historyFile });
      cli.command("go").action((ctx) => {
        ctx.shell?.enterMode({
          prompt: "m> ",
          action: () => {
            progress.spinner({ label: "inner", stderr: inside });
          },
        });
      });
      const running = cli.start([]);
      io.stdin.write("go\n");
      await tick(60);
      // Created from the test, outside any command or action scope.
      const bystander = progress.spinner({ label: "outer", stderr: outside });
      io.stdin.write("work\n");
      await vi.waitFor(() => expect(inside.getOutput()).toContain(SHOW_CURSOR));
      expect(outside.getOutput()).not.toContain(SHOW_CURSOR);
      bystander.stop();
      io.stdin.end();
      await running;
    });
  });
});

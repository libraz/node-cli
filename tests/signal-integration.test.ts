import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function waitForOutput(read: () => string, expected: string, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolveWait, reject) => {
    const started = Date.now();
    const check = () => {
      if (read().includes(expected)) {
        resolveWait();
      } else if (Date.now() - started >= timeoutMs) {
        reject(new Error(`timed out waiting for ${JSON.stringify(expected)}; got ${read()}`));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function count(text: string, sequence: string): number {
  return text.split(sequence).length - 1;
}

/** Spawns a fixture with piped stdio and collects stdout and stderr together. */
function spawnFixture(args: string[]): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });
  return { child, output: () => output };
}

async function exitOf(
  child: ChildProcess,
  timeoutMs = 6_000,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; elapsed: number }> {
  const started = Date.now();
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
  clearTimeout(timeout);
  return { code, signal, elapsed: Date.now() - started };
}

/** Sends a cooperative Ctrl-C, then a second one past the force-quit grace window. */
async function forceQuit(child: ChildProcess, output: () => string): Promise<void> {
  child.kill("SIGINT");
  await waitForOutput(output, "Press Ctrl-C again to force quit");
  await delay(300);
  child.kill("SIGINT");
}

describe.skipIf(process.platform === "win32")("OS signal integration", () => {
  it("waits for cooperative SIGINT cleanup and isolates a throwing cancel handler", async () => {
    const child = spawn(process.execPath, [resolve("tests/fixtures/sigint-child.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    await new Promise<void>((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("child did not become ready")), 2_000);
      child.stdout.on("data", () => {
        if (stdout.includes("READY:")) {
          clearTimeout(timeout);
          resolveReady();
        }
      });
    });
    expect(stdout).toContain("READY:1\n");
    expect(child.kill("SIGINT")).toBe(true);
    setTimeout(() => child.kill("SIGINT"), 5);

    const timeout = setTimeout(() => child.kill("SIGKILL"), 2_000);
    const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
    clearTimeout(timeout);
    expect({ code, signal }).toEqual({ code: 130, signal: null });
    expect(stdout).toContain("CANCEL\n");
    expect(stdout.split("CANCEL\n")).toHaveLength(2);
    expect(stdout).toContain("CLEAN\n");
    expect(stderr).not.toContain("uncaught");
    expect(stderr).not.toContain("cancel cleanup failed");
  });
  it("leaves SIGINT to the host for programmatic executions", async () => {
    const { child, output } = spawnFixture([
      resolve("tests/fixtures/exec-force-quit-child.mjs"),
      "programmatic",
    ]);
    try {
      expect(await exitOf(child, 8_000)).toMatchObject({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    // Only the host's own listener exists while both executions are pending.
    expect(output()).toContain("LISTENERS:0\n");
    expect(output()).toContain("PENDING_LISTENERS:1\n");
    expect(output()).toContain("CANCELLED first");
    expect(output()).toContain("CANCELLED second");
    expect(output()).toContain("SETTLED:fulfilled,fulfilled");
    expect(output()).not.toContain("Press Ctrl-C again to force quit");
  });

  it("runs every exit listener when a start() command is force-quit", async () => {
    const { child, output } = spawnFixture([
      resolve("tests/fixtures/exec-force-quit-child.mjs"),
      "start",
    ]);
    try {
      await waitForOutput(output, "HANGING");
      await forceQuit(child, output);
      expect(await exitOf(child)).toMatchObject({ code: 130, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    expect(output()).toContain("EXIT_FIRST");
    expect(output()).toContain("EXIT_LAST");
  });

  it("runs exit listeners once when the action settles during a direct force quit", async () => {
    const { child, output } = spawnFixture([
      resolve("tests/fixtures/direct-force-quit-child.mjs"),
      "late",
    ]);
    try {
      await waitForOutput(output, "READY");
      await forceQuit(child, output);
      expect(await exitOf(child)).toMatchObject({ code: 130, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    expect(output()).toContain("SETTLED");
    expect(count(output(), "EXIT_FIRST")).toBe(1);
    expect(count(output(), "EXIT_LAST")).toBe(1);
  });

  it("runs exit listeners once when nested executions are force-quit", async () => {
    const { child, output } = spawnFixture([
      resolve("tests/fixtures/direct-force-quit-child.mjs"),
      "nested",
    ]);
    try {
      await waitForOutput(output, "READY");
      await forceQuit(child, output);
      expect(await exitOf(child)).toMatchObject({ code: 130, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    expect(count(output(), "EXIT_FIRST")).toBe(1);
    expect(count(output(), "EXIT_LAST")).toBe(1);
  });

  describe("interactive shell", () => {
    async function withShell(
      scenario: string,
      run: (child: ChildProcess, output: () => string) => Promise<void>,
    ): Promise<string> {
      const directory = await mkdtemp(join(tmpdir(), "node-cli-shell-signal-"));
      const { child, output } = spawnFixture([
        resolve("tests/fixtures/shell-signal-child.mjs"),
        scenario,
        join(directory, "history"),
      ]);
      try {
        await waitForOutput(output, "SHELL_READY");
        await run(child, output);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await rm(directory, { recursive: true, force: true });
      }
      return output();
    }

    it("aborts a running mode action on SIGTERM before exiting", async () => {
      const output = await withShell("mode-sigterm", async (child, read) => {
        child.stdin?.write("sql\nselect 1\n");
        await waitForOutput(read, "MODE_STARTED");
        child.kill("SIGTERM");
        expect(await exitOf(child)).toMatchObject({ code: 143, signal: null });
      });
      expect(output).toContain("MODE_ABORTED");
      // The action's cleanup ran inside the grace period, before exit listeners.
      expect(output.indexOf("MODE_CLEANED")).toBeGreaterThan(-1);
      expect(output.indexOf("MODE_CLEANED")).toBeLessThan(output.indexOf("EXIT_FIRST"));
      expect(count(output, "EXIT_FIRST")).toBe(1);
    });

    it("runs every exit listener when a mode action is force-quit", async () => {
      const output = await withShell("mode-force-quit", async (child, read) => {
        child.stdin?.write("sql\nselect 1\n");
        await waitForOutput(read, "MODE_STARTED");
        await forceQuit(child, read);
        expect(await exitOf(child)).toMatchObject({ code: 130, signal: null });
      });
      expect(count(output, "EXIT_FIRST")).toBe(1);
      expect(count(output, "EXIT_LAST")).toBe(1);
    });

    it("bounds a hung exit listener on SIGTERM and emits exit once", async () => {
      const output = await withShell("hung-exit", async (child) => {
        child.kill("SIGTERM");
        const result = await exitOf(child);
        expect(result).toMatchObject({ code: 143, signal: null });
        // 200 ms grace plus the 2000 ms cleanup bound, with scheduling slack.
        expect(result.elapsed).toBeLessThan(4_000);
      });
      expect(count(output, "EXIT_FIRST")).toBe(1);
    });

    it("emits exit once when SIGTERM arrives during a force quit", async () => {
      const output = await withShell("force-quit-then-sigterm", async (child, read) => {
        child.stdin?.write("hang\n");
        await waitForOutput(read, "HANGING");
        await forceQuit(child, read);
        await waitForOutput(read, "EXIT_FIRST");
        child.kill("SIGTERM");
        // The force quit owns the exit; the later signal changes neither the
        // code nor how often listeners run.
        expect(await exitOf(child)).toMatchObject({ code: 130, signal: null });
      });
      expect(count(output, "EXIT_FIRST")).toBe(1);
    });
  });
});

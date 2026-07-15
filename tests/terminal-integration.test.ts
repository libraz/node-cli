import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
const canRunPty =
  process.platform !== "win32" && python.status === 0 && existsSync("dist/index.js");

const ptyProxy = `
import os, pty, sys
status = pty.spawn(sys.argv[1:])
if os.WIFEXITED(status):
    raise SystemExit(os.WEXITSTATUS(status))
if os.WIFSIGNALED(status):
    raise SystemExit(128 + os.WTERMSIG(status))
raise SystemExit(1)
`;

function count(text: string, sequence: string): number {
  return text.split(sequence).length - 1;
}

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

describe.skipIf(!canRunPty)("pseudo-TTY integration", () => {
  it("shares cursor ownership and clears terminal lines in a real TTY", () => {
    const child = spawnSync(
      "python3",
      ["-c", ptyProxy, process.execPath, resolve("tests/fixtures/tty-progress-child.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
        timeout: 5_000,
      },
    );

    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("TTY:true");
    expect(child.stdout).toContain("PROGRESS_DONE");
    expect(count(child.stdout, "\x1b[?25l")).toBe(1);
    expect(count(child.stdout, "\x1b[?25h")).toBe(1);
    expect(child.stdout).toContain("\r\x1b[K");
    expect(child.stdout).toContain("TRUNC:\x1b[31mabc…\x1b[0mPLAIN");
    expect(child.stdout).toContain(
      "LINK:\x1b]8;;https://example.invalid\x1b\\abc…\x1b]8;;\x1b\\PLAIN",
    );
  });

  it("clears partial REPL input when the terminal sends Ctrl+C", async () => {
    const child = spawn(
      "python3",
      ["-c", ptyProxy, process.execPath, resolve("tests/fixtures/tty-repl-child.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    try {
      await waitForOutput(() => output, "TTY_REPL_READY");
      child.stdin.write("stale");
      await waitForOutput(() => output, "stale");
      const cancelOutputStart = output.length;
      child.stdin.write("\x03");
      await waitForOutput(() => output.slice(cancelOutputStart), "\x1b[0J> ");
      child.stdin.write("fresh\n");
      await waitForOutput(() => output, "FRESH_ACTION");
      child.stdin.write("quit\n");

      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      clearTimeout(timeout);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    expect(output).toContain("FRESH_ACTION");
    expect(output).not.toContain("STALE_ACTION");
  });

  it("prints plain help when only stdin is a TTY", () => {
    const redirectHarness = `
import os, subprocess, sys
master, slave = pty = os.openpty()
try:
    result = subprocess.run(sys.argv[1:], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
finally:
    os.close(master)
    os.close(slave)
sys.stdout.buffer.write(result.stdout)
sys.stderr.buffer.write(result.stderr)
raise SystemExit(result.returncode)
`;
    const child = spawnSync(
      "python3",
      ["-c", redirectHarness, process.execPath, resolve("tests/fixtures/tty-redirect-child.mjs")],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 5_000 },
    );

    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("Available commands");
    expect(child.stdout).not.toContain("HIDDEN_PROMPT");
    expect(child.stdout).not.toContain("\x1b[");
  });

  it("isolates mode history and restores its in-memory entries", async () => {
    const child = spawn(
      "python3",
      ["-c", ptyProxy, process.execPath, resolve("tests/fixtures/tty-mode-child.mjs")],
      { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    try {
      await waitForOutput(() => output, "MODE_SHELL_READY");
      child.stdin.write("parent\n");
      await waitForOutput(() => output, "PARENT_ACTION");
      child.stdin.write("mode\n");
      await waitForOutput(() => output, "MODE_ENTER");

      const emptyHistoryStart = output.length;
      child.stdin.write("\x1b[A\n");
      await waitForOutput(() => output.slice(emptyHistoryStart), "mode> ");
      expect(output).not.toContain("MODE:mode");
      expect(output).not.toContain("MODE:parent");

      child.stdin.write("alpha\n");
      await waitForOutput(() => output, "MODE:alpha");
      child.stdin.write("\x1b[A\n");
      await waitForOutput(() => String(count(output, "MODE:alpha")), "2");
      const exitStart = output.length;
      child.stdin.write("exit\n");
      await waitForOutput(() => output.slice(exitStart), "\x1b[0J> ");
      child.stdin.write("quit\n");

      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      clearTimeout(timeout);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    expect(count(output, "MODE:alpha")).toBe(2);
    expect(output).not.toContain("MODE:mode");
    expect(output).not.toContain("MODE:parent");
  });
});

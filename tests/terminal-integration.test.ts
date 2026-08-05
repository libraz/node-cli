import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const python = spawnSync("python3", ["--version"], { stdio: "ignore" });
const canRunPty = process.platform !== "win32" && python.status === 0;
if (process.platform !== "win32" && !canRunPty && process.env.ALLOW_SKIP_PTY !== "1") {
  throw new Error(
    "python3 is required for pseudo-TTY tests; set ALLOW_SKIP_PTY=1 to skip explicitly",
  );
}

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

  it("restores a standalone progress cursor before SIGINT terminates it", () => {
    const sigintHarness = `
import os, pty, select, signal, subprocess, sys, time
master, slave = os.openpty()
try:
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave)
finally:
    os.close(slave)
output = b""
deadline = time.time() + 5
while b"SIGINT_CURSOR_READY" not in output and time.time() < deadline:
    ready, _, _ = select.select([master], [], [], 0.05)
    if master in ready:
        try:
            output += os.read(master, 4096)
        except OSError:
            break
if b"SIGINT_CURSOR_READY" not in output:
    child.kill()
    raise SystemExit("cursor fixture did not start")
os.kill(child.pid, signal.SIGINT)
while child.poll() is None:
    ready, _, _ = select.select([master], [], [], 0.05)
    if master in ready:
        try:
            output += os.read(master, 4096)
        except OSError:
            break
while True:
    try:
        chunk = os.read(master, 4096)
    except OSError:
        break
    if not chunk:
        break
    output += chunk
os.close(master)
sys.stdout.buffer.write(output)
if child.returncode < 0:
    raise SystemExit(128 + -child.returncode)
raise SystemExit(child.returncode)
`;
    const child = spawnSync(
      "python3",
      ["-c", sigintHarness, process.execPath, resolve("tests/fixtures/sigint-cursor-child.mjs")],
      { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 8_000 },
    );

    expect(child.status, child.stderr).toBe(130);
    expect(child.stdout).toContain("\x1b[?25l");
    expect(child.stdout).toContain("\x1b[?25h");
  });

  it("executes and persists every line from a single terminal paste", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "node-cli-repl-paste-"));
    const historyFile = join(fixtureDir, "history");
    const child = spawn(
      "python3",
      ["-c", ptyProxy, process.execPath, resolve("tests/fixtures/tty-repl-child.mjs"), historyFile],
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
      child.stdin.write("one\ntwo\nthree\n");
      await waitForOutput(() => output, "PASTE_ONE");
      await waitForOutput(() => output, "PASTE_TWO");
      await waitForOutput(() => output, "PASTE_THREE");
      child.stdin.write("quit\n");

      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      clearTimeout(timeout);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(await readFile(historyFile, "utf8")).toBe("one\ntwo\nthree\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(fixtureDir, { recursive: true, force: true });
    }

    expect(output).toContain("PASTE_ONE");
    expect(output).toContain("PASTE_TWO");
    expect(output).toContain("PASTE_THREE");
  });

  it("restores an unfinished pasted line without executing it", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "node-cli-repl-partial-paste-"));
    const historyFile = join(fixtureDir, "history");
    const child = spawn(
      "python3",
      ["-c", ptyProxy, process.execPath, resolve("tests/fixtures/tty-repl-child.mjs"), historyFile],
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
      child.stdin.write("one\ntw");
      await waitForOutput(() => output, "PASTE_ONE");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      expect(output).not.toContain("PASTE_TWO");

      child.stdin.write("o\n");
      await waitForOutput(() => output, "PASTE_TWO");
      child.stdin.write("quit\n");

      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      clearTimeout(timeout);
      expect({ code, signal }).toEqual({ code: 0, signal: null });
      expect(await readFile(historyFile, "utf8")).toBe("one\ntwo\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(fixtureDir, { recursive: true, force: true });
    }
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

  it("masks passwords when stdin is a TTY and stdout is redirected", () => {
    const passwordHarness = `
import os, select, subprocess, sys, time
master, slave = os.openpty()
try:
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
finally:
    os.close(slave)
stderr = b""
deadline = time.time() + 5
while b"Password:" not in stderr and time.time() < deadline:
    ready, _, _ = select.select([child.stderr], [], [], 0.05)
    if child.stderr in ready:
        stderr += os.read(child.stderr.fileno(), 4096)
if b"Password:" not in stderr:
    child.kill()
    raise SystemExit("password prompt did not appear")
os.write(master, b"secret\\n")
stdout, remaining_stderr = child.communicate(timeout=5)
stderr += remaining_stderr
screen = b""
os.set_blocking(master, False)
while True:
    try:
        chunk = os.read(master, 4096)
    except BlockingIOError:
        break
    if not chunk:
        break
    screen += chunk
os.close(master)
sys.stdout.buffer.write(stdout + stderr + screen)
raise SystemExit(child.returncode)
`;
    const child = spawnSync(
      "python3",
      [
        "-c",
        passwordHarness,
        process.execPath,
        resolve("tests/fixtures/tty-password-redirect-child.mjs"),
      ],
      { encoding: "utf8", timeout: 8_000 },
    );

    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain("PASSWORD_OK");
    expect(child.stdout).toContain("Password:");
    expect(child.stdout).not.toContain("secret");
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
      child.stdin.write("beta\n");
      await waitForOutput(() => output, "MODE:beta");
      child.stdin.write("gamma\n");
      await waitForOutput(() => output, "MODE:gamma");
      child.stdin.write("\x1b[A\n");
      await waitForOutput(() => String(count(output, "MODE:gamma")), "2");
      child.stdin.write("\x1b[A\x1b[A\n");
      await waitForOutput(() => String(count(output, "MODE:beta")), "2");
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

    expect(count(output, "MODE:alpha")).toBe(1);
    expect(count(output, "MODE:beta")).toBe(2);
    expect(count(output, "MODE:gamma")).toBe(2);
    expect(output).not.toContain("MODE:mode");
    expect(output).not.toContain("MODE:parent");
  });

  it("persists accepted history before a force-quit and restores the cursor", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "node-cli-force-quit-"));
    const historyFile = join(fixtureDir, "history");
    const child = spawn(
      "python3",
      [
        "-c",
        ptyProxy,
        process.execPath,
        resolve("tests/fixtures/force-quit-history-child.mjs"),
        historyFile,
      ],
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
      await waitForOutput(() => output, "FORCE_QUIT_READY");
      child.stdin.write("normal\n");
      await waitForOutput(() => output, "NORMAL_DONE");
      child.stdin.write("hang\n");
      await waitForOutput(() => output, "HANGING");
      child.stdin.write("\x03");
      await waitForOutput(() => output, "Press Ctrl-C again to force quit");
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      child.stdin.write("\x03");

      const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
      const [code, signal] = (await once(child, "exit")) as [number | null, NodeJS.Signals | null];
      clearTimeout(timeout);
      expect({ code, signal }).toEqual({ code: 130, signal: null });
      expect(await readFile(historyFile, "utf8")).toBe("normal\nhang\n");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await rm(fixtureDir, { recursive: true, force: true });
    }

    expect(output).toContain("\x1b[?25l");
    expect(output).toContain("\x1b[?25h");
    expect(output).toContain("EXIT_EVENT");
  });

  it("cancels active work and flushes history before a SIGTERM exit", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "node-cli-sigterm-"));
    const historyFile = join(fixtureDir, "history");
    const sigtermHarness = `
import os, pty, select, signal, subprocess, sys, time
master, slave = os.openpty()
try:
    child = subprocess.Popen(sys.argv[1:], stdin=slave, stdout=slave, stderr=slave)
finally:
    os.close(slave)
output = b""
def read_until(marker):
    global output
    deadline = time.time() + 5
    while marker not in output and time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.05)
        if master in ready:
            chunk = os.read(master, 4096)
            if not chunk:
                break
            output += chunk
    if marker not in output:
        child.kill()
        raise SystemExit("timed out waiting for " + repr(marker))
read_until(b"SIGTERM_READY")
os.write(master, b"hang\\n")
read_until(b"HANGING")
os.kill(child.pid, signal.SIGTERM)
while child.poll() is None:
    ready, _, _ = select.select([master], [], [], 0.05)
    if master in ready:
        try:
            output += os.read(master, 4096)
        except OSError:
            break
while True:
    try:
        chunk = os.read(master, 4096)
    except OSError:
        break
    if not chunk:
        break
    output += chunk
os.close(master)
sys.stdout.buffer.write(output)
raise SystemExit(child.returncode)
`;
    try {
      const child = spawnSync(
        "python3",
        [
          "-c",
          sigtermHarness,
          process.execPath,
          resolve("tests/fixtures/sigterm-history-child.mjs"),
          historyFile,
        ],
        { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, timeout: 8_000 },
      );

      expect(child.status, child.stderr).toBe(143);
      expect(child.stdout).toContain("CANCELLED");
      expect(child.stdout).toContain("EXIT_EVENT");
      expect(await readFile(historyFile, "utf8")).toBe("hang\n");
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});

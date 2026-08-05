import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { Shell } from "../src/shell/repl.js";
import { createMockStdout } from "./helpers.js";

describe("Shell error and termination handling", () => {
  it("formats command errors for the interactive stderr stream", () => {
    const shell = new Shell({
      router: new CommandRouter(new CommandRegistry()),
      registry: new CommandRegistry(),
      prompt: "> ",
      historyFile: "unused-history",
    });
    const stderr = createMockStdout();
    const originalWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    try {
      (shell as unknown as { reportError(error: unknown): void }).reportError(new Error("broken"));
    } finally {
      process.stderr.write = originalWrite;
    }
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
});

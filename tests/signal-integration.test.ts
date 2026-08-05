import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
});

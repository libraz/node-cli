import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CLI } from "../src/cli.js";
import { createMockTTY } from "./helpers.js";

async function captureInteractiveOutput(cli: CLI): Promise<string> {
  const originalStdin = process.stdin;
  const originalStdout = process.stdout;
  const originalStderr = process.stderr;
  const stdin = new PassThrough() as PassThrough & { isTTY: true };
  stdin.isTTY = true;
  const stdout = createMockTTY();
  const stderr = createMockTTY();
  Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
  Object.defineProperty(process, "stdout", { configurable: true, value: stdout });
  Object.defineProperty(process, "stderr", { configurable: true, value: stderr });
  try {
    const started = cli.start([]);
    stdin.end();
    await started;
    return stdout.getOutput();
  } finally {
    Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
    Object.defineProperty(process, "stdout", { configurable: true, value: originalStdout });
    Object.defineProperty(process, "stderr", { configurable: true, value: originalStderr });
  }
}

describe("Banner and Description", () => {
  describe("description()", () => {
    it("is chainable and returns the CLI instance", () => {
      const cli = new CLI({ name: "myapp" });
      const result = cli.description("A cool tool");
      expect(result).toBe(cli);
    });
  });

  describe("banner()", () => {
    it("is chainable and returns the CLI instance", () => {
      const cli = new CLI({ name: "myapp" });
      const result = cli.banner("Welcome!");
      expect(result).toBe(cli);
    });

    it("can be set to empty string to suppress", () => {
      const cli = new CLI({ name: "myapp", version: "1.0.0" });
      const result = cli.banner("");
      expect(result).toBe(cli);
    });

    it("derives the default banner and suppresses it when explicitly empty", async () => {
      const directory = await mkdtemp(join(tmpdir(), "node-cli-banner-"));
      try {
        const defaultOutput = await captureInteractiveOutput(
          new CLI({
            name: "myapp",
            version: "1.0.0",
            historyFile: join(directory, "default-history"),
          }),
        );
        const suppressedOutput = await captureInteractiveOutput(
          new CLI({
            name: "myapp",
            version: "1.0.0",
            banner: "",
            historyFile: join(directory, "suppressed-history"),
          }),
        );

        expect(defaultOutput).toContain("myapp v1.0.0\n");
        expect(suppressedOutput).not.toContain("myapp v1.0.0");
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });

  describe("options constructor", () => {
    it("accepts description and banner in options", () => {
      const cli = new CLI({
        name: "myapp",
        version: "1.0.0",
        description: "A test CLI",
        banner: "Welcome to myapp!",
      });
      expect(cli).toBeDefined();
    });
  });

  describe("help output includes metadata", () => {
    it("shows name and version in help", async () => {
      const cli = new CLI({ name: "myapp", version: "2.0.0", description: "A test tool" });
      cli.command("test").description("Test command");

      let output = "";
      await cli.exec("help", {
        stdout: {
          write(data: string) {
            output += data;
            return true;
          },
        } as NodeJS.WritableStream,
      });

      expect(output).toContain("myapp v2.0.0");
      expect(output).toContain("A test tool");
    });

    it("updates metadata after description() chain call", async () => {
      const cli = new CLI({ name: "myapp", version: "1.0.0" });
      cli.description("Updated description");
      cli.command("test").description("Test command");

      let output = "";
      await cli.exec("help", {
        stdout: {
          write(data: string) {
            output += data;
            return true;
          },
        } as NodeJS.WritableStream,
      });

      expect(output).toContain("Updated description");
    });
  });
});

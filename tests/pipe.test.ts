import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { splitPipes } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { createMockStdout } from "./helpers.js";

describe("splitPipes", () => {
  it("splits simple pipe", () => {
    expect(splitPipes("cmd1 | cmd2")).toEqual(["cmd1", "cmd2"]);
  });

  it("splits multiple pipes", () => {
    expect(splitPipes("a | b | c")).toEqual(["a", "b", "c"]);
  });

  it("does not split pipe inside double quotes", () => {
    expect(splitPipes('echo "a | b"')).toEqual(['echo "a | b"']);
  });

  it("does not split pipe inside single quotes", () => {
    expect(splitPipes("echo 'a | b'")).toEqual(["echo 'a | b'"]);
  });

  it("handles no pipes", () => {
    expect(splitPipes("just a command")).toEqual(["just a command"]);
  });

  it("trims segments", () => {
    expect(splitPipes("  a  |  b  ")).toEqual(["a", "b"]);
  });
});

describe("piped execution", () => {
  it("executes piped commands passing stdout to stdin", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "produce").action((ctx) => {
      ctx.stdout.write("hello from produce");
    });
    new CommandBuilder(registry, "consume").action(async (ctx) => {
      if (ctx.stdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of ctx.stdin) {
          chunks.push(Buffer.from(chunk));
        }
        const input = Buffer.concat(chunks).toString();
        ctx.stdout.write(`consumed: ${input}`);
      } else {
        ctx.stdout.write("no stdin");
      }
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await router.execute("produce | consume", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("consumed: hello from produce");
  });

  it("single command without pipe works normally", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "hello").action((ctx) => {
      ctx.stdout.write("world");
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await router.execute("hello", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("world");
  });
});

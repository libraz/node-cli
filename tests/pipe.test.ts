import { Readable } from "node:stream";
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

  it("passes injected stdin to the first pipeline stage", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "source").action(async (ctx) => {
      for await (const chunk of ctx.stdin ?? []) ctx.stdout.write(chunk);
    });
    new CommandBuilder(registry, "consume").action(async (ctx) => {
      for await (const chunk of ctx.stdin ?? []) ctx.stdout.write(chunk.toString().toUpperCase());
    });
    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await router.execute("source | consume", {
      stdin: Readable.from(["hello"]),
      stdout: stream,
      stderr: stream,
    });
    expect(stream.getOutput()).toBe("HELLO");
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

  it("tears down upstream producers when a downstream stage exits early", async () => {
    const registry = new CommandRegistry();
    let producerReleased = false;

    new CommandBuilder(registry, "produce").action(async (ctx) => {
      while (!producerReleased) {
        const canContinue = ctx.stdout.write("x".repeat(1024));
        if (!canContinue) {
          await new Promise<void>((resolve) => ctx.stdout.once("drain", resolve));
        }
        if ((ctx.stdout as NodeJS.WritableStream).destroyed) {
          producerReleased = true;
        }
      }
    });

    new CommandBuilder(registry, "take").action(async (ctx) => {
      if (!ctx.stdin) return;
      await new Promise<void>((resolve) => ctx.stdin?.once("data", () => resolve()));
      ctx.stdout.write("done");
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    const execution = router.execute("produce | take", { stdout: stream, stderr: stream });
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("pipeline hung")), 1000);
    });

    await Promise.race([execution, timeout]);
    expect(producerReleased).toBe(true);
    expect(stream.getOutput()).toBe("done");
  });

  it("aborts an external-I/O upstream when a downstream stage finishes early", async () => {
    const registry = new CommandRegistry();
    let upstreamAborted = false;
    new CommandBuilder(registry, "external").action(
      (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            upstreamAborted = true;
            resolve();
          });
        }),
    );
    new CommandBuilder(registry, "take").action(() => {});
    const router = new CommandRouter(registry);
    await expect(router.execute("external | take")).resolves.toBeUndefined();
    expect(upstreamAborted).toBe(true);
  });

  it("aborts sibling stages when any pipeline stage fails", async () => {
    const registry = new CommandRegistry();
    const aborted: string[] = [];
    const waitForAbort = (name: string) =>
      new CommandBuilder(registry, name).action(
        (ctx) =>
          new Promise<void>((resolve) => {
            ctx.signal.addEventListener(
              "abort",
              () => {
                aborted.push(name);
                resolve();
              },
              { once: true },
            );
          }),
      );
    waitForAbort("source");
    waitForAbort("middle");
    new CommandBuilder(registry, "fail").action(() => {
      throw new Error("stage failed");
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    await expect(
      Promise.race([
        router.execute("source | middle | fail", { stdout: stream, stderr: stream }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("pipeline hung")), 500)),
      ]),
    ).rejects.toThrow("stage failed");
    expect(aborted.sort()).toEqual(["middle", "source"]);
  });
});

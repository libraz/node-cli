import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
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
    CommandBuilder.create(registry, "produce").action((ctx) => {
      ctx.stdout.write("hello from produce");
    });
    CommandBuilder.create(registry, "consume").action(async (ctx) => {
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
    CommandBuilder.create(registry, "source").action(async (ctx) => {
      for await (const chunk of ctx.stdin ?? []) ctx.stdout.write(chunk);
    });
    CommandBuilder.create(registry, "consume").action(async (ctx) => {
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
    CommandBuilder.create(registry, "hello").action((ctx) => {
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

    CommandBuilder.create(registry, "produce").action(async (ctx) => {
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

    CommandBuilder.create(registry, "take").action(async (ctx) => {
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
    CommandBuilder.create(registry, "external").action(
      (ctx) =>
        new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            upstreamAborted = true;
            resolve();
          });
        }),
    );
    CommandBuilder.create(registry, "take").action(() => {});
    const router = new CommandRouter(registry);
    await expect(router.execute("external | take")).resolves.toBeUndefined();
    expect(upstreamAborted).toBe(true);
  });

  it("aborts sibling stages when any pipeline stage fails", async () => {
    const registry = new CommandRegistry();
    const aborted: string[] = [];
    const waitForAbort = (name: string) =>
      CommandBuilder.create(registry, name).action(
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
    CommandBuilder.create(registry, "fail").action(() => {
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

  it("preserves the initiating stage error when aborted siblings reject with AbortError", async () => {
    const registry = new CommandRegistry();
    const waitForAbort = (name: string) =>
      CommandBuilder.create(registry, name).action(
        (ctx) =>
          new Promise<void>((_resolve, reject) => {
            ctx.signal.addEventListener(
              "abort",
              () => reject(new DOMException(`${name} aborted`, "AbortError")),
              { once: true },
            );
          }),
      );
    waitForAbort("source");
    waitForAbort("middle");
    CommandBuilder.create(registry, "fail").action(() => {
      throw new Error("database failed");
    });

    const router = new CommandRouter(registry);
    await expect(router.execute("source | middle | fail")).rejects.toThrow("database failed");
  });

  it("does not emit failure events for a graceful abort-aware early stop", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "source").action(
      (ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener(
            "abort",
            () => reject(new DOMException("source stopped", "AbortError")),
            { once: true },
          );
        }),
    );
    CommandBuilder.create(registry, "take").action(() => {});
    const router = new CommandRouter(registry);
    const commandErrors: Error[] = [];
    const errors: Error[] = [];
    router.on("commandError", (error) => commandErrors.push(error));
    router.on("error", (error) => errors.push(error));

    await expect(router.execute("source | take")).resolves.toBeUndefined();
    expect(commandErrors).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("does not hide a genuine upstream error after a downstream early stop", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "source").action(
      (ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("late source failure")), {
            once: true,
          });
        }),
    );
    CommandBuilder.create(registry, "take").action(() => {});

    const router = new CommandRouter(registry);
    await expect(router.execute("source | take")).rejects.toThrow("late source failure");
  });
});

describe("pipeline outcome and backpressure", () => {
  it("reports the exit code of the stage that actually failed", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "ok").action((ctx) => {
      ctx.stdout.write("data\n");
    });
    CommandBuilder.create(registry, "boom").action(() => {
      throw Object.assign(new Error("stage failed"), { exitCode: 7 });
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    router.on("error", () => {});

    await expect(
      router.execute("ok | boom", { stdout: stream, stderr: stream }),
    ).rejects.toMatchObject({ message: "stage failed", exitCode: 7 });
  });

  it("destroys the downstream pipe when a middle stage throws", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "source").action((ctx) => {
      ctx.stdout.write("data\n");
    });
    CommandBuilder.create(registry, "middle").action(() => {
      throw new Error("middle failed");
    });
    let downstreamSawEnd = false;
    CommandBuilder.create(registry, "sink").action(async (ctx) => {
      try {
        for await (const _chunk of ctx.stdin as Readable) {
          // Drain until the stream ends or is destroyed.
        }
      } catch {
        // A destroyed pipe rejects the iteration; either way it terminates.
      }
      downstreamSawEnd = true;
    });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    router.on("error", () => {});

    await expect(
      router.execute("source | middle | sink", { stdout: stream, stderr: stream }),
    ).rejects.toThrow("middle failed");
    // The sink must not be left waiting on a producer that will never write.
    expect(downstreamSawEnd).toBe(true);
  });
});

describe("graceful pipeline stop", () => {
  it("aborts an upstream stage without running its cancel handler", async () => {
    const registry = new CommandRegistry();
    const router = new CommandRouter(registry);
    const cancel = vi.fn();
    let upstreamSignal: AbortSignal | undefined;
    CommandBuilder.create(registry, "produce")
      .cancel(cancel)
      .action(
        (ctx) =>
          new Promise<void>((resolveProduce) => {
            upstreamSignal = ctx.signal;
            ctx.stdout.write("line\n");
            ctx.signal.addEventListener("abort", () => resolveProduce());
          }),
      );
    CommandBuilder.create(registry, "first").action(async (ctx) => {
      for await (const _chunk of ctx.stdin as Readable) break;
    });

    await router.execute("produce | first", { stdout: createMockStdout() });
    expect(upstreamSignal?.aborted).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });
});

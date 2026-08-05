import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CLI, ExtraArgumentError, progress, UnknownOptionError } from "../src/index.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

describe("programmatic exec", () => {
  it("executes a command programmatically", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    cli.command("echo <message>").action((ctx) => {
      ctx.stdout.write(`${ctx.args.message}\n`);
    });

    await cli.exec("echo hello", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("hello");
  });

  it("executes multiple commands in sequence", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    cli.command("count <n>").action((ctx) => {
      ctx.stdout.write(`count=${ctx.args.n}\n`);
    });

    await cli.exec("count 1", { stdout: stream, stderr: stream });
    await cli.exec("count 2", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("count=1");
    expect(stream.getOutput()).toContain("count=2");
  });

  it("throws on unknown command", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    await expect(cli.exec("nonexistent", { stdout: stream, stderr: stream })).rejects.toThrow(
      "Command not found",
    );
  });

  it("throws exported errors for invalid user input", async () => {
    const cli = new CLI();
    cli
      .command("deploy <env>")
      .option("--force")
      .action(() => {});

    await expect(cli.exec("deploy prod --unknown")).rejects.toThrow(UnknownOptionError);
    await expect(cli.exec("deploy prod extra")).rejects.toThrow(ExtraArgumentError);
  });

  it("events fire during exec", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    const events: string[] = [];

    cli.on("beforeExecute", () => {
      events.push("before");
    });
    cli.on("afterExecute", () => {
      events.push("after");
    });

    cli.command("ping").action((ctx) => {
      ctx.stdout.write("pong\n");
    });

    await cli.exec("ping", { stdout: stream, stderr: stream });
    expect(events).toEqual(["before", "after"]);
  });

  it("injects stdin into programmatic commands", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    cli.command("read").action(async (ctx) => {
      let input = "";
      for await (const chunk of ctx.stdin ?? []) input += chunk.toString();
      ctx.stdout.write(input.toUpperCase());
    });
    await cli.exec("read", {
      stdin: Readable.from(["hello"]),
      stdout: stream,
      stderr: stream,
    });
    expect(stream.getOutput()).toBe("HELLO");
  });

  it("links an external AbortSignal and removes its listener", async () => {
    const cli = new CLI();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const cancel = vi.fn();
    let actionStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      actionStarted = resolve;
    });
    cli
      .command("wait")
      .cancel(cancel)
      .action(
        (ctx) =>
          new Promise<void>((resolve) => {
            actionStarted();
            ctx.signal.addEventListener("abort", () => resolve());
          }),
      );
    const execution = cli.exec("wait", { signal: controller.signal });
    await started;
    controller.abort("test");
    await execution;
    expect(cancel).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("passes an already-aborted signal to the action", async () => {
    const cli = new CLI();
    const controller = new AbortController();
    controller.abort();
    let aborted = false;
    cli.command("check").action((ctx) => {
      aborted = ctx.signal.aborted;
    });
    await cli.exec("check", { signal: controller.signal });
    expect(aborted).toBe(true);
  });

  it("restores the outer diagnostic stream after a nested execution", async () => {
    const cli = new CLI();
    const outerErr = createMockStdout();
    const innerErr = createMockStdout();
    cli.command("inner").action(() => {});
    cli.command("outer").action(async () => {
      await cli.exec("inner", { stderr: innerErr });
      throw new Error("outer failed");
    });
    cli.on("error", () => {
      throw new Error("error handler failed");
    });

    await expect(cli.exec("outer", { stderr: outerErr })).rejects.toThrow("outer failed");
    expect(outerErr.getOutput()).toContain("Error in error handler: error handler failed");
    expect(innerErr.getOutput()).toBe("");
  });

  it("releases abandoned progress indicators after a command failure", async () => {
    const cli = new CLI();
    const tty = createMockTTY();
    cli.command("broken").action(() => {
      progress.spinner({ stream: tty, label: "working" }).start();
      throw new Error("command failed");
    });

    await expect(cli.exec("broken")).rejects.toThrow("command failed");
    expect(tty.getOutput()).toContain("\x1b[?25h");

    const replacement = progress.bar({ total: 1, stream: tty });
    expect(() => replacement.update(1)).not.toThrow();
    replacement[Symbol.dispose]();
  });
});

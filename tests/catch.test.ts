import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { createCLI, type FallbackContext } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

describe("catch/fallback command", () => {
  function createRouter() {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy <env>").action((ctx) => {
      ctx.stdout.write("deployed\n");
    });
    return new CommandRouter(registry);
  }

  it("throws CommandNotFoundError without catch handler", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    await expect(router.execute("unknown", { stdout: stream, stderr: stream })).rejects.toThrow(
      "Command not found",
    );
  });

  it("invokes catch handler for unknown commands", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const handler = vi.fn((input, ctx) => {
      ctx.stdout.write(`caught: ${input}\n`);
    });

    router.setCatchHandler(handler);
    await router.execute("unknown foo bar", { stdout: stream, stderr: stream });
    expect(handler).toHaveBeenCalledOnce();
    expect(stream.getOutput()).toContain("caught: unknown foo bar");
  });

  it("passes unparseable free input to the catch handler", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const handler = vi.fn((input, ctx) => {
      ctx.stdout.write(`caught: ${input}\n`);
    });
    router.setCatchHandler(handler);

    await router.execute("what's the weather", { stdout: stream, stderr: stream });
    expect(handler).toHaveBeenCalledWith("what's the weather", expect.anything());
    expect(stream.getOutput()).toContain("caught: what's the weather");
  });

  it("invokes catch handlers for unknown nested commands", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "user create").action(() => {});
    const router = new CommandRouter(registry);
    const stream = createMockStdout();
    const handler = vi.fn((input, ctx) => ctx.stdout.write(`caught: ${input}\n`));
    router.setCatchHandler(handler);

    await router.execute("user typo", { stdout: stream, stderr: stream });
    expect(handler).toHaveBeenCalledWith("user typo", expect.anything());
  });

  it("does not invoke catch handler for known commands", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const handler = vi.fn();

    router.setCatchHandler(handler);
    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(handler).not.toHaveBeenCalled();
    expect(stream.getOutput()).toContain("deployed");
  });

  it("CLI.fallback() sets the handler and returns the CLI", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    const caught: string[] = [];

    const result = cli.fallback((input) => {
      caught.push(input);
    });

    expect(result).toBe(cli);
    await cli.execLine("unknowncmd", { stdout: stream, stderr: stream });
    expect(caught).toEqual(["unknowncmd"]);
  });

  it("hands the execution's streams and signal to the fallback", async () => {
    const cli = createCLI({ name: "test" });
    const stdin = Readable.from([]);
    const stdout = createMockStdout();
    const stderr = createMockStdout();
    const controller = new AbortController();
    let received: FallbackContext | undefined;
    cli.fallback((_input, ctx) => {
      received = ctx;
    });

    await cli.execLine("unknowncmd", { stdin, stdout, stderr, signal: controller.signal });
    expect(received).toEqual({ stdin, stdout, stderr, signal: controller.signal, rawArgv: null });
  });

  it("gives the fallback a live signal when exec supplies none", async () => {
    const cli = createCLI({ name: "test" });
    let received: FallbackContext | undefined;
    cli.fallback((_input, ctx) => {
      received = ctx;
    });

    await cli.execLine("unknowncmd", { stdout: createMockStdout() });
    expect(received?.stdin).toBeNull();
    expect(received?.signal).toBeInstanceOf(AbortSignal);
    expect(received?.signal.aborted).toBe(false);
  });
});

describe("fallback rawArgv", () => {
  it("hands the whole argv to the fallback, also for an unknown nested child", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("db migrate").action(() => {});
    const seen: { input: string; rawArgv: readonly string[] | null }[] = [];
    cli.fallback((input, ctx) => {
      seen.push({ input, rawArgv: ctx.rawArgv });
    });

    await cli.exec(["say", "two words", "--x"]);
    await cli.exec(["db", "nope", "a b"]);
    await cli.execLine("say 'two words'");
    expect(seen).toEqual([
      { input: "say two words --x", rawArgv: ["say", "two words", "--x"] },
      { input: "db nope a b", rawArgv: ["db", "nope", "a b"] },
      { input: "say 'two words'", rawArgv: null },
    ]);
  });
});

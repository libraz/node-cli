import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { createMockStdout } from "./helpers.js";

describe("catch/fallback command", () => {
  function createRouter() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>").action((ctx) => {
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
    new CommandBuilder(registry, "user create").action(() => {});
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

  it("CLI.catch() sets the handler", async () => {
    const { CLI } = await import("../src/cli.js");
    const cli = new CLI();
    const stream = createMockStdout();
    const caught: string[] = [];

    cli.catch((input) => {
      caught.push(input);
    });

    // Use exec to test
    await cli.exec("unknowncmd", { stdout: stream, stderr: stream });
    expect(caught).toEqual(["unknowncmd"]);
  });
});

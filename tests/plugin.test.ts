import { describe, expect, it } from "vitest";
import { CLI } from "../src/cli.js";
import { createMockStdout } from "./helpers.js";

describe("plugin system", () => {
  it("registers commands via plugin", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    cli.use((ctx) => {
      ctx
        .command("greet <name>")
        .description("Greet someone")
        .action((cmdCtx) => {
          cmdCtx.stdout.write(`Hello, ${cmdCtx.args.name}!\n`);
        });
    });

    await cli.exec("greet World", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("Hello, World!");
  });

  it("registers events via plugin", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    const events: string[] = [];

    cli.command("test").action((ctx) => {
      ctx.stdout.write("ran\n");
    });

    cli.use((ctx) => {
      ctx.on("beforeExecute", () => {
        events.push("plugin-before");
      });
    });

    await cli.exec("test", { stdout: stream, stderr: stream });
    expect(events).toEqual(["plugin-before"]);
  });

  it("multiple plugins compose", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    const order: string[] = [];

    cli.use((ctx) => {
      ctx.on("beforeExecute", () => {
        order.push("plugin1");
      });
    });

    cli.use((ctx) => {
      ctx.on("beforeExecute", () => {
        order.push("plugin2");
      });
    });

    cli.command("noop").action(() => {});
    await cli.exec("noop", { stdout: stream, stderr: stream });
    expect(order).toEqual(["plugin1", "plugin2"]);
  });

  it("async plugins are awaited on start", async () => {
    const cli = new CLI();
    let registered = false;

    cli.use(async (ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      ctx.command("async-cmd").action((cmdCtx) => {
        cmdCtx.stdout.write("async-ok\n");
      });
      registered = true;
    });

    const _stream = createMockStdout();
    // start with explicit argv triggers direct mode
    await cli.start(["async-cmd"]);
    expect(registered).toBe(true);
  });
});

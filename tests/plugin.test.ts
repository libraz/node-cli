import { afterEach, describe, expect, it, vi } from "vitest";
import { CLI } from "../src/cli.js";
import { createMockStdout } from "./helpers.js";

describe("plugin system", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });
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

  it("runs asynchronous plugin bodies in use() order", async () => {
    const cli = new CLI();
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    cli.use(async () => {
      await first;
      order.push("first");
    });
    cli.use(() => {
      order.push("second");
    });
    const run = cli.exec("help", { stdout: createMockStdout() });
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    await run;
    expect(order).toEqual(["first", "second"]);
  });

  it("surfaces a synchronous plugin throw through the initialization boundary", async () => {
    const cli = new CLI();
    cli.use(() => {
      throw new Error("sync plugin failed");
    });

    await expect(cli.exec("help")).rejects.toThrow("sync plugin failed");
  });

  it("shares one initialization barrier across concurrent exec calls", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    cli.use(async (ctx) => {
      await barrier;
      ctx.command("ready").action((command) => command.stdout.write("ok"));
    });

    const first = cli.exec("ready", { stdout: stream, stderr: stream });
    const second = cli.exec("ready", { stdout: stream, stderr: stream });
    release();
    await Promise.all([first, second]);
    expect(stream.getOutput()).toBe("okok");
  });

  it("shares the initialization barrier between start and exec", async () => {
    const cli = new CLI();
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = vi.fn();
    cli.use(async (ctx) => {
      await barrier;
      ctx.command("ready").action(action);
    });

    const direct = cli.start(["ready"]);
    const embedded = cli.exec("ready");
    release();
    await Promise.all([direct, embedded]);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("drains plugins registered while another plugin is initializing", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    cli.use(async () => {
      await Promise.resolve();
      cli.use(async (ctx) => {
        await Promise.resolve();
        ctx.command("nested").action((command) => command.stdout.write("nested"));
      });
    });
    await cli.exec("nested", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("nested");
  });

  it("keeps plugin initialization failures sticky", async () => {
    const cli = new CLI();
    const failure = new Error("plugin failed");
    cli.use(async () => {
      throw failure;
    });
    await expect(cli.exec("missing")).rejects.toBe(failure);
    await expect(cli.exec("missing")).rejects.toBe(failure);
    expect(() => cli.use(() => {})).toThrow(failure);
  });

  it("reports start initialization failures through stderr and exitCode", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cli = new CLI();
    cli.use(async () => {
      throw new Error("startup plugin failed");
    });
    await expect(cli.start(["help"])).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith("Error: startup plugin failed\n");
    expect(process.exitCode).toBe(1);
  });
});

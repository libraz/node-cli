import { afterEach, describe, expect, it, vi } from "vitest";
import { createCLI, type PluginContext } from "../src/index.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

describe("plugin system", () => {
  restoreProcessStateAfterEach();
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("registers commands via plugin", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();

    cli.use((ctx) => {
      ctx
        .command("greet <name>")
        .description("Greet someone")
        .action((cmdCtx) => {
          cmdCtx.stdout.write(`Hello, ${cmdCtx.args.name}!\n`);
        });
    });

    await cli.execLine("greet World", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("Hello, World!");
  });

  it("registers events via plugin", async () => {
    const cli = createCLI({ name: "test" });
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

    await cli.execLine("test", { stdout: stream, stderr: stream });
    expect(events).toEqual(["plugin-before"]);
  });

  it("multiple plugins compose", async () => {
    const cli = createCLI({ name: "test" });
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
    await cli.execLine("noop", { stdout: stream, stderr: stream });
    expect(order).toEqual(["plugin1", "plugin2"]);
  });

  it("async plugins are awaited on start", async () => {
    const cli = createCLI({ name: "test" });
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
    const cli = createCLI({ name: "test" });
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
    const run = cli.execLine("help", { stdout: createMockStdout() });
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseFirst();
    await run;
    expect(order).toEqual(["first", "second"]);
  });

  it("runs a synchronous plugin inside use()", () => {
    const cli = createCLI({ name: "test" });
    let ran = false;
    cli.use(() => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("throws a synchronous plugin failure at the use() call site", async () => {
    const cli = createCLI({ name: "test" });
    const failure = new Error("sync plugin failed");
    const stream = createMockStdout();
    const caught: string[] = [];

    expect(() =>
      cli.use((ctx) => {
        ctx.command("early").action((command) => command.stdout.write("early"));
        ctx.fallback((input) => {
          caught.push(input);
        });
        throw failure;
      }),
    ).toThrow(failure);

    // Registrations made before the throw remain, and the instance is not failed.
    expect(() => cli.use(() => {})).not.toThrow();
    await cli.execLine("early", { stdout: stream, stderr: stream });
    await cli.execLine("missing", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("early");
    expect(caught).toEqual(["missing"]);
  });

  it("queues a synchronous plugin behind a pending one and fails initialization", async () => {
    const cli = createCLI({ name: "test" });
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    cli.use(async () => {
      await barrier;
    });

    expect(() =>
      cli.use(() => {
        throw new Error("queued plugin failed");
      }),
    ).not.toThrow();
    release();
    await expect(cli.execLine("help")).rejects.toThrow("queued plugin failed");
  });

  it("chains PluginContext setters", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    const events: string[] = [];
    const removed = () => {
      events.push("removed");
    };
    let returned: PluginContext[] = [];

    cli.use((ctx) => {
      returned = [
        ctx.on("afterExecute", removed),
        ctx.off("afterExecute", removed),
        ctx.fallback((input) => {
          events.push(`fallback:${input}`);
        }),
      ];
      expect(returned).toEqual([ctx, ctx, ctx]);
    });

    await cli.execLine("nothing", { stdout: stream, stderr: stream });
    expect(returned).toHaveLength(3);
    expect(events).toEqual(["fallback:nothing"]);
  });

  it("shares one initialization barrier across concurrent exec calls", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    let release: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    cli.use(async (ctx) => {
      await barrier;
      ctx.command("ready").action((command) => command.stdout.write("ok"));
    });

    const first = cli.execLine("ready", { stdout: stream, stderr: stream });
    const second = cli.execLine("ready", { stdout: stream, stderr: stream });
    release();
    await Promise.all([first, second]);
    expect(stream.getOutput()).toBe("okok");
  });

  it("shares the initialization barrier between start and exec", async () => {
    const cli = createCLI({ name: "test" });
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
    const embedded = cli.execLine("ready");
    release();
    await Promise.all([direct, embedded]);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("drains plugins registered while another plugin is initializing", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    cli.use(async () => {
      await Promise.resolve();
      cli.use(async (ctx) => {
        await Promise.resolve();
        ctx.command("nested").action((command) => command.stdout.write("nested"));
      });
    });
    await cli.execLine("nested", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("nested");
  });

  it("keeps plugin initialization failures sticky", async () => {
    const cli = createCLI({ name: "test" });
    const cause = new Error("plugin failed");
    cli.use(async () => {
      throw cause;
    });
    const first = await cli.execLine("missing").catch((error: unknown) => error);
    expect(first).toBeInstanceOf(Error);
    expect(first).toMatchObject({ code: "ERR_PLUGIN_FAILED", cause });
    await expect(cli.execLine("missing")).rejects.toBe(first);
    expect(() => cli.use(() => {})).toThrow(first as Error);
  });

  it("reports start initialization failures through stderr and exitCode", async () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cli = createCLI({ name: "test" });
    cli.use(async () => {
      throw new Error("startup plugin failed");
    });
    await expect(cli.start(["help"])).resolves.toBe(1);
    expect(write).toHaveBeenCalledWith(
      "Error: Plugin initialization failed: startup plugin failed\n",
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("plugin initialization barrier under concurrency", () => {
  it("runs plugin bodies once for concurrent executions", async () => {
    const cli = createCLI({ name: "test" });
    let initializations = 0;
    cli.use(async (ctx) => {
      initializations++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      ctx.command("ready").action(() => {});
    });

    // Both calls hit the barrier before it resolves, so they must share it.
    await Promise.all([cli.execLine("ready"), cli.execLine("ready")]);
    expect(initializations).toBe(1);
  });

  it("fails every concurrent execution with the same sticky error", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("ready").action(() => {});
    cli.use(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error("plugin exploded");
    });

    const outcomes = await Promise.allSettled([cli.execLine("ready"), cli.execLine("ready")]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
    const [first, second] = outcomes.map((outcome) => (outcome as PromiseRejectedResult).reason);
    expect(first).toMatchObject({ code: "ERR_PLUGIN_FAILED" });
    expect((first as Error).cause).toHaveProperty("message", "plugin exploded");
    expect(second).toBe(first);

    // The failure sticks for a later call rather than degrading into success.
    await expect(cli.execLine("ready")).rejects.toBe(first);
  });

  it("keeps registration order when an earlier plugin awaits", async () => {
    const cli = createCLI({ name: "test" });
    const order: string[] = [];
    cli.use(async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("first");
      ctx.command("a").action(() => {});
    });
    cli.use((ctx) => {
      order.push("second");
      ctx.command("b").action(() => {});
    });

    await Promise.all([cli.execLine("a"), cli.execLine("b")]);
    expect(order).toEqual(["first", "second"]);
  });
});

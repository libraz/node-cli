import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { createMockStdout } from "./helpers.js";

describe("event system", () => {
  function createRouter() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>").action((ctx) => {
      ctx.stdout.write("deployed\n");
    });
    new CommandBuilder(registry, "fail").action(() => {
      throw new Error("boom");
    });
    const router = new CommandRouter(registry);
    return router;
  }

  it("fires beforeExecute and afterExecute", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const order: string[] = [];

    router.on("beforeExecute", () => {
      order.push("before");
    });
    router.on("afterExecute", () => {
      order.push("after");
    });

    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(order).toEqual(["before", "after"]);
  });

  it("fires commandError on failure", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const errors: Error[] = [];

    router.on("commandError", (err) => {
      errors.push(err);
    });

    await expect(router.execute("fail", { stdout: stream, stderr: stream })).rejects.toThrow(
      "boom",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("boom");
  });

  it("does not fire afterExecute on failure", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const called: string[] = [];

    router.on("afterExecute", () => {
      called.push("after");
    });

    await expect(router.execute("fail", { stdout: stream, stderr: stream })).rejects.toThrow();
    expect(called).toEqual([]);
  });

  it("off removes handler", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const calls: number[] = [];

    const handler = () => {
      calls.push(1);
    };
    router.on("beforeExecute", handler);
    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(calls).toEqual([1]);

    router.off("beforeExecute", handler);
    await router.execute("deploy staging", { stdout: stream, stderr: stream });
    expect(calls).toEqual([1]);
  });

  it("multiple handlers fire in order", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const order: number[] = [];

    router.on("beforeExecute", () => {
      order.push(1);
    });
    router.on("beforeExecute", () => {
      order.push(2);
    });

    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(order).toEqual([1, 2]);
  });

  it("async handlers are awaited", async () => {
    const router = createRouter();
    const stream = createMockStdout();
    const order: string[] = [];

    router.on("beforeExecute", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("async-before");
    });
    router.on("afterExecute", () => {
      order.push("after");
    });

    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(order).toEqual(["async-before", "after"]);
  });
});

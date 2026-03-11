import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { createMockStdout } from "./helpers.js";

describe("command validation", () => {
  it("passes validation and executes action", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .validate((ctx) => {
        if (ctx.args.env !== "prod" && ctx.args.env !== "staging") {
          throw new Error("Invalid environment");
        }
      })
      .action((ctx) => {
        ctx.stdout.write(`deployed to ${ctx.args.env}\n`);
      });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("deployed to prod");
  });

  it("rejects on validation failure", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .validate((ctx) => {
        if (ctx.args.env === "dev") {
          throw new Error("dev environment not allowed");
        }
      })
      .action((ctx) => {
        ctx.stdout.write("should not run\n");
      });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await expect(router.execute("deploy dev", { stdout: stream, stderr: stream })).rejects.toThrow(
      "dev environment not allowed",
    );
    expect(stream.getOutput()).not.toContain("should not run");
  });

  it("async validation works", async () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .validate(async (ctx) => {
        await new Promise((r) => setTimeout(r, 5));
        if (ctx.args.env === "broken") {
          throw new Error("broken");
        }
      })
      .action((ctx) => {
        ctx.stdout.write("ok\n");
      });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    await router.execute("deploy prod", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("ok");

    await expect(
      router.execute("deploy broken", { stdout: stream, stderr: stream }),
    ).rejects.toThrow("broken");
  });

  it("validation runs before beforeExecute event", async () => {
    const registry = new CommandRegistry();
    const order: string[] = [];

    new CommandBuilder(registry, "test")
      .validate(() => {
        order.push("validate");
      })
      .action(() => {
        order.push("action");
      });

    const router = new CommandRouter(registry);
    const stream = createMockStdout();

    router.on("beforeExecute", () => {
      order.push("beforeExecute");
    });

    await router.execute("test", { stdout: stream, stderr: stream });
    expect(order).toEqual(["validate", "beforeExecute", "action"]);
  });
});

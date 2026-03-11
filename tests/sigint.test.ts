import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";

describe("custom SIGINT handler", () => {
  it("sets cancel handler on command definition", () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();

    new CommandBuilder(registry, "longrun").cancel(handler).action(() => {});

    const cmd = registry.resolve(["longrun"]);
    expect(cmd).toBeDefined();
    expect(cmd?.cancelHandler).toBe(handler);
  });

  it("cancel handler is accessible after registration", () => {
    const registry = new CommandRegistry();
    const cancelFn = vi.fn();
    const actionFn = vi.fn();

    new CommandBuilder(registry, "task").action(actionFn).cancel(cancelFn);

    const cmd = registry.resolve(["task"]);
    expect(cmd?.cancelHandler).toBe(cancelFn);
    expect(cmd?.action).toBe(actionFn);
  });
});

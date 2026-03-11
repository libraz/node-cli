import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";

describe("command removal", () => {
  it("removes a top-level command", () => {
    const registry = new CommandRegistry();
    const builder = new CommandBuilder(registry, "deploy <env>").action(() => {});

    expect(registry.resolve(["deploy"])).toBeDefined();
    const removed = builder.remove();
    expect(removed).toBe(true);
    expect(registry.resolve(["deploy"])).toBeUndefined();
  });

  it("removes a subcommand", () => {
    const registry = new CommandRegistry();
    const parent = new CommandBuilder(registry, "user").description("User management");
    const child = parent.command("create <name>").action(() => {});

    expect(registry.resolve(["user", "create"])).toBeDefined();
    const removed = child.remove();
    expect(removed).toBe(true);
    expect(registry.resolve(["user", "create"])).toBeUndefined();
    // Parent still exists
    expect(registry.resolve(["user"])).toBeDefined();
  });

  it("returns false for non-existent command", () => {
    const registry = new CommandRegistry();
    const result = registry.unregister(["nonexistent"]);
    expect(result).toBe(false);
  });

  it("removes aliases when command is removed", () => {
    const registry = new CommandRegistry();
    const builder = new CommandBuilder(registry, "deploy <env>").alias("d").action(() => {});

    expect(registry.resolve(["d"])).toBeDefined();
    builder.remove();
    expect(registry.resolve(["d"])).toBeUndefined();
  });

  it("unregister with empty path returns false", () => {
    const registry = new CommandRegistry();
    expect(registry.unregister([])).toBe(false);
  });
});

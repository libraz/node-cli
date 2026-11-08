import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";

describe("command removal", () => {
  it("removes a top-level command", () => {
    const registry = new CommandRegistry();
    const builder = CommandBuilder.create(registry, "deploy <env>").action(() => {});

    expect(registry.resolve(["deploy"])).toBeDefined();
    const removed = builder.remove();
    expect(removed).toBe(true);
    expect(registry.resolve(["deploy"])).toBeUndefined();
  });

  it("removes a subcommand", () => {
    const registry = new CommandRegistry();
    const parent = CommandBuilder.create(registry, "user").description("User management");
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
    const builder = CommandBuilder.create(registry, "deploy <env>")
      .alias("d")
      .action(() => {});

    expect(registry.resolve(["d"])).toBeDefined();
    builder.remove();
    expect(registry.resolve(["d"])).toBeUndefined();
  });

  it("unregister with empty path returns false", () => {
    const registry = new CommandRegistry();
    expect(registry.unregister([])).toBe(false);
  });

  it("does not let a stale builder remove or alias a replacement command", () => {
    const registry = new CommandRegistry();
    const stale = CommandBuilder.create(registry, "temporary");
    expect(stale.remove()).toBe(true);
    const replacement = CommandBuilder.create(registry, "temporary").action(() => {});

    expect(stale.remove()).toBe(false);
    expect(() => stale.alias("old")).toThrow(/detached/);
    expect(registry.resolve(["temporary"])).toBeDefined();
    expect(registry.resolve(["old"])).toBeUndefined();
    expect(replacement.remove()).toBe(true);
  });

  it("does not let a stale builder attach a subcommand to a replacement", () => {
    const registry = new CommandRegistry();
    const stale = CommandBuilder.create(registry, "parent");
    stale.remove();
    CommandBuilder.create(registry, "parent");

    expect(() => stale.command("child")).toThrow(/detached/);
    expect(registry.resolve(["parent", "child"])).toBeUndefined();
  });

  it("rejects every configuration method after removal", () => {
    const registry = new CommandRegistry();
    const builder = CommandBuilder.create(registry, "task");
    builder.remove();

    expect(() => builder.description("x")).toThrow(/detached/);
    expect(() => builder.hidden()).toThrow(/detached/);
    expect(() => builder.option("--flag")).toThrow(/detached/);
    expect(() => builder.action(() => {})).toThrow(/detached/);
    expect(() => builder.completer(() => [])).toThrow(/detached/);
    expect(() => builder.validate(() => {})).toThrow(/detached/);
    expect(() => builder.onCancel(() => {})).toThrow(/detached/);
  });

  it("codes alias registration on a removed definition as ERR_COMMAND_REMOVED", () => {
    const registry = new CommandRegistry();
    const definition = registry.register({
      name: "task",
      argDefs: [],
      options: new Map(),
      subcommands: new Map(),
    });
    registry.unregister(["task"]);

    expect(() => registry.registerAliases(definition, [], ["t"])).toThrow(
      expect.objectContaining({ code: "ERR_COMMAND_REMOVED" }),
    );
  });
});

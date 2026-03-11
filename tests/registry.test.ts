import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../src/command/registry.js";
import type { CommandDefinition } from "../src/types.js";

function makeDef(name: string, opts: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    name,
    argDefs: [],
    options: new Map(),
    subcommands: new Map(),
    ...opts,
  };
}

describe("CommandRegistry", () => {
  it("registers and resolves a top-level command", () => {
    const registry = new CommandRegistry();
    const def = makeDef("deploy");
    registry.register(def);
    expect(registry.resolve(["deploy"])).toBe(def);
  });

  it("returns undefined for unknown command", () => {
    const registry = new CommandRegistry();
    expect(registry.resolve(["unknown"])).toBeUndefined();
  });

  it("returns undefined for empty path", () => {
    const registry = new CommandRegistry();
    expect(registry.resolve([])).toBeUndefined();
  });

  it("registers nested commands", () => {
    const registry = new CommandRegistry();
    const createDef = makeDef("create");
    registry.register(createDef, ["user"]);

    const resolved = registry.resolve(["user", "create"]);
    expect(resolved).toBe(createDef);
  });

  it("auto-creates parent groups", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("set"), ["config"]);

    const config = registry.resolve(["config"]);
    expect(config).toBeDefined();
    expect(config!.name).toBe("config");
    expect(config!.action).toBeUndefined();
  });

  it("merges existing definitions", () => {
    const registry = new CommandRegistry();
    const action = () => {};
    registry.register(makeDef("deploy"));
    registry.register(makeDef("deploy", { action, description: "Deploy app" }));

    const resolved = registry.resolve(["deploy"]);
    expect(resolved!.action).toBe(action);
    expect(resolved!.description).toBe("Deploy app");
  });

  it("matchCommandPath finds longest match", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("create"), ["user"]);
    registry.register(makeDef("delete"), ["user"]);

    const result = registry.matchCommandPath(["user", "create", "foo"]);
    expect(result).toBeDefined();
    expect(result!.command.name).toBe("create");
    expect(result!.consumed).toBe(2);
  });

  it("matchCommandPath returns undefined for no match", () => {
    const registry = new CommandRegistry();
    expect(registry.matchCommandPath(["unknown"])).toBeUndefined();
  });

  it("matchCommandPath returns undefined for empty tokens", () => {
    const registry = new CommandRegistry();
    expect(registry.matchCommandPath([])).toBeUndefined();
  });

  it("allTopLevel returns all root commands", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("deploy"));
    registry.register(makeDef("config"));
    expect(registry.allTopLevel()).toHaveLength(2);
  });

  it("getCommandPath builds full path", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("create"), ["user"]);

    const createCmd = registry.resolve(["user", "create"])!;
    expect(registry.getCommandPath(createCmd)).toEqual(["user", "create"]);
  });

  it("sets parent reference on nested commands", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("create"), ["user"]);

    const createCmd = registry.resolve(["user", "create"])!;
    expect(createCmd.parent).toBeDefined();
    expect(createCmd.parent!.name).toBe("user");
  });
});

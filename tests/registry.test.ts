import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
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
    expect(config?.name).toBe("config");
    expect(config?.action).toBeUndefined();
  });

  it("merges existing definitions", () => {
    const registry = new CommandRegistry();
    const action = () => {};
    registry.register(makeDef("deploy"));
    registry.register(makeDef("deploy", { action, description: "Deploy app" }));

    const resolved = registry.resolve(["deploy"]);
    expect(resolved?.action).toBe(action);
    expect(resolved?.description).toBe("Deploy app");
  });

  it("merges every command behavior and nested definitions on redeclaration", () => {
    const registry = new CommandRegistry();
    const originalChild = makeDef("child", { description: "original child" });
    const target = makeDef("deploy", {
      subcommands: new Map([["child", originalChild]]),
    });
    const action = vi.fn();
    const completer = vi.fn();
    const validate = vi.fn();
    const cancelHandler = vi.fn();
    const replacementChild = makeDef("child", { description: "replacement child" });
    const addedChild = makeDef("status");

    registry.register(target);
    registry.register(
      makeDef("deploy", {
        action,
        completer,
        aliases: ["d"],
        validate,
        cancelHandler,
        argDefs: [{ name: "target", required: true, variadic: false }],
        subcommands: new Map([
          ["child", replacementChild],
          ["status", addedChild],
        ]),
      }),
    );

    const merged = registry.resolve(["deploy"]);
    expect(merged).toMatchObject({ action, completer, aliases: ["d"], validate, cancelHandler });
    expect(merged?.argDefs).toEqual([{ name: "target", required: true, variadic: false }]);
    expect(merged?.subcommands.get("child")).toBe(originalChild);
    expect(originalChild.description).toBe("replacement child");
    expect(merged?.subcommands.get("status")).toBe(addedChild);
    expect(addedChild.parent).toBe(merged);
  });

  it("replaces stale argument definitions with an empty redefinition", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <target>");
    new CommandBuilder(registry, "deploy");

    expect(registry.resolve(["deploy"])?.argDefs).toEqual([]);
  });

  it("allows a command redefinition to replace one of its options", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy").option("--region <region>", {
      choices: ["us"],
    });
    new CommandBuilder(registry, "deploy").option("--region <region>", {
      choices: ["jp"],
    });

    expect(registry.resolve(["deploy"])?.options.get("region")?.schema.choices).toEqual(["jp"]);
  });

  it("matchCommandPath finds longest match", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("create"), ["user"]);
    registry.register(makeDef("delete"), ["user"]);

    const result = registry.matchCommandPath(["user", "create", "foo"]);
    expect(result).toBeDefined();
    expect(result?.command.name).toBe("create");
    expect(result?.consumed).toBe(2);
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

    const createCmd = registry.resolve(["user", "create"]);
    expect(createCmd).toBeDefined();
    if (createCmd) {
      expect(registry.getCommandPath(createCmd)).toEqual(["user", "create"]);
    }
  });

  it("sets parent reference on nested commands", () => {
    const registry = new CommandRegistry();
    registry.register(makeDef("create"), ["user"]);

    const createCmd = registry.resolve(["user", "create"]);
    expect(createCmd).toBeDefined();
    expect(createCmd?.parent).toBeDefined();
    expect(createCmd?.parent?.name).toBe("user");
  });

  it("returns the registered existing definition when a command path is redeclared", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "group sub").action(() => {});
    const action = () => {};

    new CommandBuilder(registry, "group").description("Group command").action(action);

    const group = registry.resolve(["group"]);
    expect(group?.description).toBe("Group command");
    expect(group?.action).toBe(action);
    expect(group?.subcommands.has("sub")).toBe(true);
  });

  it("warns about unreachable subcommands regardless of definition order", () => {
    const actionFirst = new CommandRegistry();
    new CommandBuilder(actionFirst, "task <input>").action(() => {});
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    new CommandBuilder(actionFirst, "task child");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Subcommand "child"'), {
      code: "NODE_CLI_UNREACHABLE_SUBCOMMAND",
    });

    const childFirst = new CommandRegistry();
    new CommandBuilder(childFirst, "task child");
    new CommandBuilder(childFirst, "task <input>").action(() => {});
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Command "task"'), {
      code: "NODE_CLI_UNREACHABLE_SUBCOMMAND",
    });
    warning.mockRestore();
  });

  it("does not delete an independent command whose name matches another command alias", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "foo").alias("bar");
    registry.unregister(["foo"]);
    new CommandBuilder(registry, "bar").action(() => {});

    expect(registry.resolve(["bar"])?.name).toBe("bar");
  });

  it("rejects registering a command that conflicts with an existing alias", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "foo").alias("bar");

    expect(() => new CommandBuilder(registry, "bar")).toThrow(/conflicts with alias/);
  });

  it("rejects an implicit parent group that conflicts with an alias", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "account").alias("user");
    expect(() => new CommandBuilder(registry, "user create")).toThrow(/conflicts with alias/);
  });

  it("removes aliases for every descendant in an unregistered subtree", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "group child leaf").alias("l");
    expect(registry.unregister(["group"])).toBe(true);
    expect(() => new CommandBuilder(registry, "group child l")).not.toThrow();
    expect(registry.resolve(["group", "child", "l"])?.name).toBe("l");
  });
});

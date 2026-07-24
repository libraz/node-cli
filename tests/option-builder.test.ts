import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { resolveOptions } from "../src/option/resolver.js";
import type { CommandContext } from "../src/types.js";

const dummyCtx = {} as CommandContext;

describe("option definition invariants", () => {
  it("rejects collisions across canonical names and aliases", () => {
    const command = new CommandBuilder(new CommandRegistry(), "run").option("-p, --port <n>");
    expect(() => command.option("--p <path>")).toThrow(/already registered/);
    expect(() => command.option("-x, --port-name <name>", { alias: "p" })).toThrow(
      /already registered/,
    );
  });

  it("rejects multi-character short aliases", () => {
    const command = new CommandBuilder(new CommandRegistry(), "run");
    expect(() => command.option("-port, --listen <n>")).toThrow(/exactly one character/);
    expect(() => command.option("--listen <n>", { alias: "port" })).toThrow(
      /exactly one character/,
    );
  });
});

describe("boolean flag default injection", () => {
  it("injects false for an omitted optional boolean flag", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "run").option("--verbose");
    const def = registry.resolve(["run"]);
    if (!def) throw new Error("command not registered");
    const result = resolveOptions({}, def.options, dummyCtx);
    expect(result.verbose).toBe(false);
  });

  it("does not inject a default for a required boolean flag", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "run").option("--verbose", { required: true });
    const def = registry.resolve(["run"]);
    if (!def) throw new Error("command not registered");
    expect(def.options.get("verbose")?.schema.default).toBeUndefined();
  });

  it("rejects an option that is both required and defaulted", () => {
    const registry = new CommandRegistry();
    const command = new CommandBuilder(registry, "deploy");
    expect(() =>
      command.option("--target <target>", {
        type: "string",
        required: true,
        default: "production",
      }),
    ).toThrow(/both required and have a default/);
  });
});

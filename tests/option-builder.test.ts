import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";

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

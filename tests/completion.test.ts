import { beforeEach, describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { ShellCompleter } from "../src/shell/completion.js";

describe("ShellCompleter", () => {
  let registry: CommandRegistry;
  let completer: ShellCompleter;

  beforeEach(() => {
    registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .option("--force", { type: "boolean" })
      .option("--tag <tag>", { type: "string" });
    new CommandBuilder(registry, "destroy <env>");
    new CommandBuilder(registry, "user create <name>");
    new CommandBuilder(registry, "user delete <name>");
    completer = new ShellCompleter(registry);
  });

  it("completes top-level commands from empty", () => {
    const [candidates] = completer.complete("");
    expect(candidates).toContain("deploy");
    expect(candidates).toContain("destroy");
    expect(candidates).toContain("user");
  });

  it("completes partial command names", () => {
    const [candidates, current] = completer.complete("dep");
    expect(candidates).toEqual(["deploy"]);
    expect(current).toBe("dep");
  });

  it("completes subcommands", () => {
    const [candidates] = completer.complete("user ");
    expect(candidates).toContain("create");
    expect(candidates).toContain("delete");
  });

  it("completes partial subcommand", () => {
    const [candidates] = completer.complete("user cr");
    expect(candidates).toEqual(["create"]);
  });

  it("completes option flags", () => {
    const [candidates] = completer.complete("deploy prod --");
    expect(candidates).toContain("--force");
    expect(candidates).toContain("--tag");
  });

  it("completes partial option flags", () => {
    const [candidates] = completer.complete("deploy prod --fo");
    expect(candidates).toEqual(["--force"]);
  });

  it("completes choices for options", () => {
    const registry2 = new CommandRegistry();
    new CommandBuilder(registry2, "deploy <env>").option("--env <env>", {
      choices: ["prod", "stage", "dev"],
    });
    const completer2 = new ShellCompleter(registry2);

    const [candidates] = completer2.complete("deploy foo --env ");
    expect(candidates).toContain("prod");
    expect(candidates).toContain("stage");
    expect(candidates).toContain("dev");
  });

  it("returns empty for no match", () => {
    const [candidates] = completer.complete("xyz");
    expect(candidates).toEqual([]);
  });
});

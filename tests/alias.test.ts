import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { HelpGenerator } from "../src/help/generator.js";
import { ShellCompleter } from "../src/shell/completion.js";

describe("command aliases", () => {
  function createRegistry() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .description("Deploy to environment")
      .alias("d", "dep")
      .action(() => {});
    return registry;
  }

  it("resolves command by alias", () => {
    const registry = createRegistry();
    const cmd = registry.resolve(["d"]);
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("deploy");
  });

  it("resolves command by second alias", () => {
    const registry = createRegistry();
    const cmd = registry.resolve(["dep"]);
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("deploy");
  });

  it("resolves command by canonical name", () => {
    const registry = createRegistry();
    const cmd = registry.resolve(["deploy"]);
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("deploy");
  });

  it("matchCommandPath works with alias", () => {
    const registry = createRegistry();
    const match = registry.matchCommandPath(["d", "prod"]);
    expect(match).toBeDefined();
    expect(match?.command.name).toBe("deploy");
    expect(match?.consumed).toBe(1);
  });

  it("subcommand aliases work", () => {
    const registry = new CommandRegistry();
    const parent = new CommandBuilder(registry, "user").description("User management");
    parent
      .command("create <name>")
      .alias("c", "new")
      .action(() => {});

    const cmd = registry.resolve(["user", "c"]);
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("create");

    const cmd2 = registry.resolve(["user", "new"]);
    expect(cmd2).toBeDefined();
    expect(cmd2?.name).toBe("create");
  });

  it("completion includes aliases", () => {
    const registry = createRegistry();
    const completer = new ShellCompleter(registry);
    const [candidates] = completer.complete("d");
    expect(candidates).toContain("deploy");
    expect(candidates).toContain("d");
    expect(candidates).toContain("dep");
  });

  it("help shows aliases", () => {
    const registry = createRegistry();
    const help = new HelpGenerator(registry);
    const output = help.generateCommand(["deploy"]);
    expect(output).toContain("Aliases:");
    expect(output).toContain("d");
    expect(output).toContain("dep");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { HelpGenerator } from "../src/help/generator.js";

describe("HelpGenerator", () => {
  let registry: CommandRegistry;
  let help: HelpGenerator;

  beforeEach(() => {
    registry = new CommandRegistry();
    help = new HelpGenerator(registry);
  });

  describe("generateIndex", () => {
    it("returns message when no commands", () => {
      expect(help.generateIndex()).toContain("No commands");
    });

    it("lists all top-level commands", () => {
      new CommandBuilder(registry, "deploy <env>").description("Deploy app");
      new CommandBuilder(registry, "config").description("Configuration");

      const output = help.generateIndex();
      expect(output).toContain("deploy <env>");
      expect(output).toContain("Deploy app");
      expect(output).toContain("config");
      expect(output).toContain("Configuration");
      expect(output).toContain("Available commands:");
    });

    it("shows metadata header when provided", () => {
      const helpWithMeta = new HelpGenerator(registry, {
        name: "myapp",
        version: "1.2.3",
        description: "A cool CLI tool",
      });
      new CommandBuilder(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("myapp v1.2.3");
      expect(output).toContain("A cool CLI tool");
      expect(output).toContain("Available commands:");
    });

    it("shows name without version", () => {
      const helpWithMeta = new HelpGenerator(registry, { name: "myapp" });
      new CommandBuilder(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("myapp");
      expect(output).not.toContain("myapp v");
    });

    it("shows description without name", () => {
      const helpWithMeta = new HelpGenerator(registry, { description: "A tool" });
      new CommandBuilder(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("A tool");
    });

    it("does not show header when no metadata", () => {
      new CommandBuilder(registry, "deploy").description("Deploy app");

      const output = help.generateIndex();
      expect(output).toMatch(/^Available commands:/);
    });
  });

  describe("generateCommand", () => {
    it("returns unknown for missing command", () => {
      expect(help.generateCommand(["unknown"])).toContain("Unknown command");
    });

    it("shows usage line", () => {
      new CommandBuilder(registry, "deploy <env>")
        .description("Deploy app")
        .option("--force", { type: "boolean" });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Usage: deploy <env> [options]");
      expect(output).toContain("Deploy app");
    });

    it("shows arguments section", () => {
      new CommandBuilder(registry, "deploy <env> [tag]");
      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Arguments:");
      expect(output).toContain("env");
      expect(output).toContain("(required)");
    });

    it("shows options section", () => {
      new CommandBuilder(registry, "deploy <env>")
        .option("-t, --tag <tag>", { description: "Deploy tag", default: "latest" })
        .option("--force", { type: "boolean", description: "Skip confirm" });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Options:");
      expect(output).toContain("--tag");
      expect(output).toContain("Deploy tag");
      expect(output).toContain('"latest"');
      expect(output).toContain("--force");
    });

    it("hides hidden options", () => {
      new CommandBuilder(registry, "deploy <env>").option("--secret", { hidden: true });

      const output = help.generateCommand(["deploy"]);
      expect(output).not.toContain("--secret");
    });

    it("shows subcommands", () => {
      new CommandBuilder(registry, "user").description("User management");
      new CommandBuilder(registry, "user create <name>").description("Create user");
      new CommandBuilder(registry, "user delete <name>").description("Delete user");

      const output = help.generateCommand(["user"]);
      expect(output).toContain("Commands:");
      expect(output).toContain("create <name>");
      expect(output).toContain("Create user");
    });

    it("shows required option", () => {
      new CommandBuilder(registry, "deploy <env>").option("--token <token>", { required: true });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("(required)");
    });

    it("shows choices", () => {
      new CommandBuilder(registry, "deploy <env>").option("--env <env>", {
        choices: ["prod", "dev"],
      });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("[prod, dev]");
    });
  });
});

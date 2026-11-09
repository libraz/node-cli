import { beforeEach, describe, expect, it } from "vitest";
import { CLI } from "../src/cli.js";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { HelpGenerator } from "../src/help/generator.js";
import { ShellCompleter } from "../src/shell/completion.js";
import { createMockStdout } from "./helpers.js";

describe("HelpGenerator", () => {
  let registry: CommandRegistry;
  let help: HelpGenerator;

  beforeEach(() => {
    registry = new CommandRegistry();
    help = new HelpGenerator(registry);
  });

  describe("shell commands footer", () => {
    it("lists only the shell commands no application command has taken", () => {
      CommandBuilder.create(registry, "exit").description("Leave the app");
      expect(help.generateIndex({ interactive: true })).toContain("Shell commands: quit");
      expect(help.generateIndex({ interactive: true })).not.toContain("exit,");
    });

    it("omits the footer when every shell command is taken, including with no visible commands", () => {
      CommandBuilder.create(registry, "exit").hidden();
      CommandBuilder.create(registry, "quit").hidden();
      expect(help.generateIndex({ interactive: true })).toBe("No commands available.");
      CommandBuilder.create(registry, "deploy");
      expect(help.generateIndex({ interactive: true })).not.toContain("Shell commands");
    });
  });

  describe("negation note", () => {
    it("notes --no-<name> only where parsing it negates the option", () => {
      CommandBuilder.create(registry, "paint")
        .option("--color", { type: "boolean", default: true })
        .option("--no-color", { type: "boolean" })
        .option("--cache", { type: "boolean" })
        .action(() => {});

      const output = help.generateCommand(["paint"]);
      expect(output).toContain("(negate with --no-cache)");
      expect(output).not.toMatch(/--color[^\n]*\(negate with --no-color\)/);
      expect(output.match(/negate with --no-color/g) ?? []).toHaveLength(0);
    });
  });

  describe("generateIndex", () => {
    it("returns message when no commands", () => {
      expect(help.generateIndex()).toContain("No commands");
    });

    it("lists all top-level commands", () => {
      CommandBuilder.create(registry, "deploy <env>").description("Deploy app");
      CommandBuilder.create(registry, "config").description("Configuration");

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
      CommandBuilder.create(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("myapp v1.2.3");
      expect(output).toContain("A cool CLI tool");
      expect(output).toContain("Available commands:");
      expect(output).toContain("-V, --version");
    });

    it("shows name without version", () => {
      const helpWithMeta = new HelpGenerator(registry, { name: "myapp" });
      CommandBuilder.create(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("myapp");
      expect(output).not.toContain("myapp v");
    });

    it("shows description without name", () => {
      const helpWithMeta = new HelpGenerator(registry, { description: "A tool" });
      CommandBuilder.create(registry, "deploy").description("Deploy app");

      const output = helpWithMeta.generateIndex();
      expect(output).toContain("A tool");
    });

    it("does not show header when no metadata", () => {
      CommandBuilder.create(registry, "deploy").description("Deploy app");

      const output = help.generateIndex();
      expect(output).toMatch(/^Available commands:/);
    });

    it("lists application commands before the framework help command", async () => {
      const cli = new CLI({ name: "test" });
      cli.command("deploy").action(() => {});
      const stdout = createMockStdout();

      await cli.execLine("help", { stdout });
      const output = stdout.getOutput();
      expect(output.indexOf("deploy")).toBeLessThan(output.indexOf("help [...command]"));
    });
  });

  describe("generateCommand", () => {
    it("returns unknown for missing command", () => {
      expect(help.generateCommand(["unknown"])).toContain("Unknown command");
    });

    it("shows usage line", () => {
      CommandBuilder.create(registry, "deploy <env>")
        .description("Deploy app")
        .option("--force", { type: "boolean" });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Usage: deploy <env> [options]");
      expect(output).toContain("Deploy app");
    });

    it("shows arguments section", () => {
      CommandBuilder.create(registry, "deploy <env> [tag]");
      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Arguments:");
      expect(output).toContain("env");
      expect(output).toContain("(required)");
    });

    it("shows options section", () => {
      CommandBuilder.create(registry, "deploy <env>")
        .option("-t, --tag <tag>", { description: "Deploy tag", default: "latest" })
        .option("--force", { type: "boolean", description: "Skip confirm" });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("Options:");
      expect(output).toContain("--tag");
      expect(output).toContain("Deploy tag");
      expect(output).toContain('"latest"');
      expect(output).toContain("--force");
    });

    it("renders BigInt and circular defaults without throwing", () => {
      CommandBuilder.create(registry, "inspect").option("--value <value>", { type: "string" });
      const option = registry.resolve(["inspect"])?.options.get("value");
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      if (!option) throw new Error("expected option definition");
      option.schema.default = 1n;
      expect(help.generateCommand(["inspect"])).toContain("default: 1");

      option.schema.default = circular;
      expect(() => help.generateCommand(["inspect"])).not.toThrow();
    });

    it("hides hidden options", () => {
      CommandBuilder.create(registry, "deploy <env>").option("--secret", { hidden: true });

      const output = help.generateCommand(["deploy"]);
      expect(output).not.toContain("--secret");
    });

    it("omits the options section when only hidden options bind both help flags", () => {
      CommandBuilder.create(registry, "deploy")
        .option("-h", { type: "boolean", hidden: true })
        .option("--help", { type: "boolean", hidden: true });

      expect(help.generateCommand(["deploy"])).not.toContain("Options:");
    });

    it("shows subcommands", () => {
      CommandBuilder.create(registry, "user").description("User management");
      CommandBuilder.create(registry, "user create <name>").description("Create user");
      CommandBuilder.create(registry, "user delete <name>").description("Delete user");

      const output = help.generateCommand(["user"]);
      expect(output).toContain("Commands:");
      expect(output).toContain("create <name>");
      expect(output).toContain("Create user");
    });

    it("shows required option", () => {
      CommandBuilder.create(registry, "deploy <env>").option("--token <token>", { required: true });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("(required)");
    });

    it("shows choices", () => {
      CommandBuilder.create(registry, "deploy <env>").option("--env <env>", {
        choices: ["prod", "dev"],
      });

      const output = help.generateCommand(["deploy"]);
      expect(output).toContain("[prod, dev]");
    });
  });
});

describe("built-in help option rendering", () => {
  it("does not duplicate help when a command declares its own help option", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "run")
      .option("--help", { type: "boolean" })
      .action(() => {});
    const help = new HelpGenerator(registry).generateCommand(["run"]);

    expect(help.match(/--help/g)?.length).toBe(1);
  });

  it("includes [options] in usage even when only built-in help is available", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "run").action(() => {});
    const help = new HelpGenerator(registry).generateCommand(["run"]);

    expect(help).toContain("Usage: run [options]");
    expect(help).toContain("Options:");
  });
});

describe("hidden commands", () => {
  it("excludes hidden commands from index, subcommand help, and completion", async () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "visible").action(() => {});
    CommandBuilder.create(registry, "secret")
      .hidden()
      .action(() => {});
    CommandBuilder.create(registry, "admin visible").action(() => {});
    CommandBuilder.create(registry, "admin secret")
      .hidden()
      .action(() => {});
    const help = new HelpGenerator(registry);

    expect(help.generateIndex()).toContain("visible");
    expect(help.generateIndex()).not.toContain("secret");
    expect(help.generateCommand(["admin"])).toContain("visible");
    expect(help.generateCommand(["admin"])).not.toContain("secret");

    const { ShellCompleter } = await import("../src/shell/completion.js");
    const [candidates] = new ShellCompleter(registry).complete("admin ") as [string[], string];
    expect(candidates).toContain("visible");
    expect(candidates).not.toContain("secret");
  });
});

describe("terminal-width help wrapping", () => {
  it("wraps descriptions and preserves the description-column indent", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy")
      .description("Deploys a service with a deliberately long description for narrow terminals")
      .action(() => {});
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 40, configurable: true });
    try {
      const lines = new HelpGenerator(registry).generateIndex().split("\n");
      const first = lines.findIndex((line) => line.includes("Deploys a service"));
      expect(first).toBeGreaterThan(-1);
      expect(lines[first + 1]).toMatch(/^ {12,}\S/);
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        value: originalColumns,
        configurable: true,
      });
    }
  });
});

describe("shell commands", () => {
  it("documents and completes built-in exit commands without shadowing user commands", () => {
    const registry = new CommandRegistry();
    const help = new HelpGenerator(registry);
    expect(help.generateIndex({ interactive: true })).toContain("Shell commands: exit, quit");
    expect(help.generateCommand(["exit"])).toContain("Exit the interactive shell");

    const completer = new ShellCompleter(registry);
    expect((completer.complete("ex") as [string[], string])[0]).toContain("exit");
    CommandBuilder.create(registry, "exit").action(() => {});
    expect((new ShellCompleter(registry).complete("ex") as [string[], string])[0]).toEqual([
      "exit",
    ]);
  });
});

describe("help only shows what dispatch can reach", () => {
  function shadowedRegistry() {
    const registry = new CommandRegistry();
    const task = CommandBuilder.create(registry, "task <name>");
    task
      .command("list")
      .description("List tasks")
      .action(() => {});
    task.action(() => {});
    return registry;
  }

  it("refuses a page for a subcommand the parser would never reach", () => {
    const registry = shadowedRegistry();
    const help = new HelpGenerator(registry, { name: "app" });
    expect(help.generateCommand(["task", "list"])).toContain("Unknown command");
  });

  it("omits the Commands heading when every subcommand is hidden", () => {
    const registry = new CommandRegistry();
    const group = CommandBuilder.create(registry, "admin");
    group
      .command("secret")
      .hidden()
      .action(() => {});
    const help = new HelpGenerator(registry, { name: "app" });

    expect(help.generateCommand(["admin"])).not.toContain("Commands:");
  });

  it("wraps option descriptions the same way it wraps command descriptions", () => {
    const registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy")
      .option("--strategy <name>", {
        description:
          "Choose the rollout strategy used when replacing running instances of the service",
      })
      .action(() => {});
    const help = new HelpGenerator(registry, { name: "app" });

    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 60, configurable: true });
    try {
      const rendered = help.generateCommand(["deploy"]);
      expect(rendered.split("\n").every((line) => line.length <= 60)).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "columns", {
        value: originalColumns,
        configurable: true,
      });
    }
  });
});

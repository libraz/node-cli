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
    const [candidates] = completer.complete("") as [string[], string];
    expect(candidates).toContain("deploy");
    expect(candidates).toContain("destroy");
    expect(candidates).toContain("user");
  });

  it("completes partial command names", () => {
    const [candidates, current] = completer.complete("dep") as [string[], string];
    expect(candidates).toEqual(["deploy"]);
    expect(current).toBe("dep");
  });

  it("completes subcommands", () => {
    const [candidates] = completer.complete("user ") as [string[], string];
    expect(candidates).toContain("create");
    expect(candidates).toContain("delete");
  });

  it("completes partial subcommand", () => {
    const [candidates] = completer.complete("user cr") as [string[], string];
    expect(candidates).toEqual(["create"]);
  });

  it("completes option flags", () => {
    const [candidates] = completer.complete("deploy prod --") as [string[], string];
    expect(candidates).toContain("--force");
    expect(candidates).toContain("--tag");
  });

  it("completes partial option flags", () => {
    const [candidates] = completer.complete("deploy prod --fo") as [string[], string];
    expect(candidates).toEqual(["--force"]);
  });

  it("completes choices for options", () => {
    const registry2 = new CommandRegistry();
    new CommandBuilder(registry2, "deploy <env>").option("--env <env>", {
      choices: ["prod", "stage", "dev"],
    });
    const completer2 = new ShellCompleter(registry2);

    const [candidates] = completer2.complete("deploy foo --env ") as [string[], string];
    expect(candidates).toContain("prod");
    expect(candidates).toContain("stage");
    expect(candidates).toContain("dev");
  });

  it("returns empty for no match", () => {
    const [candidates] = completer.complete("xyz") as [string[], string];
    expect(candidates).toEqual([]);
  });

  describe("option value autocomplete", () => {
    it("completes option values from static autocomplete array", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--region <region>", {
        autocomplete: ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
    });

    it("filters option value candidates by partial input", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--region <region>", {
        autocomplete: ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region us") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("completes option values from function autocomplete", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--region <region>", {
        autocomplete: () => ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
    });

    it("completes option values from async autocomplete", async () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--region <region>", {
        autocomplete: async () => ["us-east-1", "us-west-2"],
      });
      const comp = new ShellCompleter(reg);

      const result = comp.complete("deploy prod --region ");
      expect(result).toBeInstanceOf(Promise);
      const [candidates] = (await result) as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("completes option values using short alias", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("-r, --region <region>", {
        autocomplete: ["us-east-1", "us-west-2"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod -r ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("prefers autocomplete over choices when both present", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--env <env>", {
        choices: ["prod", "staging"],
        autocomplete: ["production", "staging", "development"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy foo --env ") as [string[], string];
      expect(candidates).toEqual(["production", "staging", "development"]);
    });

    it("falls back to choices when no autocomplete is set", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "deploy <env>").option("--env <env>", {
        choices: ["prod", "staging", "dev"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy foo --env st") as [string[], string];
      expect(candidates).toEqual(["staging"]);
    });
  });

  describe("tab iteration", () => {
    it("tracks consecutive tab presses", () => {
      const reg = new CommandRegistry();
      let lastIteration = 0;
      new CommandBuilder(reg, "test")
        .complete((ctx) => {
          lastIteration = ctx.iteration;
          return ["a", "b"];
        })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      comp.complete("test ");
      expect(lastIteration).toBe(1);

      comp.complete("test ");
      expect(lastIteration).toBe(2);

      comp.complete("test ");
      expect(lastIteration).toBe(3);
    });

    it("resets iteration on different input", () => {
      const reg = new CommandRegistry();
      let lastIteration = 0;
      new CommandBuilder(reg, "test")
        .complete((ctx) => {
          lastIteration = ctx.iteration;
          return ["a", "b"];
        })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      comp.complete("test ");
      comp.complete("test ");
      expect(lastIteration).toBe(2);

      comp.complete("test a");
      expect(lastIteration).toBe(1);
    });

    it("allows iteration-based progressive completions", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "color")
        .complete((ctx) => {
          if (ctx.iteration === 1) return ["red", "green", "blue"];
          return ["red", "green", "blue", "cyan", "magenta", "yellow"];
        })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const [first] = comp.complete("color ") as [string[], string];
      expect(first).toEqual(["red", "green", "blue"]);

      const [second] = comp.complete("color ") as [string[], string];
      expect(second).toEqual(["red", "green", "blue", "cyan", "magenta", "yellow"]);
    });
  });

  describe("custom command completer", () => {
    it("calls custom completer when no other completion matches", () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "connect <host>")
        .complete(() => ["localhost", "example.com", "192.168.1.1"])
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("connect ") as [string[], string];
      expect(candidates).toEqual(["localhost", "example.com", "192.168.1.1"]);
    });

    it("handles async custom completers", async () => {
      const reg = new CommandRegistry();
      new CommandBuilder(reg, "connect <host>")
        .complete(async () => ["localhost", "example.com"])
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const result = comp.complete("connect ");
      expect(result).toBeInstanceOf(Promise);
      const [candidates] = (await result) as [string[], string];
      expect(candidates).toEqual(["localhost", "example.com"]);
    });
  });
});

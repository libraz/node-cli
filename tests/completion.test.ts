import { beforeEach, describe, expect, it } from "vitest";
import { CLI } from "../src/cli.js";
import { CommandBuilder } from "../src/command/builder.js";
import { splitPipes, tokenize } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { ShellCompleter } from "../src/shell/completion.js";

function hasControlCharacter(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) as number;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

describe("ShellCompleter", () => {
  let registry: CommandRegistry;
  let completer: ShellCompleter;

  beforeEach(() => {
    registry = new CommandRegistry();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--force", { type: "boolean" })
      .option("--tag <tag>", { type: "string" });
    CommandBuilder.create(registry, "destroy <env>");
    CommandBuilder.create(registry, "user create <name>");
    CommandBuilder.create(registry, "user delete <name>");
    completer = new ShellCompleter(registry);
  });

  it("completes command paths for the built-in help command", () => {
    const cli = new CLI({ name: "test" });
    cli
      .command("user create")
      .alias("new")
      .action(() => {});
    const privateCli = cli as unknown as { registry: CommandRegistry };
    const comp = new ShellCompleter(privateCli.registry);

    expect(comp.complete("help us")).toEqual([["user"], "us"]);
    expect(comp.complete("help user ")).toEqual([["create", "new"], ""]);
  });

  it("completes top-level commands from empty", () => {
    const [candidates] = completer.complete("") as [string[], string];
    expect(candidates).toContain("deploy");
    expect(candidates).toContain("destroy");
    expect(candidates).toContain("user");
  });

  it("does not list commands while the current line has an unclosed quote", () => {
    expect(completer.complete("'")).toEqual([[], "'"]);
    expect(completer.complete("'unterminated")).toEqual([[], "'unterminated"]);
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

  it("does not offer subcommands across an option or double-dash separator", () => {
    const reg = new CommandRegistry();
    const group = CommandBuilder.create(reg, "admin").option("--force", { type: "boolean" });
    group.command("create");
    const comp = new ShellCompleter(reg);

    expect(comp.complete("admin --force cr")[0]).not.toContain("create");
    expect(comp.complete("admin -- cr")[0]).not.toContain("create");
    expect(comp.complete("admin cr")[0]).toContain("create");
  });

  it("completes nested subcommand aliases", () => {
    const reg = new CommandRegistry();
    const user = CommandBuilder.create(reg, "user");
    user
      .command("create <name>")
      .alias("c")
      .action(() => {});
    const comp = new ShellCompleter(reg);

    const [candidates] = comp.complete("user c") as [string[], string];
    expect(candidates).toContain("create");
    expect(candidates).toContain("c");
  });

  it("completes option flags", () => {
    const [candidates] = completer.complete("deploy prod --") as [string[], string];
    expect(candidates).toContain("--force");
    expect(candidates).toContain("--tag");
  });

  it("includes built-in help flags in option completion", () => {
    const [longCandidates] = completer.complete("deploy prod --h") as [string[], string];
    expect(longCandidates).toContain("--help");

    const [shortCandidates] = completer.complete("deploy prod -") as [string[], string];
    expect(shortCandidates).toContain("-h");
  });

  it("includes top-level built-ins and version only when configured", () => {
    const versioned = new ShellCompleter(registry, { hasVersion: true });
    const [candidates] = versioned.complete("") as [string[], string];
    expect(candidates).toEqual(expect.arrayContaining(["--help", "-h", "--version", "-V"]));
  });

  it("includes negated boolean flags", () => {
    const [candidates] = completer.complete("deploy prod --no-") as [string[], string];
    expect(candidates).toContain("--no-force");
    expect(candidates).not.toContain("--no-tag");
  });

  it("does not complete option flags after the double-dash separator", () => {
    const [candidates, current] = completer.complete("deploy prod -- -") as [string[], string];
    expect(candidates).toEqual([]);
    expect(current).toBe("-");
  });

  it("completes partial option flags", () => {
    const [candidates] = completer.complete("deploy prod --fo") as [string[], string];
    expect(candidates).toEqual(["--force"]);
  });

  it("completes choices for options", () => {
    const registry2 = new CommandRegistry();
    CommandBuilder.create(registry2, "deploy <env>").option("--env <env>", {
      choices: ["prod", "stage", "dev"],
    });
    const completer2 = new ShellCompleter(registry2);

    const [candidates] = completer2.complete("deploy foo --env ") as [string[], string];
    expect(candidates).toContain("prod");
    expect(candidates).toContain("stage");
    expect(candidates).toContain("dev");
  });

  it("escapes whitespace in option-value candidates before readline inserts them", () => {
    const registry2 = new CommandRegistry();
    CommandBuilder.create(registry2, "deploy <env>").option("--region <region>", {
      completer: ["New York"],
    });
    const completer2 = new ShellCompleter(registry2);

    expect(completer2.complete("deploy prod --region N")).toEqual([["New\\ York"], "N"]);
  });

  it("returns empty for no match", () => {
    const [candidates] = completer.complete("xyz") as [string[], string];
    expect(candidates).toEqual([]);
  });

  describe("option value completer", () => {
    it("completes option values from static completer array", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--region <region>", {
        completer: ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
    });

    it("filters option value candidates by partial input", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--region <region>", {
        completer: ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region us") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("completes option values from function completer", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--region <region>", {
        completer: () => ["us-east-1", "us-west-2", "eu-west-1"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod --region ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2", "eu-west-1"]);
    });

    it("completes option values from async completer", async () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--region <region>", {
        completer: async () => ["us-east-1", "us-west-2"],
      });
      const comp = new ShellCompleter(reg);

      const result = comp.complete("deploy prod --region ");
      expect(result).toBeInstanceOf(Promise);
      const [candidates] = (await result) as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("isolates sync and async completer failures", async () => {
      const syncRegistry = new CommandRegistry();
      CommandBuilder.create(syncRegistry, "sync").option("--value <value>", {
        completer: () => {
          throw new Error("provider failed");
        },
      });
      expect(new ShellCompleter(syncRegistry).complete("sync --value ")).toEqual([[], ""]);

      const asyncRegistry = new CommandRegistry();
      CommandBuilder.create(asyncRegistry, "async").option("--value <value>", {
        completer: async () => {
          throw new Error("provider failed");
        },
      });
      await expect(new ShellCompleter(asyncRegistry).complete("async --value ")).resolves.toEqual([
        [],
        "",
      ]);
    });

    it("completes option values using short alias", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("-r, --region <region>", {
        completer: ["us-east-1", "us-west-2"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy prod -r ") as [string[], string];
      expect(candidates).toEqual(["us-east-1", "us-west-2"]);
    });

    it("prefers completer over choices when both present", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--env <env>", {
        choices: ["prod", "staging"],
        completer: ["production", "staging", "development"],
      });
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("deploy foo --env ") as [string[], string];
      expect(candidates).toEqual(["production", "staging", "development"]);
    });

    it("falls back to choices when no completer is set", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>").option("--env <env>", {
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
      CommandBuilder.create(reg, "test")
        .completer((ctx) => {
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
      CommandBuilder.create(reg, "test")
        .completer((ctx) => {
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

    it("resets iteration when a new prompt is opened", () => {
      const reg = new CommandRegistry();
      let iteration = 0;
      CommandBuilder.create(reg, "test")
        .completer((ctx) => {
          iteration = ctx.iteration;
          return [];
        })
        .action(() => {});
      const comp = new ShellCompleter(reg);
      comp.complete("test ");
      comp.complete("test ");
      expect(iteration).toBe(2);
      comp.reset();
      comp.complete("test ");
      expect(iteration).toBe(1);
    });

    it("allows iteration-based progressive completions", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "color")
        .completer((ctx) => {
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
    it("filters a static command completer list by the current word", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>")
        .completer(["production", "preview", "staging"])
        .action(() => {});
      const comp = new ShellCompleter(reg);

      expect(comp.complete("deploy pr")).toEqual([["production", "preview"], "pr"]);
      expect(comp.complete("deploy ")).toEqual([["production", "preview", "staging"], ""]);
    });

    it("hands the completer camelCase keys and raw values typed so far", () => {
      const reg = new CommandRegistry();
      let seen: { args: unknown; options: unknown } | undefined;
      CommandBuilder.create(reg, "copy <source-file> <target-dir>")
        .option("--dry-run")
        .option("--max-count <n>", { type: "number" })
        .completer((ctx) => {
          seen = { args: { ...ctx.args }, options: { ...ctx.options } };
          return [];
        })
        .action(() => {});
      new ShellCompleter(reg).complete("copy a --dry-run --max-count 3 ");

      expect(seen).toEqual({ args: { sourceFile: "a" }, options: { dryRun: true, maxCount: "3" } });
    });

    it("calls custom completer when no other completion matches", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "connect <host>")
        .completer(() => ["localhost", "example.com", "192.168.1.1"])
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("connect ") as [string[], string];
      expect(candidates).toEqual(["localhost", "example.com", "192.168.1.1"]);
    });

    it("handles async custom completers", async () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "connect <host>")
        .completer(async () => ["localhost", "example.com"])
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const result = comp.complete("connect ");
      expect(result).toBeInstanceOf(Promise);
      const [candidates] = (await result) as [string[], string];
      expect(candidates).toEqual(["localhost", "example.com"]);
    });

    it("times out a stalled custom completer and aborts its signal", async () => {
      const reg = new CommandRegistry();
      let aborted = false;
      CommandBuilder.create(reg, "connect <host>")
        .completer(({ signal }) => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
          return new Promise<string[]>(() => {});
        })
        .action(() => {});
      const comp = new ShellCompleter(reg, { completionTimeoutMs: 1 });

      await expect(comp.complete("connect ")).resolves.toEqual([[], ""]);
      expect(aborted).toBe(true);
    });

    it("times out a stalled option-value completer on both flag forms", async () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "connect")
        .option("--host <host>", {
          type: "string",
          completer: () => new Promise<string[]>(() => {}),
        })
        .action(() => {});
      const comp = new ShellCompleter(reg, { completionTimeoutMs: 1 });

      await expect(comp.complete("connect --host ")).resolves.toEqual([[], ""]);
      await expect(comp.complete("connect --host=")).resolves.toEqual([[], ""]);
    });

    it("caps a provider handed in by the interactive shell", async () => {
      const comp = new ShellCompleter(new CommandRegistry(), { completionTimeoutMs: 1 });

      await expect(
        comp.runProvider(() => new Promise<[string[], string]>(() => {}), [[], "sel"]),
      ).resolves.toEqual([[], "sel"]);
      expect(
        comp.runProvider(() => {
          throw new Error("provider failed");
        }, [[], "sel"]),
      ).toEqual([[], "sel"]);
    });

    it("tolerates incomplete quotes and isolates custom provider failures", async () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "connect <host>")
        .completer(() => {
          throw new Error("provider failed");
        })
        .action(() => {});
      expect(() => new ShellCompleter(reg).complete('connect "local')).not.toThrow();
      // The reported substring is the raw word readline would replace, quote
      // included — not the tokenizer's unquoted value.
      expect(new ShellCompleter(reg).complete('connect "local')).toEqual([[], '"local']);

      const asyncReg = new CommandRegistry();
      CommandBuilder.create(asyncReg, "connect <host>")
        .completer(async () => {
          throw new Error("provider failed");
        })
        .action(() => {});
      await expect(new ShellCompleter(asyncReg).complete("connect ")).resolves.toEqual([[], ""]);
    });

    it("scopes the custom completer line to the active pipe segment", () => {
      const reg = new CommandRegistry();
      let observedLine = "";
      CommandBuilder.create(reg, "list").action(() => {});
      CommandBuilder.create(reg, "connect <host>")
        .completer((ctx) => {
          observedLine = ctx.line;
          return ["localhost"];
        })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("list | connect ") as [string[], string];
      expect(candidates).toEqual(["localhost"]);
      expect(observedLine).toBe("connect ");
    });

    it("falls through to a group command completer when no subcommand matches", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "tool")
        .completer(() => ["custom-target"])
        .command("known")
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const [candidates] = comp.complete("tool custom") as [string[], string];
      expect(candidates).toEqual(["custom-target"]);
    });
  });

  describe("escaped candidates", () => {
    /** Applies readline's own substitution so the resulting line can be checked. */
    function insert(line: string, candidate: string, completeOn: string): string {
      return line.slice(0, line.length - completeOn.length) + candidate;
    }

    it("reports the raw word being replaced when the typed word is escaped", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "book")
        .option("--city <city>", { completer: ["New York"] })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const line = "book --city New\\ Y";
      const [candidates, completeOn] = comp.complete(line) as [string[], string];
      expect(candidates).toEqual(["New\\ York"]);
      expect(insert(line, candidates[0], completeOn)).toBe("book --city New\\ York");
    });

    it("escapes the pipe separator so the inserted word stays one token", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "filter")
        .option("--expr <expr>", { completer: ["a|b"] })
        .action(() => {});
      const comp = new ShellCompleter(reg);

      const line = "filter --expr a";
      const [candidates, completeOn] = comp.complete(line) as [string[], string];
      expect(candidates).toEqual(["a\\|b"]);
      const inserted = insert(line, candidates[0], completeOn);
      expect(splitPipes(inserted)).toHaveLength(1);
      expect(tokenize(inserted)).toEqual(["filter", "--expr", "a|b"]);
    });
  });
  describe("word boundaries follow the tokenizer", () => {
    function regionCompleter(): ShellCompleter {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "deploy <env>")
        .option("--region <region>", { completer: ["us east", "us west", "eu"] })
        .action(() => {});
      return new ShellCompleter(reg);
    }

    it("does not offer command names past an unknown first word", () => {
      expect(completer.complete("dep foo")).toEqual([[], "foo"]);
      expect(completer.complete("dep ")).toEqual([[], ""]);
      expect(completer.complete("destroy x | dep a")).toEqual([[], "a"]);
    });

    it("keeps whitespace inside an open quote in the current word", () => {
      const comp = regionCompleter();
      expect(comp.complete('deploy x --region "us ')).toEqual([["us\\ east", "us\\ west"], '"us ']);
    });

    it("keeps a backslash-escaped trailing space in the current word", () => {
      const comp = regionCompleter();
      expect(comp.complete("deploy x --region us\\ ")).toEqual([
        ["us\\ east", "us\\ west"],
        "us\\ ",
      ]);
    });

    it("reports the raw word, quote included, on the command-name and flag paths", () => {
      expect(completer.complete('"dep')).toEqual([["deploy"], '"dep']);
      expect(completer.complete('deploy x "--fo')).toEqual([["--force"], '"--fo']);
      expect(completer.complete('user "cr')).toEqual([["create"], '"cr']);
    });

    it("honours escaped quotes inside double quotes when finding the raw word", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "host <name>")
        .completer(() => ["alpha"])
        .action(() => {});
      const comp = new ShellCompleter(reg);
      const [, completeOn] = comp.complete('host "a\\" b') as [string[], string];
      expect(completeOn).toBe('"a\\" b');
    });
  });

  describe("provider results", () => {
    function completerFor(fn: () => unknown): ShellCompleter {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "connect <host>")
        .option("--region <region>", { completer: fn as () => string[] })
        .completer(fn as () => string[])
        .action(() => {});
      return new ShellCompleter(reg);
    }

    it.each([[undefined], [[1, 2]], ["text"], [{ length: 1 }]])(
      "returns a well-formed result when a sync provider returns %j",
      (value) => {
        const comp = completerFor(() => value);
        expect(comp.complete("connect --region ")).toEqual([[], ""]);
        expect(comp.complete("connect ")).toEqual([[], ""]);
        expect(comp.runProvider(() => value as never, [[], "x"])).toEqual([[], "x"]);
      },
    );

    it("never lists or inserts control sequences from any provider path", async () => {
      const hostile = ["ok", "evil\x1b]0;title\x07", "clear\x1b[2J", "tab\there"];
      const comp = completerFor(() => hostile);
      for (const line of ["connect --region ", "connect "]) {
        const [candidates] = comp.complete(line) as [string[], string];
        expect(hasControlCharacter(candidates.join(""))).toBe(false);
        expect(candidates).toContain("ok");
      }
      const single = completerFor(() => ["only\x1b]0;title\x07"]);
      expect(single.complete("connect ")).toEqual([["only"], ""]);
      const [modeCandidates] = (await comp.runProvider(
        () => [hostile, "e"] as [string[], string],
        [[], ""],
      )) as [string[], string];
      expect(hasControlCharacter(modeCandidates.join(""))).toBe(false);
    });
  });

  describe("negation advertisement", () => {
    it("omits --no-<name> when another option owns that spelling", () => {
      const reg = new CommandRegistry();
      CommandBuilder.create(reg, "paint")
        .option("--color", { type: "boolean", default: true })
        .option("--no-color", { type: "boolean" })
        .option("--cache", { type: "boolean" })
        .action(() => {});
      const comp = new ShellCompleter(reg);
      const [candidates] = comp.complete("paint --no-") as [string[], string];
      expect(candidates).toEqual(["--no-color", "--no-no-color", "--no-cache"]);
      expect(candidates.filter((c) => c === "--no-color")).toHaveLength(1);
    });
  });
});

describe("ShellCompleter mode completion", () => {
  it("filters a static list and a function result by the word under the cursor", async () => {
    const completer = new ShellCompleter(new CommandRegistry());
    expect(await completer.runModeProvider(["select", "insert"], "SELECT x ins")).toEqual([
      ["insert"],
      "ins",
    ]);
    expect(await completer.runModeProvider(() => ["select", "insert"], "sel")).toEqual([
      ["select"],
      "sel",
    ]);
  });
});

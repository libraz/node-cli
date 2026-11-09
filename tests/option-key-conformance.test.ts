import { describe, expect, it } from "vitest";
import { parseOptionFlags } from "../src/command/parser.js";
import { createCLI } from "../src/index.js";
import { createMockStdout } from "./helpers.js";
import { optionKeyTable } from "./types/option-key-table.js";

function quiet() {
  const stream = createMockStdout();
  return { stdout: stream, stderr: stream };
}

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("option key conformance", () => {
  it.each(optionKeyTable)("parseOptionFlags($flags) names the option $name", ({ flags, name }) => {
    expect(parseOptionFlags(flags).long).toBe(name);
  });

  it.each(optionKeyTable)("ctx.options is keyed by $key for $flags", async ({ flags, key }) => {
    const cli = createCLI({ name: "test" });
    let seen: string[] = [];
    cli
      .command("run")
      // A default makes the key present whether or not the option takes a value.
      .option(flags, { type: "string", default: "v" })
      .action((ctx) => {
        seen = Object.keys(ctx.options);
      });
    await cli.exec(["run"]);
    expect(seen).toEqual([key]);
  });

  it("keys an independent --no-x option by its camelCase name", async () => {
    const cli = createCLI({ name: "test" });
    let options: Record<string, unknown> = {};
    cli
      .command("run")
      .option("--no-color")
      .action((ctx) => {
        options = { ...ctx.options };
      });
    await cli.exec(["run", "--no-color"]);
    expect(options).toEqual({ noColor: true });
  });

  it("negates a defined boolean with --no-x under the option's own key", async () => {
    const cli = createCLI({ name: "test" });
    let options: Record<string, unknown> = {};
    cli
      .command("run")
      .option("--dry-run", { default: true })
      .action((ctx) => {
        options = { ...ctx.options };
      });
    await cli.exec(["run", "--no-dry-run"]);
    expect(options).toEqual({ dryRun: false });
  });

  it("keys positional arguments by their camelCase name", async () => {
    const cli = createCLI({ name: "test" });
    let args: Record<string, unknown> = {};
    cli.command("copy <source-file> [target-dir] [...extra-files]").action((ctx) => {
      args = { ...ctx.args };
    });
    await cli.exec(["copy", "a", "b", "c", "d"], quiet());
    expect(args).toEqual({ sourceFile: "a", targetDir: "b", extraFiles: ["c", "d"] });
  });

  it("reports a missing camelCase-keyed argument by its declared name", async () => {
    const cli = createCLI({ name: "test" });
    cli.command("copy <source-file>").action(() => {});
    await expect(cli.exec(["copy"], quiet())).rejects.toMatchObject({
      code: "MISSING_ARGUMENT",
      argName: "source-file",
    });
  });

  it("keeps flag spellings in errors and the kebab name in optionName", async () => {
    const cli = createCLI({ name: "test" });
    cli
      .command("run")
      .option("--max-count <n>", { type: "number" })
      .action(() => {});
    const failure = cli.exec(["run", "--max-count", "x"], quiet());
    await expect(failure).rejects.toMatchObject({
      code: "INVALID_OPTION",
      optionName: "max-count",
    });
    await expect(failure).rejects.toThrow("--max-count");
  });

  it("does not hand a parent's options to a child command", async () => {
    const cli = createCLI({ name: "test" });
    let keys: string[] = ["unset"];
    cli
      .command("parent")
      .option("--shared")
      .command("child")
      .action((ctx) => {
        keys = Object.keys(ctx.options);
      });
    await cli.exec(["parent", "child"]);
    expect(keys).toEqual([]);
  });
});

describe("option and argument names", () => {
  it.each([
    "--a--b",
    "--a-",
    "---a",
    "--a_b",
    "--ä",
    "--a.b",
    "-_",
    "--ok, --bad_alias",
    "--ok, -ä",
  ])("rejects the option flags %j", (flags) => {
    const builder = createCLI({ name: "test" }).command("run");
    expect(thrownBy(() => builder.option(flags))).toMatchObject({
      code: "ERR_INVALID_DEFINITION",
    });
  });

  it.each(["run <__proto__>", "run <a_b>", "run <a--b>", "run [a-]", "run <...-a>", "run <ä>"])(
    "rejects the argument names in %j",
    (definition) => {
      const cli = createCLI({ name: "test" });
      expect(thrownBy(() => cli.command(definition))).toMatchObject({
        code: "ERR_INVALID_DEFINITION",
      });
    },
  );

  it("rejects two arguments whose keys collide", () => {
    const cli = createCLI({ name: "test" });
    expect(thrownBy(() => cli.command("run <file-name> <fileName>"))).toMatchObject({
      code: "ERR_INVALID_DEFINITION",
    });
  });

  it.each([
    ["--dry-run", "--dryRun"],
    ["--dryRun", "--dry-run"],
    ["--colour, --dry-run", "--dryRun"],
    ["--dry-run", "--other, --dryRun"],
    ["--x-1", "--x1"],
  ])("rejects %s then %s as a key conflict", (first, second) => {
    const builder = createCLI({ name: "test" }).command("run").option(first);
    expect(thrownBy(() => builder.option(second))).toMatchObject({
      code: "ERR_DEFINITION_CONFLICT",
    });
  });

  it("replaces an option redefined with the same canonical name", async () => {
    const cli = createCLI({ name: "test" });
    let seen: unknown;
    cli
      .command("run")
      .option("--level <l>", { type: "number" })
      .option("--level <l>", { default: "low" })
      .action((ctx) => {
        seen = ctx.options.level;
      });
    await cli.exec(["run", "--level", "7"], quiet());
    expect(seen).toBe("7");
  });

  it("checks the names before the rest of the schema", () => {
    const builder = createCLI({ name: "test" }).command("run");
    const err = thrownBy(() =>
      builder.option("--bad_name <x>", { choices: ["a"], default: "b" }),
    ) as Error;
    expect(err).toMatchObject({ code: "ERR_INVALID_DEFINITION" });
    expect(err.message).toContain("bad_name");
    expect(err.message).not.toContain("choices");
  });
});

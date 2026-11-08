import { describe, expect, it } from "vitest";
import { parseOptionFlags } from "../src/command/parser.js";
import { createCLI } from "../src/index.js";
import { optionKeyTable } from "./types/option-key-table.js";

describe("option key conformance", () => {
  it.each(optionKeyTable)("parseOptionFlags($flags) names the key $key", ({ flags, key }) => {
    expect(parseOptionFlags(flags).long).toBe(key);
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

  it("does not create a negated key for --no-x", async () => {
    const cli = createCLI({ name: "test" });
    let options: Record<string, unknown> = {};
    cli
      .command("run")
      .option("--no-color")
      .action((ctx) => {
        options = { ...ctx.options };
      });
    await cli.exec(["run", "--no-color"]);
    expect(options).toEqual({ "no-color": true });
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

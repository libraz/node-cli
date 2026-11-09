import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCLI, InvalidOptionError } from "../src/index.js";

const newCommand = () => createCLI({ name: "app" }).command("run");

// Calls option() through an untyped handle so invalid arguments are expressible.
const optionOf = (command: ReturnType<typeof newCommand>) =>
  command.option.bind(command) as unknown as (flags: unknown, schema?: unknown) => unknown;

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("CommandBuilder.option() argument checks", () => {
  it("rejects non-string flags with a coded TypeError", () => {
    for (const flags of [undefined, null, 1, {}, ["--x"]]) {
      const err = thrown(() => optionOf(newCommand())(flags));
      expect(err).toBeInstanceOf(TypeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect(err.message).toContain("CommandBuilder.option()");
    }
  });

  it("rejects a schema that is null, an array or a string", () => {
    for (const schema of [null, [], ["a"], "A description", 1, true]) {
      const err = thrown(() => optionOf(newCommand())("--x <v>", schema));
      expect(err).toBeInstanceOf(TypeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect(err.message).toContain("CommandBuilder.option()");
      expect(err.message).toContain('"schema"');
    }
  });

  it("accepts an omitted or undefined schema", () => {
    expect(() => optionOf(newCommand())("--x", undefined)).not.toThrow();
    expect(() => optionOf(newCommand())("--y")).not.toThrow();
  });
});

describe("OptionSchema member checks", () => {
  const cases: Array<[string, unknown, string]> = [
    [
      "type",
      { type: "integer" },
      'has an unknown type "integer"; expected one of: string, number, boolean, string[], number[]',
    ],
    [
      "empty type",
      { type: "" },
      'has an unknown type ""; expected one of: string, number, boolean, string[], number[]',
    ],
    ["description", { description: 1 }, "description must be a string"],
    ["hidden", { hidden: "yes" }, "hidden must be a boolean"],
    ["required", { required: 1 }, "required must be a boolean"],
    ["parse", { parse: "x" }, "parse must be a function"],
    ["validate", { validate: {} }, "validate must be a function"],
    ["completer", { completer: 1 }, "completer must be an array of strings or a function"],
    ["completer items", { completer: [1] }, "completer must be an array of strings or a function"],
    ["choices", { choices: "ab" }, "choices must be an array"],
  ];

  for (const [label, schema, reason] of cases) {
    it(`rejects ${label} with ERR_INVALID_DEFINITION`, () => {
      const err = thrown(() => optionOf(newCommand())("--x <v>", schema));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TypeError);
      expect(err).toHaveProperty("code", "ERR_INVALID_DEFINITION");
      expect(err.message).toContain(`Option "--x" ${reason}`);
    });
  }

  it("reports the first violation in the listed order", () => {
    const err = thrown(() =>
      optionOf(newCommand())("--x <v>", { choices: 1, hidden: 1, type: "nope" }),
    );
    expect(err.message).toContain("unknown type");
    const second = thrown(() => optionOf(newCommand())("--x <v>", { choices: 1, validate: 1 }));
    expect(second.message).toContain("validate must be a function");
  });

  it("checks members before the alias merge", () => {
    const err = thrown(() => optionOf(newCommand())("--x <v>", { alias: "toolong", type: "bad" }));
    expect(err.message).toContain("unknown type");
  });

  it("still accepts valid members", () => {
    expect(() =>
      optionOf(newCommand())("--x <v>", {
        type: "string[]",
        description: "d",
        hidden: false,
        required: false,
        parse: (v: string) => v,
        completer: ["a"],
      }),
    ).not.toThrow();
  });
});

describe("value-less option messages", () => {
  async function failure(argv: string[]): Promise<InvalidOptionError> {
    const cli = createCLI({ name: "app" });
    cli
      .command("run")
      .option("-p, --port <n>")
      .action(() => {});
    try {
      await cli.exec(argv);
    } catch (error) {
      return error as InvalidOptionError;
    }
    throw new Error("expected a rejection");
  }

  it("omits the hint when no token follows", async () => {
    const long = await failure(["run", "--port"]);
    expect(long).toBeInstanceOf(InvalidOptionError);
    expect(long.message).toContain("Option --port expects a value");
    expect(long.message).not.toContain("use --port=<value>");
    const short = await failure(["run", "-p"]);
    expect(short.message).toContain("Option -p expects a value");
    expect(short.message).not.toContain("use --port=<value>");
  });

  it("adds the hint when the next token looks like an option", async () => {
    const long = await failure(["run", "--port", "--other"]);
    expect(long.message).toContain('use --port=<value> for values starting with "-"');
    const short = await failure(["run", "-p", "--other"]);
    expect(short.message).toContain("Option -p expects a value");
    expect(short.message).toContain('use --port=<value> for values starting with "-"');
  });
});

describe("TSDoc phrases", () => {
  const parser = readFileSync(new URL("../src/command/parser.ts", import.meta.url), "utf8");
  const builder = readFileSync(new URL("../src/command/builder.ts", import.meta.url), "utf8");
  const docBefore = (src: string, marker: string): string => {
    const at = src.indexOf(marker);
    return src.slice(src.lastIndexOf("/**", at), at);
  };

  it("documents < and > in tokenize", () => {
    const doc = docBefore(parser, "export function tokenize(");
    expect(doc).toContain("`<`");
    expect(doc).toContain("`>`");
  });

  it("documents option errors and the help flag binding", () => {
    const doc = docBefore(builder, "  option<");
    expect(doc).toContain("ERR_INVALID_DEFINITION");
    expect(doc).toContain("ERR_INVALID_ARG_TYPE");
    expect(doc).toContain("-h");
  });

  it("documents @throws on description and hidden", () => {
    expect(docBefore(builder, "  description(text")).toContain("@throws");
    expect(docBefore(builder, "  hidden(hidden")).toContain("@throws");
  });
});

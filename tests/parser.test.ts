import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { parse, parseDefinitionString, parseOptionFlags, tokenize } from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { InvalidOptionError, UnknownOptionError } from "../src/errors.js";

describe("tokenize", () => {
  it("splits by spaces", () => {
    expect(tokenize("deploy prod")).toEqual(["deploy", "prod"]);
  });

  it("handles double quotes", () => {
    expect(tokenize('deploy "hello world"')).toEqual(["deploy", "hello world"]);
  });

  it("handles single quotes", () => {
    expect(tokenize("deploy 'hello world'")).toEqual(["deploy", "hello world"]);
  });

  it("handles escape characters", () => {
    expect(tokenize("deploy hello\\ world")).toEqual(["deploy", "hello world"]);
  });

  it("handles multiple spaces", () => {
    expect(tokenize("deploy   prod")).toEqual(["deploy", "prod"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles mixed quotes", () => {
    expect(tokenize(`deploy "it's here"`)).toEqual(["deploy", "it's here"]);
  });
});

describe("parseDefinitionString", () => {
  it("parses simple command", () => {
    const result = parseDefinitionString("deploy");
    expect(result.name).toBe("deploy");
    expect(result.parentPath).toEqual([]);
    expect(result.argDefs).toEqual([]);
  });

  it("parses command with required arg", () => {
    const result = parseDefinitionString("deploy <env>");
    expect(result.name).toBe("deploy");
    expect(result.argDefs).toEqual([{ name: "env", required: true, variadic: false }]);
  });

  it("parses command with optional arg", () => {
    const result = parseDefinitionString("deploy [env]");
    expect(result.name).toBe("deploy");
    expect(result.argDefs).toEqual([{ name: "env", required: false, variadic: false }]);
  });

  it("parses command with variadic arg", () => {
    const result = parseDefinitionString("copy <...files>");
    expect(result.argDefs).toEqual([{ name: "files", required: true, variadic: true }]);
  });

  it("parses subcommand path", () => {
    const result = parseDefinitionString("user create <name>");
    expect(result.parentPath).toEqual(["user"]);
    expect(result.name).toBe("create");
    expect(result.argDefs).toEqual([{ name: "name", required: true, variadic: false }]);
  });

  it("parses deep subcommand path", () => {
    const result = parseDefinitionString("config remote set <key> <value>");
    expect(result.parentPath).toEqual(["config", "remote"]);
    expect(result.name).toBe("set");
  });
});

describe("parseOptionFlags", () => {
  it("parses long flag", () => {
    const result = parseOptionFlags("--force");
    expect(result.long).toBe("force");
    expect(result.aliases).toEqual([]);
    expect(result.takesValue).toBe(false);
  });

  it("parses long flag with value", () => {
    const result = parseOptionFlags("--tag <tag>");
    expect(result.long).toBe("tag");
    expect(result.takesValue).toBe(true);
  });

  it("parses short and long alias", () => {
    const result = parseOptionFlags("-t, --tag <tag>");
    expect(result.long).toBe("tag");
    expect(result.aliases).toEqual(["t"]);
    expect(result.takesValue).toBe(true);
  });

  it("parses reverse order alias", () => {
    const result = parseOptionFlags("--verbose, -v");
    expect(result.long).toBe("verbose");
    expect(result.aliases).toEqual(["v"]);
  });
});

describe("parse", () => {
  function createRegistry() {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "deploy <env>")
      .option("--force", { type: "boolean" })
      .option("-t, --tag <tag>", { type: "string" })
      .option("-p, --port <port>", { type: "number" })
      .option("-l, --label <label>", { type: "string[]" });

    new CommandBuilder(registry, "user create <name>");
    new CommandBuilder(registry, "user delete <name>");
    return registry;
  }

  it("parses command with args and options", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --force --tag v2", registry);
    expect(result.commandPath).toEqual(["deploy"]);
    expect(result.args).toEqual({ env: "prod" });
    expect(result.options.force).toBe(true);
    expect(result.options.tag).toBe("v2");
  });

  it("parses subcommand", () => {
    const registry = createRegistry();
    const result = parse("user create foo", registry);
    expect(result.commandPath).toEqual(["user", "create"]);
    expect(result.args).toEqual({ name: "foo" });
  });

  it("parses --no-flag", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --no-force", registry);
    expect(result.options.force).toBe(false);
  });

  it("parses = style options", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --tag=v3", registry);
    expect(result.options.tag).toBe("v3");
  });

  it("accumulates array options with = style", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --label=a --label=b -l=c", registry);
    expect(result.options.label).toEqual(["a", "b", "c"]);
  });

  it("parses short alias", () => {
    const registry = createRegistry();
    const result = parse("deploy prod -t v2", registry);
    // Short alias -t is stored under the raw alias key;
    // alias resolution happens in OptionResolver, not in the parser.
    expect(result.options.tag ?? result.options.t).toBe("v2");
  });

  it("parses -- double dash", () => {
    const registry = createRegistry();
    const result = parse("deploy prod -- --not-an-option", registry);
    expect(result.args.env).toBe("prod");
  });

  it("returns empty for empty input", () => {
    const registry = createRegistry();
    const result = parse("", registry);
    expect(result.commandPath).toEqual([]);
  });

  it("parses argv array", () => {
    const registry = createRegistry();
    const result = parse(["deploy", "prod", "--force"], registry);
    expect(result.commandPath).toEqual(["deploy"]);
    expect(result.args.env).toBe("prod");
    expect(result.options.force).toBe(true);
  });

  it("throws on unknown long options", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --unknown", registry)).toThrow(UnknownOptionError);
    expect(() => parse("deploy prod --unknown=value", registry)).toThrow(UnknownOptionError);
  });

  it("throws on unknown short options", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod -x", registry)).toThrow(UnknownOptionError);
  });

  it("throws when a value option is missing its value", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --tag", registry)).toThrow(InvalidOptionError);
    expect(() => parse("deploy prod -t", registry)).toThrow(InvalidOptionError);
  });

  it("does not consume the next known option as a missing value", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --tag --force", registry)).toThrow(InvalidOptionError);
  });

  it("does not consume the next unknown option as a string value", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --tag --unknown", registry)).toThrow(InvalidOptionError);
  });

  it("accepts negative numeric option values", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --port -1", registry);
    expect(result.options.port).toBe("-1");
  });

  it("accepts dash-prefixed string option values with equals syntax", () => {
    const registry = createRegistry();
    const result = parse("deploy prod --tag=-beta", registry);
    expect(result.options.tag).toBe("-beta");
  });

  it("rejects negation for non-boolean options", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --no-tag", registry)).toThrow(InvalidOptionError);
  });

  it("tracks extra positional args", () => {
    const registry = createRegistry();
    const result = parse("deploy prod extra", registry);
    expect(result.extraArgs).toEqual(["extra"]);
  });
});

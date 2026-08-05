import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import {
  parse,
  parseDefinitionString,
  parseOptionFlags,
  splitPipes,
  tokenize,
} from "../src/command/parser.js";
import { CommandRegistry } from "../src/command/registry.js";
import { InvalidOptionError, ParseError, UnknownOptionError } from "../src/errors.js";

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

  it("treats all unquoted whitespace as delimiters", () => {
    expect(tokenize("deploy\tprod\n--force")).toEqual(["deploy", "prod", "--force"]);
  });

  it("preserves empty quoted tokens", () => {
    expect(tokenize(`echo "" '' tail`)).toEqual(["echo", "", "", "tail"]);
  });

  it("returns empty array for empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("handles mixed quotes", () => {
    expect(tokenize(`deploy "it's here"`)).toEqual(["deploy", "it's here"]);
  });

  it("preserves backslashes inside single quotes", () => {
    expect(tokenize(String.raw`copy 'C:\temp\new'`)).toEqual(["copy", String.raw`C:\temp\new`]);
  });

  it("preserves non-special backslashes inside double quotes", () => {
    expect(tokenize(String.raw`copy "C:\temp\new"`)).toEqual(["copy", String.raw`C:\temp\new`]);
  });

  it("throws on unclosed quotes", () => {
    expect(() => tokenize("echo 'hello")).toThrow(ParseError);
    try {
      tokenize("echo 'hello");
    } catch (error) {
      expect(error).toMatchObject({ code: "PARSE_ERROR", quote: "single" });
    }
  });
});

describe("splitPipes", () => {
  it("throws on trailing and empty pipe segments", () => {
    expect(() => splitPipes("echo hi |")).toThrow(/trailing pipe/);
    expect(() => splitPipes("echo hi || grep hi")).toThrow(/empty pipe/);
  });

  it("does not mistake a final escaped character for a trailing pipe", () => {
    const input = ["echo", "\\"].join(" ");
    expect(splitPipes(input)).toEqual([input]);
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

  it("uses the first short alias as the key for short-only options", () => {
    const result = parseOptionFlags("-p <port>");
    expect(result.long).toBe("p");
    expect(result.aliases).toEqual(["p"]);
    expect(result.takesValue).toBe(true);
  });

  it("keeps placeholders with commas intact and recognizes square brackets", () => {
    expect(parseOptionFlags("--range <start,end>")).toMatchObject({
      long: "range",
      takesValue: true,
      valueName: "start,end",
    });
    expect(parseOptionFlags("--port [port]")).toMatchObject({
      long: "port",
      takesValue: true,
      valueName: "port",
    });
  });

  it("keeps an additional long flag as an alias", () => {
    expect(parseOptionFlags("--verbose, --loud")).toMatchObject({
      long: "loud",
      longAliases: ["verbose"],
    });
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
    expect(result.options).toMatchObject({ tag: "v2" });
    expect(result.options).not.toHaveProperty("t");
  });

  it("parses short-only options under their short key", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "serve").option("-p <port>", { type: "number" });

    const result = parse("serve -p 3000", registry);
    expect(result.options.p).toBe("3000");
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
    expect(result.rawArgv).toEqual(["deploy", "prod", "--force"]);
  });

  it("stores reserved property names without changing record prototypes", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "set <__proto__>")
      .option("--constructor <value>", { required: true })
      .action(() => {});
    const result = parse("set safe --constructor value", registry);
    expect(Object.getPrototypeOf(result.args)).toBeNull();
    expect(Object.getPrototypeOf(result.options)).toBeNull();
    expect(Reflect.get(result.args, "__proto__")).toBe("safe");
    expect(result.options.constructor).toBe("value");
  });

  it("distinguishes implicit help from a command-defined help option", () => {
    const registry = new CommandRegistry();
    new CommandBuilder(registry, "custom").option("--help", { type: "boolean" }).action(() => {});
    expect(parse("custom --help", registry)).toMatchObject({ builtInHelp: false });
    new CommandBuilder(registry, "implicit").action(() => {});
    expect(parse("implicit --help", registry)).toMatchObject({ builtInHelp: true });
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
    expect(() => parse("deploy prod --tag --unknown", registry)).toThrow(/--tag=<value>/);
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

  it("reports a value supplied to a negated boolean as invalid syntax", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod --no-force=false", registry)).toThrow(InvalidOptionError);
  });

  it("tracks extra positional args", () => {
    const registry = createRegistry();
    const result = parse("deploy prod extra", registry);
    expect(result.extraArgs).toEqual(["extra"]);
  });

  it("rejects unsupported redirection operators", () => {
    const registry = createRegistry();
    expect(() => parse("deploy prod > output.txt", registry)).toThrow(ParseError);
    expect(() => parse("deploy < input.txt", registry)).toThrow(ParseError);
  });
});

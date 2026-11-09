import { describe, expect, it, vi } from "vitest";
import { createCLI, tokenize } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function expectTypeError(fn: () => unknown): void {
  const error = thrownBy(fn);
  expect(error).toBeInstanceOf(TypeError);
  expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
}

function expectDefinitionError(fn: () => unknown): void {
  const error = thrownBy(fn);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(TypeError);
  expect(error).not.toBeInstanceOf(RangeError);
  expect(error).toHaveProperty("code", "ERR_INVALID_DEFINITION");
}

describe("createCLI arguments", () => {
  it.each([undefined, null, "tool", 5])("rejects options %s", (options) => {
    expectTypeError(() => createCLI(options as never));
  });

  it("names the option and the function in Node's form", () => {
    const error = thrownBy(() => createCLI({ name: 5 as never }));
    expect(error).toHaveProperty(
      "message",
      'The "name" option of createCLI() must be a string. Received type number (5)',
    );
  });

  it.each(["", "my/tool", "a b", "-x"])("rejects name %j with ERR_INVALID_ARG_VALUE", (name) => {
    const error = thrownBy(() => createCLI({ name }));
    expect(error).toBeInstanceOf(RangeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
  });
});

describe("event listeners", () => {
  it.each(["on", "off"] as const)(
    "%s rejects an unknown event name, listing the names",
    (method) => {
      const cli = createCLI({ name: "test" });
      const error = thrownBy(() => cli[method]("bogus" as never, () => {}));
      expect(error).toBeInstanceOf(RangeError);
      expect(error).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
      expect((error as Error).message).toContain(
        "beforeExecute, afterExecute, commandError, error, exit",
      );
    },
  );

  it.each(["on", "off"] as const)("%s rejects a non-string event name", (method) => {
    const cli = createCLI({ name: "test" });
    expectTypeError(() => cli[method](42 as never, () => {}));
  });

  it.each(["on", "off"] as const)("%s rejects a non-function handler", (method) => {
    const cli = createCLI({ name: "test" });
    expectTypeError(() => cli[method]("exit", "x" as never));
  });

  it("validates a plugin's listeners the same way", () => {
    const cli = createCLI({ name: "test" });
    let unknown: unknown;
    let notFunction: unknown;
    cli.use((ctx) => {
      unknown = thrownBy(() => ctx.on("Exit" as never, () => {}));
      notFunction = thrownBy(() => ctx.off("exit", null as never));
    });
    expect(unknown).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
    expect(notFunction).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });
});

describe("CLI setters", () => {
  it.each([42, null, "x"])("fallback rejects %s", (handler) => {
    expectTypeError(() => createCLI({ name: "test" }).fallback(handler as never));
  });

  it.each([null, {}, "plugin"])("use rejects %s", (plugin) => {
    expectTypeError(() => createCLI({ name: "test" }).use(plugin as never));
  });

  it.each([5, null, undefined])("command rejects a definition of %s", (definition) => {
    expectTypeError(() => createCLI({ name: "test" }).command(definition as never));
  });
});

describe("builder setters", () => {
  const builder = () => createCLI({ name: "test" }).command("deploy");

  it.each([
    ["description", 5],
    ["hidden", "no"],
    ["action", "x"],
    ["validate", 1],
    ["onCancel", {}],
    ["completer", "a"],
    ["completer", ["a", 1]],
    ["alias", 7],
  ] as const)("%s rejects %j", (method, value) => {
    const target = builder() as unknown as Record<string, (value: unknown) => unknown>;
    expectTypeError(() => target[method](value));
  });

  it("command rejects a non-string definition", () => {
    expectTypeError(() => builder().command(null as never));
  });

  it("accepts a static completion list and a provider", () => {
    expect(() =>
      builder()
        .completer(["a", "b"])
        .completer(() => []),
    ).not.toThrow();
  });
});

describe("command names", () => {
  it.each(["a'b", "a|b", "--foo", "a_b", "ä", "a--b", "a-"])(
    "rejects the command name %j",
    (name) => {
      expectDefinitionError(() => createCLI({ name: "test" }).command(name));
    },
  );

  it("rejects a parent path word outside the rule", () => {
    expectDefinitionError(() => createCLI({ name: "test" }).command("a'b list"));
  });

  it.each(["x y", "--z", "", "a_b"])("rejects the alias %j", (alias) => {
    expectDefinitionError(() => createCLI({ name: "test" }).command("deploy").alias(alias));
  });

  it("accepts names inside the rule", () => {
    const cli = createCLI({ name: "test" });
    expect(() => cli.command("a").alias("b", "remote-add2")).not.toThrow();
    expect(() => cli.command("db migrate-up <target-env>")).not.toThrow();
  });
});

describe("tokenize", () => {
  it.each([123, null, undefined, ["a"]])("rejects %s", (input) => {
    expectTypeError(() => tokenize(input as never));
  });

  it("leaves a pipe to execLine", () => {
    expect(tokenize("echo a 'b|c' | upper")).toEqual(["echo", "a", "b|c", "|", "upper"]);
  });
});

describe("exec options", () => {
  const cli = () => {
    const instance = createCLI({ name: "test" });
    instance.command("run").action(() => {});
    return instance;
  };

  it.each([
    ["stdout", "nope"],
    ["stdout", {}],
    ["stderr", 1],
    ["stdin", "input"],
    ["signal", {}],
  ])("rejects %s %j before anything runs", async (key, value) => {
    const action = vi.fn();
    const instance = createCLI({ name: "test" });
    instance.command("run").action(action);
    await expect(instance.exec(["run"], { [key]: value } as never)).rejects.toMatchObject({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
    });
    await expect(instance.execLine("run", { [key]: value } as never)).rejects.toMatchObject({
      code: "ERR_INVALID_ARG_TYPE",
    });
    expect(action).not.toHaveBeenCalled();
  });

  it.each([null, "x", 5])("rejects an options argument of %s", async (options) => {
    await expect(cli().exec(["run"], options as never)).rejects.toBeInstanceOf(TypeError);
  });

  it("accepts null stdin and omitted members", async () => {
    await expect(
      cli().exec(["run"], { stdin: null, stdout: createMockStdout(), signal: undefined }),
    ).resolves.toBeUndefined();
  });
});

describe("plugin initialization failure", () => {
  it.each([
    ["a string", "nope"],
    ["an object", { code: 42 }],
    ["an Error", new Error("boom")],
  ])("wraps %s once, with the original as cause", async (_label, cause) => {
    const cli = createCLI({ name: "test" });
    const errors: Error[] = [];
    cli.on("error", (error) => {
      errors.push(error);
    });
    cli.use(async () => {
      throw cause;
    });
    const first = await cli.exec(["x"]).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(Error);
    expect(first).toMatchObject({ code: "ERR_PLUGIN_FAILED", cause });
    expect((first as Error).message).toMatch(/^Plugin initialization failed: /);
    await expect(cli.execLine("x")).rejects.toBe(first);
    expect(() => cli.use(() => {})).toThrow(first as Error);
    expect(errors).toEqual([first]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { CLI, createCLI } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

describe("exec (argv only)", () => {
  it("runs an argv array without tokenizing or splitting pipes", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    cli.command("echo <message>").action((ctx) => {
      ctx.stdout.write(`${ctx.args.message}\n`);
    });
    await cli.exec(["echo", "a b | c"], { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("a b | c\n");
  });

  it("resolves an empty argv without doing anything", async () => {
    const cli = createCLI({ name: "test" });
    await expect(cli.exec([])).resolves.toBeUndefined();
  });

  it("rejects a string with ERR_INVALID_ARG_TYPE", async () => {
    const cli = createCLI({ name: "test" });
    const action = vi.fn();
    cli.command("say").action(action);
    const error = await cli.exec("say" as never).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    expect(action).not.toHaveBeenCalled();
  });
});

describe("execLine", () => {
  it("tokenizes and honours quotes", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    cli.command("echo <message>").action((ctx) => {
      ctx.stdout.write(`${ctx.args.message}\n`);
    });
    await cli.execLine('echo "a b"', { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toBe("a b\n");
  });

  it("splits at pipes", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    cli.command("produce").action((ctx) => {
      ctx.stdout.write("data\n");
    });
    cli.command("consume").action(async (ctx) => {
      let text = "";
      for await (const chunk of ctx.stdin ?? []) text += String(chunk);
      ctx.stdout.write(`got:${text}`);
    });
    await cli.execLine("produce | consume", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("got:data");
  });

  it("resolves an empty line without doing anything", async () => {
    const cli = createCLI({ name: "test" });
    await expect(cli.execLine("")).resolves.toBeUndefined();
  });

  it.each([
    ["an array", ["say"]],
    ["a number", 42],
    ["undefined", undefined],
  ])("rejects %s with ERR_INVALID_ARG_TYPE", async (_label, input) => {
    const cli = createCLI({ name: "test" });
    const error = await cli.execLine(input as never).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
  });
});

describe("name", () => {
  it.each([undefined, null, 42, {}])("rejects the non-string name %s", (name) => {
    expect(() => createCLI({ name } as never)).toThrow(TypeError);
    try {
      createCLI({ name } as never);
    } catch (error) {
      expect(error).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    }
  });

  it("rejects a missing options argument", () => {
    expect(() => (createCLI as () => CLI)()).toThrow(TypeError);
    expect(() => new (CLI as unknown as new () => CLI)()).toThrow(TypeError);
  });

  it.each(["", "my/tool", "a b", "-x", ".x", "a\nb", "tool\\x", "日本"])(
    "rejects the name %j with ERR_INVALID_ARG_VALUE",
    (name) => {
      expect(() => createCLI({ name })).toThrow(RangeError);
      try {
        createCLI({ name });
      } catch (error) {
        expect(error).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
      }
    },
  );

  it.each(["a", "app", "my-tool", "my_tool", "tool.v2", "7zip", "A.b-c_d"])(
    "accepts the name %j",
    (name) => {
      expect(() => createCLI({ name })).not.toThrow();
    },
  );
});

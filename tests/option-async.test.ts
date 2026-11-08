import { describe, expect, it } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { createCLI, ValidationError } from "../src/index.js";
import { ShellCompleter } from "../src/shell/completion.js";
import { createMockStdout } from "./helpers.js";

function quiet() {
  const stream = createMockStdout();
  return { stdout: stream, stderr: stream };
}

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return undefined;
}

describe("async option callbacks", () => {
  it("awaits an async parse before the action runs", async () => {
    const cli = createCLI({ name: "test" });
    let seen: unknown;
    cli
      .command("serve")
      .option("--port <port>", { parse: async (value) => Number(value) * 2 })
      .action((ctx) => {
        seen = ctx.options.port;
      });

    await cli.execLine("serve --port 21", quiet());
    expect(seen).toBe(42);
  });

  it("awaits an async parse for each element of an array option", async () => {
    const cli = createCLI({ name: "test" });
    let seen: unknown;
    cli
      .command("tag")
      .option("--name <name>", {
        type: "string[]",
        parse: async (value) => value.toUpperCase(),
      })
      .action((ctx) => {
        seen = ctx.options.name;
      });

    await cli.exec(["tag", "--name", "a", "--name", "b"], quiet());
    expect(seen).toEqual(["A", "B"]);
  });

  it("reports a rejected async parse as a ValidationError", async () => {
    const cli = createCLI({ name: "test" });
    cli
      .command("serve")
      .option("--port <port>", {
        parse: async () => {
          throw new Error("not a port");
        },
      })
      .action(() => {});

    const failure = cli.execLine("serve --port x", quiet());
    await expect(failure).rejects.toBeInstanceOf(ValidationError);
    await expect(failure).rejects.toMatchObject({ code: "VALIDATION_FAILED", optionName: "port" });
  });

  it("awaits an async option validate and stops on rejection", async () => {
    const cli = createCLI({ name: "test" });
    let ran = false;
    cli
      .command("serve")
      .option("--host <host>", {
        validate: async (value) => {
          await Promise.resolve();
          if (value === "bad") throw new Error("unreachable host");
        },
      })
      .action(() => {
        ran = true;
      });

    const failure = cli.execLine("serve --host bad", quiet());
    await expect(failure).rejects.toMatchObject({ code: "VALIDATION_FAILED", optionName: "host" });
    expect(ran).toBe(false);

    await cli.execLine("serve --host good", quiet());
    expect(ran).toBe(true);
  });

  it("awaits an async command validate", async () => {
    const cli = createCLI({ name: "test" });
    let ran = false;
    cli
      .command("deploy <env>")
      .validate(async (ctx) => {
        await Promise.resolve();
        if (ctx.args.env === "prod") throw new ValidationError("prod is locked");
      })
      .action(() => {
        ran = true;
      });

    await expect(cli.execLine("deploy prod", quiet())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(ran).toBe(false);
  });
});

describe("onCancel", () => {
  it("routes an async rejection to the error event without awaiting it", async () => {
    const cli = createCLI({ name: "test" });
    const errors: Error[] = [];
    cli.on("error", (error) => {
      errors.push(error);
    });
    const controller = new AbortController();
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cleanupFailure = new Error("cleanup failed");
    cli
      .command("wait")
      .onCancel(async () => {
        throw cleanupFailure;
      })
      .action(
        (ctx) =>
          new Promise<void>((resolve) => {
            started();
            ctx.signal.addEventListener("abort", () => resolve());
          }),
      );

    const execution = cli.execLine("wait", { ...quiet(), signal: controller.signal });
    await running;
    controller.abort();
    await execution;
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors).toContain(cleanupFailure);
  });
});

describe("definition errors", () => {
  it.each([
    ["-p, --port <number>", {}, "string"],
    ["-p, --port <number>", { type: "string" as const }, "string"],
    ["--retry <boolean>", {}, "string"],
    ["--retry <boolean>", { type: "number" as const }, "number"],
    ["--retry [boolean]", { type: "string" as const }, "string"],
  ])("rejects %s with %j as an invalid definition", (flags, schema, type) => {
    const thrown = codeOf(() => createCLI({ name: "test" }).command("serve").option(flags, schema));
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(TypeError);
    expect(thrown).not.toBeInstanceOf(RangeError);
    expect(thrown).toMatchObject({ code: "ERR_INVALID_DEFINITION" });
    expect((thrown as Error).message).toContain(`its type is ${type}`);
  });

  it("names the option and the placeholder in the conflict message", () => {
    expect(() =>
      createCLI({ name: "test" }).command("serve").option("-p, --port <number>"),
    ).toThrow(
      'Option "--port" uses the <number> placeholder but its type is string; set type: "number" or rename the placeholder',
    );
  });

  it.each([
    ["-p, --port <number>", { type: "number" as const }],
    ["--ids <number>", { type: "number[]" as const }],
    ["--retry <boolean>", { type: "boolean" as const }],
    ["--count <n>", {}],
  ])("accepts %s with %j", (flags, schema) => {
    expect(() => createCLI({ name: "test" }).command("serve").option(flags, schema)).not.toThrow();
  });

  it("codes an invalid option definition", () => {
    const builder = createCLI({ name: "test" }).command("serve");
    for (const define of [
      () => builder.option("--port <n>", { required: true, default: 1 }),
      () => builder.option("--level <l>", { type: "number", default: "x" }),
      () => builder.option("--flag", { type: "boolean", default: null }),
      () => builder.option("--env <e>", { choices: ["a"], default: "b" }),
      () => builder.option("<value>"),
      () => builder.option("--bad_name"),
      () => builder.option("--ok", { alias: "bad alias" }),
      () => builder.option("--ok", { alias: "-xy" }),
    ]) {
      expect(codeOf(define)).toMatchObject({ code: "ERR_INVALID_DEFINITION" });
    }
  });

  it("codes a duplicate option name as a definition conflict", () => {
    const builder = createCLI({ name: "test" }).command("serve").option("-p, --port <n>");
    expect(codeOf(() => builder.option("-p, --path <p>"))).toMatchObject({
      code: "ERR_DEFINITION_CONFLICT",
    });
  });

  it("codes an invalid command definition string", () => {
    const cli = createCLI({ name: "test" });
    for (const definition of [
      "",
      "run <a> extra",
      "run <a> <a>",
      "run [a] <b>",
      "run <...a> <b>",
      "run <a",
      "run <>",
    ]) {
      expect(codeOf(() => cli.command(definition))).toMatchObject({
        code: "ERR_INVALID_DEFINITION",
      });
    }
  });

  it("codes a command alias collision as a definition conflict", () => {
    const cli = createCLI({ name: "test" });
    cli.command("deploy").alias("d");
    cli.command("status");
    for (const define of [
      () => cli.command("d"),
      () => cli.command("status").alias("deploy"),
      () => cli.command("status").alias("d"),
    ]) {
      expect(codeOf(define)).toMatchObject({ code: "ERR_DEFINITION_CONFLICT" });
    }
  });

  it("codes configuring a removed command", () => {
    const builder = createCLI({ name: "test" }).command("task");
    expect(builder.remove()).toBe(true);
    expect(codeOf(() => builder.description("x"))).toMatchObject({
      code: "ERR_COMMAND_REMOVED",
    });
  });
});

describe("completers", () => {
  it("passes a completion context to an option completer", () => {
    const registry = new CommandRegistry();
    const contexts: { current: string; commandPath: readonly string[]; iteration: number }[] = [];
    CommandBuilder.create(registry, "deploy <env>")
      .option("--region <region>", {
        completer: (ctx) => {
          contexts.push({
            current: ctx.current,
            commandPath: ctx.commandPath,
            iteration: ctx.iteration,
          });
          return ["us-east-1", "us-west-2", "eu-west-1"];
        },
      })
      .action(() => {});

    expect(new ShellCompleter(registry).complete("deploy prod --region us")).toEqual([
      ["us-east-1", "us-west-2"],
      "us",
    ]);
    expect(contexts).toEqual([{ current: "us", commandPath: ["deploy"], iteration: 1 }]);
  });

  it("aborts a stalled option completer at the deadline", async () => {
    const registry = new CommandRegistry();
    let signal: AbortSignal | undefined;
    CommandBuilder.create(registry, "connect").option("--host <host>", {
      completer: (ctx) => {
        signal = ctx.signal;
        return new Promise<readonly string[]>(() => {});
      },
    });

    const completer = new ShellCompleter(registry, { completionTimeoutMs: 1 });
    await expect(completer.complete("connect --host ")).resolves.toEqual([[], ""]);
    expect(signal?.aborted).toBe(true);
  });

  it("gives a mode completer the current word, the Tab count and a deadline signal", async () => {
    const completer = new ShellCompleter(new CommandRegistry(), { completionTimeoutMs: 5 });
    const seen: { line: string; current: string; iteration: number }[] = [];
    const record = (ctx: { line: string; current: string; iteration: number }) => {
      seen.push({ line: ctx.line, current: ctx.current, iteration: ctx.iteration });
    };

    const result = await completer.runModeProvider((ctx) => {
      record(ctx);
      expect(ctx.fullLine).toBe(ctx.line);
      expect(ctx.commandPath).toEqual([]);
      expect(Object.keys(ctx.args)).toEqual([]);
      expect(Object.keys(ctx.options)).toEqual([]);
      expect(ctx.signal.aborted).toBe(false);
      return ["select", "set"];
    }, "show se");
    expect(result).toEqual([["select", "set"], "se"]);

    await completer.runModeProvider((ctx) => {
      record(ctx);
      return [];
    }, "show se");
    await completer.runModeProvider(async (ctx) => {
      record(ctx);
      return [];
    }, "show ");
    expect(seen).toEqual([
      { line: "show se", current: "se", iteration: 1 },
      { line: "show se", current: "se", iteration: 2 },
      { line: "show ", current: "", iteration: 1 },
    ]);

    let signal: AbortSignal | undefined;
    const stalled = await completer.runModeProvider((ctx) => {
      signal = ctx.signal;
      return new Promise<readonly string[]>(() => {});
    }, "slow");
    expect(stalled).toEqual([[], "slow"]);
    expect(signal?.aborted).toBe(true);
  });

  it("shares the Tab count between command and mode completion", async () => {
    const completer = new ShellCompleter(new CommandRegistry());
    completer.complete("x");
    let iteration = 0;
    await completer.runModeProvider((ctx) => {
      iteration = ctx.iteration;
      return [];
    }, "x");
    expect(iteration).toBe(2);
    completer.reset();
    await completer.runModeProvider((ctx) => {
      iteration = ctx.iteration;
      return [];
    }, "x");
    expect(iteration).toBe(1);
  });

  it("falls back to no candidates when a mode completer throws or rejects", async () => {
    const completer = new ShellCompleter(new CommandRegistry());
    await expect(
      completer.runModeProvider(() => {
        throw new Error("boom");
      }, "ab"),
    ).resolves.toEqual([[], "ab"]);
    await expect(
      completer.runModeProvider(async () => {
        throw new Error("boom");
      }, "ab"),
    ).resolves.toEqual([[], "ab"]);
  });
});

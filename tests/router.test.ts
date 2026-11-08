import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { CommandNotFoundError, ExtraArgumentError, MissingArgumentError } from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import { progress, restoreCursor } from "../src/output/progress.js";
import type { Shell } from "../src/shell/repl.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

function setup() {
  const registry = new CommandRegistry();
  const router = new CommandRouter(registry);
  const helpGenerator = new HelpGenerator(registry);
  router.setHelpGenerator(helpGenerator);
  return { registry, router };
}

describe("CommandRouter", () => {
  it("executes a command action", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "deploy <env>").action(action);

    const stdout = createMockStdout();
    await router.execute("deploy prod", { stdout });

    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.env).toBe("prod");
  });

  it("executes async actions", async () => {
    const { registry, router } = setup();
    const result: string[] = [];
    CommandBuilder.create(registry, "deploy <env>").action(async (ctx) => {
      result.push(ctx.args.env as string);
    });

    await router.execute("deploy prod");
    expect(result).toEqual(["prod"]);
  });

  it("throws CommandNotFoundError for unknown command", async () => {
    const { router } = setup();

    await expect(router.execute("unknown")).rejects.toThrow(CommandNotFoundError);
  });

  it("throws MissingArgumentError for missing required arg", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>").action(() => {});

    await expect(router.execute("deploy")).rejects.toThrow(MissingArgumentError);
  });

  it("throws ExtraArgumentError for unexpected positional args", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "deploy <env>").action(action);

    await expect(router.execute("deploy prod extra")).rejects.toThrow(ExtraArgumentError);
    expect(action).not.toHaveBeenCalled();
  });

  it("does not classify an unrelated AbortError as a user cancellation", async () => {
    const { registry, router } = setup();
    const onError = vi.fn();
    router.on("error", onError);
    CommandBuilder.create(registry, "abort").action(() => {
      throw Object.assign(new Error("internal abort"), { name: "AbortError" });
    });

    await expect(router.execute("abort")).rejects.toThrow("internal abort");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("normalizes a non-Error action throw for both events and callers", async () => {
    const { registry, router } = setup();
    const onError = vi.fn();
    const onCommandError = vi.fn();
    router.on("error", onError);
    router.on("commandError", onCommandError);
    CommandBuilder.create(registry, "broken").action(() => {
      throw "failure";
    });

    await expect(router.execute("broken")).rejects.toThrow("failure");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onCommandError).toHaveBeenCalledWith(expect.any(Error), expect.anything());
  });

  it("shows help for group commands without action", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "user create <name>").action(() => {});

    const stdout = createMockStdout();
    await router.execute("user", { stdout });

    expect(stdout.getOutput()).toContain("Commands:");
  });

  it("shows help when --help is passed", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "deploy <env>")
      .description("Deploy app")
      .action(() => {});

    const stdout = createMockStdout();
    await router.execute("deploy --help", { stdout });

    expect(stdout.getOutput()).toContain("Deploy app");
  });

  it("passes a command-defined boolean --help option to the action", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "custom").option("--help", { type: "boolean" }).action(action);
    await router.execute("custom --help");
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].options.help).toBe(true);
  });

  it("reports an unknown child instead of showing successful group help", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "user create").action(() => {});
    await expect(router.execute("user typo")).rejects.toMatchObject({
      code: "COMMAND_NOT_FOUND",
      input: "user typo",
      available: ["create"],
    });
  });

  it("resolves options with defaults", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "deploy <env>")
      .option("--tag <tag>", { type: "string", default: "latest" })
      .action(action);

    await router.execute("deploy prod");
    expect(action.mock.calls[0][0].options.tag).toBe("latest");
  });

  it("does nothing for empty input", async () => {
    const { router } = setup();
    await expect(router.execute("")).resolves.toBeUndefined();
  });

  it("passes shell instance to context", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    CommandBuilder.create(registry, "test").action(action);

    const mockShell = {} as unknown as Shell;
    await router.execute("test", { shell: mockShell });
    expect(action.mock.calls[0][0].shell).toBe(mockShell);
  });

  it("aborts every active command before isolating cancel handler failures", async () => {
    const { registry, router } = setup();
    const aborted: string[] = [];
    const cancelled: string[] = [];

    for (const name of ["first", "second"]) {
      CommandBuilder.create(registry, name)
        .onCancel(() => {
          cancelled.push(name);
          if (name === "first") throw new Error("broken cleanup");
        })
        .action(
          (ctx) =>
            new Promise<void>((resolve) => {
              ctx.signal.addEventListener(
                "abort",
                () => {
                  aborted.push(name);
                  resolve();
                },
                { once: true },
              );
            }),
        );
    }

    const runs = [router.execute("first"), router.execute("second")];
    await Promise.resolve();
    expect(router.triggerCancel()).toBe(true);
    await Promise.all(runs);
    expect(aborted.sort()).toEqual(["first", "second"]);
    expect(cancelled.sort()).toEqual(["first", "second"]);
  });

  it("makes validation and lifecycle hooks cancellable", async () => {
    const { registry, router } = setup();
    let validationAborted = false;
    CommandBuilder.create(registry, "validate-cancel")
      .validate(
        (ctx) =>
          new Promise<void>((resolve) => {
            ctx.signal.addEventListener(
              "abort",
              () => {
                validationAborted = true;
                resolve();
              },
              { once: true },
            );
          }),
      )
      .action(() => {});

    const run = router.execute("validate-cancel");
    await Promise.resolve();
    expect(router.triggerCancel()).toBe(true);
    await run;
    expect(validationAborted).toBe(true);
  });

  it("invokes each cancel handler at most once during cooperative cleanup", async () => {
    const { registry, router } = setup();
    const cancel = vi.fn();
    let finish: (() => void) | undefined;
    CommandBuilder.create(registry, "slow")
      .onCancel(cancel)
      .action(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );

    const run = router.execute("slow");
    await Promise.resolve();
    expect(router.triggerCancel()).toBe(true);
    expect(router.triggerCancel()).toBe(false);
    finish?.();
    await run;
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("router diagnostics", () => {
  it("lists only visible subcommands when a child is not found", async () => {
    const { registry, router } = setup();
    CommandBuilder.create(registry, "grp pub").action(() => {});
    CommandBuilder.create(registry, "grp secret")
      .hidden()
      .action(() => {});

    const error = await router.execute("grp bogus").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(CommandNotFoundError);
    expect((error as CommandNotFoundError).available).toEqual(["pub"]);
    expect((error as CommandNotFoundError).message).not.toContain("secret");
  });

  it("writes an error-listener failure around a live frame, without control sequences", async () => {
    const { registry, router } = setup();
    const stderr = createMockTTY();
    CommandBuilder.create(registry, "work").action(() => {
      progress.spinner({ label: "working", stream: stderr }).start();
      throw new Error("work failed");
    });
    router.on("error", () => {
      throw new Error("listener \x1b]2;spoofed\x07broke");
    });
    try {
      const before = stderr.getOutput().length;
      await expect(router.execute("work", { stderr })).rejects.toThrow("work failed");
      const written = stderr.getOutput().slice(before);
      const report = written.indexOf("Error in error handler: listener broke\n");
      expect(report).toBeGreaterThan(-1);
      // The frame row is erased before the report is written.
      expect(written.slice(written.lastIndexOf("working", report), report)).toContain("\x1b[K");
      expect(written).not.toContain("\x1b]2;");
    } finally {
      restoreCursor();
    }
  });

  it("writes the interrupt hint on its own row and redraws the frame below it", async () => {
    const { registry, router } = setup();
    const stderr = createMockTTY();
    let started: () => void = () => {};
    const ready = new Promise<void>((resolveReady) => {
      started = resolveReady;
    });
    CommandBuilder.create(registry, "work").action(
      (ctx) =>
        new Promise<void>((resolveAction) => {
          const spinner = progress.spinner({ label: "working", stream: ctx.stderr });
          spinner.start();
          // Cleanup takes a moment, so the hint is written while the frame is live.
          ctx.signal.addEventListener("abort", () => {
            setTimeout(() => {
              spinner.stop();
              resolveAction();
            }, 10);
          });
          started();
        }),
    );
    try {
      const running = router.runWithSigintCancel(() => router.execute("work", { stderr }), {
        stderr,
      });
      await ready;
      const before = stderr.getOutput().length;
      const write = vi.spyOn(stderr, "write");
      process.emit("SIGINT");
      const hintWrite = write.mock.calls
        .map(([chunk]) => String(chunk))
        .find((chunk) => chunk.includes("Press Ctrl-C again"));
      write.mockRestore();
      await running;
      expect(hintWrite?.startsWith("\r\x1b[K")).toBe(true);
      const written = stderr.getOutput().slice(before);
      const hintEnd = written.indexOf("force quit.\n") + "force quit.\n".length;
      expect(hintEnd).toBeGreaterThan("force quit.\n".length);
      expect(written.slice(hintEnd)).toContain("working");
    } finally {
      restoreCursor();
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { CommandNotFoundError, ExtraArgumentError, MissingArgumentError } from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
import type { Shell } from "../src/shell/repl.js";
import { createMockStdout } from "./helpers.js";

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
    new CommandBuilder(registry, "deploy <env>").action(action);

    const stdout = createMockStdout();
    await router.execute("deploy prod", { stdout });

    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.env).toBe("prod");
  });

  it("executes async actions", async () => {
    const { registry, router } = setup();
    const result: string[] = [];
    new CommandBuilder(registry, "deploy <env>").action(async (ctx) => {
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
    new CommandBuilder(registry, "deploy <env>").action(() => {});

    await expect(router.execute("deploy")).rejects.toThrow(MissingArgumentError);
  });

  it("throws ExtraArgumentError for unexpected positional args", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    new CommandBuilder(registry, "deploy <env>").action(action);

    await expect(router.execute("deploy prod extra")).rejects.toThrow(ExtraArgumentError);
    expect(action).not.toHaveBeenCalled();
  });

  it("does not classify an unrelated AbortError as a user cancellation", async () => {
    const { registry, router } = setup();
    const onError = vi.fn();
    router.on("error", onError);
    new CommandBuilder(registry, "abort").action(() => {
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
    new CommandBuilder(registry, "broken").action(() => {
      throw "failure";
    });

    await expect(router.execute("broken")).rejects.toThrow("failure");
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onCommandError).toHaveBeenCalledWith(expect.any(Error), expect.anything());
  });

  it("shows help for group commands without action", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "user create <name>").action(() => {});

    const stdout = createMockStdout();
    await router.execute("user", { stdout });

    expect(stdout.getOutput()).toContain("Commands:");
  });

  it("shows help when --help is passed", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "deploy <env>").description("Deploy app").action(() => {});

    const stdout = createMockStdout();
    await router.execute("deploy --help", { stdout });

    expect(stdout.getOutput()).toContain("Deploy app");
  });

  it("passes a command-defined boolean --help option to the action", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    new CommandBuilder(registry, "custom").option("--help", { type: "boolean" }).action(action);
    await router.execute("custom --help");
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].options.help).toBe(true);
  });

  it("reports an unknown child instead of showing successful group help", async () => {
    const { registry, router } = setup();
    new CommandBuilder(registry, "user create").action(() => {});
    await expect(router.execute("user typo")).rejects.toMatchObject({
      code: "COMMAND_NOT_FOUND",
      input: "user typo",
      available: ["create"],
    });
  });

  it("resolves options with defaults", async () => {
    const { registry, router } = setup();
    const action = vi.fn();
    new CommandBuilder(registry, "deploy <env>")
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
    new CommandBuilder(registry, "test").action(action);

    const mockShell = {} as unknown as Shell;
    await router.execute("test", { shell: mockShell });
    expect(action.mock.calls[0][0].shell).toBe(mockShell);
  });

  it("aborts every active command before isolating cancel handler failures", async () => {
    const { registry, router } = setup();
    const aborted: string[] = [];
    const cancelled: string[] = [];

    for (const name of ["first", "second"]) {
      new CommandBuilder(registry, name)
        .cancel(() => {
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
    new CommandBuilder(registry, "validate-cancel")
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
    new CommandBuilder(registry, "slow").cancel(cancel).action(
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

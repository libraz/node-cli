import { describe, expect, it, vi } from "vitest";
import { CommandBuilder } from "../src/command/builder.js";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { CommandNotFoundError, MissingArgumentError } from "../src/errors.js";
import { HelpGenerator } from "../src/help/generator.js";
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

    const mockShell = {} as any;
    await router.execute("test", { shell: mockShell });
    expect(action.mock.calls[0][0].shell).toBe(mockShell);
  });
});

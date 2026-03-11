import { describe, expect, it, vi } from "vitest";
import { CLI } from "../src/cli.js";
import { createCLI } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

describe("CLI (integration)", () => {
  it("creates CLI via factory function", () => {
    const cli = createCLI({ name: "test" });
    expect(cli).toBeInstanceOf(CLI);
  });

  it("executes direct CLI mode", async () => {
    const cli = createCLI();
    const action = vi.fn();
    cli.command("greet <name>").action(action);

    // Redirect stderr to avoid error output
    const _stderr = createMockStdout();
    const _origStderr = process.stderr.write;

    await cli.start(["greet", "world"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.name).toBe("world");
  });

  it("handles command not found in direct mode", async () => {
    const cli = createCLI();
    const stderr = createMockStdout();
    const origWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["nonexistent"]);

    process.stderr.write = origWrite;
    expect(process.exitCode).toBe(1);
    expect(stderr.getOutput()).toContain("Command not found");

    // Reset exit code
    process.exitCode = 0;
  });

  it("built-in help command works", async () => {
    const cli = createCLI();
    cli.command("deploy <env>").description("Deploy app");

    const stdout = createMockStdout();
    const origWrite = process.stdout.write;
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help"]);

    process.stdout.write = origWrite;
    expect(stdout.getOutput()).toContain("deploy <env>");
    expect(stdout.getOutput()).toContain("Deploy app");
  });

  it("built-in help for specific command", async () => {
    const cli = createCLI();
    cli
      .command("deploy <env>")
      .description("Deploy to environment")
      .option("--force", { type: "boolean", description: "Skip confirmation" });

    const stdout = createMockStdout();
    const origWrite = process.stdout.write;
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;

    await cli.start(["help", "deploy"]);

    process.stdout.write = origWrite;
    expect(stdout.getOutput()).toContain("Deploy to environment");
    expect(stdout.getOutput()).toContain("--force");
  });

  it("subcommands work end-to-end", async () => {
    const cli = createCLI();
    const action = vi.fn();
    cli
      .command("user create <name>")
      .description("Create user")
      .option("--role <role>", { default: "user" })
      .action(action);

    await cli.start(["user", "create", "alice", "--role", "admin"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.name).toBe("alice");
    expect(action.mock.calls[0][0].options.role).toBe("admin");
  });

  it("nested command builder style works", async () => {
    const cli = createCLI();
    const action = vi.fn();
    const user = cli.command("config").description("Config management");
    user.command("set <key> <value>").action(action);

    await cli.start(["config", "set", "theme", "dark"]);
    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0][0].args.key).toBe("theme");
    expect(action.mock.calls[0][0].args.value).toBe("dark");
  });

  it("option validation works", async () => {
    const cli = createCLI();
    cli
      .command("login")
      .option("--token <token>", {
        required: true,
        validate(value) {
          if (typeof value === "string" && value.length < 5) {
            throw new Error("Token too short");
          }
        },
      })
      .action(() => {});

    const stderr = createMockStdout();
    const origWrite = process.stderr.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;

    await cli.start(["login", "--token", "abc"]);

    process.stderr.write = origWrite;
    expect(stderr.getOutput()).toContain("Token too short");

    // Reset exit code
    process.exitCode = 0;
  });

  it("prompt and history methods are chainable", () => {
    const cli = createCLI({ name: "test" });
    const result = cli.prompt("$ ").history("/tmp/test_history");
    expect(result).toBe(cli);
  });
});

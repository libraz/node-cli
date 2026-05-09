import { describe, expect, it } from "vitest";
import { CLI, ExtraArgumentError, UnknownOptionError } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

describe("programmatic exec", () => {
  it("executes a command programmatically", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    cli.command("echo <message>").action((ctx) => {
      ctx.stdout.write(`${ctx.args.message}\n`);
    });

    await cli.exec("echo hello", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("hello");
  });

  it("executes multiple commands in sequence", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    cli.command("count <n>").action((ctx) => {
      ctx.stdout.write(`count=${ctx.args.n}\n`);
    });

    await cli.exec("count 1", { stdout: stream, stderr: stream });
    await cli.exec("count 2", { stdout: stream, stderr: stream });
    expect(stream.getOutput()).toContain("count=1");
    expect(stream.getOutput()).toContain("count=2");
  });

  it("throws on unknown command", async () => {
    const cli = new CLI();
    const stream = createMockStdout();

    await expect(cli.exec("nonexistent", { stdout: stream, stderr: stream })).rejects.toThrow(
      "Command not found",
    );
  });

  it("throws exported errors for invalid user input", async () => {
    const cli = new CLI();
    cli
      .command("deploy <env>")
      .option("--force")
      .action(() => {});

    await expect(cli.exec("deploy prod --unknown")).rejects.toThrow(UnknownOptionError);
    await expect(cli.exec("deploy prod extra")).rejects.toThrow(ExtraArgumentError);
  });

  it("events fire during exec", async () => {
    const cli = new CLI();
    const stream = createMockStdout();
    const events: string[] = [];

    cli.on("beforeExecute", () => {
      events.push("before");
    });
    cli.on("afterExecute", () => {
      events.push("after");
    });

    cli.command("ping").action((ctx) => {
      ctx.stdout.write("pong\n");
    });

    await cli.exec("ping", { stdout: stream, stderr: stream });
    expect(events).toEqual(["before", "after"]);
  });
});

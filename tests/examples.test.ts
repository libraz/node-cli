import { describe, expect, it } from "vitest";
import { createCLI } from "../src/index.js";
import { createMockStdout } from "./helpers.js";

describe("documented example patterns", () => {
  it("uses hyphenated long option names exactly as parsed", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();

    cli
      .command("deploy <env>")
      .option("--dry-run", { type: "boolean" })
      .action((ctx) => {
        ctx.stdout.write(ctx.options["dry-run"] ? "dry\n" : "real\n");
      });

    await cli.execLine("deploy staging --dry-run", { stdout: stream, stderr: stream });

    expect(stream.getOutput()).toBe("dry\n");
  });

  it("supports advanced example patterns for parse, hidden, negation, and removal", async () => {
    const cli = createCLI({ name: "test" });
    const stream = createMockStdout();
    const removed = cli.command("removed").action((ctx) => {
      ctx.stdout.write("removed\n");
    });

    cli
      .command("config")
      .option("--date <date>", {
        type: "string",
        parse(value) {
          return new Date(`${value}T00:00:00.000Z`);
        },
      })
      .option("--cache", { type: "boolean", default: true })
      .option("--secret <token>", { type: "string", hidden: true })
      .action((ctx) => {
        const date = ctx.options.date as Date;
        ctx.stdout.write(`${date.toISOString().slice(0, 10)}:${ctx.options.cache}\n`);
      });

    removed.remove();

    await cli.execLine("config --date 2026-05-09 --no-cache --secret token", {
      stdout: stream,
      stderr: stream,
    });

    expect(stream.getOutput()).toBe("2026-05-09:false\n");
    await expect(cli.execLine("removed", { stdout: stream, stderr: stream })).rejects.toThrow(
      "Command not found",
    );
  });
});

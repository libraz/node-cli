/**
 * Example: Advanced API Catalog
 *
 * Demonstrates APIs that are intentionally more specialized than the
 * scenario-focused examples: custom parsing, hidden options, negated
 * booleans, completion providers, advanced table options, custom progress
 * formats, logger level changes, command removal, custom banner, and history.
 *
 * Usage:
 *   npx tsx examples/10-advanced-api.ts config --date 2026-05-09 --no-cache
 *   npx tsx examples/10-advanced-api.ts table
 *   npx tsx examples/10-advanced-api.ts progress
 *   npx tsx examples/10-advanced-api.ts logs
 *   npx tsx examples/10-advanced-api.ts completion-info
 */
import { c, color, createCLI, logger, progress, table } from "../src/index.js";

const cli = createCLI({
  name: "advanced",
  version: "1.0.0",
  prompt: "advanced> ",
  description: "Advanced API catalog",
})
  .banner(c`{bold.cyan Advanced API Demo} {dim v1.0.0}`)
  .history(`/tmp/node-cli-advanced-${process.pid}.history`);

cli
  .command("config")
  .description("Show parsing, hidden options, and negated booleans")
  .option("--date <date>", {
    type: "string",
    description: "Date to parse",
    parse(value) {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Invalid date: ${value}`);
      }
      return parsed;
    },
  })
  .option("--cache", {
    type: "boolean",
    default: true,
    description: "Use local cache; pass --no-cache to disable",
  })
  .option("--secret <token>", {
    type: "string",
    hidden: true,
  })
  .action((ctx) => {
    const date = ctx.options.date as Date | undefined;
    ctx.stdout.write(c`{bold Config}\n`);
    ctx.stdout.write(`  date:  ${date ? date.toISOString().slice(0, 10) : "(none)"}\n`);
    ctx.stdout.write(`  cache: ${ctx.options.cache ? "enabled" : "disabled"}\n`);
    ctx.stdout.write(`  secret supplied: ${ctx.options.secret ? "yes" : "no"}\n`);
  });

cli
  .command("table")
  .description("Show advanced table layout options")
  .action((ctx) => {
    const rows = [
      {
        service: "api",
        owner: "platform",
        description: "Handles public REST and webhook traffic",
        latency: "42ms",
      },
      {
        service: "worker",
        owner: "jobs",
        description: "Processes long-running asynchronous tasks",
        latency: "118ms",
      },
    ];

    ctx.stdout.write(
      table(rows, {
        border: "double",
        columns: ["service", "owner", "description", "latency"],
        headerLabels: {
          service: "Service",
          owner: "Owner",
          description: "Description",
          latency: "p95",
        },
        colWidths: [12, 12, 28, 10],
        maxWidth: { Description: 28 },
        align: { p95: "right" },
        truncate: "..",
        style: {
          head: "cyan.bold",
          border: "dim",
          compact: false,
        },
      }),
    );
    ctx.stdout.write("\n");
  });

cli
  .command("progress")
  .description("Show custom progress formatting and stop behavior")
  .action((ctx) => {
    const custom = progress.bar({
      total: 3,
      stream: ctx.stdout,
      format(state) {
        return `custom ${state.current}/${state.total} (${state.percent}%)`;
      },
    });
    custom.update(1);
    custom.stop();

    const multi = progress.multi();
    const first = multi.add({
      total: 2,
      label: "first",
      color: "green",
      stream: ctx.stdout,
      format(state) {
        return `first ${state.current}/${state.total}`;
      },
    });
    const second = multi.add({ total: 2, label: "second", color: "yellow", stream: ctx.stdout });
    first.tick();
    second.update(2);
    multi.stop();
  });

cli
  .command("logs")
  .description("Show runtime logger level changes")
  .action((ctx) => {
    const log = logger({ level: "info", prefix: "advanced", stream: ctx.stdout });
    log.debug("hidden debug");
    log.info("visible info");
    log.setLevel("debug");
    log.debug("visible debug");
    log.setLevel("silent");
    log.error("hidden error");
    ctx.stdout.write("logger demo complete\n");
  });

cli
  .command("completion-info [current]")
  .description("Register command and option completion providers")
  .option("--region <region>", {
    type: "string",
    autocomplete: ["us-east-1", "us-west-2", "eu-west-1"],
    description: "Region with explicit autocomplete candidates",
  })
  .complete((ctx) => {
    const all = ["alpha", "beta", "gamma", "delta"];
    return all.filter((item) => item.startsWith(ctx.current));
  })
  .action((ctx) => {
    ctx.stdout.write("Completion providers registered for this command.\n");
    ctx.stdout.write(`Current arg: ${ctx.args.current ?? "(none)"}\n`);
    ctx.stdout.write(`Region: ${ctx.options.region ?? "(none)"}\n`);
  });

cli
  .command("cancel-info")
  .description("Register a custom SIGINT cancel handler")
  .cancel((ctx) => {
    ctx.stderr.write(color.yellow("Cancelled long-running work\n"));
  })
  .action((ctx) => {
    ctx.stdout.write(
      "Cancel handler registered. Press Ctrl+C while this command runs in a real app.\n",
    );
  });

const removed = cli
  .command("removed")
  .description("This command is registered and then removed before start")
  .action((ctx) => {
    ctx.stdout.write("You should not see this.\n");
  });
removed.remove();

cli.start();

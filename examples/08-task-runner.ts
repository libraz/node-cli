/**
 * Example: Task Runner
 *
 * A practical example combining multiple features: subcommands,
 * progress bars, spinners, tables, color, logger, and dynamic
 * command registration/removal.
 *
 * Usage:
 *   npx tsx examples/08-task-runner.ts run build
 *   npx tsx examples/08-task-runner.ts run test --verbose
 *   npx tsx examples/08-task-runner.ts run all
 *   npx tsx examples/08-task-runner.ts list
 */
import type { Writable } from "node:stream";
import { createCLI, createColorizer, logger, progress, table } from "../src/index.js";

interface Task {
  name: string;
  description: string;
  duration: number; // simulated ms
  status: "pending" | "running" | "done" | "failed";
}

type TaskContext = {
  stdout: Writable;
  stderr: Writable;
};

const tasks: Task[] = [
  { name: "lint", description: "Run linter", duration: 800, status: "pending" },
  { name: "build", description: "Compile TypeScript", duration: 1500, status: "pending" },
  { name: "test", description: "Run test suite", duration: 2000, status: "pending" },
  { name: "bundle", description: "Create production bundle", duration: 1200, status: "pending" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const cli = createCLI({ name: "taskr", prompt: "taskr> " });

// ── List tasks ──

cli
  .command("list")
  .alias("ls")
  .description("Show all available tasks")
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    const data = tasks.map((t) => ({
      name: t.name,
      description: t.description,
      status:
        t.status === "done"
          ? col.green(t.status)
          : t.status === "failed"
            ? col.red(t.status)
            : t.status,
    }));

    ctx.stdout.write(`${col.bold("Available Tasks")}\n\n`);
    ctx.stdout.write(table(data, { border: "rounded", headerStyle: "bold" }));
    ctx.stdout.write("\n");
  });

// ── Run a task ──

cli
  .command("run <task>")
  .alias("r")
  .description("Run a task by name")
  .option("-v, --verbose", { type: "boolean", description: "Show detailed output" })
  .validate((ctx) => {
    const name = ctx.args.task as string;
    if (name !== "all" && !tasks.find((t) => t.name === name)) {
      const names = tasks.map((t) => t.name).join(", ");
      throw new Error(`Unknown task "${name}". Available: ${names}, all`);
    }
  })
  .action(async (ctx) => {
    const taskName = ctx.args.task as string;
    const verbose = ctx.options.verbose as boolean;

    if (taskName === "all") {
      await runAll(ctx, verbose);
    } else {
      const task = tasks.find((candidate) => candidate.name === taskName);
      if (!task) throw new Error(`Unknown task: ${taskName}`);
      await runSingle(task, ctx, verbose);
    }
  });

async function runSingle(task: Task, ctx: TaskContext, verbose: boolean) {
  const col = createColorizer(ctx.stdout);
  const log = logger({ prefix: "runner", timestamp: true, stream: ctx.stderr });
  const spinner = progress.spinner({
    label: `Running ${col.bold(task.name)}...`,
    color: "cyan",
    stream: ctx.stdout,
  });

  task.status = "running";
  spinner.start();

  if (verbose) {
    log.info("Starting task: %s", task.name);
  }

  // Simulate work
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    await sleep(task.duration / steps);
    if (verbose && i === Math.floor(steps / 2)) {
      spinner.update(`Running ${col.bold(task.name)}... (50%)`);
    }
  }

  task.status = "done";
  spinner.succeed(`${col.bold(task.name)} completed in ${String(task.duration)}ms`);

  if (verbose) {
    log.success("Task %s finished", task.name);
  }
}

async function runAll(ctx: TaskContext, verbose: boolean) {
  const col = createColorizer(ctx.stdout);
  const log = logger({ prefix: "runner", timestamp: true, stream: ctx.stderr });
  ctx.stdout.write(`${col.bold("Running all tasks...")}\n\n`);

  const bar = progress.bar({
    total: tasks.length,
    label: "Overall",
    color: "green",
    stream: ctx.stdout,
  });

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    task.status = "running";
    if (verbose) log.info("Starting task: %s", task.name);
    await sleep(task.duration);
    task.status = "done";
    if (verbose) log.success("Task %s finished", task.name);
    bar.update(i + 1);
  }

  bar.finish();

  ctx.stdout.write(`\n${col.green.bold("All tasks completed!")}\n\n`);

  // Summary table
  const summary = tasks.map((t) => ({
    task: t.name,
    status: t.status === "done" ? col.green("PASS") : col.red("FAIL"),
    time: `${t.duration}ms`,
  }));

  ctx.stdout.write(table(summary, { border: "simple", headerStyle: "bold" }));
  ctx.stdout.write("\n");
}

// ── Reset tasks ──

cli
  .command("reset")
  .description("Reset all task statuses")
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    for (const task of tasks) {
      task.status = "pending";
    }
    ctx.stdout.write(`${col.green("All tasks reset.")}\n`);
  });

await cli.start();

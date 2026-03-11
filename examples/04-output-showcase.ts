/**
 * Example: Output Utilities Showcase
 *
 * Demonstrates all built-in output utilities: color, table, progress bar,
 * spinner, and logger.
 *
 * Usage:
 *   npx tsx examples/04-output-showcase.ts color
 *   npx tsx examples/04-output-showcase.ts table
 *   npx tsx examples/04-output-showcase.ts progress
 *   npx tsx examples/04-output-showcase.ts spinner
 *   npx tsx examples/04-output-showcase.ts logger
 */
import { createCLI, color, c, table, progress, logger } from "../src/index.js";

const cli = createCLI({ name: "showcase" });

// ── Color demo ──

cli
  .command("color")
  .description("Demonstrate color output")
  .action((ctx) => {
    ctx.stdout.write("=== Proxy-based API ===\n");
    ctx.stdout.write(color.red("Red text") + "\n");
    ctx.stdout.write(color.bold.green("Bold green") + "\n");
    ctx.stdout.write(color.bgYellow.black("Black on yellow") + "\n");
    ctx.stdout.write(color.dim.italic("Dim italic") + "\n");
    ctx.stdout.write(color.underline.cyan("Underlined cyan") + "\n\n");

    ctx.stdout.write("=== Template literal tag ===\n");
    ctx.stdout.write(c`Status: {green OK}\n`);
    ctx.stdout.write(c`{bold.red ERROR}: Something went wrong\n`);
    ctx.stdout.write(c`{dim [12:00:00]} {cyan https://example.com}\n`);
  });

// ── Table demo ──

cli
  .command("table")
  .description("Demonstrate table display")
  .option("--border <style>", {
    type: "string",
    choices: ["none", "simple", "rounded"],
    default: "rounded",
  })
  .action((ctx) => {
    const users = [
      { name: "Alice", role: "Admin", email: "alice@example.com", active: true },
      { name: "Bob", role: "Developer", email: "bob@example.com", active: true },
      { name: "Charlie", role: "Designer", email: "charlie@example.com", active: false },
      { name: "Diana", role: "PM", email: "diana@example.com", active: true },
    ];

    ctx.stdout.write("=== User Table ===\n\n");
    ctx.stdout.write(
      table(users, {
        border: ctx.options.border as "none" | "simple" | "rounded",
        headerStyle: "bold",
        align: { active: "center" },
      }),
    );
    ctx.stdout.write("\n\n");

    ctx.stdout.write("=== Array Table ===\n\n");
    ctx.stdout.write(
      table(
        [
          ["Package", "Version", "Size"],
          ["@libraz/node-cli", "0.1.0", "45 KB"],
          ["typescript", "5.7.0", "65 MB"],
          ["vitest", "3.0.0", "12 MB"],
        ],
        { border: "simple", headerStyle: "bold" },
      ),
    );
    ctx.stdout.write("\n");
  });

// ── Progress bar demo ──

cli
  .command("progress")
  .description("Demonstrate progress bar")
  .action(async (ctx) => {
    ctx.stdout.write("=== Single Bar ===\n");
    const bar = progress.bar({
      total: 50,
      label: "Processing",
      color: "green",
      stream: ctx.stdout,
    });

    for (let i = 0; i <= 50; i++) {
      bar.update(i);
      await sleep(30);
    }
    bar.finish();

    ctx.stdout.write("\n=== Multi Bar ===\n");
    const multi = progress.multi();
    const bars = [
      multi.add({ total: 40, label: "File 1", color: "cyan", stream: ctx.stdout }),
      multi.add({ total: 60, label: "File 2", color: "yellow", stream: ctx.stdout }),
      multi.add({ total: 30, label: "File 3", color: "magenta", stream: ctx.stdout }),
    ];

    for (let i = 0; i <= 60; i++) {
      if (i <= 40) bars[0].update(i);
      bars[1].update(i);
      if (i <= 30) bars[2].update(i);
      await sleep(30);
    }
    multi.finish();
  });

// ── Spinner demo ──

cli
  .command("spinner")
  .description("Demonstrate spinner")
  .action(async (ctx) => {
    const spinner = progress.spinner({
      label: "Installing dependencies...",
      color: "cyan",
      stream: ctx.stdout,
    });

    spinner.start();
    await sleep(1500);
    spinner.update("Compiling TypeScript...");
    await sleep(1500);
    spinner.update("Running tests...");
    await sleep(1000);
    spinner.succeed("Build complete!");

    const spinner2 = progress.spinner({
      label: "Deploying to production...",
      color: "yellow",
      stream: ctx.stdout,
    });
    spinner2.start();
    await sleep(1500);
    spinner2.fail("Deployment failed: timeout");

    const spinner3 = progress.spinner({
      label: "Checking disk space...",
      stream: ctx.stdout,
    });
    spinner3.start();
    await sleep(1000);
    spinner3.warn("Disk usage above 80%");
  });

// ── Logger demo ──

cli
  .command("logger")
  .description("Demonstrate logger")
  .option("-l, --level <level>", {
    type: "string",
    choices: ["debug", "info", "warn", "error"],
    default: "debug",
  })
  .action((ctx) => {
    const log = logger({
      level: ctx.options.level as "debug" | "info" | "warn" | "error",
      prefix: "app",
      timestamp: true,
      stream: ctx.stdout,
    });

    log.debug("Initializing application with config: %j", { port: 3000, env: "dev" });
    log.info("Server started on port %d", 3000);
    log.success("Connected to database");
    log.warn("Cache miss rate is %d%%", 45);
    log.error("Failed to process request: %s", "timeout after 30s");

    ctx.stdout.write("\n=== Child Logger ===\n\n");

    const db = log.child("db");
    const http = log.child("http");

    db.info("Connection pool: %d/%d", 8, 10);
    db.debug("Query: SELECT * FROM users WHERE id = %d", 42);
    http.info("GET /api/users 200 %dms", 12);
    http.warn("Rate limit approaching: %d/100 requests", 89);
  });

cli.start();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

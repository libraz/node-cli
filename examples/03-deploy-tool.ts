/**
 * Example: Deployment Tool
 *
 * Demonstrates validation, events, error handling, and the catch handler
 * for a deployment workflow CLI.
 *
 * Usage:
 *   npx tsx examples/03-deploy-tool.ts deploy prod --tag v1.2.3
 *   npx tsx examples/03-deploy-tool.ts deploy staging --tag v1.2.3 --dry-run
 *   npx tsx examples/03-deploy-tool.ts rollback prod
 *   npx tsx examples/03-deploy-tool.ts status
 */
import { createCLI, createColorizer } from "../src/index.js";

const cli = createCLI({ name: "deploy-tool" });

// ── Events for logging ──

cli.on("beforeExecute", (ctx) => {
  if (ctx.commandPath[0] === "help") return;
  const col = createColorizer(ctx.stderr);
  ctx.stderr.write(
    col.dim(`[${new Date().toISOString()}] Running: ${ctx.commandPath.join(" ")}\n`),
  );
});

cli.on("afterExecute", (ctx) => {
  if (ctx.commandPath[0] === "help") return;
  const col = createColorizer(ctx.stderr);
  ctx.stderr.write(col.dim(`[${new Date().toISOString()}] Done\n`));
});

cli.on("commandError", (error, ctx) => {
  const col = createColorizer(ctx.stderr);
  ctx.stderr.write(`${col.red.bold(`Error in ${ctx.commandPath.join(" ")}`)}: ${error.message}\n`);
});

// ── Catch unknown commands ──

cli.catch((input, { stderr }) => {
  const col = createColorizer(stderr);
  stderr.write(`${col.yellow("Unknown command")}: "${input}"\n`);
  stderr.write('Run "help" for available commands.\n');
});

// ── Deploy command ──

cli
  .command("deploy <env>")
  .alias("d")
  .description("Deploy application to an environment")
  .option("-t, --tag <tag>", { type: "string", required: true, description: "Release tag" })
  .option("--dry-run", { type: "boolean", description: "Simulate without deploying" })
  .option("--force", { type: "boolean", description: "Skip safety checks" })
  .validate((ctx) => {
    const validEnvs = ["prod", "staging", "dev"];
    if (!validEnvs.includes(ctx.args.env as string)) {
      throw new Error(
        `Invalid environment "${ctx.args.env}". Must be one of: ${validEnvs.join(", ")}`,
      );
    }
    if (ctx.args.env === "prod" && !ctx.options.tag) {
      throw new Error("Production deployments require a --tag");
    }
  })
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    const env = ctx.args.env as string;
    const tag = ctx.options.tag as string;
    const dryRun = ctx.options["dry-run"] as boolean;

    if (dryRun) {
      ctx.stdout.write(
        `${col.yellow("[DRY RUN]")} Would deploy ${col.bold(tag)} to ${col.bold(env)}\n`,
      );
      return;
    }

    ctx.stdout.write(`${col.green("Deploying")} ${col.bold(tag)} to ${col.bold(env)}...\n`);
    ctx.stdout.write(`${col.green.bold("Done!")} Deployment successful.\n`);
  });

// ── Rollback command ──

cli
  .command("rollback <env>")
  .description("Rollback to previous deployment")
  .option("-n, --steps <n>", {
    type: "number",
    default: 1,
    description: "Number of versions to rollback",
  })
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    const env = ctx.args.env as string;
    const steps = ctx.options.steps as number;
    ctx.stdout.write(
      `${col.yellow("Rolling back")} ${col.bold(env)} by ${String(steps)} version(s)...\n`,
    );
    ctx.stdout.write(`${col.green.bold("Done!")} Rollback complete.\n`);
  });

// ── Status command ──

cli
  .command("status")
  .alias("s")
  .description("Show deployment status")
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    ctx.stdout.write(`${col.bold("Deployment Status")}\n`);
    ctx.stdout.write(`  prod:    ${col.green("v1.2.3")}  (deployed 2h ago)\n`);
    ctx.stdout.write(`  staging: ${col.yellow("v1.3.0-rc1")}  (deployed 30m ago)\n`);
    ctx.stdout.write(`  dev:     ${col.cyan("v1.3.0-dev.42")}  (deployed 5m ago)\n`);
  });

await cli.start();

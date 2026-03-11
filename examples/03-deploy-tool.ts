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
import { createCLI, color, c } from "../src/index.js";

const cli = createCLI({ name: "deploy-tool" });

// ── Events for logging ──

cli.on("beforeExecute", (ctx) => {
  if (ctx.commandPath[0] === "help") return;
  ctx.stderr.write(c`{dim [${new Date().toISOString()}] Running: ${ctx.commandPath.join(" ")}}\n`);
});

cli.on("afterExecute", (ctx) => {
  if (ctx.commandPath[0] === "help") return;
  ctx.stderr.write(c`{dim [${new Date().toISOString()}] Done}\n`);
});

cli.on("commandError", (error, ctx) => {
  ctx.stderr.write(c`{red.bold Error in ${ctx.commandPath.join(" ")}}: ${error.message}\n`);
});

// ── Catch unknown commands ──

cli.catch((input, { stderr }) => {
  stderr.write(c`{yellow Unknown command}: "${input}"\n`);
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
      throw new Error(`Invalid environment "${ctx.args.env}". Must be one of: ${validEnvs.join(", ")}`);
    }
    if (ctx.args.env === "prod" && !ctx.options.tag) {
      throw new Error("Production deployments require a --tag");
    }
  })
  .action((ctx) => {
    const env = ctx.args.env as string;
    const tag = ctx.options.tag as string;
    const dryRun = ctx.options.dry_run as boolean;

    if (dryRun) {
      ctx.stdout.write(c`{yellow [DRY RUN]} Would deploy {bold ${tag}} to {bold ${env}}\n`);
      return;
    }

    ctx.stdout.write(c`{green Deploying} {bold ${tag}} to {bold ${env}}...\n`);
    ctx.stdout.write(c`{green.bold Done!} Deployment successful.\n`);
  });

// ── Rollback command ──

cli
  .command("rollback <env>")
  .description("Rollback to previous deployment")
  .option("-n, --steps <n>", { type: "number", default: 1, description: "Number of versions to rollback" })
  .action((ctx) => {
    const env = ctx.args.env as string;
    const steps = ctx.options.steps as number;
    ctx.stdout.write(c`{yellow Rolling back} {bold ${env}} by ${String(steps)} version(s)...\n`);
    ctx.stdout.write(c`{green.bold Done!} Rollback complete.\n`);
  });

// ── Status command ──

cli
  .command("status")
  .alias("s")
  .description("Show deployment status")
  .action((ctx) => {
    ctx.stdout.write(c`{bold Deployment Status}\n`);
    ctx.stdout.write(c`  prod:    {green v1.2.3}  (deployed 2h ago)\n`);
    ctx.stdout.write(c`  staging: {yellow v1.3.0-rc1}  (deployed 30m ago)\n`);
    ctx.stdout.write(c`  dev:     {cyan v1.3.0-dev.42}  (deployed 5m ago)\n`);
  });

cli.start();

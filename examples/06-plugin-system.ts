/**
 * Example: Plugin System
 *
 * Demonstrates how to build reusable plugins that extend the CLI
 * with new commands and event hooks.
 *
 * Usage:
 *   npx tsx examples/06-plugin-system.ts version
 *   npx tsx examples/06-plugin-system.ts ping
 *   npx tsx examples/06-plugin-system.ts greet World
 */
import type { PluginContext, CLIEventMap } from "../src/index.js";
import { createCLI, c, color } from "../src/index.js";

// ── Plugin: Timing ──
// Adds execution timing to all commands

function timingPlugin(ctx: PluginContext) {
  const timers = new Map<string, number>();

  ctx.on("beforeExecute", (cmdCtx) => {
    timers.set(cmdCtx.rawInput, Date.now());
  });

  ctx.on("afterExecute", (cmdCtx) => {
    const start = timers.get(cmdCtx.rawInput);
    if (start) {
      const elapsed = Date.now() - start;
      cmdCtx.stderr.write(c`{dim Completed in ${String(elapsed)}ms}\n`);
      timers.delete(cmdCtx.rawInput);
    }
  });
}

// ── Plugin: Version ──
// Adds a "version" command that prints the app version

function versionPlugin(version: string) {
  return (ctx: PluginContext) => {
    ctx.command("version")
      .alias("v")
      .description("Show application version")
      .action((cmdCtx) => {
        cmdCtx.stdout.write(`${version}\n`);
      });
  };
}

// ── Plugin: Health Check ──
// Adds a "ping" command and logs errors

function healthPlugin(ctx: PluginContext) {
  ctx.command("ping")
    .description("Check if the application is alive")
    .action((cmdCtx) => {
      cmdCtx.stdout.write(c`{green pong} — all systems operational\n`);
    });

  ctx.on("commandError", (error) => {
    process.stderr.write(c`{red [health]} Error detected: ${error.message}\n`);
  });
}

// ── Plugin: Greeting (async) ──
// Demonstrates an async plugin that could load config from disk/network

function greetingPlugin() {
  return async (ctx: PluginContext) => {
    // Simulate async initialization (e.g., loading config)
    await new Promise((resolve) => setTimeout(resolve, 10));

    ctx.command("greet <name>")
      .description("Greet someone warmly")
      .option("--style <style>", {
        type: "string",
        choices: ["formal", "casual", "pirate"],
        default: "casual",
      })
      .action((cmdCtx) => {
        const name = cmdCtx.args.name as string;
        const style = cmdCtx.options.style as string;

        const greetings: Record<string, string> = {
          formal: `Good day, ${name}. How do you do?`,
          casual: `Hey ${name}! What's up?`,
          pirate: `Ahoy, ${name}! Shiver me timbers!`,
        };

        cmdCtx.stdout.write(greetings[style] + "\n");
      });
  };
}

// ── Assemble the CLI ──

const cli = createCLI({ name: "pluggable" });

cli.use(timingPlugin);
cli.use(versionPlugin("1.0.0"));
cli.use(healthPlugin);
cli.use(greetingPlugin());

cli.start();

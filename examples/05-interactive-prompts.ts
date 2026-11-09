/**
 * Example: Interactive Prompts
 *
 * Demonstrates all built-in prompt types: text, confirm, select,
 * multiselect, and password.
 *
 * Usage:
 *   npx tsx examples/05-interactive-prompts.ts init
 *   npx tsx examples/05-interactive-prompts.ts login
 */
import {
  CancelledError,
  createCLI,
  createColorizer,
  InputEndedError,
  prompt,
} from "../src/index.js";

const cli = createCLI({ name: "setup" });

// ── Project initialization wizard ──

cli
  .command("init")
  .description("Initialize a new project interactively")
  .action(async (ctx) => {
    const col = createColorizer(ctx.stdout);
    try {
      ctx.stdout.write(`${col.bold.cyan("Project Setup Wizard")}\n\n`);

      // Text input
      const name = await prompt.text("Project name:", {
        ...ctx,
        default: "my-project",
        validate: (v) => {
          if (!/^[a-z0-9-]+$/.test(v)) {
            throw new Error("Only lowercase letters, numbers, and hyphens allowed");
          }
        },
      });

      const description = await prompt.text("Description:", {
        ...ctx,
        placeholder: "A brief description of your project",
        required: false,
      });

      // Select
      const template = await prompt.select(
        "Template:",
        [
          { label: "Minimal", value: "minimal", hint: "Bare bones setup" },
          { label: "Web Server", value: "web", hint: "Express-like HTTP server" },
          { label: "CLI Tool", value: "cli", hint: "Command-line application" },
          { label: "Library", value: "lib", hint: "Publishable npm package" },
        ],
        ctx,
      );

      // Multiselect
      const features = await prompt.multiselect(
        "Features:",
        [
          { label: "TypeScript", value: "typescript" },
          { label: "ESLint", value: "eslint" },
          { label: "Prettier", value: "prettier" },
          { label: "Vitest", value: "vitest" },
          { label: "GitHub Actions", value: "github-actions" },
          { label: "Docker", value: "docker" },
        ],
        ctx,
      );

      // Confirm
      const git = await prompt.confirm("Initialize git repository?", { ...ctx, default: true });

      // Summary
      ctx.stdout.write(`\n${col.bold.green("Project Configuration")}\n`);
      ctx.stdout.write(`  Name:        ${col.cyan(name)}\n`);
      ctx.stdout.write(`  Description: ${description || col.dim("(none)")}\n`);
      ctx.stdout.write(`  Template:    ${col.yellow(template)}\n`);
      ctx.stdout.write(`  Features:    ${features.join(", ") || col.dim("(none)")}\n`);
      ctx.stdout.write(`  Git:         ${git ? col.green("Yes") : col.red("No")}\n`);

      ctx.stderr.write("\n");
      const proceed = await prompt.confirm("Proceed with setup?", ctx);
      if (proceed) {
        ctx.stdout.write(`\n${col.green.bold("Done!")} Project "${name}" created successfully.\n`);
      } else {
        ctx.stdout.write(`\n${col.yellow("Cancelled.")}\n`);
      }
    } catch (err) {
      if (err instanceof CancelledError) {
        ctx.stderr.write(`\n${col.dim("Cancelled by user.")}\n`);
      } else if (err instanceof InputEndedError) {
        ctx.stderr.write(`\n${col.dim("Input ended before the wizard finished.")}\n`);
      } else {
        throw err;
      }
    }
  });

// ── Login flow ──

cli
  .command("login")
  .description("Authenticate with the service")
  .action(async (ctx) => {
    const col = createColorizer(ctx.stdout);
    try {
      ctx.stdout.write(`${col.bold("Login")}\n\n`);

      const username = await prompt.text("Username:", ctx);
      const _password = await prompt.password("Password:", ctx);

      ctx.stdout.write(`\n${col.dim("Authenticating...")}\n`);
      ctx.stdout.write(`${col.green.bold("Logged in")} as ${col.bold(username)}.\n`);
    } catch (err) {
      if (err instanceof CancelledError) {
        ctx.stderr.write(`\n${col.dim("Login cancelled.")}\n`);
      } else if (err instanceof InputEndedError) {
        ctx.stderr.write(`\n${col.dim("Input ended before login finished.")}\n`);
      } else {
        throw err;
      }
    }
  });

await cli.start();

/**
 * Example: Git-style Subcommands
 *
 * Demonstrates nested subcommands, options, aliases, and help generation
 * for a project management CLI similar to git.
 *
 * Usage:
 *   npx tsx examples/02-git-style.ts repo create myrepo --private
 *   npx tsx examples/02-git-style.ts repo list --limit 5
 *   npx tsx examples/02-git-style.ts issue create --title "Bug" --label bug
 *   npx tsx examples/02-git-style.ts help repo
 */
import { createCLI } from "../src/index.js";

const cli = createCLI({ name: "proj", prompt: "proj> " });

// ── repo commands ──

const repo = cli.command("repo").description("Repository management");

repo
  .command("create <name>")
  .alias("new")
  .description("Create a new repository")
  .option("--private", { type: "boolean", description: "Make repository private" })
  .option("-d, --description <desc>", { type: "string", description: "Repository description" })
  .action((ctx) => {
    const visibility = ctx.options.private ? "private" : "public";
    ctx.stdout.write(`Created ${visibility} repository: ${ctx.args.name}\n`);
    if (ctx.options.description) {
      ctx.stdout.write(`  Description: ${ctx.options.description}\n`);
    }
  });

repo
  .command("list")
  .alias("ls")
  .description("List repositories")
  .option("-l, --limit <n>", { type: "number", default: 10, description: "Max results" })
  .option("--sort <field>", {
    type: "string",
    choices: ["name", "created", "updated"],
    default: "name",
    description: "Sort field",
  })
  .action((ctx) => {
    ctx.stdout.write(`Listing up to ${ctx.options.limit} repos (sorted by ${ctx.options.sort})\n`);
    const repos = ["api-server", "frontend", "docs", "infra", "cli-tools"];
    const limit = ctx.options.limit as number;
    for (const name of repos.slice(0, limit)) {
      ctx.stdout.write(`  ${name}\n`);
    }
  });

repo
  .command("delete <name>")
  .alias("rm")
  .description("Delete a repository")
  .option("-f, --force", { type: "boolean", description: "Skip confirmation" })
  .action((ctx) => {
    if (!ctx.options.force) {
      ctx.stdout.write(`Use --force to confirm deletion of "${ctx.args.name}"\n`);
      return;
    }
    ctx.stdout.write(`Deleted repository: ${ctx.args.name}\n`);
  });

// ── issue commands ──

const issue = cli.command("issue").description("Issue tracking");

issue
  .command("create")
  .alias("new")
  .description("Create a new issue")
  .option("-t, --title <title>", { type: "string", required: true, description: "Issue title" })
  .option("-l, --label <label>", { type: "string[]", description: "Labels (repeatable)" })
  .option("-a, --assignee <user>", { type: "string", description: "Assign to user" })
  .action((ctx) => {
    ctx.stdout.write(`Created issue: ${ctx.options.title}\n`);
    if (ctx.options.label) {
      ctx.stdout.write(`  Labels: ${(ctx.options.label as string[]).join(", ")}\n`);
    }
    if (ctx.options.assignee) {
      ctx.stdout.write(`  Assignee: ${ctx.options.assignee}\n`);
    }
  });

issue
  .command("list")
  .alias("ls")
  .description("List open issues")
  .option("--status <status>", {
    type: "string",
    choices: ["open", "closed", "all"],
    default: "open",
  })
  .action((ctx) => {
    ctx.stdout.write(`Issues (${ctx.options.status}):\n`);
    ctx.stdout.write("  #1  Fix login bug          [bug]\n");
    ctx.stdout.write("  #2  Add dark mode           [feature]\n");
    ctx.stdout.write("  #3  Update dependencies     [chore]\n");
  });

cli.start();

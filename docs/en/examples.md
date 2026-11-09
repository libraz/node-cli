# Examples

Every example in the repository is a complete program that runs from a checkout with `npx tsx examples/<file>.ts [args...]`. Running one with no arguments in a terminal opens its interactive shell instead.

```bash
npx tsx examples/01-minimal.ts greet World
npx tsx examples/04-output-showcase.ts table --border rounded
npx tsx examples/07-pipe-and-mode.ts
```

| File | Demonstrates |
| --- | --- |
| [`01-minimal.ts`](../../examples/01-minimal.ts) | One command, run both as an argument and at the tool's own prompt. |
| [`02-git-style.ts`](../../examples/02-git-style.ts) | Nested subcommand groups, command aliases, repeatable options, restricted choices. |
| [`03-deploy-tool.ts`](../../examples/03-deploy-tool.ts) | Command-level validation, lifecycle events, a fallback handler for unknown input, colour. |
| [`04-output-showcase.ts`](../../examples/04-output-showcase.ts) | The output toolkit in isolation: colour, tables, a progress bar, a multi-bar, spinners, the logger. |
| [`05-interactive-prompts.ts`](../../examples/05-interactive-prompts.ts) | All five prompt kinds and cancellation handling. |
| [`06-plugin-system.ts`](../../examples/06-plugin-system.ts) | Plugins that add commands and event hooks, including an asynchronous one. |
| [`07-pipe-and-mode.ts`](../../examples/07-pipe-and-mode.ts) | Pipelines between commands, and mode sub-prompts with their own handler. |
| [`08-task-runner.ts`](../../examples/08-task-runner.ts) | A build-style runner: spinners, an overall bar, a summary table, per-command validation. |
| [`09-database-admin.ts`](../../examples/09-database-admin.ts) | A three-level command tree, confirmation prompts, tables, a SQL mode. |
| [`10-advanced-api.ts`](../../examples/10-advanced-api.ts) | Custom option parsing, hidden options, negated booleans, completion providers, advanced table and progress settings, command removal. |

The recipes below are self-contained programs. Each is written against the published package, so the import is `@libraz/node-cli` rather than a relative path. Terminal transcripts show output with colour disabled, which is what a redirected or captured stream receives.

## A single-command tool

The smallest program that does something useful: one command, one required argument.

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({
  name: "hello",
  version: "1.0.0",
  description: "A friendly greeting CLI",
});

cli
  .command("greet <name>")
  .description("Say hello to someone")
  .action((ctx) => {
    ctx.stdout.write(`Hello, ${ctx.args.name}!\n`);
  });

await cli.start();
```

```text
$ hello greet World
Hello, World!
```

The help index and the per-command page are generated from the same definition:

```text
$ hello --help
hello v1.0.0
A friendly greeting CLI

Available commands:

  greet <name>         Say hello to someone
  help [...command]    Show help information

Options:
  -h, --help       Show help
  -V, --version    Show the CLI version

Type "help <command>" for more information.
```

A missing required argument fails before the action runs, and the process exits with status 64:

```text
$ hello greet
Error: Missing required argument: <name>

  Usage: greet <name> [options]
```

Condensed from [`01-minimal.ts`](../../examples/01-minimal.ts). See [Commands](commands.md).

## A tool with subcommand groups

`remote` is a group with no action of its own; `add`, `remove` and `list` are the commands under it. Invoking the group alone prints its help.

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const remotes = new Map<string, string>([["origin", "https://github.com/acme/app.git"]]);

const cli = createCLI({ name: "vcs", description: "A small version-control front end" });

const remote = cli.command("remote").description("Manage repository remotes");

remote
  .command("add <name> <url>")
  .description("Register a new remote")
  .option("-f, --fetch", { type: "boolean", description: "Fetch immediately after adding" })
  .action((ctx) => {
    const { name, url } = ctx.args;
    if (remotes.has(name)) throw new Error(`Remote "${name}" already exists`);
    remotes.set(name, url);
    ctx.stdout.write(`Added remote ${name} -> ${url}\n`);
    if (ctx.options.fetch) ctx.stdout.write(`Fetching from ${name}...\n`);
  });

remote
  .command("remove <name>")
  .alias("rm")
  .description("Delete a remote")
  .action((ctx) => {
    const { name } = ctx.args;
    if (!remotes.delete(name)) throw new Error(`No such remote: ${name}`);
    ctx.stdout.write(`Removed remote ${name}\n`);
  });

remote
  .command("list")
  .alias("ls")
  .description("List configured remotes")
  .option("-v, --verbose", { type: "boolean", description: "Show URLs" })
  .action((ctx) => {
    for (const [name, url] of remotes) {
      ctx.stdout.write(ctx.options.verbose ? `${name}\t${url}\n` : `${name}\n`);
    }
  });

await cli.start();
```

The map lives in memory, so each run starts from the seeded value.

```text
$ vcs remote list --verbose
origin	https://github.com/acme/app.git

$ vcs remote add upstream https://github.com/acme/upstream.git --fetch
Added remote upstream -> https://github.com/acme/upstream.git
Fetching from upstream...

$ vcs remote rm nope
Error: No such remote: nope
```

A group with no action prints its subcommands, aliases included:

```text
$ vcs remote
Usage: remote <command> [options]

Manage repository remotes

Options:
  -h, --help    Show help for this command

Commands:
  add <name> <url>    Register a new remote
  remove <name>       Delete a remote (alias: rm)
  list                List configured remotes (alias: ls)

Type "help remote <command>" for more information.
```

Condensed from [`02-git-style.ts`](../../examples/02-git-style.ts).

## A deploy command with validation, a confirmation and a progress bar

Three checks run in order: the option's own `validate` (which produces a `ValidationError`), then the command's `validate`, then the action. The confirmation is skipped by `--yes`, so the command stays usable from a script.

```typescript
#!/usr/bin/env node
import { createCLI, isCancellationError, progress, prompt } from "@libraz/node-cli";

const cli = createCLI({ name: "deployer", description: "Ship a release" });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

cli
  .command("deploy <env>")
  .description("Deploy a tagged release to an environment")
  .option("-t, --tag <tag>", {
    type: "string",
    required: true,
    description: "Release tag to deploy",
    validate: (value) => {
      if (!/^v\d+\.\d+\.\d+$/.test(value)) {
        throw new Error(`expected a tag like v1.2.3, got "${value}"`);
      }
    },
  })
  .option("--yes", { type: "boolean", description: "Skip the confirmation prompt" })
  .validate((ctx) => {
    const allowed = ["dev", "staging", "prod"];
    const { env } = ctx.args;
    if (!allowed.includes(env)) {
      throw new Error(`Unknown environment "${env}". Expected one of: ${allowed.join(", ")}`);
    }
  })
  .action(async (ctx) => {
    const { env } = ctx.args;
    const { tag } = ctx.options;

    if (!ctx.options.yes) {
      try {
        const go = await prompt.confirm(`Deploy ${tag} to ${env}?`, { ...ctx, default: false });
        if (!go) {
          ctx.stdout.write("Aborted.\n");
          return;
        }
      } catch (err) {
        if (isCancellationError(err, ctx.signal)) {
          ctx.stderr.write("Aborted.\n");
          return;
        }
        throw err;
      }
    }

    const steps = ["build", "upload", "migrate", "switch", "verify"];
    const bar = progress.bar({ total: steps.length, label: "deploy", stderr: ctx.stderr });
    for (let done = 0; done < steps.length; done++) {
      await sleep(300);
      bar.tick();
    }
    bar.succeed();

    ctx.stdout.write(`Deployed ${tag} to ${env}.\n`);
  });

await cli.start();
```

The bar redraws one line in place, and `succeed()` replaces it with a result line.

```text
$ deployer deploy prod --tag v1.2.3
? Deploy v1.2.3 to prod? (y/N) y
✔ deploy
Deployed v1.2.3 to prod.
```

Answering anything but yes stops before any work happens:

```text
$ deployer deploy prod --tag v1.2.3
? Deploy v1.2.3 to prod? (y/N) n
Aborted.
```

Each rejection names the check that produced it, and each exits with status 64:

```text
$ deployer deploy prod --tag latest --yes
Error: Invalid value "latest" for --tag: expected a tag like v1.2.3, got "latest"

  Usage: deploy <env> [options]

$ deployer deploy edge --tag v1.0.0 --yes
Error: Unknown environment "edge". Expected one of: dev, staging, prod

  Usage: deploy <env> [options]

$ deployer deploy prod --yes
Error: Missing required option: --tag

  Usage: deploy <env> [options]
```

The bar writes to `ctx.stderr`, which is where progress belongs when stdout may be piped into another program, and the confirmation question is asked on `ctx.stderr` for the same reason. Passing `ctx` to the prompt hands it the command's `stdin`, `stderr` and `signal`. Builds on [`03-deploy-tool.ts`](../../examples/03-deploy-tool.ts). See [Progress](progress.md) and [Prompts](prompts.md).

## A status table with aligned and coloured columns

Each `ColumnSpec` names the object property it shows with `key` and sets the header `label` and the `align`. Colour applied to a cell adds no display width, so alignment is unaffected.

```typescript
#!/usr/bin/env node
import { createCLI, createColorizer, table } from "@libraz/node-cli";

const services = [
  { service: "api", replicas: 4, latency: "42ms", state: "healthy" },
  { service: "worker", replicas: 12, latency: "118ms", state: "degraded" },
  { service: "scheduler", replicas: 1, latency: "7ms", state: "healthy" },
];

const cli = createCLI({ name: "fleet", description: "Cluster status" });

cli
  .command("status")
  .description("Show the state of every service")
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    const rows = services.map((row) => ({
      ...row,
      state: row.state === "healthy" ? col.green(row.state) : col.yellow(row.state),
    }));

    ctx.stdout.write(
      `${table(rows, {
        border: "rounded",
        columns: [
          { key: "service", label: "Service" },
          { key: "replicas", label: "Pods", align: "right" },
          { key: "latency", label: "p95", align: "right" },
          { key: "state", label: "State", align: "center" },
        ],
        headerStyle: "cyan.bold",
        borderStyle: "dim",
      })}\n`,
    );
  });

await cli.start();
```

```text
$ fleet status
╭───────────┬──────┬───────┬──────────╮
│ Service   │ Pods │   p95 │  State   │
├───────────┼──────┼───────┼──────────┤
│ api       │    4 │  42ms │ healthy  │
│ worker    │   12 │ 118ms │ degraded │
│ scheduler │    1 │   7ms │ healthy  │
╰───────────┴──────┴───────┴──────────╯
```

`createColorizer(ctx.stdout)` ties colour to the stream the command is writing to, so the escape codes disappear when that stream is redirected to a file. Condensed from [`04-output-showcase.ts`](../../examples/04-output-showcase.ts). See [Tables](table.md) and [Colour](color.md).

## A setup wizard built from prompts

Five prompts run in sequence, each given the command context so that the question, the input and the abort signal belong to the command. Two failures escape a prompt: `CancelledError` when the user presses Ctrl-C, and `InputEndedError` when no input is left to read, for example when standard input is closed. A `validate` that throws does not escape; it prints its message and asks again. One catch around the whole sequence therefore handles Ctrl-C at any step, and `InputEndedError` is left to the framework, which reports it and exits with status 66.

```typescript
#!/usr/bin/env node
import { CancelledError, createCLI, prompt } from "@libraz/node-cli";

const cli = createCLI({ name: "scaffold", description: "Create a new project" });

cli
  .command("init")
  .description("Create a project interactively")
  .action(async (ctx) => {
    try {
      const name = await prompt.text("Project name:", {
        ...ctx,
        default: "my-app",
        validate: (value) => {
          if (!/^[a-z0-9-]+$/.test(value)) {
            throw new Error("use lowercase letters, digits and hyphens only");
          }
        },
      });

      const template = await prompt.select(
        "Template:",
        [
          { label: "Minimal", value: "minimal", hint: "one file" },
          { label: "HTTP server", value: "server" },
          { label: "Library", value: "lib" },
        ],
        { ...ctx, default: "minimal" },
      );

      const features = await prompt.multiselect(
        "Features:",
        [
          { label: "TypeScript", value: "ts" },
          { label: "Tests", value: "tests" },
          { label: "Dockerfile", value: "docker" },
        ],
        { ...ctx, min: 1 },
      );

      const git = await prompt.confirm("Initialize a git repository?", { ...ctx, default: true });

      ctx.stderr.write("\n");
      if (!(await prompt.confirm("Create the project?", ctx))) {
        ctx.stdout.write("Nothing created.\n");
        return;
      }

      ctx.stdout.write(`name:     ${name}\n`);
      ctx.stdout.write(`template: ${template}\n`);
      ctx.stdout.write(`features: ${features.join(", ")}\n`);
      ctx.stdout.write(`git:      ${git ? "yes" : "no"}\n`);
    } catch (err) {
      if (err instanceof CancelledError) {
        ctx.stderr.write("\nCancelled.\n");
        return;
      }
      throw err;
    }
  });

await cli.start();
```

Pressing Enter at the first question accepts the default, because an explicit `default` bypasses the `required` check:

```text
$ scaffold init
? Project name: (my-app) 
? Template:
  1) Minimal (one file) [default]
  2) HTTP server
  3) Library
Enter number (default 1): 2
? Features: (comma-separated numbers)
  1) TypeScript
  2) Tests
  3) Dockerfile
Enter numbers: 1,2
? Initialize a git repository? (Y/n) 

? Create the project? (y/N) y
name:     my-app
template: server
features: ts, tests
git:      yes
```

An invalid answer is reported and the same question is asked again:

```text
? Project name: (my-app) My App
✖ use lowercase letters, digits and hyphens only
? Project name: (my-app) 
```

Ctrl-C at any question rejects with `CancelledError`, whose exit code is 130:

```text
? Template:
  1) Minimal (one file) [default]
  2) HTTP server
  3) Library
Enter number (default 1): ^C
Cancelled.
```

A prompt message and marker are drawn on one line, so a blank line before a question is written to `ctx.stderr` separately rather than put in the message as `\n`. The cancellation notice goes to `ctx.stderr` as well, which keeps `stdout` for the command's result. Condensed from [`05-interactive-prompts.ts`](../../examples/05-interactive-prompts.ts). See [Prompts](prompts.md).

## Extending a CLI with a plugin

A plugin is a function that receives a context and registers commands, event listeners or a fallback handler. It may be asynchronous, in which case it is awaited before any command runs.

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";
import type { CommandContext, PluginContext } from "@libraz/node-cli";

function timingPlugin(ctx: PluginContext): void {
  const started = new WeakMap<CommandContext, number>();
  ctx.on("beforeExecute", (cmd) => {
    started.set(cmd, Date.now());
  });
  ctx.on("afterExecute", (cmd) => {
    const start = started.get(cmd);
    if (start !== undefined) {
      cmd.stderr.write(`(${cmd.commandPath.join(" ")} took ${Date.now() - start}ms)\n`);
    }
  });
}

function healthPlugin(baseUrl: string) {
  return async (ctx: PluginContext): Promise<void> => {
    await Promise.resolve(); // stand-in for loading configuration

    ctx
      .command("ping")
      .description("Check that the service answers")
      .option("--timeout <ms>", { type: "number", default: 2000, description: "Request timeout" })
      .action((cmd) => {
        cmd.stdout.write(`pong from ${baseUrl} (timeout ${cmd.options.timeout}ms)\n`);
      });

    ctx.fallback((input, io) => {
      io.stderr.write(`Unknown command: ${input}\n`);
    });
  };
}

const cli = createCLI({ name: "svc", description: "Service control" });

cli.use(timingPlugin);
cli.use(healthPlugin("https://api.example.com"));

await cli.start();
```

```text
$ svc ping --timeout 500
pong from https://api.example.com (timeout 500ms)
(ping took 0ms)

$ svc wat
Unknown command: wat
```

The elapsed figure varies from run to run. A fallback handler resolves the invocation, so an unmatched command exits 0 rather than failing with `CommandNotFoundError`; write to `stderr` and set `process.exitCode` if a non-zero status is wanted.

Condensed from [`06-plugin-system.ts`](../../examples/06-plugin-system.ts). See [Events and plugins](events-and-plugins.md).

## Chaining commands with a pipe and a mode sub-prompt

A pipeline is built from a line of text only — the interactive shell, or `cli.execLine("a | b")`. Direct mode and `cli.exec()` receive an array of arguments and never split on a pipe character. Stages run concurrently, and each stage after the first reads the previous stage's output from `ctx.stdin`.

```typescript
#!/usr/bin/env node
import type { Readable } from "node:stream";
import { createCLI, isTTY } from "@libraz/node-cli";

const files = ["index.ts", "cli.ts", "README.md", "app.js", "parser.ts"];

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
}

const cli = createCLI({ name: "pipes", prompt: "pipes> " });

cli
  .command("list")
  .description("Print the sample file list")
  .action((ctx) => {
    for (const file of files) ctx.stdout.write(`${file}\n`);
  });

cli
  .command("filter <pattern>")
  .description("Keep only the lines that contain a pattern")
  .action(async (ctx) => {
    if (!ctx.stdin || isTTY(ctx.stdin)) {
      ctx.stderr.write("filter reads standard input; use it after a pipe\n");
      return;
    }
    const lines = (await readAll(ctx.stdin)).split("\n").filter(Boolean);
    for (const line of lines) {
      if (line.includes(ctx.args.pattern)) ctx.stdout.write(`${line}\n`);
    }
  });

cli
  .command("count")
  .description("Count the lines on standard input")
  .action(async (ctx) => {
    if (!ctx.stdin || isTTY(ctx.stdin)) {
      ctx.stderr.write("count reads standard input; use it after a pipe\n");
      return;
    }
    ctx.stdout.write(`${(await readAll(ctx.stdin)).split("\n").filter(Boolean).length}\n`);
  });

cli
  .command("calc")
  .description("Open a calculator sub-prompt")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("calc needs the interactive shell\n");
      return;
    }
    ctx.shell.enterMode({
      prompt: "calc> ",
      banner: "Calculator. Type an arithmetic expression, or exit to return.",
      action: (input, io) => {
        if (!/^[\d\s+\-*/().]+$/.test(input)) {
          io.stderr.write("only + - * / and parentheses are supported\n");
          return;
        }
        io.stdout.write(`= ${String(Number(new Function(`return (${input})`)()))}\n`);
      },
    });
  });

await cli.start();
```

Run without arguments in a terminal, the tool opens its own prompt, and both the pipeline and the mode are reachable from there:

```text
$ pipes
pipes
pipes> list | filter ts | count
3
pipes> calc
Calculator. Type an arithmetic expression, or exit to return.
calc> 2 + 3 * 4
= 14
calc> exit
pipes> exit
```

`exit` inside a mode leaves the mode rather than the shell, because a mode does not dispatch through the command registry and a command of that name would be unreachable there.

The same pipeline runs programmatically through `execLine`, which accepts a line of text:

```typescript
await cli.execLine("list | filter ts | count");
```

A command that is the first stage, or runs alone, has the terminal as `ctx.stdin` in the shell, and that stream does not end, so the `isTTY` check makes it print a hint instead of waiting. `ctx.shell` is `null` under `execLine`, so `calc` prints its guard message instead of opening a sub-prompt. Condensed from [`07-pipe-and-mode.ts`](../../examples/07-pipe-and-mode.ts). See [Interactive shell](interactive-shell.md).

## A task runner with concurrent progress bars

Two standalone indicators cannot share a terminal stream — the second throws, because neither can know the other's row layout. Concurrent bars belong to a `progress.multi()` group, which renders every bar as one frame.

```typescript
#!/usr/bin/env node
import { createCLI, progress, table } from "@libraz/node-cli";

interface Task {
  name: string;
  steps: number;
  ms: number;
}

const tasks: Task[] = [
  { name: "lint", steps: 4, ms: 120 },
  { name: "build", steps: 10, ms: 90 },
  { name: "test", steps: 6, ms: 200 },
];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const cli = createCLI({ name: "taskr", description: "Run build tasks" });

cli
  .command("run [...names]")
  .description("Run tasks concurrently")
  .action(async (ctx) => {
    const requested = ctx.args.names;
    const selected = requested.length > 0
      ? tasks.filter((task) => requested.includes(task.name))
      : tasks;

    if (selected.length === 0) throw new Error("No matching task");

    const multi = progress.multi({ stderr: ctx.stderr });
    const started = Date.now();

    try {
      await Promise.all(
        selected.map(async (task) => {
          const bar = multi.add({
            total: task.steps,
            label: task.name,
            width: 20,
          });
          for (let step = 0; step < task.steps; step++) {
            await sleep(task.ms);
            bar.tick();
          }
        }),
      );
      multi.succeed();
    } catch (err) {
      multi.fail();
      throw err;
    }

    const summary = selected.map((task) => ({
      task: task.name,
      steps: task.steps,
      result: "ok",
    }));

    ctx.stdout.write(`${table(summary, {
      border: "rounded",
      columns: ["task", { key: "steps", align: "right" }, "result"],
    })}\n`);
    ctx.stdout.write(`finished in ${Date.now() - started}ms\n`);
  });

await cli.start();
```

The group redraws all three rows together. Mid-run:

```text
lint  [████████████████████]  100%  4/4
build  [████████████░░░░░░░░]  60%  6/10
test  [███████░░░░░░░░░░░░░]  33%  2/6
```

After `succeed()` each row becomes a result line, followed by the summary table on stdout:

```text
✔ lint
✔ build
✔ test
╭───────┬───────┬────────╮
│ task  │ steps │ result │
├───────┼───────┼────────┤
│ lint  │     4 │ ok     │
│ build │    10 │ ok     │
│ test  │     6 │ ok     │
╰───────┴───────┴────────╯
finished in 1215ms
```

The elapsed figure varies from run to run. Rows are not padded to a common width: each line is the label, the bar, the percentage and the count, joined by two spaces. Pad the labels yourself if a column should line up.

`multi.fail()` in the `catch` closes the group when a task throws, and a bar added after the group closes is inert, so a task that finishes late cannot fail the command. Builds on [`08-task-runner.ts`](../../examples/08-task-runner.ts). See [Progress](progress.md).

## A deep subcommand tree with a mode sub-prompt

Groups nest to any depth. `db table show` is three levels: a group, a group, and a command with an argument and an option.

```typescript
#!/usr/bin/env node
import { createCLI, table } from "@libraz/node-cli";

const db: Record<string, Record<string, unknown>[]> = {
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "member" },
  ],
  posts: [{ id: 1, title: "Hello", author_id: 1 }],
};

const cli = createCLI({ name: "dbadmin", prompt: "db> ", description: "Database console" });

const root = cli.command("db").description("Database operations");

root
  .command("status")
  .description("Show connection status")
  .action((ctx) => {
    const rows = Object.entries(db).map(([name, records]) => ({
      table: name,
      rows: records.length,
      columns: Object.keys(records[0] ?? {}).length,
    }));
    ctx.stdout.write(
      `${table(rows, {
        border: "rounded",
        columns: ["table", { key: "rows", align: "right" }, { key: "columns", align: "right" }],
      })}\n`,
    );
  });

const tables = root.command("table").description("Table operations");

tables
  .command("list")
  .alias("ls")
  .description("List every table")
  .action((ctx) => {
    for (const name of Object.keys(db)) ctx.stdout.write(`${name}\n`);
  });

tables
  .command("show <name>")
  .description("Print the rows of a table")
  .option("-l, --limit <n>", { type: "number", default: 10, description: "Maximum rows" })
  .validate((ctx) => {
    if (!Object.hasOwn(db, ctx.args.name)) {
      throw new Error(`No such table: ${ctx.args.name}`);
    }
  })
  .action((ctx) => {
    const rows = db[ctx.args.name].slice(0, ctx.options.limit);
    ctx.stdout.write(`${table(rows, { border: "rounded" })}\n`);
  });

cli
  .command("sql")
  .description("Open a SQL sub-prompt")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("sql needs the interactive shell\n");
      return;
    }
    ctx.shell.enterMode({
      prompt: "sql> ",
      banner: "SQL mode. Type exit to return.",
      history: "none",
      action: (input, io) => {
        const match = /^select\s+\*\s+from\s+(\w+)$/i.exec(input.trim());
        const rows = match ? db[match[1]] : undefined;
        if (!rows) {
          io.stderr.write("only SELECT * FROM <table> is supported\n");
          return;
        }
        io.stdout.write(`${table(rows, { border: "rounded" })}\n`);
      },
    });
  });

await cli.start();
```

```text
$ dbadmin db status
╭───────┬──────┬─────────╮
│ table │ rows │ columns │
├───────┼──────┼─────────┤
│ users │    2 │       3 │
│ posts │    1 │       3 │
╰───────┴──────┴─────────╯

$ dbadmin db table show users
╭────┬───────┬────────╮
│ id │ name  │ role   │
├────┼───────┼────────┤
│ 1  │ Alice │ admin  │
│ 2  │ Bob   │ member │
╰────┴───────┴────────╯

$ dbadmin db table show nope
Error: No such table: nope
```

The same tree is available at the tool's own prompt, where the SQL mode also works:

```text
$ dbadmin
dbadmin
db> db table ls
users
posts
db> sql
SQL mode. Type exit to return.
sql> select * from posts
╭────┬───────┬───────────╮
│ id │ title │ author_id │
├────┼───────┼───────────┤
│ 1  │ Hello │ 1         │
╰────┴───────┴───────────╯
sql> exit
db> exit
```

`history: "none"` keeps typed queries out of the in-memory mode history; mode input is never written to the on-disk history file in any case. Builds on [`09-database-admin.ts`](../../examples/09-database-admin.ts).

## Custom completion, a custom option parser and a cancellation handler

`parse` replaces the built-in coercion for a supplied value, so an option can resolve to any type — here a `Date`. A `default` is treated as an already-resolved value and never passes through `parse`.

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const regions = ["us-east-1", "us-west-2", "eu-west-1"];
const stacks = ["alpha", "beta", "gamma"];

const cli = createCLI({ name: "infra", version: "2.0.0", prompt: "infra> " });

const inspect = (stack: string): Promise<string> =>
  new Promise((resolve) => setTimeout(() => resolve(stack), 10));

cli
  .command("plan [stack]")
  .description("Preview the changes for a stack")
  .option("--since <date>", {
    type: "string",
    description: "Only consider changes after this date (YYYY-MM-DD)",
    parse: (value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${value}`);
      return date;
    },
  })
  .option("--region <region>", {
    type: "string",
    default: "us-east-1",
    completer: regions,
    description: "Target region",
  })
  .option("--cache", {
    type: "boolean",
    default: true,
    description: "Reuse the cached plan",
  })
  .completer((ctx) => stacks.filter((name) => name.startsWith(ctx.current)))
  .onCancel((ctx) => {
    ctx.stderr.write("plan cancelled; nothing was written\n");
  })
  .action(async (ctx) => {
    const { since } = ctx.options;
    ctx.stdout.write(`stack:  ${ctx.args.stack ?? "(all)"}\n`);
    ctx.stdout.write(`region: ${ctx.options.region}\n`);
    ctx.stdout.write(`since:  ${since ? since.toISOString() : "(beginning)"}\n`);
    ctx.stdout.write(`cache:  ${ctx.options.cache ? "on" : "off"}\n`);

    const targets = ctx.args.stack ? [ctx.args.stack] : stacks;
    for (const target of targets) {
      if (ctx.signal.aborted) return;
      await inspect(target);
    }
    ctx.stdout.write("no changes\n");
  });

await cli.start();
```

```text
$ infra plan alpha --since 2026-05-09 --no-cache
stack:  alpha
region: us-east-1
since:  2026-05-09T00:00:00.000Z
cache:  off
no changes

$ infra plan
stack:  (all)
region: us-east-1
since:  (beginning)
cache:  on
no changes

$ infra plan --since nope
Error: Invalid value "nope" for --since: not a date: nope

  Usage: plan [stack] [options]
```

A failing `parse` is wrapped in a `ValidationError` naming the option. The generated help lists the defaults and the negated form of every boolean:

```text
$ infra help plan
Usage: plan [stack] [options]

Preview the changes for a stack

Arguments:
  stack

Options:
      --since <date>       Only consider changes after this date (YYYY-MM-DD)
      --region <region>    Target region (default: "us-east-1")
      --cache              Reuse the cached plan (default: true) (negate with --no-cache)
  -h, --help               Show help for this command
```

Tab completion works at the tool's own prompt: `.completer(...)` supplies the positional candidates, and the option's `completer` supplies the values of `--region`.

```text
infra> plan a<TAB>
infra> plan alpha
infra> plan alpha --region eu<TAB>
infra> plan alpha --region eu-west-1
```

The cancel handler runs when Ctrl-C interrupts the command, before the framework prints its own hint. `ctx.signal` is aborted by then, which is why the action's loop can also stop on its own:

```text
$ infra plan
stack:  (all)
region: us-east-1
since:  (beginning)
cache:  on
^Cplan cancelled; nothing was written

Interrupted. Press Ctrl-C again to force quit.
```

The handler alone does not stop running code — an action that never checks `ctx.signal` keeps going until it finishes, and a second Ctrl-C force-quits the process with status 130.

Condensed from [`10-advanced-api.ts`](../../examples/10-advanced-api.ts). See [Options](options.md) and [Interactive shell](interactive-shell.md).

## Testing a CLI with in-memory streams

`cli.exec(argv, { stdout, stderr })` runs a command against streams of the caller's choosing, which is what makes a CLI testable without spawning a process. It takes an array of arguments and never interprets them as shell syntax; `cli.execLine(line, options)` takes the same options and one line of text with quoting and pipes. `stdin` defaults to `null`, `stdout` to `process.stdout` and `stderr` to `process.stderr`, so a test supplies at least `stdout`.

```typescript
import { PassThrough } from "node:stream";
import { createCLI, type CLI } from "@libraz/node-cli";

function buildCli(): CLI {
  const cli = createCLI({ name: "calc" });
  cli
    .command("add <a> <b>")
    .description("Add two numbers")
    .action((ctx) => {
      ctx.stdout.write(`${Number(ctx.args.a) + Number(ctx.args.b)}\n`);
    });
  return cli;
}

function collect(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { stream, text: () => Buffer.concat(chunks).toString() };
}

const out = collect();
const err = collect();

await buildCli().exec(["add", "2", "40"], { stdout: out.stream, stderr: err.stream });

console.log(JSON.stringify(out.text())); // "42\n"
console.log(JSON.stringify(err.text())); // ""
```

A failure rejects the returned promise after the `commandError` and `error` events have fired, and the thrown value carries the machine-readable code and exit code. Continuing the program above:

```typescript
import { CLIError } from "@libraz/node-cli";

try {
  await buildCli().exec(["add", "1"], { stdout: out.stream, stderr: err.stream });
} catch (error) {
  if (error instanceof CLIError) {
    console.log(error.code); // "MISSING_ARGUMENT"
    console.log(error.exitCode); // 64
  }
}
```

Three details matter when writing tests this way:

- `ctx.shell` is `null` under `exec` and `execLine`, so a command that opens a mode must guard for it. Test the guard, not the mode.
- `exec` and `execLine` do not emit the `exit` event on the normal path; only `cli.start(argv)` does, and it resolves to the exit code. An assertion on `exit` needs `start(argv)`.
- Colour from `createColorizer`, the logger and `progress` is decided from the stream they are bound to, and a `PassThrough` is not a terminal, so that output is plain. `color` and `colorTag` follow `process.stdout` instead. Call `setColorEnabled(true)` when the escape codes themselves are what is being asserted, and `setColorEnabled("auto")` afterwards.

A fresh `CLI` per test keeps registrations from leaking between cases; `cli.start(argv)` throws if called twice on one instance.

## Where to go next

- [Getting started](getting-started.md) — from an empty directory to an installed command.
- [Commands](commands.md) and [Options](options.md) — the definition surface in full.
- [Interactive shell](interactive-shell.md) — history, completion, pipes and modes.
- [API reference](api-reference.md) — every export, with its signature and defaults.

# node-cli

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/node-cli/ci.yml?branch=main&label=CI)](https://github.com/libraz/node-cli/actions)
[![npm](https://img.shields.io/npm/v/@libraz/node-cli)](https://www.npmjs.com/package/@libraz/node-cli)
[![codecov](https://codecov.io/gh/libraz/node-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/node-cli)
[![License](https://img.shields.io/github/license/libraz/node-cli)](https://github.com/libraz/node-cli/blob/main/LICENSE)

Zero-dependency, batteries-included CLI framework for Node.js / TypeScript.

## Overview

**node-cli** is a lightweight interactive CLI shell framework that provides everything you need to build rich command-line applications — with no external production dependencies.

| Feature | node-cli | Commander | Vorpal |
|---------|---------|-----------|--------|
| Interactive Shell (REPL) | Yes | No | Yes |
| Subcommand Hierarchy | Yes | Yes | Yes |
| Tab Completion | Yes | No | Yes |
| Color Output | Built-in | External | External |
| Table Display | Built-in | External | External |
| Progress Bar / Spinner | Built-in | External | External |
| Interactive Prompts | Built-in | External | External |
| Logger | Built-in | External | External |
| Pipe Commands | Yes | No | Yes |
| Plugin System | Yes | No | Yes |
| Event System | Yes | No | Yes |
| Zero Dependencies | Yes | Yes | No |
| TypeScript-first | Yes | Partial | No |
| ESM-first | Yes | Yes | No |

## Installation

```bash
# npm
npm install @libraz/node-cli

# yarn
yarn add @libraz/node-cli

# pnpm
pnpm add @libraz/node-cli
```

## Quick Start

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });

cli
  .command("greet <name>")
  .description("Greet someone")
  .option("-u, --uppercase", { type: "boolean" })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const msg = ctx.options.uppercase ? name.toUpperCase() : name;
    ctx.stdout.write(`Hello, ${msg}!\n`);
  });

cli.start();
```

**Direct mode:**

```bash
$ myapp greet World --uppercase
Hello, WORLD!
```

**Interactive shell mode:**

```bash
$ myapp
myapp v1.0.0
> greet World
Hello, World!
> exit
```

## Features

### Command System

Fluent API for defining commands with arguments, options, aliases, validation, and subcommands.

```typescript
cli
  .command("deploy <env>")
  .alias("d")
  .description("Deploy to environment")
  .option("-t, --tag <tag>", { type: "string", required: true })
  .option("--force", { type: "boolean" })
  .validate((ctx) => {
    if (!["prod", "staging"].includes(ctx.args.env as string)) {
      throw new Error("Invalid environment");
    }
  })
  .action(async (ctx) => {
    ctx.stdout.write(`Deploying ${ctx.options.tag} to ${ctx.args.env}...\n`);
  });
```

### Subcommands

```typescript
const user = cli.command("user").description("User management");
user.command("create <name>").action(/* ... */);
user.command("delete <name>").action(/* ... */);
```

### Color Output

Proxy-based chainable color API with zero-dependency ANSI support.

```typescript
import { color, c } from "@libraz/node-cli";

console.log(color.bold.green("Success!"));
console.log(c`{red.bold Error}: Something went wrong`);
```

### Table Display

```typescript
import { table } from "@libraz/node-cli";

const data = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(data, { border: "rounded", headerStyle: "bold" }));
```

### Progress Indicators

```typescript
import { progress } from "@libraz/node-cli";

// Progress bar
const bar = progress.bar({ total: 100, label: "Downloading" });
bar.update(50); // 50%
bar.finish();

// Spinner
const spinner = progress.spinner({ label: "Processing..." });
spinner.start();
spinner.succeed("Done!");
```

### Interactive Prompts

```typescript
import { prompt } from "@libraz/node-cli";

const name = await prompt.text("Your name:");
const sure = await prompt.confirm("Are you sure?");
const env = await prompt.select("Environment:", ["dev", "staging", "prod"]);
```

### Logger

```typescript
import { logger } from "@libraz/node-cli";

const log = logger({ prefix: "app", timestamp: true });
log.info("Server started on port %d", 3000);
log.success("Deployment complete");
log.error("Connection failed");

const db = log.child("db");
db.debug("Query executed in 12ms");
```

### Event System

```typescript
cli.on("beforeExecute", (ctx) => {
  console.log(`Running: ${ctx.commandPath.join(" ")}`);
});

cli.on("commandError", (error, ctx) => {
  console.error(`Command failed: ${error.message}`);
});
```

### Plugin System

```typescript
function timestampPlugin(ctx) {
  ctx.on("beforeExecute", (cmdCtx) => {
    cmdCtx.stdout.write(`[${new Date().toISOString()}] `);
  });
}

cli.use(timestampPlugin);
```

### Pipe Commands

```typescript
// In interactive shell
> produce | transform | consume
```

### Mode Sub-REPL

```typescript
cli.command("sql").action((ctx) => {
  ctx.shell?.enterMode({
    prompt: "sql> ",
    message: "Entering SQL mode. Type 'exit' to return.",
    action: async (input, { stdout }) => {
      stdout.write(`Executing: ${input}\n`);
    },
  });
});
```

## Requirements

- Node.js >= 20
- ESM (type: "module")

## Documentation

- [Getting Started](docs/en/getting-started.md)
- [API Reference](docs/en/api.md)
- [Commands & Options](docs/en/commands.md)
- [Output Utilities](docs/en/output.md)

## License

[MIT](LICENSE)

## Author

libraz <libraz@libraz.net>

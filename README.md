# node-cli

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/node-cli/ci.yml?branch=main&label=CI)](https://github.com/libraz/node-cli/actions)
[![npm](https://img.shields.io/npm/v/@libraz/node-cli)](https://www.npmjs.com/package/@libraz/node-cli)
[![codecov](https://codecov.io/gh/libraz/node-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/node-cli)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libraz/node-cli/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js)](https://nodejs.org/)

Zero-dependency, batteries-included CLI framework for Node.js / TypeScript.

## Overview

**node-cli** is a lightweight interactive CLI shell framework that provides everything you need to build rich command-line applications — with no external production dependencies.

| Capability | Availability |
|------------|--------------|
| Interactive shell, subcommands, and tab completion | Built in |
| Color, tables, progress indicators, prompts, and logging | Built in |
| Pipes, plugins, and lifecycle events | Built in |
| Production dependencies | None |
| TypeScript and ESM | First-class support |

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
#!/usr/bin/env node
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

await cli.start();
```

Save this as `src/cli.ts`, then use a minimal ESM package setup:

```json
{
  "type": "module",
  "bin": { "myapp": "dist/cli.js" },
  "scripts": { "build": "tsc", "start": "node dist/cli.js" },
  "dependencies": { "@libraz/node-cli": "^1" },
  "devDependencies": { "@types/node": "^22", "typescript": "^6" }
}
```

Add a `tsconfig.json`. `types: ["node"]` is required: the published type declarations reference `NodeJS` and `node:stream`, so a build without it fails to resolve them.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

Run `npm run build`, run `chmod +x dist/cli.js` on POSIX, and use `npm link` (or install the package) to make `$ myapp` available.

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

const log = logger({ prefix: "app", timestamp: true, level: "debug" });
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

- Node.js >= 22
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

# @libraz/node-cli

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/node-cli/ci.yml?branch=main&label=CI)](https://github.com/libraz/node-cli/actions)
[![npm](https://img.shields.io/npm/v/@libraz/node-cli)](https://www.npmjs.com/package/@libraz/node-cli)
[![codecov](https://codecov.io/gh/libraz/node-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/node-cli)
[![License](https://img.shields.io/github/license/libraz/node-cli)](https://github.com/libraz/node-cli/blob/main/LICENSE)

Zero-dependency, batteries-included CLI framework for Node.js / TypeScript.

## Features

- Interactive shell (REPL) with history and tab completion
- Subcommand hierarchy with fluent builder API
- Built-in color, table, progress bar, spinner, prompts, logger
- Command aliases, validation, events, plugins
- Pipe command chaining, mode sub-REPL
- TypeScript-first, ESM-first, zero production dependencies

## Quick Start

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp" });

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

## Built-in Utilities

```typescript
import { color, c, table, progress, prompt, logger } from "@libraz/node-cli";

// Color
console.log(color.bold.green("Success!"));
console.log(c`{red Error}: failed`);

// Table
console.log(table([{ name: "Alice", role: "Admin" }], { border: "rounded" }));

// Progress
const bar = progress.bar({ total: 100, label: "Download" });
const spinner = progress.spinner({ label: "Loading..." });

// Prompt
const name = await prompt.text("Name:");
const ok = await prompt.confirm("Continue?");

// Logger
const log = logger({ prefix: "app", timestamp: true });
log.info("Started");
```

## Requirements

- Node.js >= 20
- ESM (`"type": "module"` in package.json)

## Documentation

Full documentation: https://github.com/libraz/node-cli

- [Getting Started](https://github.com/libraz/node-cli/blob/main/docs/en/getting-started.md)
- [API Reference](https://github.com/libraz/node-cli/blob/main/docs/en/api.md)
- [Commands & Options](https://github.com/libraz/node-cli/blob/main/docs/en/commands.md)
- [Output Utilities](https://github.com/libraz/node-cli/blob/main/docs/en/output.md)

## License

MIT

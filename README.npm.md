# @libraz/node-cli

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/node-cli/ci.yml?branch=main&label=CI)](https://github.com/libraz/node-cli/actions)
[![npm](https://img.shields.io/npm/v/@libraz/node-cli)](https://www.npmjs.com/package/@libraz/node-cli)
[![codecov](https://codecov.io/gh/libraz/node-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/node-cli)
[![License](https://img.shields.io/badge/license-MIT-blue)](https://github.com/libraz/node-cli/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=node.js)](https://nodejs.org/)

Zero-dependency, batteries-included CLI framework for Node.js / TypeScript.

Define a command once and it works two ways: as `myapp deploy prod` typed at a shell, and as `deploy prod` typed at your tool's own interactive prompt.

## What you get

- Commands, subcommands, aliases, and typed options with defaults, choices and validation
- An interactive shell with persistent history, tab completion, pipes, and mode sub-REPLs
- Colour, tables, progress bars, spinners, prompts and a logger, each usable on its own
- Lifecycle events and plugins for cross-cutting behaviour
- TypeScript and ESM first, no production dependencies

## Install

Node.js 22 or later. The package is ESM only, with no separate CommonJS build; Node.js 22.12 and later can `require()` it, and earlier 22.x releases need `await import()`. The type definitions need TypeScript 5.4 or later.

```bash
npm install @libraz/node-cli
```

## Quick start

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });

cli
  .command("greet <name>")
  .description("Greet someone")
  .option("-u, --uppercase", { type: "boolean" })
  .action((ctx) => {
    const { name } = ctx.args;
    ctx.stdout.write(`Hello, ${ctx.options.uppercase ? name.toUpperCase() : name}!\n`);
  });

await cli.start();
```

```bash
$ myapp greet World --uppercase
Hello, WORLD!

$ myapp
myapp v1.0.0
> greet World
Hello, World!
> exit
```

## Output utilities

Each of these is a plain function and works in any Node script, with or without a `CLI` instance.

```typescript
import { color, colorTag, table, progress, prompt, createLogger } from "@libraz/node-cli";

console.log(color.bold.green("Success!"));
console.log(colorTag`{red Error}: failed`);
console.log(table([{ name: "Alice", role: "Admin" }], { border: "rounded" }));

const bar = progress.bar({ total: 100, label: "Download" });
bar.update(50);
bar.succeed("Downloaded");

const spinner = progress.spinner({ label: "Loading..." });
await new Promise((resolve) => setTimeout(resolve, 500));
spinner.succeed("Loaded");

const name = await prompt.text("Name?");
const ok = await prompt.confirm("Continue?");

createLogger({ prefix: "app", timestamp: true }).info("Started");
```

## Documentation

- [Introduction](https://github.com/libraz/node-cli/blob/main/docs/en/introduction.md) — what it is and the mental model
- [Getting started](https://github.com/libraz/node-cli/blob/main/docs/en/getting-started.md) — from nothing to a working tool
- [Commands](https://github.com/libraz/node-cli/blob/main/docs/en/commands.md) · [Options](https://github.com/libraz/node-cli/blob/main/docs/en/options.md) · [Interactive shell](https://github.com/libraz/node-cli/blob/main/docs/en/interactive-shell.md)
- [API reference](https://github.com/libraz/node-cli/blob/main/docs/en/api-reference.md) · [Examples](https://github.com/libraz/node-cli/blob/main/docs/en/examples.md) · [Glossary](https://github.com/libraz/node-cli/blob/main/docs/en/glossary.md)

Japanese documentation is under [`docs/ja/`](https://github.com/libraz/node-cli/tree/main/docs/ja).

## License

[MIT](https://github.com/libraz/node-cli/blob/main/LICENSE)

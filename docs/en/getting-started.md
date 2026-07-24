# Getting Started

## Installation

```bash
# npm
npm install @libraz/node-cli

# yarn
yarn add @libraz/node-cli

# pnpm
pnpm add @libraz/node-cli
```

**Requirements:**
- Node.js >= 22
- ESM (`"type": "module"` in your package.json)

## Basic Usage

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });

cli
  .command("greet <name>")
  .description("Greet someone by name")
  .option("-u, --uppercase", { type: "boolean" })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const msg = ctx.options.uppercase ? name.toUpperCase() : name;
    ctx.stdout.write(`Hello, ${msg}!\n`);
  });

await cli.start();
```

Save the file as `src/cli.ts`. Configure ESM, build output, and the executable name in `package.json`:

```json
{
  "type": "module",
  "bin": { "myapp": "dist/cli.js" },
  "scripts": { "build": "tsc", "start": "node dist/cli.js" },
  "dependencies": { "@libraz/node-cli": "^1.3.3" },
  "devDependencies": { "@types/node": "^22", "typescript": "^6" }
}
```

Run `npm run build`, then `chmod +x dist/cli.js` on POSIX. `npm link` exposes the configured `myapp` command for local testing. Applications using the public Node stream types should install a compatible `@types/node` (22 or newer).

## Dual Execution Modes

node-cli supports two execution modes determined automatically:

```mermaid
flowchart LR
  A["cli.start()"] --> B{"process.argv<br>has args?"}
  B -- Yes --> C["Direct CLI Mode"]
  B -- No --> D{"stdin and stdout<br>are both TTY?"}
  D -- Yes --> F["Interactive Shell Mode"]
  D -- No --> J["Print help and return"]
  C --> E["Parse → Execute → Exit"]
  F --> G["REPL Loop"]
  G --> H["Read Input"]
  H --> I["Parse → Execute"]
  I --> G
  G -- "exit / quit" --> K["Exit"]
```

### Direct CLI Mode

When command-line arguments are provided:

```bash
$ myapp greet World --uppercase
Hello, WORLD!
```

### Interactive Shell Mode

When no arguments are provided and both stdin and stdout are TTYs, an interactive
REPL starts:

```bash
$ myapp
myapp v1.0.0
> greet World
Hello, World!
> help
myapp v1.0.0

Available commands:

  greet <name>    Greet someone by name
  help [...command]    Show help information

Type "help <command>" for more information.
> exit
```

With piped stdin or redirected stdout, no-argument startup prints help and
returns instead of opening a REPL.

The interactive shell provides:
- Command history (persisted to disk)
- Tab completion for commands, subcommands, options, and option values
- Built-in `help`, `exit`, and `quit` commands

## CLI Configuration

```typescript
const cli = createCLI({
  name: "myapp",         // Application name (default: "cli")
  version: "1.0.0",      // Version string
  description: "My awesome CLI tool",  // Shown in help header
  banner: "Welcome to myapp!",         // Shown when shell starts ("" to suppress)
  prompt: "myapp> ",     // Shell prompt (default: "> ")
  historyFile: ".myapp_history",  // History file path
  historySize: 500,      // Max history entries (default: 1000)
});
```

If `banner` is not set, it defaults to `"{name} v{version}"`. Set it to `""` to suppress the banner entirely.

## Defining Commands

### Simple Command

```typescript
cli
  .command("ping")
  .description("Check connectivity")
  .action((ctx) => {
    ctx.stdout.write("pong\n");
  });
```

### Command with Arguments

```typescript
// Required argument: <name>
// Optional argument: [title]
cli
  .command("greet <name> [title]")
  .action((ctx) => {
    const title = ctx.args.title ? `${ctx.args.title} ` : "";
    ctx.stdout.write(`Hello, ${title}${ctx.args.name}!\n`);
  });
```

### Variadic Arguments

```typescript
cli
  .command("copy <...files>")
  .description("Copy files")
  .action((ctx) => {
    const files = ctx.args.files as string[];
    ctx.stdout.write(`Copying: ${files.join(", ")}\n`);
  });
```

### Command with Options

```typescript
cli
  .command("serve")
  .option("-p, --port <port>", {
    type: "number",
    default: 3000,
    description: "Port to listen on",
  })
  .option("--host <host>", {
    type: "string",
    default: "localhost",
  })
  .option("--cors", {
    type: "boolean",
    description: "Enable CORS",
  })
  .action((ctx) => {
    ctx.stdout.write(`Listening on ${ctx.options.host}:${ctx.options.port}\n`);
  });
```

### Subcommands

```typescript
const db = cli.command("db").description("Database operations");

db.command("migrate")
  .description("Run migrations")
  .action(async (ctx) => {
    ctx.stdout.write("Running migrations...\n");
  });

db.command("seed")
  .description("Seed database")
  .action(async (ctx) => {
    ctx.stdout.write("Seeding database...\n");
  });
```

## Command Context

Every action handler receives a `CommandContext` object:

```typescript
interface CommandContext {
  args: Record<string, unknown>;     // Parsed positional arguments
  options: Record<string, unknown>;  // Parsed options
  rawInput: string;                  // Original input string
  commandPath: string[];             // e.g., ["db", "migrate"]
  shell: Shell | null;               // Shell instance (null in direct mode)
  stdin: Readable | null;            // stdin (available in piped commands)
  stdout: Writable;                  // stdout stream
  stderr: Writable;                  // stderr stream
  signal: AbortSignal;               // Aborted when command execution is cancelled
}
```

**Important:** Always use `ctx.stdout` and `ctx.stderr` instead of `console.log` / `process.stdout` to ensure proper output routing in pipe chains and testing.

## Next Steps

- [Commands & Options](commands.md) — Full command system reference
- [Output Utilities](output.md) — Color, table, progress, prompt, logger
- [API Reference](api.md) — Complete API documentation

# Getting started

This page goes from an empty directory to a command that can be typed at a terminal prompt. It assumes familiarity with JavaScript or TypeScript, but no experience building command-line tools. Terms that appear for the first time are defined in the [glossary](glossary.md).

## Requirements

- **Node.js 22 or newer.** Check the installed version with `node --version`.
- **An ESM project.** The package is published as ECMAScript modules only. A CommonJS project can `require()` it on Node.js 22.12 and later.
- **TypeScript 5.4 or newer**, for projects that use the type declarations, together with `@types/node`.

### What ESM means here

ECMAScript modules (ESM) are JavaScript's standard module format: files that use `import` and `export`. Node.js also supports an older format, CommonJS, which uses `require()` and `module.exports`. A single Node project has to declare which one its `.js` files are written in, and that declaration is the `"type"` field in `package.json`:

```json
{
  "type": "module"
}
```

With `"type": "module"`, every `.js` file in the project is treated as an ECMAScript module. Without it, Node treats them as CommonJS and `import` statements fail to parse.

This library publishes only ECMAScript modules and has no separate CommonJS build, so a project uses it with `import`, which requires `"type": "module"` for `.js` files. Node.js 22.12 and later can `require("@libraz/node-cli")` the ES module from CommonJS; on earlier 22.x releases a CommonJS project reaches it with a dynamic `await import("@libraz/node-cli")`, which returns a promise for the module.

## Installation

```bash
npm install @libraz/node-cli
```

```bash
yarn add @libraz/node-cli
```

```bash
pnpm add @libraz/node-cli
```

TypeScript projects also need Node's type definitions:

```bash
npm install --save-dev typescript @types/node
```

## The first command

Create `src/cli.ts`:

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });

cli
  .command("greet <name>")
  .description("Greet someone by name")
  .action((ctx) => {
    ctx.stdout.write(`Hello, ${ctx.args.name}!\n`);
  });

await cli.start();
```

Line by line:

- `#!/usr/bin/env node` is the **shebang**, explained in the next section.
- `createCLI({ ... })` builds the application object. `name` is required: it is used in help output and to derive the history file path (`~/.<name>_history`), and it must start with a letter or digit and contain only letters, digits, `.`, `_`, and `-`. `version` is optional and is what `--version` prints; without it, no version flag is defined and `--version` and `-V` are reported as unknown options. Every setting goes into this object; none can be changed after construction, and an invalid name or history setting throws here.
- `cli.command("greet <name>")` declares a command called `greet` that takes one required positional argument named `name`. Angle brackets mark it required; square brackets, as in `[name]`, would make it optional.
- `.description(...)` supplies the text that appears next to the command in generated help.
- `.action((ctx) => { ... })` registers the function that runs when the command is invoked. `ctx` is the [command context](commands.md): `ctx.args` holds the positional arguments keyed by name, `ctx.options` holds the parsed options, and `ctx.stdout` is the stream to write results to.
- `ctx.args.name` is typed `string`. The type comes from the definition string: `<name>` is a `string`, `[name]` is `string | undefined`, and `<...name>` is a `readonly string[]`. Positional arguments are never converted, so a numeric value is parsed in the action. Keys are camelCase: `<file-name>` is read as `ctx.args.fileName`.
- `await cli.start()` hands control to the library. It reads the terminal arguments, picks an execution mode, runs the matching command, and resolves to the exit code.

Write to `ctx.stdout` rather than calling `console.log`. `ctx.stdout` is the stream belonging to the current execution, which is what makes the same command work when its output is piped into another command inside the interactive shell, and what makes it testable by passing a substitute stream.

## Setting up the project

### The shebang line

`#!/usr/bin/env node` is the first line of an executable script on macOS and Linux. When the file is run directly, the operating system reads this line and runs the named program with the file as its argument — here, `env node`, which locates `node` on the current `PATH`. Without it, the shell would try to interpret the JavaScript as shell commands.

The line is a comment as far as JavaScript is concerned, so it is harmless to leave in a file that is also imported. TypeScript preserves it in the compiled output. On Windows it is ignored; npm generates a wrapper script there instead.

### The `bin` entry in `package.json`

`bin` maps a command name to the file that implements it. This is what turns a JavaScript file into something typed as a word at a terminal prompt:

```json
{
  "name": "myapp",
  "version": "1.0.0",
  "type": "module",
  "bin": { "myapp": "dist/cli.js" },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@libraz/node-cli": "^2"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^7"
  }
}
```

When the package is installed — globally, or linked as described below — npm creates an entry named `myapp` in a directory that is on the `PATH`, pointing at `dist/cli.js`. Typing `myapp` then runs that file. The key (`myapp`) is the command name and can differ from the package name; the value is the path to the built file, not the TypeScript source.

### `tsconfig.json`

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

- `module` and `moduleResolution` set to `Node16` tell TypeScript to resolve imports the way Node does for an ESM package, which is what makes `import { createCLI } from "@libraz/node-cli"` resolve to the published entry point.
- `outDir` and `rootDir` put compiled JavaScript in `dist/` mirroring the layout of `src/`, so `src/cli.ts` becomes `dist/cli.js` — the path named in `bin`.
- `"types": ["node"]` is required. The published type declarations import `node:stream` and use the `AbortSignal` and `Symbol.dispose` globals, all of which `@types/node` provides. Without Node's type definitions loaded, those references do not resolve and the build fails with errors about unknown names. Install `@types/node` for Node 22 or newer.

### Building

```bash
npm run build
```

This compiles `src/cli.ts` to `dist/cli.js`.

### Making the file executable

On macOS and Linux, a file must carry the executable permission bit before the operating system will run it directly:

```bash
chmod +x dist/cli.js
```

npm sets this bit automatically for files listed in `bin` when a package is installed, so this step matters mainly when running `./dist/cli.js` by hand during development. Windows does not use permission bits and needs nothing here.

### Linking it for local testing

`npm link`, run in the project directory, installs a global symbolic link so the `bin` entries resolve as if the package had been installed from the registry:

```bash
npm link
```

`myapp` is now available anywhere on the system. It points at the working copy, so rebuilding is enough to pick up a change — there is no need to link again.

To remove the link:

```bash
npm unlink -g myapp
```

The name passed to `npm unlink -g` is the **package** name from `package.json`, which is not necessarily the same as the command name in `bin`.

## Running it

`cli.start()` decides what to do based on the arguments it receives and on whether the process is attached to a terminal.

![Decision tree used by cli.start: plugins are awaited first, then the argument list is examined; an argument list that is present but empty prints the help index, a non-empty list runs one command in direct mode, and an empty list opens the interactive shell when both standard input and standard output are terminals, or prints the help index otherwise.](../assets/execution-modes.svg)

In order:

1. Any registered plugins are awaited. A plugin that throws is fatal: the error is reported, the `exit` event fires, and no command runs.
2. The argument list is `process.argv.slice(2)` — everything typed after the command name — unless an array was passed to `cli.start()` explicitly.
3. If arguments were supplied but none of them carries content (all empty strings, or exactly the end-of-options marker `--`), the help index is printed and `cli.start()` resolves to 0.
4. If there is at least one argument, that one command runs. This is **direct mode**.
5. If there are no arguments and both standard input and standard output are terminals, the **interactive shell** opens.
6. Otherwise — no arguments, with output piped or input redirected — the help index is printed and `cli.start()` resolves to 0. No prompt is opened, because there is no terminal to prompt on.

For a direct-mode failure or interruption, the library sets `process.exitCode` rather than calling `process.exit()`, so pending output is flushed and any `exit` event handler gets to run. A successful direct-mode command leaves the exit code unchanged. Either way, `cli.start()` resolves to the code the process will exit with (0 when none is set), so a caller can read it without inspecting `process.exitCode`. The exceptions are a force-quit (a second interrupt, exit code 130) and the interactive shell's shutdown on a termination signal (exit code 143). A direct-mode command interrupted with Ctrl-C exits with code 130. See [Errors](errors.md) for the full list.

### Direct mode

```
$ myapp greet World
Hello, World!
```

An unknown command reports the failure on standard error and exits with code 64, the code for a mistake in what was typed:

```
$ myapp greetings World
Error: Command not found: "greetings"
Available commands: greet, help
```

A missing required argument is reported the same way, with the command's usage line attached:

```
$ myapp greet
Error: Missing required argument: <name>

  Usage: greet <name> [options]
```

### Interactive shell

With no arguments in a terminal, the tool opens its own prompt:

```
$ myapp
myapp v1.0.0
> greet World
Hello, World!
> help
myapp v1.0.0

Available commands:

  greet <name>         Greet someone by name
  help [...command]    Show help information

Options:
  -h, --help       Show help
  -V, --version    Show the CLI version

Shell commands: exit, quit
Type "help <command>" for more information.
> exit
$
```

The first line is the **banner**. It defaults to the application name and version; `banner: ""` in `createCLI` suppresses it.

Inside the shell, the Up and Down arrow keys move through previous lines, which are saved to `~/.myapp_history` between sessions, and Tab completes command names, subcommands, option flags, and option values. `exit` and `quit` end the session; they are handled by the shell itself rather than being registered commands. `help` is a normal command, so it works in direct mode too. More in [Interactive shell](interactive-shell.md).

### Piped or redirected output

With no arguments and output going somewhere other than a terminal, the help index is printed instead of a prompt being opened:

```
$ myapp | less
myapp v1.0.0

Available commands:

  greet <name>         Greet someone by name
  help [...command]    Show help information

Options:
  -h, --help       Show help
  -V, --version    Show the CLI version

Type "help <command>" for more information.
```

This is deliberate: an interactive prompt written into a pipe would hang waiting for input that never arrives. The same applies to `myapp > out.txt` and to running the tool from a script or a CI job.

## Growing the tool

### A second command

Commands are registered by calling `cli.command(...)` again. A command with no positional arguments needs only a name:

```typescript
cli
  .command("ping")
  .description("Check that the tool responds")
  .action((ctx) => {
    ctx.stdout.write("pong\n");
  });
```

```
$ myapp ping
pong
```

### An option

An **option** is a named, order-independent input written with a leading dash, such as `--uppercase`. Declare one with `.option()`, giving the flags and a schema:

```typescript
cli
  .command("greet <name>")
  .description("Greet someone by name")
  .option("-u, --uppercase", {
    type: "boolean",
    description: "Shout the greeting",
  })
  .action((ctx) => {
    const { name } = ctx.args;
    ctx.stdout.write(`Hello, ${ctx.options.uppercase ? name.toUpperCase() : name}!\n`);
  });
```

`"-u, --uppercase"` declares a long form and a short alias for the same option. In `ctx.options` the value is always found under the camelCase form of the long name — `ctx.options.uppercase` — never under the alias. A name with a dash is joined: `--dry-run` is read as `ctx.options.dryRun`. When a flags string has several long names, the first is the one used for the key.

```
$ myapp greet World --uppercase
Hello, WORLD!
$ myapp greet World -u
Hello, WORLD!
$ myapp greet World
Hello, World!
```

A boolean option also accepts a negated form, so `--no-uppercase` sets it to `false`. Options can take values, carry defaults, be restricted to a list of choices, or be marked required; see [Options](options.md).

### A subcommand

Calling `.command()` on a command builder nests the new command underneath it. A group with no action of its own becomes a namespace:

```typescript
const db = cli.command("db").description("Database commands");

db.command("migrate")
  .description("Apply pending migrations")
  .action((ctx) => {
    ctx.stdout.write("Migrations applied.\n");
  });
```

```
$ myapp db migrate
Migrations applied.
```

The generated help follows the nesting:

```
$ myapp help db
Usage: db <command> [options]

Database commands

Options:
  -h, --help    Show help for this command

Commands:
  migrate    Apply pending migrations

Type "help db <command>" for more information.
```

A group command has no action of its own, so invoking `myapp db` with no subcommand prints that same help page. See [Commands](commands.md) for nesting rules and aliases.

## Adding output polish

The output helpers are plain functions exported from the same package. They do not need a `CLI` instance and can be used in any Node script.

### Logging

`createLogger()` creates a levelled logger. It writes to standard error by default, which keeps diagnostic output separate from the data a command produces on standard output — so `myapp export > data.json` captures only the data.

```typescript
import { createLogger } from "@libraz/node-cli";

const log = createLogger({ prefix: "myapp" });

log.info("Starting up");
log.success("Finished in 1.2s");
log.error("Could not reach the server");
```

```
ℹ [myapp] Starting up
✔ [myapp] Finished in 1.2s
✖ [myapp] Could not reach the server
```

When the stream is not a terminal, the glyphs are replaced with plain labels (`[INFO]`, `[OK]`, `[ERROR]`) so the output stays readable in a log file. Levels, timestamps, and child loggers are covered in [Logging](logging.md).

### Tables

`table()` returns a formatted string; it does not print anything itself.

```typescript
import { table } from "@libraz/node-cli";

const rows = [
  { name: "alpha", status: "ready", size: 128 },
  { name: "beta", status: "pending", size: 4096 },
];

process.stdout.write(`${table(rows, { border: "rounded" })}\n`);
```

```
╭───────┬─────────┬──────╮
│ name  │ status  │ size │
├───────┼─────────┼──────┤
│ alpha │ ready   │ 128  │
│ beta  │ pending │ 4096 │
╰───────┴─────────┴──────╯
```

Column selection, alignment, widths, and border styles are covered in [Tables](table.md).

## Next steps

- [Commands](commands.md) — the full command definition syntax, aliases, validation, and cancellation.
- [Options](options.md) — types, defaults, choices, required options, and custom parsing.
- [Interactive shell](interactive-shell.md) — history, tab completion, pipes, and modes.
- [Colour](color.md), [Tables](table.md), [Progress](progress.md), [Prompts](prompts.md), [Logging](logging.md) — the output toolkit.
- [Errors](errors.md) — how failures are reported and which exit code each produces.
- [Events and plugins](events-and-plugins.md) — lifecycle hooks and packaging command sets.
- [Examples](examples.md) — complete working programs.
- [API reference](api-reference.md) — every export with its signature.

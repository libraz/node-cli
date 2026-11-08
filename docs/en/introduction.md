# Introduction

`@libraz/node-cli` is a framework for building command-line tools in Node.js and TypeScript. It parses arguments, routes them to command handlers, generates help text, and — from the same command definitions — can open an interactive prompt inside the tool itself. It ships with an output toolkit for colour, tables, progress indicators, interactive questions, and logging. It has no runtime dependencies: installing it adds one package to the dependency tree, not a subtree.

## Who it is for

The library targets anyone writing a tool that is invoked from a terminal: a build script, a deployment helper, a database console, a project scaffolder. No prior experience building command-line tools is assumed. [Getting started](getting-started.md) walks from an empty directory to an installed command.

## Architecture

![Architecture of the library: a CLI entry object holding a command layer of commands, subcommands, options, and help; two input paths feeding that layer, one from terminal arguments and one from the interactive shell; and a separate output toolkit of colour, table, progress, prompt, and logger that any Node script can import on its own.](../assets/architecture.svg)

The figure shows three parts.

**The application object.** `createCLI()` returns the application object. Its name, version, description, prompt string, banner, and history settings are all passed to `createCLI()` and are fixed from then on, and the object owns the registry every command is registered into. `cli.start()` is the single point where control is handed to the library.

**The command layer.** Each `cli.command(...)` call defines one command: its name, its positional arguments, its options, and the function that runs when it is invoked. Commands can nest into subcommands, so `myapp db migrate` is a `migrate` command under a `db` group. Help text for every command and subcommand is generated from these definitions, so there is no separate usage string to keep in sync. See [Commands](commands.md) and [Options](options.md).

**The output toolkit.** `color`, `c`, `table`, `progress`, `prompt`, and `createLogger` are ordinary exports. They do not read from a CLI object and do not need one to exist. A script that only wants to print an aligned table can import `table` alone:

```typescript
import { table } from "@libraz/node-cli";

const rows = [
  { name: "alpha", status: "ready" },
  { name: "beta", status: "pending" },
];

process.stdout.write(`${table(rows, { border: "rounded" })}\n`);
```

The toolkit pages are [Colour](color.md), [Tables](table.md), [Progress](progress.md), [Prompts](prompts.md), and [Logging](logging.md).

## One definition, two ways to run it

This is the design idea the rest of the library follows from. A command is defined once, and the same definition is reachable two ways: as an argument on the terminal command line, and as a line typed at the tool's own prompt.

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

Run with an argument, the command executes once and the process ends:

```
$ myapp greet World
Hello, World!
```

Run with no arguments in a terminal, the tool opens its own prompt and the same command is typed as a line of input:

```
$ myapp
myapp v1.0.0
> greet World
Hello, World!
> exit
```

The first form is called *direct mode*; the second is the *interactive shell*. `cli.start()` chooses between them automatically — the rules are in [Getting started](getting-started.md), and the shell's own features are in [Interactive shell](interactive-shell.md).

## What is included

| Capability | Summary |
| --- | --- |
| Commands and subcommands | Nested command trees with aliases, hidden commands, and per-command validation. |
| Positional arguments | Required, optional, and variadic (multi-value) arguments declared in the command string. `ctx.args` and `ctx.options` are typed from the definition. |
| Options | Long and short forms, type coercion to number or boolean, defaults, required options, restricted choices, custom parsing and validation. |
| Generated help | A command index and a per-command page, built from the definitions. |
| Interactive shell | A prompt inside the tool, with persistent history, a history filter for secrets, and tab completion. |
| Pipes | Inside the shell, one command's output can be fed into another command's input. |
| Modes | A command can hand the shell over to a sub-prompt with its own handler and completion. |
| Colour | Named styles, chained styles, a tagged-template syntax, and automatic disabling when output is not a terminal. |
| Tables | Aligned columns with border presets, per-column width and alignment, and correct width for East Asian and emoji text. |
| Progress | Progress bars, multi-bar groups, and spinners. |
| Prompts | Text, confirmation, single select, multi-select, and masked password input. |
| Logging | Levelled logging with prefixes, timestamps, child loggers, and stream backpressure handling. |
| Events | Hooks that fire before and after execution, on error, and on exit. |
| Plugins | A function that receives a context and registers commands, events, or a fallback handler. |

## What it does not do

- **No runtime dependencies, and no plugin ecosystem to install.** Everything above is in the one package; anything not listed has to be written by hand.
- **ESM only.** The package publishes ECMAScript modules. It is loaded with `import`. There is no separate CommonJS build: Node.js 22.12 and later can `require("@libraz/node-cli")`, and earlier 22.x releases need `await import("@libraz/node-cli")`. See [ESM](glossary.md#esm-ecmascript-modules).
- **Node 22 or newer.** Older Node versions are not supported.
- **No configuration-file loading.** The library does not look for a `.myapprc`, a `myapp.config.js`, or environment-variable overrides. Reading configuration is the application's job.
- **No completion scripts for external shells.** Tab completion works inside the interactive shell. The library does not generate bash, zsh, or fish completion scripts, so pressing Tab at a system shell prompt completes filenames, not the tool's commands.
- **No translation of built-in messages.** Generated help, error messages, and prompt labels are English. Application-supplied text is used verbatim, so command descriptions can be written in any language.
- **No type coercion for positional arguments.** Options can be declared as numbers or booleans; positional arguments are always strings (or an array of strings when variadic). Converting them is the action handler's job.
- **No default command.** Every invocation names a command; there is no handler that runs when the first argument matches nothing. A [fallback handler](events-and-plugins.md) can catch unmatched input, but it does not receive parsed arguments.
- **No text wrapping inside table cells.** A cell that exceeds its column width is truncated with an ellipsis rather than wrapped onto a second line.

## Where to go next

- [Getting started](getting-started.md) — from an empty directory to an installed command, with every project file explained.
- [Commands](commands.md) — the command definition string, arguments, subcommands, aliases, validation, and cancellation.
- [Options](options.md) — the option schema: types, defaults, aliases, choices, custom parsing and validation.
- [Interactive shell](interactive-shell.md) — the prompt, history, tab completion, pipes, and modes.
- [Colour](color.md) — the `color` proxy, the `c` template tag, and terminal-width helpers.
- [Tables](table.md) — rendering aligned tabular output.
- [Progress](progress.md) — progress bars, multi-bar groups, and spinners.
- [Prompts](prompts.md) — asking the user questions from inside a command.
- [Logging](logging.md) — levelled logging to stderr.
- [Events and plugins](events-and-plugins.md) — lifecycle events, fallback handlers, and packaging command sets as plugins.
- [Errors](errors.md) — the error classes, how failures are reported, and which exit code each produces.
- [Examples](examples.md) — complete working programs.
- [API reference](api-reference.md) — every export, with its full signature.
- [Glossary](glossary.md) — terms used throughout these pages.

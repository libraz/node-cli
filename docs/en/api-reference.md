# API reference

Every public code symbol is exported from the package root. The only subpath export is `./package.json`, for reading package metadata.

```typescript
import { createCLI, table, progress, prompt, createLogger } from "@libraz/node-cli";
```

The package is ESM only and requires Node 22 or newer.

## Contents

- [Type-only exports](#type-only-exports)
- [Creating a CLI](#creating-a-cli)
- [Defining commands](#defining-commands)
- [Chaining and repeated calls](#chaining-and-repeated-calls)
- [Execution context](#execution-context)
- [Options](#options)
- [Events and plugins](#events-and-plugins)
- [Interactive shell](#interactive-shell)
- [Colour and terminal text](#colour-and-terminal-text)
- [Tables](#tables)
- [Progress](#progress)
- [Prompts](#prompts)
- [Logging](#logging)
- [Errors](#errors)
- [Low-level parsing helper](#low-level-parsing-helper)
- [Environment variables](#environment-variables)
- [Export index](#export-index)

## Type-only exports

Some exports are TypeScript types, not values. They exist for annotating variables and are erased at runtime: `import { Shell } from "@libraz/node-cli"` fails, and a `Shell` cannot be constructed. `createCLI` is the only way to obtain a CLI, and `CLI` and `CommandBuilder` are types for annotating what it returns.

The type-only exports are `CLI`, `CommandBuilder`, `Shell`, `ModeConfig`, `ModeContext`, `Action`, `CancelHandler`, `CommandValidator`, `Completer`, `CompletionContext`, `FallbackHandler`, `FallbackContext`, `HistoryFilter`, `CLIEventHandler`, `CLIEventMap`, `CLIOptions`, `CommandContext`, `CommandStreams`, `StdioOptions`, `OptionSchema`, `Plugin`, `PluginContext`, `CLIErrorCode`, `BuiltinCLIError`, `UsageErrorCode`, `StyleName`, `StyleSpec`, `ColorFn`, `ColorProxy`, `AnsiSegment`, `SanitizeTerminalTextOptions`, `ColumnSpec`, `TableChars`, `TableOptions`, `Bar`, `BarOptions`, `BarState`, `MultiBar`, `MultiBarOptions`, `Spinner`, `SpinnerOptions`, `PromptOptions`, `TextOptions`, `ConfirmOptions`, `SelectOptions`, `MultiselectOptions`, `PasswordOptions`, `Choice`, `SelectChoice`, `Logger`, `LoggerOptions` and `LogLevel`.

The running `Shell` is reached through `ctx.shell` inside a command action.

```typescript
import type { CLI, CommandContext, Shell } from "@libraz/node-cli";

function register(cli: CLI): void {
  cli.command("repl").action((ctx: CommandContext) => {
    const shell: Shell | null = ctx.shell;
    shell?.setPrompt("app> ");
  });
}
```

## Creating a CLI

### `createCLI`

```typescript
function createCLI(options?: CLIOptions): CLI
```

Constructs a `CLI`. It is the only entry point; the class itself is not exported as a value.

### `CLI`

```typescript
interface CLI {
  command(definition: string): CommandBuilder; // A and O are inferred from a literal definition
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
  use(plugin: Plugin): this;
  exec(input: string | readonly string[], options?: StdioOptions): Promise<void>;
  start(argv?: readonly string[]): Promise<number>;
}
```

| Method | Description |
| --- | --- |
| `command` | Registers a command from a definition string and returns a [`CommandBuilder`](#commandbuilder). |
| `on` / `off` | Adds or removes a lifecycle listener. See [`CLIEventMap`](#clieventmap). |
| `fallback` | Sets the handler invoked when no command matches the input. Only one handler is held; a later call replaces it. |
| `use` | Registers a plugin. Plugin bodies run in registration order. A synchronous plugin runs inside the call, and a synchronous throw propagates to the caller. An asynchronous plugin is awaited before the first command runs, and its failure makes every later `start`, `exec` and `use` fail. |
| `exec` | Runs input programmatically. See [Programmatic execution](#programmatic-execution). |
| `start` | Runs the CLI and resolves to the exit code. See [start](#start). |

#### `CLIOptions`

Every field is read once, when `createCLI` is called. There is no setter; `ctx.shell?.setPrompt(...)` changes the prompt of a running shell.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | `"cli"` | Application name, used in the help header, the default banner, and the default history path. |
| `version` | `string` | — | Version string. When set, `--version` and `-V` are recognised as the sole token, and the help index lists them. |
| `prompt` | `string` | `"> "` | Prompt string for the interactive shell. |
| `description` | `string` | — | One-line description shown in the help header. |
| `banner` | `string` | `"<name> v<version>"`, or `"<name>"` when no version | Text printed when the interactive shell starts. Set to `""` to suppress it. |
| `historyFile` | `string` | `~/.<name>_history` | Path the interactive shell persists its history to. A lone `~` and a leading `~/` expand to the home directory. |
| `historySize` | `number` | `1000` | Maximum retained history entries. |
| `historyFilter` | [`HistoryFilter`](#historyfilter) | — | Rewrites a line before it is persisted. Return `null` to omit the line entirely. |

An empty or non-string `historyFile`, a non-number `historySize` and a non-function `historyFilter` throw a `TypeError` with code `ERR_INVALID_ARG_TYPE`. A `historySize` that is not a non-negative safe integer throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

##### `HistoryFilter`

```typescript
type HistoryFilter = (line: string) => string | null
```

Redacts or rejects a line before it is written to the history file. It is synchronous because history is written with synchronous I/O.

#### start

```typescript
start(argv?: readonly string[]): Promise<number>
```

`argv` defaults to `process.argv.slice(2)`. The mode is chosen from what it contains.

| Input | Behaviour |
| --- | --- |
| One or more arguments | Direct mode: the arguments are dispatched as one command, then `exit` is emitted. |
| Arguments that contain no command (only empty strings, or a lone `--`) | The help index is printed, then `exit` is emitted. |
| No arguments, and both stdin and stdout are terminals | The interactive shell starts. `exit` is emitted when the shell ends. |
| No arguments, and either stream is not a terminal | The help index is printed, then `exit` is emitted. |

The promise resolves to the exit code, which is also set on `process.exitCode`. After an interactive session it resolves to the value `process.exitCode` holds at that point, or `0` when unset. A failure is written to stderr and reflected in the exit code rather than rejected. See [Errors](errors.md).

A second call on the same instance throws an error with code `ERR_ALREADY_STARTED`. An `argv` that is not an array of strings throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.

In direct mode the arguments arrive as an array, so they are never re-tokenized and a `|` character is an ordinary argument value. Pipelines exist only for string input — see the next section and [Interactive shell](interactive-shell.md).

#### Programmatic execution

```typescript
exec(input: string | readonly string[], options?: StdioOptions): Promise<void>
```

Runs `input` as if it had been typed at the interactive prompt. A string is tokenized, and a top-level `|` splits it into a pipeline whose stages run concurrently. An array is used as argv as is, so it is never tokenized or split. `""` and `[]` resolve without doing anything. Input that is neither a string nor an array of strings throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.

This method does **not** emit the `exit` event on the normal path. Only `start` does, plus the force-quit path that terminates the process. A rejection propagates the error to the caller after the `commandError` and `error` events have fired.

`ctx.shell` is always `null` here, so a command that reaches for `ctx.shell.enterMode(...)` must guard for it.

##### `StdioOptions`

```typescript
type StdioOptions = Partial<CommandStreams>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `stdin` | `Readable \| null` | `null` | Stream exposed as `ctx.stdin` to the first pipeline stage. |
| `stdout` | `Writable` | `process.stdout` | Stream exposed as `ctx.stdout` to the last stage. |
| `stderr` | `Writable` | `process.stderr` | Stream exposed as `ctx.stderr` to every stage. |
| `signal` | `AbortSignal` | — | External cancellation. Aborting it aborts `ctx.signal` and invokes the command's `onCancel` handler. See [AbortSignal](glossary.md#abortsignal). |

A [`CommandContext`](#commandcontext) is assignable to `StdioOptions`, so an action can run a nested command on its own streams and signal:

```typescript
cli.command("release").action(async (ctx) => {
  await cli.exec(["build", "--production"], ctx);
});
```

A worked in-memory example is in [Examples](examples.md).

### `FallbackHandler`

```typescript
type FallbackHandler = (input: string, ctx: FallbackContext) => void | Promise<void>
```

Receives the raw input when no command matches it. Input that cannot be tokenized, such as an unclosed quote, reaches the handler as well instead of throwing.

### `FallbackContext`

```typescript
interface FallbackContext extends CommandStreams {}
```

No command was resolved, so the context carries only the execution's streams and signal.

## Defining commands

### `CommandBuilder`

Returned by `cli.command(...)`, `builder.command(...)` and a plugin context's `command(...)`. `A` and `O` are the types of `ctx.args` and `ctx.options` that the handlers receive.

```typescript
class CommandBuilder<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> {
  description(text: string): this;
  hidden(hidden?: boolean): this;
  option(flags: string, schema?: OptionSchema): CommandBuilder<A, O>; // O gains the option's key
  action(fn: Action<A, O>): this;
  completer(fn: Completer): this;
  alias(...names: readonly string[]): this;
  validate(fn: CommandValidator<A, O>): this;
  onCancel(fn: CancelHandler<A, O>): this;
  remove(): boolean;
  command(definition: string): CommandBuilder; // the child builder
}
```

| Method | Description |
| --- | --- |
| `description` | Sets the text shown for this command in help output. |
| `hidden` | Omits the command from generated help and from tab completion. Defaults to `true` when called with no argument. A hidden command is still dispatched normally when its name is typed. |
| `option` | Declares an option. See [Options](#options). |
| `action` | Sets the handler run when the command is invoked. |
| `completer` | Sets the tab-completion provider for this command's arguments. |
| `alias` | Adds alternative names. A name that belongs to another command or alias at the same level throws an error with code `ERR_DEFINITION_CONFLICT`. |
| `validate` | Sets a pre-action check. Throwing rejects the invocation before the action runs. |
| `onCancel` | Sets a handler invoked when the running command is cancelled. |
| `remove` | Unregisters the command. Returns `true` when it was found and removed. |
| `command` | Registers a subcommand and returns the builder of the subcommand. |

The definition string names the command and its positional arguments: `"deploy <env> [region]"`, `"db migrate"`, `"run <...tasks>"`. `<name>` is required, `[name]` is optional, and a leading `...` makes the argument variadic. Positional arguments are always strings — there is no type, default, coercion or `choices` for them. A variadic argument yields `string[]`. A malformed definition throws an error with code `ERR_INVALID_DEFINITION`. See [Commands](commands.md).

A configuration call on a removed command throws an error with code `ERR_COMMAND_REMOVED`, so the builder of a removed command is unusable.

#### Typed arguments and options

For a literal definition string, the builder derives the types of `ctx.args` and `ctx.options` from the definition and from each `option` call.

| Source | Type in `ctx.args` |
| --- | --- |
| `<name>` | `string` |
| `[name]` | `string \| undefined` |
| `<...names>` and `[...names]` | `readonly string[]` |

Leading path words, as in `"db migrate <target>"`, add no key.

An option contributes one key to `ctx.options`: the last `--name` in its flags, or the first short name when the flags have no long form. Its value type is chosen by precedence:

1. The awaited return type of `parse`, per element for an array type.
2. The schema `type`.
3. `string` when the flags carry a value placeholder, `boolean` when they do not.

When `choices` is present, the type narrows to the union of its elements. The key is optional unless the option is `required`, has a `default`, or is boolean. A definition or flags string that is not a literal widens the type to `Record<string, unknown>`.

```typescript
cli
  .command("deploy <env> [region]")
  .option("-p, --port <port>", { type: "number", default: 8080 })
  .option("--tag <tag>")
  .option("--force")
  .action((ctx) => {
    ctx.args.env; // string
    ctx.args.region; // string | undefined
    ctx.options.port; // number
    ctx.options.tag; // string | undefined
    ctx.options.force; // boolean
  });
```

A subcommand builder is typed from its own definition and does not inherit the options of its parent.

#### Unreachable subcommands

A command that has both positional arguments and an action consumes every following token as an argument value, so its subcommands can never be dispatched. Calling `action` on such a command emits a process warning with the code `NODE_CLI_UNREACHABLE_SUBCOMMAND`, and registering a subcommand under one emits the same warning. Help output and tab completion omit subcommands in this state rather than advertising a path that would not dispatch.

#### validate

```typescript
validate(fn: CommandValidator<A, O>): this
```

Runs after options are resolved and before `beforeExecute`. An error thrown here propagates unchanged — it is not wrapped in `ValidationError`, which is reserved for an option's own `parse` or `validate`.

#### onCancel

```typescript
onCancel(fn: CancelHandler<A, O>): this
```

Invoked when the running command is interrupted: Ctrl-C, an aborted `exec` signal, or SIGTERM in the shell. The handler is not awaited, and a rejection is reported through the `error` event. `ctx.signal` is already aborted by the time the handler runs, so a handler and a signal listener are two views of the same event and either or both may be used.

### `Action`

```typescript
type Action<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void | Promise<void>
```

### `CommandValidator`

```typescript
type CommandValidator<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void | Promise<void>
```

### `CancelHandler`

```typescript
type CancelHandler<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void
```

### `Completer`

```typescript
type Completer = (ctx: CompletionContext) => readonly string[] | Promise<readonly string[]>
```

One shape serves every completion hook: `builder.completer`, `OptionSchema.completer` and `ModeConfig.completer`. Candidates are filtered against `ctx.current` before being offered, so a provider may return its full list.

A completer is cut off when `ctx.signal` aborts at a 1000 ms deadline. A synchronous throw, a rejection or a timeout yields an empty candidate list and never leaves the prompt paused.

#### `CompletionContext`

| Field | Type | Description |
| --- | --- | --- |
| `line` | `string` | The active pipeline segment — the command the cursor is inside. |
| `fullLine` | `string` | The whole input line, earlier pipeline segments included. |
| `current` | `string` | The word under the cursor; `""` at a word boundary. |
| `commandPath` | `readonly string[]` | Canonical command path, with aliases resolved. |
| `args` | `Record<string, unknown>` | Positional arguments parsed so far, as raw strings. |
| `options` | `Record<string, unknown>` | Raw option values parsed so far. Coercion, defaults and validation are not applied during completion. |
| `iteration` | `number` | Count of consecutive Tab presses, starting at 1. Resets on any other input. |
| `signal` | `AbortSignal` | Aborted when the completion deadline expires. |

In a shell mode, `line` and `fullLine` are the whole input line, `commandPath` is empty, and `args` and `options` are empty.

## Chaining and repeated calls

Configuration methods return `this`, so calls chain. The exceptions:

| Method | Returns |
| --- | --- |
| `CommandBuilder.option()` | The same builder with the option added to the type of `ctx.options`. |
| `CommandBuilder.command()` | The builder of the subcommand, so the chain continues on the child. |
| `CommandBuilder.remove()` | A boolean, so the chain ends. |
| `CLI.command()`, `PluginContext.command()` | A `CommandBuilder`. |
| `CLI.exec()`, `CLI.start()` | A promise. |
| Methods of `Bar`, `Spinner` and `MultiBar` | `void`. |

What a second call does with the same target depends on the method.

| Method | Repeated call |
| --- | --- |
| `CommandBuilder.description()` | Replaces the description. |
| `CommandBuilder.hidden()` | Replaces the setting. |
| `CommandBuilder.option()` | The same option name replaces the previous definition in place; a new name adds an option. |
| `CommandBuilder.action()` | Replaces the action. |
| `CommandBuilder.completer()` | Replaces the completer. |
| `CommandBuilder.alias()` | Adds to the existing aliases; duplicates are ignored. |
| `CommandBuilder.validate()` | Replaces the validator. |
| `CommandBuilder.onCancel()` | Replaces the handler. |
| `CommandBuilder.command()` | The same name merges into the existing subcommand. |
| `CommandBuilder.remove()` | Returns `false`. |
| `CLI.fallback()`, `PluginContext.fallback()` | Replaces the handler. |
| `CLI.on()`, `PluginContext.on()` | Adds another listener. |
| `CLI.start()` | Throws an error with code `ERR_ALREADY_STARTED`. |

## Execution context

### `CommandContext`

```typescript
interface CommandContext<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> extends CommandStreams {
  readonly args: A;
  readonly options: O;
  readonly rawInput: string;
  readonly rawArgv: readonly string[] | null;
  readonly commandPath: readonly string[];
  readonly shell: Shell | null;
  readonly signal: AbortSignal;
}
```

| Field | Description |
| --- | --- |
| `args` | Positional arguments keyed by argument name. |
| `options` | Resolved options keyed by option long name. |
| `rawInput` | For string input, the original string. For argv input, `argv.join(" ")`, which is lossy: an argument containing a space is indistinguishable from two arguments. |
| `rawArgv` | The exact argv elements for array input, `null` for string input. This is the reversible form; use it when argument boundaries matter. |
| `commandPath` | The canonical path of the resolved command, for example `["db", "migrate"]`. Aliases are resolved to real names, so it does not depend on what the user typed. |
| `shell` | The running `Shell` in interactive mode; `null` in direct mode and in programmatic execution. |
| `signal` | Aborted when the command is cancelled. Pass it to abort-aware APIs such as `fetch` or timers. |
| `stdin` | The readable stream for this execution surface, or `null` when none applies. |
| `stdout` | The writable stream for normal output. |
| `stderr` | The writable stream for diagnostics. |

`args` and `options` are null-prototype objects — created with `Object.create(null)`, so they inherit nothing from `Object.prototype`. `ctx.options.hasOwnProperty("force")` throws a `TypeError` because the method is not inherited. Use `Object.hasOwn`, which works on any object:

```typescript
if (Object.hasOwn(ctx.options, "force")) {
  // the option resolved to a value
}
```

The trade is deliberate: an option or column literally named `constructor` or `toString` cannot pick up an inherited value.

### `CommandStreams`

```typescript
interface CommandStreams {
  readonly stdin: Readable | null;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly signal: AbortSignal;
}
```

The streams and cancellation signal of one execution. The signal travels with the streams: whoever supplies a command's I/O also supplies the signal that cancels it. `CommandContext` and `FallbackContext` extend it, and `StdioOptions` is its partial form.

#### Argument presence

| Declaration | Nothing supplied |
| --- | --- |
| `<name>` (required) | The invocation fails with `MissingArgumentError`. |
| `[name]` (optional) | The key is **absent** from `args`. |
| `<...names>` (required variadic) | The invocation fails: zero values is a missing argument. |
| `[...names]` (optional variadic) | The key is present and holds an empty array. |

#### Standard input by surface

| Surface | `ctx.stdin` |
| --- | --- |
| `start(argv)` direct command | `process.stdin` |
| Interactive shell, unpiped command | `null` |
| Pipeline, first stage | The stream the surface supplied |
| Pipeline, later stages | The previous stage's output |
| Programmatic execution | `StdioOptions.stdin`, default `null` |

## Options

### `OptionSchema`

```typescript
interface OptionSchema {
  description?: string;
  type?: "string" | "number" | "boolean" | "string[]" | "number[]";
  alias?: string | readonly string[];
  required?: boolean;
  default?: unknown;
  choices?: readonly unknown[];
  parse?: (value: string, ctx: CommandContext) => unknown;
  validate?: (value: unknown, ctx: CommandContext) => void | Promise<void>;
  hidden?: boolean;
  completer?: readonly string[] | Completer;
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `description` | `string` | — | Text shown for the option in help output. |
| `type` | see above | Inferred | `"boolean"` when the flags string has no `<value>` placeholder, `"string"` otherwise. |
| `alias` | `string \| readonly string[]` | — | Extra aliases, merged with any declared in the flags string. A leading `-` or `--` is stripped. An alias not declared in long form must be exactly one character. |
| `required` | `boolean` | `false` | Fails with `MissingOptionError` when the option is absent. |
| `default` | `unknown` | — | Value used when the option is absent. |
| `choices` | `readonly unknown[]` | — | Restricts the value. Compared leniently, so a declared string choice matches a coerced number. Array-typed options check each element. |
| `parse` | function | — | Custom parser for an explicitly supplied value. Receives the raw string and the context. A returned promise is awaited; a throw or rejection becomes a `ValidationError`. |
| `validate` | function | — | Custom check run after coercion. Throw or reject to refuse the value; the failure becomes a `ValidationError`. |
| `hidden` | `boolean` | `false` | Omits the option from help output and tab completion. |
| `completer` | `readonly string[]` or [`Completer`](#completer) | — | Candidates offered for this option's value. Takes precedence over `choices` for completion. |

Rules that are easy to miss:

- A boolean option omitted from the input resolves to `false`, not `undefined`. The builder injects that default unless the option is `required`.
- Declaring `required: true` and a `default` on the same option throws at definition time, since the default would make the requirement unsatisfiable.
- A `default` runs through the built-in coercion for `type`, so `"8080"` on a `"number"` option resolves to `8080`. A custom `parse` is not applied to it: a default is an already-resolved value, not raw input.
- A `default` outside the declared `choices` throws at definition time.
- `parse` replaces the built-in coercion entirely, so an option with a `parse` may resolve to any type, `Date` included.
- A `<number>` placeholder requires `type: "number"` or `"number[]"`, and a `<boolean>` placeholder requires `type: "boolean"`.
- `"number"` accepts ordinary decimal or scientific notation. A magnitude above `Number.MAX_SAFE_INTEGER` is rejected, because its digits cannot be represented exactly.
- A name or alias already used by another option of the command throws an error with code `ERR_DEFINITION_CONFLICT`. Malformed flags or a schema that contradicts them throw `ERR_INVALID_DEFINITION`.

### Parsing rules

| Form | Result |
| --- | --- |
| `--name value`, `--name=value` | Long option with a value. |
| `-n value`, `-n=value` | Short alias with a value. |
| `--flag`, `-f` | Boolean set to `true`. |
| `--no-flag` | Boolean set to `false`. Rejected for a non-boolean option, and skipped when an option is literally named `no-flag`. |
| `-abc` | Cluster of short boolean flags. A clustered flag that takes a value is rejected — clustering is boolean-only. |
| `-5`, `-3.14` | A positional value, unless an option or alias of that name exists. |
| `--offset -5` | Binds `-5` as the value of a `number` or `number[]` option. For any other type a leading `-` reads as the next flag, and `--offset=-5` is required. |
| `--` | Ends option parsing. Following tokens become ordinary positional arguments; there is no separate `rest` bucket. |
| `--label a --label b` | Accumulates into an array for `string[]` and `number[]` options; for other types the last value wins. |

### Built-in flags

`--help` and `-h` show the command's help page. They work at any position in the input and inside a short cluster such as `-vh`. They stop working on a command that declares an option named `help` or aliased `h`; help output and completion then advertise only the form that still works.

`--version` and `-V` are intercepted only when `version` was set on the CLI and only when the flag is the sole token of the input. There is no `-v` form.

A bare `--help` or `-h` as the sole token prints the help index rather than a command page.

### The built-in help command

`help [...command]` is registered automatically. With no argument it prints the index; with a path it prints that command's page. An unresolvable path fails with `CommandNotFoundError` on stderr rather than printing to stdout.

## Events and plugins

### `CLIEventMap`

```typescript
interface CLIEventMap {
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  error: (error: Error) => void | Promise<void>;
  exit: () => void | Promise<void>;
}
```

| Event | Fires |
| --- | --- |
| `beforeExecute` | After validation and option resolution, immediately before the action runs. |
| `afterExecute` | After the action resolves successfully. |
| `commandError` | When a resolved command fails during argument validation, option resolution, its own `validate`, or its action. |
| `error` | For any failure while handling input, including ones raised before a command resolves, such as command-not-found or a parse failure. |
| `exit` | At most once, when `start` ends or a force-quit or the shell's SIGTERM ends the process. |

`commandError` and `error` **both** fire for a resolved command's failure: `commandError` carries the context, `error` is the catch-all. A handler that must see each failure exactly once should listen to one of them, not both.

`exit` fires after a direct-mode command completes, throws or is force-quit; after a help index is printed for an argument-free non-terminal start; when plugin initialization fails; when the interactive shell ends or receives SIGTERM; and when a force-quit ends an `exec` call. Programmatic execution never fires it on the normal path. A signal the CLI does not handle — SIGTERM or SIGHUP in direct mode, SIGHUP in the shell — ends the process without running `exit` or cancel handlers.

A listener that throws cannot break the command: the failure is re-emitted as an `error` event, and the remaining listeners still run. A throwing `error` listener is reported on stderr instead, which stops the loop from recursing.

Listeners for one event run in registration order, and an asynchronous listener is awaited before the next one runs.

### `CLIEventHandler`

```typescript
type CLIEventHandler<K extends keyof CLIEventMap> = CLIEventMap[K]
```

Names the handler type for one event, so a listener can be declared separately from the `on` call — which is also what makes it removable with `off`.

```typescript
import type { CLIEventHandler } from "@libraz/node-cli";

const onExit: CLIEventHandler<"exit"> = () => {
  process.stderr.write("bye\n");
};

cli.on("exit", onExit);
cli.off("exit", onExit);
```

### `PluginContext`

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder; // typed like cli.command
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
}
```

The object handed to a function passed to `cli.use(...)`. It exposes only the extension surface — a plugin cannot start the CLI or change its options. Its setters return the context, so registrations chain.

### `Plugin`

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>
```

A synchronous plugin runs inside `use`; an asynchronous one is awaited before the first command runs.

Asynchronous plugin bodies run through one serial queue, so registration order is deterministic even when an earlier plugin awaits I/O. A plugin that throws or rejects asynchronously fails initialization: `start` reports it and emits `exit`, and a later `use` on the same instance rethrows the stored failure. See [Events and plugins](events-and-plugins.md).

## Interactive shell

### `Shell`

Type-only. The running instance is reached through `ctx.shell`, which is `null` outside the interactive shell.

```typescript
interface Shell {
  setPrompt(text: string): this;
  enterMode(config: ModeConfig): void;
  exitMode(): void;
  stop(): void;
}
```

| Method | Description |
| --- | --- |
| `setPrompt` | Changes the prompt string. Takes effect at the next prompt; while a mode is active the change applies after the mode is left. |
| `enterMode` | Hands input over to a sub-REPL with its own prompt and handler. |
| `exitMode` | Leaves the current mode and returns to the command prompt. |
| `stop` | Ends the shell session after the current input. |

The shell starts only when **both** stdin and stdout are terminals. Its only built-in commands are `exit` and `quit`; a registered command of the same name takes precedence at the top level. `help` is an ordinary registered command, and there is no `clear` or `history` builtin.

### `ModeConfig`

```typescript
interface ModeConfig {
  prompt: string;
  action: (input: string, ctx: ModeContext) => void | Promise<void>;
  banner?: string;
  completer?: Completer;
  history?: "session" | "none";
}
```

| Field | Default | Description |
| --- | --- | --- |
| `prompt` | — | Prompt string shown while the mode is active. |
| `action` | — | Handler for each submitted line. A mode does not dispatch through the command registry. |
| `banner` | — | Text printed once when the mode is entered. |
| `completer` | — | Mode-specific completion, a [`Completer`](#completer) called with a `CompletionContext` whose `commandPath` is empty. Without one, Tab offers nothing: command completion is off inside a mode. Cut off at 1000 ms like every other provider. |
| `history` | `"session"` | `"session"` keeps mode input in memory for the duration of the mode; `"none"` disables it. Mode input is never written to the on-disk history file. |

Inside a mode, `exit` and `quit` always leave the mode rather than the shell. The first Ctrl-C aborts `ctx.signal`; a second force-quits the process with status 130. SIGTERM follows the same cooperative path, then saves history, emits `exit`, and exits with status 143 after a 200 ms grace period.

### `ModeContext`

```typescript
type ModeContext = Pick<CommandStreams, "stdout" | "stderr" | "signal">
```

The context passed to a mode's `action`. A mode never reads stdin, so only the output streams and the signal are present.

## Colour and terminal text

### `color`

```typescript
const color: ColorProxy
```

A proxy whose properties are style names. Each returns a callable that is also chainable.

```typescript
import { color } from "@libraz/node-cli";

color.red("error");
color.bold.green("ok");
color.bgCyan.white.underline("banner");
```

Accessing an unknown style name **throws** a `RangeError` with code `ERR_INVALID_ARG_VALUE`, so a typo surfaces immediately instead of silently printing unstyled text. Protocol properties (`then`, `toString`, `valueOf`, `toJSON`, `constructor`, and any symbol) are exempt, so passing a colorizer through `await`, a template literal or `JSON.stringify` does not crash.

Enablement follows `process.stdout`. Use `createColorizer` when writing elsewhere.

### Style types

```typescript
type StyleName = "bold" | "dim" | /* … */ "bgWhite"
type StyleSpec = StyleName | `${StyleName}.${StyleName}` | `${StyleName}.${StyleName}.${string}`
type ColorFn = ((text: string) => string) & { readonly [K in StyleName]: ColorFn }
type ColorProxy = { readonly [K in StyleName]: ColorFn }
```

`StyleName` is the union of the names in the table below. `StyleSpec` is a style or a dot-separated chain of styles, as taken by options such as `color` on a progress bar or `borderColor` on a table. The type system checks the first two links of a chain; any further link is checked when the value is used. `ColorFn` is the chainable callable and `ColorProxy` is the object behind `color` and `createColorizer`.

### The style set

Six modifiers, ten foregrounds, seven backgrounds — nothing else. There is no `bgBlack`, no bright variants, and no 256-colour or hex API.

| Group | Names |
| --- | --- |
| Modifiers | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Foreground | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `grey` |
| Background | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

`gray` and `grey` are two spellings of one colour.

### `isStyleName`

```typescript
function isStyleName(name: string): name is StyleName
```

Reports whether `name` is a built-in style name. Inherited members such as `toString` do not qualify.

### `c`

```typescript
function c(strings: TemplateStringsArray, ...values: unknown[]): string
```

A tagged template that applies styles with `{styleName text}` markup, bound to `process.stdout`. Style names chain with dots, and markup nests.

```typescript
import { c } from "@libraz/node-cli";

const message = "disk full";

c`Status: {green OK}`;
c`{bold.red Error}: ${message}`;
c`{dim outer {cyan inner} outer}`;
```

Unlike `color`, the tag never throws on an unknown name: an unknown style name, an unclosed brace or a missing space renders literally. Interpolated values are substituted after styling, so a value that itself contains `{green ...}` is not treated as markup. Nesting deeper than 64 levels throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### `createTemplateTag`

```typescript
function createTemplateTag(
  stream: Writable,
): (strings: TemplateStringsArray, ...values: unknown[]) => string
```

Returns a tag with the semantics of `c` whose enablement is decided from `stream`, so escapes are emitted only when colour is enabled for that stream.

```typescript
const e = createTemplateTag(process.stderr);
process.stderr.write(e`{bold.red Error}: something went wrong\n`);
```

### `createColorizer`

```typescript
function createColorizer(stream: Writable): ColorProxy
```

Returns a `color`-shaped proxy whose enablement is decided from `stream` rather than `process.stdout`. Use it inside a command action so colour follows the stream the action is actually writing to.

```typescript
const col = createColorizer(ctx.stdout);
ctx.stdout.write(`${col.green("done")}\n`);
```

### `isColorEnabled`

```typescript
function isColorEnabled(stream?: Writable): boolean
```

Reports whether escape codes would be emitted for `stream`, which defaults to `process.stdout`. The resolution order is:

1. An explicit `setColorEnabled()` override — it beats everything, `NO_COLOR` included.
2. `NO_COLOR`, when set to a non-empty value: colour off.
3. `FORCE_COLOR`, when set to a non-empty value: `"0"` and `"false"` force it off, anything else forces it on. This beats both `TERM=dumb` and a non-terminal stream.
4. `TERM=dumb`: colour off.
5. Whether the stream is a terminal.

### `setColorEnabled`

```typescript
function setColorEnabled(value: boolean | "auto"): void
```

`true` and `false` pin the answer for the whole process. `"auto"` clears the override and restores automatic detection. The override is the right tool for a test that asserts on plain text.

### `stringWidth`

```typescript
function stringWidth(text: string): number
```

The number of terminal columns the text occupies. ANSI sequences are stripped first, combining marks, format characters and controls count as zero, and characters with East Asian Width Wide or Fullwidth and emoji-presentation characters count as two. A run of scalars joined by zero-width joiners — a family emoji, for instance — collapses to one two-column grapheme.

### `stripAnsi`

```typescript
function stripAnsi(text: string): string
```

Removes every ANSI escape sequence: CSI, OSC, DCS/SOS/PM/APC control strings and every other escape.

### `truncateAnsi`

```typescript
function truncateAnsi(text: string, width: number, ellipsis?: string): string
```

Truncates to `width` display columns without splitting a grapheme, appends `ellipsis` (default `"…"`) when the text is cut, and closes any styling or hyperlink the result would otherwise leave open, resetting each style attribute on its own so an outer style survives. `width` is a positive integer, or `Infinity` for no limit. A non-number throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`; `0`, a negative, `NaN` or a fractional value throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### `splitAnsi`

```typescript
function splitAnsi(text: string): AnsiSegment[]

interface AnsiSegment {
  ansi: boolean;
  text: string;
}
```

Splits the input into ordered runs of escape sequences (`ansi: true`) and visible text (`ansi: false`), using the same recognizer as `stripAnsi`. Concatenating every segment's `text` reproduces the input, which is what lets a consumer transform only the visible parts.

### `splitGraphemes`

```typescript
function splitGraphemes(text: string): string[]
```

Splits visible text into user-perceived grapheme clusters, so an emoji with a modifier counts as one unit.

### `sanitizeTerminalText`

```typescript
function sanitizeTerminalText(text: string, options?: SanitizeTerminalTextOptions): string

interface SanitizeTerminalTextOptions {
  singleLine?: boolean;
  allowHyperlinks?: boolean;
}
```

Prepares untrusted text for a rendered region. SGR styling and OSC 8 hyperlinks survive; cursor movement, screen clearing and title changes are removed, and any style or hyperlink the text leaves open is closed.

| Field | Default | Description |
| --- | --- | --- |
| `singleLine` | `true` | Newlines become spaces. With `false`, line breaks are kept. |
| `allowHyperlinks` | `true` | `false` strips OSC 8 hyperlinks too. |

### `streamIsTTY`

```typescript
function streamIsTTY(value: unknown): boolean
```

Reports whether a value is an object whose `isTTY` is `true`. See [TTY](glossary.md#tty).

See [Colour](color.md) for narrative coverage.

## Tables

### `table`

```typescript
function table(
  data: readonly (readonly unknown[])[] | readonly Record<string, unknown>[],
  options?: TableOptions,
): string
```

Renders rows as an aligned string with no trailing newline. Accepts an array of objects or an array of arrays. The result is returned, never written.

`table` never wraps. A cell wider than its column is truncated with the ellipsis, newlines and tabs inside a cell have already been collapsed to spaces, and the total width is never clamped to the terminal — a wide table wraps in the terminal rather than being reflowed.

An unknown border or style name, or a number outside its range, throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`. A value of the wrong type, including a `columns` entry that is neither a string nor a `ColumnSpec`, throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.

#### Columns

`columns` takes strings and [`ColumnSpec`](#columnspec) objects. A string is shorthand for `{ key }`.

| Data shape | Columns |
| --- | --- |
| Array of objects, no `columns` | The union of every row's own property names, in first-seen order. |
| Array of objects, with `columns` | Exactly the listed columns; `key` selects the property. |
| Array of arrays, no `columns` | Row 0 is the header; columns are matched by position and keyed `"0"`, `"1"`, … |
| Array of arrays, with `columns` | Columns are matched by position and `key` is ignored. Row 0 is then data, not a header. |

### `TableOptions`

```typescript
interface TableOptions {
  columns?: readonly (string | ColumnSpec)[];
  header?: boolean;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;
  borderColor?: StyleSpec;
  headerStyle?: StyleSpec | "none";
  paddingLeft?: number;
  paddingRight?: number;
  gap?: number;
  rowSeparators?: boolean;
  ellipsis?: string;
  stream?: Writable;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `columns` | Derived from the data | Columns to render, in order. See [Columns](#columns). |
| `header` | `true` | Whether a header row is rendered. |
| `border` | `"none"` | Border preset. Supplying `chars` without `border` implies `"custom"`. |
| `chars` | — | Border glyph overrides. `"custom"` starts from the `"single"` preset. |
| `borderColor` | — | Style of the border glyphs, such as `"dim"` or `"cyan.bold"`. |
| `headerStyle` | `"bold"` | Style of the header text; `"none"` leaves it plain. |
| `paddingLeft` | `1` with a frame (`rounded`, `single`, `double`, `custom`); `0` with `none` and `simple` | Spaces inside each cell, left. |
| `paddingRight` | Same rule as `paddingLeft` | Spaces inside each cell, right. |
| `gap` | `2` | Spaces between columns of a borderless table. |
| `rowSeparators` | `false` | Draws a separator line between data rows. |
| `ellipsis` | `"…"` | Marker appended to a truncated cell. |
| `stream` | `process.stdout` | The stream the result is meant for. It only decides whether colour is emitted; nothing is written to it. |

### `ColumnSpec`

```typescript
interface ColumnSpec {
  key: string;
  label?: string;
  align?: "left" | "right" | "center";
  width?: number;
  maxWidth?: number;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `key` | — | Object property to read for object data. Array data is matched by position and ignores it. |
| `label` | `key` | Header text. |
| `align` | `"left"` | Alignment of the header and the cells. |
| `width` | Auto | Fixed total width of the column, padding included, as a positive integer. Wins over `maxWidth`. |
| `maxWidth` | — | Upper bound on the content width, padding excluded: a positive integer or `Infinity`. |

The smallest honoured `width` is `paddingLeft + paddingRight + 1`; anything below that renders at that minimum. Every border mode renders the padding it charged, so the requested width is the rendered width.

### `TableChars`

```typescript
interface TableChars {
  top?: string;
  topMid?: string;
  topLeft?: string;
  topRight?: string;
  bottom?: string;
  bottomMid?: string;
  bottomLeft?: string;
  bottomRight?: string;
  left?: string;
  leftMid?: string;
  right?: string;
  rightMid?: string;
  horizontal?: string;
  cross?: string;
  vertical?: string;
}
```

| Field | Piece of the frame |
| --- | --- |
| `top`, `bottom` | Horizontal fill of the top and bottom edge. |
| `topMid`, `bottomMid` | Junction on the top and bottom edge between two columns. |
| `topLeft`, `topRight`, `bottomLeft`, `bottomRight` | Corners. |
| `left`, `right` | Left and right edge of every row. |
| `leftMid`, `rightMid` | Left and right end of a separator line between rows. |
| `horizontal` | Horizontal fill of a separator line between rows. |
| `cross` | Crossing of a separator line and a column divider. |
| `vertical` | Divider between two columns within a row. |

Supplied glyphs are sanitized, so an escape sequence in a border character cannot restyle the rest of the table. See [Tables](table.md) for worked layouts.

## Progress

Every indicator defaults to `process.stderr`, which keeps progress output out of a redirected stdout. An indicator starts drawing when it is created, and every terminal verb (`succeed`, `fail`, `warn`, `stop`) ends it. Any method called afterwards does nothing.

The three verbs `succeed`, `fail` and `warn` replace the indicator with a result line: a green `✔`, a red `✖` or a yellow `⚠`, followed by `message`, which defaults to the label. `stop` leaves the last frame in place and ends the line.

### progress.bar

```typescript
progress.bar(options: BarOptions): Bar
```

#### `BarOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `total` | `number` | — | Required. A finite number of at least `0`; anything else throws. A total of `0` renders as complete. |
| `label` | `string` | `""` | Text before the bar. |
| `width` | `number` | `30` | Bar width in characters, from `1` to `4096`. A fractional value draws its whole part. Anything else throws. |
| `filled` | `string` | `"█"` | Glyph for the filled portion. |
| `empty` | `string` | `"░"` | Glyph for the empty portion. |
| `format` | `(state: BarState) => string` | — | Replaces the whole rendered line. |
| `stream` | `Writable` | `process.stderr` | Output stream. |
| `color` | [`StyleSpec`](#style-types) | — | Style applied to the bar, such as `"green"` or `"bold.cyan"`. An unknown name throws at creation. |

An invalid option throws a `TypeError` with code `ERR_INVALID_ARG_TYPE` or a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

#### `Bar`

| Method | Description |
| --- | --- |
| `update(current: number)` | Sets progress to an absolute value, clamped to `0`–`total`. A non-finite value is ignored. |
| `tick(delta?: number)` | Adds `delta`, default `1`. |
| `succeed(message?: string)` | Sets progress to `total` and ends the bar with a `✔` result line. |
| `fail(message?: string)` | Ends the bar at its current position with a `✖` result line. |
| `warn(message?: string)` | Ends the bar at its current position with a `⚠` result line. |
| `stop()` | Leaves the last frame in place and ends the line. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

`Symbol.dispose` makes a bar usable with a `using` declaration, which calls the disposal method automatically at the end of the enclosing block, including when the block throws:

```typescript
{
  using bar = progress.bar({ total: 100 });
  bar.update(50);
} // stop() runs here
```

#### `BarState`

```typescript
interface BarState {
  current: number;
  total: number;
  percent: number; // 0 to 100
  elapsedMs: number; // ms since the bar was created
  etaMs: number; // estimated ms remaining; Infinity while no rate is known
  ratePerSecond: number; // units per second
}
```

### progress.spinner

```typescript
progress.spinner(options?: SpinnerOptions): Spinner
```

#### `SpinnerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `string` | `""` | Text beside the frame. |
| `frames` | `readonly string[]` | Braille dots | Animation frames. A non-array or a non-string element throws a `TypeError`; an empty array throws a `RangeError`. |
| `intervalMs` | `number` | `80` | Milliseconds between frames. Must be positive and finite. |
| `stream` | `Writable` | `process.stderr` | Output stream. |
| `color` | [`StyleSpec`](#style-types) | — | Style applied to the frame. An unknown name throws at creation. |

#### `Spinner`

| Method | Description |
| --- | --- |
| `setLabel(label: string)` | Replaces the label; the next frame shows it. |
| `succeed(message?: string)` | Ends the spinner with a `✔` result line. |
| `fail(message?: string)` | Ends the spinner with a `✖` result line. |
| `warn(message?: string)` | Ends the spinner with a `⚠` result line. |
| `stop()` | Leaves the last frame in place and ends the line. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

### Behaviour on a non-terminal stream

A bar or spinner writing to a non-terminal stream emits nothing while it runs, and `stop` writes nothing, so a redirected log does not fill with control sequences. `succeed`, `fail` and `warn` always write their one result line. That makes an indicator safe to leave in a script whose output is captured: the outcome is recorded, the animation is not.

### progress.multi

```typescript
progress.multi(options?: MultiBarOptions): MultiBar
```

#### `MultiBarOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `stream` | `Writable` | `process.stderr` | Stream shared by every bar in the group. |

The group claims its stream when it is created. One frame cannot be split across terminal regions, so `add` takes no `stream`.

#### `MultiBar`

| Method | Description |
| --- | --- |
| `add(options: Omit<BarOptions, "stream">): Bar` | Adds a bar drawn in the group's stream and returns its handle. |
| `succeed(message?: string)` | Ends every unfinished bar with `✔` and closes the group. |
| `fail(message?: string)` | Ends every unfinished bar with `✖` and closes the group. |
| `warn(message?: string)` | Ends every unfinished bar with `⚠` and closes the group. |
| `stop()` | Leaves the last frame in place and closes the group. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

On a group method, `message` is written as one unmarked final line. On a non-terminal stream, each bar's result line is written as the bar ends.

`add` called after the group is closed returns an inert bar whose methods are no-ops, so a worker that adds a bar just after `finally { multi.stop() }` does not fail.

Two standalone indicators cannot render to the same terminal stream at once — the second throws an error with code `ERR_OUTPUT_BUSY`, because neither can know the other's row layout. Concurrent bars belong in a `multi` group.

### progress.releaseAll

```typescript
progress.releaseAll(): void
```

Stops every indicator that is still active and restores the terminal cursor. Command execution calls it in its finalizer, so an action that throws cannot leave the cursor hidden. Call it directly when driving indicators outside a command.

See [Progress](progress.md) for worked usage.

## Prompts

Prompts ask on stderr, so a question never pollutes a redirected stdout. Every prompt rejects with `PromptCancelError` on Ctrl-C, on end of input (Ctrl-D) or when `signal` aborts. A `validate` that throws is not a rejection: the message is shown and the prompt asks again. Only cancellation escapes the call.

Two prompts reading from the same input stream at once throws an error with code `ERR_INPUT_BUSY`, since the second would steal the first one's keystrokes.

### `PromptOptions`

```typescript
type PromptOptions<T = unknown> = Pick<StdioOptions, "stdin" | "stderr" | "signal"> & {
  validate?: (value: T) => void | Promise<void>;
  marker?: string;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `stdin` | `process.stdin` | Where the answer is read. `null` also selects `process.stdin`. |
| `stderr` | `process.stderr` | Where the question is written. |
| `signal` | — | Aborting rejects the pending prompt with `PromptCancelError`. |
| `validate` | — | Throw or reject to refuse the value; the prompt shows the message and asks again. |
| `marker` | `"?"` | Symbol shown before the question. |

Every prompt options interface extends this type. Its stream members match `StdioOptions`, so a command context can be passed as the options object: `prompt.confirm("Continue?", ctx)`.

### prompt.text

```typescript
prompt.text(message: string, options?: TextOptions): Promise<string>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `string` | — | Fills an empty submission. |
| `placeholder` | `string` | — | Example shown as `(e.g. …)`. Displayed only when there is no `default`. |
| `trim` | `boolean` | `true` | Trims surrounding whitespace from the answer. |
| `required` | `boolean` | `true` | Refuses an empty answer. |

An explicit `default` — including `""` — bypasses `required`: submitting nothing yields the default rather than the "value is required" message.

### prompt.confirm

```typescript
prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `boolean` | `false` | Value returned for an empty submission. Also decides the `(Y/n)` or `(y/N)` hint. |

Accepts `y`, `yes`, `n` and `no` in any case. Anything else re-asks.

### prompt.select

```typescript
prompt.select<T>(
  message: string,
  choices: readonly Choice<T>[],
  options?: SelectOptions<T>,
): Promise<T>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `T` | — | Value returned for an empty submission. Matched by identity against a choice's `value`, or against the choice object itself. |

Choices are answered by their displayed number, or by typing a label, matched case-insensitively. A number within the range of the list always selects by number, so a numeric-looking label stays reachable by its position; any other input is matched against the labels. An empty `choices` array throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### prompt.multiselect

```typescript
prompt.multiselect<T>(
  message: string,
  choices: readonly Choice<T>[],
  options?: MultiselectOptions<T>,
): Promise<T[]>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `readonly T[]` | — | Pre-selected values, returned for an empty submission. |
| `min` | `number` | — | Minimum number of distinct selections. Omitted means an empty result is accepted. |
| `max` | `number` | — | Maximum number of distinct selections. |

Answered with comma-separated numbers. Duplicates are collapsed before `min` and `max` are checked. A `min` above `max`, a `min` above the number of choices, or a non-integer bound throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### prompt.password

```typescript
prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `trim` | `boolean` | `false` | Off by default, unlike `prompt.text`, because surrounding whitespace can be part of a secret. |
| `required` | `boolean` | `true` | Refuses an empty answer. |

There is no `default`. Typed characters are masked with one asterisk per grapheme, so the mask reveals neither the display width nor the scalar count of what was typed.

`required` exists only on `prompt.text` and `prompt.password`; the other prompts have no such option.

### `Choice` and `SelectChoice`

```typescript
interface SelectChoice<T> {
  label: string;
  value: T;
  hint?: string;
}

type Choice<T> = T | SelectChoice<T>;
```

A choice is either a bare value or a descriptor. A descriptor with a `label` but no `value` throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`, so an ordinary domain object that happens to carry a `label` property is never silently turned into `undefined`.

See [Prompts](prompts.md) for worked usage.

## Logging

### `createLogger`

```typescript
function createLogger(options?: LoggerOptions): Logger
```

Every level — `info` and `success` included — is written to one stream, which defaults to `process.stderr`. There is no level-based routing between stdout and stderr. To put log output on stdout, pass `stream: process.stdout`.

An unknown `level` or an invalid `bufferLimit` throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

#### `LoggerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `"info"` | Minimum level. Lower levels are dropped. |
| `prefix` | `string` | — | Bracketed prefix on each line. |
| `timestamp` | `boolean` | `false` | Prepends `HH:MM:SS`. |
| `stream` | `Writable` | `process.stderr` | Output stream. |
| `bufferLimit` | `number` | `1000` | Lines queued while the stream is backpressured. When full, the oldest queued line is dropped. Must be a non-negative safe integer. |

#### `Logger`

| Method | Gated at | Glyph with colour | Label without colour |
| --- | --- | --- | --- |
| `debug(message, ...args)` | `debug` | `●` | `[DEBUG]` |
| `info(message, ...args)` | `info` | `ℹ` | `[INFO]` |
| `success(message, ...args)` | `info` | `✔` | `[OK]` |
| `warn(message, ...args)` | `warn` | `⚠` | `[WARN]` |
| `error(message, ...args)` | `error` | `✖` | `[ERROR]` |

`success` is not a level of its own: it is gated at `info`, so setting the level to `warn` silences it.

Messages go through the `format` function of `node:util`, so `%s`, `%d` and `%j` placeholders work and a non-string first argument is rendered rather than passed through.

| Method | Description |
| --- | --- |
| `setLevel(level: LogLevel)` | Changes the minimum level at runtime and returns the logger. |
| `child(prefix: string): Logger` | Creates a child whose prefix is `parent:child`. Without its own level it follows the parent's current level, so a later `parent.setLevel(...)` reaches it. |
| `flush(): Promise<void>` | Resolves once queued lines have reached the stream, every child's included. Rejects if the stream errors or closes first. |

### `LogLevel`

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

`"silent"` suppresses every level. See [Logging](logging.md).

## Errors

### `CLIError`

```typescript
class CLIError extends Error {
  readonly code: CLIErrorCode | (string & {});
  readonly exitCode: number;
  constructor(
    message: string,
    options: { code: CLIErrorCode | (string & {}); exitCode?: number; cause?: unknown },
  );
}
```

The base class for every error the framework raises about user input. `code` is machine-readable; `exitCode` is the process status the failure implies, defaulting to `1`; `cause` is forwarded to `Error`. An application subclass may carry a code of its own.

### `CLIErrorCode`

```typescript
type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_ERROR"
  | "PARSE_ERROR"
  | "PROMPT_CANCELLED";
```

### Subclasses

Every subclass constructor takes its subject first and an options object last, and every options object accepts `cause`.

| Class | Constructor | `code` | `exitCode` | Extra fields | Raised when |
| --- | --- | --- | --- | --- | --- |
| `CommandNotFoundError` | `(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `1` | `input`, `available?` | No command matches the input, or a command group is given an unknown child. |
| `MissingArgumentError` | `(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `1` | `argName`, `usage?` | A required positional argument is absent, or a required variadic receives zero values. |
| `ExtraArgumentError` | `(extras, { cause? })` | `EXTRA_ARGUMENT` | `1` | `extra`, `extras` | More positional values are supplied than the command declares. `extras` is a `readonly string[]`; `extra` is its first element. |
| `MissingOptionError` | `(optionName, { cause? })` | `MISSING_OPTION` | `1` | `optionName` | A `required` option is absent. |
| `InvalidOptionError` | `(message, { optionName?, value?, cause? })` | `INVALID_OPTION` | `1` | `optionName?`, `value?` | A value fails built-in coercion or a `choices` check, or an option is used in a form it does not accept. |
| `UnknownOptionError` | `(flag, { cause? })` | `UNKNOWN_OPTION` | `1` | `flag`, `optionName` | A flag is not declared by the command. `flag` keeps its leading dashes; `optionName` drops them. |
| `ValidationError` | `(message, { optionName?, cause? })` | `VALIDATION_ERROR` | `1` | `optionName?` | An option's own `parse` or `validate` throws or rejects. |
| `ParseError` | `(message, { quote?, cause? })` | `PARSE_ERROR` | `1` | `quote?` | The input cannot be tokenized or split into pipeline stages. |
| `PromptCancelError` | `({ cause? })` | `PROMPT_CANCELLED` | `130` | — | A prompt is cancelled with Ctrl-C, end of input or an aborted signal. |

`ValidationError` wraps failures of an **option's** `parse` or `validate` only. An error thrown by `CommandBuilder.validate()` propagates unchanged and keeps its own class and message.

`ParseError` covers an unclosed quote (`quote` is `"single"` or `"double"` and names which one), an empty or trailing pipe, and an unsupported redirection operator. It is raised before a command is resolved, so a registered `fallback` handler receives the input instead of the error being thrown.

`PromptCancelError` carries exit code `130`, the conventional status for an interrupted program. Every other `CLIError` defaults to `1`. The interactive shell's SIGTERM path exits `143`. See [Exit code](glossary.md#exit-code).

### `BuiltinCLIError`

```typescript
type BuiltinCLIError =
  | CommandNotFoundError
  | MissingArgumentError
  | ExtraArgumentError
  | MissingOptionError
  | InvalidOptionError
  | UnknownOptionError
  | ValidationError
  | ParseError
  | PromptCancelError;
```

The union of the nine classes above, discriminated by `code`.

### `isBuiltinCLIError`

```typescript
function isBuiltinCLIError(e: unknown): e is BuiltinCLIError
```

Reports whether a value is one of the nine built-in subclasses. A bare `CLIError` and application subclasses do not match; test those with `instanceof`.

```typescript
import { isBuiltinCLIError } from "@libraz/node-cli";

try {
  await cli.exec("deploy");
} catch (err) {
  if (isBuiltinCLIError(err) && err.code === "MISSING_ARGUMENT") {
    // err is narrowed to MissingArgumentError
    console.error(err.argName);
  }
}
```

### `UsageErrorCode`

```typescript
type UsageErrorCode =
  | "ERR_INVALID_ARG_TYPE"
  | "ERR_INVALID_ARG_VALUE"
  | "ERR_INVALID_DEFINITION"
  | "ERR_DEFINITION_CONFLICT"
  | "ERR_COMMAND_REMOVED"
  | "ERR_ALREADY_STARTED"
  | "ERR_OUTPUT_BUSY"
  | "ERR_INPUT_BUSY";
```

Codes carried by errors that report misuse of the API by the calling program, as opposed to a failure caused by user input. These errors are not `CLIError` instances: they are a plain `TypeError`, `RangeError` or `Error` with a `code` property, in the manner of Node's own errors.

| Code | Class | Raised when |
| --- | --- | --- |
| `ERR_INVALID_ARG_TYPE` | `TypeError` | An argument or option has the wrong type. |
| `ERR_INVALID_ARG_VALUE` | `RangeError` | A value is out of range or names something unknown, such as a style, a border or a log level. |
| `ERR_INVALID_DEFINITION` | `Error` | A definition string, option flags or option schema is malformed or contradicts itself. |
| `ERR_DEFINITION_CONFLICT` | `Error` | An option name or alias, or a command alias, is already taken. |
| `ERR_COMMAND_REMOVED` | `Error` | A removed command is configured. |
| `ERR_ALREADY_STARTED` | `Error` | `start` is called a second time. |
| `ERR_OUTPUT_BUSY` | `Error` | A second indicator claims a terminal stream that another one holds. |
| `ERR_INPUT_BUSY` | `Error` | A second prompt reads from an input stream that another one holds. |

### `formatErrorMessage`

```typescript
function formatErrorMessage(err: unknown): string
```

Renders any thrown value as one line of user-facing text: the `Error`'s message, otherwise `String(err)`.

### `isCancellationError`

```typescript
function isCancellationError(err: unknown, signal: AbortSignal): boolean
```

Reports whether a failure is a user-initiated cancellation rather than a genuine fault. A `PromptCancelError` always qualifies. A bare `AbortError` qualifies **only** when `signal` is aborted — without that evidence there is no way to tell whose cancellation it was, and an unrelated aborted request would be misreported as the user pressing Ctrl-C.

```typescript
import { isCancellationError } from "@libraz/node-cli";

try {
  await work(ctx.signal);
} catch (err) {
  if (isCancellationError(err, ctx.signal)) return;
  throw err;
}
```

See [Errors](errors.md).

## Low-level parsing helper

### `tokenize`

```typescript
function tokenize(input: string): string[]
```

Splits a line into argv-style tokens, honouring single quotes, double quotes and backslash escapes. Throws `ParseError` on an unclosed quote. It is exported so an integration can reuse the framework's exact behaviour; ordinary applications do not need it.

## Environment variables

| Variable | Effect |
| --- | --- |
| `NO_COLOR` | Any non-empty value disables colour, unless `setColorEnabled(true)` was called. |
| `FORCE_COLOR` | `"0"` or `"false"` disables colour; any other non-empty value enables it, overriding both `TERM=dumb` and a non-terminal stream. |
| `TERM` | `TERM=dumb` disables colour, unless `FORCE_COLOR` says otherwise. |
| `NODE_CLI_DEBUG` | `NODE_CLI_DEBUG=1` prints the full stack trace of a fatal error instead of the usual `Error: <message>` line. |

```bash
NODE_CLI_DEBUG=1 myapp deploy prod
```

`NODE_CLI_DEBUG` applies on the direct-argv path only. A command that fails inside the interactive shell always prints just its message, because the shell keeps running afterwards and a stack trace mid-session is noise.

## Export index

| Export | Kind | Section |
| --- | --- | --- |
| `createCLI` | function | [Creating a CLI](#createcli) |
| `CLI` | type | [Creating a CLI](#cli) |
| `CLIOptions` | type | [Creating a CLI](#clioptions) |
| `HistoryFilter` | type | [Creating a CLI](#historyfilter) |
| `StdioOptions` | type | [Creating a CLI](#stdiooptions) |
| `FallbackHandler` | type | [Creating a CLI](#fallbackhandler) |
| `FallbackContext` | type | [Creating a CLI](#fallbackcontext) |
| `CommandBuilder` | type | [Defining commands](#commandbuilder) |
| `Action` | type | [Defining commands](#action) |
| `CommandValidator` | type | [Defining commands](#commandvalidator) |
| `CancelHandler` | type | [Defining commands](#cancelhandler) |
| `Completer` | type | [Defining commands](#completer) |
| `CompletionContext` | type | [Defining commands](#completioncontext) |
| `CommandContext` | type | [Execution context](#commandcontext) |
| `CommandStreams` | type | [Execution context](#commandstreams) |
| `OptionSchema` | type | [Options](#optionschema) |
| `CLIEventMap` | type | [Events and plugins](#clieventmap) |
| `CLIEventHandler` | type | [Events and plugins](#clieventhandler) |
| `PluginContext` | type | [Events and plugins](#plugincontext) |
| `Plugin` | type | [Events and plugins](#plugin) |
| `Shell` | type | [Interactive shell](#shell) |
| `ModeConfig` | type | [Interactive shell](#modeconfig) |
| `ModeContext` | type | [Interactive shell](#modecontext) |
| `tokenize` | function | [Low-level parsing helper](#tokenize) |
| `color` | value | [Colour and terminal text](#color) |
| `StyleName` | type | [Colour and terminal text](#style-types) |
| `StyleSpec` | type | [Colour and terminal text](#style-types) |
| `ColorFn` | type | [Colour and terminal text](#style-types) |
| `ColorProxy` | type | [Colour and terminal text](#style-types) |
| `isStyleName` | function | [Colour and terminal text](#isstylename) |
| `c` | function | [Colour and terminal text](#c) |
| `createTemplateTag` | function | [Colour and terminal text](#createtemplatetag) |
| `createColorizer` | function | [Colour and terminal text](#createcolorizer) |
| `isColorEnabled` | function | [Colour and terminal text](#iscolorenabled) |
| `setColorEnabled` | function | [Colour and terminal text](#setcolorenabled) |
| `stringWidth` | function | [Colour and terminal text](#stringwidth) |
| `stripAnsi` | function | [Colour and terminal text](#stripansi) |
| `truncateAnsi` | function | [Colour and terminal text](#truncateansi) |
| `splitAnsi` | function | [Colour and terminal text](#splitansi) |
| `AnsiSegment` | type | [Colour and terminal text](#splitansi) |
| `splitGraphemes` | function | [Colour and terminal text](#splitgraphemes) |
| `sanitizeTerminalText` | function | [Colour and terminal text](#sanitizeterminaltext) |
| `SanitizeTerminalTextOptions` | type | [Colour and terminal text](#sanitizeterminaltext) |
| `streamIsTTY` | function | [Colour and terminal text](#streamistty) |
| `table` | function | [Tables](#table) |
| `TableOptions` | type | [Tables](#tableoptions) |
| `ColumnSpec` | type | [Tables](#columnspec) |
| `TableChars` | type | [Tables](#tablechars) |
| `progress` | value | [Progress](#progress) |
| `Bar` | type | [Progress](#bar) |
| `BarOptions` | type | [Progress](#baroptions) |
| `BarState` | type | [Progress](#barstate) |
| `Spinner` | type | [Progress](#spinner) |
| `SpinnerOptions` | type | [Progress](#spinneroptions) |
| `MultiBar` | type | [Progress](#multibar) |
| `MultiBarOptions` | type | [Progress](#multibaroptions) |
| `prompt` | value | [Prompts](#prompts) |
| `PromptOptions` | type | [Prompts](#promptoptions) |
| `TextOptions` | type | [Prompts](#prompttext) |
| `ConfirmOptions` | type | [Prompts](#promptconfirm) |
| `SelectOptions` | type | [Prompts](#promptselect) |
| `MultiselectOptions` | type | [Prompts](#promptmultiselect) |
| `PasswordOptions` | type | [Prompts](#promptpassword) |
| `Choice` | type | [Prompts](#choice-and-selectchoice) |
| `SelectChoice` | type | [Prompts](#choice-and-selectchoice) |
| `createLogger` | function | [Logging](#createlogger) |
| `Logger` | type | [Logging](#logger) |
| `LoggerOptions` | type | [Logging](#loggeroptions) |
| `LogLevel` | type | [Logging](#loglevel) |
| `CLIError` | class | [Errors](#clierror) |
| `CLIErrorCode` | type | [Errors](#clierrorcode) |
| `CommandNotFoundError` | class | [Errors](#subclasses) |
| `MissingArgumentError` | class | [Errors](#subclasses) |
| `ExtraArgumentError` | class | [Errors](#subclasses) |
| `MissingOptionError` | class | [Errors](#subclasses) |
| `InvalidOptionError` | class | [Errors](#subclasses) |
| `UnknownOptionError` | class | [Errors](#subclasses) |
| `ValidationError` | class | [Errors](#subclasses) |
| `ParseError` | class | [Errors](#subclasses) |
| `PromptCancelError` | class | [Errors](#subclasses) |
| `BuiltinCLIError` | type | [Errors](#builtinclierror) |
| `isBuiltinCLIError` | function | [Errors](#isbuiltinclierror) |
| `UsageErrorCode` | type | [Errors](#usageerrorcode) |
| `formatErrorMessage` | function | [Errors](#formaterrormessage) |
| `isCancellationError` | function | [Errors](#iscancellationerror) |

## Related pages

- [Commands](commands.md) — command definitions, subcommands, validation and cancellation.
- [Options](options.md) — the option schema in narrative form.
- [Interactive shell](interactive-shell.md) — the prompt, history, completion, pipes and modes.
- [Colour](color.md), [Tables](table.md), [Progress](progress.md), [Prompts](prompts.md), [Logging](logging.md) — the output toolkit.
- [Events and plugins](events-and-plugins.md) — lifecycle hooks and plugin packaging.
- [Errors](errors.md) — how failures are reported and which exit code each produces.
- [Examples](examples.md) — complete working programs.
- [Glossary](glossary.md) — terms used throughout these pages.

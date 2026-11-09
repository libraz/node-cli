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

The type-only exports are `CLI`, `CommandBuilder`, `Shell`, `ModeOptions`, `ModeAction`, `ModeContext`, `Action`, `CancelHandler`, `CommandValidator`, `Completer`, `CompletionContext`, `FallbackHandler`, `FallbackContext`, `HistoryFilter`, `CLIEventHandler`, `CLIEventMap`, `CLIOptions`, `CommandContext`, `CommandStreams`, `StdioOptions`, `OptionSchema`, `Plugin`, `PluginContext`, `CLIErrorCode`, `CLIErrorOptions`, `BuiltinCLIError`, `UsageErrorCode`, `StyleName`, `StyleSpec`, `ColorFn`, `Colorizer`, `ColorTag`, `AnsiSegment`, `SanitizeTerminalTextOptions`, `ColumnSpec`, `TableChars`, `TableOptions`, `Bar`, `BarOptions`, `BarState`, `MultiBar`, `MultiBarOptions`, `Spinner`, `SpinnerOptions`, `PromptOptions`, `TextOptions`, `ConfirmOptions`, `SelectOptions`, `MultiselectOptions`, `PasswordOptions`, `Choice`, `SelectChoice`, `Logger`, `LoggerOptions` and `LogLevel`.

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
function createCLI(options: CLIOptions): CLI
```

Constructs a `CLI`. It is the only entry point; the class itself is not exported as a value. `options` and `options.name` are required.

### `CLI`

```typescript
interface CLI {
  command(definition: string): CommandBuilder; // A and O are inferred from a literal definition
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
  use(plugin: Plugin): this;
  exec(argv: readonly string[], options?: StdioOptions): Promise<void>;
  execLine(line: string, options?: StdioOptions): Promise<void>;
  start(argv?: readonly string[]): Promise<number>;
}
```

| Method | Description |
| --- | --- |
| `command` | Registers a command from a definition string and returns a [`CommandBuilder`](#commandbuilder). The same path merges into the existing command, so a second registration extends the first. |
| `on` / `off` | Adds or removes a lifecycle listener. See [`CLIEventMap`](#clieventmap). `off` removes the first matching registration and ignores a handler that is not registered. An unknown event name throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`, and a non-function handler a `TypeError` with code `ERR_INVALID_ARG_TYPE`. |
| `fallback` | Sets the handler invoked when no command matches the input. Only one handler is held; a later call replaces it. |
| `use` | Registers a plugin. Plugin bodies run in registration order. A synchronous plugin runs inside the call, and a synchronous throw propagates to the caller unchanged and leaves the instance usable. An asynchronous plugin is awaited before the first command runs. Its failure is wrapped once in an `Error` with code `ERR_PLUGIN_FAILED` and the original value as `cause`, fires `error` once, and makes every later `start`, `exec`, `execLine` and `use` fail with that same error. |
| `exec` | Runs argv programmatically, with no tokenizing. See [Programmatic execution](#programmatic-execution). |
| `execLine` | Runs a shell-language command line, with quoting and `\|` pipelines. See [Programmatic execution](#programmatic-execution). |
| `start` | Runs the CLI and resolves to the exit code. See [start](#start). |

#### `CLIOptions`

Every field is read once, when `createCLI` is called. There is no setter; `ctx.shell?.setPrompt(...)` changes the prompt of a running shell.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | — | Required. Application name, used in the help header, the default banner, and the default history path. Letters, digits, `.`, `_` and `-`, starting with a letter or digit. |
| `version` | `string` | — | Version string. When set, `--version` and `-V` are recognised as the sole token, and the help index lists them. |
| `prompt` | `string` | `"> "` | Prompt string for the interactive shell. |
| `description` | `string` | — | One-line description shown in the help header. |
| `banner` | `string` | `"<name> v<version>"`, or `"<name>"` when no version | Text printed when the interactive shell starts. Set to `""` to suppress it. |
| `historyFile` | `string` | `~/.<name>_history` | Path the interactive shell persists its history to. A lone `~`, a leading `~/` and a leading `~\` expand to the home directory. |
| `historySize` | `number` | `1000` | Maximum retained history entries. |
| `historyFilter` | [`HistoryFilter`](#historyfilter) | — | Rewrites a line before it is persisted. Return `null` to omit the line entirely. |

A non-string `name` throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`. An empty `name`, or one outside the character set above, throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`. An empty or non-string `historyFile`, a non-number `historySize` and a non-function `historyFilter` throw a `TypeError` with code `ERR_INVALID_ARG_TYPE`. A `historySize` that is not a non-negative safe integer throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

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

In direct mode the arguments arrive as an array, so they are never re-tokenized and a `|` character is an ordinary argument value. Pipelines exist only for command lines run through `execLine` or typed at the interactive prompt — see the next section and [Interactive shell](interactive-shell.md).

#### Programmatic execution

```typescript
exec(argv: readonly string[], options?: StdioOptions): Promise<void>
execLine(line: string, options?: StdioOptions): Promise<void>
```

`exec` runs `argv` as the command path followed by its arguments. The elements are used as is: nothing is tokenized and `|` is an ordinary character, so untrusted data belongs here. `[]` resolves without doing anything. A value that is not an array of strings throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.

`execLine` runs a shell-language line as if it had been typed at the interactive prompt. The line is tokenized (single quotes, double quotes, backslash escapes), and a top-level `|` splits it into a pipeline whose stages run concurrently. `""` resolves without doing anything. A value that is not a string throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`, and an unclosed quote rejects with `ParseError` unless a fallback handler takes the line. Untrusted data must not be interpolated into the line, since a `|` in it starts another command; pass it through `exec([...])` instead. Windows paths in a line are quoted or passed through `exec`.

Cancellation goes through `options.signal` only; the process's SIGINT is left to the host. An already-aborted signal rejects with `CancelledError` before anything runs, pending plugin initialization included. A command cancelled while it runs rejects with `CancelledError` and fires neither `commandError` nor `error`. A command that ignores the abort and finishes resolves.

Neither method emits the `exit` event on the normal path. Only `start` does, plus the force-quit path that terminates the process. Any other failure rejects the returned promise after the `commandError` and `error` events have fired.

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

Receives the raw input when no command matches it. Input that cannot be tokenized, such as an unclosed quote, reaches the handler as well instead of throwing. A throw or rejection is reported through the `error` event and rejects the execution; a cancellation of `ctx.signal` rejects with `CancelledError` instead.

### `FallbackContext`

```typescript
interface FallbackContext extends CommandStreams {
  readonly rawArgv: readonly string[] | null;
}
```

No command was resolved, so the context carries the execution's streams and signal, plus `rawArgv`: the whole argv when the execution was given an array (even when only a nested child was unknown), `null` for a command line string. As on `CommandContext`, it is the reversible form; the `input` string joins argv elements with spaces.

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
  completer(fnOrList: readonly string[] | Completer): this;
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
| `option` | Declares an option and returns the builder typed with it. See [Options](#options). |
| `action` | Sets the handler run when the command is invoked. |
| `completer` | Sets the tab-completion candidates for this command's arguments: a static list, or a [`Completer`](#completer). |
| `alias` | Adds alternative names. A name that belongs to another command or alias at the same level throws an error with code `ERR_DEFINITION_CONFLICT`. |
| `validate` | Sets a pre-action check. Throwing rejects the invocation before the action runs. |
| `onCancel` | Sets a handler invoked when the running command is cancelled. |
| `remove` | Unregisters the command. Returns `true` when it was found and removed. |
| `command` | Registers a subcommand and returns the builder of the subcommand. The same path merges into the existing subcommand. |

The definition string names the command and its positional arguments: `"deploy <env> [region]"`, `"db migrate"`, `"run <...tasks>"`. `<name>` is required, `[name]` is optional, and a leading `...` makes the argument variadic. Positional arguments are always strings — there is no type, default, coercion or `choices` for them. A variadic argument yields `string[]`. Command, alias and argument names are ASCII letters and digits in parts joined by single dashes (`dry-run`, `x1`); a name outside that rule, like a malformed definition, throws an error with code `ERR_INVALID_DEFINITION`. `ctx.args` keys an argument by the camelCase form of its name: `<file-name>` is `ctx.args.fileName`. See [Commands](commands.md).

A configuration call on a removed command throws an error with code `ERR_COMMAND_REMOVED`, so the builder of a removed command is unusable.

#### Typed arguments and options

For a literal definition string, the builder derives the types of `ctx.args` and `ctx.options` from the definition and from each `option` call.

| Source | Type in `ctx.args` |
| --- | --- |
| `<name>` | `string` |
| `[name]` | `string \| undefined` |
| `<...names>` and `[...names]` | `readonly string[]` |

Each key is the camelCase form of the argument name (`<file-name>` gives `fileName`). Leading path words, as in `"db migrate <target>"`, add no key.

An option contributes one key to `ctx.options`: the camelCase form of the first `--name` in its flags, or of the first short name when the flags have no long form (`--dry-run` gives `dryRun`, `-v` gives `v`). Its value type is chosen by precedence:

1. The elements of `choices`, as a union.
2. The awaited return type of `parse`, per element for an array type.
3. The schema `type`.
4. `string` when the flags carry a value placeholder, `boolean` when they do not.

The elements of `choices` must have the option's value type, so a `type: "number"` option takes numbers. `choices` cannot be empty and cannot be combined with `parse` or with a boolean option. `default` and the value passed to `validate` are typed by the value type, so a `default` of another type is a compile-time error. The key is optional unless the option is `required`, has a `default`, or is boolean. Defining the same key again replaces its entry in the type, as it replaces the option at run time. A definition or flags string that is not a literal widens the type to `Record<string, unknown>`.

```typescript
cli
  .command("deploy <env> [region]")
  .option("-p, --port <port>", { type: "number", default: 8080 })
  .option("--tag <tag>")
  .option("--force")
  .option("--dry-run")
  .action((ctx) => {
    ctx.args.env; // string
    ctx.args.region; // string | undefined
    ctx.options.port; // number
    ctx.options.tag; // string | undefined
    ctx.options.force; // boolean
    ctx.options.dryRun; // boolean
  });
```

A subcommand builder is typed from its own definition and does not inherit the options of its parent.

The builder that `option()` returns carries the new option in its type, while the builder it was called on keeps its previous type. Chain the call, or reassign the result.

#### Unreachable subcommands

A command that has both positional arguments and an action consumes every following token as an argument value, so its subcommands can never be dispatched. Calling `action` on such a command emits a process warning with the code `NODE_CLI_UNREACHABLE_SUBCOMMAND`, and registering a subcommand under one emits the same warning. Help output and tab completion omit subcommands in this state rather than advertising a path that would not dispatch.

#### validate

```typescript
validate(fn: CommandValidator<A, O>): this
```

Runs after options are resolved and before `beforeExecute`. A `CLIError` thrown here propagates unchanged and keeps its own class, code and exit code. A cancellation of `ctx.signal` stays a cancellation. Any other thrown value is wrapped in a `ValidationError` with the value as `cause`, the same as a failure of an option's own `parse` or `validate`.

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

One shape serves every completion hook: `builder.completer`, `OptionSchema.completer` and `ModeOptions.completer`. Each of the three also accepts a static `readonly string[]`. Candidates, from a list or a function alike, are filtered to those starting with `ctx.current` before being offered, so a provider may return its full list.

A completer is cut off when `ctx.signal` aborts at a 1000 ms deadline. A synchronous throw, a rejection or a timeout yields an empty candidate list and never leaves the prompt paused.

#### `CompletionContext`

| Field | Type | Description |
| --- | --- | --- |
| `line` | `string` | The active pipeline segment — the command the cursor is inside. |
| `fullLine` | `string` | The whole input line, earlier pipeline segments included. |
| `current` | `string` | The word under the cursor; `""` at a word boundary. |
| `commandPath` | `readonly string[]` | Canonical command path, with aliases resolved. |
| `args` | `Readonly<Record<string, string \| readonly string[]>>` | Positional arguments parsed so far, keyed by camelCase name: a raw string, or an array of raw strings for a variadic argument. |
| `options` | `Readonly<Record<string, string \| boolean \| readonly string[]>>` | Option values parsed so far, keyed like `ctx.options`, before coercion, defaults and validation: a raw string for a value option, `true` or `false` for a flag, an array of raw strings for an array option. |
| `iteration` | `number` | Count of consecutive Tab presses, starting at 1. Resets on any other input. |
| `signal` | `AbortSignal` | Aborted when the completion deadline expires. |

In a shell mode, `line` and `fullLine` are the whole input line, `commandPath` is empty, and `args` and `options` are empty.

## Chaining and repeated calls

Configuration methods return `this`, so calls chain: `CLI.on`, `off`, `fallback` and `use`, the `PluginContext` equivalents (which return the context), and the `CommandBuilder` setters. The exceptions:

| Method | Returns |
| --- | --- |
| `CommandBuilder.option()` | A builder typed with the added option. The receiver keeps its previous type, so chain the call or reassign the result. |
| `CommandBuilder.command()` | The builder of the subcommand, so the chain continues on the child. |
| `CommandBuilder.remove()` | A boolean, so the chain ends. |
| `CLI.command()`, `PluginContext.command()` | A `CommandBuilder`. |
| `CLI.exec()`, `CLI.execLine()`, `CLI.start()` | A promise. |
| `Shell.setPrompt()`, `Shell.enterMode()`, `Shell.exitMode()` | The shell, so calls chain. |
| `Shell.stop()` | `void`, since it ends the session. |
| `Logger.setLevel()` | The logger, so calls chain. |
| `Logger.child()` | A new `Logger`. |
| `Logger.flush()` | A promise. |
| Methods of `Bar`, `Spinner` and `MultiBar` | `void`. |

What a second call does with the same target depends on the method.

| Method | Repeated call |
| --- | --- |
| `CommandBuilder.description()` | Replaces the description. |
| `CommandBuilder.hidden()` | Replaces the setting. |
| `CommandBuilder.option()` | The same option name replaces the previous definition in place, and its type replaces the previous entry; a new name adds an option. |
| `CommandBuilder.action()` | Replaces the action. |
| `CommandBuilder.completer()` | Replaces the completer. |
| `CommandBuilder.alias()` | Adds to the existing aliases; duplicates are ignored. |
| `CommandBuilder.validate()` | Replaces the validator. |
| `CommandBuilder.onCancel()` | Replaces the handler. |
| `CommandBuilder.command()` | The same name merges into the existing subcommand. |
| `CommandBuilder.remove()` | Returns `false`. |
| `CLI.command()`, `PluginContext.command()` | The same path merges into the existing command. |
| `CLI.fallback()`, `PluginContext.fallback()` | Replaces the handler. |
| `CLI.on()`, `PluginContext.on()` | Adds another listener. |
| `CLI.off()`, `PluginContext.off()` | Removes the first matching registration; a handler that is not registered is ignored. |
| `CLI.use()` | Registers another plugin; bodies run in registration order. After an asynchronous plugin has failed, it throws that failure. |
| `CLI.start()` | Throws an error with code `ERR_ALREADY_STARTED`. |
| `Shell.setPrompt()` | Replaces the prompt. |
| `Shell.enterMode()` | Replaces the active mode and starts its in-memory history afresh. |
| `Shell.exitMode()` | Does nothing outside a mode. |
| `Shell.stop()` | Does nothing once the shell has stopped. |
| `Logger.setLevel()` | Replaces the level. |
| `Logger.child()` | Creates another child logger. |

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
| `args` | Positional arguments keyed by the camelCase argument name (`<file-name>` is `fileName`). |
| `options` | Resolved options keyed by the camelCase form of the option's first long name (`--dry-run` is `dryRun`), or of its first short name when it has no long form. |
| `rawInput` | For string input, the original string. For argv input, `argv.join(" ")`, which is lossy: an argument containing a space is indistinguishable from two arguments. |
| `rawArgv` | The exact argv elements for array input (`start`, `exec`), `null` for string input. This is the reversible form; use it when argument boundaries matter. |
| `commandPath` | The canonical path of the resolved command, for example `["db", "migrate"]`. Aliases are resolved to real names, so it does not depend on what the user typed. |
| `shell` | The running `Shell` in interactive mode; `null` in direct mode and in programmatic execution. |
| `signal` | Aborted when the command is cancelled. Pass it to abort-aware APIs such as `fetch` or timers. |
| `stdin` | The readable stream for this execution surface, or `null` when none applies. In the interactive shell it is the terminal the line editor shares: read it through `prompt.*`, never to EOF. |
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
| Interactive shell, command or mode action | `process.stdin`, the terminal shared with the line editor |
| Pipeline, first stage | The stream the surface supplied |
| Pipeline, later stages | The previous stage's output |
| Programmatic execution (`exec`, `execLine`) | `StdioOptions.stdin`, default `null` |

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
| `alias` | `string \| readonly string[]` | — | Extra one-character short names, written `"p"` or `"-p"`, merged with any declared in the flags string. A long alias is written in the flags string instead (`"--colour, --color"`). |
| `required` | `boolean` | `false` | Fails with `MissingOptionError` when the option is absent. |
| `default` | `unknown` | — | Value used when the option is absent, typed as the option's value. |
| `choices` | `readonly unknown[]` | — | Restricts the value, typed as the option's value (per element for an array type). The input is converted first and compared with `===`. Cannot be empty, and cannot be combined with `parse` or with a boolean option. |
| `parse` | function | — | Custom parser for an explicitly supplied value. Receives the raw string and the context, in which other options may still be unresolved. A returned promise is awaited. A thrown `CLIError` propagates unchanged, a cancellation stays a cancellation, and any other throw or rejection becomes a `ValidationError` whose `value` is the raw string. |
| `validate` | function | — | Custom check run after coercion, with the resolved value once every option is resolved. Throw or reject to refuse the value. A `CLIError` propagates unchanged, a cancellation stays a cancellation, and any other value becomes a `ValidationError`. |
| `hidden` | `boolean` | `false` | Omits the option from help output and tab completion. |
| `completer` | `readonly string[]` or [`Completer`](#completer) | — | Candidates offered for this option's value. Takes precedence over `choices` for completion. |

Rules that are easy to miss:

- A boolean option omitted from the input resolves to `false`, not `undefined`. The builder injects that default unless the option is `required`.
- Declaring `required: true` and a `default` on the same option throws `ERR_INVALID_DEFINITION` at definition time, since the default would make the requirement unsatisfiable.
- A `default` is an already-resolved value: a custom `parse` is not applied to it, and with a `parse` present the built-in coercion is skipped too. Without a `parse`, a `"8080"` on a `"number"` option from untyped JavaScript still resolves to `8080`.
- A `default` outside the declared `choices` throws `ERR_INVALID_DEFINITION` at definition time.
- `parse` replaces the built-in coercion entirely, so an option with a `parse` may resolve to any type, `Date` included.
- A `<number>` placeholder requires `type: "number"` or `"number[]"`, and a `<boolean>` placeholder requires `type: "boolean"`.
- `"number"` accepts ordinary decimal or scientific notation. A magnitude above `Number.MAX_SAFE_INTEGER` is rejected, because its digits cannot be represented exactly.
- A name or alias already used by another option of the command throws an error with code `ERR_DEFINITION_CONFLICT`. Malformed flags or a schema that contradicts them throw `ERR_INVALID_DEFINITION`.
- The first `--name` in a flags string is canonical, and later long names are aliases. `ctx.options` keys the option by the camelCase form of the canonical name; help, completion and error messages keep the flag spelling. Two options of one command whose camelCase keys coincide, such as `--dry-run` and `--dryRun`, throw `ERR_DEFINITION_CONFLICT`.
- Names, aliases included, are ASCII letters and digits in parts joined by single dashes. A schema `alias` is exactly one character.
- `--no-x` negates a boolean option `x`. An option declared as `--no-x` that has no `x` counterpart is an independent option whose key is `noX`.
- A schema shared between commands keeps its typing when written with `satisfies OptionSchema`. Annotating it as `OptionSchema` widens the option's value to `unknown`.

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

`--version` and `-V` are intercepted only when `version` was set on the CLI and only when the flag is the sole token of the input. There is no `-v` form. Without `version`, they are unknown options like any other undeclared top-level flag, and `--help <command>` or `-h <command>` at the top level shows that command's help, the same as `help <command>`.

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
| `error` | For any failure while handling input, including ones raised before a command resolves, such as command-not-found or a parse failure. Also once for a failed asynchronous plugin initialization. |
| `exit` | At most once, when `start` ends or a force-quit or the shell's SIGTERM ends the process. |

`commandError` and `error` **both** fire for a resolved command's failure: `commandError` carries the context, `error` is the catch-all. A handler that must see each failure exactly once should listen to one of them, not both. A cancellation is not a failure: when the running command is cancelled through `ctx.signal`, neither fires, and the execution rejects with `CancelledError`.

`exit` fires after a direct-mode command completes, throws or is force-quit; after a help index is printed for an argument-free non-terminal start; when plugin initialization fails; when the interactive shell ends or receives SIGTERM; and when a force-quit ends an `exec` or `execLine` call. Programmatic execution never fires it on the normal path. A signal the CLI does not handle — SIGTERM or SIGHUP in direct mode, SIGHUP in the shell — ends the process without running `exit` or cancel handlers.

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

The object handed to a function passed to `cli.use(...)`. It exposes only the extension surface — a plugin cannot start the CLI or change its options. Its setters return the context, so registrations chain. `command` merges into an existing command when the path is already registered.

### `Plugin`

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>
```

A synchronous plugin runs inside `use`; an asynchronous one is awaited before the first command runs.

Asynchronous plugin bodies run through one serial queue, so registration order is deterministic even when an earlier plugin awaits I/O. An asynchronous failure is wrapped once in an `Error` with code `ERR_PLUGIN_FAILED` and the original value as `cause`. `error` fires once, `start` reports it and emits `exit`, and every later `use`, `exec` and `execLine` rejects with the same error. A synchronous throw inside `use` propagates to the caller as is and leaves the CLI usable. See [Events and plugins](events-and-plugins.md).

## Interactive shell

### `Shell`

Type-only. The running instance is reached through `ctx.shell`, which is `null` outside the interactive shell.

```typescript
interface Shell {
  setPrompt(text: string): this;
  enterMode(options: ModeOptions): this;
  exitMode(): this;
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

### `ModeOptions`

```typescript
interface ModeOptions {
  prompt: string;
  action: ModeAction;
  banner?: string;
  completer?: readonly string[] | Completer;
  history?: "session" | "none";
}
```

| Field | Default | Description |
| --- | --- | --- |
| `prompt` | — | Prompt string shown while the mode is active. |
| `action` | — | Handler for each submitted line, a [`ModeAction`](#modeaction). A mode does not dispatch through the command registry. |
| `banner` | — | Text printed once when the mode is entered. |
| `completer` | — | Mode-specific completion: a static list, or a [`Completer`](#completer) called with a `CompletionContext` whose `commandPath` is empty. Either is filtered by prefix against `ctx.current`. Without one, Tab offers nothing: top-level command completion is not offered inside a mode. Cut off at 1000 ms like every other provider. |
| `history` | `"session"` | `"session"` keeps mode input in memory for the duration of the mode; `"none"` disables it. Mode input is never written to the on-disk history file. |

Inside a mode, `exit` and `quit` always leave the mode rather than the shell. The first Ctrl-C aborts `ctx.signal`; a second force-quits the process with status 130. SIGTERM follows the same cooperative path, then saves history, emits `exit`, and exits with status 143 after a 200 ms grace period.

### `ModeAction`

```typescript
type ModeAction = (input: string, ctx: ModeContext) => void | Promise<void>
```

Receives each line submitted inside a mode. A throw or rejection is reported on stderr and the shell stays in the mode.

### `ModeContext`

```typescript
interface ModeContext extends CommandStreams {}
```

The context passed to a mode's action: the shell's streams and the signal that aborts the action. `stdin` is the terminal the line editor shares, so `prompt.text("…", ctx)` works inside a mode; read it through `prompt.*`, never to EOF.

## Colour and terminal text

### `color`

```typescript
const color: Colorizer
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
type Colorizer = { readonly [K in StyleName]: ColorFn }
```

`StyleName` is the union of the names in the table below. `StyleSpec` is a style or a dot-separated chain of styles, as taken by options such as `style` on a progress bar or `borderStyle` on a table. The type system checks the first two links of a chain; any further link is checked when the value is used. `ColorFn` is the chainable callable and `Colorizer` is the object behind `color` and `createColorizer`.

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
function isStyleName(value: unknown): value is StyleName
```

Reports whether `value` is a built-in style name. Any other value, a non-string included, yields `false`, and inherited members such as `toString` do not qualify.

### `colorTag`

```typescript
const colorTag: ColorTag
```

A tagged template that applies styles with `{styleName text}` markup, bound to `process.stdout`. Style names chain with dots, and markup nests.

```typescript
import { colorTag } from "@libraz/node-cli";

const message = "disk full";

colorTag`Status: {green OK}`;
colorTag`{bold.red Error}: ${message}`;
colorTag`{dim outer {cyan inner} outer}`;
```

Unlike `color`, the tag never throws on an unknown name: an unknown style name, an unclosed brace or a missing space renders literally. Interpolated values are inserted verbatim and never parsed as markup, so a value that itself contains `{green ...}` is not treated as markup. With colour disabled the markup is removed and plain text is returned. Nesting deeper than 64 levels throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### `ColorTag`

```typescript
type ColorTag = (strings: TemplateStringsArray, ...values: unknown[]) => string
```

The type of `colorTag` and of every tag `createColorTag` returns.

### `createColorTag`

```typescript
function createColorTag(stream: Writable): ColorTag
```

Returns a tag with the semantics of `colorTag` whose enablement is decided from `stream`, so escapes are emitted only when colour is enabled for that stream.

```typescript
const e = createColorTag(process.stderr);
process.stderr.write(e`{bold.red Error}: something went wrong\n`);
```

### `createColorizer`

```typescript
function createColorizer(stream: Writable): Colorizer
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

When the answer is `false`, every style is dropped, modifiers such as `bold` and `underline` included: `NO_COLOR` and `setColorEnabled(false)` stop all styling, not only colours.

### `setColorEnabled`

```typescript
function setColorEnabled(value: boolean | "auto"): void
```

`true` and `false` pin the answer for the whole process. `"auto"` clears the override and restores automatic detection. The override is the right tool for a test that asserts on plain text. A value that is neither a boolean nor a string throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`, and a string other than `"auto"` throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

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
function splitAnsi(text: string): readonly AnsiSegment[]

interface AnsiSegment {
  ansi: boolean;
  text: string;
}
```

Splits the input into ordered runs of escape sequences (`ansi: true`) and visible text (`ansi: false`), using the same recognizer as `stripAnsi`. Concatenating every segment's `text` reproduces the input, which is what lets a consumer transform only the visible parts.

### `splitGraphemes`

```typescript
function splitGraphemes(text: string): readonly string[]
```

Splits visible text into user-perceived grapheme clusters, so an emoji with a modifier counts as one unit. The input must not contain escape sequences, which would be split like any other text: split with `splitAnsi` first and pass only the segments whose `ansi` is `false`.

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

### `isTTY`

```typescript
function isTTY(value: unknown): boolean
```

Reports whether a value is an object whose `isTTY` is `true`; any other value, a non-object included, yields `false`. See [TTY](glossary.md#tty).

See [Colour](color.md) for narrative coverage.

## Tables

### `table`

```typescript
function table<T extends object>(
  data: readonly T[],
  options?: TableOptions<T>,
): string
```

Renders rows as an aligned string with no trailing newline. Accepts an array of objects or an array of arrays. The result is returned, never written. Rows may be plain objects, interface-typed values or class instances.

`table` never wraps. A cell wider than its column is truncated with the ellipsis, newlines and tabs inside a cell have already been collapsed to spaces, and the total width is never clamped to the terminal — a wide table wraps in the terminal rather than being reflowed.

An unknown border or style name, or a number outside its range, throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`. A value of the wrong type, including a `columns` entry that is neither a string nor a `ColumnSpec`, throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.

#### Columns

`columns` takes strings and [`ColumnSpec`](#columnspec) objects. A string is shorthand for `{ key }`.

| Data shape | Columns |
| --- | --- |
| Array of objects, no `columns` | The union of every row's own property names, in first-seen order. |
| Array of objects, with `columns` | Exactly the listed columns; `key` selects the property. |
| Array of arrays, no `columns` | Row 0 is the header; columns are matched by position and keyed `"0"`, `"1"`, … |
| Array of arrays, with `columns` | Columns are matched by position and a `ColumnSpec` carries no `key`. Row 0 is then data, not a header. |

### `TableOptions`

```typescript
interface TableOptions<T extends object = Record<string, unknown>> {
  columns?: readonly (string | ColumnSpec<T>)[]; // a string is keyof T & string for object rows
  header?: boolean;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;
  borderStyle?: StyleSpec;
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
| `border` | `"none"` | Border preset. Supplying `chars` without `border` implies `"custom"`. `chars` and `rowSeparators` are ignored with `"none"`. |
| `chars` | — | Border glyph overrides. `"custom"` starts from the `"single"` preset. Every glyph is one terminal column wide, otherwise a `RangeError` with code `ERR_INVALID_ARG_VALUE` is thrown; the edge fills `top`, `bottom` and `horizontal` may also be `""` to omit that line. With `border: "simple"`, `vertical` and `cross` may be any string. |
| `borderStyle` | — | Style of the border glyphs, such as `"dim"` or `"cyan.bold"`. `border` chooses the shape; `borderStyle` chooses colour and modifiers. |
| `headerStyle` | `"bold"` | Style of the header text; `"none"` leaves it plain. |
| `paddingLeft` | `1` with a frame (`rounded`, `single`, `double`, `custom`); `0` with `none` and `simple` | Spaces inside each cell, left. |
| `paddingRight` | Same rule as `paddingLeft` | Spaces inside each cell, right. |
| `gap` | `2` | Spaces between columns of a borderless table. Applies only with `border: "none"`. |
| `rowSeparators` | `false` | Draws a separator line between data rows. |
| `ellipsis` | `"…"` | Marker appended to a truncated cell. |
| `stream` | `process.stdout` | Decides whether colour is emitted in the returned string. `table` returns the text and never writes it, so pass the stream the result will be printed to. |

### `ColumnSpec`

```typescript
type ColumnSpec<T extends object = Record<string, unknown>> = {
  key: keyof T & string; // object rows only; array rows have no key
  label?: string;
  align?: "left" | "right" | "center";
  width?: number;
  maxWidth?: number;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `key` | — | Property to read for object rows, typed as `keyof T & string`. Array rows are matched by position and have no `key`. |
| `label` | `key` | Header text. |
| `align` | `"left"` | Alignment of the header and the cells. |
| `width` | Auto | Fixed width of the column content, padding excluded, as a positive integer. Wins over `maxWidth`. |
| `maxWidth` | — | Upper bound on the content width, padding excluded: a positive integer or `Infinity`. |

`width` and `maxWidth` both count content columns, so padding never reduces the room for text. A cell wider than the content width is truncated with the ellipsis, and every border mode renders the padding on top of it.

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

Every indicator defaults to `process.stderr`, which keeps progress output out of a redirected stdout. An indicator starts drawing when it is created, and every terminal verb (`succeed`, `fail`, `warn`, `stop`) ends it. Any method called afterwards does nothing. A command context can be passed as the options object (`progress.spinner(ctx)`), which draws to its `stderr`.

The three verbs `succeed`, `fail` and `warn` replace the indicator with a result line: a green `✔`, a red `✖` or a yellow `⚠`, followed by `message`, which defaults to the label. Where the stream cannot draw symbols (it is not a terminal, or `TERM=dumb`), the line starts with the ASCII tag `[OK]`, `[ERROR]` or `[WARN]` instead. Colour is decided separately by [`isColorEnabled`](#iscolorenabled). `stop` leaves the last frame in place and ends the line.

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
| `filled` | `string` | `"█"` | Glyph for the filled portion. Its display width must be `1`. |
| `empty` | `string` | `"░"` | Glyph for the empty portion. Its display width must be `1`. |
| `format` | `(state: BarState) => string` | — | Replaces the whole rendered line, so `width`, `filled`, `empty` and `style` are not used; `label` still supplies the default result message. The result is reduced to one terminal-safe line. If it throws, the bar (or its group) releases the terminal, becomes inert, and the error propagates from the call that triggered the redraw. |
| `stderr` | `Writable` | `process.stderr` | Output stream. |
| `style` | [`StyleSpec`](#style-types) | — | Style applied to the bar, such as `"green"` or `"bold.cyan"`. An unknown name throws at creation. |

An invalid option throws a `TypeError` with code `ERR_INVALID_ARG_TYPE` or a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

#### `Bar`

| Method | Description |
| --- | --- |
| `update(current: number)` | Sets progress to an absolute value, clamped to `0`–`total`. A `NaN` or infinite value is ignored. A non-number throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`. |
| `tick(delta?: number)` | Adds `delta`, default `1`, clamped to `0`–`total`. A `NaN` or infinite result is ignored. |
| `setLabel(label: string)` | Replaces the label drawn before the bar and used as the default result message. |
| `succeed(message?: string)` | Sets progress to `total` and ends the bar with a `✔` result line. |
| `fail(message?: string)` | Ends the bar at its current position with a `✖` result line. |
| `warn(message?: string)` | Ends the bar at its current position with a `⚠` result line. |
| `stop()` | Leaves the last frame in place and ends the line. In a `MultiBar` it freezes that bar's row; the group's verbs then skip it. |
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
  readonly current: number;
  readonly total: number;
  readonly percent: number; // integer, 0 to 100; 100 when total is 0
  readonly elapsedMs: number; // ms since the bar was created
  readonly etaMs: number; // ms remaining; Infinity until some progress is made, 0 once complete
  readonly ratePerSecond: number; // units per second
}
```

Guard `etaMs` with `Number.isFinite` before formatting it.

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
| `stderr` | `Writable` | `process.stderr` | Output stream. |
| `style` | [`StyleSpec`](#style-types) | — | Style applied to the frame. An unknown name throws at creation. |

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

A bar or spinner writing to a non-terminal stream emits nothing while it runs, and `stop` writes nothing, so a redirected log does not fill with control sequences. `succeed`, `fail` and `warn` always write their one result line. That makes an indicator safe to leave in a script whose output is captured: the outcome is recorded, the animation is not. The same holds when `TERM=dumb`.

### progress.multi

```typescript
progress.multi(options?: MultiBarOptions): MultiBar
```

#### `MultiBarOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `stderr` | `Writable` | `process.stderr` | Stream shared by every bar in the group. |

The group claims its stream when it is created. One frame cannot be split across terminal regions, so `add` takes no `stderr`.

#### `MultiBar`

| Method | Description |
| --- | --- |
| `add(options: Omit<BarOptions, "stderr">): Bar` | Adds a bar drawn in the group's stream and returns its handle. |
| `succeed(message?: string)` | Ends every unfinished bar with `✔` and closes the group. |
| `fail(message?: string)` | Ends every unfinished bar with `✖` and closes the group. |
| `warn(message?: string)` | Ends every unfinished bar with `⚠` and closes the group. |
| `stop()` | Leaves the last frame in place and closes the group. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

On a group method, `message` is written as one unmarked final line. On a non-terminal stream, each bar's result line is written as the bar ends.

`add` called after the group is closed returns an inert bar whose methods are no-ops, so a worker that adds a bar just after `finally { multi.stop() }` does not fail.

Two standalone indicators cannot render to the same terminal stream at once — the second throws an error with code `ERR_OUTPUT_BUSY` that names the kind of indicator already holding the stream, because neither can know the other's row layout. Concurrent bars belong in a `multi` group.

### progress.releaseAll

```typescript
progress.releaseAll(): void
```

Stops every indicator that is still active in the process, whichever command created it, and restores the terminal cursor. Command execution releases only the indicators its own command created, so a command that ends does not remove another command's spinner. Call `releaseAll` for an explicit process-wide reset.

See [Progress](progress.md) for worked usage.

## Prompts

Prompts ask on stderr, so a question never pollutes a redirected stdout. Every prompt rejects with `CancelledError` on Ctrl-C or when `signal` aborts, and the `cause` of the latter is the signal's reason; an already-aborted `signal` rejects immediately. Every prompt rejects with `InputEndedError` when `stdin` is `null`, or when the input ends (Ctrl-D) before an answer, also while re-asking. A read error on the input stream rejects with the stream's own error. A `validate` that throws is not a rejection: the message is shown and the prompt asks again. A message and a `marker` are rendered on one line: a newline becomes a space and cursor control is removed.

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
| `stdin` | `process.stdin` | Where the answer is read. Omitting it selects `process.stdin`; `null` means no input, and the prompt rejects with `InputEndedError` before writing the question. |
| `stderr` | `process.stderr` | Where the question is written. |
| `signal` | — | Aborting rejects the pending prompt with `CancelledError`. |
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
prompt.select<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options?: SelectOptions<NoInfer<T>>,
): Promise<T>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `T` | — | Value returned for an empty submission. Matched by identity against a choice's `value`, or against the choice object itself. A `default` that matches no choice throws a `RangeError` with code `ERR_INVALID_ARG_VALUE` before the question is written. |

Choices are answered by their displayed number, or by typing a label, matched case-insensitively. A number within the range of the list always selects by number, so a numeric-looking label stays reachable by its position; any other input is matched against the labels. An empty `choices` array throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

### prompt.multiselect

```typescript
prompt.multiselect<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options?: MultiselectOptions<NoInfer<T>>,
): Promise<readonly T[]>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `readonly T[]` | — | Pre-selected values, returned for an empty submission. Each element must match a choice, otherwise a `RangeError` with code `ERR_INVALID_ARG_VALUE` is thrown before the question is written. |
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

type Choice<T> = SelectChoice<T> | Exclude<T, { label: unknown }>;
```

A choice is either a bare value or a descriptor. A descriptor with a `label` but no `value` throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`, so an ordinary domain object that happens to carry a `label` property is never silently turned into `undefined`. A bare value object that has a `label` member is a type error: wrap it as `{ label, value }`.

See [Prompts](prompts.md) for worked usage.

## Logging

### `createLogger`

```typescript
function createLogger(options?: LoggerOptions): Logger
```

Every level — `info` and `success` included — is written to one stream, which defaults to `process.stderr`. There is no level-based routing between stdout and stderr. The stream is set with the `stderr` option, and a command context can be passed as the options object (`createLogger({ ...ctx, prefix: "deploy" })`). To put log output on stdout, pass `stderr: process.stdout`.

An unknown `level` or an invalid `bufferLimit` throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`.

#### `LoggerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `"info"` | Minimum level. Lower levels are dropped. |
| `prefix` | `string` | — | Bracketed prefix on each line. |
| `timestamp` | `boolean` | `false` | Prepends `HH:MM:SS`. |
| `stderr` | `Writable` | `process.stderr` | Output stream. |
| `bufferLimit` | `number` | `1000` | Lines queued while the stream is backpressured. When full, the oldest queued line is dropped; `0` drops every line written while the stream is backpressured, until it drains. Must be a non-negative safe integer. |

#### `Logger`

| Method | Gated at | Symbol | ASCII tag |
| --- | --- | --- | --- |
| `debug(message, ...args)` | `debug` | `●` | `[DEBUG]` |
| `info(message, ...args)` | `info` | `ℹ` | `[INFO]` |
| `success(message, ...args)` | `info` | `✔` | `[OK]` |
| `warn(message, ...args)` | `warn` | `⚠` | `[WARN]` |
| `error(message, ...args)` | `error` | `✖` | `[ERROR]` |

`success` is not a level of its own: it is gated at `info`, so setting the level to `warn` silences it.

The symbol is used when the stream is a terminal and `TERM` is not `dumb`; otherwise the ASCII tag is used. Colour is decided separately by [`isColorEnabled`](#iscolorenabled) and applies to either, so `NO_COLOR` on a terminal keeps the symbol, and `FORCE_COLOR` on a pipe colours the tag.

Messages go through the `format` function of `node:util`, so `%s`, `%d` and `%j` placeholders work and a non-string first argument is rendered rather than passed through.

| Method | Description |
| --- | --- |
| `setLevel(level: LogLevel)` | Changes the minimum level at runtime and returns the logger. |
| `child(prefix: string): Logger` | Creates a child whose prefix is `parent:child`. Without its own level it follows the parent's current level, so a later `parent.setLevel(...)` reaches it. |
| `flush(): Promise<void>` | Resolves once queued lines have reached the stream, every child's included. Rejects if the stream errors or closes first. After a stream failure the logger and its children become no-ops: later lines are dropped silently and the failure is reported only through `flush()`. |

### `LogLevel`

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

`"silent"` suppresses every level. See [Logging](logging.md).

### `isLogLevel`

```typescript
function isLogLevel(value: unknown): value is LogLevel
```

Reports whether `value` is one of the `LogLevel` strings. Any other value, a non-string included, yields `false`.

## Errors

### `CLIError`

```typescript
class CLIError extends Error {
  readonly code: CLIErrorCode | (string & {});
  readonly exitCode: number;
  constructor(message: string, options?: CLIErrorOptions);
}
```

The base class for every error the framework raises about user input, and for errors an application raises itself. `code` is machine-readable and defaults to `"FAILED"`, which is not a member of `CLIErrorCode`. `exitCode` is the process status the failure implies, an integer from `1` to `255`, defaulting to `1`; `cause` is forwarded to `Error`. An application subclass may carry a code of its own.

```typescript
throw new CLIError("Deployment target is locked", { code: "LOCKED", exitCode: 75 });
```

A non-number `exitCode` throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`. An `exitCode` that is not an integer from `1` to `255` throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`, since `0` reads as success and `256` wraps to `0` on POSIX systems.

### `CLIErrorOptions`

```typescript
interface CLIErrorOptions {
  code?: CLIErrorCode | (string & {});
  exitCode?: number;
  cause?: unknown;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `code` | `"FAILED"` | Machine-readable error code. |
| `exitCode` | `1` | Process exit status, an integer from `1` to `255`. |
| `cause` | — | The underlying error, forwarded to `Error`. |

### `CLIErrorCode`

```typescript
type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_FAILED"
  | "PARSE_FAILED"
  | "CANCELLED"
  | "INPUT_ENDED";
```

### Subclasses

Every subclass constructor takes its subject first and an options object last. The options object is optional, and every one accepts `cause`.

| Class | Constructor | `code` | `exitCode` | Extra fields | Raised when |
| --- | --- | --- | --- | --- | --- |
| `CommandNotFoundError` | `(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `64` | `input`, `available?` | No command matches the input, or a command group is given an unknown child. |
| `MissingArgumentError` | `(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `64` | `argName`, `usage?` | A required positional argument is absent, or a required variadic receives zero values. |
| `ExtraArgumentError` | `(extras, { usage?, cause? })` | `EXTRA_ARGUMENT` | `64` | `extras`, `usage?` | More positional values are supplied than the command declares. `extras` is a non-empty `readonly string[]`; an empty array throws a `RangeError` with code `ERR_INVALID_ARG_VALUE`. |
| `MissingOptionError` | `(optionName, { usage?, cause? })` | `MISSING_OPTION` | `64` | `optionName`, `usage?` | A `required` option is absent. |
| `InvalidOptionError` | `(message, { optionName?, value?, usage?, cause? })` | `INVALID_OPTION` | `64` | `optionName?`, `value?`, `usage?` | A value fails built-in coercion or a `choices` check, or an option is used in a form it does not accept. |
| `UnknownOptionError` | `(flag, { usage?, cause? })` | `UNKNOWN_OPTION` | `64` | `flag`, `optionName`, `usage?` | A flag is not declared by the command. `flag` is the one unknown flag in normalized form (`--xyz=3` is `--xyz`, and an unknown `x` inside the cluster `-vx` is `-x`); `optionName` is the flag without its leading dashes. |
| `ValidationError` | `(message, { optionName?, value?, usage?, cause? })` | `VALIDATION_FAILED` | `64` | `optionName?`, `value?`, `usage?` | An option's own `parse` or `validate` throws or rejects, or the command's `validate` throws a value that is not a `CLIError`. |
| `ParseError` | `(message, { quote?, cause? })` | `PARSE_FAILED` | `64` | `quote?` | The input cannot be tokenized or split into pipeline stages. |
| `CancelledError` | `({ cause? })` | `CANCELLED` | `130` | — | A prompt is cancelled with Ctrl-C or an aborted signal, or a running command is cancelled through its signal. `cause` is the signal's reason when there is one. |
| `InputEndedError` | `(promptMessage, { cause? })` | `INPUT_ENDED` | `66` | `promptMessage` | A prompt has no input to read: `stdin` is `null`, or the input ends before an answer. |

`ValidationError` wraps failures of an option's `parse` or `validate` and of `CommandBuilder.validate()`, except that a thrown `CLIError` propagates unchanged with its own class, code and exit code, and a cancellation stays a `CancelledError`. For an option, `optionName` is set, `value` is the raw input string when `parse` failed or the value passed to `validate` when that failed, and `cause` holds the original value.

`optionName` is the canonical long name without dashes, in its kebab-case spelling (`dry-run`); the option's key in `ctx.options` is the camelCase form (`dryRun`). `UnknownOptionError.optionName` has no definition behind it, so it is the typed flag without its dashes.

An error raised while a command is being resolved carries `usage`, the command's usage line, and appends `\n\n  Usage: <usage>` to its message. Messages quote what the user typed and leave names the application defined bare: `Unknown option: "--x"`, `Missing required option: --x`. Messages of API misuse (see `UsageErrorCode`) quote the application's names as well, in the manner of Node's own errors.

`ParseError` covers an unclosed quote (`quote` is `"single"` or `"double"` and names which one), an empty or trailing pipe, and an unsupported redirection operator. It is raised before a command is resolved, so a registered `fallback` handler receives the input instead of the error being thrown.

The user-input classes carry exit code `64`, the conventional status for a command-line usage error. `InputEndedError` carries `66` (no input), and `CancelledError` carries `130`, the conventional status for an interrupted program. A bare `CLIError` defaults to `1`, as does any other value an action throws. The interactive shell's SIGTERM path exits `143`. See [Exit code](glossary.md#exit-code).

The class names `ValidationError` and `ParseError` map to the codes `VALIDATION_FAILED` and `PARSE_FAILED`; every other code spells its class name in upper snake case.

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
  | CancelledError
  | InputEndedError;
```

The union of the ten classes above, discriminated by `code`.

### `isBuiltinCLIError`

```typescript
function isBuiltinCLIError(e: unknown): e is BuiltinCLIError
```

Reports whether a value is one of the ten built-in subclasses. A bare `CLIError` and application subclasses do not match; test those with `instanceof`.

```typescript
import { isBuiltinCLIError } from "@libraz/node-cli";

try {
  await cli.exec(["deploy"]);
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
  | "ERR_INPUT_BUSY"
  | "ERR_PLUGIN_FAILED";
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
| `ERR_PLUGIN_FAILED` | `Error` | An asynchronous plugin failed during initialization. `cause` holds the original value. |

### `formatErrorMessage`

```typescript
function formatErrorMessage(err: unknown): string
```

Renders any thrown value as user-facing text, which may span several lines: the `Error`'s message, otherwise the string itself for a string and `util.inspect` output for any other value. The text is sanitized for a terminal, as the framework's own `Error:` line is: control sequences and hyperlinks are removed, styling is closed, and newlines are kept.

### `isCancellationError`

```typescript
function isCancellationError(err: unknown, signal: AbortSignal): boolean
```

Reports whether a failure is a user-initiated cancellation rather than a genuine fault. A `CancelledError` always qualifies. A bare `AbortError` qualifies **only** when `signal` is aborted — without that evidence there is no way to tell whose cancellation it was, and an unrelated aborted request would be misreported as the user pressing Ctrl-C.

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
function tokenize(input: string): readonly string[]
```

Splits one command into argv-style tokens, honouring single quotes, double quotes and backslash escapes. It does not handle pipelines: `|` is an ordinary character here, while `execLine` splits a line at an unquoted `|` first, so `exec(tokenize(line))` differs from `execLine(line)` whenever the line contains one. A non-string throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`, and an unclosed quote throws `ParseError`. It is exported so an integration can reuse the framework's exact behaviour; ordinary applications do not need it.

## Environment variables

| Variable | Effect |
| --- | --- |
| `NO_COLOR` | Any non-empty value disables colour, unless `setColorEnabled(true)` was called. |
| `FORCE_COLOR` | `"0"` or `"false"` disables colour; any other non-empty value enables it, overriding both `TERM=dumb` and a non-terminal stream. |
| `TERM` | `TERM=dumb` disables colour, unless `FORCE_COLOR` says otherwise. |
| `NODE_CLI_DEBUG` | `NODE_CLI_DEBUG=1` prints the full stack trace of a fatal error, followed by each `cause` in its chain, instead of the usual `Error: <message>` line. |

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
| `ModeOptions` | type | [Interactive shell](#modeoptions) |
| `ModeAction` | type | [Interactive shell](#modeaction) |
| `ModeContext` | type | [Interactive shell](#modecontext) |
| `tokenize` | function | [Low-level parsing helper](#tokenize) |
| `color` | value | [Colour and terminal text](#color) |
| `StyleName` | type | [Colour and terminal text](#style-types) |
| `StyleSpec` | type | [Colour and terminal text](#style-types) |
| `ColorFn` | type | [Colour and terminal text](#style-types) |
| `Colorizer` | type | [Colour and terminal text](#style-types) |
| `ColorTag` | type | [Colour and terminal text](#colortag) |
| `isStyleName` | function | [Colour and terminal text](#isstylename) |
| `colorTag` | value | [Colour and terminal text](#colortag) |
| `createColorTag` | function | [Colour and terminal text](#createcolortag) |
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
| `isTTY` | function | [Colour and terminal text](#istty) |
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
| `isLogLevel` | function | [Logging](#isloglevel) |
| `CLIError` | class | [Errors](#clierror) |
| `CLIErrorCode` | type | [Errors](#clierrorcode) |
| `CLIErrorOptions` | type | [Errors](#clierroroptions) |
| `CommandNotFoundError` | class | [Errors](#subclasses) |
| `MissingArgumentError` | class | [Errors](#subclasses) |
| `ExtraArgumentError` | class | [Errors](#subclasses) |
| `MissingOptionError` | class | [Errors](#subclasses) |
| `InvalidOptionError` | class | [Errors](#subclasses) |
| `UnknownOptionError` | class | [Errors](#subclasses) |
| `ValidationError` | class | [Errors](#subclasses) |
| `ParseError` | class | [Errors](#subclasses) |
| `CancelledError` | class | [Errors](#subclasses) |
| `InputEndedError` | class | [Errors](#subclasses) |
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

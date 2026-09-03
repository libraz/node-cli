# API reference

Every public symbol is exported from the package root. There are no subpath exports.

```typescript
import { createCLI, table, progress, prompt, logger } from "@libraz/node-cli";
```

The package is ESM only and requires Node 22 or newer.

## Contents

- [Type-only exports](#type-only-exports)
- [Creating a CLI](#creating-a-cli)
- [Defining commands](#defining-commands)
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
- [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers)
- [Environment variables](#environment-variables)
- [Export index](#export-index)

## Type-only exports

Some exports are TypeScript types, not values. They exist for annotating variables and are erased at runtime: `import { Shell } from "@libraz/node-cli"` fails, and `new Shell(...)` is not possible.

The type-only exports are `ExecOptions`, `PluginContext`, `CLIErrorCode`, `AnsiSegment`, `Logger`, `LoggerOptions`, `LogLevel`, `Bar`, `BarOptions`, `BarState`, `MultiBar`, `Spinner`, `SpinnerOptions`, `Choice`, `ConfirmOptions`, `MultiselectOptions`, `PasswordOptions`, `PromptBaseOptions`, `SelectChoice`, `SelectOptions`, `TextOptions`, `TableChars`, `TableOptions`, `TableStyle`, `CompletionResult`, `ModeConfig`, `Shell`, `Action`, `CatchContext`, `CLIEventHandler`, `CLIEventMap`, `CLIOptions`, `CommandContext`, `Completer`, `CompletionContext` and `OptionSchema`.

In particular `Shell`, `ModeConfig`, `CompletionResult` and every options or result interface are type-only. A `Shell` is never constructed by application code; the running instance is reached through `ctx.shell` inside a command action.

```typescript
import type { CommandContext, Shell } from "@libraz/node-cli";

function useShell(ctx: CommandContext): void {
  const shell: Shell | null = ctx.shell;
  shell?.setPrompt("app> ");
}
```

## Creating a CLI

### `createCLI`

```typescript
function createCLI(options?: CLIOptions): CLI
```

Constructs a `CLI`. Equivalent to `new CLI(options)`.

### `CLI`

```typescript
class CLI {
  constructor(options?: CLIOptions);
}
```

#### `CLIOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | `"cli"` | Application name, used in the help header, the default banner, and the default history path. |
| `version` | `string` | — | Version string. When set, `--version` and `-V` are recognised as the sole token, and the help index lists them. |
| `prompt` | `string` | `"> "` | Prompt string for the interactive shell. |
| `description` | `string` | — | One-line description shown in the help header. |
| `banner` | `string` | `"<name> v<version>"`, or `"<name>"` when no version | Text printed when the interactive shell starts. Set to `""` to suppress it. |
| `historyFile` | `string` | `~/.<name>_history` | Path the interactive shell persists its history to. |
| `historySize` | `number` | `1000` | Maximum retained history entries. |
| `historyFilter` | `(line: string) => string \| null` | — | Rewrites a line before it is persisted. Return `null` to omit the line entirely. |

#### Methods

```typescript
command(definition: string): CommandBuilder
prompt(text: string): this
description(text: string): this
banner(text: string): this
history(filePath: string): this
historySize(size: number): this
historyFilter(filter: (line: string) => string | null): this
on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this
off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this
catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): this
use(plugin: (ctx: PluginContext) => void | Promise<void>): this
start(argv?: string[]): Promise<void>
```

`exec` completes the list and has its own entry below.

| Method | Description |
| --- | --- |
| `command` | Registers a command from a definition string and returns a [`CommandBuilder`](#commandbuilder). |
| `prompt` | Sets the interactive-shell prompt string. |
| `description` | Sets the help-header description. |
| `banner` | Sets the interactive-shell banner. `""` suppresses it. |
| `history` | Sets the history file path. |
| `historySize` | Sets the maximum number of retained history entries. |
| `historyFilter` | Sets the redaction filter applied before a line is written to history. |
| `on` / `off` | Adds or removes a lifecycle listener. See [`CLIEventMap`](#clieventmap). |
| `catch` | Sets the fallback handler invoked when no command matches the input. Only one handler is held; a later call replaces it. |
| `use` | Registers a plugin. Plugin bodies run in registration order, and an asynchronous plugin is awaited before any command runs. |
| `start` | Runs the CLI. Throws if called twice on the same instance. |

#### start

```typescript
start(argv?: string[]): Promise<void>
```

`argv` defaults to `process.argv.slice(2)`. The mode is chosen from what it contains.

| Input | Behaviour |
| --- | --- |
| One or more arguments | Direct mode: the arguments are dispatched as one command, then `exit` is emitted. |
| Arguments that contain no command (only empty strings, or a lone `--`) | The help index is printed, then `exit` is emitted. |
| No arguments, and both stdin and stdout are terminals | The interactive shell starts. `exit` is emitted when the shell ends. |
| No arguments, and either stream is not a terminal | The help index is printed, then `exit` is emitted. |

In direct mode the arguments arrive as an array, so they are never re-tokenized and a `|` character is an ordinary argument value. Pipelines exist only for string input — see the next section and [Interactive shell](interactive-shell.md).

A failure in direct mode is written to stderr and sets `process.exitCode` to the code the error implies. See [Errors](errors.md).

#### Programmatic execution

```typescript
exec(input: string, options?: ExecOptions): Promise<void>
```

Runs `input` as if it had been typed at the interactive prompt: the string is tokenized, and a top-level `|` splits it into a pipeline whose stages run concurrently.

This method does **not** emit the `exit` event on the normal path. Only `start()` does, plus the force-quit path that terminates the process. A rejection propagates the error to the caller after the `commandError` and `error` events have fired.

`ctx.shell` is always `null` here, so a command that reaches for `ctx.shell.enterMode(...)` must guard for it.

##### `ExecOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `stdin` | `Readable \| null` | `null` | Stream exposed as `ctx.stdin` to the first pipeline stage. |
| `stdout` | `Writable` | `process.stdout` | Stream exposed as `ctx.stdout` to the last stage. |
| `stderr` | `Writable` | `process.stderr` | Stream exposed as `ctx.stderr` to every stage. |
| `signal` | `AbortSignal` | — | External cancellation. Aborting it aborts `ctx.signal` and invokes the command's `cancel()` handler. See [AbortSignal](glossary.md#abortsignal). |

A worked in-memory example is in [Examples](examples.md).

## Defining commands

### `CommandBuilder`

Returned by `cli.command(...)`, `builder.command(...)` and a plugin context's `command(...)`. Every method returns the builder, so calls chain.

```typescript
class CommandBuilder {
  description(text: string): this;
  hidden(hidden?: boolean): this;
  option(flags: string, schema?: OptionSchema): this;
  action(fn: Action): this;
  complete(fn: Completer): this;
  alias(...names: string[]): this;
  validate(fn: (ctx: CommandContext) => void | Promise<void>): this;
  cancel(fn: (ctx: CommandContext) => void): this;
  remove(): boolean;
  command(definition: string): CommandBuilder;
}
```

| Method | Description |
| --- | --- |
| `description` | Sets the text shown for this command in help output. |
| `hidden` | Omits the command from generated help and from tab completion. Defaults to `true` when called with no argument. A hidden command is still dispatched normally when its name is typed. |
| `option` | Declares an option. See [Options](#options). |
| `action` | Sets the handler run when the command is invoked. |
| `complete` | Sets a custom tab-completion provider for this command. |
| `alias` | Adds alternative names. An alias never shadows a real command at the same level. |
| `validate` | Sets a pre-action check. Throwing rejects the invocation before the action runs. |
| `cancel` | Sets a handler invoked when the command is cancelled (Ctrl-C, or an aborted external signal). |
| `remove` | Unregisters the command. Returns `true` when it was found and removed. |
| `command` | Registers a subcommand and returns a new builder for it. |

The definition string names the command and its positional arguments: `"deploy <env> [region]"`, `"db migrate"`, `"run <...tasks>"`. `<name>` is required, `[name]` is optional, and a leading `...` makes the argument variadic. Positional arguments are always strings — there is no type, default, coercion or `choices` for them. A variadic argument yields `string[]`. See [Commands](commands.md).

#### Unreachable subcommands

A command that has both positional arguments and an action consumes every following token as an argument value, so its subcommands can never be dispatched. Calling `action()` on such a command emits a process warning with the code `NODE_CLI_UNREACHABLE_SUBCOMMAND`, and registering a subcommand under one emits the same warning. Help output and tab completion omit subcommands in this state rather than advertising a path that would not dispatch.

#### validate

```typescript
validate(fn: (ctx: CommandContext) => void | Promise<void>): this
```

Runs after options are resolved and before `beforeExecute`. An error thrown here propagates unchanged — it is not wrapped in `ValidationError`, which is reserved for an option's own `parse` or `validate`.

#### cancel

```typescript
cancel(fn: (ctx: CommandContext) => void): this
```

Invoked when the command is cancelled. `ctx.signal` is already aborted by the time the handler runs, so a handler and a signal listener are two views of the same event and either or both may be used.

### `Action`

```typescript
type Action = (ctx: CommandContext) => void | Promise<void>
```

### `Completer`

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>
```

Candidates are filtered against `ctx.current` before being offered, so a provider may return its full list.

A custom completer is capped at 1000 ms. A synchronous throw, a rejection or a timeout yields an empty candidate list and never leaves the prompt paused.

#### `CompletionContext`

| Field | Type | Description |
| --- | --- | --- |
| `line` | `string` | The active pipeline segment — the command the cursor is inside. |
| `fullLine` | `string` | The whole input line, earlier pipeline segments included. |
| `current` | `string` | The word under the cursor. |
| `commandPath` | `string[]` | Canonical command path, with aliases resolved. |
| `args` | `Record<string, unknown>` | Positional arguments parsed so far. |
| `options` | `Record<string, unknown>` | Raw option values parsed so far. Coercion, defaults and validation are not applied during completion. |
| `iteration` | `number` | Count of consecutive Tab presses, starting at 1. Resets on any other input. |
| `signal` | `AbortSignal` | Aborted when the 1000 ms completion deadline expires. |

### `CatchContext`

```typescript
interface CatchContext {
  stdout: Writable;
  stderr: Writable;
}
```

Passed to the `cli.catch(...)` fallback handler. No command was resolved, so only the output streams are available.

## Execution context

### `CommandContext`

```typescript
interface CommandContext {
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  rawInput: string;
  rawArgv?: string[];
  commandPath: string[];
  shell: Shell | null;
  signal: AbortSignal;
  stdin: Readable | null;
  stdout: Writable;
  stderr: Writable;
}
```

| Field | Description |
| --- | --- |
| `args` | Positional arguments keyed by argument name. |
| `options` | Resolved options keyed by option long name. |
| `rawInput` | For string input, the original string. For argv input, `argv.join(" ")`, which is lossy: an argument containing a space is indistinguishable from two arguments. |
| `rawArgv` | The exact argv elements, present only for argv input. This is the reversible form; use it when argument boundaries matter. |
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
| Programmatic execution | `ExecOptions.stdin`, default `null` |

## Options

### `OptionSchema`

```typescript
interface OptionSchema {
  description?: string;
  type?: "string" | "number" | "boolean" | "string[]" | "number[]";
  alias?: string | string[];
  required?: boolean;
  default?: unknown;
  choices?: unknown[];
  parse?: (value: string, ctx: CommandContext) => unknown;
  validate?: (value: unknown, ctx: CommandContext) => void;
  hidden?: boolean;
  autocomplete?: string[] | ((current: string) => string[] | Promise<string[]>);
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `description` | `string` | — | Text shown for the option in help output. |
| `type` | see above | Inferred | `"boolean"` when the flags string has no `<value>` placeholder, `"string"` otherwise. |
| `alias` | `string \| string[]` | — | Extra aliases, merged with any declared in the flags string. A leading `-` or `--` is stripped. An alias not declared in long form must be exactly one character. |
| `required` | `boolean` | `false` | Fails with `MissingOptionError` when the option is absent. |
| `default` | `unknown` | — | Value used when the option is absent. |
| `choices` | `unknown[]` | — | Restricts the value. Compared leniently, so a declared string choice matches a coerced number. Array-typed options check each element. |
| `parse` | function | — | Custom parser for an explicitly supplied value. Receives the raw string and the context. |
| `validate` | function | — | Custom check run after coercion. Throw to reject. |
| `hidden` | `boolean` | `false` | Omits the option from help output and tab completion. |
| `autocomplete` | `string[]` or function | — | Candidates offered for this option's value. Falls back to `choices` when absent. |

Rules that are easy to miss:

- A boolean option omitted from the input resolves to `false`, not `undefined`. The builder injects that default unless the option is `required`.
- Declaring `required: true` and a `default` on the same option throws at definition time, since the default would make the requirement unsatisfiable.
- A custom `parse` is applied to explicitly supplied values only. A `default` is treated as an already-resolved value; only the built-in coercion for `type` runs on it.
- `parse` replaces the built-in coercion entirely, so an option with a `parse` may resolve to any type, `Date` included.
- `"number"` accepts ordinary decimal or scientific notation. A magnitude above `Number.MAX_SAFE_INTEGER` is rejected, because its digits cannot be represented exactly.

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
| `exit` | Once on every exit path of `start()`. |

`commandError` and `error` **both** fire for a resolved command's failure: `commandError` carries the context, `error` is the catch-all. A handler that must see each failure exactly once should listen to one of them, not both.

`exit` fires after a direct-mode command completes, throws or is force-quit; after a help index is printed for an argument-free non-terminal start; when plugin initialization fails; and when the interactive shell ends. Programmatic execution never fires it on the normal path.

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
  command: (definition: string) => CommandBuilder;
  on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  off: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  catch: (handler: (input: string, ctx: CatchContext) => void | Promise<void>) => void;
}
```

The object handed to a function passed to `cli.use(...)`. It exposes only the extension surface — a plugin cannot start the CLI or change its metadata.

Plugin bodies run through one serial queue, so registration order is deterministic even when an earlier plugin awaits I/O. A plugin that throws or rejects fails initialization: `start()` reports it and emits `exit`, and a later `use()` on the same instance rethrows the stored failure. See [Events and plugins](events-and-plugins.md).

## Interactive shell

### `Shell`

Type-only. The running instance is reached through `ctx.shell`, which is `null` outside the interactive shell.

```typescript
class Shell {
  setPrompt(text: string): void;
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
| `stop` | Ends the shell session. |

The shell starts only when **both** stdin and stdout are terminals. Its only built-in commands are `exit` and `quit`; a registered command of the same name takes precedence at the top level. `help` is an ordinary registered command, and there is no `clear` or `history` builtin.

### `ModeConfig`

```typescript
interface ModeConfig {
  prompt: string;
  action: (
    input: string,
    ctx: {
      stdout: NodeJS.WritableStream;
      stderr: NodeJS.WritableStream;
      signal: AbortSignal;
    },
  ) => void | Promise<void>;
  message?: string;
  completer?: (line: string) => CompletionResult | Promise<CompletionResult>;
  history?: "session" | "none";
}
```

| Field | Default | Description |
| --- | --- | --- |
| `prompt` | — | Prompt string shown while the mode is active. |
| `action` | — | Handler for each submitted line. A mode does not dispatch through the command registry. |
| `message` | — | Text printed once when the mode is entered. |
| `completer` | — | Mode-specific completion. Without one, Tab offers nothing: command completion is off inside a mode. Capped at 1000 ms like every other provider. |
| `history` | `"session"` | `"session"` keeps mode input in memory for the duration of the mode; `"none"` disables it. Mode input is never written to the on-disk history file. |

Inside a mode, `exit` and `quit` always leave the mode rather than the shell. The first Ctrl-C aborts `ctx.signal`; a second force-quits the process with status 130. SIGTERM follows the same cooperative path, then saves history, emits `exit`, and exits with status 143 after a 200 ms grace period.

### `CompletionResult`

```typescript
type CompletionResult = [candidates: string[], completeOn: string]
```

The tuple Node's readline completer interface expects: the candidate list, and the substring of the line those candidates replace.

## Colour and terminal text

### `color`

```typescript
const color: Record<string, ColorFn>
```

A proxy whose properties are style names. Each returns a callable that is also chainable.

```typescript
import { color } from "@libraz/node-cli";

color.red("error");
color.bold.green("ok");
color.bgCyan.white.underline("banner");
```

Accessing an unknown style name **throws** `Error: Unknown style: <name>`, so a typo surfaces immediately instead of silently printing unstyled text. Protocol properties (`then`, `toString`, `valueOf`, `toJSON`, `constructor`, and any symbol) are exempt, so passing a colorizer through `await`, a template literal or `JSON.stringify` does not crash.

Enablement follows `process.stdout`. Use `createColorizer` when writing elsewhere.

### The style set

Six modifiers, ten foregrounds, seven backgrounds — nothing else. There is no `bgBlack`, no bright variants, and no 256-colour or hex API.

| Group | Names |
| --- | --- |
| Modifiers | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Foreground | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `grey` |
| Background | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

`gray` and `grey` are two spellings of one colour.

### `c`

```typescript
function c(strings: TemplateStringsArray, ...values: unknown[]): string
```

A tagged template that applies styles with `{styleName text}` markup. Style names chain with dots, and markup nests.

```typescript
import { c } from "@libraz/node-cli";

const message = "disk full";

c`Status: {green OK}`;
c`{bold.red Error}: ${message}`;
c`{dim outer {cyan inner} outer}`;
```

Unlike `color`, the tag never throws on bad markup: an unknown style name, an unclosed brace or a missing space renders literally. Interpolated values are substituted after styling, so a value that itself contains `{green ...}` is not treated as markup. Nesting deeper than 64 levels throws.

### `createColorizer`

```typescript
function createColorizer(stream: NodeJS.WritableStream): Record<string, ColorFn>
```

Returns a `color`-shaped proxy whose enablement is decided from `stream` rather than `process.stdout`. Use it inside a command action so colour follows the stream the action is actually writing to.

```typescript
const col = createColorizer(ctx.stdout);
ctx.stdout.write(`${col.green("done")}\n`);
```

### `isColorEnabled`

```typescript
function isColorEnabled(stream?: NodeJS.WritableStream): boolean
```

Reports whether escape codes would be emitted for `stream`, which defaults to `process.stdout`. The resolution order is:

1. An explicit `setColorEnabled()` override — it beats everything, `NO_COLOR` included.
2. `NO_COLOR`, when set to a non-empty value: colour off.
3. `FORCE_COLOR`, when set to a non-empty value: `"0"` and `"false"` force it off, anything else forces it on. This beats both `TERM=dumb` and a non-terminal stream.
4. `TERM=dumb`: colour off.
5. Whether the stream is a terminal.

### setColorEnabled and resetColorEnabled

```typescript
function setColorEnabled(enabled: boolean): void
function resetColorEnabled(): void
```

`setColorEnabled` pins the answer for the whole process. `resetColorEnabled` clears the override and restores automatic detection. The override is the right tool for a test that asserts on plain text.

### `stringWidth`

```typescript
function stringWidth(text: string): number
```

The number of terminal columns the text occupies. ANSI sequences are stripped first, combining marks and zero-width characters count as zero, and East Asian wide characters and emoji count as two. A run of scalars joined by zero-width joiners — a family emoji, for instance — collapses to one two-column grapheme.

### `stripAnsi`

```typescript
function stripAnsi(text: string): string
```

Removes every ANSI escape sequence, CSI and OSC alike.

### `truncateAnsi`

```typescript
function truncateAnsi(text: string, maxWidth: number, marker?: string): string
```

Truncates to `maxWidth` display columns without splitting a grapheme, appends `marker` (default `"…"`), and closes any styling or hyperlink the result would otherwise leave open. Returns `""` when `maxWidth` is zero or less.

### `splitAnsi`

```typescript
function splitAnsi(text: string): AnsiSegment[]

interface AnsiSegment {
  ansi: boolean;
  text: string;
}
```

Splits the input into ordered runs of escape sequences (`ansi: true`) and visible text (`ansi: false`), using the same recognizer as `stripAnsi`. Concatenating every segment's `text` reproduces the input, which is what lets a consumer transform only the visible parts.

See [Colour](color.md) for narrative coverage.

## Tables

### `table`

```typescript
function table(
  data: unknown[][] | Record<string, unknown>[],
  options?: TableOptions,
): string
```

Renders rows as an aligned string with no trailing newline. Accepts an array of objects or an array of arrays.

`table()` never wraps. A cell wider than its column is truncated with the truncation marker, newlines and tabs inside a cell have already been collapsed to spaces, and the total width is never clamped to the terminal — a wide table wraps in the terminal rather than being reflowed.

#### Column keys versus labels

`align`, `maxWidth` and `headerLabels` are keyed by column **key**, never by the displayed label.

| Data shape | Keys |
| --- | --- |
| Array of objects, no `columns` | The union of every row's own property names, in first-seen order. |
| Array of objects, with `columns` | Exactly the strings in `columns`. |
| Array of arrays, no `columns` | The row-0 header strings, or `"0"`, `"1"`, … for columns row 0 does not name and for every column when `header: false`. |
| Array of arrays, with `columns` | The strings in `columns`. Row 0 is then data, not a header. |

### `TableOptions`

```typescript
interface TableOptions {
  columns?: string[];
  header?: boolean;
  headerLabels?: Record<string, string>;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];
  colWidths?: number[];
  maxWidth?: Record<string, number>;
  padding?: number;
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;
  style?: TableStyle;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `columns` | Derived from the data | Column keys to include, in order. For array data these double as the header labels, and row 0 is not consumed as a header. |
| `header` | `true` | Whether a header row is rendered. |
| `headerLabels` | — | Display labels, keyed by column key. |
| `border` | `"none"` | Border preset. Supplying `chars` without `border` implies `"custom"`. |
| `chars` | — | Border glyph overrides. `"custom"` starts from the `"single"` preset. |
| `align` | `"left"` | Alignment per column key. |
| `colAligns` | — | Alignment by column index. Takes precedence over `align`. |
| `colWidths` | Auto | Fixed total width per column index, padding included. A value of `0` or less means auto. |
| `maxWidth` | — | Upper bound on content width per column key. A value of `0` or less means no limit. |
| `padding` | `2` | Spaces between columns. Applies to `border: "none"` only. |
| `headerStyle` | `"bold"` | Text style applied to header labels. |
| `truncate` | `"…"` | Marker appended to a truncated cell. |
| `style` | — | See [`TableStyle`](#tablestyle). |

`colWidths[i]` is the column's total width including padding. The smallest honoured value is `padding-left + padding-right + 1`; anything below that renders at that minimum. Every border mode renders the padding it charged, so the requested width is the rendered width.

### `TableStyle`

```typescript
interface TableStyle {
  "padding-left"?: number;
  "padding-right"?: number;
  head?: string;
  border?: string;
  compact?: boolean;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `padding-left` | `1` for `rounded`, `single`, `double` and `custom`; `0` for `none` and `simple` | Spaces inside each cell, left. |
| `padding-right` | Same rule as above | Spaces inside each cell, right. |
| `head` | — | Dot-chained style for header text, such as `"cyan"` or `"cyan.bold"`. |
| `border` | — | Dot-chained style for border glyphs, such as `"dim"`. |
| `compact` | `true` | `false` draws a separator between data rows. |

An unknown style name in `head` or `border` is ignored and the text renders unstyled — unlike `color.<name>`, which throws.

### `TableChars`

```typescript
interface TableChars {
  top?: string;
  "top-mid"?: string;
  "top-left"?: string;
  "top-right"?: string;
  bottom?: string;
  "bottom-mid"?: string;
  "bottom-left"?: string;
  "bottom-right"?: string;
  left?: string;
  "left-mid"?: string;
  right?: string;
  "right-mid"?: string;
  mid?: string;
  "mid-mid"?: string;
  middle?: string;
}
```

Each field is one piece of the frame. Supplied glyphs are sanitized, so an escape sequence in a border character cannot restyle the rest of the table. See [Tables](table.md) for worked layouts.

## Progress

Both indicators default to `process.stderr`, which keeps progress output out of a redirected stdout.

### progress.bar

```typescript
progress.bar(options: BarOptions): Bar
```

#### `BarOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `total` | `number` | — | Required. A non-finite or negative value is normalized to `0`, which renders as complete. |
| `label` | `string` | `""` | Text before the bar. |
| `width` | `number` | `30` | Bar width in characters. Must be positive and finite, or `RangeError` is thrown. |
| `filled` | `string` | `"█"` | Glyph for the filled portion. |
| `empty` | `string` | `"░"` | Glyph for the empty portion. |
| `format` | `(state: BarState) => string` | — | Replaces the whole rendered line. |
| `stream` | `Writable` | `process.stderr` | Output stream. |
| `color` | `string` | — | Style name applied to the bar. An unknown name is ignored. |

#### `Bar`

| Method | Description |
| --- | --- |
| `update(current: number)` | Sets progress to an absolute value, clamped to `0`–`total`. A non-finite value is ignored. |
| `tick(delta?: number)` | Adds `delta`, default `1`. |
| `finish()` | Sets progress to `total`, draws a final frame, and ends the line. |
| `stop()` | Stops without completing. Closes the line only if the bar had drawn one. |
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
  elapsed: number; // ms since the bar was created
  eta: number;     // estimated ms remaining
  rate: number;    // units per second
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
| `frames` | `string[]` | Braille dots | Animation frames. A non-array, an empty array or a non-string element throws `RangeError`. |
| `interval` | `number` | `80` | Milliseconds between frames. Must be positive and finite. |
| `stream` | `Writable` | `process.stderr` | Output stream. |
| `color` | `string` | — | Style name applied to the frame. An unknown name is ignored. |

#### `Spinner`

| Method | Description |
| --- | --- |
| `start()` | Begins the animation. |
| `update(label: string)` | Replaces the label; the next frame shows it. |
| `succeed(message?)` | Stops and writes a green check line. Defaults to the current label. |
| `fail(message?)` | Stops and writes a red cross line. |
| `warn(message?)` | Stops and writes a yellow warning line. |
| `stop()` | Stops and clears the line, writing no final message. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

### Behaviour on a non-terminal stream

A progress bar writing to a non-terminal stream emits **nothing at all**, `finish()` included, so a redirected log does not fill with control sequences.

A spinner writing to a non-terminal stream emits nothing either, except `succeed`, `fail` and `warn`, which always write their one final line. That makes a spinner safe to leave in a script whose output is captured: the outcome is recorded, the animation is not.

### progress.multi

```typescript
progress.multi(): MultiBar
```

Takes no arguments. The group renders to one stream, fixed by the first `add()` that supplies one; a `stream` on a later bar is ignored, because one frame cannot be split across terminal regions.

| Method | Description |
| --- | --- |
| `add(options: BarOptions): Bar` | Adds a bar and returns its handle. |
| `finish()` | Completes every bar and closes the group. |
| `stop()` | Stops every bar and closes the group. |
| `[Symbol.dispose]()` | Alias for `stop()`. |

`add()` called after the group is closed returns an inert bar whose methods are no-ops, so a worker that adds a bar just after `finally { multi.finish() }` does not fail.

Two standalone indicators cannot render to the same terminal stream at once — the second throws, because neither can know the other's row layout. Concurrent bars belong in a `multi()` group.

### `releaseAll`

```typescript
function releaseAll(): void
```

Stops every indicator that is still active and restores the terminal cursor. Command execution calls it in its finalizer, so an action that throws cannot leave the cursor hidden. Call it directly when driving indicators outside a command. Exported both at the top level and as `progress.releaseAll`.

### `restoreCursor`

```typescript
function restoreCursor(): void
```

Re-shows the cursor on every stream that currently has it hidden. It is a top-level export and **not** a member of `progress`.

See [Progress](progress.md) for worked usage.

## Prompts

Every prompt rejects with `PromptCancelError` on Ctrl-C or on end of input (Ctrl-D). A `validate` that throws is not a rejection: the message is shown and the prompt asks again. Only cancellation escapes the call.

Two prompts reading from the same input stream at once throws, since the second would steal the first one's keystrokes.

### `PromptBaseOptions`

```typescript
interface PromptBaseOptions<T = unknown> {
  validate?: (value: T) => void;
  required?: boolean;
  prefix?: string;
  stdout?: Writable;
  stdin?: Readable;
  signal?: AbortSignal;
}
```

| Field | Default | Description |
| --- | --- | --- |
| `validate` | — | Throw to reject; the prompt re-asks. |
| `required` | `true` | Consulted by `prompt.text` and `prompt.password` only. |
| `prefix` | `"?"` | Symbol shown before the question. |
| `stdout` | `process.stdout` | Where the question is written. |
| `stdin` | `process.stdin` | Where the answer is read. |
| `signal` | — | Aborting rejects the pending prompt with `PromptCancelError`. |

Every prompt options interface extends this one. `stderr` lives on `PasswordOptions` alone.

### prompt.text

```typescript
prompt.text(message: string, options?: TextOptions): Promise<string>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `string` | — | Fills an empty submission. |
| `placeholder` | `string` | — | Hint shown in parentheses. Displayed only when there is no `default`. |
| `trim` | `boolean` | `true` | Trims surrounding whitespace from the answer. |

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
  choices: Choice<T>[],
  options?: SelectOptions<T>,
): Promise<T>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `T` | — | Value returned for an empty submission. Matched by identity against a choice's `value`, or against the choice object itself. |

Choices are answered by their displayed number, or by typing a label exactly. A numeric entry always selects by number, so a numeric-looking label stays reachable. An empty `choices` array throws.

### prompt.multiselect

```typescript
prompt.multiselect<T>(
  message: string,
  choices: Choice<T>[],
  options?: MultiselectOptions<T>,
): Promise<T[]>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default` | `T[]` | — | Pre-selected values, returned for an empty submission. |
| `min` | `number` | — | Minimum number of distinct selections. Omitted means an empty result is accepted. |
| `max` | `number` | — | Maximum number of distinct selections. |

Answered with comma-separated numbers. Duplicates are collapsed before `min` and `max` are checked. A `min` above `max`, a `min` above the number of choices, or a non-integer bound throws `RangeError`.

### prompt.password

```typescript
prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `trim` | `boolean` | `false` | Off by default, unlike `prompt.text`, because surrounding whitespace can be part of a secret. |
| `stderr` | `Writable` | `process.stderr` | Where the question goes when stdin is a terminal but stdout is not. |

There is no `default`. Typed characters are masked with one asterisk per grapheme, so the mask reveals neither the display width nor the scalar count of what was typed.

When stdin is a terminal but stdout has been redirected, the question and the masked entry go to `stderr` instead, keeping a captured stdout free of the exchange.

### Choice and SelectChoice

```typescript
interface SelectChoice<T> {
  label: string;
  value: T;
  hint?: string;
}

type Choice<T> = T | SelectChoice<T>;
```

A choice is either a bare value or a descriptor. A descriptor with a `label` but no `value` throws a `TypeError`, so an ordinary domain object that happens to carry a `label` property is never silently turned into `undefined`.

### `maskInput`

```typescript
function maskInput(chunk: string): string
```

Replaces each visible grapheme in a chunk with `*`, passing ANSI sequences and line breaks through untouched. This is the masking `prompt.password` applies; it is exported for terminal UIs that echo input themselves.

See [Prompts](prompts.md) for worked usage.

## Logging

### `logger`

```typescript
function logger(options?: LoggerOptions): Logger
```

Every level — `info` and `success` included — is written to one stream, which defaults to `process.stderr`. There is no level-based routing between stdout and stderr. To put log output on stdout, pass `stream: process.stdout`.

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
| `setLevel(level: LogLevel)` | Changes the minimum level at runtime. |
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
  code: CLIErrorCode;
  exitCode: number;
  constructor(message: string, code: CLIErrorCode, exitCode?: number);
}
```

The base class for every error the framework raises. `code` is machine-readable; `exitCode` is the process status the failure implies, defaulting to `1`.

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

| Class | `code` | `exitCode` | Extra fields | Raised when |
| --- | --- | --- | --- | --- |
| `CommandNotFoundError` | `COMMAND_NOT_FOUND` | `1` | `input`, `available?` | No command matches the input, or a command group is given an unknown child. |
| `MissingArgumentError` | `MISSING_ARGUMENT` | `1` | `argName`, `usage?` | A required positional argument is absent, or a required variadic receives zero values. |
| `ExtraArgumentError` | `EXTRA_ARGUMENT` | `1` | `extra` | More positional values are supplied than the command declares. |
| `MissingOptionError` | `MISSING_OPTION` | `1` | `optionName` | A `required` option is absent. |
| `InvalidOptionError` | `INVALID_OPTION` | `1` | `optionName?`, `value?` | A value fails built-in coercion or a `choices` check, or an option is used in a form it does not accept. |
| `UnknownOptionError` | `UNKNOWN_OPTION` | `1` | `flag` | A flag is not declared by the command. |
| `ValidationError` | `VALIDATION_ERROR` | `1` | `cause?`, `optionName?` | An option's own `parse` or `validate` throws. |
| `ParseError` | `PARSE_ERROR` | `1` | `quote?` | The input cannot be tokenized or split into pipeline stages. |
| `PromptCancelError` | `PROMPT_CANCELLED` | `130` | — | A prompt is cancelled with Ctrl-C or end of input. |

`ValidationError` wraps failures of an **option's** `parse` or `validate` only. An error thrown by `CommandBuilder.validate()` propagates unchanged and keeps its own class and message.

`ParseError` covers an unclosed quote (`quote` names which one), an empty or trailing pipe, and an unsupported redirection operator. It is raised before a command is resolved, so a registered `catch()` fallback receives the input instead of the error being thrown.

`PromptCancelError` carries exit code `130`, the conventional status for an interrupted program. Every other `CLIError` defaults to `1`. The interactive shell's SIGTERM path exits `143`. See [Exit code](glossary.md#exit-code).

### `formatErrorMessage`

```typescript
function formatErrorMessage(err: unknown, signal?: AbortSignal): string
```

Renders any thrown value as one line of user-facing text: `"Cancelled"` for a cancellation, otherwise the `Error`'s message, otherwise `String(err)`.

### `isCancellationError`

```typescript
function isCancellationError(err: unknown, signal?: AbortSignal): boolean
```

Reports whether a failure is a user-initiated cancellation rather than a genuine fault. A `PromptCancelError` always qualifies. A bare `AbortError` qualifies **only** when a `signal` is supplied and that signal is aborted — without that evidence there is no way to tell whose cancellation it was, and an unrelated aborted request would be misreported as the user pressing Ctrl-C.

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

## Low-level parsing and terminal helpers

These are exported so an integration can reuse the framework's exact behaviour. Ordinary applications do not need them.

```typescript
function tokenize(input: string): string[]
function splitPipes(input: string): string[]
function activePipeSegment(input: string): string
function stripOptionPrefix(flag: string): string
function sanitizeTerminalText(
  text: string,
  options?: { singleLine?: boolean; allowHyperlinks?: boolean },
): string
function splitGraphemes(text: string): string[]
function streamIsTTY(stream: object): boolean
function restoreCursor(): void
```

| Function | Description |
| --- | --- |
| `tokenize` | Splits a line into argv-style tokens, honouring single quotes, double quotes and backslash escapes. Throws `ParseError` on an unclosed quote. |
| `splitPipes` | Splits a line at top-level pipe characters, preserving each segment's quoting so it can be tokenized again. Throws `ParseError` on an empty or trailing pipe. |
| `activePipeSegment` | Returns the segment after the last unquoted pipe, with leading whitespace removed and trailing whitespace kept. Unlike `splitPipes` it preserves a trailing empty segment, which is what lets completion offer commands immediately after a pipe. |
| `stripOptionPrefix` | Removes leading dashes: `--name` and `-n` become `name` and `n`. |
| `sanitizeTerminalText` | Prepares untrusted text for a rendered region. SGR styling and OSC 8 hyperlinks survive; cursor movement, screen clearing and title changes are removed. With `singleLine: true` (the default) newlines become spaces. `allowHyperlinks: false` strips links too. |
| `splitGraphemes` | Splits visible text into user-perceived grapheme clusters, so an emoji with a modifier counts as one unit. |
| `streamIsTTY` | Reports whether a value looks like a terminal stream. See [TTY](glossary.md#tty). |
| `restoreCursor` | Re-shows the cursor on every stream that currently has it hidden. |

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
| `CLI` | class | [Creating a CLI](#cli) |
| `CLIOptions` | type | [Creating a CLI](#clioptions) |
| `ExecOptions` | type | [Creating a CLI](#execoptions) |
| `PluginContext` | type | [Events and plugins](#plugincontext) |
| `CommandBuilder` | class | [Defining commands](#commandbuilder) |
| `Action` | type | [Defining commands](#action) |
| `Completer` | type | [Defining commands](#completer) |
| `CompletionContext` | type | [Defining commands](#completioncontext) |
| `CatchContext` | type | [Defining commands](#catchcontext) |
| `CommandContext` | type | [Execution context](#commandcontext) |
| `OptionSchema` | type | [Options](#optionschema) |
| `CLIEventMap` | type | [Events and plugins](#clieventmap) |
| `CLIEventHandler` | type | [Events and plugins](#clieventhandler) |
| `Shell` | type | [Interactive shell](#shell) |
| `ModeConfig` | type | [Interactive shell](#modeconfig) |
| `CompletionResult` | type | [Interactive shell](#completionresult) |
| `color` | value | [Colour](#color) |
| `c` | function | [Colour](#c) |
| `createColorizer` | function | [Colour](#createcolorizer) |
| `isColorEnabled` | function | [Colour](#iscolorenabled) |
| `setColorEnabled` | function | [Colour](#setcolorenabled-and-resetcolorenabled) |
| `resetColorEnabled` | function | [Colour](#setcolorenabled-and-resetcolorenabled) |
| `stringWidth` | function | [Colour](#stringwidth) |
| `stripAnsi` | function | [Colour](#stripansi) |
| `truncateAnsi` | function | [Colour](#truncateansi) |
| `splitAnsi` | function | [Colour](#splitansi) |
| `AnsiSegment` | type | [Colour](#splitansi) |
| `table` | function | [Tables](#table) |
| `TableOptions` | type | [Tables](#tableoptions) |
| `TableStyle` | type | [Tables](#tablestyle) |
| `TableChars` | type | [Tables](#tablechars) |
| `progress` | value | [Progress](#progress) |
| `Bar` | type | [Progress](#bar) |
| `BarOptions` | type | [Progress](#baroptions) |
| `BarState` | type | [Progress](#barstate) |
| `Spinner` | type | [Progress](#spinner) |
| `SpinnerOptions` | type | [Progress](#spinneroptions) |
| `MultiBar` | type | [Progress](#progressmulti) |
| `releaseAll` | function | [Progress](#releaseall) |
| `restoreCursor` | function | [Progress](#restorecursor) |
| `prompt` | value | [Prompts](#prompts) |
| `PromptBaseOptions` | type | [Prompts](#promptbaseoptions) |
| `TextOptions` | type | [Prompts](#prompttext) |
| `ConfirmOptions` | type | [Prompts](#promptconfirm) |
| `SelectOptions` | type | [Prompts](#promptselect) |
| `MultiselectOptions` | type | [Prompts](#promptmultiselect) |
| `PasswordOptions` | type | [Prompts](#promptpassword) |
| `Choice` | type | [Prompts](#choice-and-selectchoice) |
| `SelectChoice` | type | [Prompts](#choice-and-selectchoice) |
| `maskInput` | function | [Prompts](#maskinput) |
| `logger` | function | [Logging](#logger) |
| `Logger` | type | [Logging](#logger-1) |
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
| `formatErrorMessage` | function | [Errors](#formaterrormessage) |
| `isCancellationError` | function | [Errors](#iscancellationerror) |
| `tokenize` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `splitPipes` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `activePipeSegment` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `stripOptionPrefix` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `sanitizeTerminalText` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `splitGraphemes` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |
| `streamIsTTY` | function | [Low-level parsing and terminal helpers](#low-level-parsing-and-terminal-helpers) |

## Related pages

- [Commands](commands.md) — command definitions, subcommands, validation and cancellation.
- [Options](options.md) — the option schema in narrative form.
- [Interactive shell](interactive-shell.md) — the prompt, history, completion, pipes and modes.
- [Colour](color.md), [Tables](table.md), [Progress](progress.md), [Prompts](prompts.md), [Logging](logging.md) — the output toolkit.
- [Events and plugins](events-and-plugins.md) — lifecycle hooks and plugin packaging.
- [Errors](errors.md) — how failures are reported and which exit code each produces.
- [Examples](examples.md) — complete working programs.
- [Glossary](glossary.md) — terms used throughout these pages.

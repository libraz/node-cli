# API Reference

## createCLI

```typescript
function createCLI(options?: CLIOptions): CLI
```

Factory function that creates a new CLI instance.

## CLI

### Constructor

```typescript
new CLI(options?: CLIOptions)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `options.name` | `string` | `"cli"` | Application name |
| `options.version` | `string` | — | Version string |
| `options.prompt` | `string` | `"> "` | Interactive shell prompt |
| `options.description` | `string` | — | Description shown in help header |
| `options.banner` | `string` | Auto-generated | Banner text shown when the interactive shell starts. Set to `""` to suppress |
| `options.historyFile` | `string` | `~/.{name}_history` | History file path |
| `options.historySize` | `number` | `1000` | Max history entries |
| `options.historyFilter` | `(line: string) => string \| null` | — | Redact a history line, or return `null` to omit it |

### Methods

#### `command(definition: string): CommandBuilder`

Register a new command. Returns a builder for chaining.

```typescript
cli.command("deploy <env> [region]")
```

#### `prompt(text: string): this`

Set the interactive shell prompt string.

#### `description(text: string): this`

Set the description displayed in the help header.

#### `banner(text: string): this`

Set the banner text displayed when the interactive shell starts. Pass `""` to suppress. If not set, a banner is auto-generated from `name` and `version`.

#### Built-in Flags

Every command supports `--help` and `-h` unless those flags are explicitly declared by the command. A top-level CLI with `options.version` also supports `--version` and `-V`.

#### `history(filePath: string): this`

Set the history file path.

#### `historySize(size: number): this`

Set the maximum number of history entries retained in interactive mode.

#### `historyFilter(filter: (line: string) => string | null): this`

Redact or reject commands before they are written to the private history file. Return `null` for commands containing credentials or other secrets.

#### `on<K>(event: K, handler: CLIEventMap[K]): this`

Register an event listener.

| Event | Handler Signature | Description |
|-------|------------------|-------------|
| `"beforeExecute"` | `(ctx: CommandContext) => void \| Promise<void>` | Fired before a command action runs |
| `"afterExecute"` | `(ctx: CommandContext) => void \| Promise<void>` | Fired after a command action completes successfully |
| `"commandError"` | `(error: Error, ctx: CommandContext) => void \| Promise<void>` | Fired when a resolved command fails during validation, option resolution, or its action |
| `"error"` | `(error: Error) => void \| Promise<void>` | Catch-all for any error while handling input, including failures before a command resolves (e.g. command-not-found). Also fires for command failures, in addition to `"commandError"` |
| `"exit"` | `() => void \| Promise<void>` | Fired when the interactive shell exits |

#### `off<K>(event: K, handler: CLIEventMap[K]): this`

Remove an event listener.

#### `catch(handler): this`

Set a fallback handler for unrecognized commands.

```typescript
catch(handler: (input: string, ctx: { stdout: Writable; stderr: Writable }) => void | Promise<void>): this
```

#### `use(plugin): this`

Register a plugin.

```typescript
use(plugin: (ctx: PluginContext) => void | Promise<void>): this
```

#### `exec(input: string, options?): Promise<void>`

Execute a command programmatically.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `input` | `string` | — | Command string |
| `options.stdin` | `Readable \| null` | `null` | Input stream exposed as `ctx.stdin` |
| `options.stdout` | `Writable` | `process.stdout` | Output stream |
| `options.stderr` | `Writable` | `process.stderr` | Error stream |
| `options.signal` | `AbortSignal` | — | External cancellation signal linked to `ctx.signal` and `.cancel()` |

#### `start(argv?: string[]): Promise<void>`

Start the CLI. If `argv` is provided (or `process.argv` has args), runs in direct mode. With no arguments it starts the interactive shell only when both stdin and stdout are TTYs; otherwise it prints the help index.

---

## Shell

The `Shell` instance is available in command handlers via `ctx.shell`.

### Methods

#### `setPrompt(text: string): void`

Dynamically change the prompt string. Takes effect on the next prompt display. If the shell is currently in a mode, the change applies after exiting the mode.

```typescript
cli.command("prompt <text>")
  .description("Change the prompt")
  .action((ctx) => {
    ctx.shell?.setPrompt(ctx.args.text as string);
  });
```

#### `enterMode(config: ModeConfig): void`

Enter a mode sub-REPL with a custom prompt and action handler.

#### `exitMode(): void`

Exit the current mode, returning to the normal command prompt.

#### `stop(): void`

Stop the shell, closing the readline interface.

---

## CommandBuilder

Fluent builder returned by `cli.command()`.

### Methods

#### `description(text: string): this`

Set the command description (shown in help).

#### `hidden(hidden?: boolean): this`

Exclude this command from generated help and tab completion. Defaults to `true` when called with no argument. A hidden command remains fully executable.

#### `option(flags: string, schema?: OptionSchema): this`

Add an option to the command.

| Parameter | Type | Description |
|-----------|------|-------------|
| `flags` | `string` | Flag definition (e.g., `"-p, --port <port>"`) |
| `schema` | `OptionSchema` | Option configuration |

#### `action(fn: Action): this`

Set the action handler.

```typescript
type Action = (ctx: CommandContext) => void | Promise<void>
```

#### `complete(fn: Completer): this`

Set a custom tab-completion provider. The `CompletionContext` includes an `iteration` counter (1-based) that tracks consecutive Tab presses, allowing progressive completions. Async providers have a 1-second deadline; use `signal` to cancel outstanding work when it expires.

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>

interface CompletionContext {
  line: string;           // Active pipeline segment
  fullLine: string;       // Complete input line, including earlier segments
  current: string;        // Current word being completed
  commandPath: string[];  // Resolved command path
  args: Record<string, unknown>;
  options: Record<string, unknown>; // Raw values; no coercion/defaults/validation
  iteration: number;      // Consecutive Tab press count (1-based)
  signal: AbortSignal;    // Aborted when the 1-second completion deadline expires
}
```

#### `alias(...names: string[]): this`

Add alternative names for this command.

#### `validate(fn): this`

Set a pre-action validator. Throw to reject execution.

```typescript
validate(fn: (ctx: CommandContext) => void | Promise<void>): this
```

#### `cancel(fn): this`

Set a SIGINT handler for this command.

```typescript
cancel(fn: (ctx: CommandContext) => void): this
```

#### `remove(): boolean`

Remove this command from the registry. Returns `true` if found and removed.

#### `command(definition: string): CommandBuilder`

Register a subcommand. Returns a new builder for the subcommand.

---

## CommandContext

Passed to every action handler.

```typescript
interface CommandContext {
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  rawInput: string;
  rawArgv?: string[];
  commandPath: string[];
  shell: Shell | null;
  stdin: Readable | null;
  stdout: Writable;
  stderr: Writable;
  signal: AbortSignal;
}
```

| Property | Description |
|----------|-------------|
| `args` | Parsed positional arguments keyed by name |
| `options` | Parsed options keyed by long name |
| `rawInput` | Original input string |
| `rawArgv` | Exact argv elements for array/direct execution, including empty and whitespace-bearing arguments; absent for string input |
| `commandPath` | Resolved command path (e.g., `["db", "migrate"]`) |
| `shell` | Shell instance in interactive mode, `null` in direct mode |
| `stdin` | Input stream selected by the execution surface, or `null` |
| `stdout` | Writable stream for output |
| `stderr` | Writable stream for errors |
| `signal` | `AbortSignal` aborted when the command is cancelled (SIGINT); pair with abort-aware APIs or `cancel()` |

`rawInput` is the original command string for string execution. For array/direct execution it is a display-oriented reconstruction; use `rawArgv` when exact argument boundaries matter.

### Standard input by execution surface

| Surface | `ctx.stdin` |
|---------|-------------|
| `start(argv)` direct command | `process.stdin` |
| Pipeline | First stage: input supplied by the calling surface; later stages: previous stage output |
| Interactive REPL | `null` |
| `exec(input)` | `options.stdin`, default `null` |

---

## OptionSchema

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

| Property | Default | Description |
|----------|---------|-------------|
| `description` | — | Text shown for this option in help output |
| `type` | Inferred | Value type. Inferred as `"boolean"` for flags without `<value>`, `"string"` otherwise |
| `alias` | — | Additional alias or aliases, merged with any declared in `flags`. A leading `-` / `--` is stripped; an alias that is not declared in long form must be exactly one character |
| `required` | `false` | Throw if not provided. Cannot be combined with `default` |
| `default` | — | Value used only when absent. Built-in coercion applies, custom `parse` does not. Boolean options default to `false` |
| `choices` | — | Restrict to listed values |
| `parse` | — | Custom parser for raw string value |
| `validate` | — | Custom validator (throw on invalid) |
| `hidden` | `false` | Hide from help output |
| `autocomplete` | — | Completion candidates for option values. Array of strings or `(current: string) => string[] \| Promise<string[]>` |

Explicit values use custom `parse` when present, otherwise built-in coercion for
`type`. Defaults are treated as already-resolved values except for built-in
coercion. Declaring both `required: true` and `default` throws while defining the
option.

---

## PluginContext

Passed to plugin functions registered via `cli.use()`.

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder;
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): void;
}
```

| Member | Description |
|--------|-------------|
| `command` | Register a new command |
| `on` | Register an event listener |
| `off` | Remove a previously registered event listener |
| `catch` | Register a fallback handler invoked when no command matches the input |

---

## CLIEventMap

```typescript
interface CLIEventMap {
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  error: (error: Error) => void | Promise<void>;
  exit: () => void | Promise<void>;
}
```

The `error` event is a catch-all: it fires for any error raised while handling
input, including failures that occur before a command is resolved (e.g.
command-not-found). It also fires for command failures, in addition to
`commandError`.

---

## ModeConfig

Configuration for mode sub-REPLs.

```typescript
interface ModeConfig {
  prompt: string;
  action: (input: string, ctx: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    signal: AbortSignal;
  }) => void | Promise<void>;
  message?: string;
  completer?: (line: string) => [string[], string] | Promise<[string[], string]>;
  history?: "session" | "none";
}
```

Mode completion is disabled unless `completer` is provided. Mode history is isolated from parent and on-disk command history; it defaults to in-memory `"session"` history, while `"none"` disables it.

The first Ctrl+C during a mode action aborts `ctx.signal`; long-running work
should observe it (for example, pass it to `fetch` or abortable timers). A second
Ctrl+C force-quits the process.

SIGTERM follows the same cooperative cancellation path, then saves shell history,
emits `exit`, and exits with status 143 after a 200ms grace period.

```typescript
shell.enterMode({
  prompt: "query> ",
  async action(input, { stdout, signal }) {
    const response = await fetch(`/query?q=${encodeURIComponent(input)}`, { signal });
    stdout.write(`${await response.text()}\n`);
  },
});
```

---

## color

Proxy-based chainable color API.

```typescript
color.red("text")
color.bold.green("text")
color.bgCyan.white.underline("text")
```

Returns a styled string with ANSI escape codes (or plain string if color is disabled).

## c

Tagged template literal for inline color formatting.

```typescript
c`{styleName text}`
c`{bold.red Error}: ${message}`
```

## setColorEnabled

```typescript
function setColorEnabled(enabled: boolean): void
```

Override color detection. Pass `false` to disable all color output.

## stripAnsi

```typescript
function stripAnsi(text: string): string
```

Remove ANSI escape codes from a string.

## splitAnsi

```typescript
function splitAnsi(text: string): AnsiSegment[]
// interface AnsiSegment { ansi: boolean; text: string }
```

Split a string into ordered runs of ANSI escape sequences (`ansi: true`) and plain visible text (`ansi: false`), using the same recognizer as `stripAnsi`. Concatenating the segments' `text` reproduces the input.

## stringWidth

```typescript
function stringWidth(text: string): number
```

Calculate visual display width, accounting for ANSI codes and East Asian wide characters.

## Additional color and parsing helpers

| Export | Description |
|--------|-------------|
| `createColorizer(stream)` | Create a chainable colorizer bound to one output stream |
| `isColorEnabled(stream?)` | Report whether color is enabled for a stream |
| `resetColorEnabled()` | Restore automatic color detection after an override |
| `truncateAnsi(text, width, suffix?)` | Truncate to display width while preserving ANSI state |
| `activePipeSegment(input)` | Return the final unquoted pipeline segment for completion |
| `maskInput(chunk)` | Mask visible graphemes while preserving terminal control sequences |

---

## table

```typescript
function table(
  data: unknown[][] | Record<string, unknown>[],
  options?: TableOptions
): string
```

Render tabular data as a formatted string.

### TableOptions

```typescript
interface TableOptions {
  columns?: string[];
  header?: boolean;                         // default: true
  headerLabels?: Record<string, string>;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;                       // custom border characters
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];  // alignment by index
  colWidths?: number[];                     // fixed column widths by index
  maxWidth?: Record<string, number>;
  padding?: number;                         // default: 2 (borderless)
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;                        // default: "…"
  style?: TableStyle;
}

interface TableStyle {
  "padding-left"?: number;   // default: 1 (bordered), 0 (none)
  "padding-right"?: number;  // default: 1 (bordered), 0 (none)
  head?: string;             // header color (e.g. "red", "cyan.bold")
  border?: string;           // border color (e.g. "grey", "dim")
  compact?: boolean;         // hide row separators (default: true)
}

interface TableChars {
  top?: string;       "top-mid"?: string;    "top-left"?: string;   "top-right"?: string;
  bottom?: string;    "bottom-mid"?: string; "bottom-left"?: string;"bottom-right"?: string;
  left?: string;      "left-mid"?: string;   right?: string;        "right-mid"?: string;
  mid?: string;       "mid-mid"?: string;    middle?: string;
}
```

---

## progress

### progress.bar

```typescript
function progress.bar(options: BarOptions): Bar
```

#### BarOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `total` | `number` | — | **Required.** Total units |
| `label` | `string` | — | Label prefix |
| `width` | `number` | `30` | Bar width in characters |
| `filled` | `string` | `"█"` | Fill character |
| `empty` | `string` | `"░"` | Empty character |
| `color` | `string` | — | Color name |
| `stream` | `Writable` | `process.stderr` | Output stream |
| `format` | `(state: BarState) => string` | — | Custom formatter |

#### Bar

| Method | Description |
|--------|-------------|
| `update(current: number)` | Set progress to absolute value |
| `tick(delta?: number)` | Increment progress (default: 1) |
| `finish()` | Complete the bar (set to 100%) |
| `stop()` | Stop without completing |
| `[Symbol.dispose]()` | Alias for `stop()`, so a bar declared with `using` is released at scope exit |

#### BarState

```typescript
interface BarState {
  current: number;
  total: number;
  percent: number;    // 0-100
  elapsed: number;    // ms
  eta: number;        // ms remaining
  rate: number;       // units/sec
}
```

### progress.spinner

```typescript
function progress.spinner(options?: SpinnerOptions): Spinner
```

#### SpinnerOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | — | Text next to spinner |
| `frames` | `string[]` | dots pattern | Animation frames |
| `interval` | `number` | `80` | Ms between frames |
| `color` | `string` | — | Frame color |
| `stream` | `Writable` | `process.stderr` | Output stream |

#### Spinner

| Method | Description |
|--------|-------------|
| `start()` | Begin animation |
| `update(label: string)` | Change the label |
| `succeed(message?: string)` | Stop with checkmark |
| `fail(message?: string)` | Stop with cross |
| `warn(message?: string)` | Stop with warning |
| `stop()` | Stop without status |
| `[Symbol.dispose]()` | Alias for `stop()`, so a spinner declared with `using` is released at scope exit |

### progress.multi

```typescript
function progress.multi(): MultiBar
```

#### MultiBar

| Method | Description |
|--------|-------------|
| `add(options: BarOptions): Bar` | Add a new progress bar |
| `finish()` | Finish all bars |
| `stop()` | Stop all bars |
| `[Symbol.dispose]()` | Alias for `stop()`, so a multi-bar declared with `using` is released at scope exit |

### progress.releaseAll

```typescript
function progress.releaseAll(): void
```

Stop every indicator that is still active and restore the terminal cursor. Command
execution calls this in its finalizer, so an action that throws cannot leave the
cursor hidden; call it directly when driving indicators outside a command. Also
available as the top-level export `releaseAll`.

---

## prompt

### prompt.text

```typescript
function prompt.text(message: string, options?: TextOptions): Promise<string>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default` | `string` | — | Default value |
| `placeholder` | `string` | — | Placeholder text |
| `validate` | `(v: unknown) => void` | — | Throw on invalid |
| `required` | `boolean` | `true` | Require non-empty |
| `trim` | `boolean` | `true` | Trim leading and trailing whitespace |
| `prefix` | `string` | `"?"` | Prompt prefix |
| `stdin` | `Readable` | `process.stdin` | Input stream |
| `stdout` | `Writable` | `process.stdout` | Output stream |
| `signal` | `AbortSignal` | — | Rejects the pending prompt with `PromptCancelError` when aborted |

### prompt.confirm

```typescript
function prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default` | `boolean` | `false` | Default value |
| `validate` | `(v: unknown) => void` | — | Throw on invalid |
| `prefix` | `string` | `"?"` | Prompt prefix |
| `stdin` | `Readable` | `process.stdin` | Input stream |
| `stdout` | `Writable` | `process.stdout` | Output stream |
| `signal` | `AbortSignal` | — | Rejects the pending prompt with `PromptCancelError` when aborted |

### prompt.select

```typescript
function prompt.select<T>(
  message: string,
  choices: (T | { label: string; value: T; hint?: string })[],
  options?: SelectOptions<T>
): Promise<T>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default` | `T` | — | Default selected value, returned when the user presses Enter with no input |
| `validate` | `(v: unknown) => void` | — | Throw on invalid |
| `prefix` | `string` | `"?"` | Prompt prefix |
| `stdin` | `Readable` | `process.stdin` | Input stream |
| `stdout` | `Writable` | `process.stdout` | Output stream |
| `signal` | `AbortSignal` | — | Rejects the pending prompt with `PromptCancelError` when aborted |

### prompt.multiselect

```typescript
function prompt.multiselect<T>(
  message: string,
  choices: (T | { label: string; value: T; hint?: string })[],
  options?: MultiselectOptions<T>
): Promise<T[]>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default` | `T[]` | — | Pre-selected values |
| `min` | `number` | `0` | Minimum selections; Enter may return an empty array when omitted |
| `max` | `number` | — | Maximum selections |
| `validate` | `(v: unknown) => void` | — | Throw on invalid |
| `prefix` | `string` | `"?"` | Prompt prefix |
| `stdin` | `Readable` | `process.stdin` | Input stream |
| `stdout` | `Writable` | `process.stdout` | Output stream |
| `signal` | `AbortSignal` | — | Rejects the pending prompt with `PromptCancelError` when aborted |

### prompt.password

```typescript
function prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

Input is masked with asterisks. Leading and trailing whitespace is preserved by default; set `trim: true` to remove it.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `validate` | `(v: unknown) => void` | — | Throw on invalid |
| `required` | `boolean` | `true` | Require non-empty |
| `trim` | `boolean` | `false` | Trim leading and trailing whitespace |
| `prefix` | `string` | `"?"` | Prompt prefix |
| `stdin` | `Readable` | `process.stdin` | Input stream |
| `stdout` | `Writable` | `process.stdout` | Output stream |
| `stderr` | `Writable` | `process.stderr` | Prompt target when stdin is a TTY but stdout is redirected |
| `signal` | `AbortSignal` | — | Rejects the pending prompt with `PromptCancelError` when aborted |

All prompts throw `PromptCancelError` on Ctrl+C or Ctrl+D.

---

## logger

```typescript
function logger(options?: LoggerOptions): Logger
```

### LoggerOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `"info"` | Minimum log level |
| `prefix` | `string` | — | Prefix in brackets |
| `timestamp` | `boolean` | `false` | Show `HH:MM:SS` |
| `stream` | `Writable` | `process.stderr` | Output stream |
| `bufferLimit` | `number` | `1000` | Maximum queued lines while the stream is backpressured; oldest queued lines are dropped when full |

### Logger

| Method | Level | Icon |
|--------|-------|------|
| `debug(msg, ...args)` | debug | (none) |
| `info(msg, ...args)` | info | ℹ |
| `success(msg, ...args)` | info | ✔ |
| `warn(msg, ...args)` | warn | ⚠ |
| `error(msg, ...args)` | error | ✖ |

Additional methods:

| Method | Description |
|--------|-------------|
| `setLevel(level: LogLevel)` | Change minimum level at runtime |
| `child(prefix: string): Logger` | Create child logger with nested prefix |
| `flush(): Promise<void>` | Wait until queued lines reach the stream; rejects if the stream errors or closes first |

### LogLevel

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

---

## Error Classes

All extend `CLIError`, which exposes a machine-readable `code: CLIErrorCode` and
a suggested `exitCode: number`.

| Class | Code | Description |
|-------|------|-------------|
| `CLIError` | (varies) | Base error class |
| `CommandNotFoundError` | `COMMAND_NOT_FOUND` | Unknown command |
| `MissingArgumentError` | `MISSING_ARGUMENT` | Required arg missing |
| `ExtraArgumentError` | `EXTRA_ARGUMENT` | Unexpected positional arg |
| `MissingOptionError` | `MISSING_OPTION` | Required option missing |
| `InvalidOptionError` | `INVALID_OPTION` | Bad option value |
| `UnknownOptionError` | `UNKNOWN_OPTION` | Unrecognized flag |
| `ValidationError` | `VALIDATION_ERROR` | Custom validation failed |
| `ParseError` | `PARSE_ERROR` | Input could not be tokenized or split into pipeline stages |
| `PromptCancelError` | `PROMPT_CANCELLED` | User cancelled prompt |

Additional structured fields:

| Class | Fields |
|-------|--------|
| `CommandNotFoundError` | `input`, optional `available` |
| `MissingArgumentError` | `argName`, optional `usage` |
| `ExtraArgumentError` | `extra` |
| `MissingOptionError` | `optionName` |
| `InvalidOptionError` | optional `optionName`, optional `value` |
| `UnknownOptionError` | `flag` |
| `ValidationError` | optional `cause`, optional `optionName` |
| `ParseError` | optional `quote` |

`ParseError` covers an unclosed quote (`quote` reports which one), an empty or
trailing pipe, and an unsupported redirection operator. It is raised before a
command is resolved, so a registered `catch()` fallback handler receives the input
instead of the error being thrown.

### Debug output

When an error reaches `start()` in direct argv mode, only its message is printed
as `Error: <message>`. Set `NODE_CLI_DEBUG=1` to print the full stack trace
instead, which is useful when the message alone does not identify the origin.

```bash
NODE_CLI_DEBUG=1 myapp deploy prod
```

This affects the direct argv path only. Command failures inside the interactive
shell always print the message, since the shell keeps running afterwards.

## Parsing and terminal utilities

The following helpers are exported for integrations that need the same parsing
and terminal-safety behavior as the CLI:

```typescript
tokenize(input: string): string[]
splitPipes(input: string): string[]
stripOptionPrefix(flag: string): string
sanitizeTerminalText(text: string, options?): string
splitGraphemes(text: string): string[]
streamIsTTY(stream: object): boolean
restoreCursor(): void
isCancellationError(error: unknown, signal?: AbortSignal): boolean
formatErrorMessage(error: unknown, signal?: AbortSignal): string
```

`CompletionResult` is also exported for custom shell and mode completers.

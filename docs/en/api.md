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

#### `history(filePath: string): this`

Set the history file path.

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
| `options.stdout` | `Writable` | `process.stdout` | Output stream |
| `options.stderr` | `Writable` | `process.stderr` | Error stream |

#### `start(argv?: string[]): Promise<void>`

Start the CLI. If `argv` is provided (or `process.argv` has args), runs in direct mode. Otherwise starts the interactive shell.

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

Set a custom tab-completion provider. The `CompletionContext` includes an `iteration` counter (1-based) that tracks consecutive Tab presses, allowing progressive completions.

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>

interface CompletionContext {
  line: string;           // Full input line
  current: string;        // Current word being completed
  commandPath: string[];  // Resolved command path
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  iteration: number;      // Consecutive Tab press count (1-based)
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
| `commandPath` | Resolved command path (e.g., `["db", "migrate"]`) |
| `shell` | Shell instance in interactive mode, `null` in direct mode |
| `stdin` | Readable stream (available in piped commands) |
| `stdout` | Writable stream for output |
| `stderr` | Writable stream for errors |
| `signal` | `AbortSignal` aborted when the command is cancelled (SIGINT); pair with abort-aware APIs or `cancel()` |

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
}
```

| Property | Default | Description |
|----------|---------|-------------|
| `type` | Inferred | Value type. Inferred as `"boolean"` for flags without `<value>`, `"string"` otherwise |
| `required` | `false` | Throw if not provided |
| `default` | — | Default value. Boolean options default to `false` |
| `choices` | — | Restrict to listed values |
| `parse` | — | Custom parser for raw string value |
| `validate` | — | Custom validator (throw on invalid) |
| `hidden` | `false` | Hide from help output |
| `autocomplete` | — | Completion candidates for option values. Array of strings or `(current: string) => string[] \| Promise<string[]>` |

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
  action: (input: string, ctx: { stdout: WritableStream; stderr: WritableStream }) => void | Promise<void>;
  message?: string;
}
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

### prompt.confirm

```typescript
function prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `default` | `boolean` | `false` | Default value |

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
| `min` | `number` | — | Minimum selections |
| `max` | `number` | — | Maximum selections |

### prompt.password

```typescript
function prompt.password(message: string, options?: PromptBaseOptions): Promise<string>
```

Input is masked with asterisks.

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
| `timestamp` | `boolean` | `false` | Show `[HH:MM:SS]` |
| `stream` | `Writable` | `process.stderr` | Output stream |

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

### LogLevel

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

---

## Error Classes

All extend `CLIError` which has a `code: string` property.

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
| `PromptCancelError` | `PROMPT_CANCELLED` | User cancelled prompt |

# Migrating from 1.x

Version 2.0.0 changes names, signatures and defaults across the public surface. The old forms are removed without deprecated aliases, and each section below shows the 1.x code and its replacement. Items 1 to 27 are the breaking changes; the notes at the end cover behaviour that matters when you move tests and scripts.

TypeScript reports most of these at compile time. The changes that appear only at runtime are items 1, 7, 8, 9 (exit codes), 10, 11, 16, 18, 19 and 20 to 27.

### 1. Entry points

`createCLI(options)` is the only way to construct a CLI, and `name` is required. A name is letters, digits, `.`, `_` and `-`, starting with a letter or digit; it names the history file `~/.<name>_history` and the help heading. `CLI` and `CommandBuilder` are exported as types only. `logger()` is `createLogger()`.

`cli.exec()` takes an argument array only. A command line written as one string, with quoting and `|` pipes, goes to `cli.execLine()`. Passing a string to `exec()` or a non-string to `execLine()` throws `TypeError`.

```typescript
// before
import { CLI, logger } from "@libraz/node-cli";

const cli = new CLI({ version: "1.0.0" }); // name defaulted to "cli"
const log = logger({ prefix: "app" });
await cli.exec("greet Ada | upper");
await cli.exec(["greet", "Ada"]);
```

```typescript
// after
import { createCLI, createLogger } from "@libraz/node-cli";
import type { CLI } from "@libraz/node-cli";

const cli: CLI = createCLI({ name: "app", version: "1.0.0" });
const log = createLogger({ prefix: "app" });
await cli.execLine("greet Ada | upper");
await cli.exec(["greet", "Ada"]);
```

### 2. Configuration moves into `createCLI`

The setters `prompt`, `description`, `banner`, `history`, `historySize` and `historyFilter` are removed. Pass the same values in `CLIOptions`; the history file option is named `historyFile`. `historySize`, `historyFilter` and `historyFile` are validated when the CLI is created, so an invalid value throws there instead of when the shell starts. A `historyFile` that is `~` or starts with `~/` expands to the home directory. To change the prompt while the shell runs, call `ctx.shell?.setPrompt()`.

```typescript
// before
const cli = new CLI({ name: "app" })
  .prompt("app> ")
  .description("Deploy tool")
  .banner("Welcome")
  .history("/tmp/app.history")
  .historySize(500)
  .historyFilter((line) => (line.startsWith("login ") ? null : line));
```

```typescript
// after
const cli = createCLI({
  name: "app",
  prompt: "app> ",
  description: "Deploy tool",
  banner: "Welcome",
  historyFile: "/tmp/app.history",
  historySize: 500,
  historyFilter: (line) => (line.startsWith("login ") ? null : line),
});
```

### 3. Builder renames and the completer signature

`.complete()` is `.completer()`, `.cancel()` is `.onCancel()`, and `OptionSchema.autocomplete` is `OptionSchema.completer`. A completer function receives a `CompletionContext` instead of the current word; read the word from `ctx.current`.

```typescript
// before
cli
  .command("open [name]")
  .option("--env <env>", { autocomplete: (current) => ["dev", "prod"].filter((e) => e.startsWith(current)) })
  .complete((current) => ["alpha", "beta"].filter((n) => n.startsWith(current)))
  .cancel((ctx) => ctx.stderr.write("cancelled\n"))
  .action(() => {});
```

```typescript
// after
cli
  .command("open [name]")
  .option("--env <env>", { completer: (ctx) => ["dev", "prod"].filter((e) => e.startsWith(ctx.current)) })
  .completer((ctx) => ["alpha", "beta"].filter((n) => n.startsWith(ctx.current)))
  .onCancel((ctx) => ctx.stderr.write("cancelled\n"))
  .action(() => {});
```

### 4. `catch` becomes `fallback`

`cli.catch()` is `cli.fallback()`, and `PluginContext.catch` is `PluginContext.fallback`. `CatchContext` is `FallbackContext`, which also carries `stdin`, `signal` and `rawArgv` (the full argument array when the CLI was called with one, `null` for a command line string).

```typescript
// before
import type { CatchContext } from "@libraz/node-cli";

cli.catch((input: string, ctx: CatchContext) => {
  ctx.stderr.write(`Unknown command: ${input}\n`);
});
```

```typescript
// after
import type { FallbackContext } from "@libraz/node-cli";

cli.fallback((input: string, ctx: FallbackContext) => {
  ctx.stderr.write(`Unknown command: ${input}\n`);
});
```

### 5. Mode completers return a plain array

A mode completer takes a `CompletionContext` and returns `readonly string[]`, the same shape as every other completer. The readline tuple and `CompletionResult` are removed. The library keeps the candidates that start with `ctx.current`, so return the full list. A static `readonly string[]` is accepted as well.

```typescript
// before
ctx.shell.enterMode({
  prompt: "sql> ",
  completer: (line) => {
    const word = line.split(" ").pop() ?? "";
    return [["select", "insert"].filter((k) => k.startsWith(word)), word];
  },
  action: () => {},
});
```

```typescript
// after
ctx.shell.enterMode({
  prompt: "sql> ",
  completer: ["select", "insert"],
  action: () => {},
});
```

### 6. The mode `message` is `banner`

The options type for `enterMode()` is `ModeOptions` (1.x: `ModeConfig`), and the handler type is `ModeAction`.

```typescript
// before
ctx.shell.enterMode({ prompt: "calc> ", message: "Calculator mode", action });
```

```typescript
// after
ctx.shell.enterMode({ prompt: "calc> ", banner: "Calculator mode", action });
```

### 7. `start()` resolves to the exit code

`start()` returns `Promise<number>`. It still sets `process.exitCode`, and the conditions under which it opens the interactive shell are unchanged.

```typescript
// before
await cli.start();
```

```typescript
// after
const code = await cli.start();
process.exitCode = code;
```

### 8. `use()` throws synchronous plugin errors in place

A synchronous plugin runs inside `use()`, and an error it throws reaches the caller of `use()`. Registrations made before the throw stay. An asynchronous plugin, or one registered behind a pending asynchronous plugin, is still queued, and its failure still surfaces later, wrapped once in an `Error` with `code: "ERR_PLUGIN_FAILED"` and the original value as `cause`: a later `use()` throws it, `exec()` and `execLine()` reject with it, and `start()` reports it and resolves to 1.

```typescript
// before
cli.use(() => {
  throw new Error("bad plugin");
}); // no error here; start() reported it later
```

```typescript
// after
try {
  cli.use(() => {
    throw new Error("bad plugin");
  });
} catch (err) {
  // thrown by use() itself
}
```

### 9. Error constructors, codes and exit codes

Every error constructor takes an options object, and `cause` is forwarded to `Error`. `new CLIError(message, { code?, exitCode?, cause? })` defaults `code` to `"FAILED"` and `exitCode` to 1; `exitCode` must be an integer from 1 to 255. `code` and `exitCode` are `readonly`. `CLIError.code` is typed `CLIErrorCode | (string & {})`; to read the fields of a built-in subclass, narrow with `isBuiltinCLIError()` and switch on `code`. `isCancellationError()` requires the signal, and `formatErrorMessage()` takes no signal and returns terminal-safe text that can span several lines. Several surplus arguments are reported by one `ExtraArgumentError`, which lists them in `extras` (1.x: `extra`).

The code names describe a state: `VALIDATION_ERROR` is `VALIDATION_FAILED`, `PARSE_ERROR` is `PARSE_FAILED`, and `PROMPT_CANCELLED` is `CANCELLED`. `PromptCancelError` is `CancelledError`. `InputEndedError` (`INPUT_ENDED`) is new.

Errors caused by the user's input exit with 64 (1.x: 1): `CommandNotFoundError`, `MissingArgumentError`, `ExtraArgumentError`, `MissingOptionError`, `InvalidOptionError`, `UnknownOptionError`, `ValidationError` and `ParseError`. `InputEndedError` exits with 66 and `CancelledError` with 130. Any other error thrown by an action exits with 1. Update wrapper scripts that test for exit code 1.

```typescript
// before
class DeployError extends CLIError {
  constructor(message: string) {
    super(message, "DEPLOY_FAILED", 3);
  }
}

if (isCancellationError(err)) return;
const text = formatErrorMessage(err, signal);
throw new ValidationError("bad value", cause, { optionName: "port" });
if (err instanceof PromptCancelError || err.code === "PROMPT_CANCELLED") return;
if (err.code === "VALIDATION_ERROR") report(err.optionName);
```

```typescript
// after
class DeployError extends CLIError {
  constructor(message: string) {
    super(message, { code: "DEPLOY_FAILED", exitCode: 3 });
  }
}

if (isCancellationError(err, signal)) return;
const text = formatErrorMessage(err);
throw new ValidationError("bad value", { optionName: "port", cause });
if (err instanceof CancelledError) return;

if (isBuiltinCLIError(err)) {
  switch (err.code) {
    case "UNKNOWN_OPTION":
      console.error(err.optionName);
      break;
    case "EXTRA_ARGUMENT":
      console.error(err.extras.join(", "));
      break;
    case "VALIDATION_FAILED":
      report(err.optionName);
      break;
  }
}
```

### 10. Programmer mistakes throw coded errors

Invalid arguments and invalid definitions throw `TypeError`, `RangeError` or `Error`, each with a `code` of type `UsageErrorCode`: `ERR_INVALID_ARG_TYPE`, `ERR_INVALID_ARG_VALUE`, `ERR_INVALID_DEFINITION`, `ERR_DEFINITION_CONFLICT`, `ERR_COMMAND_REMOVED`, `ERR_ALREADY_STARTED`, `ERR_OUTPUT_BUSY` and `ERR_INPUT_BUSY`. Code that matched on messages or on `instanceof Error` alone should test `code` or the more specific class. These errors are not `CLIError`s: they signal a defect in the program, not bad user input.

```typescript
// before
try {
  createLogger({ level: "verbose" as never });
} catch (err) {
  if (err instanceof Error && /level/.test(err.message)) fallbackLevel();
}
```

```typescript
// after
try {
  createLogger({ level: "verbose" as never });
} catch (err) {
  if (err instanceof RangeError && (err as RangeError & { code?: string }).code === "ERR_INVALID_ARG_VALUE") {
    fallbackLevel();
  }
}
```

### 11. Option placeholders must agree with `type`

An option whose flags use the `<number>` or `<boolean>` placeholder must declare the matching `type`. Without it, or with a contradicting type, the definition throws `ERR_INVALID_DEFINITION`.

```typescript
// before
cli.command("serve").option("--port <number>").action(() => {});
```

```typescript
// after
cli.command("serve").option("--port <number>", { type: "number" }).action(() => {});
// or rename the placeholder
cli.command("serve").option("--port <n>", { type: "number" }).action(() => {});
```

### 12. Context members are readonly

All `CommandContext` members are `readonly`, including arrays (`readonly string[]`). `rawArgv` is `readonly string[] | null`: `null` for string input (`execLine()`), the array for array input. `ctx.args` and `ctx.options` are typed from a literal definition string and the option schemas, so casts such as `ctx.args.env as string` are no longer needed.

```typescript
// before
if (ctx.rawArgv !== undefined) run(ctx.rawArgv);
ctx.args.env = "prod";
const env = ctx.args.env as string;
```

```typescript
// after
if (ctx.rawArgv !== null) run(ctx.rawArgv);
const env: string = ctx.args.env; // from the definition "deploy <env>"
```

### 13. Names removed or renamed in the package root

`stripOptionPrefix`, `splitPipes`, `activePipeSegment`, `maskInput`, `restoreCursor`, the top-level `releaseAll`, `resetColorEnabled`, `CompletionResult`, `TableStyle`, `CatchContext`, `PromptBaseOptions` and `ExecOptions` are no longer exported. Use `StdioOptions` for the options of `exec()`, `PromptOptions` for prompt options, `FallbackContext` for the fallback handler, `setColorEnabled("auto")` to reset colour detection and `progress.releaseAll()` to release terminal state. `streamIsTTY` is `isTTY`, which accepts any value. `ModeConfig` is `ModeOptions`. `tokenize` stays.

```typescript
// before
import { releaseAll, resetColorEnabled, type ExecOptions } from "@libraz/node-cli";

releaseAll();
resetColorEnabled();
const opts: ExecOptions = { stdin };
```

```typescript
// after
import { progress, setColorEnabled, type StdioOptions } from "@libraz/node-cli";

progress.releaseAll();
setColorEnabled("auto");
const opts: StdioOptions = { stdin };
```

### 14. Colour

`color.<name>` accepts only the 23 `StyleName` values. An unknown name is a type error, and at runtime a `RangeError` that lists the valid names. Check dynamic names with `isStyleName()`. `setColorEnabled()` takes `boolean | "auto"`. Every stream parameter is `Writable`. `sanitizeTerminalText()` closes the styles it leaves open. `colorTag` is a template tag bound to `process.stdout`, and `createColorTag(stream)` binds one to another stream; both are new. `NO_COLOR` and `setColorEnabled(false)` switch off every style, modifiers such as bold included.

```typescript
// before
const text = color[userInput]("hello"); // threw at runtime for an unknown name
resetColorEnabled();
```

```typescript
// after
import { color, isStyleName, setColorEnabled } from "@libraz/node-cli";

const text = isStyleName(userInput) ? color[userInput]("hello") : "hello";
setColorEnabled("auto");
```

### 15. Prompts

Prompts ask on stderr and read from stdin, and accept a context directly. The `stdout` option is removed: use `stderr`, or `{ stderr: process.stdout }` to ask on stdout. `prefix` is `marker`. `required` exists only on `text()` and `password()`. The message and the marker are drawn on one line: a newline becomes a space and cursor-control sequences are removed.

```typescript
// before
const name = await prompt.text("Name?", { stdout: ctx.stdout, prefix: ">" });
```

```typescript
// after
const name = await prompt.text("Name?", { ...ctx, marker: ">" });
// to keep asking on stdout
const same = await prompt.text("Name?", { stderr: process.stdout });
```

### 16. Progress

`Bar`, `Spinner` and `MultiBar` share `succeed()`, `fail()`, `warn()` and `stop()`. `finish()` is removed; `succeed()` replaces it. `stop()` keeps the last frame and ends the line; it no longer erases the row, and that includes `Spinner`. Drawing starts when the indicator is created, so `Spinner.start()` is removed, and creating an indicator on an output that another indicator holds throws `ERR_OUTPUT_BUSY` immediately. Other changes:

- The output option of `bar`, `spinner`, `multi` and `createLogger` is `stderr` (1.x: `stream`), the same name `CommandContext` uses, so `progress.spinner({ ...ctx, label })` works. `MultiBar.add()` takes no output option.
- The colour option of `bar` and `spinner` is `style` (1.x: `color`). An unknown style throws when the indicator is created.
- `Spinner.update()` is `setLabel()`, and `Bar` has `setLabel()` too. `SpinnerOptions.interval` is `intervalMs`.
- The `BarState` fields are `current`, `total`, `percent`, `elapsedMs`, `etaMs` and `ratePerSecond`, all `readonly`.
- A negative, `NaN` or infinite `total` throws `RangeError` when the bar is created. 1.x treated it as 0.
- `filled` and `empty` must be one column wide.
- On a non-TTY stream, `succeed()`, `fail()` and `warn()` write one result line for bars and multi-bars too. `TERM=dumb` counts as a non-TTY.
- Indicators created while a command runs are released when that command ends, so a concurrent command's indicators stay. `progress.releaseAll()` still releases every indicator in the process.

```typescript
// before
const spinner = progress.spinner({ label: "Build", interval: 80, color: "cyan", stream: ctx.stderr });
spinner.start();
spinner.update("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10, color: "green" });
bar.update(10);
bar.finish();
const { elapsed, eta, rate } = state;
const multi = progress.multi();
multi.add({ total: 5, stream: process.stderr });
```

```typescript
// after
const spinner = progress.spinner({ label: "Build", intervalMs: 80, style: "cyan", stderr: ctx.stderr });
spinner.setLabel("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10, style: "green" });
bar.update(10);
bar.succeed();
const { elapsedMs, etaMs, ratePerSecond } = state;
const multi = progress.multi({ stderr: process.stderr });
multi.add({ total: 5 });
```

### 17. Tables

Per-column settings move into `columns`. Colour styles and padding use flat keys, and the `TableChars` keys are camelCase.

| 1.x | 2.0.0 |
| --- | --- |
| `style.head`, `headerStyle` | `headerStyle` |
| `style.border` | `borderStyle` |
| `style["padding-left"]`, `style["padding-right"]` | `paddingLeft`, `paddingRight` |
| `padding` | `gap` |
| `style.compact: false` | `rowSeparators: true` |
| `truncate` | `ellipsis` |
| `align[key]`, `colAligns[i]` | `ColumnSpec.align` |
| `colWidths[i]` | `ColumnSpec.width` |
| `maxWidth[key]` | `ColumnSpec.maxWidth` |
| `headerLabels[key]` | `ColumnSpec.label` |

`TableChars` keys: `top-left`, `top-mid`, `top-right`, `bottom-left`, `bottom-mid`, `bottom-right`, `left-mid` and `right-mid` become `topLeft`, `topMid`, `topRight`, `bottomLeft`, `bottomMid`, `bottomRight`, `leftMid` and `rightMid`. `mid` is `horizontal`, `mid-mid` is `cross`, and `middle` is `vertical`. An unknown style or border name, or an invalid width, throws. A glyph in `chars` must be one column wide. `ColumnSpec.width` and `maxWidth` both measure the content, without padding. Column keys and rows are typed from the row type, so interfaces and class instances are accepted, and rows given as arrays need no `key`.

```typescript
// before
table(rows, {
  headerLabels: { name: "Name" },
  colWidths: [12, 8],
  align: { size: "right" },
  maxWidth: { name: 20 },
  truncate: "..",
  style: { head: "cyan", border: "dim", compact: false, "padding-left": 2 },
});
```

```typescript
// after
table(rows, {
  columns: [
    { key: "name", label: "Name", width: 12, maxWidth: 20 },
    { key: "size", width: 8, align: "right" },
  ],
  ellipsis: "..",
  headerStyle: "cyan",
  borderStyle: "dim",
  rowSeparators: true,
  paddingLeft: 2,
});
```

### 18. `truncateAnsi` validates its width

`truncateAnsi(text, width, ellipsis?)` throws `RangeError` when `width` is 0 or less, `NaN`, `-Infinity` or fractional. 1.x returned an empty string. `Infinity` means no limit.

```typescript
// before
truncateAnsi(text, process.stdout.columns - 10); // "" on a narrow terminal
```

```typescript
// after
const width = Math.max(1, process.stdout.columns - 10);
truncateAnsi(text, width);
```

### 19. Prompt input ends with `InputEndedError`

A prompt given a context reads `ctx.stdin`. When that is `null` (under `exec()` or `execLine()` without a `stdin` option), the prompt rejects with `InputEndedError` before it writes the question; 1.x read `process.stdin`. Only an omitted `stdin` means `process.stdin`. End of input before an answer, including while the prompt asks again, rejects with `InputEndedError` (exit code 66) as well; 1.x reported it as a cancellation. A read error from the stream is rethrown unchanged, and Ctrl-C or an abort rejects with `CancelledError`.

In the interactive shell, the `ctx.stdin` of a command and of a mode action is the terminal shared with the line editor (`ModeContext` carries `stdin`, which is no longer `null`). Read it through `prompt.*`; a command that reads it to the end blocks the shell.

```typescript
// before
await cli.exec("greet"); // waited on process.stdin
```

```typescript
// after
import { PassThrough } from "node:stream";

const stdin = new PassThrough();
stdin.end("Ada\n");
await cli.execLine("greet", { stdin });
// without stdin: rejects with InputEndedError
```

### 20. Option and argument keys are camelCase

The keys of `ctx.options` and `ctx.args` are the name in camelCase: `--dry-run` is `ctx.options.dryRun` and `<file-name>` is `ctx.args.fileName`. Types follow the same rule. The first long name in a flags string is the canonical one (1.x: the last), and help lists it first. A `--no-x` flag sets `x` to false when `x` is defined; without such an option, `--no-x` is an option of its own with the key `noX`. `CompletionContext.options` and `CompletionContext.args` use the same keys.

Option, argument, command and alias names consist of letters and digits joined by single dashes. A name with `_`, a non-ASCII character or a doubled or trailing dash throws `ERR_INVALID_DEFINITION`. Two options of one command whose keys collide after conversion (`--dry-run` and `--dryRun`) throw `ERR_DEFINITION_CONFLICT`.

```typescript
// before
cli.command("deploy").option("--dry-run").option("--colour, --color <n>").action((ctx) => {
  const dry = ctx.options["dry-run"]; // and "color" for the second option
});
```

```typescript
// after
cli.command("deploy").option("--dry-run").option("--colour, --color <n>").action((ctx) => {
  const { dryRun, colour } = ctx.options;
});
```

### 21. Choices, defaults and validation

The element type of `choices` matches the value type: `readonly number[]` for `type: "number"`, `readonly string[]` for strings. A mismatch is a type error and throws `ERR_INVALID_DEFINITION` at definition time. The input is converted first and then compared with `===`; the loose string match is gone. `choices` cannot be combined with `parse` or `type: "boolean"`, and an empty `choices` throws. A numeric choice must be finite and at most `Number.MAX_SAFE_INTEGER` in absolute value.

`default` is typed as the option's value (the return type of `parse` when there is one) and is never passed through `parse`. `validate` and `parse` callbacks receive typed values.

A value thrown by a command `validate` is wrapped in a `ValidationError` (exit code 64; 1.x passed it through with exit code 1), as option `validate` and `parse` failures already were. A thrown `CLIError` passes through unchanged, and a cancellation stays a cancellation.

```typescript
// before
cli.command("scale").option("--n <n>", { type: "number", choices: ["1", "2"] as never });
cli.command("check").validate(() => {
  throw new Error("not allowed"); // exit code 1, plain Error
});
```

```typescript
// after
cli.command("scale").option("--n <n>", { type: "number", choices: [1, 2] });
cli.command("check").validate(() => {
  throw new Error("not allowed"); // ValidationError, exit code 64
});
```

### 22. Cancellation rejects with `CancelledError`

`exec()` and `execLine()` reject with `CancelledError` when the command was cancelled, from an aborted `signal` or from a prompt. The `cause` is the signal's reason. `start()` does not reject: it resolves to exit code 130. A cancellation does not fire `commandError` or `error`. A signal that is already aborted rejects before any plugin initialization or command hook runs. `exec()` and `execLine()` no longer listen for `SIGINT`; cancel with `options.signal`. `start()` and the interactive shell keep the `SIGINT` handling: the first press cancels, the second forces exit.

```typescript
// before
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") return;
  throw err;
}
```

```typescript
// after
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (err instanceof CancelledError) return;
  throw err;
}
```

### 23. Top-level flags

`app --help deploy` and `app -h deploy` print the help of `deploy`, the same as `app help deploy`. Any other unknown top-level flag, and `--version` or `-V` when no `version` is set, is an `UnknownOptionError` (exit code 64); 1.x reported `Command not found`. The command list always shows `-h, --help` under `Options:`, and `-V, --version` when a version is set. `Shell commands: exit, quit` appears only in the interactive shell's help.

```text
# before
$ app --frobnicate
Command not found: "--frobnicate"
```

```text
# after
$ app --frobnicate
Unknown option: "--frobnicate"
```

### 24. Returned arrays and select defaults

`prompt.multiselect()` resolves to `readonly T[]`, `splitAnsi()` returns `readonly AnsiSegment[]`, and `splitGraphemes()` and `tokenize()` return `readonly string[]`. `prompt.select()` and `prompt.multiselect()` infer a literal union from the choices without `as const`. A `default` that matches none of the choices throws `RangeError` before the question is asked.

```typescript
// before
const features: string[] = await prompt.multiselect("Features", ["a", "b"], ctx);
const level = await prompt.select("Level", ["low", "high"] as const, { ...ctx, default: "hgih" });
```

```typescript
// after
const features: readonly string[] = await prompt.multiselect("Features", ["a", "b"], ctx);
const level = await prompt.select("Level", ["low", "high"], { ...ctx, default: "high" }); // "low" | "high"
```

### 25. Status lines

`log.success`, `log.error` and `log.warn`, and the `succeed`, `fail` and `warn` lines of bars and spinners, choose the symbol and the colour independently. The symbol is `✔`, `✖` or `⚠` when the stream is a TTY and `TERM` is not `dumb`, and `[OK]`, `[ERROR]` or `[WARN]` otherwise. Colour is applied when colour is enabled for the stream. 1.x chose the symbol by whether colour was on, so two cases change: a TTY with `NO_COLOR` set now shows the plain symbols (1.x: ASCII marks), and a non-TTY with `FORCE_COLOR` now shows coloured ASCII marks (1.x: symbols).

```text
# before: TTY with NO_COLOR=1
[OK] Build finished
```

```text
# after: TTY with NO_COLOR=1
✔ Build finished
```

### 26. Direct-mode help and usage start with the program name

Help pages, the command index, the `Usage:` line of an error and the closing hint now name the program when the CLI runs directly, so the text can be copied into a shell. `<name>` is the `name` given to `createCLI`. The interactive shell keeps the old text, because nobody types the program name there. A test that compares `--help` output, or an error's `usage`, must expect the new text.

```text
# before
$ myapp deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [options]
$ myapp help deploy
Usage: deploy <env> [options]
$ myapp
...
Type "help <command>" for more information.
```

```text
# after
$ myapp deploy
Error: Missing required argument: <env>

  Usage: myapp deploy <env> [options]
$ myapp help deploy
Usage: myapp deploy <env> [options]
$ myapp
...
Usage: myapp <command> [options]
...
Run "myapp help <command>" for more information.
```

### 27. A leading `--` ends the options

`--` is the end-of-options marker, not a command name. A leading `--` is dropped before the command is looked up, in `start()`, `exec()`, `execLine()` and the interactive shell. 1.x reported it as an unknown command. An input with nothing left after it resolves without doing anything (`start()` prints the help index); a leading empty string followed by a command is still `CommandNotFoundError`.

```text
# before
$ myapp -- greet World
Error: Command not found: "--"
```

```text
# after
$ myapp -- greet World
Hello, World!
```

## Notes

### Cancellation

The process-wide `error` event handler receives no signal, and a cancellation does not reach it. Test for a cancellation with `err instanceof CancelledError` and use `isCancellationError(err, signal)` where the command's `ctx.signal` is in scope; the latter also recognizes a raw `AbortError`.

```typescript
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (!(err instanceof CancelledError)) throw err;
}
```

### Exit codes in tests

`start()` sets `process.exitCode`. A test that calls it must restore the previous value, or the test runner exits with the command's code.

```typescript
const saved = process.exitCode;
try {
  const code = await cli.start(["deploy", "prod"]);
  expect(code).toBe(0);
} finally {
  process.exitCode = saved;
}
```

### Prompts write to stderr

A shell redirect such as `app 2>log` hides the questions. To ask on stdout again, pass `{ stderr: process.stdout }`.

### Finish indicators before prompting

Prompts and progress indicators share stderr. Call `succeed()`, `fail()`, `warn()` or `stop()` on a bar or spinner before asking a question; otherwise the question line interleaves with the indicator's frames.

```typescript
const spinner = progress.spinner({ label: "Checking" });
await check();
spinner.stop();
const ok = await prompt.confirm("Continue?", ctx);
```

### Pass stdin to `exec()` in prompt tests

A command that calls `prompt.*(..., ctx)` rejects with `InputEndedError` when the test gives `exec()` or `execLine()` no `stdin`. Pass a stream that holds the answers.

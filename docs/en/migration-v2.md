# Migrating from 1.x

Version 2.0.0 changes names, signatures and defaults across the public surface. The old forms are removed without deprecated aliases, and each section below shows the 1.x code and its replacement. Items 1 to 19 are the breaking changes; the notes at the end cover behaviour that matters when you move tests and scripts.

TypeScript reports most of these at compile time. The changes that appear only at runtime are items 7, 8, 10, 11, 16, 18 and 19.

### 1. Entry points

`createCLI()` is the only way to construct a CLI. `CLI` and `CommandBuilder` are exported as types only. `logger()` is `createLogger()`.

```typescript
// before
import { CLI, logger } from "@libraz/node-cli";

const cli = new CLI({ name: "app" });
const log = logger({ prefix: "app" });
```

```typescript
// after
import { createCLI, createLogger } from "@libraz/node-cli";
import type { CLI } from "@libraz/node-cli";

const cli: CLI = createCLI({ name: "app" });
const log = createLogger({ prefix: "app" });
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

`cli.catch()` is `cli.fallback()`, and `PluginContext.catch` is `PluginContext.fallback`. `CatchContext` is `FallbackContext`, which also carries `stdin` and `signal`.

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

A mode completer takes a `CompletionContext` and returns `readonly string[]`, the same shape as every other completer. The readline tuple and `CompletionResult` are removed. The library does not filter the candidates, so filter on `ctx.current`.

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
  completer: (ctx) => ["select", "insert"].filter((k) => k.startsWith(ctx.current)),
  action: () => {},
});
```

### 6. `ModeConfig.message` is `banner`

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

A synchronous plugin runs inside `use()`, and an error it throws reaches the caller of `use()`. Registrations made before the throw stay. An asynchronous plugin, or one registered behind a pending asynchronous plugin, is still queued, and its failure still surfaces from `start()`.

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

### 9. Error constructors and helpers

Every error constructor takes an options object, and `cause` is forwarded to `Error`. `code` and `exitCode` are `readonly`. `CLIError.code` is typed `CLIErrorCode | (string & {})`; to read the fields of a built-in subclass, narrow with `isBuiltinCLIError()` and switch on `code`. `isCancellationError()` requires the signal, and `formatErrorMessage()` takes no signal. Several surplus arguments are reported by one `ExtraArgumentError`, which lists them in `extras`.

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

if (isBuiltinCLIError(err)) {
  switch (err.code) {
    case "UNKNOWN_OPTION":
      console.error(err.optionName);
      break;
    case "EXTRA_ARGUMENT":
      console.error(err.extras.join(", "));
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

All `CommandContext` members are `readonly`, including arrays (`readonly string[]`). `rawArgv` is `readonly string[] | null`: `null` for string input, the array for array input. `ctx.args` and `ctx.options` are typed from a literal definition string and the option schemas, so casts such as `ctx.args.env as string` are no longer needed.

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

### 13. Names removed from the package root

`stripOptionPrefix`, `splitPipes`, `activePipeSegment`, `maskInput`, `restoreCursor`, the top-level `releaseAll`, `resetColorEnabled`, `CompletionResult`, `TableStyle`, `CatchContext`, `PromptBaseOptions` and `ExecOptions` are no longer exported. Use `StdioOptions` for the options of `exec()`, `PromptOptions` for prompt options, `FallbackContext` for the fallback handler, `setColorEnabled("auto")` to reset colour detection and `progress.releaseAll()` to release terminal state. `tokenize` stays.

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

`color.<name>` accepts only the 23 `StyleName` values. An unknown name is a type error, and at runtime a `RangeError` that lists the valid names. Check dynamic names with `isStyleName()`. `setColorEnabled()` takes `boolean | "auto"`. Every stream parameter is `Writable`. `sanitizeTerminalText()` closes the styles it leaves open. `createTemplateTag(stream)` is new, and `c` is that tag bound to `process.stdout`.

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

Prompts ask on stderr and read from stdin, and accept a context directly. The `stdout` option is removed: use `stderr`, or `{ stderr: process.stdout }` to ask on stdout. `prefix` is `marker`. `required` exists only on `text()` and `password()`.

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

- `Spinner.update()` is `setLabel()`, and `SpinnerOptions.interval` is `intervalMs`.
- The `BarState` fields are `current`, `total`, `percent`, `elapsedMs`, `etaMs` and `ratePerSecond`.
- `progress.multi({ stream })` selects the output, and `add()` no longer takes `stream`.
- An unknown `color` throws when the indicator is created.
- A negative, `NaN` or infinite `total` throws `RangeError` when the bar is created. 1.x treated it as 0.
- On a non-TTY stream, `succeed()`, `fail()` and `warn()` write one result line for bars and multi-bars too.

```typescript
// before
const spinner = progress.spinner({ label: "Build", interval: 80 });
spinner.start();
spinner.update("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10 });
bar.update(10);
bar.finish();
const { elapsed, eta, rate } = state;
const multi = progress.multi();
multi.add({ total: 5, stream: process.stderr });
```

```typescript
// after
const spinner = progress.spinner({ label: "Build", intervalMs: 80 });
spinner.setLabel("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10 });
bar.update(10);
bar.succeed();
const { elapsedMs, etaMs, ratePerSecond } = state;
const multi = progress.multi({ stream: process.stderr });
multi.add({ total: 5 });
```

### 17. Tables

Per-column settings move into `columns`. Colours and padding use flat keys, and the `TableChars` keys are camelCase.

| 1.x | 2.0.0 |
| --- | --- |
| `style.head`, `headerStyle` | `headerStyle` |
| `style.border` | `borderColor` |
| `style["padding-left"]`, `style["padding-right"]` | `paddingLeft`, `paddingRight` |
| `padding` | `gap` |
| `style.compact: false` | `rowSeparators: true` |
| `truncate` | `ellipsis` |
| `align[key]`, `colAligns[i]` | `ColumnSpec.align` |
| `colWidths[i]` | `ColumnSpec.width` |
| `maxWidth[key]` | `ColumnSpec.maxWidth` |
| `headerLabels[key]` | `ColumnSpec.label` |

`TableChars` keys: `top-left`, `top-mid`, `top-right`, `bottom-left`, `bottom-mid`, `bottom-right`, `left-mid` and `right-mid` become `topLeft`, `topMid`, `topRight`, `bottomLeft`, `bottomMid`, `bottomRight`, `leftMid` and `rightMid`. `mid` is `horizontal`, `mid-mid` is `cross`, and `middle` is `vertical`. An unknown style or border name, or an invalid width, throws.

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
  borderColor: "dim",
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

### 19. A prompt given `ctx` reads the context's stdin

A prompt given a context reads `ctx.stdin`. When that is `null` (under `exec()` without a `stdin` option, or inside the interactive shell), the prompt reads `process.stdin`. Tests pass the stream explicitly.

```typescript
// before
await cli.exec("greet");
```

```typescript
// after
import { PassThrough } from "node:stream";

const stdin = new PassThrough();
stdin.end("Ada\n");
await cli.exec("greet", { stdin });
```

## Notes

### Cancellation

The process-wide `error` event handler receives no signal. Detect a cancelled prompt with `err instanceof PromptCancelError`, and use `isCancellationError(err, signal)` where the command's `ctx.signal` is in scope.

```typescript
cli.on("error", (err) => {
  if (err instanceof PromptCancelError) return;
  console.error(err.message);
});
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

A command that calls `prompt.*(..., ctx)` blocks on `process.stdin` when the test gives `exec()` no `stdin`. Always pass one.

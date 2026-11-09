# Errors

Failures fall into three families.

- A failure caused by user input is an instance of `CLIError` or one of its subclasses. Each carries a machine-readable `code` and an `exitCode`, the status number the process should end with when the failure is fatal. An "exit code" is the number a program returns to whatever started it; `0` means success and any other value means failure.
- A failure caused by the program calling the API wrongly is a `TypeError`, `RangeError` or `Error` with a `code` from `UsageErrorCode`. See [Programmer misuse](#programmer-misuse).
- A cancellation is a `CancelledError`, a `CLIError` that reports exit code `130`. See [Cancellation](#cancellation).

## How errors surface

The two run modes present the same error differently, because only one of them owns the process.

### Direct mode

In direct mode (`cli.start()` with command-line arguments), a failure is written to the standard error stream and the process exit code is set from the error:

```
$ mycli deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
$ echo $?
64
```

### Interactive shell

In the interactive shell the same message is printed, but the exit code is **discarded** and the prompt returns. A failed command does not end the session.

```
mycli> deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
mycli>
```

The message text is identical in both modes; only the process-level consequence differs.

## Error classes

All of these are exported from the package and all extend `CLIError`. Every constructor takes the message-like first argument shown and an optional options object, which may be omitted.

| Class | `code` | `exitCode` | Extra fields | Thrown when |
|---|---|---|---|---|
| `CLIError(message, CLIErrorOptions)` | as given, default `FAILED` | as given, default `1` | `code`, `exitCode`, `cause?` | The base class. Safe to subclass |
| `CommandNotFoundError(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `64` | `input`, `available?` | Unrecognized input with no `fallback` handler; an unknown child of a command group; `help <unknown>` |
| `MissingArgumentError(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `64` | `argName`, `usage?` | A required positional argument is absent. A required variadic argument with no values reports `...name` |
| `ExtraArgumentError(extras, { usage?, cause? })` | `EXTRA_ARGUMENT` | `64` | `extras`, `usage?` | Positional values are left over after the command's arguments are filled |
| `MissingOptionError(optionName, { usage?, cause? })` | `MISSING_OPTION` | `64` | `optionName`, `usage?` | An option declared `required: true` is absent |
| `InvalidOptionError(message, { optionName?, value?, usage?, cause? })` | `INVALID_OPTION` | `64` | `optionName?`, `value?`, `usage?` | Type coercion failed, a `choices` constraint was violated, a value-taking option was given no value, `--no-x=v` was used, `--no-x` was applied to a non-boolean option, or a value-taking short flag appeared inside a cluster such as `-abc` |
| `UnknownOptionError(flag, { usage?, cause? })` | `UNKNOWN_OPTION` | `64` | `flag`, `optionName` (the flag without dashes), `usage?` | An unrecognized flag |
| `ValidationError(message, { optionName?, value?, usage?, cause? })` | `VALIDATION_FAILED` | `64` | `optionName?`, `value?`, `usage?` | An option's custom `parse` or `validate`, or a command's `validate`, threw |
| `ParseError(message, { quote?, cause? })` | `PARSE_FAILED` | `64` | `quote?` | An unclosed quote, an empty or trailing pipe segment, or a `<` / `>` redirection operator |
| `CancelledError({ cause? })` | `CANCELLED` | **`130`** | — | A prompt was cancelled by Ctrl+C, a command was cancelled, or a signal was aborted |
| `InputEndedError(promptMessage, { cause? })` | `INPUT_ENDED` | **`66`** | `promptMessage` | A prompt had no input to read: `stdin` was `null`, or the input ended before an answer |

Every constructor accepts `{ cause }`, which is forwarded to `Error` and exposed as `err.cause`. `code` and `exitCode` are `readonly`.

`CLIErrorOptions` is `{ code?, exitCode?, cause? }`. `code` is any string, with the built-in codes offered by editor completion and `"FAILED"` as the default. `exitCode` is an integer from 1 to 255 and defaults to `1`; a value that is not a number throws `TypeError` (`ERR_INVALID_ARG_TYPE`), and a non-integer or out-of-range value throws `RangeError` (`ERR_INVALID_ARG_VALUE`), at construction.

The `Extra fields` column holds what each class adds. The fields have these meanings:

- `usage` is the command's usage line. When present, it is appended to the message as `\n\n  Usage: <usage>`. Every error raised while a command is being resolved (missing or extra argument, missing, invalid or unknown option, validation) carries it, so the hint is the same for all of them.
- `optionName` is the canonical long name in its kebab-case spelling, without dashes (`dry-run`), for an option that has a definition. For `UnknownOptionError`, which has no definition, it is the typed flag without its dashes. The key of the same option in `ctx.options` is the camelCase form (`dryRun`).
- `flag` is one unknown flag in a normalized spelling: `--xyz=3` is reported as `--xyz`, and an unknown `x` inside the cluster `-vx` as `-x`.
- `value` on `InvalidOptionError` and `ValidationError` is the rejected value: the raw input string when type coercion or `parse` failed, the value handed to `validate` when its check failed. A command-level validation failure carries neither `value` nor `optionName`.
- `extras` on `ExtraArgumentError` lists every unexpected value in input order, and is never empty: an empty array throws `RangeError` (`ERR_INVALID_ARG_VALUE`). Its message is `Unexpected argument: "a"` for one and `Unexpected arguments: "a", "b"` for several.

### Message quoting

Two families of messages follow different quoting rules.

- A message about user input puts the user's text in double quotes and leaves names the author defined unquoted: `Unknown option: "--x"`, `Missing required option: --x`, `Command not found: "depoly"`. A quoted string is escaped and made safe for a terminal.
- A message about programmer misuse follows the form of Node's own argument errors and quotes the author's names too: `The "total" option of progress.bar() must be a finite number. Received -1`.

`CLIErrorCode` is the union of the ten built-in code strings. A bare `CLIError` defaults to `FAILED`, which is not part of the union:

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

`BuiltinCLIError` is the union of the ten built-in subclasses above.

Two class names differ from their codes in spelling. The rest of the code names follow the class names.

| Class | `code` |
|---|---|
| `ValidationError` | `VALIDATION_FAILED` |
| `ParseError` | `PARSE_FAILED` |

A custom `parse` or `validate` on an option, and a command-level `.validate()`, are handled the same way. A thrown `CLIError` passes through unchanged, a cancellation is treated as a cancellation, and any other value is wrapped in a `ValidationError` whose `cause` is the original value. For an option, the wrapper also carries `optionName` and `value`, and the message reads `Invalid value "x" for --name: <cause message>`. An option declared with an empty `choices` array is rejected when the option is defined, with `Error` code `ERR_INVALID_DEFINITION`; see [Options](options.md).

## Inspecting an error

Every error exposes `code` and `exitCode`; subclasses add fields describing what specifically went wrong.

```typescript
import {
  CLIError,
  CommandNotFoundError,
  InvalidOptionError,
  MissingArgumentError,
} from "@libraz/node-cli";

function describe(err: unknown): string {
  if (err instanceof MissingArgumentError) {
    return `argument <${err.argName}> is required`;
  }
  if (err instanceof InvalidOptionError) {
    return `--${err.optionName ?? "?"} rejected ${JSON.stringify(err.value)}`;
  }
  if (err instanceof CommandNotFoundError) {
    const hint = err.available ? ` (try: ${err.available.join(", ")})` : "";
    return `no such command: ${err.input}${hint}`;
  }
  if (err instanceof CLIError) {
    return `${err.code} (exit ${err.exitCode})`;
  }
  return String(err);
}
```

To handle every built-in failure without casts, narrow an `unknown` with `isBuiltinCLIError` and switch on `code`. Each case reaches its own fields:

```typescript
import { isBuiltinCLIError } from "@libraz/node-cli";

function hint(err: unknown): string | undefined {
  if (!isBuiltinCLIError(err)) return undefined;
  switch (err.code) {
    case "MISSING_ARGUMENT":
      return `pass <${err.argName}>`;
    case "EXTRA_ARGUMENT":
      return `drop ${err.extras.join(" ")}`;
    case "UNKNOWN_OPTION":
      return `no option named ${err.optionName}`;
    default:
      return undefined;
  }
}
```

`isBuiltinCLIError` is `false` for a bare `CLIError` and for your own subclasses; test those with `instanceof CLIError` or your own class.

Matching on `code` instead of on the class works equally well, and survives being passed across a boundary where the class identity is lost:

```typescript
cli.on("commandError", (error, ctx) => {
  if (error instanceof CLIError && error.code === "MISSING_OPTION") {
    ctx.stderr.write("Run with --help to see the required options.\n");
  }
});
```

See [Events and plugins](events-and-plugins.md) for `commandError` and `error`.

## Throwing your own error from an action

Any throw from an action is a failure. A plain `Error` is reported with its message and ends the process with `1`. A value that is not an `Error` is normalized first: a string becomes the message, any other value is rendered with `util.inspect` as the message, and the original value is kept as `cause`. Listeners for `commandError` and `error` always receive an `Error`.

```typescript
cli
  .command("deploy <env>")
  .option("--force", { description: "Skip the production guard" })
  .action((ctx) => {
    const env = ctx.args.env;
    if (env === "prod" && !ctx.options.force) {
      throw new Error("Deploying to prod requires --force");
    }
    ctx.stdout.write(`Deploying to ${env}\n`);
  });
```

Output:

```
Error: Deploying to prod requires --force
```

### A custom `CLIError` subclass

Subclass `CLIError` when a failure needs its own exit code, for instance so a wrapper script can distinguish a configuration problem from a network problem. The `code` may be any string (the ten `CLIErrorCode` values are offered by editor completion); the exit code is any integer from 1 to 255. `new CLIError(message)` alone is valid and yields code `FAILED` and exit code `1`. Pass `{ cause }` to keep the original error attached.

```typescript
import { access } from "node:fs/promises";
import { CLIError } from "@libraz/node-cli";

class ConfigError extends CLIError {
  readonly path: string;

  constructor(message: string, path: string) {
    // 78 is the conventional "configuration error" status.
    super(message, { code: "CONFIG_ERROR", exitCode: 78 });
    this.name = "ConfigError";
    this.path = path;
  }
}

cli
  .command("start")
  .action(async (ctx) => {
    const path = "/etc/mycli/config.json";
    try {
      await access(path);
    } catch {
      throw new ConfigError(`Configuration file not found: ${path}`, path);
    }
    ctx.stdout.write("started\n");
  });
```

In direct mode that ends the process with status `78`. In the interactive shell the message is printed and the prompt returns, as with any other failure.

## Cancellation

A cancellation is not a failure: the user asked for the work to stop. It is a `CancelledError` (code `CANCELLED`, message `Cancelled`, exit code `130`), presented as a single word with the conventional interrupt status:

```
Cancelled
```

A cancellation does not fire `commandError` or `error`. Every entry point treats it the same way: `exec()`, `execLine()`, `cli.start()` and the interactive shell reject or report a `CancelledError`, and a raw `AbortError` raised while the signal is aborted is wrapped once, with the signal's `reason` as `cause`. Passing an already aborted signal to `exec()` or `execLine()` rejects with `CancelledError` before any hook, validator or action runs. An action that ignores the abort and returns normally simply resolves.

Two exported helpers classify and format a thrown value.

### `isCancellationError(err, signal)`

Returns `true` when the value represents a user-initiated cancellation:

- any `CancelledError`, whatever the state of `signal`, or
- an `Error` whose `name` is `"AbortError"` **when the supplied `signal` is aborted**.

The signal argument is required. A bare `AbortError` is **not** treated as a cancellation unless the signal is aborted — an abort raised by unrelated code should not be silently reported as "the user cancelled".

```typescript
import { isCancellationError } from "@libraz/node-cli";

cli
  .command("sync")
  .action(async (ctx) => {
    try {
      const res = await fetch("https://example.com/data", { signal: ctx.signal });
      ctx.stdout.write(await res.text());
    } catch (err) {
      if (isCancellationError(err, ctx.signal)) {
        ctx.stderr.write("Sync stopped.\n");
        return;
      }
      throw err;
    }
  });
```

### `formatErrorMessage(err)`

Returns the text the framework prints after `Error: `: the error's message, or, for a value that is not an `Error`, the string itself or its `util.inspect` rendering. The text is sanitized for a terminal: control sequences and hyperlinks are removed and open styles are closed. Newlines are kept, so the result can span several lines. It has no cancellation special case; the framework itself prints `Cancelled` for an interrupt or a `CancelledError`.

The default presenter already prints every failure, so a handler that wrote the same text to stderr would print it twice. Use `formatErrorMessage` to send the text somewhere else, such as a log file:

```typescript
import { formatErrorMessage } from "@libraz/node-cli";

import { appendFileSync } from "node:fs";

cli.on("error", (error) => {
  appendFileSync("mycli.log", `${formatErrorMessage(error)}\n`);
});
```

Cancellation is raised by Ctrl+C in the interactive shell and in direct mode, by a prompt the user dismisses (see [Prompts](prompts.md)), and by an `AbortSignal` passed to `cli.exec()` or `cli.execLine()`. Process-level SIGINT handling belongs to `cli.start()` and the interactive shell; `exec()` and `execLine()` cancel only through `options.signal`.

## Programmer misuse

A failure caused by user input is always a `CLIError` (see [Error classes](#error-classes)). A failure caused by the program calling the API wrongly is not: it is a plain `TypeError`, `RangeError` or `Error` with a `code` from `UsageErrorCode`, in the style of Node's own `ERR_*` errors.

| Situation | Error | `code` |
|---|---|---|
| A command or option definition is rejected while being built | `Error` | `ERR_INVALID_DEFINITION`, `ERR_DEFINITION_CONFLICT` |
| An argument has the wrong type | `TypeError` | `ERR_INVALID_ARG_TYPE` |
| A value is out of range or a name is unknown (style, border, level, empty `choices` or a `default` that matches none of them in `prompt.select` and `prompt.multiselect`, `min` > `max`, width, markup depth) | `RangeError` | `ERR_INVALID_ARG_VALUE` |
| The state conflicts (removed command, already started, output or input in use) | `Error` | `ERR_COMMAND_REMOVED`, `ERR_ALREADY_STARTED`, `ERR_OUTPUT_BUSY`, `ERR_INPUT_BUSY` |
| The user's own code failed during asynchronous plugin initialization | `Error` | `ERR_PLUGIN_FAILED` |

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

These are bugs to fix in the calling code, not conditions to handle at run time, so they do not extend `CLIError`.

An empty `choices` array has a different error depending on where it appears. An option declared with an empty `choices` array fails when the option is defined, with `Error` code `ERR_INVALID_DEFINITION`. `prompt.select` and `prompt.multiselect` called with an empty `choices` array throw `RangeError` with code `ERR_INVALID_ARG_VALUE`.

A failure of an asynchronous plugin is wrapped once in an `Error` with code `ERR_PLUGIN_FAILED`, the message `Plugin initialization failed: <message>` and the original value as `cause`. `error` fires once with it, and every later `use()`, `exec()`, `execLine()` and `cli.start()` rejects with the same error. A plugin that throws synchronously inside `use()` throws its own value to the caller instead, and the CLI stays usable.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Normal completion |
| `1` | The `CLIError` default, and any other value thrown from a command |
| `64` | A mistake in how the command was invoked: unknown command, missing, extra, invalid or unknown argument or option, failed validation, unparsable command line (sysexits `EX_USAGE`) |
| `66` | A prompt had no input to read (sysexits `EX_NOINPUT`) |
| `130` | An interrupted command, any cancellation, and a force-quit (Ctrl+C twice) |
| `143` | The interactive shell's SIGTERM teardown — SIGTERM is the signal a process manager sends to ask a program to stop |
| any, 1 to 255 | A `CLIError` that sets its own `exitCode` |

`130` is `128 + 2` (the interrupt signal) and `143` is `128 + 15` (the terminate signal), following the usual convention for a process ended by a signal.

Only direct mode applies these codes. In the interactive shell every code is discarded so the session survives.

## Debugging with `NODE_CLI_DEBUG`

Setting the environment variable `NODE_CLI_DEBUG=1` prints the full stack trace, followed by the stack of each `cause` in the chain as `[cause] <stack>`, instead of the `Error: <message>` form:

```
$ NODE_CLI_DEBUG=1 mycli deploy prod
Error: Deploying to prod requires --force
    at Object.action (/home/me/mycli/index.ts:24:11)
    ...
[cause] Error: ...
```

Two limits apply:

- It affects the **direct-argv path only**. The interactive shell keeps the one-line form, so a stack trace never floods a live session.
- It does not apply to a cancellation, which is always presented as `Cancelled`.

## Related pages

- [Commands](commands.md) — `validate`, `cancel`, and the command context
- [Options](options.md) — where `InvalidOptionError` and `ValidationError` come from
- [Events and plugins](events-and-plugins.md) — observing failures with `commandError` and `error`
- [Interactive shell](interactive-shell.md) — Ctrl+C, force-quit, and SIGTERM
- [Glossary](glossary.md) — exit code, signal, `AbortSignal`

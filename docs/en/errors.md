# Errors

Every failure the framework raises is an instance of `CLIError` or one of its subclasses. Each carries a machine-readable `code` and an `exitCode` — the status number the process should end with when the failure is fatal. An "exit code" is the number a program returns to whatever started it; `0` means success and any other value means failure.

## How errors surface

The two run modes present the same error differently, because only one of them owns the process.

### Direct mode

In direct mode (`cli.start()` with command-line arguments), a failure is written to the standard error stream and the process exit code is set from the error:

```
$ mycli deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
$ echo $?
1
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

All of these are exported from the package and all extend `CLIError`.

| Class | `code` | `exitCode` | Extra fields | Thrown when |
|---|---|---|---|---|
| `CLIError(message, { code, exitCode?, cause? })` | as given | `1` | `code`, `exitCode`, `cause?` | The base class. Safe to subclass |
| `CommandNotFoundError(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `1` | `input`, `available?` | Unrecognized input with no `catch` handler; an unknown child of a command group; `help <unknown>` |
| `MissingArgumentError(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `1` | `argName`, `usage?` | A required positional argument is absent. A required variadic argument with no values reports `...name` |
| `ExtraArgumentError(extras, { cause? })` | `EXTRA_ARGUMENT` | `1` | `extras`, `extra` (the first) | Positional values are left over after the command's arguments are filled |
| `MissingOptionError(optionName, { cause? })` | `MISSING_OPTION` | `1` | `optionName` | An option declared `required: true` is absent |
| `InvalidOptionError(message, { optionName?, value?, cause? })` | `INVALID_OPTION` | `1` | `optionName?`, `value?` | Type coercion failed, a `choices` constraint was violated, a value-taking option was given no value, `--no-x=v` was used, `--no-x` was applied to a non-boolean option, or a value-taking short flag appeared inside a cluster such as `-abc` |
| `UnknownOptionError(flag, { cause? })` | `UNKNOWN_OPTION` | `1` | `flag`, `optionName` (the flag without dashes) | An unrecognized flag |
| `ValidationError(message, { optionName?, cause? })` | `VALIDATION_ERROR` | `1` | `optionName?` | An **option's** custom `parse` or `validate` threw |
| `ParseError(message, { quote?, cause? })` | `PARSE_ERROR` | `1` | `quote?` | An unclosed quote, an empty or trailing pipe segment, or a `<` / `>` redirection operator |
| `PromptCancelError({ cause? })` | `PROMPT_CANCELLED` | **`130`** | — | A prompt was cancelled by Ctrl+C, Ctrl+D, ended input, or an aborted signal |

Every constructor accepts `{ cause }`, which is forwarded to `Error` and exposed as `err.cause`. `ExtraArgumentError`'s message quotes each value: `Unexpected argument: "a"` for one, `Unexpected arguments: "a", "b"` for several. `code` and `exitCode` are `readonly`.

`CLIErrorCode` is the union of the nine code strings:

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

`BuiltinCLIError` is the union of the nine built-in subclasses above.

`ValidationError` covers **option-level** validation only. A command-level `.validate()` that throws propagates its own error unchanged — it is not wrapped.

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

Any throw from an action is a failure. A plain `Error` is reported with its message and ends the process with `1`:

```typescript
cli
  .command("deploy <env>")
  .option("--force", { description: "Skip the production guard" })
  .action((ctx) => {
    const env = String(ctx.args.env);
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

Subclass `CLIError` when a failure needs its own exit code — for instance so a wrapper script can distinguish a configuration problem from a network problem. The `code` may be any string (the nine `CLIErrorCode` values autocomplete); the exit code is free. Pass `{ cause }` to keep the original error attached.

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

A cancellation is not a failure — the user asked for the work to stop. It is presented as a single word and it uses the conventional interrupt status:

```
Cancelled
```

Two exported helpers classify and format a thrown value.

### `isCancellationError(err, signal)`

Returns `true` when the value represents a user-initiated cancellation:

- any `PromptCancelError`, or
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

Returns the error's message, or the value converted to a string when it is not an `Error`. It has no cancellation special case; the framework itself prints `Cancelled` for an interrupt or a `PromptCancelError`.

```typescript
import { formatErrorMessage } from "@libraz/node-cli";

cli.on("error", (error) => {
  process.stderr.write(`${formatErrorMessage(error)}\n`);
});
```

Cancellation is raised by Ctrl+C in the interactive shell and in direct mode, by a prompt the user dismisses (see [Prompts](prompts.md)), and by an `AbortSignal` passed to `cli.exec()`.

## Programmer misuse

A failure caused by user input is always a `CLIError`. A failure caused by the program calling the API wrongly is not: it is a plain `TypeError`, `RangeError` or `Error` with a `code` from `UsageErrorCode`, in the style of Node's own `ERR_*` errors.

| Situation | Error | `code` |
|---|---|---|
| A command or option definition is rejected while being built | `Error` | `ERR_INVALID_DEFINITION`, `ERR_DEFINITION_CONFLICT` |
| An argument has the wrong type | `TypeError` | `ERR_INVALID_ARG_TYPE` |
| A value is out of range or a name is unknown (style, border, level, empty `choices`, `min` > `max`, width, markup depth) | `RangeError` | `ERR_INVALID_ARG_VALUE` |
| The state conflicts (removed command, already started, output or input in use) | `Error` | `ERR_COMMAND_REMOVED`, `ERR_ALREADY_STARTED`, `ERR_OUTPUT_BUSY`, `ERR_INPUT_BUSY` |

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

These are bugs to fix in the calling code, not conditions to handle at run time, so they do not extend `CLIError`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Normal completion |
| `1` | The `CLIError` default, and any other value thrown from a command |
| `130` | An interrupted command, any cancellation, and a force-quit (Ctrl+C twice) |
| `143` | The interactive shell's SIGTERM teardown — SIGTERM is the signal a process manager sends to ask a program to stop |
| any | A `CLIError` subclass that sets its own `exitCode` |

`130` is `128 + 2` (the interrupt signal) and `143` is `128 + 15` (the terminate signal), following the usual convention for a process ended by a signal.

Only direct mode applies these codes. In the interactive shell every code is discarded so the session survives.

## Debugging with `NODE_CLI_DEBUG`

Setting the environment variable `NODE_CLI_DEBUG=1` prints the full stack trace instead of the one-line `Error: <message>` form:

```
$ NODE_CLI_DEBUG=1 mycli deploy prod
Error: Deploying to prod requires --force
    at Object.action (/home/me/mycli/index.ts:24:11)
    ...
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

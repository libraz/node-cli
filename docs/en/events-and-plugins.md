# Events and plugins

Events let code observe a command run without modifying the command. Plugins let a separate module register commands and events against an existing CLI. Both are registered on the `CLI` instance, and both are used by the same programmatic entry point, `cli.exec()`, which is also the way a CLI is tested.

## Lifecycle events

Five events are defined by `CLIEventMap`.

| Event | Handler signature | Fires |
|---|---|---|
| `beforeExecute` | `(ctx) => void \| Promise<void>` | After option resolution and the command's `validate`, immediately before its action |
| `afterExecute` | `(ctx) => void \| Promise<void>` | Only after the action resolves successfully |
| `commandError` | `(error, ctx) => void \| Promise<void>` | A resolved command failed |
| `error` | `(error) => void \| Promise<void>` | Any failure at all, including failures before a command was resolved |
| `exit` | `() => void \| Promise<void>` | Once, when `cli.start()` ends or a force-quit or SIGTERM ends the process |

`ctx` is the `CommandContext` — the same object the action receives, with `args`, `options`, `commandPath`, the streams, and `signal`. See [Commands](commands.md).

### Firing order

![Order of events on one command run. Input is parsed, the command is resolved, options are resolved, the command's validate runs, beforeExecute fires, the action runs, and afterExecute fires on success. A failure at any step after resolution fires commandError and then error; a failure before resolution fires error alone. Separately, plugins registered with cli.use run through a single serial queue and register commands and event handlers before any command executes.](../assets/events.svg)

On a successful run of a resolved command:

1. the input is parsed and the command resolved,
2. options are resolved,
3. the command's own `validate` runs,
4. `beforeExecute` fires,
5. the action runs,
6. `afterExecute` fires.

A failure anywhere from step 1 to step 5 skips `afterExecute`.

### Registering and removing handlers

```typescript
import { createCLI, type CommandContext } from "@libraz/node-cli";

const cli = createCLI({ name: "mycli" });

cli.on("beforeExecute", (ctx) => {
  ctx.stderr.write(`> ${ctx.commandPath.join(" ")}\n`);
});

cli.on("afterExecute", () => {
  // Runs only when the action succeeded.
});
```

`cli.off(event, handler)` removes a handler **by identity**, so the reference passed to `off` must be the same function object that was passed to `on`. An inline arrow function cannot be removed.

```typescript
const trace = (ctx: CommandContext) => {
  ctx.stderr.write(`> ${ctx.commandPath.join(" ")}\n`);
};

cli.on("beforeExecute", trace);
cli.off("beforeExecute", trace);
```

### How handlers run

Handlers for one event run **sequentially, in registration order, and each is awaited** before the next starts. An `async` handler therefore delays the command; this is deliberate, so a handler can do real work (write an audit record, acquire a token) before the action begins.

The list of handlers is snapshotted when the event fires. A handler that registers or removes another handler does not change which handlers run for that same event.

### Errors inside a handler

A handler that throws never breaks the command. Its error is caught and re-emitted as an `error` event, and the remaining handlers still run.

An `error` handler that itself throws cannot be re-emitted without looping, so its failure is written to the standard error stream instead:

```
Error in error handler: <message>
```

### `commandError` versus `error`

`commandError` is the narrower of the two. It fires when a **resolved** command fails — the command path was recognized, so a context exists to hand to the handler. That covers:

- a missing required positional argument,
- an unexpected extra positional argument,
- option resolution (an unknown flag, a bad value, a missing required option),
- the command's own `validate` throwing,
- the action throwing,
- an option-syntax failure, once the command path itself has resolved.

`error` fires for **every** failure, including ones that happen before any command is resolved:

- unbalanced quoting or another parse failure,
- an unrecognized command,
- a `fallback` handler throwing,
- a `cancel` handler rejecting,
- another event handler throwing.

The two are not alternatives. When a resolved command fails, **`commandError` fires and then `error` fires** — `error` is not an "else" branch. A handler that counts failures on both events counts the same failure twice.

```typescript
const failures: Error[] = [];

cli.on("commandError", (error, ctx) => {
  ctx.stderr.write(`${ctx.commandPath.join(" ")} failed: ${error.message}\n`);
});

cli.on("error", (error) => {
  // Every failure lands here, including the one reported above.
  failures.push(error);
});
```

Neither event fires when a pipe stage is cancelled as an expected cancellation: a stage stopped early because a downstream stage finished, or a sibling stage torn down by the pipeline's primary failure. Only the primary failure is reported. See [Interactive shell](interactive-shell.md) for how pipes behave.

### The `exit` event

`exit` fires at most once per CLI, on each of these paths:

- a direct-mode command completing, throwing, or being force-quit,
- the help index being printed for an empty argument list or a non-terminal start,
- a plugin failing to initialize,
- the interactive shell ending, or receiving SIGTERM,
- a force-quit (Ctrl+C twice).

It does **not** fire on the normal `cli.exec()` path. Only a force-quit during `cli.exec()` triggers it, because that ends the process.

A signal the CLI does not handle ends the process with Node's default action, so neither `exit` handlers nor cancel handlers run. That covers SIGTERM and SIGHUP in direct mode, and SIGHUP in the interactive shell.

```typescript
import { writeFile } from "node:fs/promises";

cli.on("exit", async () => {
  await writeFile("/tmp/mycli-session.log", "session ended\n", { flag: "a" });
});
```

During a force-quit or the shell's SIGTERM teardown, `exit` handlers are given 2000 ms in total; a handler that has not finished by then does not delay termination.

## The `fallback` handler

`cli.fallback(handler)` handles input that matches no command, instead of raising `CommandNotFoundError`.

```typescript
cli.fallback((input, { stdout }) => {
  stdout.write(`Unknown command: ${input}\nType "help" to list commands.\n`);
});
```

Three properties matter:

- **There is one handler.** A later `fallback()` call replaces the previous one.
- **The context carries only the streams.** `FallbackContext` is exactly `{ stdin, stdout, stderr, signal }`, the same four members every `CommandContext` has. There are no `args` and no `shell`, because no command was resolved. `signal` is the one passed to `cli.exec()`, or a signal that never aborts when none was passed.
- **It also receives unparseable input.** Input that fails to tokenize or split into pipe stages goes to the handler rather than raising a `ParseError`.

Without a `fallback` handler, unrecognized input raises `CommandNotFoundError`. See [Errors](errors.md).

## Plugins

A plugin is a function that receives a context and registers things on it.

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>;
```

### `PluginContext`

`PluginContext` is exactly four methods:

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder;
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
}
```

`on`, `off` and `fallback` return the context, so registrations chain. `command` returns the new command's builder instead.

There is no `use` (a plugin cannot register another plugin), no access to the command registry, and no logger or configuration object. A plugin that needs those takes them as its own parameters.

### Writing a plugin

```typescript
import { createCLI, type PluginContext } from "@libraz/node-cli";

function statusPlugin(ctx: PluginContext): void {
  ctx.command("status")
    .description("Show service status")
    .action((cmdCtx) => {
      cmdCtx.stdout.write("All systems operational\n");
    });

  ctx.on("beforeExecute", (cmdCtx) => {
    cmdCtx.stderr.write(`[audit] ${cmdCtx.commandPath.join(" ")}\n`);
  });
}

const cli = createCLI({ name: "mycli" });
cli.use(statusPlugin);
```

A plugin that needs configuration is written as a factory that returns the plugin:

```typescript
interface MetricsClient {
  record(name: string): Promise<void>;
  flush(): Promise<void>;
}

async function connectMetrics(endpoint: string): Promise<MetricsClient> {
  return {
    record: async (name) => {
      await fetch(`${endpoint}/record`, { method: "POST", body: name });
    },
    flush: async () => {
      await fetch(`${endpoint}/flush`, { method: "POST" });
    },
  };
}

function metricsPlugin(endpoint: string) {
  return async (ctx: PluginContext): Promise<void> => {
    const client = await connectMetrics(endpoint);

    ctx.on("afterExecute", async (cmdCtx) => {
      await client.record(cmdCtx.commandPath.join("."));
    });

    ctx.command("metrics flush")
      .description("Flush buffered metrics")
      .action(async (cmdCtx) => {
        await client.flush();
        cmdCtx.stdout.write("flushed\n");
      });
  };
}

cli.use(metricsPlugin("https://metrics.example.com"));
```

### Ordering and async plugins

When no earlier asynchronous plugin is still pending, `use()` runs the plugin body immediately, inside the call. A synchronous plugin has finished registering by the time `use()` returns.

A plugin body that returns a promise, and every plugin registered while one is pending, goes through **one serial queue**. A queued body does not begin until the previous one's promise settles, so registration order is deterministic even when a plugin awaits input or output. Two plugins registering a command of the same name resolve the same way every run: the later `use()` wins.

Plugins are awaited at three points:

- at the start of `cli.exec()`,
- at the start of `cli.start()`,
- before **every** command run in the interactive shell.

The third point means a plugin registered in the middle of a session — by an earlier command, for instance — is fully initialized before the next command runs.

### When a plugin fails

A synchronous throw from a plugin body that `use()` ran immediately is thrown from that `use()` call, so the caller can catch it. Whatever the plugin registered before throwing stays registered, and the CLI remains usable.

An asynchronous failure is **sticky**. Once a queued plugin has thrown or rejected:

- every later `cli.use()` call re-throws that same error,
- every later `cli.exec()` call re-throws it.

At the `cli.start()` boundary the failure is fatal: the error is reported on the standard error stream, the `exit` event fires, and no command runs. A partly initialized CLI never dispatches.

## Programmatic execution

`cli.exec(input, options?)` runs a command string as if it had been typed. It also accepts an array of arguments, which is used as argv as is: no tokenizing and no pipe splitting. `""` and `[]` resolve without doing anything. Any other input — a value that is neither a string nor an array of strings — rejects with a `TypeError` whose `code` is `ERR_INVALID_ARG_TYPE`.

```typescript
await cli.exec("deploy prod --force");
```

Because the input is a string, it is split into pipe stages the same way shell input is:

```typescript
await cli.exec("produce | transform | consume");
await cli.exec(["note", "add", "a | b"]); // one argument, not a pipe
```

Inside the action, `ctx.rawArgv` is the array for array input and `null` for string input.

### `StdioOptions`

| Field | Default | Meaning |
|---|---|---|
| `stdin` | `null` | Readable stream the command reads from |
| `stdout` | `process.stdout` | Writable stream the command writes to |
| `stderr` | `process.stderr` | Writable stream for diagnostics |
| `signal` | none | An `AbortSignal` (see [Glossary](glossary.md)) that cancels the run |

Every field is optional. A `CommandContext` is itself a valid `StdioOptions`, so an action can run another command on its own streams and signal with `cli.exec(line, ctx)`.

`cli.exec()` passes no shell, so `ctx.shell` is `null` inside the action and `ctx.shell?.enterMode(...)` does nothing. It also does not fire the `exit` event on the normal path.

### Testing a CLI

`cli.exec()` with a captured `stdout` is the way a CLI is tested: register the commands, run a line, assert on the text produced.

```typescript
import { Writable } from "node:stream";
import { createCLI } from "@libraz/node-cli";

function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

const cli = createCLI({ name: "mycli" });

cli
  .command("greet <name>")
  .option("--loud", { description: "Shout the greeting" })
  .action((ctx) => {
    const message = `Hello, ${String(ctx.args.name)}!`;
    ctx.stdout.write(`${ctx.options.loud ? message.toUpperCase() : message}\n`);
  });

const out = captureStream();
await cli.exec("greet Alice --loud", { stdout: out.stream });

// out.text() === "HELLO, ALICE!\n"
```

A failing command rejects the promise returned by `cli.exec()`, so a test asserts on the rejection:

```typescript
const err = await cli.exec("greet").catch((e: unknown) => e);
// err is a MissingArgumentError with code "MISSING_ARGUMENT"
```

See [Errors](errors.md) for the error classes, and [Examples](examples.md) for complete programs.

## Related pages

- [Commands](commands.md) — defining commands and the `CommandContext`
- [Interactive shell](interactive-shell.md) — pipes, modes, and shell-only behavior
- [Errors](errors.md) — error classes, cancellation, and exit codes
- [API reference](api-reference.md) — full signatures

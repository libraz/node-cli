# Logging

`logger(options?)` creates a leveled logger: five methods that write a formatted line with an icon, an optional timestamp, and an optional prefix. It is a plain function exported from the package, so it needs no `CLI` instance and can be imported into any Node script.

![Terminal showing leveled log lines with colored icons, timestamps, and a nested child-logger prefix](../assets/logger.svg)

## A first example

```ts
import { logger } from "@libraz/node-cli";

const log = logger({ prefix: "app", timestamp: true, level: "debug" });

log.info("Server started on port %d", 3000);
log.success("Deployment complete");
log.warn("Cache miss rate is high");
log.error("Connection failed");

const db = log.child("db");
db.debug("Query executed in 12ms");
```

## Where the output goes

**Every level writes to one stream, and that stream defaults to `process.stderr`.** There is no split by severity: `info` and `success` go to stderr exactly like `warn` and `error` do.

The reason is that stdout is the channel a command's *data* travels on. A user who runs `mycli list --json > out.json` expects `out.json` to contain JSON and nothing else; diagnostics on stdout would corrupt it. Keeping all diagnostics on stderr means they stay visible on the terminal while the redirected file stays clean.

To send log output to stdout instead, say so:

```ts
import { logger } from "@libraz/node-cli";

const log = logger({ stream: process.stdout });
```

## Options

`LoggerOptions`:

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `"info"` | Minimum level that is emitted. |
| `prefix` | `string` | — | Rendered as `[prefix]` before the message. |
| `timestamp` | `boolean` | `false` | Adds the local time as `HH:MM:SS`. |
| `stream` | `Writable` | `process.stderr` | Destination for every level. |
| `bufferLimit` | `number` | `1000` | Lines queued while the stream is busy. Must be a non-negative safe integer, or `RangeError` is thrown. |

## Levels

```ts
type LogLevel = "debug" | "info" | "warn" | "error" | "silent";
```

They are ordered `debug < info < warn < error < silent`. A message is emitted when its own level is at or above the configured level, so `level: "warn"` shows warnings and errors and drops everything below. `level: "silent"` suppresses all output.

## Methods

`Logger`:

| Method | Signature |
| --- | --- |
| `debug` | `(message: string, ...args: unknown[]) => void` |
| `info` | `(message: string, ...args: unknown[]) => void` |
| `success` | `(message: string, ...args: unknown[]) => void` |
| `warn` | `(message: string, ...args: unknown[]) => void` |
| `error` | `(message: string, ...args: unknown[]) => void` |
| `setLevel` | `(level: LogLevel) => void` |
| `child` | `(prefix: string) => Logger` |
| `flush` | `() => Promise<void>` |

`success` is not a separate level. It is gated at the **`info`** level and rendered with the `✔` marker, so it disappears together with `info` when the level is raised to `warn`.

## Formatting

Every call goes through Node's `util.format`, whether or not extra arguments were supplied. Two consequences follow.

Format specifiers work:

```ts
import { logger } from "@libraz/node-cli";

const log = logger();

log.info("Listening on %s:%d", "127.0.0.1", 3000);
log.info("Config: %o", { retries: 3 });
log.info("Payload: %j", { ok: true });
```

`%s` inserts a string, `%d` a number, `%j` JSON, and `%o` an inspected object.

The same routing means a non-string first argument is inspected rather than crashing the call. The declared parameter type is `string`, so TypeScript still asks for one, but the logger is reachable from plain JavaScript where nothing enforces that — an `Error` or an object arriving there is rendered by `util.format` (message and stack for an error, an inspected view for an object) instead of throwing inside the logging call.

Message text is then sanitized: **newlines are kept**, so a multi-line stack trace renders across several lines; tabs and carriage returns become single spaces; all other control bytes are dropped. This prevents a message taken from untrusted input from moving the cursor or erasing the screen.

## Line layout

A line is assembled from four parts joined by a single space, with the optional ones omitted when unset:

`icon`, `timestamp`, `[prefix]`, `message`. The timestamp is printed bare; only the prefix is wrapped in square brackets:

```text
ℹ 09:42:15 [app] Server started on port 3000
```

The icon depends on whether color is enabled for the target stream — see [Color](color.md) for how that is decided.

| Level | With color | Without color |
| --- | --- | --- |
| `debug` | `●` dim | `[DEBUG]` |
| `info` | `ℹ` blue | `[INFO]` |
| `success` | `✔` green | `[OK]` |
| `warn` | `⚠` yellow | `[WARN]` |
| `error` | `✖` red | `[ERROR]` |

Redirecting output to a file therefore produces plain, greppable `[WARN]`-style labels with no escape sequences in them.

## Child loggers

`child(prefix)` returns a logger scoped to a subsystem. Prefixes compose with `:`.

```ts
import { logger } from "@libraz/node-cli";

const log = logger({ prefix: "app" });
const db = log.child("db"); // prefix "app:db"
const pool = db.child("pool"); // prefix "app:db:pool"
```

A child inherits `timestamp`, `stream`, and `bufferLimit` from its parent. The level is inherited **dynamically**: a later `parent.setLevel("debug")` reaches every child that never set a level of its own, while `child.setLevel(...)` overrides that one child and nothing else.

```ts
import { logger } from "@libraz/node-cli";

const log = logger({ prefix: "app" });
const db = log.child("db");

log.setLevel("debug"); // db now logs debug too
db.setLevel("error"); // db logs only errors; log is unaffected
log.setLevel("info"); // db keeps its own "error"
```

## Interaction with progress indicators

A log line written to a stream that a bar or spinner is currently drawing on does not land in the middle of the frame. The indicator steps aside, the line is written on a clean row, and the indicator redraws itself below. See [Progress](progress.md).

This cooperation only applies to output written through the logger. A raw `stream.write` bypasses it and will corrupt a drawn frame.

## Backpressure and `flush`

A stream can accept only so much at once; when it is full, further writes have to wait. That waiting state is **backpressure**. While it lasts, the logger queues lines in memory up to `bufferLimit` and, once the queue is full, discards the **oldest** line to make room for the newest. With `bufferLimit: 0` a line arriving during backpressure is dropped immediately.

If the stream emits an error, or closes before the queue drained, the buffered lines are discarded and `flush()` rejects.

`flush()` resolves once the buffered lines have reached the stream. It also awaits every child logger, so one call covers the whole tree.

```ts
import { logger } from "@libraz/node-cli";

const log = logger();

log.info("done");
await log.flush();
process.exit(0);
```

Awaiting `flush()` before exiting is what keeps the last lines from being lost when the process ends while a write is still in flight.

## Common surprises

- **The default stream is stderr, for every level.** `mycli run > out.txt` still shows the log on the terminal; `2> log.txt` is what captures it.
- **There is no stdout/stderr split by severity.** Pass `stream: process.stdout` to move everything to stdout.
- **`success` is gated at `info`.** Raising the level to `warn` hides it.
- **`success` is not a `LogLevel`.** It cannot be passed to `setLevel`.
- **A child's level tracks its parent until the child sets its own**, after which the parent no longer affects it.
- **Icons change without color.** Log files contain `[INFO]`, not `ℹ`.
- **Newlines survive, tabs do not.** Stack traces stay multi-line; tabs become spaces.
- **Lines can be dropped under backpressure.** The oldest go first; `flush()` reports failures.

## Related pages

- [Color](color.md) — how color enablement per stream is decided.
- [Progress](progress.md) — indicators that share a stream with the logger.
- [Commands](commands.md) — the streams available on a command context.
- [Errors](errors.md) — reporting failures and exit codes.

# Output Utilities

node-cli includes built-in output utilities for color, tables, progress indicators, interactive prompts, and logging — all with zero external dependencies.

## Color

### Proxy-based API

```typescript
import { color } from "@libraz/node-cli";

color.red("Error!")
color.bold.green("Success!")
color.bgYellow.black("Warning")
color.dim.italic("hint")
```

Colors are chainable via a Proxy — any combination of styles works.

### Template Literal Tag

```typescript
import { c } from "@libraz/node-cli";

console.log(c`{green OK} All tests passed`);
console.log(c`{bold.red ERROR}: ${message}`);
console.log(c`{dim [${timestamp}]} {cyan ${url}}`);
```

### Stream-Aware Coloring

The global `color` and `c` decide whether to emit ANSI codes based on
`process.stdout` and always write their result for that target. Inside a command
action that writes to a different stream — for example a pipe stage where output
goes to `ctx.stdout` — use `createColorizer(ctx.stdout)` to get a colorizer that
honors that specific stream's color support, so coloring stays correct and a
non-TTY pipe target is not corrupted with stray escape codes.

```typescript
import { createColorizer } from "@libraz/node-cli";

cli.command("emit").action((ctx) => {
  const col = createColorizer(ctx.stdout);
  ctx.stdout.write(col.green("OK\n"));
});
```

### Available Styles

| Category | Styles |
|----------|--------|
| Modifiers | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Foreground | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray` |
| Background | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

### Color Control

```typescript
import { setColorEnabled, splitAnsi, stripAnsi, stringWidth } from "@libraz/node-cli";

// Disable color globally (overrides environment detection)
setColorEnabled(false);

// Remove ANSI escape codes from a string
stripAnsi("\x1b[31mred\x1b[0m"); // "red"

// Calculate visual display width (East Asian width-aware)
stringWidth("Hello");     // 5
stringWidth("こんにちは"); // 10

// Split into escape-sequence vs. visible-text runs (same recognizer as stripAnsi)
splitAnsi("\x1b[31mred\x1b[0m");
// [{ ansi: true, text: "\x1b[31m" }, { ansi: false, text: "red" }, { ansi: true, text: "\x1b[0m" }]
```

When no explicit override is set, color is resolved from the environment in this
order. The first matching rule wins.

| Rule | Result |
|------|--------|
| `setColorEnabled(true \| false)` was called | Forced on or off |
| `NO_COLOR` is set to a non-empty value | Off |
| `FORCE_COLOR` is `0` or `false` | Off |
| `FORCE_COLOR` is any other non-empty value | On, even for `TERM=dumb` or a non-TTY stream |
| `TERM` is `dumb` | Off |
| Otherwise | On only when the target stream is a TTY |

Call `resetColorEnabled()` to drop a `setColorEnabled` override and return to
environment detection.

## Table

```typescript
import { table } from "@libraz/node-cli";
```

### Array of Objects

```typescript
const data = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(data));
```

Output (cells are padded to their column width):
```
name   role   active
Alice  Admin  true
Bob    User   false
```

### Array of Arrays

```typescript
const data = [
  ["Name", "Role"],
  ["Alice", "Admin"],
  ["Bob", "User"],
];

console.log(table(data, { header: true }));
```

Array rows are normalized to the widest row and missing cells are padded as empty strings. An empty data array returns an empty string; an array holding only a header row renders that header row alone.

### Options

```typescript
interface TableOptions {
  columns?: string[];           // Column keys (for objects) or labels
  header?: boolean;             // Show header row (default: true)
  headerLabels?: Record<string, string>;  // Custom header labels
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;           // Custom border characters
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];  // Alignment by index
  colWidths?: number[];         // Fixed column widths by index
  maxWidth?: Record<string, number>;      // Truncate columns
  padding?: number;             // Column spacing for borderless (default: 2)
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;            // Truncation character (default: "…")
  style?: TableStyle;           // Padding, colors, compact mode
}

interface TableStyle {
  "padding-left"?: number;      // Cell left padding (default: 1 for bordered)
  "padding-right"?: number;     // Cell right padding (default: 1 for bordered)
  head?: string;                // Header color (e.g. "red", "cyan.bold")
  border?: string;              // Border color (e.g. "grey", "dim")
  compact?: boolean;            // Hide row separators (default: true)
}

interface TableChars {
  top?: string;        "top-mid"?: string;     "top-left"?: string;    "top-right"?: string;
  bottom?: string;     "bottom-mid"?: string;  "bottom-left"?: string; "bottom-right"?: string;
  left?: string;       "left-mid"?: string;    right?: string;         "right-mid"?: string;
  mid?: string;        "mid-mid"?: string;     middle?: string;
}
```

### Border Styles

```typescript
// No border (default)
table(data, { border: "none" });

// Simple ASCII
table(data, { border: "simple" });
// name  | role
// ------|------
// Alice | Admin

// Rounded Unicode
table(data, { border: "rounded" });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// ╰───────┴───────╯

// Single line
table(data, { border: "single" });
// ┌───────┬───────┐
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// └───────┴───────┘

// Double line
table(data, { border: "double" });
// ╔═══════╦═══════╗
// ║ name  ║ role  ║
// ╠═══════╬═══════╣
// ║ Alice ║ Admin ║
// ╚═══════╩═══════╝

// Custom characters
table(data, {
  chars: {
    "top-left": "+", "top-right": "+", "top": "=", "top-mid": "+",
    "bottom-left": "+", "bottom-right": "+", "bottom": "=", "bottom-mid": "+",
    "left": "|", "right": "|", "middle": "|",
    "left-mid": "+", "right-mid": "+", "mid": "-", "mid-mid": "+",
  },
});
```

### Column Alignment

```typescript
// By column name
table(data, {
  align: { amount: "right", name: "left" },
});

// By index (takes precedence over align)
table(data, {
  colAligns: ["left", "right", "center"],
});
```

### Column Widths & Truncation

```typescript
table(data, {
  colWidths: [20, 15, 10],       // Fixed widths by index
  maxWidth: { description: 40 }, // Max width by column name
  truncate: "..",                 // Custom truncation character
});
```

### Style & Compact Mode

```typescript
// Compact mode (default) — no row separators
table(data, { border: "rounded", style: { compact: true } });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// │ Bob   │ User  │
// ╰───────┴───────╯

// Non-compact — row separators between every row
table(data, { border: "rounded", style: { compact: false } });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// ├───────┼───────┤
// │ Bob   │ User  │
// ╰───────┴───────╯

// Custom padding
table(data, {
  border: "single",
  style: { "padding-left": 3, "padding-right": 3 },
});
```

## Progress

```typescript
import { progress } from "@libraz/node-cli";
```

### Progress Bar

```typescript
const bar = progress.bar({
  total: 100,
  label: "Downloading",
  width: 30,
  color: "green",
});

bar.update(50);   // Set to absolute value
bar.tick();       // Increment by 1
bar.tick(10);     // Increment by 10
bar.finish();     // Complete (sets to 100%)
bar.stop();       // Stop without completing
```

**BarOptions:**

```typescript
interface BarOptions {
  total: number;                           // Total units
  label?: string;                          // Label prefix
  width?: number;                          // Bar width in chars (default: 30)
  filled?: string;                         // Fill character (default: "█")
  empty?: string;                          // Empty character (default: "░")
  color?: string;                          // Color name
  stream?: Writable;                       // Output stream (default: process.stderr)
  format?: (state: BarState) => string;    // Custom formatter
}
```

**BarState** (passed to custom format):

```typescript
interface BarState {
  current: number;   // Current progress
  total: number;     // Total target
  percent: number;   // 0-100
  elapsed: number;   // Milliseconds elapsed
  eta: number;       // Estimated milliseconds remaining
  rate: number;      // Units per second
}
```

**Custom format:**

```typescript
const bar = progress.bar({
  total: 1000,
  format: (state) =>
    `${state.current}/${state.total} (${state.percent}%) ETA: ${Math.round(state.eta / 1000)}s`,
});
```

### Spinner

```typescript
const spinner = progress.spinner({
  label: "Processing...",
  color: "cyan",
});

spinner.start();
spinner.update("Still processing...");
spinner.succeed("Done!");     // ✔ Done!
spinner.fail("Failed!");      // ✖ Failed!
spinner.warn("Caution!");     // ⚠ Caution!
spinner.stop();               // Stop without status
```

**SpinnerOptions:**

```typescript
interface SpinnerOptions {
  label?: string;          // Text next to spinner
  frames?: string[];       // Custom animation frames
  interval?: number;       // Ms between frames (default: 80)
  color?: string;          // Frame color
  stream?: Writable;       // Output stream (default: process.stderr)
}
```

### Multi-Bar

Track multiple progress bars concurrently:

```typescript
const multi = progress.multi();

const bar1 = multi.add({ total: 100, label: "File 1" });
const bar2 = multi.add({ total: 200, label: "File 2" });

bar1.update(50);
bar2.update(100);

multi.finish();  // Finish all bars
multi.stop();    // Stop all bars
```

Only one standalone `bar`, `spinner`, or `multi` renderer may own a given stream
at a time. Starting another one on the same stream before the first is stopped or
finished throws. Use `progress.multi()` when several indicators must remain
visible concurrently.

Every indicator implements `[Symbol.dispose]`, so a `using` declaration releases it
when the scope exits — including when the block exits by throwing (TypeScript 5.2
or newer):

```typescript
{
  using bar = progress.bar({ total: 100, label: "Downloading" });
  await download((n) => bar.update(n));
}  // bar.stop() runs here
```

`progress.releaseAll()` stops every indicator that is still active and restores the
cursor. Command execution calls it automatically once an action returns or throws.

### TTY Detection

Animated progress bars and spinner frames render only on TTY streams. On non-TTY streams (piped output or CI), bars remain silent; spinner `succeed()`, `fail()`, and `warn()` emit one final plain status line, while `start()`, `update()`, and `stop()` remain silent.

Labels and custom progress formats are single-line: newline, tab, and other control characters are replaced with spaces. While a slow stream is backpressured, intermediate redraws are coalesced so only the latest pending frame is retained.

## Prompt

```typescript
import { prompt } from "@libraz/node-cli";
```

### Text Input

```typescript
const name = await prompt.text("Your name:");
const email = await prompt.text("Email:", {
  default: "user@example.com",
  validate: (v) => {
    if (!(v as string).includes("@")) throw new Error("Invalid email");
  },
});
```

### Confirmation

```typescript
const ok = await prompt.confirm("Delete all files?");
// Y/n prompt, returns boolean

const ok2 = await prompt.confirm("Continue?", { default: true });
```

### Select (Single Choice)

```typescript
const env = await prompt.select("Environment:", [
  "development",
  "staging",
  "production",
]);

// With labeled choices:
const action = await prompt.select("Action:", [
  { label: "Deploy", value: "deploy", hint: "Push to production" },
  { label: "Rollback", value: "rollback", hint: "Revert last deploy" },
]);
```

### Multi-Select

```typescript
const features = await prompt.multiselect("Enable features:", [
  { label: "Logging", value: "logging" },
  { label: "Metrics", value: "metrics" },
  { label: "Tracing", value: "tracing" },
], {
  min: 1,
  max: 2,
});
```

When `min` is omitted, pressing Enter may select zero items. Set `min: 1` when at least one selection is required.

### Password

```typescript
const password = await prompt.password("Enter password:");
// Input is masked with asterisks
```

Password values preserve leading and trailing whitespace; only the exact empty string fails the default `required: true` check.

When stdin is a TTY but stdout is redirected, password input remains masked and the prompt is written to stderr. Pass `stderr` in the options to choose a different interactive stream.

### Prompt Options

All prompt methods accept `prefix`, `stdin`, `stdout`, and `validate` through their options object. Password also accepts `stderr` for its interactive prompt when stdout is redirected. Text and password prompts support `required`; confirm/select/multiselect support `default`; multiselect additionally supports `min` and `max`.

### Cancellation

All prompts throw `PromptCancelError` if the user presses Ctrl+C or Ctrl+D:

```typescript
import { PromptCancelError } from "@libraz/node-cli";

try {
  const name = await prompt.text("Name:");
} catch (err) {
  if (err instanceof PromptCancelError) {
    console.log("Cancelled");
  }
}
```

## Logger

```typescript
import { logger } from "@libraz/node-cli";
```

### Basic Usage

```typescript
const log = logger();

log.debug("Detailed info");   // Only shown at debug level
log.info("Information");       // ℹ Information
log.success("Completed");      // ✔ Completed
log.warn("Be careful");        // ⚠ Be careful
log.error("Something broke");  // ✖ Something broke
```

### Options

```typescript
const log = logger({
  level: "debug",         // "debug" | "info" | "warn" | "error" | "silent"
  prefix: "server",       // [server] prefix
  timestamp: true,        // HH:MM:SS prefix
  stream: process.stderr, // Output stream (default: stderr)
  bufferLimit: 1000,      // Maximum queued lines during backpressure
});
```

When the stream applies backpressure, the logger queues at most `bufferLimit` lines and drops the oldest queued line when full. Use `await log.flush()` to wait until logger-managed queued lines have been handed to the stream; it rejects if the stream errors or closes first. A limit of `0` drops every line logged while backpressured.

### Printf-Style Formatting

Child loggers inherit the parent's current log level dynamically until `child.setLevel(...)` is called on that child.

```typescript
log.info("Port: %d", 3000);
log.info("Host: %s", "localhost");
log.info("Config: %j", { port: 3000 });
```

### Child Loggers

```typescript
const log = logger({ prefix: "app" });
const dbLog = log.child("db");
const httpLog = log.child("http");

dbLog.info("Connected");     // ℹ [app:db] Connected
httpLog.info("GET /api");    // ℹ [app:http] GET /api
```

### Runtime Level Change

```typescript
log.setLevel("debug");   // Show all messages
log.setLevel("silent");  // Suppress all output
```

### Log Levels

| Level | Methods shown |
|-------|--------------|
| `debug` | debug, info, success, warn, error |
| `info` | info, success, warn, error |
| `warn` | warn, error |
| `error` | error |
| `silent` | (none) |

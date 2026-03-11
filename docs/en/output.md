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

### Available Styles

| Category | Styles |
|----------|--------|
| Modifiers | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Foreground | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray` |
| Background | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

### Color Control

```typescript
import { setColorEnabled, stripAnsi, stringWidth } from "@libraz/node-cli";

// Disable color globally (also respects NO_COLOR env var)
setColorEnabled(false);

// Remove ANSI escape codes from a string
stripAnsi("\x1b[31mred\x1b[0m"); // "red"

// Calculate visual display width (East Asian width-aware)
stringWidth("Hello");     // 5
stringWidth("こんにちは"); // 10
```

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

Output:
```
name     role     active
Alice    Admin    true
Bob      User     false
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
  stream?: Writable;                       // Output stream
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
  stream?: Writable;       // Output stream
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

### TTY Detection

Progress bars and spinners only render on TTY streams. On non-TTY (piped output, CI), all operations are silently no-ops.

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

### Password

```typescript
const password = await prompt.password("Enter password:");
// Input is masked with asterisks
```

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
  timestamp: true,        // [HH:MM:SS] prefix
  stream: process.stderr, // Output stream (default: stderr)
});
```

### Printf-Style Formatting

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

dbLog.info("Connected");     // [app:db] ℹ Connected
httpLog.info("GET /api");    // [app:http] ℹ GET /api
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

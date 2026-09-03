# Progress

`progress` creates the indicators that show a long-running operation is still moving: a progress bar with a known total, a spinner for work of unknown length, and a multi-bar group for several concurrent tasks. Every factory is a plain function exported from the package, so none of them needs a `CLI` instance.

![Terminal showing a download progress bar redrawn in place at 30, 50 and 100 percent, followed by a spinner frame and its resolved success line](../assets/progress.svg)

## A first example

```ts
import { progress } from "@libraz/node-cli";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const bar = progress.bar({ total: 100, label: "Downloading" });
for (let done = 0; done <= 100; done += 10) {
  bar.update(done);
  await wait(100);
}
bar.finish();

const spinner = progress.spinner({ label: "Processing..." });
spinner.start();
await wait(1000);
spinner.succeed("Done!");
```

Both indicators redraw a single line in place. Both write to **`process.stderr`** by default, which keeps `process.stdout` free for data another program might be reading.

## What the object contains

`progress` has four members: `bar`, `spinner`, `multi`, and `releaseAll`. `releaseAll` is also exported at the top level, alongside `restoreCursor`.

```ts
import { progress, releaseAll, restoreCursor } from "@libraz/node-cli";
```

`restoreCursor` is a top-level export only. It is **not** a member of `progress`.

## `progress.bar(options)`

Creates a bar for work whose total is known.

### `BarOptions`

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `total` | `number` | required | Total number of units. A non-finite or negative value becomes `0`, and a total of `0` renders as 100%. |
| `label` | `string` | `""` | Text before the bar. Omitted from the line when empty. |
| `width` | `number` | `30` | Bar width in characters. A non-finite value, or one `<= 0`, throws `RangeError`. |
| `filled` | `string` | `"█"` | Glyph for the completed portion. |
| `empty` | `string` | `"░"` | Glyph for the remaining portion. |
| `format` | `(state: BarState) => string` | — | Replaces the whole rendered line. |
| `stream` | `Writable` | `process.stderr` | Where the bar is drawn. |
| `color` | `string` | — | A style name applied to the bar glyphs. An unknown name is silently ignored. |

The default line is `` `${label}  [${bar}]  ${percent}%  ${current}/${total}` ``, with the label dropped when it is empty.

### `BarState`

Passed to `format` on every redraw.

| Field | Meaning |
| --- | --- |
| `current` | Units completed. |
| `total` | The normalized total. |
| `percent` | Rounded percentage, capped at 100. |
| `elapsed` | Milliseconds since the bar was created. |
| `eta` | Estimated milliseconds remaining. `0` once complete, `Infinity` while the rate is 0. |
| `rate` | Units per second. |

```ts
import { progress } from "@libraz/node-cli";

const bar = progress.bar({
  total: 100,
  format: (state) => `${state.percent}% — ${Math.round(state.eta / 1000)}s left`,
});
```

### `Bar`

| Method | Behavior |
| --- | --- |
| `update(current)` | Sets the absolute progress value. |
| `tick(delta = 1)` | Advances the value by `delta`. |
| `finish()` | Jumps to `total`, draws a final frame, and ends the line. |
| `stop()` | Ends the line without completing. |
| `[Symbol.dispose]()` | Identical to `stop()`. |

Non-finite values passed to `update` or `tick` are ignored, and every value is clamped to the range `[0, total]`.

## `progress.spinner(options?)`

Creates an animated indicator for work whose duration is unknown.

### `SpinnerOptions`

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `label` | `string` | `""` | Text beside the animation. |
| `frames` | `string[]` | `["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]` | Animation frames. Must be a non-empty array of strings, or `RangeError` is thrown. |
| `interval` | `number` | `80` | Milliseconds between frames. Must be positive and finite. |
| `stream` | `Writable` | `process.stderr` | Where the spinner is drawn. |
| `color` | `string` | — | A style name applied to the frame glyph. |

The default frame set is the braille dots shown above. Two other sets exist in the source but are not exported; pass them explicitly to use them:

```ts
import { progress } from "@libraz/node-cli";

const lineSpinner = progress.spinner({ label: "Working", frames: ["-", "\\", "|", "/"] });
const arrowSpinner = progress.spinner({
  label: "Working",
  frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
});
```

### `Spinner`

| Method | Behavior |
| --- | --- |
| `start()` | Begins the animation. |
| `update(label)` | Replaces the label; the next frame shows it. |
| `succeed(message?)` | Stops and writes `✔` in green followed by the message. |
| `fail(message?)` | Stops and writes `✖` in red followed by the message. |
| `warn(message?)` | Stops and writes `⚠` in yellow followed by the message. |
| `stop()` | Stops and clears the line, writing nothing. |
| `[Symbol.dispose]()` | Identical to `stop()`. |

`succeed`, `fail`, and `warn` fall back to the spinner's current label when no message is supplied. The animation timer does not keep the Node process alive on its own, so a program that finishes its work exits normally even if a spinner was left running.

## `progress.multi()`

Creates a group that draws several bars as one block. It takes **no arguments**; each bar is configured through `add`.

```ts
import { progress } from "@libraz/node-cli";

const group = progress.multi();
const download = group.add({ total: 100, label: "download" });
const extract = group.add({ total: 100, label: "extract " });

download.update(60);
extract.update(25);

group.finish();
```

| Method | Behavior |
| --- | --- |
| `add(options)` | Adds a bar and returns a `Bar` handle. |
| `finish()` | Completes every bar and closes the block. |
| `stop()` | Closes the block without completing. |
| `[Symbol.dispose]()` | Identical to `stop()`. |

The group renders to a single stream, fixed by the **first** `add()` that supplies one; `stream` on later bars is ignored, because one block of rows cannot be split across two destinations. Calling `add()` after `finish()` or `stop()` returns an inert handle whose methods all do nothing, rather than throwing — a worker that registers a bar just after the group closed does not fail the command.

## Automatic cleanup with `using`

`using` is a JavaScript declaration that runs a cleanup step when the enclosing block is left, whichever way it is left: a normal return, an early `return`, or a thrown error. A value is eligible when it has a `[Symbol.dispose]()` method, which bars, spinners, and multi-bar groups all do. It requires a runtime and TypeScript configuration with explicit resource management enabled.

```ts
import { copyFileSync } from "node:fs";
import { progress } from "@libraz/node-cli";

function copyAll(files: string[], target: string): void {
  using bar = progress.bar({ total: files.length, label: "Copying" });
  for (const file of files) {
    copyFileSync(file, `${target}/${file}`);
    bar.tick();
  }
}
```

The exact equivalent without `using`:

```ts
import { copyFileSync } from "node:fs";
import { progress } from "@libraz/node-cli";

function copyAll(files: string[], target: string): void {
  const bar = progress.bar({ total: files.length, label: "Copying" });
  try {
    for (const file of files) {
      copyFileSync(file, `${target}/${file}`);
      bar.tick();
    }
  } finally {
    bar.stop();
  }
}
```

Either form guarantees the line is closed and the cursor restored even when the copy throws.

## Behavior without a terminal

This is the most common source of confusion. When the target stream is not a **terminal** — for example when output is redirected to a file, piped into another program, or captured by a CI runner — the indicators behave differently:

- **Bars render nothing at all.** No frames, no final line, and `finish()` writes nothing either. A run whose only output was a progress bar produces an empty log.
- **Spinners draw no frames**, and `stop()` writes nothing. But `succeed`, `fail`, and `warn` **always** write their one final line, terminal or not. They are the way to leave a permanent record.
- **The cursor is only hidden and restored on a terminal.**

To keep a readable log in both settings, report milestones through [`logger`](logging.md) and let the bar handle the interactive case.

## Cleanup and cursor restoration

A bar or spinner hides the terminal cursor while it draws, and shows it again when it ends. Two functions make sure that happens even on an abnormal exit:

- `releaseAll()` stops every indicator that is still active and restores the cursor. It runs automatically after every command, and from the interactive shell's crash handlers.
- `restoreCursor()` re-shows the cursor on every stream where it is hidden. It is safe to call repeatedly.

## Other behavior

- **One standalone indicator per stream.** Starting a second bar or spinner on the same terminal stream throws `Another progress indicator is already rendering to this stream; use progress.multi() for concurrent bars`. Two indicators cannot infer each other's row layout. On a non-terminal stream nothing is drawn, so the guard does not fire.
- **Progress and log output interleave cleanly.** A [`logger`](logging.md) writing to the same stream steps around the drawn frame and the indicator redraws itself afterwards, because both cooperate through a shared arbiter. A raw `stream.write` does not, and will land in the middle of a half-drawn frame.

## Common surprises

- **The default stream is `process.stderr`, not `process.stdout`.** Redirecting stdout to a file does not silence a bar; redirecting stderr does.
- **`restoreCursor` is not on `progress`.** Import it from the package root.
- **A bar writes nothing when the stream is not a terminal**, including from `finish()`.
- **`progress.multi()` takes no arguments.** Options belong on each `add()` call.
- **`eta` is milliseconds**, not seconds, and is `Infinity` until progress has actually been made.
- **`width` of `0` throws**, while a `total` of `0` does not — it renders as an immediately complete bar.

## Related pages

- [Logging](logging.md) — leveled output that coexists with a running indicator.
- [Color](color.md) — the style names accepted by `color`.
- [Commands](commands.md) — where `releaseAll` runs automatically.
- [Errors](errors.md) — behavior on cancellation and crashes.

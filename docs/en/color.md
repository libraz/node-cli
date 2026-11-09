# Color

`color` applies terminal colors and text styles to strings, `colorTag` does the same inside a template literal (`createColorTag` binds that tag to another stream), and a group of string utilities measures, trims, and sanitizes text that already contains escape sequences. All of them are plain functions exported from the package: none of them needs a `CLI` instance, and they can be imported into any Node script.

![Terminal showing a bold green success line, a bold red error prefix, the foreground color names rendered in their own colors, and the bold, dim and underline modifiers](../assets/color.svg)

## A first example

```ts
import { color, colorTag } from "@libraz/node-cli";

console.log(color.bold.green("Success!"));
console.log(colorTag`{bold.red Error}: Something went wrong`);

console.log(
  [
    color.red("red"),
    color.green("green"),
    color.yellow("yellow"),
    color.blue("blue"),
    color.magenta("magenta"),
    color.cyan("cyan"),
    color.gray("gray"),
  ].join("  "),
);

console.log([color.bold("bold"), color.dim("dim"), color.underline("underline")].join("  "));
```

Each style function takes a string and returns a string. Nothing is printed until the result is passed to `console.log` or written to a stream.

### What a style function actually returns

A terminal renders colors when it receives an **ANSI escape sequence**: a short run of invisible control characters that tells the terminal "start drawing in green" and, later, "stop". `color.green("ok")` returns the text with those two markers wrapped around it. The markers occupy no columns on screen, but they are real characters in the string, which is why `"ok".length` and the length of the colored string differ. Use [`stringWidth`](#stringwidthtext-number) rather than `.length` whenever the number matters.

## Chaining styles

`color` is a proxy object: every style name is a property, and every property is itself a function that also carries the remaining style names as properties. Chaining reads left to right and applies all the named styles at once.

```ts
import { color } from "@libraz/node-cli";

console.log(color.bold.underline("Title"));
console.log(color.bgYellow.black("  WARNING  "));
```

Accessing a name that is not a style is a type error in TypeScript and, at run time, throws a `RangeError` with `code: "ERR_INVALID_ARG_VALUE"` whose message lists the valid names, so a typo fails loudly instead of silently returning plain text. When a name is only known at run time, check it with `isStyleName(value)`, which accepts any `unknown` value and narrows it to `StyleName`. The properties `then`, `toString`, `valueOf`, `toJSON`, `constructor`, and any symbol pass through untouched, so awaiting, stringifying, or serializing a colorizer does not throw.

## The complete style list

These are all the styles the package supports. There are no bright variants, no 256-color palette, and no hex or RGB API.

| Group | Names |
| --- | --- |
| Modifiers | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| Foreground | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `grey` |
| Background | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

`grey` is an alias of `gray`. There is no `bgBlack`.

### Style types

- `StyleName` is the union of the 23 names above.
- `Colorizer` is the type of `color` and of what `createColorizer` returns: one chainable `ColorFn` per `StyleName`. Chain keys are limited to `StyleName`, so `color.red.bol` does not compile.
- `ColorTag` is the type of `colorTag` and of what `createColorTag` returns: a tagged-template function that renders `{style content}` markup.
- `StyleSpec` is a style name or a dot-separated chain of them (`"cyan"`, `"cyan.bold"`, `"cyan.bold.underline"`), as taken by options that accept a style. The first two links are checked by the compiler; any further link is checked when the value is used.

```ts
import { color, isStyleName, type StyleName } from "@libraz/node-cli";

function paint(name: string, text: string): string {
  if (!isStyleName(name)) throw new Error(`not a style: ${name}`);
  const style: StyleName = name;
  return color[style](text);
}
```

## Nesting

Styles nest safely. Each layer re-opens itself after any escape sequence an inner layer closed, so text after a nested fragment keeps the outer style:

```ts
import { color } from "@libraz/node-cli";

console.log(color.red(`x ${color.green("y")} z`));
// "x" and "z" stay red; only "y" is green
```

## Inline markup with the `colorTag` tag

`colorTag` is a tagged template literal: it is written directly before a backtick string and transforms that string. It renders `{style content}` markup instead of nesting function calls.

```ts
import { colorTag } from "@libraz/node-cli";

const port = 3000;

console.log(colorTag`Status: {green OK}`);
console.log(colorTag`{bold.red Error}: broken`);
console.log(colorTag`Listening on {cyan http://localhost:${port}}`);
console.log(colorTag`{yellow outer {bold inner} outer}`);
```

The syntax is strict:

- an opening `{`,
- a style name, or several joined by dots,
- **exactly one space**,
- the content, up to the matching `}`.

Braces are counted, so markup can be nested.

When the style name is unknown, the space is missing, or a brace is unbalanced, the `{` is emitted **literally** and the rest of the text is left alone. Unlike `color.foo`, `colorTag` never throws on bad markup. The one exception is depth: markup nested more than 64 levels deep throws a `RangeError` with `code: "ERR_INVALID_ARG_VALUE"`.

Interpolated values are converted to strings and substituted **after** the markup has been rendered. A `{` inside an interpolated value is therefore never parsed as markup, so untrusted data cannot inject styling.

## When color is enabled

Enablement is decided **at the moment a style function is called**, not when the module is imported. `color` and `colorTag` evaluate it against `process.stdout`. `createColorizer(stream)` returns the same chainable object bound to a different stream, and `createColorTag(stream)` does the same for the tag (`colorTag` is that tag bound to `process.stdout`). Both take any `Writable`:

```ts
import { createColorizer, createColorTag } from "@libraz/node-cli";

const errColor = createColorizer(process.stderr);
console.error(errColor.red("failed"));

const e = createColorTag(process.stderr);
console.error(e`{bold.red Error}: broken`);
```

`isColorEnabled(stream?)` answers the question directly, defaulting to `process.stdout`. It resolves in this order, stopping at the first rule that applies:

1. An explicit `setColorEnabled(true)` / `setColorEnabled(false)` override. This wins over everything, including `NO_COLOR`.
2. `NO_COLOR` set to a non-empty value: color off.
3. `FORCE_COLOR` set to a non-empty value: `"0"` or `"false"` turns color off, any other value turns it on. This beats `TERM=dumb` and beats a stream that is not a terminal.
4. `TERM` equal to `"dumb"`: color off.
5. Otherwise, whether the stream is a **terminal** — an interactive console, as opposed to a file or a pipe into another program.

```ts
import { isColorEnabled, setColorEnabled } from "@libraz/node-cli";

setColorEnabled(false); // force plain text, e.g. inside a test
isColorEnabled(); // false
setColorEnabled("auto"); // drop the override, return to automatic detection
```

When color is disabled, by `NO_COLOR`, `FORCE_COLOR=0` or `setColorEnabled(false)`, every style is dropped, modifiers such as `bold` and `underline` included. The functions return the text unchanged and inline markup is removed.

`setColorEnabled` sets a single module-wide flag. It is not per stream: once set, every colorizer follows it until `setColorEnabled("auto")` clears it.

## String utilities

These functions exist because a string that contains escape sequences cannot be measured or cut with the ordinary string methods. `"\x1b[31mred\x1b[39m".length` is 14, `"日本".length` is 2 but occupies four terminal columns, and slicing either one can cut an escape sequence or a character in half.

### `stringWidth(text): number`

Returns how many terminal columns the text occupies. Escape sequences are stripped first, then the text is split into **graphemes** — the units a reader perceives as single characters, which may be built from several code points, such as an emoji with a skin-tone modifier.

- Combining marks (Unicode categories Mn and Me), format characters (Cf, which includes zero-width joiners and bidirectional marks) and control characters count 0.
- Characters whose East Asian Width is Wide or Fullwidth, and emoji-presentation characters, count 2.
- A grapheme carrying U+FE0F (emoji presentation) or U+20E3 (keycap) counts 2.

Grapheme segmentation uses `Intl.Segmenter`, so a joined emoji sequence such as a family emoji is one 2-column cell rather than the sum of its parts. This is the measurement [tables](table.md) use, and it is why columns line up when cells contain Japanese text.

```ts
import { stringWidth } from "@libraz/node-cli";

stringWidth("abc"); // 3
stringWidth("日本語"); // 6
stringWidth("\x1b[31mred\x1b[39m"); // 3
```

### `stripAnsi(text): string`

Removes every ANSI escape sequence: CSI sequences (colors, cursor movement, screen erasing), OSC sequences (window titles, hyperlinks), DCS, SOS, PM and APC control strings, and every other escape. A sequence the text cuts off is removed through the end of the text, as a terminal would consume it. Use it before writing terminal output to a log file.

### `truncateAnsi(text, width, ellipsis = "…"): string`

Shortens text to at most `width` display columns, appending `ellipsis`. It never splits a grapheme in half, it fits the ellipsis to the available width as well, it keeps the escape sequences that were inside the retained part, and it appends whatever escapes are needed to close any style or hyperlink the cut left open. Each style is closed with the reset for that attribute alone, so text that follows keeps any style an outer `color.*` call applied. `width` must be a positive integer, or `Infinity` for no limit; `0`, a negative number, `NaN`, `-Infinity` or a fractional width throws a `RangeError` with `code: "ERR_INVALID_ARG_VALUE"`, and a non-number throws a `TypeError` with `code: "ERR_INVALID_ARG_TYPE"`.

```ts
import { truncateAnsi } from "@libraz/node-cli";

truncateAnsi("a very long line", 8); // "a very …"
```

### `splitAnsi(text): readonly AnsiSegment[]`

Splits the text into ordered runs, each `{ ansi: boolean; text: string }`. Segments with `ansi: true` are escape sequences; the rest is visible text. Concatenating every `.text` reproduces the input exactly, so this is the building block for transforming visible text while leaving escapes intact.

### `splitGraphemes(text): readonly string[]`

Splits text into grapheme clusters. The input must not contain escape sequences: an escape is split like any other text, so its characters would count as graphemes. Split with `splitAnsi` first and split only the segments whose `ansi` is `false`:

```ts
import { splitAnsi, splitGraphemes } from "@libraz/node-cli";

const input = "\x1b[31m日本語\x1b[39m";
const units = splitAnsi(input).flatMap((segment) =>
  segment.ansi ? [segment.text] : splitGraphemes(segment.text),
);
```

### `sanitizeTerminalText(text, options?): string`

Makes an untrusted string safe to print. Options are `SanitizeTerminalTextOptions`: `{ singleLine = true, allowHyperlinks = true }`.

- Color and style sequences (SGR: `ESC [`, parameters made of digits, `;` and `:`, then `m`) are kept.
- Terminated OSC 8 hyperlinks, with or without params such as `id=`, are kept unless `allowHyperlinks: false`, which drops the opener and the closer alike.
- **Every other escape sequence is dropped**: cursor movement, screen erasing, window-title changes, scroll-region changes.
- In single-line mode newlines become spaces; with `singleLine: false` newlines survive.
- Tabs, vertical tabs, form feeds, and carriage returns each become one space.
- All other control bytes are dropped.
- A style or hyperlink the text leaves open is closed at the end of the returned string, each style with the reset for that attribute alone, so what follows is not styled by it.

This matters because a terminal executes whatever escape sequences reach it. A string taken from a file name, an HTTP response, or a database row can otherwise erase the screen, move the cursor over previously printed output, or rewrite the window title. Passing it through `sanitizeTerminalText` first removes that ability while keeping the colors intact. Table cells and progress labels already go through it.

```ts
import { sanitizeTerminalText } from "@libraz/node-cli";

const fromDatabase = "release \x1b[2J\x1b[Hv2";
console.log(sanitizeTerminalText(fromDatabase)); // "release v2" — the screen is not cleared
```

### `isTTY(value: unknown): boolean`

Reports whether a value is a terminal stream rather than a file or a pipe. Any value is accepted; anything that is not an object with `isTTY === true` gives `false`. The predicates `isStyleName(value)` and `isLogLevel(value)` (see [Logging](logging.md)) take the same kind of argument: any value, answered with a type guard.

## Common surprises

- **Enablement is evaluated per call.** Setting `FORCE_COLOR` after the module was imported still takes effect, and `setColorEnabled` applies to calls made afterwards.
- **Disabling color removes modifiers too.** `NO_COLOR` and `setColorEnabled(false)` drop `bold` and `underline` along with the colors.
- **`setColorEnabled` is global, not per stream.** A colorizer built with `createColorizer` still obeys it; `setColorEnabled("auto")` returns to detection.
- **`color.foo` throws; `colorTag` does not.** An unknown style name is a `RangeError` on the proxy (and a type error at compile time) and a literal `{` in inline markup.
- **A missing space breaks inline markup silently.** `` colorTag`{green OK}` `` colors `OK`; `` colorTag`{greenOK}` `` prints `{greenOK}`.
- **`.length` is not width.** Escape sequences add length, and wide characters add width; use `stringWidth`.
- **There is no `bgBlack` and no bright or RGB colors.** The list above is complete.

## Related pages

- [Table](table.md) — uses the same width measurement to align columns.
- [Logging](logging.md) — colorizes its icons per stream.
- [Progress](progress.md) — accepts a style name for bars and spinners.
- [Glossary](glossary.md) — terminal, escape sequence, grapheme.

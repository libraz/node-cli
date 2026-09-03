# Table

`table(data, options?)` turns an array of rows into an aligned, optionally bordered block of text. It is a plain function exported from the package: no `CLI` instance is needed, and it can be imported into any Node script. It returns a string and prints nothing on its own.

![Terminal showing a rounded-border table with a bold header row of name, role and active columns over two data rows](../assets/table.svg)

## A first example

```ts
import { table } from "@libraz/node-cli";

const rows = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(rows, { border: "rounded" }));
```

The return value carries **no trailing newline**, and an input that produces nothing to render returns `""`. Pass the result to `console.log`, or inside a command to the context's output stream (see [Commands](commands.md)):

```ts
import { createCLI, table } from "@libraz/node-cli";

const cli = createCLI({ name: "mycli" });

cli.command("users").action((ctx) => {
  const rows = [{ name: "Alice", role: "Admin" }];
  ctx.stdout.write(`${table(rows, { border: "rounded" })}\n`);
});
```

## Input shapes

`table` accepts two shapes.

**An array of objects.** Each object is a row and each property is a column.

```ts
import { table } from "@libraz/node-cli";

console.log(
  table([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]),
);
```

Columns default to the **union of all rows' keys**, in the order they are first seen, so a key that appears only on a later row is still rendered.

**An array of arrays.** Each inner array is a row.

```ts
import { table } from "@libraz/node-cli";

console.log(
  table([
    ["name", "role"],
    ["Alice", "Admin"],
    ["Bob", "User"],
  ]),
);
```

By default row 0 is consumed as the header row. Supplying `columns` changes that: the supplied labels become the header and **every** array row is treated as data.

The column count is the longest row; shorter rows are padded with empty cells. `null` and `undefined` cells render as `""`. Every cell value is converted with `String()` and then passed through `sanitizeTerminalText` (see [Color](color.md)), which keeps color codes but strips cursor movement, screen erasing, and other escape sequences that would otherwise break the frame.

### Column keys versus column labels

Several options are keyed by the column **key**, not by the header text shown on screen. The key is:

- for an array of objects: the object property name;
- for an array of arrays with a header: the header cell's text;
- for an array of arrays with no header: the index as a string — `"0"`, `"1"`, `"2"`, and so on.

```ts
import { table } from "@libraz/node-cli";

// headerless array data: align the second column right
console.log(
  table(
    [
      ["Alice", 42],
      ["Bob", 7],
    ],
    { header: false, align: { "1": "right" } },
  ),
);
```

## `TableOptions`

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `columns` | `string[]` | derived from the data | For object data, the column **keys** to render. For array data, the header labels — and supplying it means row 0 is **not** consumed as a header. |
| `header` | `boolean` | `true` | `false` suppresses the header row. |
| `headerLabels` | `Record<string, string>` | — | Replacement display text, keyed by column **key**. |
| `border` | `"none" \| "simple" \| "rounded" \| "single" \| "double" \| "custom"` | `"none"`, or `"custom"` when `chars` is supplied | Border preset. |
| `chars` | `TableChars` | — | Custom border glyphs, merged over the `single` preset. |
| `align` | `Record<string, "left" \| "right" \| "center">` | `"left"` | Alignment keyed by column **key**. |
| `colAligns` | `("left" \| "right" \| "center")[]` | — | Alignment by column index. **Takes precedence over `align`.** |
| `colWidths` | `number[]` | — | Fixed **total** width per column by index, padding included. A value of `0` or less means "size this column automatically". |
| `maxWidth` | `Record<string, number>` | — | Upper bound on content width, keyed by column key. A value of `0` or less means **no limit**. |
| `padding` | `number` | `2` | Spaces between columns. Applies to `border: "none"` only. |
| `headerStyle` | `"bold" \| "dim" \| "underline" \| "none"` | `"bold"` | Text style applied to header cells. |
| `truncate` | `string` | `"…"` | Marker appended to a cell that had to be cut. |
| `style` | `TableStyle` | — | See below. |

## `TableStyle`

| Field | Type | Default | Behavior |
| --- | --- | --- | --- |
| `padding-left` | `number` | `1` for `rounded` / `single` / `double` / `custom`, `0` for `none` / `simple` | Spaces inside each cell, on the left. |
| `padding-right` | `number` | same as above | Spaces inside each cell, on the right. |
| `head` | `string` | — | A dot-chained style name applied to header cells, for example `"cyan"` or `"cyan.bold"`. |
| `border` | `string` | — | The same, applied to the border glyphs. |
| `compact` | `boolean` | `true` | `false` inserts a separator line between every pair of data rows. |

An unknown name in `head` or `border` degrades to plain, unstyled text rather than throwing. The available style names are listed in [Color](color.md).

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

console.log(
  table(rows, {
    border: "rounded",
    style: { head: "cyan.bold", border: "dim", "padding-left": 2, "padding-right": 2 },
  }),
);
```

## Borders

| Preset | Corners | Notes |
| --- | --- | --- |
| `"none"` | — | No frame at all; columns are separated by `padding` spaces. The default. |
| `"simple"` | — | No outer frame; `-` separator lines and ` \| ` between columns. |
| `"rounded"` | `╭ ╮ ╰ ╯` | Full frame with rounded corners. |
| `"single"` | `┌ ┐ └ ┘` | Full frame with square corners. |
| `"double"` | `╔ ╗ ╚ ╝` | Full frame drawn with double lines. |
| `"custom"` | from `chars` | Starts from the `single` preset and applies `chars` over it. |

`chars` accepts these keys, each a string: `top`, `top-mid`, `top-left`, `top-right`, `bottom`, `bottom-mid`, `bottom-left`, `bottom-right`, `left`, `left-mid`, `right`, `right-mid`, `mid`, `mid-mid`, `middle`. Supplying `chars` without `border` implies `border: "custom"`.

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

console.log(
  table(rows, {
    chars: { "top-left": "+", "top-right": "+", "bottom-left": "+", "bottom-right": "+" },
  }),
);
```

## Widths and truncation

Column width is derived from the widest cell, measured in **display columns** rather than JavaScript string length, so Japanese, emoji, and other wide text align correctly. Colors add no width. The measurement is `stringWidth`, documented in [Color](color.md).

Two options constrain the result, and they mean different things:

- `maxWidth[key]` caps the **content** width of one column. A cell wider than the cap is truncated with the `truncate` marker.
- `colWidths[index]` fixes the **total** width of one column, padding included. The content width becomes `colWidths[i] - padding-left - padding-right`, with a floor of 1.

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin", note: "promoted last quarter" }];

console.log(
  table(rows, {
    border: "single",
    maxWidth: { name: 12 },
    colWidths: [0, 20, 0], // auto, fixed 20, auto
  }),
);
```

Header labels are truncated to the same width as the data cells, so a narrow column cannot leave an over-wide header sticking out of the frame.

## Common surprises

- **`border` defaults to `"none"`, not to a boxed style.** A table with no `border` option is a plain aligned block. Pass `border: "rounded"` (or another preset) to get a frame.
- **The table never wraps.** A cell too wide for its column is truncated with the marker, never folded onto a second line. Embedded newlines were already collapsed to spaces during sanitizing, so a multi-line cell is not possible.
- **The total width is never clamped to the terminal width.** A wide table will wrap in the terminal itself unless `maxWidth` or `colWidths` keeps it narrow.
- **`colWidths[i] <= 0` means auto, but `maxWidth[key] <= 0` means no limit.** Neither collapses the column to zero.
- **`colAligns` beats `align`.** When both name the same column, the index-based entry wins.
- **`align`, `maxWidth`, and `headerLabels` are keyed by column key, not by header label.** For a headerless array table the keys are `"0"`, `"1"`, and so on.
- **Nothing is printed.** `table` returns a string with no trailing newline.

## Related pages

- [Color](color.md) — width measurement, style names, and text sanitizing.
- [Commands](commands.md) — writing a table to `ctx.stdout`.
- [Examples](examples.md) — complete programs that render tables.

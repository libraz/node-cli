import type { Writable } from "node:stream";
import { describeReceived, usageError } from "../errors.js";
import { guardCall, MAX_RENDER_WIDTH, ownValue } from "../guard.js";
import {
  type ColorFn,
  type Colorizer,
  closeAnsiState,
  createColorizer,
  isStyleName,
  renderSafe,
  type StyleSpec,
  sanitizeTerminalText,
  stringWidth,
  truncateAnsi,
} from "./color.js";

/**
 * Custom border characters for table rendering.
 * Each property controls one piece of the box-drawing frame.
 */
export interface TableChars {
  /** Horizontal fill of the top edge. */
  top?: string | undefined;
  /** Junction on the top edge between two columns. */
  topMid?: string | undefined;
  /** Top-left corner. */
  topLeft?: string | undefined;
  /** Top-right corner. */
  topRight?: string | undefined;
  /** Horizontal fill of the bottom edge. */
  bottom?: string | undefined;
  /** Junction on the bottom edge between two columns. */
  bottomMid?: string | undefined;
  /** Bottom-left corner. */
  bottomLeft?: string | undefined;
  /** Bottom-right corner. */
  bottomRight?: string | undefined;
  /** Left edge of every row. */
  left?: string | undefined;
  /** Left end of a separator line between rows. */
  leftMid?: string | undefined;
  /** Right edge of every row. */
  right?: string | undefined;
  /** Right end of a separator line between rows. */
  rightMid?: string | undefined;
  /** Horizontal fill of a separator line between rows. */
  horizontal?: string | undefined;
  /** Crossing of a separator line and a column divider. */
  cross?: string | undefined;
  /** Divider between two columns within a row. */
  vertical?: string | undefined;
}

/** Column settings shared by object rows and array rows. */
interface ColumnSettings {
  /** Header text. Defaults to the column's `key`, or an empty string when there is none. */
  label?: string | undefined;
  /** Text alignment of the header and the cells. Defaults to `"left"`. */
  align?: "left" | "right" | "center" | undefined;
  /**
   * Fixed width of the column content, padding excluded, as a positive integer.
   * Padding is added around it. When set, it wins over `maxWidth`.
   */
  width?: number | undefined;
  /**
   * Upper bound on the content width, padding excluded: a positive integer or
   * `Infinity`. Defaults to no limit.
   */
  maxWidth?: number | undefined;
}

/** Names a column of rows of type `T`: any string for array rows, a property name for objects. */
type ColumnName<T> = [T] extends [never]
  ? string
  : [T] extends [readonly unknown[]]
    ? string
    : keyof T & string;

/**
 * Settings for one column, passed in {@link TableOptions.columns}.
 *
 * For object rows `key` names the property to read. Array rows are matched by
 * position and have no key.
 *
 * @typeParam T - The row type; chosen by the `data` argument of {@link table}.
 */
export type ColumnSpec<T extends object = Record<string, unknown>> = ColumnSettings &
  ([T] extends [readonly unknown[]] ? { key?: undefined } : { key: ColumnName<T> });

/**
 * Options for configuring table rendering.
 *
 * @typeParam T - The row type; chosen by the `data` argument of {@link table}.
 */
export interface TableOptions<T extends object = Record<string, unknown>> {
  /**
   * Columns to render, in order. For object rows these select the properties; for
   * array rows they are matched by position and supplying them means row 0 is
   * data rather than the header. Defaults to every property of the objects, or
   * every position of the arrays.
   */
  columns?: readonly (ColumnName<T> | ColumnSpec<T>)[] | undefined;
  /** Whether to display a header row. Defaults to true. */
  header?: boolean | undefined;
  /**
   * Border style preset. Use "custom" with `chars` for full control. Defaults to
   * `"none"`, or `"custom"` when `chars` is given. `chars` and `rowSeparators`
   * are ignored with `"none"`; `gap` applies only with `"none"`.
   */
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom" | undefined;
  /**
   * Custom border characters. Implicitly sets border to "custom" if provided
   * without a border option. Every glyph must be one cell wide; the edge fills
   * `top`, `bottom` and `horizontal` may also be `""` to omit that line. With
   * `border: "simple"`, `vertical` and `cross` may be any string.
   */
  chars?: TableChars | undefined;
  /** Style of the border glyphs, for example `"dim"` or `"cyan.bold"`. */
  borderStyle?: StyleSpec | undefined;
  /** Style of the header text, or `"none"` for plain text. Defaults to `"bold"`. */
  headerStyle?: StyleSpec | "none" | undefined;
  /**
   * Spaces inside each cell on the left. Defaults to 1 with a frame and 0 with
   * `border: "none"` or `"simple"`.
   */
  paddingLeft?: number | undefined;
  /**
   * Spaces inside each cell on the right. Defaults to 1 with a frame and 0 with
   * `border: "none"` or `"simple"`.
   */
  paddingRight?: number | undefined;
  /** Spaces between columns of a borderless table (`border: "none"`). Defaults to 2. */
  gap?: number | undefined;
  /** Draw a separator line between data rows. Defaults to false. */
  rowSeparators?: boolean | undefined;
  /** Marker appended to a truncated cell. Defaults to "…". */
  ellipsis?: string | undefined;
  /**
   * Decides colour for the returned string only: a TTY gets colour. It is not a
   * write target, because `table()` returns the text and never writes it. Pass the
   * stream you will print to. Defaults to `process.stdout`.
   */
  stream?: Writable | undefined;
}

// ── Border Presets ──

const CHARS_ROUNDED: Required<TableChars> = {
  top: "─",
  topMid: "┬",
  topLeft: "╭",
  topRight: "╮",
  bottom: "─",
  bottomMid: "┴",
  bottomLeft: "╰",
  bottomRight: "╯",
  left: "│",
  leftMid: "├",
  right: "│",
  rightMid: "┤",
  horizontal: "─",
  cross: "┼",
  vertical: "│",
};

const CHARS_SINGLE: Required<TableChars> = {
  top: "─",
  topMid: "┬",
  topLeft: "┌",
  topRight: "┐",
  bottom: "─",
  bottomMid: "┴",
  bottomLeft: "└",
  bottomRight: "┘",
  left: "│",
  leftMid: "├",
  right: "│",
  rightMid: "┤",
  horizontal: "─",
  cross: "┼",
  vertical: "│",
};

const CHARS_DOUBLE: Required<TableChars> = {
  top: "═",
  topMid: "╦",
  topLeft: "╔",
  topRight: "╗",
  bottom: "═",
  bottomMid: "╩",
  bottomLeft: "╚",
  bottomRight: "╝",
  left: "║",
  leftMid: "╠",
  right: "║",
  rightMid: "╣",
  horizontal: "═",
  cross: "╬",
  vertical: "║",
};

const CHARS_SIMPLE: Required<TableChars> = {
  top: "",
  topMid: "",
  topLeft: "",
  topRight: "",
  bottom: "",
  bottomMid: "",
  bottomLeft: "",
  bottomRight: "",
  left: "",
  leftMid: "",
  right: "",
  rightMid: "",
  horizontal: "-",
  cross: "-|-",
  vertical: " | ",
  // simple has special rendering handled separately
};

const CHARS_NONE: Required<TableChars> = {
  top: "",
  topMid: "",
  topLeft: "",
  topRight: "",
  bottom: "",
  bottomMid: "",
  bottomLeft: "",
  bottomRight: "",
  left: "",
  leftMid: "",
  right: "",
  rightMid: "",
  horizontal: "",
  cross: "",
  vertical: "",
};

const BORDER_NAMES: ReadonlySet<string> = new Set([
  "none",
  "simple",
  "rounded",
  "single",
  "double",
  "custom",
]);

function resolveChars(options: TableOptions<object>): Required<TableChars> {
  const border = options.chars ? (options.border ?? "custom") : (options.border ?? "none");
  let base: Required<TableChars>;
  switch (border) {
    case "rounded":
      base = CHARS_ROUNDED;
      break;
    case "single":
      base = CHARS_SINGLE;
      break;
    case "double":
      base = CHARS_DOUBLE;
      break;
    case "simple":
      base = CHARS_SIMPLE;
      break;
    case "custom":
      base = CHARS_SINGLE; // start with single as base for custom
      break;
    default:
      base = CHARS_NONE;
      break;
  }
  if (options.chars) {
    // Border pieces are caller-supplied and written on every rendered row, so a
    // stray escape sequence in one of them would restyle the whole frame.
    const overrides = Object.fromEntries(
      Object.entries(options.chars).map(([key, value]) => [
        key,
        typeof value === "string" ? renderSafe(value) : value,
      ]),
    ) as Partial<TableChars>;
    return { ...base, ...overrides };
  }
  return base;
}

type TableLayout = {
  border: NonNullable<TableOptions<object>["border"]>;
  chars: Required<TableChars>;
  padLeft: number;
  padRight: number;
  gap: number;
};

/** Resolves border characters and every padding value shared by sizing and rendering. */
function resolveLayout(options: TableOptions<object>): TableLayout {
  const border = options.chars ? (options.border ?? "custom") : (options.border ?? "none");
  const isBordered = border !== "none" && border !== "simple";
  return {
    border,
    chars: resolveChars(options),
    padLeft: Math.min(options.paddingLeft ?? (isBordered ? 1 : 0), MAX_RENDER_WIDTH),
    padRight: Math.min(options.paddingRight ?? (isBordered ? 1 : 0), MAX_RENDER_WIDTH),
    gap: Math.min(options.gap ?? 2, MAX_RENDER_WIDTH),
  };
}

// ── Validation ──

const ALIGNS: readonly string[] = ["left", "right", "center"];
const EDGE_FILLS: ReadonlySet<string> = new Set(["top", "bottom", "horizontal"]);

/** A column after validation: bare strings are expanded to `{ key }`. */
type ResolvedColumn = ColumnSettings & { key?: string | undefined };

function typeError(subject: string, expected: string, value: unknown): Error {
  return usageError(
    "type",
    "ERR_INVALID_ARG_TYPE",
    `The "${subject}" option of table() must be ${expected}. Received ${describeReceived(value)}`,
  );
}

function valueError(subject: string, expected: string, received: string): Error {
  return usageError(
    "range",
    "ERR_INVALID_ARG_VALUE",
    `The "${subject}" option of table() must be ${expected}. Received ${received}`,
  );
}

/** Checks an optional boolean option. */
function checkBoolean(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") throw typeError(name, "a boolean", value);
}

/**
 * Checks a numeric option: a number is required, and it must be an integer of at
 * least `min`. `Infinity` passes only when `allowInfinity` is set.
 */
function checkInteger(
  name: string,
  value: unknown,
  min: number,
  allowInfinity = false,
  safe = false,
): void {
  if (value === undefined) return;
  if (typeof value !== "number") throw typeError(name, "a number", value);
  if (allowInfinity && value === Number.POSITIVE_INFINITY) return;
  const valid = safe ? Number.isSafeInteger(value) : Number.isInteger(value);
  if (!valid || value < min) {
    const shape = safe ? "a safe integer" : "an integer";
    throw valueError(
      name,
      `${shape} of at least ${min}${allowInfinity ? " or Infinity" : ""}`,
      String(value),
    );
  }
}

/** Checks a style name or dot-separated chain; every segment must be a built-in style. */
function checkStyle(name: string, value: unknown, allowNone = false): void {
  if (value === undefined) return;
  if (typeof value !== "string") throw typeError(name, "a string", value);
  if (allowNone && value === "none") return;
  for (const segment of value.split(".")) {
    if (!isStyleName(segment)) {
      throw valueError(name, `a chain of built-in style names`, `"${value}"`);
    }
  }
}

/**
 * Checks the custom border glyphs: one cell wide, with `""` allowed for the edge
 * fills. The column separators of a `"simple"` table (`vertical`, `cross`) are
 * joined between cells rather than framing them, so any string is accepted there.
 */
function checkChars(chars: unknown, border: unknown): void {
  if (chars === undefined) return;
  if (typeof chars !== "object" || chars === null || Array.isArray(chars)) {
    throw typeError("chars", "an object", chars);
  }
  for (const name of Object.keys(CHARS_NONE)) {
    const value = ownValue(chars, name);
    if (value === undefined) continue;
    const subject = `chars.${name}`;
    if (typeof value !== "string") throw typeError(subject, "a string", value);
    const fill = EDGE_FILLS.has(name);
    if (fill && value === "") continue;
    if (border === "simple" && (name === "vertical" || name === "cross")) continue;
    if (stringWidth(renderSafe(value)) !== 1) {
      throw valueError(
        subject,
        `a string one cell wide${fill ? " or an empty string" : ""}`,
        JSON.stringify(value),
      );
    }
  }
}

/** Validates `columns` and converts every entry to a {@link ResolvedColumn}. */
function resolveColumns(columns: unknown): ResolvedColumn[] | undefined {
  if (columns === undefined) return undefined;
  if (!Array.isArray(columns)) throw typeError("columns", "an array", columns);
  return columns.map((entry: unknown, index): ResolvedColumn => {
    const subject = `columns[${index}]`;
    if (typeof entry === "string") return { key: entry };
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw typeError(subject, "a string or a ColumnSpec", entry);
    }
    const spec = entry as ResolvedColumn;
    if (spec.key !== undefined && typeof spec.key !== "string") {
      throw typeError(`${subject}.key`, "a string", spec.key);
    }
    if (spec.label !== undefined && typeof spec.label !== "string") {
      throw typeError(`${subject}.label`, "a string", spec.label);
    }
    if (spec.align !== undefined) {
      if (typeof spec.align !== "string")
        throw typeError(`${subject}.align`, "a string", spec.align);
      if (!ALIGNS.includes(spec.align)) {
        throw valueError(
          `${subject}.align`,
          `one of ${ALIGNS.map((a) => `"${a}"`).join(", ")}`,
          `"${spec.align}"`,
        );
      }
    }
    checkInteger(`${subject}.width`, spec.width, 1);
    checkInteger(`${subject}.maxWidth`, spec.maxWidth, 1, true);
    return spec;
  });
}

/** Validates every option that has a closed or numeric domain, before any rendering. */
function validateOptions(options: TableOptions<object>): void {
  if (options.border !== undefined) {
    if (typeof options.border !== "string") throw typeError("border", "a string", options.border);
    if (!BORDER_NAMES.has(options.border)) {
      throw valueError(
        "border",
        `one of ${[...BORDER_NAMES].map((b) => `"${b}"`).join(", ")}`,
        `"${options.border}"`,
      );
    }
  }
  checkStyle("headerStyle", options.headerStyle, true);
  checkStyle("borderStyle", options.borderStyle);
  checkInteger("paddingLeft", options.paddingLeft, 0, false, true);
  checkInteger("paddingRight", options.paddingRight, 0, false, true);
  checkInteger("gap", options.gap, 0, false, true);
  checkBoolean("header", options.header);
  checkBoolean("rowSeparators", options.rowSeparators);
  if (options.ellipsis !== undefined && typeof options.ellipsis !== "string") {
    throw typeError("ellipsis", "a string", options.ellipsis);
  }
  checkChars(options.chars, options.border);
}

/**
 * Renders tabular data as a formatted string.
 *
 * Accepts either an array of arrays or an array of objects (plain objects,
 * interface-typed values and class instances alike). Supports configurable
 * borders, per-column alignment and widths, header styling, and custom border
 * characters. The result is returned, never written: `options.stream` only
 * decides whether colour escape codes are included.
 *
 * @typeParam T - The row type: an array for positional rows, an object for keyed rows.
 * @param data - The data to render, either as rows of arrays or rows of objects.
 * @param options - Table rendering options.
 * @returns The formatted table string.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a value of the wrong type, including a `columns` entry that is not a string or a `ColumnSpec`, or an object-row `ColumnSpec` without a string `key`.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an unknown border, align or style name, a width, maxWidth, gap or padding outside its range, or a `chars` glyph that is not one cell wide.
 *
 * @example
 * ```ts
 * table(
 *   [
 *     { name: "Ann", age: 31 },
 *     { name: "Bob", age: 4 },
 *   ],
 *   { border: "rounded", columns: ["name", { key: "age", align: "right" }] },
 * );
 * ```
 */
export function table<T extends object>(data: readonly T[], options: TableOptions<T> = {}): string {
  if (!Array.isArray(data)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "data" argument of table() must be an array. Received ${describeReceived(data)}`,
    );
  }
  if (typeof options !== "object" || options === null) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "options" argument of table() must be an object. Received ${describeReceived(options)}`,
    );
  }
  validateOptions(options as TableOptions<object>);
  const columnSpecs = resolveColumns(options.columns);

  const { header = true } = options;
  const headerStyle = (options.headerStyle as string | undefined) ?? "bold";
  const truncChar = renderSafe(options.ellipsis ?? "\u2026");
  const colorizer = createColorizer(options.stream ?? process.stdout);

  // Normalize to string[][]
  const { rows, columns, specs } = normalizeData(
    data as readonly unknown[],
    options.header !== false,
    columnSpecs,
  );

  if (rows.length === 0 && columns.length === 0) return "";

  const layout = resolveLayout(options as TableOptions<object>);
  const { colWidths, cellWidths, labelWidths } = calculateWidths(rows, columns, specs, header);

  // Truncate cells. Grapheme segmentation is the dominant cost of rendering a
  // non-ASCII table, so the widths measured above are carried through instead of
  // being measured again; only a cell that truncation actually reshaped is
  // re-measured.
  const truncated = rows.map((row, r) =>
    row.map((cell, i) => truncateCell(cell, colWidths[i], truncChar, cellWidths[r][i])),
  );
  const truncatedWidths = rows.map((row, r) =>
    row.map((_cell, i) =>
      cellWidths[r][i] <= colWidths[i] ? cellWidths[r][i] : stringWidth(truncated[r][i]),
    ),
  );

  const compact = !options.rowSeparators;

  // Header row — truncate to the same width as data cells before styling so a
  // narrow maxWidth/width does not leave an over-wide header that breaks the frame.
  const headerRow = header && columns.length > 0 ? columns : undefined;
  const styledHeader = headerRow?.map((h, i) => {
    const label = truncateCell(h, colWidths[i], truncChar, labelWidths[i]);
    return headerStyle === "none" ? label : applyStyleChain(colorizer, label, headerStyle);
  });
  // Styling only wraps the label in escape sequences, which carry no display
  // width, so an untruncated label keeps the width measured for it.
  const styledHeaderWidths = styledHeader?.map((styled, i) =>
    labelWidths[i] <= colWidths[i] ? labelWidths[i] : stringWidth(styled),
  );

  const getAlign = buildAlignFn(specs);

  // Apply border color wrapper
  const { borderStyle } = options;
  const bc = borderStyle
    ? (s: string) => applyStyleChain(colorizer, s, borderStyle)
    : (s: string) => s;

  // Render
  if (layout.border === "none") {
    return renderNone(
      styledHeader,
      styledHeaderWidths,
      truncated,
      truncatedWidths,
      colWidths,
      layout.gap,
      layout.padLeft,
      layout.padRight,
      getAlign,
    );
  }
  if (layout.border === "simple") {
    return renderSimple(
      styledHeader,
      styledHeaderWidths,
      truncated,
      truncatedWidths,
      colWidths,
      layout.padLeft,
      layout.padRight,
      getAlign,
      bc,
      compact,
      layout.chars,
    );
  }

  return renderBoxed(
    styledHeader,
    styledHeaderWidths,
    truncated,
    truncatedWidths,
    colWidths,
    layout.chars,
    layout.padLeft,
    layout.padRight,
    getAlign,
    bc,
    compact,
  );
}

/**
 * Sanitizes the visible text of a cell: collapses embedded line breaks / tabs
 * to spaces so they cannot break the rendered table frame, and drops all other
 * C0 control characters, DEL, and C1 controls (e.g. `\b`, NUL, BEL) that would
 * otherwise reach the terminal and corrupt the frame or hijack the cursor.
 */
/**
 * Converts a cell value to a display string, mapping null/undefined to an empty
 * string. Visible text is sanitized of control characters while SGR color
 * sequences and OSC 8 hyperlinks are preserved; other escape sequences are
 * dropped so cell content cannot corrupt the rendered frame.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return sanitizeTerminalText(
    guardCall(
      () => String(value),
      () => Object.prototype.toString.call(value),
    ),
  );
}

/**
 * Normalizes heterogeneous input data into a uniform rows/columns structure.
 *
 * `columns` holds the display labels (header text); `specs` holds the per-column
 * settings, one entry per column, resolved by position.
 */
function normalizeData(
  data: readonly unknown[],
  headerProvided: boolean,
  columnSpecs: ResolvedColumn[] | undefined,
): { rows: string[][]; columns: string[]; specs: ResolvedColumn[] } {
  if (data.length === 0) return { rows: [], columns: [], specs: [] };

  // Array of arrays
  const firstDefinedIndex = data.findIndex((row) => row != null);
  const firstDefined = data[firstDefinedIndex];
  if (firstDefined == null) return { rows: [], columns: [], specs: [] };

  if (Array.isArray(firstDefined)) {
    const arrayData = data as readonly (readonly unknown[])[];
    // When explicit columns are supplied they serve as the header and every
    // array row is data; only auto-consume row 0 as the header when no columns
    // are given (matching the object-array branch, which never drops a row).
    const consumeFirstRowAsHeader = headerProvided && columnSpecs === undefined;
    const rawColumns =
      columnSpecs?.map((spec) => cellToString(spec.label ?? spec.key ?? "")) ??
      (consumeFirstRowAsHeader ? (arrayData[firstDefinedIndex] ?? []).map(cellToString) : []);
    const rawRows = arrayData.map((row, index) =>
      consumeFirstRowAsHeader && index === firstDefinedIndex
        ? undefined
        : row == null
          ? []
          : row.map(cellToString),
    );
    const normalizedRows = rawRows.filter((row): row is string[] => row !== undefined);
    let colCount = rawColumns.length;
    for (const row of normalizedRows) colCount = Math.max(colCount, row.length);
    const specs = Array.from(
      { length: colCount },
      (_, index): ResolvedColumn => columnSpecs?.[index] ?? {},
    );
    const columns = headerProvided
      ? Array.from({ length: colCount }, (_, index) => rawColumns[index] ?? "")
      : [];
    const rows = normalizedRows.map((row) =>
      Array.from({ length: colCount }, (_, index) => row[index] ?? ""),
    );
    return { rows, columns, specs };
  }

  // Array of objects — derive the column set from the union of all row keys so
  // keys present only on later rows are not silently dropped.
  const objData = data as readonly Record<string, unknown>[];
  let specs = columnSpecs;
  const keyless = specs?.findIndex((spec) => spec.key === undefined) ?? -1;
  if (keyless !== -1) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "columns[${keyless}].key" option of table() must be a string for object rows. Received undefined`,
    );
  }
  if (!specs) {
    const seen = new Set<string>();
    specs = [];
    for (const obj of objData) {
      if (obj == null) continue;
      for (const k of Object.keys(obj)) {
        if (!seen.has(k)) {
          seen.add(k);
          specs.push({ key: k });
        }
      }
    }
  }
  const labels = specs.map((spec) => cellToString(spec.label ?? spec.key));
  const rows = Array.from(objData, (obj) =>
    (specs as ResolvedColumn[]).map((spec) => cellToString(ownValue(obj, spec.key as string))),
  );

  return { rows, columns: labels, specs };
}

/**
 * Calculates the display width for each column based on content and constraints.
 *
 * The per-cell and per-label widths measured on the way are returned alongside
 * the column widths so the rest of the render can reuse them.
 */
function calculateWidths(
  rows: string[][],
  labels: string[],
  specs: ResolvedColumn[],
  header: boolean,
): { colWidths: number[]; cellWidths: number[][]; labelWidths: number[] } {
  let colCount = Math.max(labels.length, specs.length);
  for (const row of rows) colCount = Math.max(colCount, row.length);
  const widths = new Array<number>(colCount).fill(0);
  const labelWidths: number[] = [];

  // Header widths (from display labels)
  if (header) {
    for (let i = 0; i < labels.length; i++) {
      labelWidths[i] = stringWidth(labels[i]);
      widths[i] = Math.max(widths[i], labelWidths[i]);
    }
  }

  // Data widths
  const cellWidths: number[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const rowWidths = new Array<number>(row.length);
    for (let i = 0; i < row.length; i++) {
      rowWidths[i] = stringWidth(row[i]);
      widths[i] = Math.max(widths[i], rowWidths[i]);
    }
    cellWidths[r] = rowWidths;
  }

  for (let i = 0; i < specs.length && i < widths.length; i++) {
    const { maxWidth, width } = specs[i];
    if (maxWidth !== undefined && Number.isFinite(maxWidth)) {
      widths[i] = Math.min(widths[i], maxWidth, MAX_RENDER_WIDTH);
    }
    // width fixes the content width; padding is added around it when rendering.
    if (width !== undefined) widths[i] = Math.min(width, MAX_RENDER_WIDTH);
  }

  return { colWidths: widths, cellWidths, labelWidths };
}

/**
 * Truncates a cell string to fit within the specified width.
 *
 * `cellWidth` is the already-measured display width of `cell`; passing it lets a
 * cell that already fits skip the measurement `truncateAnsi` would repeat.
 */
function truncateCell(
  cell: string,
  maxWidth: number,
  truncChar: string,
  cellWidth: number,
): string {
  if (maxWidth <= 0) return "";
  if (cellWidth <= maxWidth) return closeAnsiState(cell);
  return truncateAnsi(cell, maxWidth, truncChar);
}

/**
 * Applies a dot-chained style (for example "cyan.bold") to text. The chain was
 * validated up front, so every segment names a built-in style.
 */
function applyStyleChain(colorizer: Colorizer, text: string, chain: string): string {
  let node: Record<string, unknown> = colorizer;
  for (const part of chain.split(".")) node = node[part] as Record<string, unknown>;
  return (node as unknown as ColorFn)(text);
}

/**
 * Pads a cell string to a target width using the specified alignment.
 */
function padCell(
  cell: string,
  width: number,
  align: "left" | "right" | "center" = "left",
  cellWidth = stringWidth(cell),
): string {
  const diff = width - cellWidth;
  if (diff <= 0) return closeAnsiState(cell);

  switch (align) {
    case "right":
      return closeAnsiState(" ".repeat(diff) + cell);
    case "center": {
      const left = Math.floor(diff / 2);
      const right = diff - left;
      return closeAnsiState(" ".repeat(left) + cell + " ".repeat(right));
    }
    default:
      return closeAnsiState(cell + " ".repeat(diff));
  }
}

/**
 * Builds an alignment resolver that reads each column's {@link ColumnSpec.align}.
 */
function buildAlignFn(specs: ResolvedColumn[]): (i: number) => "left" | "right" | "center" {
  return (i) => specs[i]?.align ?? "left";
}

// ── Renderers ──

function renderNone(
  header: string[] | undefined,
  headerWidths: number[] | undefined,
  rows: string[][],
  rowWidths: number[][],
  widths: number[],
  gap: number,
  padLeft: number,
  padRight: number,
  getAlign: (i: number) => "left" | "right" | "center",
): string {
  const lines: string[] = [];
  const pad = " ".repeat(gap);
  const pl = " ".repeat(padLeft);
  const pr = " ".repeat(padRight);
  const cell = (text: string, i: number, width: number | undefined) =>
    pl + padCell(text, widths[i], getAlign(i), width) + pr;
  if (header) {
    lines.push(header.map((h, i) => cell(h, i, headerWidths?.[i])).join(pad));
  }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    lines.push(row.map((text, i) => cell(text, i, rowWidths[rowIndex]?.[i])).join(pad));
  }
  return lines.join("\n");
}

function renderSimple(
  header: string[] | undefined,
  headerWidths: number[] | undefined,
  rows: string[][],
  rowWidths: number[][],
  widths: number[],
  padLeft: number,
  padRight: number,
  getAlign: (i: number) => "left" | "right" | "center",
  bc: (s: string) => string,
  compact: boolean,
  chars?: Required<TableChars>,
): string {
  const lines: string[] = [];
  const middle = bc(chars?.vertical ?? " | ");
  const separator = chars ? chars.horizontal : "-";
  const separatorMiddle = chars?.cross ?? "-|-";
  // Same contract as the other modes: padding is rendered around the content,
  // border glyphs go through the resolved border colorizer, and a non-compact
  // table separates its data rows.
  const pl = " ".repeat(padLeft);
  const pr = " ".repeat(padRight);
  const cell = (text: string, i: number, width: number | undefined) =>
    pl + padCell(text, widths[i], getAlign(i), width) + pr;
  const separatorLine = separator
    ? bc(widths.map((w) => separator.repeat(w + padLeft + padRight)).join(separatorMiddle))
    : "";
  if (header) {
    lines.push(header.map((h, i) => cell(h, i, headerWidths?.[i])).join(middle));
    if (separatorLine) lines.push(separatorLine);
  }
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (!compact && rowIndex > 0 && separatorLine) lines.push(separatorLine);
    const row = rows[rowIndex];
    lines.push(row.map((text, i) => cell(text, i, rowWidths[rowIndex]?.[i])).join(middle));
  }
  return lines.join("\n");
}

function renderBoxed(
  header: string[] | undefined,
  headerWidths: number[] | undefined,
  rows: string[][],
  rowWidths: number[][],
  widths: number[],
  chars: Required<TableChars>,
  padLeft: number,
  padRight: number,
  getAlign: (i: number) => "left" | "right" | "center",
  bc: (s: string) => string,
  compact: boolean,
): string {
  const lines: string[] = [];
  const pl = " ".repeat(padLeft);
  const pr = " ".repeat(padRight);
  const cellWidth = (i: number) => widths[i] + padLeft + padRight;

  // Horizontal line builders
  const hLine = (left: string, fill: string, mid: string, right: string) => {
    if (!fill) return "";
    return bc(left + widths.map((_, i) => fill.repeat(cellWidth(i))).join(mid) + right);
  };

  const topLine = hLine(chars.topLeft, chars.top, chars.topMid, chars.topRight);
  const midLine = hLine(chars.leftMid, chars.horizontal, chars.cross, chars.rightMid);
  const botLine = hLine(chars.bottomLeft, chars.bottom, chars.bottomMid, chars.bottomRight);

  const formatRow = (row: string[], cellWidths: number[] | undefined) => {
    const cells = row.map(
      (cell, i) => pl + padCell(cell, widths[i], getAlign(i), cellWidths?.[i]) + pr,
    );
    return bc(chars.left) + cells.join(bc(chars.vertical)) + bc(chars.right);
  };

  if (topLine) lines.push(topLine);

  if (header) {
    lines.push(formatRow(header, headerWidths));
    if (midLine) lines.push(midLine);
  }

  for (let i = 0; i < rows.length; i++) {
    if (!compact && i > 0 && midLine) {
      lines.push(midLine);
    }
    lines.push(formatRow(rows[i], rowWidths[i]));
  }

  if (botLine) lines.push(botLine);

  return lines.join("\n");
}

import type { Writable } from "node:stream";
import { usageError } from "../errors.js";
import { guardCall, MAX_RENDER_WIDTH, ownValue } from "../guard.js";
import {
  type ColorFn,
  type ColorProxy,
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
  top?: string;
  /** Junction on the top edge between two columns. */
  topMid?: string;
  /** Top-left corner. */
  topLeft?: string;
  /** Top-right corner. */
  topRight?: string;
  /** Horizontal fill of the bottom edge. */
  bottom?: string;
  /** Junction on the bottom edge between two columns. */
  bottomMid?: string;
  /** Bottom-left corner. */
  bottomLeft?: string;
  /** Bottom-right corner. */
  bottomRight?: string;
  /** Left edge of every row. */
  left?: string;
  /** Left end of a separator line between rows. */
  leftMid?: string;
  /** Right edge of every row. */
  right?: string;
  /** Right end of a separator line between rows. */
  rightMid?: string;
  /** Horizontal fill of a separator line between rows. */
  horizontal?: string;
  /** Crossing of a separator line and a column divider. */
  cross?: string;
  /** Divider between two columns within a row. */
  vertical?: string;
}

/**
 * Settings for one column, passed in {@link TableOptions.columns}.
 */
export interface ColumnSpec {
  /** Object property to read for object data. Array data is matched by position and ignores it. */
  key: string;
  /** Header text. Defaults to `key`. */
  label?: string;
  /** Text alignment of the header and the cells. Defaults to `"left"`. */
  align?: "left" | "right" | "center";
  /**
   * Fixed total width of the column, padding included, as a positive integer.
   * Values below `paddingLeft + paddingRight + 1` render at that minimum. When
   * set, it wins over `maxWidth`.
   */
  width?: number;
  /** Upper bound on the content width, padding excluded: a positive integer or `Infinity`. */
  maxWidth?: number;
}

/**
 * Options for configuring table rendering.
 */
export interface TableOptions {
  /**
   * Columns to render, in order. For object data these select the properties; for
   * array data they are matched by position and supplying them means row 0 is
   * data rather than the header.
   */
  columns?: readonly (string | ColumnSpec)[];
  /** Whether to display a header row. Defaults to true. */
  header?: boolean;
  /** Border style preset. Use "custom" with `chars` for full control. */
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  /** Custom border characters. Implicitly sets border to "custom" if provided without border option. */
  chars?: TableChars;
  /** Style of the border glyphs, for example `"dim"` or `"cyan.bold"`. */
  borderColor?: StyleSpec;
  /** Style of the header text, or `"none"` for plain text. Defaults to `"bold"`. */
  headerStyle?: StyleSpec | "none";
  /** Spaces inside each cell on the left. Defaults to 1 with a frame and 0 with `border: "none"`. */
  paddingLeft?: number;
  /** Spaces inside each cell on the right. Defaults to 1 with a frame and 0 with `border: "none"`. */
  paddingRight?: number;
  /** Spaces between columns of a borderless table. Defaults to 2. */
  gap?: number;
  /** Draw a separator line between data rows. Defaults to false. */
  rowSeparators?: boolean;
  /** Marker appended to a truncated cell. Defaults to "…". */
  ellipsis?: string;
  /**
   * Stream the result is meant for. It only decides whether colour is emitted
   * (a TTY gets colour); nothing is written to it. Defaults to `process.stdout`.
   */
  stream?: Writable;
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

function resolveChars(options: TableOptions): Required<TableChars> {
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
  border: NonNullable<TableOptions["border"]>;
  chars: Required<TableChars>;
  padLeft: number;
  padRight: number;
  gap: number;
};

/** Resolves border characters and every padding value shared by sizing and rendering. */
function resolveLayout(options: TableOptions): TableLayout {
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
  if (typeof value !== "number") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", `${name} must be a number`);
  }
  if (allowInfinity && value === Number.POSITIVE_INFINITY) return;
  const valid = safe ? Number.isSafeInteger(value) : Number.isInteger(value);
  if (!valid || value < min) {
    const shape = safe ? "a safe integer" : "an integer";
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `${name} must be ${shape} of at least ${min}${allowInfinity ? " or Infinity" : ""}, received ${value}`,
    );
  }
}

/** Checks a style name or dot-separated chain; every segment must be a built-in style. */
function checkStyle(name: string, value: unknown, allowNone = false): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", `${name} must be a string`);
  }
  if (allowNone && value === "none") return;
  for (const segment of value.split(".")) {
    if (!isStyleName(segment)) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        `${name} contains the unknown style "${segment}" in "${value}"`,
      );
    }
  }
}

/** Validates `columns` and converts every entry to a {@link ColumnSpec}. */
function resolveColumns(columns: TableOptions["columns"]): ColumnSpec[] | undefined {
  if (columns === undefined) return undefined;
  if (!Array.isArray(columns)) {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "columns must be an array");
  }
  return columns.map((entry: unknown, index) => {
    if (typeof entry === "string") return { key: entry };
    const spec = entry as ColumnSpec | null | undefined;
    if (typeof spec !== "object" || spec === null || typeof spec.key !== "string") {
      throw usageError(
        "type",
        "ERR_INVALID_ARG_TYPE",
        `columns[${index}] must be a string or a ColumnSpec with a string key`,
      );
    }
    checkInteger(`columns[${index}].width`, spec.width, 1);
    checkInteger(`columns[${index}].maxWidth`, spec.maxWidth, 1, true);
    return spec;
  });
}

/** Validates every option that has a closed or numeric domain, before any rendering. */
function validateOptions(options: TableOptions): void {
  if (options.border !== undefined) {
    if (typeof options.border !== "string") {
      throw usageError("type", "ERR_INVALID_ARG_TYPE", "border must be a string");
    }
    if (!BORDER_NAMES.has(options.border)) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        `Unknown border "${options.border}". Valid borders: ${[...BORDER_NAMES].join(", ")}`,
      );
    }
  }
  checkStyle("headerStyle", options.headerStyle, true);
  checkStyle("borderColor", options.borderColor);
  checkInteger("paddingLeft", options.paddingLeft, 0, false, true);
  checkInteger("paddingRight", options.paddingRight, 0, false, true);
  checkInteger("gap", options.gap, 0, false, true);
}

/**
 * Renders tabular data as a formatted string.
 *
 * Accepts either an array of arrays or an array of objects. Supports configurable
 * borders, per-column alignment and widths, header styling, and custom border
 * characters. The result is returned, never written: `options.stream` only
 * decides whether colour escape codes are included.
 *
 * @param data - The data to render, either as rows of arrays or rows of objects.
 * @param options - Table rendering options.
 * @returns The formatted table string.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an unknown border or style name, or a width, maxWidth, gap or padding outside its range.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a value of the wrong type, including a `columns` entry that is not a string or a `ColumnSpec`.
 */
export function table(
  data: readonly (readonly unknown[])[] | readonly Record<string, unknown>[],
  options: TableOptions = {},
): string {
  validateOptions(options);
  const columnSpecs = resolveColumns(options.columns);

  const { header = true } = options;
  const headerStyle = (options.headerStyle as string | undefined) ?? "bold";
  const truncChar = renderSafe(options.ellipsis ?? "\u2026");
  const colorizer = createColorizer(options.stream ?? process.stdout);

  // Normalize to string[][]
  const { rows, columns, specs } = normalizeData(data, options.header !== false, columnSpecs);

  if (rows.length === 0 && columns.length === 0) return "";

  const layout = resolveLayout(options);
  const { colWidths, cellWidths, labelWidths } = calculateWidths(
    rows,
    columns,
    specs,
    header,
    layout,
  );

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
  const { borderColor } = options;
  const bc = borderColor
    ? (s: string) => applyStyleChain(colorizer, s, borderColor)
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
  data: readonly (readonly unknown[])[] | readonly Record<string, unknown>[],
  headerProvided: boolean,
  columnSpecs: ColumnSpec[] | undefined,
): { rows: string[][]; columns: string[]; specs: ColumnSpec[] } {
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
      columnSpecs?.map((spec) => cellToString(spec.label ?? spec.key)) ??
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
      (_, index): ColumnSpec => columnSpecs?.[index] ?? { key: String(index) },
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
    (specs as ColumnSpec[]).map((spec) => cellToString(ownValue(obj, spec.key))),
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
  specs: ColumnSpec[],
  header: boolean,
  layout: TableLayout,
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
    // width is the total column width including padding; the content width is
    // what remains, and never drops below one cell.
    if (width !== undefined) {
      const contentWidth = Math.min(width, MAX_RENDER_WIDTH) - layout.padLeft - layout.padRight;
      widths[i] = Math.max(contentWidth, 1);
    }
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
function applyStyleChain(colorizer: ColorProxy, text: string, chain: string): string {
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
function buildAlignFn(specs: ColumnSpec[]): (i: number) => "left" | "right" | "center" {
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
  // Width calculation already charged every explicit ColumnSpec.width for the
  // left and right padding, so the renderer has to put it back; otherwise the
  // column comes out narrower than the caller asked for.
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
  // Same contract as the other modes: padding charged to the width is rendered,
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

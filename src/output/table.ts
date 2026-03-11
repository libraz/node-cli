import { color as c, stringWidth, stripAnsi } from "./color.js";

/**
 * Custom border characters for table rendering.
 * Each property controls one piece of the box-drawing frame.
 */
export interface TableChars {
  top?: string;
  "top-mid"?: string;
  "top-left"?: string;
  "top-right"?: string;
  bottom?: string;
  "bottom-mid"?: string;
  "bottom-left"?: string;
  "bottom-right"?: string;
  left?: string;
  "left-mid"?: string;
  right?: string;
  "right-mid"?: string;
  mid?: string;
  "mid-mid"?: string;
  middle?: string;
}

/**
 * Style options for table rendering.
 */
export interface TableStyle {
  /** Left padding inside each cell (number of spaces). Defaults to 1 for bordered, 0 for none. */
  "padding-left"?: number;
  /** Right padding inside each cell (number of spaces). Defaults to 1 for bordered, 0 for none. */
  "padding-right"?: number;
  /** Color/style applied to header text (e.g. "red", "bold", "cyan.bold"). */
  head?: string;
  /** Color/style applied to border characters (e.g. "grey", "dim", "cyan"). */
  border?: string;
  /** When true, suppresses row separators between data rows. Defaults to true. */
  compact?: boolean;
}

/**
 * Options for configuring table rendering.
 */
export interface TableOptions {
  /** Column keys to include (for object data) or header labels (for array data). */
  columns?: string[];
  /** Whether to display a header row. Defaults to true. */
  header?: boolean;
  /** Custom display labels for column keys, keyed by column name. */
  headerLabels?: Record<string, string>;
  /** Border style preset. Use "custom" with `chars` for full control. */
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  /** Custom border characters. Implicitly sets border to "custom" if provided without border option. */
  chars?: TableChars;
  /** Text alignment per column, keyed by column name. */
  align?: Record<string, "left" | "right" | "center">;
  /** Text alignment per column by index. Takes precedence over `align` by name. */
  colAligns?: ("left" | "right" | "center")[];
  /** Fixed width per column by index. Takes precedence over auto-calculated widths. */
  colWidths?: number[];
  /** Maximum width per column, keyed by column name. */
  maxWidth?: Record<string, number>;
  /** Padding between columns (number of spaces). Used for borderless tables. Defaults to 2. */
  padding?: number;
  /** Style applied to the header row text. Defaults to "bold". */
  headerStyle?: "bold" | "dim" | "underline" | "none";
  /** Character used when truncating cell content. Defaults to "…". */
  truncate?: string;
  /** Style options for padding, header color, border color, and compact mode. */
  style?: TableStyle;
}

// ── Border Presets ──

const CHARS_ROUNDED: Required<TableChars> = {
  top: "─",
  "top-mid": "┬",
  "top-left": "╭",
  "top-right": "╮",
  bottom: "─",
  "bottom-mid": "┴",
  "bottom-left": "╰",
  "bottom-right": "╯",
  left: "│",
  "left-mid": "├",
  right: "│",
  "right-mid": "┤",
  mid: "─",
  "mid-mid": "┼",
  middle: "│",
};

const CHARS_SINGLE: Required<TableChars> = {
  top: "─",
  "top-mid": "┬",
  "top-left": "┌",
  "top-right": "┐",
  bottom: "─",
  "bottom-mid": "┴",
  "bottom-left": "└",
  "bottom-right": "┘",
  left: "│",
  "left-mid": "├",
  right: "│",
  "right-mid": "┤",
  mid: "─",
  "mid-mid": "┼",
  middle: "│",
};

const CHARS_DOUBLE: Required<TableChars> = {
  top: "═",
  "top-mid": "╦",
  "top-left": "╔",
  "top-right": "╗",
  bottom: "═",
  "bottom-mid": "╩",
  "bottom-left": "╚",
  "bottom-right": "╝",
  left: "║",
  "left-mid": "╠",
  right: "║",
  "right-mid": "╣",
  mid: "═",
  "mid-mid": "╬",
  middle: "║",
};

const CHARS_SIMPLE: Required<TableChars> = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "",
  "left-mid": "",
  right: "",
  "right-mid": "",
  mid: "-",
  "mid-mid": "-|-",
  middle: " | ",
  // simple has special rendering handled separately
};

const CHARS_NONE: Required<TableChars> = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "",
  "left-mid": "",
  right: "",
  "right-mid": "",
  mid: "",
  "mid-mid": "",
  middle: "",
};

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
    return { ...base, ...options.chars };
  }
  return base;
}

/**
 * Renders tabular data as a formatted string.
 *
 * Accepts either an array of arrays or an array of objects. Supports configurable
 * borders, column alignment, max column widths, header styling, and custom border characters.
 *
 * @param data - The data to render, either as rows of arrays or rows of objects.
 * @param options - Table rendering options.
 * @returns The formatted table string.
 */
export function table(
  data: unknown[][] | Record<string, unknown>[],
  options: TableOptions = {},
): string {
  const { header = true, headerStyle = "bold" } = options;
  const truncChar = options.truncate ?? "\u2026";

  // Normalize to string[][]
  const { rows, columns } = normalizeData(data, options);

  if (rows.length === 0) return "";

  // Calculate column widths
  const colWidths = calculateWidths(rows, columns, header, options);

  // Truncate cells
  const truncated = rows.map((row) =>
    row.map((cell, i) => truncateCell(cell, colWidths[i], truncChar)),
  );

  // Style
  const style = options.style ?? {};
  const headColor = style.head;
  const borderColor = style.border;
  const compact = style.compact ?? true;

  // Header row
  const headerRow = header && columns.length > 0 ? columns : undefined;
  const styledHeader = headerRow?.map((h) => {
    let styled = applyHeaderStyle(h, headerStyle);
    if (headColor) styled = applyColorChain(styled, headColor);
    return styled;
  });

  // Resolve border characters
  const chars = resolveChars(options);

  const border = options.chars ? (options.border ?? "custom") : (options.border ?? "none");

  // Resolve alignment
  const getAlign = buildAlignFn(options, columns);

  // Resolve cell padding
  const isBordered = border !== "none" && border !== "simple";
  const padLeft = style["padding-left"] ?? (isBordered ? 1 : 0);
  const padRight = style["padding-right"] ?? (isBordered ? 1 : 0);
  const colPadding = options.padding ?? 2;

  // Apply border color wrapper
  const bc = borderColor ? (s: string) => applyColorChain(s, borderColor) : (s: string) => s;

  // Render
  if (border === "none") {
    return renderNone(styledHeader, truncated, colWidths, colPadding, getAlign);
  }
  if (border === "simple") {
    return renderSimple(styledHeader, truncated, colWidths, getAlign);
  }

  return renderBoxed(
    styledHeader,
    truncated,
    colWidths,
    chars,
    padLeft,
    padRight,
    getAlign,
    bc,
    compact,
  );
}

/**
 * Normalizes heterogeneous input data into a uniform rows/columns structure.
 */
function normalizeData(
  data: unknown[][] | Record<string, unknown>[],
  options: TableOptions,
): { rows: string[][]; columns: string[] } {
  if (data.length === 0) return { rows: [], columns: [] };

  // Array of arrays
  if (Array.isArray(data[0])) {
    const arrayData = data as unknown[][];
    const columns = options.columns ?? (arrayData.length > 0 ? arrayData[0].map(String) : []);
    const rows = arrayData
      .slice(options.header !== false ? 1 : 0)
      .map((row) => (row as unknown[]).map(String));
    return { rows, columns: options.header !== false ? columns : [] };
  }

  // Array of objects
  const objData = data as Record<string, unknown>[];
  const columns = options.columns ?? Object.keys(objData[0]);
  const labels = columns.map((col) => options.headerLabels?.[col] ?? col);
  const rows = objData.map((obj) => columns.map((col) => String(obj[col] ?? "")));

  return { rows, columns: labels };
}

/**
 * Calculates the display width for each column based on content and constraints.
 */
function calculateWidths(
  rows: string[][],
  columns: string[],
  header: boolean,
  options: TableOptions,
): number[] {
  const colCount = rows[0]?.length ?? columns.length;
  const widths = new Array<number>(colCount).fill(0);

  // Header widths
  if (header) {
    for (let i = 0; i < columns.length; i++) {
      widths[i] = Math.max(widths[i], stringWidth(columns[i]));
    }
  }

  // Data widths
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      widths[i] = Math.max(widths[i], stringWidth(row[i]));
    }
  }

  // Apply maxWidth (by column name)
  const maxWidth = options.maxWidth;
  if (maxWidth && columns.length > 0) {
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      if (maxWidth[col] !== undefined) {
        widths[i] = Math.min(widths[i], maxWidth[col]);
      }
    }
  }

  // Apply colWidths (by index, fixed width overrides)
  const colWidths = options.colWidths;
  if (colWidths) {
    for (let i = 0; i < colWidths.length && i < widths.length; i++) {
      if (colWidths[i] !== undefined && colWidths[i] > 0) {
        // colWidths specifies total column width including padding
        // Internal content width = colWidths - padding
        const style = options.style ?? {};
        const border = options.chars ? (options.border ?? "custom") : (options.border ?? "none");
        const isBordered = border !== "none" && border !== "simple";
        const padL = style["padding-left"] ?? (isBordered ? 1 : 0);
        const padR = style["padding-right"] ?? (isBordered ? 1 : 0);
        const contentWidth = colWidths[i] - padL - padR;
        widths[i] = Math.max(contentWidth, 1);
      }
    }
  }

  return widths;
}

/**
 * Truncates a cell string to fit within the specified width.
 */
function truncateCell(cell: string, maxWidth: number, truncChar: string): string {
  if (stringWidth(cell) <= maxWidth) return cell;

  const stripped = stripAnsi(cell);
  const truncWidth = stringWidth(truncChar);
  let width = 0;
  let result = "";

  for (const char of stripped) {
    const charWidth = stringWidth(char);
    if (width + charWidth + truncWidth > maxWidth) {
      result += truncChar;
      break;
    }
    result += char;
    width += charWidth;
  }

  return result;
}

/**
 * Applies a text style (bold, dim, underline) to a header cell string.
 */
function applyHeaderStyle(text: string, style: string): string {
  switch (style) {
    case "bold":
      return c.bold(text);
    case "dim":
      return c.dim(text);
    case "underline":
      return c.underline(text);
    default:
      return text;
  }
}

/**
 * Applies a dot-chained color/style string to text (e.g. "red", "cyan.bold", "dim").
 */
function applyColorChain(text: string, chain: string): string {
  const parts = chain.split(".");
  let result: unknown = c;
  for (const part of parts) {
    result = (result as Record<string, unknown>)[part];
    if (typeof result !== "function" && typeof result !== "object") return text;
  }
  if (typeof result === "function") return (result as (s: string) => string)(text);
  return text;
}

/**
 * Pads a cell string to a target width using the specified alignment.
 */
function padCell(cell: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const cellWidth = stringWidth(cell);
  const diff = width - cellWidth;
  if (diff <= 0) return cell;

  switch (align) {
    case "right":
      return " ".repeat(diff) + cell;
    case "center": {
      const left = Math.floor(diff / 2);
      const right = diff - left;
      return " ".repeat(left) + cell + " ".repeat(right);
    }
    default:
      return cell + " ".repeat(diff);
  }
}

/**
 * Builds an alignment resolver function that handles both Record-based and array-based alignment.
 */
function buildAlignFn(
  options: TableOptions,
  columns: string[],
): (i: number) => "left" | "right" | "center" {
  const { align, colAligns } = options;
  return (i: number): "left" | "right" | "center" => {
    // colAligns (array) takes precedence
    if (colAligns?.[i]) return colAligns[i];
    // Then align (Record by column name)
    if (align && columns[i]) return align[columns[i]] ?? "left";
    return "left";
  };
}

// ── Renderers ──

function renderNone(
  header: string[] | undefined,
  rows: string[][],
  widths: number[],
  padding: number,
  getAlign: (i: number) => "left" | "right" | "center",
): string {
  const lines: string[] = [];
  const pad = " ".repeat(padding);
  if (header) {
    lines.push(header.map((h, i) => padCell(h, widths[i], getAlign(i))).join(pad));
  }
  for (const row of rows) {
    lines.push(row.map((cell, i) => padCell(cell, widths[i], getAlign(i))).join(pad));
  }
  return lines.join("\n");
}

function renderSimple(
  header: string[] | undefined,
  rows: string[][],
  widths: number[],
  getAlign: (i: number) => "left" | "right" | "center",
): string {
  const lines: string[] = [];
  if (header) {
    lines.push(header.map((h, i) => padCell(h, widths[i], getAlign(i))).join(" | "));
    lines.push(widths.map((w) => "-".repeat(w)).join("-|-"));
  }
  for (const row of rows) {
    lines.push(row.map((cell, i) => padCell(cell, widths[i], getAlign(i))).join(" | "));
  }
  return lines.join("\n");
}

function renderBoxed(
  header: string[] | undefined,
  rows: string[][],
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

  const topLine = hLine(chars["top-left"], chars.top, chars["top-mid"], chars["top-right"]);
  const midLine = hLine(chars["left-mid"], chars.mid, chars["mid-mid"], chars["right-mid"]);
  const botLine = hLine(
    chars["bottom-left"],
    chars.bottom,
    chars["bottom-mid"],
    chars["bottom-right"],
  );

  const formatRow = (row: string[]) => {
    const cells = row.map((cell, i) => pl + padCell(cell, widths[i], getAlign(i)) + pr);
    return bc(chars.left) + cells.join(bc(chars.middle)) + bc(chars.right);
  };

  if (topLine) lines.push(topLine);

  if (header) {
    lines.push(formatRow(header));
    if (midLine) lines.push(midLine);
  }

  for (let i = 0; i < rows.length; i++) {
    if (!compact && i > 0 && midLine) {
      lines.push(midLine);
    }
    lines.push(formatRow(rows[i]));
  }

  if (botLine) lines.push(botLine);

  return lines.join("\n");
}

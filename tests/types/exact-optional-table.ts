import type { Writable } from "node:stream";
import {
  type ColumnSpec,
  type SanitizeTerminalTextOptions,
  type TableChars,
  type TableOptions,
  table,
} from "../../dist/index.js";

declare const text: string | undefined;
declare const size: number | undefined;
declare const flag: boolean | undefined;
declare const stream: Writable | undefined;

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into optional members.
const spec: ColumnSpec = {
  key: "a",
  label: text,
  align: undefined,
  width: size,
  maxWidth: size,
};
const arraySpec: ColumnSpec<string[]> = { key: undefined, label: text, width: size };
const chars: TableChars = { top: text, topLeft: text, vertical: text, cross: undefined };
const options: TableOptions = {
  columns: [spec],
  header: flag,
  border: undefined,
  chars,
  borderStyle: undefined,
  headerStyle: undefined,
  paddingLeft: size,
  paddingRight: size,
  gap: size,
  rowSeparators: flag,
  ellipsis: text,
  stream,
};
const arrayOptions: TableOptions<string[]> = { columns: [arraySpec], header: flag };
const sanitizeOptions: SanitizeTerminalTextOptions = { singleLine: flag, allowHyperlinks: flag };
void [options, arrayOptions, sanitizeOptions];
void table([{ a: 1 }], options);
void table([["a"]], arrayOptions);

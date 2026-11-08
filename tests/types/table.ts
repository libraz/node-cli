import type { Writable } from "node:stream";
// @ts-expect-error TableStyle was removed
import type { TableStyle } from "../../src/index.js";
import { type ColumnSpec, type TableChars, type TableOptions, table } from "../../src/index.js";

declare const stream: Writable;
declare const dynamicStyle: string;

// Object rows, array rows and readonly data are all accepted.
const text: string = table([{ name: "Alice" }]);
const fromArrays: string = table([["name"], ["Alice"]]);
const frozen = [["name"], ["Alice"]] as const;
const fromFrozen: string = table(frozen);
const frozenObjects = [{ name: "Alice" }] as const;
const fromFrozenObjects: string = table(frozenObjects);
void [text, fromArrays, fromFrozen, fromFrozenObjects];

// columns accepts strings, specs and a readonly tuple.
const spec: ColumnSpec = {
  key: "name",
  label: "Name",
  align: "right",
  width: 12,
  maxWidth: 8,
};
void table([], { columns: ["a", spec] });
void table([], { columns: ["a", "b"] as const });
// @ts-expect-error a spec needs a key
void table([], { columns: [{ label: "Name" }] });
// @ts-expect-error the old header field is now label
void table([], { columns: [{ key: "a", header: "A" }] });
// @ts-expect-error align is a closed set
void table([], { columns: [{ key: "a", align: "middle" }] });

// The new option set.
const options: TableOptions = {
  columns: ["a"],
  header: true,
  border: "rounded",
  borderColor: "cyan",
  headerStyle: "cyan.bold",
  paddingLeft: 1,
  paddingRight: 1,
  gap: 2,
  rowSeparators: true,
  ellipsis: "..",
  stream,
};
void options;
void table([], { headerStyle: "none" });
// @ts-expect-error "none" is only a header style, not a border colour
void table([], { borderColor: "none" });
// @ts-expect-error an unknown style name
void table([], { headerStyle: "bolld" });
// @ts-expect-error a plain string is not a StyleSpec
void table([], { borderColor: dynamicStyle });
// @ts-expect-error unknown border preset
void table([], { border: "dotted" });

// Removed options are excess properties.
// @ts-expect-error replaced by ColumnSpec.align
void table([], { align: { a: "left" } });
// @ts-expect-error replaced by ColumnSpec.align
void table([], { colAligns: ["left"] });
// @ts-expect-error replaced by ColumnSpec.width
void table([], { colWidths: [1] });
// @ts-expect-error replaced by ColumnSpec.maxWidth
void table([], { maxWidth: { a: 1 } });
// @ts-expect-error replaced by ColumnSpec.label
void table([], { headerLabels: { a: "A" } });
// @ts-expect-error replaced by gap
void table([], { padding: 2 });
// @ts-expect-error replaced by ellipsis
void table([], { truncate: "." });
// @ts-expect-error replaced by borderColor, headerStyle, paddingLeft, paddingRight and rowSeparators
void table([], { style: { head: "red" } });

// TableChars uses camelCase keys.
const chars: TableChars = {
  top: "-",
  topMid: "+",
  topLeft: "+",
  topRight: "+",
  bottom: "-",
  bottomMid: "+",
  bottomLeft: "+",
  bottomRight: "+",
  left: "|",
  leftMid: "+",
  right: "|",
  rightMid: "+",
  horizontal: "-",
  cross: "+",
  vertical: "|",
};
void chars;
// @ts-expect-error the kebab-case key is gone
const oldKey: TableChars = { "top-left": "+" };
// @ts-expect-error mid was renamed horizontal
const oldMid: TableChars = { mid: "-" };
void [oldKey, oldMid];

// TableStyle is no longer exported.
export type Removed = TableStyle;

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
// @ts-expect-error a spec for object rows needs a key
void table([{ name: "a" }], { columns: [{ label: "Name" }] });
// @ts-expect-error the old header field is now label
void table([], { columns: [{ key: "a", header: "A" }] });
// @ts-expect-error align is a closed set
void table([], { columns: [{ key: "a", align: "middle" }] });

// Array rows have no key: a spec without one is accepted, one with a key is not.
void table([["a"]], { columns: [{ label: "Name", align: "right" }, "b"] });
// @ts-expect-error array rows are matched by position and take no key
void table([["a"]], { columns: [{ key: "x" }] });
// @ts-expect-error array rows are matched by position and take no key
void table([["a"]], { columns: [{ key: "x", label: "Name" }] });

// Object rows check column names against the row type.
interface Person {
  name: string;
  age: number;
}
declare const people: readonly Person[];
void table(people, { columns: ["name", { key: "age", align: "right" }] });
// @ts-expect-error not a property of Person
void table(people, { columns: ["nmae"] });
// @ts-expect-error not a property of Person
void table(people, { columns: [{ key: "nmae" }] });
class Point {
  x = 1;
  y = 2;
}
void table([new Point()], { columns: ["x", { key: "y" }] });
const typedSpec: ColumnSpec<Person> = { key: "name", width: 4 };
const typedOptions: TableOptions<Person> = { columns: [typedSpec] };
void typedOptions;
// @ts-expect-error not a property of Person
const badSpec: ColumnSpec<Person> = { key: "id" };
void badSpec;
// @ts-expect-error array specs take no key
const arraySpec: ColumnSpec<string[]> = { key: "x" };
void arraySpec;
const keylessSpec: ColumnSpec<string[]> = { label: "x" };
void keylessSpec;
// The default type arguments keep the loose declaration working.
const loose: TableOptions = { columns: ["anything", { key: "else" }] };
const looseSpec: ColumnSpec = { key: "anything" };
void [loose, looseSpec];
// @ts-expect-error data must be an array of objects or arrays
void table(["a", "b"]);
// @ts-expect-error data must be an array
void table(42);

// The new option set.
const options: TableOptions = {
  columns: ["a"],
  header: true,
  border: "rounded",
  borderStyle: "cyan",
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
void table([], { borderStyle: "none" });
// @ts-expect-error an unknown style name
void table([], { headerStyle: "bolld" });
// @ts-expect-error a plain string is not a StyleSpec
void table([], { borderStyle: dynamicStyle });
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
// @ts-expect-error replaced by borderStyle, headerStyle, paddingLeft, paddingRight and rowSeparators
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

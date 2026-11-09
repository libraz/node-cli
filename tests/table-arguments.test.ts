import { readFileSync } from "node:fs";
import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setColorEnabled, table } from "../src/index.js";

const source = readFileSync(new URL("../src/output/table.ts", import.meta.url), "utf8");

/** Returns the doc comment directly above the declaration line that matches `member`. */
function docOf(member: RegExp): string {
  const lines = source.split("\n");
  const at = lines.findIndex((line) => member.test(line));
  expect(at).toBeGreaterThan(-1);
  let start = at - 1;
  while (start >= 0 && !lines[start].includes("/**")) start--;
  return lines.slice(start, at).join("\n");
}

describe("table() with empty data", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("draws a header-only simple table", () => {
    expect(table([], { columns: ["a", "b"], border: "simple" })).toBe("a | b\n--|--");
  });

  it("draws a header-only rounded table", () => {
    expect(table([], { columns: ["a", "b"], border: "rounded" })).toBe(
      "╭───┬───╮\n│ a │ b │\n├───┼───┤\n╰───┴───╯",
    );
  });

  it("draws a header-only borderless table", () => {
    expect(table([], { columns: ["a", "b"], border: "none" })).toBe("a  b");
  });

  it("is the table with one empty row minus the body row", () => {
    const withRow = table([{}], { columns: ["a", "b"], border: "rounded" }).split("\n");
    withRow.splice(3, 1);
    expect(table([], { columns: ["a", "b"], border: "rounded" })).toBe(withRow.join("\n"));
  });

  it("uses label, then key, then an empty string for headings", () => {
    expect(table([], { columns: [{ key: "a", label: "A" }, { key: "b" }], border: "simple" })).toBe(
      "A | b\n--|--",
    );
    expect(table([], { columns: [{ label: "L" }], border: "simple" })).toBe("L\n-");
  });

  it("returns an empty string without columns or with header: false", () => {
    expect(table([])).toBe("");
    expect(table([], { columns: ["a"], header: false })).toBe("");
    expect(table([], { columns: [] })).toBe("");
  });
});

describe("table() stream validation", () => {
  it.each([null, 1, "out", {}, { write: 1 }])("rejects %j", (stream) => {
    let caught: unknown;
    try {
      table([{ a: 1 }], { stream: stream as unknown as Writable });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    expect((caught as Error).message).toContain("table()");
  });

  it("accepts a stream with a write function and the default", () => {
    setColorEnabled(false);
    const stream = { write: () => true } as unknown as Writable;
    expect(table([{ a: 1 }], { stream })).toBeTypeOf("string");
    expect(table([{ a: 1 }], { stream: undefined })).toBeTypeOf("string");
    setColorEnabled("auto");
  });
});

describe("table.ts TSDoc", () => {
  it("documents header row 0", () => {
    expect(docOf(/^\s*header\?:/)).toContain("row 0");
  });

  it("documents columns matching by position and string headers", () => {
    const doc = docOf(/^\s*columns\?: readonly/);
    expect(doc).toContain("position");
    expect(doc).toContain("header text");
  });

  it.each([
    ["borderStyle", /^\s*borderStyle\?:/],
    ["chars", /^\s*chars\?: TableChars/],
    ["ColumnSpec.width", /^\s*width\?: number/],
  ])("gives %s a default", (_name, member) => {
    expect(docOf(member)).toContain("Defaults to");
  });
});

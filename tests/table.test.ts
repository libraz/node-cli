import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { color, setColorEnabled, stringWidth, stripAnsi } from "../src/output/color.js";
import { table } from "../src/output/table.js";

describe("table", () => {
  beforeEach(() => {
    setColorEnabled(false);
  });

  afterEach(() => {
    setColorEnabled("auto");
  });

  it("renders array data", () => {
    const result = table([
      ["Name", "Role"],
      ["alice", "admin"],
      ["bob", "user"],
    ]);
    expect(result).toContain("Name");
    expect(result).toContain("alice");
    expect(result).toContain("bob");
  });

  it("renders object array data", () => {
    const result = table(
      [
        { name: "alice", role: "admin" },
        { name: "bob", role: "user" },
      ],
      { columns: ["name", "role"] },
    );
    expect(result).toContain("name");
    expect(result).toContain("alice");
  });

  it("uses ColumnSpec.label", () => {
    const result = table([{ name: "alice" }], {
      columns: [{ key: "name", label: "Full Name" }],
    });
    expect(result).toContain("Full Name");
  });

  it("uses ColumnSpec.label for array input", () => {
    const result = table(
      [
        ["alice", "admin"],
        ["bob", "user"],
      ],
      {
        columns: [
          { key: "name", label: "Full Name" },
          { key: "role", label: "Access" },
        ],
      },
    );
    expect(result).toContain("Full Name");
    expect(result).toContain("Access");
    expect(result).not.toContain("role");
  });

  it("renders with simple border", () => {
    const result = table(
      [
        ["Name", "Role"],
        ["alice", "admin"],
      ],
      { border: "simple" },
    );
    expect(result).toContain("|");
    expect(result).toContain("-");
  });

  it("renders with rounded border", () => {
    const result = table(
      [
        ["Name", "Role"],
        ["alice", "admin"],
      ],
      { border: "rounded" },
    );
    expect(result).toContain("╭");
    expect(result).toContain("╰");
    expect(result).toContain("│");
  });

  it("aligns columns", () => {
    const result = table([{ val: "1" }, { val: "100" }], {
      columns: [{ key: "val", align: "right" }],
    });
    expect(result.split("\n").slice(1)).toEqual(["  1", "100"]);
  });

  it("keeps framed rows equally wide with CJK and status symbols", () => {
    const result = table(
      [
        ["状態", "値"],
        ["✓", "日本"],
        ["⭐", "ok"],
      ],
      { border: "single" },
    );
    const widths = result.split("\n").map(stringWidth);
    expect(new Set(widths).size).toBe(1);
  });

  it("returns empty string for empty data", () => {
    expect(table([])).toBe("");
  });

  it("treats null rows as empty rows instead of throwing", () => {
    const result = table([null, { name: "alice" }] as unknown as Record<string, unknown>[], {
      border: "single",
    });
    expect(result).toContain("alice");

    expect(table([null] as unknown as Record<string, unknown>[])).toBe("");
  });

  it("caps padding larger than a render can hold", () => {
    const bordered = table([["Name"], ["alice"]], {
      border: "single",
      paddingLeft: 2 ** 31,
      paddingRight: 2 ** 32,
    });
    // Every row lines up, and the padding is capped instead of building a
    // multi-gigabyte string.
    expect(new Set(bordered.split("\n").map(stringWidth)).size).toBe(1);
  });

  it("renders the header for a header-only array", () => {
    const result = table([["Name", "Role"]], { border: "single" });
    expect(result).toContain("Name");
    expect(result).toContain("Role");
  });

  it("keeps every array row as data when explicit columns are supplied", () => {
    const result = table(
      [
        ["alice", "admin"],
        ["bob", "user"],
      ],
      { columns: ["Name", "Role"] },
    );
    // Columns act as the header; no data row is consumed as the header.
    expect(result).toContain("Name");
    expect(result).toContain("Role");
    expect(result).toContain("alice");
    expect(result).toContain("bob");
  });

  it("handles header: false for array data", () => {
    const result = table(
      [
        ["alice", "admin"],
        ["bob", "user"],
      ],
      { header: false },
    );
    expect(result).toContain("alice");
  });

  // ── New options ──

  it("renders with single border", () => {
    const result = table(
      [
        ["Name", "Role"],
        ["alice", "admin"],
      ],
      { border: "single" },
    );
    expect(result).toContain("┌");
    expect(result).toContain("┘");
    expect(result).toContain("│");
  });

  it("renders with double border", () => {
    const result = table(
      [
        ["Name", "Role"],
        ["alice", "admin"],
      ],
      { border: "double" },
    );
    expect(result).toContain("╔");
    expect(result).toContain("╝");
    expect(result).toContain("║");
  });

  it("supports custom chars", () => {
    const result = table(
      [
        ["A", "B"],
        ["1", "2"],
      ],
      {
        chars: {
          top: "=",
          topLeft: "+",
          topMid: "+",
          topRight: "+",
          bottom: "=",
          bottomLeft: "+",
          bottomMid: "+",
          bottomRight: "+",
          left: "|",
          right: "|",
          vertical: "|",
          leftMid: "+",
          rightMid: "+",
          horizontal: "=",
          cross: "+",
        },
      },
    );
    expect(result).toContain("+");
    expect(result).toContain("=");
    expect(result).toContain("|");
  });

  it("honors custom chars with simple borders", () => {
    const result = table(
      [
        ["A", "B"],
        ["1", "2"],
      ],
      {
        border: "simple",
        chars: {
          vertical: " ~ ",
          horizontal: "=",
          cross: "=+=",
        },
      },
    );
    expect(result).toContain("A ~ B");
    expect(result).toContain("=+=");
  });

  it("supports rowSeparators: false (no row separators)", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
      rowSeparators: false,
    });
    const lines = result.split("\n");
    // With compact, there should be no mid-lines between data rows
    // header-separator + top + header + mid + 3 data rows + bottom = 7 lines
    // Without compact: top + header + mid + row + mid + row + mid + row + bottom = 9
    const midLines = lines.filter((l) => l.includes("├"));
    expect(midLines.length).toBe(1); // only after header
  });

  it("defaults to no row separators", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
    });
    const lines = result.split("\n");
    const midLines = lines.filter((l) => l.includes("├"));
    expect(midLines.length).toBe(1); // only after header
  });

  it("supports rowSeparators: true", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
      rowSeparators: true,
    });
    const lines = result.split("\n");
    const midLines = lines.filter((l) => l.includes("├"));
    // After header + between each data row = 1 + 2 = 3
    expect(midLines.length).toBe(3);
  });

  it("aligns each column by its own ColumnSpec", () => {
    const result = table(
      [
        { a: "1", b: "hello" },
        { a: "100", b: "hi" },
      ],
      {
        columns: [
          { key: "a", align: "right" },
          { key: "b", align: "center" },
        ],
      },
    );
    const lines = result.split("\n");
    // First data row: "1" should be right-aligned (leading spaces)
    const line = lines.find((l) => l.includes("1") && !l.includes("100"));
    expect(line).toBeDefined();
    if (line) {
      const idx = line.indexOf("1");
      expect(idx).toBeGreaterThan(0); // has leading space
    }
    expect(lines.slice(1)).toEqual(["  1  hello", "100   hi  "]);
  });

  it("supports ColumnSpec.width (fixed content width, padding excluded)", () => {
    const result = table([{ name: "alice" }], {
      columns: [{ key: "name", width: 20 }],
      border: "single",
    });
    const lines = result.split("\n");
    // Top border is the 20-cell content plus one cell of padding on each side
    const topLine = lines[0];
    expect(topLine.length).toBe(24); // ┌ + 22 + ┐
  });

  it("supports custom paddingLeft and paddingRight", () => {
    const result = table([{ x: "hi" }], {
      columns: ["x"],
      border: "single",
      paddingLeft: 3,
      paddingRight: 3,
    });
    // Cell content should have 3 spaces on each side
    const dataLine = result.split("\n").find((l) => l.includes("hi"));
    expect(dataLine).toBeDefined();
    if (dataLine) {
      expect(dataLine).toContain("│   hi   │");
    }
  });

  it("supports a custom ellipsis", () => {
    const result = table([{ name: "alexander" }], {
      columns: [{ key: "name", maxWidth: 5 }],
      ellipsis: "..",
    });
    expect(result).toContain("..");
    expect(result).not.toContain("…");
  });

  it("preserves ANSI color when truncating cells", () => {
    setColorEnabled(true);
    const result = table([{ name: color.red("alexander") }], {
      columns: [{ key: "name", maxWidth: 5 }],
    });
    expect(result).toContain("\x1b[31m");
    expect(stripAnsi(result)).toContain("alex…");
  });

  it("does not split ZWJ emoji graphemes when truncating cells", () => {
    const result = table([{ icon: "❤️‍🔥abcdef" }], {
      columns: [{ key: "icon", maxWidth: 3 }],
    });
    expect(stripAnsi(result)).toContain("❤️‍🔥…");
  });

  it("accepts the documented grey border colour", () => {
    let result = "";
    expect(() => {
      result = table([{ a: 1 }], { border: "single", borderStyle: "grey" });
    }).not.toThrow();
    expect(result).toContain("1");
  });

  it("keeps columns aligned when a cell contains a control character", () => {
    const withCtrl = table([{ v: "a\x07b" }, { v: "xy" }], { columns: ["v"], border: "single" });
    const withoutCtrl = table([{ v: "ab" }, { v: "xy" }], { columns: ["v"], border: "single" });
    const stripCtrl = (s: string) => s.replaceAll(String.fromCharCode(7), "");
    expect(stripCtrl(withCtrl)).toBe(withoutCtrl);
  });

  it("strips non-SGR escapes and C0 controls from cell content", () => {
    // A standalone BEL and a clear-screen CSI must not reach the rendered output.
    const result = table([{ v: "\x07x\x1b[2Jy" }], { columns: ["v"], border: "single" });
    expect(result).not.toContain("\x1b[2J");
    expect(result).not.toContain("\x07");
    expect(result).toContain("xy");
  });

  it("sanitizes inferred and explicit header labels", () => {
    const hostileKey = "na\x07me\x1b[2J";
    const inferred = table([{ [hostileKey]: "Alice" }], { border: "single" });
    expect(inferred).not.toContain("\x07");
    expect(inferred).not.toContain("\x1b[2J");
    expect(inferred).toContain("name");

    const explicit = table([[1]], {
      columns: [{ key: "value", label: "la\x1b]2;spoofed\x07bel" }],
      border: "single",
    });
    expect(explicit).not.toContain("\x1b]2;");
    expect(explicit).toContain("label");

    const hostileColumn = table([[1]], { columns: ["va\x1b]2;spoofed\x07lue"], border: "single" });
    expect(hostileColumn).not.toContain("\x1b]2;");
    expect(hostileColumn).toContain("value");
  });

  it("preserves SGR color sequences in cell content while sanitizing controls", () => {
    setColorEnabled(true);
    const result = table([{ v: `${color.red("hi")}\x07` }], { columns: ["v"], border: "single" });
    expect(result).toContain("\x1b[31m"); // SGR color kept
    expect(result).not.toContain("\x07"); // BEL stripped
    expect(stripAnsi(result)).toContain("hi");
  });

  it("closes an unclosed SGR sequence before the table frame", () => {
    const result = table([{ value: "\x1b[31mred" }], { border: "single" });
    const open = result.indexOf("\x1b[31m");
    const reset = result.indexOf("\x1b[39m", open);
    const borderAfterReset = result.indexOf("│", reset);

    expect(open).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(-1);
    expect(borderAfterReset).toBeGreaterThan(reset);
    expect(result.slice(reset + "\x1b[39m".length, borderAfterReset)).not.toContain("\x1b");
  });

  it("closes an unclosed OSC 8 hyperlink before the table frame", () => {
    const openLink = "\x1b]8;;https://example.invalid\x1b\\linked";
    const result = table([{ value: openLink }], { border: "single" });
    const closeLink = "\x1b]8;;\x1b\\";
    const openIndex = result.indexOf(openLink);
    const closeIndex = result.indexOf(closeLink, openIndex + openLink.length);
    const borderAfterClose = result.indexOf("│", closeIndex);

    expect(openIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(-1);
    expect(borderAfterClose).toBeGreaterThan(closeIndex);
    expect(result.slice(closeIndex + closeLink.length, borderAfterClose)).not.toContain("\x1b");
  });

  it("keeps a framed table rectangular at the narrowest maxWidth", () => {
    const result = table([{ name: "alexander" }], {
      columns: [{ key: "name", maxWidth: 1 }],
      border: "single",
    });
    const widths = new Set(result.split("\n").map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it("normalizes ragged array rows to the widest row", () => {
    const result = table([["A"], ["one"], ["two", "extra"]], { border: "single" });
    const widths = new Set(result.split("\n").map((line) => stringWidth(line)));
    expect(widths.size).toBe(1);
    expect(result).toContain("extra");
  });

  it("handles row counts above the engine argument-spread limit", () => {
    const rows = Array.from({ length: 150_000 }, () => ["x"]);
    let result = "";
    expect(() => {
      result = table(rows, { header: false });
    }).not.toThrow();
    expect(result.startsWith("x")).toBe(true);
  });

  it("normalizes leading, middle, and trailing holes in outer array data", () => {
    const rows = new Array<string[]>(6);
    rows[1] = ["Header"];
    rows[3] = ["one"];
    rows[4] = ["two", "extra"];

    let result = "";
    expect(() => {
      result = table(rows, { border: "single" });
    }).not.toThrow();
    expect(result).toContain("Header");
    expect(result).toContain("one");
    expect(result).toContain("extra");
  });

  it("normalizes holes in outer object-array data", () => {
    const rows = new Array<Record<string, unknown>>(5);
    rows[1] = { name: "one" };
    rows[3] = { name: "two", detail: "extra" };

    let result = "";
    expect(() => {
      result = table(rows, { border: "single" });
    }).not.toThrow();
    expect(result).toContain("one");
    expect(result).toContain("two");
    expect(result).toContain("extra");
  });

  it("never lets a wide truncation marker exceed maxWidth", () => {
    const result = table([{ name: "abcdef" }], {
      columns: [{ key: "name", maxWidth: 1 }],
      ellipsis: "...",
      border: "single",
    });
    const dataLine = result.split("\n").find((line) => line.includes("."));
    expect(dataLine).toBeDefined();
    expect(stripAnsi(dataLine ?? "")).not.toContain("...");
  });

  it("renders a column that no ColumnSpec describes with the defaults", () => {
    const result = table(
      [
        { a: "1", b: "x" },
        { a: "100", b: "y" },
      ],
      {
        columns: [{ key: "a", align: "right" }, "b"],
      },
    );
    expect(result.split("\n").slice(1)).toEqual(["  1  x", "100  y"]);
  });
});

describe("untrusted table decoration", () => {
  it("strips control sequences from the truncate marker and border characters", () => {
    const marked = table([{ a: "abcdefghij" }], {
      columns: [{ key: "a", width: 6 }],
      ellipsis: "\x1b[2J~",
    });
    expect(marked).not.toContain("\x1b[2J");

    const bordered = table([{ a: "x" }], { chars: { top: "\x1b[2J-" } });
    expect(bordered).not.toContain("\x1b[2J");
  });
});

describe("per-column settings from untrusted keys", () => {
  it("ignores values inherited from Object.prototype", () => {
    const rendered = table([{ constructor: "value", toString: "other" }], {});
    // An unguarded lookup returns Object.prototype's own members here and
    // renders a function body as the header label or alignment.
    expect(rendered).not.toContain("native code");
    expect(rendered).toContain("constructor");
    expect(rendered).toContain("value");
  });
});

describe("table input hardening", () => {
  afterEach(() => {
    setColorEnabled("auto");
  });

  it("renders a missing key as an empty cell without widening the column", () => {
    const rows = [{ constructor: "own" }, {}] as Record<string, unknown>[];
    for (const border of ["none", "simple", "single"] as const) {
      const lines = table(rows, { border }).split("\n");
      expect(lines.join("\n")).not.toContain("native code");
      expect(new Set(lines.map(stringWidth)).size).toBe(1);
    }
    const proto = table([JSON.parse('{"__proto__":"own","a":1}'), { a: 2 }], { columns: ["a"] });
    expect(proto).not.toContain("[object Object]");
    const named = table([{ a: 1 }], { columns: ["a", "toString", "hasOwnProperty"] });
    expect(named).not.toContain("native code");
  });

  it("rejects protocol names as style names instead of resolving them", () => {
    setColorEnabled(true);
    for (const name of ["toString", "constructor", "red.constructor", "valueOf"]) {
      expect(() => table([{ a: "x" }], { headerStyle: name as never })).toThrow(RangeError);
      expect(() => table([{ a: "x" }], { borderStyle: name as never })).toThrow(RangeError);
    }
  });

  it("survives huge widths and padding", () => {
    const rows = [{ header: "abc" }, { header: "de" }];
    for (const border of ["none", "simple", "single"] as const) {
      expect(() =>
        table(rows, {
          border,
          columns: [{ key: "header", width: 1e10 }],
          gap: 1e10,
          paddingLeft: 1e10,
          paddingRight: 2 ** 32,
        }),
      ).not.toThrow();
    }
  });

  it("converts cell values String() cannot convert", () => {
    const throwing = {
      toString() {
        throw new Error("no");
      },
    };
    const out = table([{ a: Object.create(null), b: throwing }], { border: "single" });
    expect(out).toContain("[object Object]");
  });

  it("renders a null or missing object row as a full-width empty row", () => {
    const rows = [{ a: "x", b: "y" }, null, { a: "z", b: "w" }] as unknown as Record<
      string,
      unknown
    >[];
    for (const border of ["none", "simple", "single"] as const) {
      const lines = table(rows, { border }).split("\n");
      expect(new Set(lines.map(stringWidth)).size).toBe(1);
    }
    const boxed = table(rows, { border: "single" }).split("\n");
    expect(boxed.filter((l) => l.startsWith("│")).length).toBe(4);
    expect(boxed[4].split("│").length).toBe(boxed[3].split("│").length);
  });
});

describe("borderless and simple modes honour every table option", () => {
  afterEach(() => {
    setColorEnabled("auto");
  });

  it("colors the separator glyphs of a simple table", () => {
    setColorEnabled(true);
    const out = table([["a"]], {
      border: "simple",
      borderStyle: "red",
    });
    const separator = out.split("\n")[1];
    expect(separator.startsWith("\x1b[31m")).toBe(true);
    expect(separator.endsWith("\x1b[39m")).toBe(true);
  });

  it("separates data rows of a simple table with rowSeparators", () => {
    const compact = table([["a"], ["b"]], { border: "simple", header: false });
    const spaced = table([["a"], ["b"]], {
      border: "simple",
      header: false,
      rowSeparators: true,
    });
    expect(compact.split("\n")).toHaveLength(2);
    expect(spaced.split("\n")).toHaveLength(3);
    expect(spaced.split("\n")[1]).toMatch(/^-+$/);
  });
});

describe("column normalization", () => {
  it("uses a bare string column as the header for array data", () => {
    const out = table([["x"]], { columns: ["Header"] });
    expect(out.split("\n")).toEqual(["Header", "x     "]);
  });

  it("falls back to key for a spec without a label in array data", () => {
    const out = table([["x"]], { columns: [{ key: "k" }] });
    expect(out.split("\n")).toEqual(["k", "x"]);
  });

  it("treats the first array row as the header when no columns are given", () => {
    const out = table([["H"], ["x"]]);
    expect(out.split("\n")).toEqual(["H", "x"]);
  });

  it("selects and orders object columns by key", () => {
    const out = table([{ a: "1", b: "2", c: "3" }], { columns: ["c", { key: "a", label: "A" }] });
    expect(out.split("\n")).toEqual(["c  A", "3  1"]);
  });

  it("maps every TableChars key to its position in a custom frame", () => {
    const out = table(
      [
        ["1", "2"],
        ["3", "4"],
      ],
      {
        columns: ["a", "b"],
        chars: {
          top: "t",
          topLeft: "1",
          topMid: "2",
          topRight: "3",
          bottom: "b",
          bottomLeft: "4",
          bottomMid: "5",
          bottomRight: "6",
          left: "L",
          right: "R",
          vertical: "V",
          leftMid: "7",
          rightMid: "8",
          horizontal: "h",
          cross: "9",
        },
      },
    );
    expect(out.split("\n")).toEqual([
      "1ttt2ttt3",
      "L a V b R",
      "7hhh9hhh8",
      "L 1 V 2 R",
      "L 3 V 4 R",
      "4bbb5bbb6",
    ]);
  });

  it("ignores the retired kebab-case chars keys", () => {
    const out = table([{ a: "1" }], {
      border: "single",
      chars: { "top-left": "X" } as never,
    });
    expect(out).not.toContain("X");
  });

  it("separates borderless columns by gap", () => {
    const out = table([["a", "b"]], { header: false, gap: 4 });
    expect(out).toBe("a    b");
  });

  it("defaults gap to 2 and bordered padding to 1, borderless padding to 0", () => {
    expect(table([["a", "b"]], { header: false })).toBe("a  b");
    expect(table([["a"]], { header: false, border: "single" }).split("\n")[1]).toBe("│ a │");
  });

  it("ignores unknown option keys at run time", () => {
    expect(table([{ a: "1" }], { retired: true } as never)).toBe(table([{ a: "1" }]));
  });
});

describe("table colour follows the stream", () => {
  const rows = [{ a: "x" }];
  const bold = "\x1b[1m";

  beforeEach(() => {
    setColorEnabled("auto");
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("FORCE_COLOR", "");
    vi.stubEnv("TERM", "xterm");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setColorEnabled("auto");
  });

  it("colours the header when the stream is a TTY", () => {
    expect(table(rows, { stream: { isTTY: true } as unknown as Writable })).toContain(bold);
  });

  it("does not colour when the stream is not a TTY", () => {
    expect(table(rows, { stream: { isTTY: false } as unknown as Writable })).not.toContain("\x1b[");
  });

  it("defaults to process.stdout", () => {
    expect(table(rows)).toBe(table(rows, { stream: process.stdout }));
  });

  it("returns a string and never writes to the stream", () => {
    const write = vi.fn();
    const out = table(rows, { stream: { isTTY: true, write } as unknown as Writable });
    expect(typeof out).toBe("string");
    expect(write).not.toHaveBeenCalled();
  });

  it("applies headerStyle and borderStyle chains", () => {
    const out = table(rows, {
      border: "single",
      headerStyle: "red.underline",
      borderStyle: "cyan",
      stream: { isTTY: true } as unknown as Writable,
    });
    expect(out).toContain("\x1b[31m\x1b[4m");
    expect(out).toContain("\x1b[36m");
  });

  it("leaves the header plain with headerStyle: none", () => {
    const out = table(rows, {
      headerStyle: "none",
      stream: { isTTY: true } as unknown as Writable,
    });
    expect(out).not.toContain("\x1b[");
  });
});

describe("table argument validation", () => {
  const data = [{ a: "x" }];
  const withWidth = (width: unknown) => ({ columns: [{ key: "a", width }] }) as never;
  const withMaxWidth = (maxWidth: unknown) => ({ columns: [{ key: "a", maxWidth }] }) as never;

  const expectRange = (fn: () => unknown) => {
    expect(fn).toThrow(RangeError);
    expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
  };
  const expectType = (fn: () => unknown) => {
    expect(fn).toThrow(TypeError);
    expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  };

  describe("ColumnSpec.width", () => {
    test.each([0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5])(
      "rejects %s",
      (value) => expectRange(() => table(data, withWidth(value))),
    );
    test.each([null, true, "3"])("rejects the non-number %s", (value) =>
      expectType(() => table(data, withWidth(value))),
    );
    it("accepts a positive integer, 2^31 and 2^32, and an omitted value", () => {
      expect(() => table(data, withWidth(3))).not.toThrow();
      expect(() => table(data, withWidth(2 ** 31))).not.toThrow();
      expect(() => table(data, withWidth(2 ** 32))).not.toThrow();
      expect(() => table(data, withWidth(undefined))).not.toThrow();
    });
  });

  describe("ColumnSpec.maxWidth", () => {
    test.each([0, -0, -1, Number.NaN, Number.NEGATIVE_INFINITY, 0.5])("rejects %s", (value) =>
      expectRange(() => table(data, withMaxWidth(value))),
    );
    test.each([null, false, "3"])("rejects the non-number %s", (value) =>
      expectType(() => table(data, withMaxWidth(value))),
    );
    it("accepts Infinity as no limit, 2^31 and an omitted value", () => {
      expect(table([{ a: "abcdefgh" }], withMaxWidth(Number.POSITIVE_INFINITY))).toContain(
        "abcdefgh",
      );
      expect(() => table(data, withMaxWidth(2 ** 31))).not.toThrow();
      expect(() => table(data, withMaxWidth(undefined))).not.toThrow();
    });
  });

  describe.each(["gap", "paddingLeft", "paddingRight"] as const)("%s", (name) => {
    const opts = (value: unknown) => ({ [name]: value }) as never;
    test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, 0.5])(
      "rejects %s",
      (value) => expectRange(() => table(data, opts(value))),
    );
    test.each([null, true, "1"])("rejects the non-number %s", (value) =>
      expectType(() => table(data, opts(value))),
    );
    it("accepts 0, -0, 2^31, 2^32 and an omitted value", () => {
      for (const value of [0, -0, 2 ** 31, 2 ** 32, undefined]) {
        expect(() => table(data, opts(value))).not.toThrow();
      }
    });
  });

  describe("style names", () => {
    test.each(["headerStyle", "borderStyle"] as const)("%s rejects unknown names", (name) => {
      for (const value of ["nope", "red.nope", "", "赤", "toString", "red."]) {
        expectRange(() => table(data, { [name]: value } as never));
      }
    });
    test.each(["headerStyle", "borderStyle"] as const)("%s rejects non-strings", (name) => {
      for (const value of [null, 1, true, {}]) {
        expectType(() => table(data, { [name]: value } as never));
      }
    });
    it("validates every dot segment", () => {
      expect(() => table(data, { headerStyle: "red.bold.underline" })).not.toThrow();
      expectRange(() => table(data, { headerStyle: "red.bold.nope" as never }));
    });
    it("accepts none for headerStyle only", () => {
      expect(() => table(data, { headerStyle: "none" })).not.toThrow();
      expectRange(() => table(data, { borderStyle: "none" as never }));
    });
    it("validates before looking at the data", () => {
      expectRange(() => table([], { headerStyle: "nope" as never }));
    });
  });

  describe("border names", () => {
    test.each(["nope", "", "線", "toString", "SINGLE"])("rejects %s", (value) =>
      expectRange(() => table(data, { border: value as never })),
    );
    test.each([null, 1, true])("rejects the non-string %s", (value) =>
      expectType(() => table(data, { border: value as never })),
    );
    it("accepts every preset", () => {
      for (const border of ["none", "simple", "rounded", "single", "double", "custom"] as const) {
        expect(() => table(data, { border })).not.toThrow();
      }
    });
  });

  describe("columns", () => {
    it("rejects an undefined or null entry", () => {
      expectType(() => table(data, { columns: ["a", undefined] } as never));
      expectType(() => table(data, { columns: [null] } as never));
    });
    it("rejects an entry that is neither a string nor a spec with a string key", () => {
      expectType(() => table(data, { columns: [1] } as never));
      expectType(() => table(data, { columns: [{}] } as never));
      expectType(() => table(data, { columns: [{ key: 1 }] } as never));
    });
    it("rejects a non-array", () => {
      expectType(() => table(data, { columns: "a" } as never));
    });
    it("reports a bad width inside a spec among valid ones", () => {
      expectRange(() => table(data, { columns: ["a", { key: "a", width: 0 }] }));
    });
  });
});

describe("table truncation never hands truncateAnsi a rejected width", () => {
  it("renders an empty column, a one-cell column and every border without throwing", () => {
    for (const border of ["none", "simple", "single", "double", "rounded"] as const) {
      expect(() => table([{ a: "" }], { border })).not.toThrow();
      expect(() =>
        table([{ a: "abcdef" }], { border, columns: [{ key: "a", maxWidth: 1 }] }),
      ).not.toThrow();
      expect(() =>
        table([{ a: "abcdef" }], { border, columns: [{ key: "a", width: 1 }] }),
      ).not.toThrow();
    }
  });
});

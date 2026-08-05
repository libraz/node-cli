import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  color,
  resetColorEnabled,
  setColorEnabled,
  stringWidth,
  stripAnsi,
} from "../src/output/color.js";
import { table } from "../src/output/table.js";

describe("table", () => {
  beforeEach(() => {
    setColorEnabled(false);
  });

  afterEach(() => {
    resetColorEnabled();
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

  it("uses headerLabels", () => {
    const result = table([{ name: "alice" }], {
      columns: ["name"],
      headerLabels: { name: "Full Name" },
    });
    expect(result).toContain("Full Name");
  });

  it("uses headerLabels for array input", () => {
    const result = table(
      [
        ["name", "role"],
        ["alice", "admin"],
      ],
      { headerLabels: { name: "Full Name", role: "Access" } },
    );
    expect(result).toContain("Full Name");
    expect(result).toContain("Access");
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
      columns: ["val"],
      align: { val: "right" },
    });
    const lines = result.split("\n");
    // Right-aligned numbers should have leading spaces
    const dataLine = lines.find((l) => l.includes("1") && !l.includes("100"));
    expect(dataLine).toBeDefined();
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

  it("normalizes negative and non-finite padding", () => {
    expect(() => table([["Name"], ["alice"]], { padding: -1 })).not.toThrow();
    expect(() =>
      table([["Name"], ["alice"]], {
        border: "single",
        style: { "padding-left": -1, "padding-right": Number.POSITIVE_INFINITY },
      }),
    ).not.toThrow();
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
          "top-left": "+",
          "top-mid": "+",
          "top-right": "+",
          bottom: "=",
          "bottom-left": "+",
          "bottom-mid": "+",
          "bottom-right": "+",
          left: "|",
          right: "|",
          middle: "|",
          "left-mid": "+",
          "right-mid": "+",
          mid: "=",
          "mid-mid": "+",
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
          middle: " ~ ",
          mid: "=",
          "mid-mid": "=+=",
        },
      },
    );
    expect(result).toContain("A ~ B");
    expect(result).toContain("=+=");
  });

  it("supports compact mode (no row separators)", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
      style: { compact: true },
    });
    const lines = result.split("\n");
    // With compact, there should be no mid-lines between data rows
    // header-separator + top + header + mid + 3 data rows + bottom = 7 lines
    // Without compact: top + header + mid + row + mid + row + mid + row + bottom = 9
    const midLines = lines.filter((l) => l.includes("├"));
    expect(midLines.length).toBe(1); // only after header
  });

  it("defaults to compact mode (no row separators)", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
    });
    const lines = result.split("\n");
    const midLines = lines.filter((l) => l.includes("├"));
    expect(midLines.length).toBe(1); // only after header
  });

  it("supports non-compact mode with row separators", () => {
    const result = table([{ name: "alice" }, { name: "bob" }, { name: "charlie" }], {
      columns: ["name"],
      border: "single",
      style: { compact: false },
    });
    const lines = result.split("\n");
    const midLines = lines.filter((l) => l.includes("├"));
    // After header + between each data row = 1 + 2 = 3
    expect(midLines.length).toBe(3);
  });

  it("supports colAligns (array-based alignment)", () => {
    const result = table(
      [
        { a: "1", b: "hello" },
        { a: "100", b: "hi" },
      ],
      { columns: ["a", "b"], colAligns: ["right", "center"] },
    );
    const lines = result.split("\n");
    // First data row: "1" should be right-aligned (leading spaces)
    const line = lines.find((l) => l.includes("1") && !l.includes("100"));
    expect(line).toBeDefined();
    if (line) {
      const idx = line.indexOf("1");
      expect(idx).toBeGreaterThan(0); // has leading space
    }
  });

  it("supports colWidths (fixed column widths)", () => {
    const result = table([{ name: "alice" }], {
      columns: ["name"],
      border: "single",
      colWidths: [20],
    });
    const lines = result.split("\n");
    // Top border should be 20 chars wide (including padding)
    const topLine = lines[0];
    expect(topLine.length).toBe(22); // ┌ + 20 + ┐
  });

  it("supports custom padding-left and padding-right", () => {
    const result = table([{ x: "hi" }], {
      columns: ["x"],
      border: "single",
      style: { "padding-left": 3, "padding-right": 3 },
    });
    // Cell content should have 3 spaces on each side
    const dataLine = result.split("\n").find((l) => l.includes("hi"));
    expect(dataLine).toBeDefined();
    if (dataLine) {
      expect(dataLine).toContain("│   hi   │");
    }
  });

  it("supports custom truncate character", () => {
    const result = table([{ name: "alexander" }], {
      columns: ["name"],
      maxWidth: { name: 5 },
      truncate: "..",
    });
    expect(result).toContain("..");
    expect(result).not.toContain("…");
  });

  it("preserves ANSI color when truncating cells", () => {
    setColorEnabled(true);
    const result = table([{ name: color.red("alexander") }], {
      columns: ["name"],
      maxWidth: { name: 5 },
    });
    expect(result).toContain("\x1b[31m");
    expect(stripAnsi(result)).toContain("alex…");
  });

  it("does not split ZWJ emoji graphemes when truncating cells", () => {
    const result = table([{ icon: "❤️‍🔥abcdef" }], {
      columns: ["icon"],
      maxWidth: { icon: 3 },
    });
    expect(stripAnsi(result)).toContain("❤️‍🔥…");
  });

  it("does not throw for documented grey border style", () => {
    let result = "";
    expect(() => {
      result = table([{ a: 1 }], { border: "single", style: { border: "grey" } });
    }).not.toThrow();
    expect(result).toContain("1");
  });

  it("does not throw for an unknown border style", () => {
    let result = "";
    expect(() => {
      result = table([{ a: 1 }], { border: "single", style: { border: "notacolor" } });
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
      columns: ["va\x1b]2;spoofed\x07lue"],
      headerLabels: { value: "ignored" },
      border: "single",
    });
    expect(explicit).not.toContain("\x1b]2;");
    expect(explicit).toContain("ignored");
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
    const reset = result.indexOf("\x1b[0m", open);
    const borderAfterReset = result.indexOf("│", reset);

    expect(open).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(-1);
    expect(borderAfterReset).toBeGreaterThan(reset);
    expect(result.slice(reset + "\x1b[0m".length, borderAfterReset)).not.toContain("\x1b");
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

  it("handles maxWidth of 0 without throwing or overflowing", () => {
    let result = "";
    expect(() => {
      result = table([{ name: "alexander" }], {
        columns: ["name"],
        border: "single",
        maxWidth: { name: 0 },
      });
    }).not.toThrow();
    const lines = result.split("\n");
    // All bordered lines must share the same display width (no overflow).
    const widths = new Set(lines.map((l) => l.length));
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
      columns: ["name"],
      maxWidth: { name: 1 },
      truncate: "...",
      border: "single",
    });
    const dataLine = result.split("\n").find((line) => line.includes("."));
    expect(dataLine).toBeDefined();
    expect(stripAnsi(dataLine ?? "")).not.toContain("...");
  });

  it("colAligns takes precedence over align", () => {
    const result = table([{ val: "1" }, { val: "100" }], {
      columns: ["val"],
      align: { val: "left" },
      colAligns: ["right"],
    });
    const lines = result.split("\n");
    const line = lines.find((l) => l.includes("1") && !l.includes("100"));
    expect(line).toBeDefined();
    if (line) {
      const idx = line.indexOf("1");
      expect(idx).toBeGreaterThan(0); // right-aligned despite align saying left
    }
  });
});

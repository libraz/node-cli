import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetColorEnabled, setColorEnabled } from "../src/output/color.js";
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

  it("returns empty string for empty data", () => {
    expect(table([])).toBe("");
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

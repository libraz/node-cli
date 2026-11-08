import { beforeEach, describe, expect, it, vi } from "vitest";

const measured: string[] = [];

vi.mock("../src/output/color.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/output/color.js")>();
  return {
    ...actual,
    stringWidth: (text: string) => {
      measured.push(text);
      return actual.stringWidth(text);
    },
  };
});

const { table } = await import("../src/output/table.js");

// Grapheme segmentation dominates the cost of rendering a non-ASCII table, so a
// cell must not be measured once per render pass.
describe("table cell measurement", () => {
  beforeEach(() => {
    measured.length = 0;
  });

  it("measures every cell and header label exactly once when nothing is truncated", () => {
    const rows = [
      ["日本語のセル", "混在 mixed"],
      ["🎉🎉", "ascii"],
      ["한국어", "value"],
    ];
    table(rows, { header: true });

    // The first row becomes the header, so two labels plus four data cells.
    expect(measured).toHaveLength(6);
    expect(new Set(measured).size).toBe(measured.length);
  });

  it("measures a truncated cell once more, and only that cell", () => {
    const rows = [
      { label: "とても長い日本語の文字列", value: "短い" },
      { label: "短い", value: "短い" },
    ];
    table(rows, { columns: [{ key: "label", maxWidth: 6 }, "value"] });

    const truncatedOnce = measured.filter((text) => text === "とても長い日本語の文字列");
    expect(truncatedOnce).toHaveLength(1);
    // Two labels, four cells, and one re-measurement of the reshaped cell.
    expect(measured).toHaveLength(7);
  });

  it("does not measure header labels when the header is suppressed", () => {
    table([["日本語", "ascii"]], { header: false });

    expect(measured).toEqual(["日本語", "ascii"]);
  });
});

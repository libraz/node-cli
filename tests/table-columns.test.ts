import { describe, expect, it, test } from "vitest";
import { type ColumnSpec, stringWidth, table } from "../src/index.js";

// Column model (pairwise, strength 2):
//   dataShape   {objects, arrays}
//   columnEntry {string, bare, labelled}
//     bare      = `{ key }` for objects, `{}` for arrays (arrays have no key)
//     labelled  = `{ key, label }` for objects, `{ label }` for arrays
//   width       {none, valid}
//   maxWidth    {none, valid, infinity}
//   border      {none, simple, rounded}
// Constraint: columnEntry = string implies width and maxWidth = none, because a
//   bare string carries no per-column settings.
// Rows come from a greedy cover of the constrained product (seed: none, 11 rows);
//   the coverage test below recomputes the pair set so a hand edit cannot drop a pair.
// Expected output follows the column rules: the label is `label ?? key ?? ""`,
//   `width` and `maxWidth` both measure content (padding excluded), `width` wins
//   over `maxWidth`, and padding is added around the content.

type Shape = "objects" | "arrays";
type Entry = "string" | "bare" | "labelled";
type Width = "none" | "valid";
type MaxWidth = "none" | "valid" | "infinity";
type Border = "none" | "simple" | "rounded";
type Row = [Shape, Entry, Width, MaxWidth, Border];

const rows: Row[] = [
  ["objects", "string", "none", "none", "none"],
  ["objects", "bare", "valid", "valid", "simple"],
  ["arrays", "bare", "none", "infinity", "rounded"],
  ["arrays", "labelled", "valid", "none", "none"],
  ["objects", "labelled", "none", "valid", "rounded"],
  ["objects", "labelled", "none", "infinity", "simple"],
  ["arrays", "string", "none", "none", "simple"],
  ["objects", "bare", "valid", "none", "rounded"],
  ["objects", "bare", "valid", "infinity", "none"],
  ["arrays", "bare", "none", "valid", "none"],
  ["objects", "string", "none", "none", "rounded"],
];

describe("column model coverage", () => {
  it("covers every valid pair of factor values", () => {
    const levels: readonly (readonly string[])[] = [
      ["objects", "arrays"],
      ["string", "bare", "labelled"],
      ["none", "valid"],
      ["none", "valid", "infinity"],
      ["none", "simple", "rounded"],
    ];
    const valid = (r: readonly string[]) =>
      !(r[1] === "string" && (r[2] !== "none" || r[3] !== "none"));
    const key = (a: number, va: string, b: number, vb: string) => `${a}:${va}|${b}:${vb}`;
    const expected = new Set<string>();
    const product = (index: number, acc: string[]): void => {
      if (index === levels.length) {
        if (!valid(acc)) return;
        for (let a = 0; a < acc.length; a++)
          for (let b = a + 1; b < acc.length; b++) expected.add(key(a, acc[a], b, acc[b]));
        return;
      }
      for (const v of levels[index]) product(index + 1, [...acc, v]);
    };
    product(0, []);
    const covered = new Set<string>();
    for (const r of rows) {
      expect(valid(r)).toBe(true);
      for (let a = 0; a < r.length; a++)
        for (let b = a + 1; b < r.length; b++) covered.add(key(a, r[a], b, r[b]));
    }
    expect([...expected].filter((pair) => !covered.has(pair))).toEqual([]);
  });
});

const FIXED_WIDTH = 12;
const MAX_WIDTH = 5;
const LONG = "abcdefgh";

const fitTo = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, width - 1)}…`;
const alignIn = (text: string, width: number) => text + " ".repeat(width - text.length);

describe("column normalization", () => {
  test.each(rows)(
    "%s / %s / width %s / maxWidth %s / border %s",
    (shape, entry, width, maxWidth, border) => {
      const spec: Record<string, unknown> = {};
      if (shape === "objects") spec.key = "name";
      if (entry === "labelled") spec.label = "Label";
      if (width === "valid") spec.width = FIXED_WIDTH;
      if (maxWidth === "valid") spec.maxWidth = MAX_WIDTH;
      if (maxWidth === "infinity") spec.maxWidth = Number.POSITIVE_INFINITY;
      const columns = [entry === "string" ? "name" : spec] as never;
      const data = (
        shape === "objects" ? [{ name: "ab" }, { name: LONG }] : [["ab"], [LONG]]
      ) as never;

      const out = table(data, { columns, border });

      const pad = border === "rounded" ? 1 : 0;
      const contentWidth =
        width === "valid" ? FIXED_WIDTH : maxWidth === "valid" ? MAX_WIDTH : LONG.length;
      const label =
        entry === "labelled" ? "Label" : entry === "string" || shape === "objects" ? "name" : "";
      const cell = (text: string) =>
        " ".repeat(pad) + alignIn(fitTo(text, contentWidth), contentWidth) + " ".repeat(pad);
      const [head, ...body] = [label, "ab", LONG].map(cell);
      let expected: string[];
      if (border === "rounded") {
        const bar = "─".repeat(contentWidth + 2 * pad);
        expected = [
          `╭${bar}╮`,
          `│${head}│`,
          `├${bar}┤`,
          ...body.map((line) => `│${line}│`),
          `╰${bar}╯`,
        ];
      } else if (border === "simple") {
        expected = [head, "-".repeat(contentWidth), ...body];
      } else {
        expected = [head, ...body];
      }
      expect(out.split("\n")).toEqual(expected);
    },
  );
});

describe("ColumnSpec width units", () => {
  it("measures width as content for every border, padding excluded", () => {
    const sized = (border: "none" | "simple" | "single") =>
      table([["a"]], {
        border,
        header: false,
        columns: [{ width: 8 }],
        paddingLeft: 2,
        paddingRight: 2,
      }).split("\n");
    for (const border of ["none", "simple"] as const) {
      expect(stringWidth(sized(border)[0])).toBe(12);
    }
    expect(stringWidth(sized("single")[1])).toBe(14);
  });

  it("measures maxWidth as content too", () => {
    const out = table([{ a: "abcdefgh" }], {
      columns: [{ key: "a", maxWidth: 4 }],
      border: "single",
    });
    expect(out.split("\n")[3]).toBe("│ abc… │");
  });

  it("keeps a width of 1 as a one-cell column", () => {
    const out = table([{ a: "xyz" }], { columns: [{ key: "a", width: 1 }], border: "single" });
    expect(out.split("\n")[0]).toBe("┌───┐");
  });

  it("lets width win over maxWidth", () => {
    const out = table([{ a: "abcdefgh" }], { columns: [{ key: "a", width: 6, maxWidth: 3 }] });
    expect(out.split("\n")[1]).toBe("abcde…");
  });
});

describe("column entries at run time", () => {
  it("accepts array-row specs without a key and keys them by position", () => {
    const out = table(
      [
        ["x", "yy"],
        ["zzz", "w"],
      ],
      { columns: [{ label: "A", align: "right" }, "B"] },
    );
    expect(out.split("\n")).toEqual(["  A  B ", "  x  yy", "zzz  w "]);
  });

  it("falls back to an empty header for a keyless, unlabelled array column", () => {
    expect(table([["x"]], { columns: [{}] }).split("\n")).toEqual([" ", "x"]);
  });

  it("still ignores a key given to an array column", () => {
    const out = table([["x"]], { columns: [{ key: "k" } as ColumnSpec<string[]>] as never });
    expect(out.split("\n")).toEqual(["k", "x"]);
  });

  it("rejects an object-row spec without a key", () => {
    const fn = () => table([{ a: 1 }], { columns: [{ label: "A" }] as never });
    expect(fn).toThrow(TypeError);
    expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  it("rejects a non-string key on array rows too", () => {
    const fn = () => table([["x"]], { columns: [{ key: 1 }] as never });
    expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
  });

  it("renders interface and class instances", () => {
    interface Person {
      name: string;
      age: number;
    }
    const people: Person[] = [{ name: "Ann", age: 3 }];
    expect(table(people, { columns: ["name", { key: "age", label: "Age" }] }).split("\n")).toEqual([
      "name  Age",
      "Ann   3  ",
    ]);
    class Point {
      x = 1;
      y = 2;
    }
    expect(table([new Point()]).split("\n")).toEqual(["x  y", "1  2"]);
  });
});

describe("column and option argument validation", () => {
  const data = [{ a: "x" }];
  const code = (c: string) => expect.objectContaining({ code: c });
  const expectType = (fn: () => unknown, subject: string) => {
    expect(fn).toThrow(TypeError);
    expect(fn).toThrow(code("ERR_INVALID_ARG_TYPE"));
    expect(fn).toThrow(`The "${subject}" option of table() must be`);
  };
  const expectRange = (fn: () => unknown, subject: string) => {
    expect(fn).toThrow(RangeError);
    expect(fn).toThrow(code("ERR_INVALID_ARG_VALUE"));
    expect(fn).toThrow(`The "${subject}" option of table() must be`);
  };

  it("rejects an unknown align", () => {
    expectRange(
      () => table(data, { columns: [{ key: "a", align: "middle" }] as never }),
      "columns[0].align",
    );
  });
  it("rejects a non-string align and label", () => {
    expectType(
      () => table(data, { columns: [{ key: "a", align: 1 }] as never }),
      "columns[0].align",
    );
    expectType(
      () => table(data, { columns: [{ key: "a", label: 1 }] as never }),
      "columns[0].label",
    );
  });
  test.each(["header", "rowSeparators"] as const)("rejects a non-boolean %s", (name) => {
    for (const value of ["yes", 1, null]) {
      expectType(() => table(data, { [name]: value } as never), name);
    }
  });
  it("rejects a non-string ellipsis", () => {
    for (const value of [1, null, true, {}]) {
      expectType(() => table(data, { ellipsis: value } as never), "ellipsis");
    }
  });
  it("rejects a non-object chars and non-string glyphs", () => {
    expectType(() => table(data, { chars: "-" } as never), "chars");
    expectType(() => table(data, { chars: null } as never), "chars");
    expectType(() => table(data, { chars: { top: 1 } } as never), "chars.top");
    expectType(() => table(data, { chars: { left: null } } as never), "chars.left");
  });
  it("accepts undefined option values as omitted", () => {
    expect(() =>
      table(data, { header: undefined, ellipsis: undefined, chars: undefined, border: undefined }),
    ).not.toThrow();
  });
});

describe("chars glyph width", () => {
  const data = [{ a: "x" }];
  const glyphs = [
    "topMid",
    "topLeft",
    "topRight",
    "bottomMid",
    "bottomLeft",
    "bottomRight",
    "left",
    "leftMid",
    "right",
    "rightMid",
    "cross",
    "vertical",
  ] as const;
  const fills = ["top", "bottom", "horizontal"] as const;

  test.each([...glyphs, ...fills])("%s rejects a two-cell string", (name) => {
    const fn = () => table(data, { chars: { [name]: "==" } });
    expect(fn).toThrow(RangeError);
    expect(fn).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }));
    expect(fn).toThrow(`The "chars.${name}" option of table() must be`);
  });
  test.each([...glyphs, ...fills])("%s rejects a wide character", (name) => {
    expect(() => table(data, { chars: { [name]: "あ" } })).toThrow(RangeError);
  });
  test.each(glyphs)("%s rejects an empty string", (name) => {
    expect(() => table(data, { chars: { [name]: "" } })).toThrow(RangeError);
  });
  test.each(fills)("%s may be empty to omit the edge", (name) => {
    expect(() => table(data, { chars: { [name]: "" } })).not.toThrow();
  });
  it("lets a simple table use multi-cell separators", () => {
    const out = table([["a", "b"]], {
      border: "simple",
      header: false,
      chars: { vertical: " ~ " },
    });
    expect(out).toBe("a ~ b");
  });
  it("omits the top edge when top is empty", () => {
    const out = table(data, { border: "single", chars: { top: "" } });
    expect(out.split("\n")).toHaveLength(4);
  });
  it("accepts a single-cell glyph and measures after control sequences are dropped", () => {
    expect(() => table(data, { chars: { top: "=", topLeft: "\x1b[2J+" } })).not.toThrow();
  });
});

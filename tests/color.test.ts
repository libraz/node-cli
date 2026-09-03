import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  c,
  closeAnsiState,
  color,
  isColorEnabled,
  resetColorEnabled,
  sanitizeTerminalText,
  setColorEnabled,
  splitAnsi,
  splitGraphemes,
  streamIsTTY,
  stringWidth,
  stripAnsi,
  truncateAnsi,
} from "../src/output/color.js";

describe("color", () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  afterEach(() => {
    resetColorEnabled();
  });

  it("applies red style", () => {
    const result = color.red("hello");
    expect(result).toContain("\x1b[31m");
    expect(result).toContain("hello");
    expect(result).toContain("\x1b[39m");
  });

  it("applies bold style", () => {
    const result = color.bold("hello");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[22m");
  });

  it("chains styles", () => {
    const result = color.bold.red("hello");
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[31m");
    expect(stripAnsi(result)).toBe("hello");
  });

  it("closes an inner bold style before restoring an outer dim style", () => {
    const result = color.dim(`${color.bold("inner")} outer`);
    expect(result).toBe("\x1b[2m\x1b[1minner\x1b[22m\x1b[2m outer\x1b[22m");
  });

  it("returns plain text when disabled", () => {
    setColorEnabled(false);
    expect(color.red("hello")).toBe("hello");
  });

  it("throws on unknown style", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing unknown style access
    expect(() => (color as any).foobar("test")).toThrow("Unknown style");
  });

  it("does not expose inherited Function or Object members as styles", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing proxy property access
    expect(() => (color.red as any).name).toThrow("Unknown style: name");
    // biome-ignore lint/suspicious/noExplicitAny: testing proxy property access
    expect(() => (color as any).foobar).toThrow("Unknown style: foobar");
  });

  it("survives the protocol properties the runtime reads on its own", async () => {
    expect(String(color.red)).toBeTypeOf("string");
    expect(`${color.red.bold}`).toBeTypeOf("string");
    // A colorizer carried across an await is read for `then`; a crash there
    // would surface far from the code that passed it along.
    await expect(Promise.resolve(color.red)).resolves.toBeTypeOf("function");
    expect(() => JSON.stringify({ style: color.red })).not.toThrow();
    // biome-ignore lint/suspicious/noExplicitAny: testing proxy property access
    expect((color as any).then).toBeUndefined();
  });
});

describe("color environment detection", () => {
  const stream = { isTTY: true } as NodeJS.WritableStream;
  const saved = {
    noColor: process.env.NO_COLOR,
    forceColor: process.env.FORCE_COLOR,
    term: process.env.TERM,
  };

  beforeEach(() => {
    resetColorEnabled();
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.TERM;
  });

  afterEach(() => {
    resetColorEnabled();
    if (saved.noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved.noColor;
    if (saved.forceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = saved.forceColor;
    if (saved.term === undefined) delete process.env.TERM;
    else process.env.TERM = saved.term;
  });

  it("disables color for NO_COLOR and TERM=dumb", () => {
    process.env.NO_COLOR = "1";
    expect(isColorEnabled(stream)).toBe(false);

    delete process.env.NO_COLOR;
    process.env.TERM = "dumb";
    expect(isColorEnabled(stream)).toBe(false);
  });

  it("treats FORCE_COLOR=0 and FORCE_COLOR=false as off", () => {
    for (const value of ["0", "false"]) {
      process.env.FORCE_COLOR = value;
      expect(isColorEnabled(stream)).toBe(false);
    }
  });

  it("does not let an empty NO_COLOR decide on its own", () => {
    // An empty NO_COLOR is not set; resolution continues to FORCE_COLOR.
    process.env.NO_COLOR = "";
    process.env.FORCE_COLOR = "1";
    expect(isColorEnabled(stream)).toBe(true);
  });
});

describe("c (template tag)", () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  afterEach(() => {
    resetColorEnabled();
  });

  it("applies inline styles", () => {
    const result = c`{red error}`;
    expect(result).toContain("\x1b[31m");
    expect(stripAnsi(result)).toBe("error");
  });

  it("applies chained styles", () => {
    const result = c`{bold.green success}`;
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[32m");
  });

  it("handles interpolation", () => {
    const name = "world";
    const result = c`{red hello} ${name}`;
    expect(stripAnsi(result)).toBe("hello world");
  });

  it("restores an outer inline style after an ANSI-colored interpolation", () => {
    const value = color.green("world");
    const result = c`{red hello ${value} again}`;
    expect(result).toBe("\x1b[31mhello \x1b[32mworld\x1b[39m\x1b[31m again\x1b[39m");
  });

  it("returns plain text when disabled", () => {
    setColorEnabled(false);
    expect(c`{red hello}`).toBe("hello");

    // The interpolating branch runs through the same enablement gate, so a
    // regression that only reopens styling around a value has to be covered.
    const value = color.green("world");
    const interpolated = c`{red hello ${value} tail}`;
    expect(interpolated).not.toContain("\x1b");
    expect(interpolated).toBe("hello world tail");
  });

  it("does not support nested style blocks (documented limitation)", () => {
    const result = c`{yellow a {bold inner} b}`;
    const plain = stripAnsi(result);
    expect(plain).toBe("a inner b");
    expect(result).toContain("\x1b[33m");
    expect(result).toContain("\x1b[1m");
  });

  it("leaves unknown brace patterns as plain text", () => {
    expect(c`value: {not-a-style text}`).toBe("value: {not-a-style text}");
  });

  it("treats interpolated markup-looking values as literal text", () => {
    const value = "{red untrusted}";
    const result = c`value: ${value}`;
    expect(result).toBe(`value: ${value}`);
    expect(result).not.toContain("\x1b[31m");
  });

  it("round-trips interpolation marker code points without parsing their braces", () => {
    const value = "\u{f0000}{red literal}";
    expect(stripAnsi(c`{green ${value}}`)).toBe(value);
  });

  it("handles a large adversarial run of marker code points promptly and correctly", () => {
    // A big run of the U+F0000 marker code point must not trigger quadratic
    // marker-collision scanning. Assert the value round-trips and completes fast.
    const value = "\u{f0000}".repeat(200_000);
    const start = performance.now();
    const result = c`prefix ${value} suffix`;
    const elapsed = performance.now() - start;
    expect(result).toBe(`prefix ${value} suffix`);
    expect(elapsed).toBeLessThan(1000);
  });

  it("bounds inline markup nesting", () => {
    const deeplyNested = `${"{red ".repeat(66)}value${"}".repeat(66)}`;
    const strings = Object.assign([deeplyNested], {
      raw: [deeplyNested],
    }) as unknown as TemplateStringsArray;
    expect(() => c(strings)).toThrow(/nesting exceeds/);
  });
});

describe("stringWidth", () => {
  it("distinguishes narrow dingbats from wide emoji and CJK", () => {
    expect(stringWidth("✓✔✗")).toBe(3);
    expect(stringWidth("⭐⌚日本")).toBe(8);
  });

  it("truncates a large cell without materializing every grapheme", () => {
    const value = "a".repeat(5_000_000);
    const start = performance.now();
    expect(truncateAnsi(value, 8)).toBe("aaaaaaa…");
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe("stripAnsi", () => {
  it("strips ANSI codes", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[39m")).toBe("hello");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });

  it("strips OSC sequences terminated by ST", () => {
    const hyperlink = "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\";
    expect(stripAnsi(hyperlink)).toBe("link");
  });

  it("recognizes colon-form SGR sequences across ANSI helpers", () => {
    const styled = "\x1b[38:2::255:0:0mX\x1b[0m";
    expect(stripAnsi(styled)).toBe("X");
    expect(stringWidth(styled)).toBe(1);
    expect(truncateAnsi(`${styled}Y`, 1)).toContain("…");
  });
});

describe("stringWidth", () => {
  it("calculates width of ASCII text", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("ignores ANSI codes", () => {
    setColorEnabled(true);
    expect(stringWidth(color.red("hello"))).toBe(5);
    resetColorEnabled();
  });

  it("handles CJK characters as width 2", () => {
    expect(stringWidth("日本語")).toBe(6);
  });

  it("handles mixed content", () => {
    expect(stringWidth("hello世界")).toBe(9);
  });

  it("handles empty string", () => {
    expect(stringWidth("")).toBe(0);
  });

  it("treats control characters as zero width", () => {
    // BEL (0x07) should contribute 0, leaving just "ab" = 2 columns.
    expect(stringWidth("a\x07b")).toBe(2);
  });

  it("counts a ZWJ emoji sequence as a single wide grapheme", () => {
    // Family emoji "👨‍👩‍👧" is one displayed grapheme, width 2.
    expect(stringWidth("👨‍👩‍👧")).toBe(2);
  });

  it("counts a ZWJ emoji sequence with variation selectors as a single wide grapheme", () => {
    expect(stringWidth("❤️‍🔥")).toBe(2);
  });

  it("counts an emoji with a skin-tone modifier as one wide grapheme", () => {
    expect(stringWidth("👍🏽")).toBe(2);
  });

  it("counts keycap and VS16 emoji-presentation graphemes as wide", () => {
    expect(stringWidth("1️⃣")).toBe(2);
    expect(stringWidth("©️")).toBe(2);
    expect(stringWidth("©")).toBe(1);
  });

  it("measures a transport emoji as width 2", () => {
    // U+1F680 rocket sits in the transport & map symbols range.
    expect(stringWidth("🚀")).toBe(2);
  });

  it("measures a flag emoji (regional indicator pair) as width 2", () => {
    // Two regional indicators form one displayed flag grapheme.
    expect(stringWidth("🇯🇵")).toBe(2);
  });
});

describe("truncateAnsi", () => {
  it("closes active SGR styles after truncation", () => {
    const result = truncateAnsi("\x1b[31malexander", 5);
    expect(stripAnsi(result)).toBe("alex…");
    expect(result.endsWith("\x1b[0m")).toBe(true);
  });

  it("fits an oversized marker within the requested display width", () => {
    const result = truncateAnsi("abcdef", 1, "...");
    expect(result).toBe(".");
    expect(stringWidth(result)).toBe(1);
  });
});

describe("color detection precedence", () => {
  const original = { ...process.env };

  afterEach(() => {
    resetColorEnabled();
    process.env = { ...original };
  });

  it("honors FORCE_COLOR over TERM=dumb", async () => {
    resetColorEnabled();
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    process.env.TERM = "dumb";
    const { isColorEnabled } = await import("../src/output/color.js");
    expect(isColorEnabled()).toBe(true);
  });
});

describe("SGR recognition and display width", () => {
  it("closes a colon-separated extended colour", () => {
    // The colon spelling carries the colour as sub-parameters of one parameter;
    // reading it as separate parameters mistakes a component for a reset and
    // leaves the colour open, which then bleeds into a table frame.
    expect(closeAnsiState("\x1b[38:2::255:0:0mred")).toBe("\x1b[38:2::255:0:0mred\x1b[0m");
    expect(closeAnsiState("\x1b[38:5:196mred")).toBe("\x1b[38:5:196mred\x1b[0m");
    // The semicolon spelling keeps working.
    expect(closeAnsiState("\x1b[38;2;255;0;0mred")).toBe("\x1b[38;2;255;0;0mred\x1b[0m");
    // An explicit reset still closes the state.
    expect(closeAnsiState("\x1b[38:2::255:0:0mred\x1b[0m")).toBe("\x1b[38:2::255:0:0mred\x1b[0m");
  });

  it("measures status emoji as two columns", () => {
    for (const emoji of ["\u2705", "\u274c", "\u{1f7e2}", "\u26a1", "\u2728", "\u2b1b"]) {
      expect(stringWidth(emoji)).toBe(2);
    }
  });
});

describe("documented parsing and terminal helpers", () => {
  it("tags each run of splitAnsi as escape or text", () => {
    const segments = splitAnsi(`${"\x1b[31m"}red${"\x1b[39m"}`);
    // The field names are part of the documented shape.
    expect(segments).toEqual([
      { ansi: true, text: "\x1b[31m" },
      { ansi: false, text: "red" },
      { ansi: true, text: "\x1b[39m" },
    ]);
  });

  it("splits graphemes rather than code units", () => {
    expect(splitGraphemes("a\u{1f1ef}\u{1f1f5}b")).toEqual(["a", "\u{1f1ef}\u{1f1f5}", "b"]);
  });

  it("honours both sanitizeTerminalText options", () => {
    const multiline = "one\ntwo\tthree";
    // singleLine: false keeps the line structure; either way the word
    // boundaries survive rather than collapsing into "onetwothree".
    expect(sanitizeTerminalText(multiline, { singleLine: false })).toBe("one\ntwo three");
    expect(sanitizeTerminalText(multiline)).toBe("one two three");

    const link = "\x1b]8;;https://example.com\x07link\x1b]8;;\x07";
    expect(sanitizeTerminalText(link, { allowHyperlinks: true })).toContain("\x1b]8;;");
    expect(sanitizeTerminalText(link, { allowHyperlinks: false })).not.toContain("\x1b]8;;");
  });

  it("reports TTY-ness of a stream", () => {
    expect(streamIsTTY({ isTTY: true } as NodeJS.WritableStream)).toBe(true);
    expect(streamIsTTY({} as NodeJS.WritableStream)).toBe(false);
  });
});

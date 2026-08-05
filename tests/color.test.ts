import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  c,
  color,
  isColorEnabled,
  resetColorEnabled,
  setColorEnabled,
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
    expect(() => (color as any).toString).toThrow("Unknown style: toString");
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
    const result = c`{red hello}`;
    expect(result).toBe("hello");
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

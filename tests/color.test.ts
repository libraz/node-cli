import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  c,
  color,
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

  it("returns plain text when disabled", () => {
    setColorEnabled(false);
    expect(color.red("hello")).toBe("hello");
  });

  it("throws on unknown style", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing unknown style access
    expect(() => (color as any).foobar("test")).toThrow("Unknown style");
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

  it("bounds inline markup nesting", () => {
    const deeplyNested = `${"{red ".repeat(66)}value${"}".repeat(66)}`;
    const strings = Object.assign([deeplyNested], {
      raw: [deeplyNested],
    }) as unknown as TemplateStringsArray;
    expect(() => c(strings)).toThrow(/nesting exceeds/);
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

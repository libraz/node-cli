import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeAnsiState,
  color,
  colorTag,
  createColorizer,
  createColorTag,
  isColorEnabled,
  isStyleName,
  isTTY,
  renderSafe,
  sanitizeTerminalText,
  setColorEnabled,
  splitAnsi,
  splitGraphemes,
  stringWidth,
  stripAnsi,
  truncateAnsi,
} from "../src/output/color.js";
import { restoreProcessStateAfterEach } from "./helpers.js";

restoreProcessStateAfterEach(["NO_COLOR", "FORCE_COLOR", "TERM"]);

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("color", () => {
  beforeEach(() => {
    setColorEnabled(true);
  });

  afterEach(() => {
    setColorEnabled("auto");
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

  it("throws a RangeError with a code that lists the valid names", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing unknown style access
    const error = catchError(() => (color as any).gren);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
    expect((error as Error).message).toContain("green");
    expect((error as Error).message).toContain("bgWhite");
  });

  it("throws on an unknown link in a chain", () => {
    // biome-ignore lint/suspicious/noExplicitAny: testing unknown style access
    expect(() => (color.red as any).bol).toThrow(RangeError);
  });

  it("narrows names with isStyleName", () => {
    expect(isStyleName("cyan")).toBe(true);
    expect(isStyleName("grey")).toBe(true);
    expect(isStyleName("toString")).toBe(false);
    expect(isStyleName("gren")).toBe(false);
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

  beforeEach(() => {
    setColorEnabled("auto");
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.TERM;
  });

  afterEach(() => {
    setColorEnabled("auto");
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

  it("lets an explicit setColorEnabled(true) beat NO_COLOR", () => {
    process.env.NO_COLOR = "1";
    setColorEnabled(true);
    expect(isColorEnabled(stream)).toBe(true);
  });

  it("lets FORCE_COLOR=1 beat a stream that is not a terminal", () => {
    process.env.FORCE_COLOR = "1";
    expect(isColorEnabled({ isTTY: false } as NodeJS.WritableStream)).toBe(true);
  });

  it("falls back to the stream's terminal status", () => {
    expect(isColorEnabled(stream)).toBe(true);
    expect(isColorEnabled({ isTTY: false } as NodeJS.WritableStream)).toBe(false);
    expect(isColorEnabled({} as NodeJS.WritableStream)).toBe(false);
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
    setColorEnabled("auto");
  });

  it("applies inline styles", () => {
    const result = colorTag`{red error}`;
    expect(result).toContain("\x1b[31m");
    expect(stripAnsi(result)).toBe("error");
  });

  it("applies chained styles", () => {
    const result = colorTag`{bold.green success}`;
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[32m");
  });

  it("handles interpolation", () => {
    const name = "world";
    const result = colorTag`{red hello} ${name}`;
    expect(stripAnsi(result)).toBe("hello world");
  });

  it("restores an outer inline style after an ANSI-colored interpolation", () => {
    const value = color.green("world");
    const result = colorTag`{red hello ${value} again}`;
    expect(result).toBe("\x1b[31mhello \x1b[32mworld\x1b[39m\x1b[31m again\x1b[39m");
  });

  it("returns plain text when disabled", () => {
    setColorEnabled(false);
    expect(colorTag`{red hello}`).toBe("hello");

    // The interpolating branch runs through the same enablement gate, so a
    // regression that only reopens styling around a value has to be covered.
    const value = color.green("world");
    const interpolated = colorTag`{red hello ${value} tail}`;
    expect(interpolated).not.toContain("\x1b");
    expect(interpolated).toBe("hello world tail");
  });

  it("does not support nested style blocks (documented limitation)", () => {
    const result = colorTag`{yellow a {bold inner} b}`;
    const plain = stripAnsi(result);
    expect(plain).toBe("a inner b");
    expect(result).toContain("\x1b[33m");
    expect(result).toContain("\x1b[1m");
  });

  it("leaves unknown brace patterns as plain text", () => {
    expect(colorTag`value: {not-a-style text}`).toBe("value: {not-a-style text}");
  });

  it("treats interpolated markup-looking values as literal text", () => {
    const value = "{red untrusted}";
    const result = colorTag`value: ${value}`;
    expect(result).toBe(`value: ${value}`);
    expect(result).not.toContain("\x1b[31m");
  });

  it("round-trips interpolation marker code points without parsing their braces", () => {
    const value = "\u{f0000}{red literal}";
    expect(stripAnsi(colorTag`{green ${value}}`)).toBe(value);
  });

  it("handles a large adversarial run of marker code points promptly and correctly", () => {
    // A big run of the U+F0000 marker code point must not trigger quadratic
    // marker-collision scanning. Assert the value round-trips and completes fast.
    const value = "\u{f0000}".repeat(200_000);
    const start = performance.now();
    const result = colorTag`prefix ${value} suffix`;
    const elapsed = performance.now() - start;
    expect(result).toBe(`prefix ${value} suffix`);
    expect(elapsed).toBeLessThan(1000);
  });

  it("bounds inline markup nesting", () => {
    const deeplyNested = `${"{red ".repeat(66)}value${"}".repeat(66)}`;
    const strings = Object.assign([deeplyNested], {
      raw: [deeplyNested],
    }) as unknown as TemplateStringsArray;
    expect(() => colorTag(strings)).toThrow(/nesting exceeds/);
    expect(catchError(() => colorTag(strings))).toMatchObject({
      name: "RangeError",
      code: "ERR_INVALID_ARG_VALUE",
    });
  });

  it("accepts nesting of exactly 64 levels", () => {
    const nested = `${"{red ".repeat(64)}value${"}".repeat(64)}`;
    const strings = Object.assign([nested], { raw: [nested] }) as unknown as TemplateStringsArray;
    expect(stripAnsi(colorTag(strings))).toBe("value");
  });

  it("keeps braces that do not start with a known style as literal text", () => {
    setColorEnabled(true);
    expect(colorTag`{notastyle text} and {red ok}`).toBe(`{notastyle text} and ${color.red("ok")}`);
  });
});

describe("width of symbols and large cells", () => {
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
    setColorEnabled("auto");
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
    expect(result.endsWith("\x1b[39m")).toBe(true);
  });

  it("fits an oversized marker within the requested display width", () => {
    const result = truncateAnsi("abcdef", 1, "...");
    expect(result).toBe(".");
    expect(stringWidth(result)).toBe(1);
  });
});

describe("color detection precedence", () => {
  afterEach(() => {
    setColorEnabled("auto");
  });

  it("honors FORCE_COLOR over TERM=dumb", async () => {
    setColorEnabled("auto");
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
    expect(closeAnsiState("\x1b[38:2::255:0:0mred")).toBe("\x1b[38:2::255:0:0mred\x1b[39m");
    expect(closeAnsiState("\x1b[38:5:196mred")).toBe("\x1b[38:5:196mred\x1b[39m");
    // The semicolon spelling keeps working.
    expect(closeAnsiState("\x1b[38;2;255;0;0mred")).toBe("\x1b[38;2;255;0;0mred\x1b[39m");
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
    expect(isTTY({ isTTY: true } as NodeJS.WritableStream)).toBe(true);
    expect(isTTY({} as NodeJS.WritableStream)).toBe(false);
  });
});

describe("escape-sequence grammar", () => {
  const ESC = "\x1b";
  const ST = `${ESC}\\`;

  it("removes DCS, SOS, PM and APC control strings whole", () => {
    for (const introducer of ["P", "X", "^", "_"]) {
      const text = `a${ESC}${introducer}q#0;2;0;0;0${ST}b`;
      expect(stripAnsi(text)).toBe("ab");
      expect(sanitizeTerminalText(text)).toBe("ab");
      expect(stringWidth(text)).toBe(2);
    }
  });

  it("matches an OSC whatever punctuation its payload carries", () => {
    for (const payload of ["0;a,b", "0;a+b", "0;Foo_(bar)", "0;my title", "2;x!*'\"$"]) {
      for (const terminator of ["\x07", ST]) {
        const text = `a${ESC}]${payload}${terminator}b`;
        expect(stripAnsi(text)).toBe("ab");
        expect(sanitizeTerminalText(text)).toBe("ab");
        expect(stringWidth(text)).toBe(2);
        expect(truncateAnsi(text, 10)).toBe(text);
      }
    }
  });

  it("keeps an OSC 8 link with punctuation in its URI intact", () => {
    const link = `${ESC}]8;;https://x.invalid/wiki/A_(b),c+d${ST}text${ESC}]8;;${ST}`;
    expect(sanitizeTerminalText(link)).toBe(link);
    expect(stringWidth(link)).toBe(4);
  });

  it("treats an unterminated OSC as running to the end of input", () => {
    const text = `a${ESC}]0;title without end`;
    expect(stripAnsi(text)).toBe("a");
    expect(sanitizeTerminalText(text)).toBe("a");
    expect(stringWidth(text)).toBe(1);
    // The cut-off string is terminated so it cannot swallow following output.
    expect(truncateAnsi(text, 10)).toBe(`${text}${ST}`);
  });

  it("removes CSI sequences with private markers or intermediate bytes", () => {
    for (const sequence of ["[>4;2m", "[<0;1;1M", "[=1c", "[2 q", "[!p", '["q', "[$p", "[?1049m"]) {
      const text = `a${ESC}${sequence}b`;
      expect(stripAnsi(text)).toBe("ab");
      expect(sanitizeTerminalText(text)).toBe("ab");
      expect(stringWidth(text)).toBe(2);
    }
  });

  it("keeps only plain SGR sequences as colour", () => {
    for (const sgr of [`${ESC}[31m`, `${ESC}[38:2::255:0:0m`, `${ESC}[m`, `${ESC}[1;4m`]) {
      const sanitized = sanitizeTerminalText(`a${sgr}b`);
      expect(sanitized.startsWith(`a${sgr}b`)).toBe(true);
      expect(sanitized).toBe(closeAnsiState(`a${sgr}b`));
    }
  });

  it("closes the SGR styles and the OSC 8 link it leaves open", () => {
    expect(sanitizeTerminalText(`${ESC}[31mred`)).toBe(`${ESC}[31mred${ESC}[39m`);
    expect(sanitizeTerminalText(`${ESC}[1;4mx`)).toBe(`${ESC}[1;4mx${ESC}[22m${ESC}[24m`);
    const open = `${ESC}]8;;https://x.invalid${ST}link`;
    expect(sanitizeTerminalText(open)).toBe(`${open}${ESC}]8;;${ST}`);
  });

  it("leaves closed styling untouched", () => {
    const text = `${ESC}[31mred${ESC}[39m`;
    expect(sanitizeTerminalText(text)).toBe(text);
  });

  it("keeps OSC 8 links that carry params, opener and closer together", () => {
    const link = `${ESC}]8;id=x;https://x.invalid${ST}hi${ESC}]8;;${ST}`;
    expect(sanitizeTerminalText(link)).toBe(link);
    expect(sanitizeTerminalText(link, { allowHyperlinks: false })).toBe("hi");
  });
});

describe("closing ANSI state", () => {
  const ESC = "\x1b";
  const ST = `${ESC}\\`;

  beforeEach(() => {
    setColorEnabled(true);
  });

  afterEach(() => {
    setColorEnabled("auto");
  });

  it("closes inner styling without ending an outer color.* style", () => {
    const inner = truncateAnsi(color.green("long text"), 5);
    const viaColor = color.red(`${inner} tail`);
    expect(viaColor).toBe(colorTag`{red ${inner} tail}`);
    expect(viaColor).toBe(`${ESC}[31m${ESC}[32mlong…${ESC}[39m${ESC}[31m tail${ESC}[39m`);
  });

  it("tracks underline colour separately from the foreground", () => {
    expect(closeAnsiState(`${ESC}[31mred${ESC}[59m`)).toBe(`${ESC}[31mred${ESC}[59m${ESC}[39m`);
    expect(closeAnsiState(`${ESC}[58;5;1mu${ESC}[39m`)).toBe(`${ESC}[58;5;1mu${ESC}[39m${ESC}[59m`);
  });

  it("closes an OSC 8 link opened with params, whichever terminator it used", () => {
    for (const terminator of ["\x07", ST]) {
      const link = `${ESC}]8;id=a;https://x.invalid${terminator}linked text`;
      expect(truncateAnsi(link, 50)).toBe(`${link}${ESC}]8;;${ST}`);
      expect(truncateAnsi(link, 5)).toBe(
        `${ESC}]8;id=a;https://x.invalid${terminator}link…${ESC}]8;;${ST}`,
      );
    }
  });

  it("leaves nothing set for any SGR attribute sanitizing lets through", () => {
    const opening = [1, 2, 3, 4, 5, 7, 8, 9, 20, 21, 26, 51, 52, 53, 56, 57, 73, 74, 99];
    for (let code = 11; code <= 19; code++) opening.push(code);
    for (let code = 60; code <= 64; code++) opening.push(code);
    for (const code of opening) {
      const text = renderSafe(`x${ESC}[${code}my`);
      expect(text.length, `code ${code}`).toBeGreaterThan(`x${ESC}[${code}my`.length);
      // Closing again owes nothing once every attribute has been reset.
      expect(closeAnsiState(text), `code ${code}`).toBe(text);
    }
  });

  it("uses a targeted reset for each attribute and a full reset only when none exists", () => {
    expect(closeAnsiState(`${ESC}[1;4mx`)).toBe(`${ESC}[1;4mx${ESC}[22m${ESC}[24m`);
    expect(closeAnsiState(`${ESC}[11mx`)).toBe(`${ESC}[11mx${ESC}[10m`);
    expect(closeAnsiState(`${ESC}[56mx`)).toBe(`${ESC}[56mx${ESC}[0m`);
    expect(closeAnsiState(`${ESC}[4:3mx${ESC}[4:0m`)).toBe(`${ESC}[4:3mx${ESC}[4:0m`);
  });

  it("renderSafe closes the styling and link it leaves open", () => {
    const text = `${ESC}[31m${ESC}]8;id=a;https://x.invalid\x07link`;
    expect(renderSafe(text)).toBe(`${text}${ESC}]8;;${ST}${ESC}[39m`);
  });
});

describe("truncateAnsi width argument", () => {
  it("treats Infinity as no limit", () => {
    expect(truncateAnsi("hello world", Number.POSITIVE_INFINITY)).toBe("hello world");
  });

  it.each([0, -0, -1, Number.NaN, Number.NEGATIVE_INFINITY, 0.5, 2.5])(
    "rejects the width %s with a RangeError",
    (width) => {
      const error = catchError(() => truncateAnsi("hello world", width));
      expect(error).toBeInstanceOf(RangeError);
      expect(error).toMatchObject({ code: "ERR_INVALID_ARG_VALUE" });
    },
  );

  it("rejects a width that is not a number with a TypeError", () => {
    const error = catchError(() => truncateAnsi("hello", null as never));
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({ code: "ERR_INVALID_ARG_TYPE" });
  });

  it("takes the ellipsis as the third argument", () => {
    expect(truncateAnsi("abcdef", 4, "..")).toBe("ab..");
  });
});

describe("setColorEnabled", () => {
  afterEach(() => {
    setColorEnabled("auto");
  });

  it('restores detection with "auto"', () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    setColorEnabled(true);
    expect(isColorEnabled({ isTTY: false } as never)).toBe(true);
    setColorEnabled("auto");
    expect(isColorEnabled({ isTTY: false } as never)).toBe(false);
    expect(isColorEnabled({ isTTY: true } as never)).toBe(true);
  });

  it("forces color off with false regardless of the stream", () => {
    setColorEnabled(false);
    expect(isColorEnabled({ isTTY: true } as never)).toBe(false);
  });
});

describe("isTTY", () => {
  it("is true only for objects with isTTY === true", () => {
    expect(isTTY({ isTTY: true })).toBe(true);
    expect(isTTY({ isTTY: false })).toBe(false);
    expect(isTTY({})).toBe(false);
    expect(isTTY(null)).toBe(false);
    expect(isTTY(undefined)).toBe(false);
    expect(isTTY("tty")).toBe(false);
  });
});

describe("createColorTag and createColorizer", () => {
  const stream = (isTTY: boolean) => ({ isTTY }) as never;

  afterEach(() => {
    setColorEnabled("auto");
  });

  it("emits no escapes for a non-TTY stream", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    setColorEnabled("auto");
    const tag = createColorTag(stream(false));
    expect(tag`{bold.red Error}: ${"x"}`).toBe("Error: x");
    expect(createColorizer(stream(false)).red("x")).toBe("x");
  });

  it("emits escapes for a TTY stream", () => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    setColorEnabled("auto");
    const tag = createColorTag(stream(true));
    expect(tag`{red x}`).toBe("\x1b[31mx\x1b[39m");
  });

  it("matches c when color is forced on", () => {
    setColorEnabled(true);
    const tag = createColorTag(stream(false));
    expect(tag`{green OK} {bold.red no}`).toBe(colorTag`{green OK} {bold.red no}`);
  });

  it("applies the nesting limit", () => {
    const nested = `${"{red ".repeat(66)}v${"}".repeat(66)}`;
    const strings = Object.assign([nested], { raw: [nested] }) as unknown as TemplateStringsArray;
    expect(() => createColorTag(stream(true))(strings)).toThrow(RangeError);
  });
});

describe("stringWidth Unicode properties", () => {
  it("counts East Asian Wide and Fullwidth code points as two columns", () => {
    for (const code of [0x1f7f0, 0x1aff0, 0x1b132, 0x1b155, 0x16fe0, 0x17000, 0xa960, 0xff01]) {
      expect(stringWidth(String.fromCodePoint(code)), code.toString(16)).toBe(2);
    }
  });

  it("counts neutral and ambiguous pictographs as one column", () => {
    for (const code of [0x1f130, 0x1f321, 0x1f5a5, 0x1f000, 0x303f]) {
      expect(stringWidth(String.fromCodePoint(code)), code.toString(16)).toBe(1);
    }
  });

  it("counts format characters as zero columns", () => {
    const format = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2064];
    for (const code of [...format, 0x2066, 0x2067, 0x2068, 0x2069]) {
      expect(stringWidth(`a${String.fromCodePoint(code)}b`), code.toString(16)).toBe(2);
    }
  });
});

describe("c (template tag) interpolation", () => {
  afterEach(() => {
    setColorEnabled("auto");
  });

  it("inserts values containing replacement patterns verbatim", () => {
    for (const enabled of [true, false]) {
      setColorEnabled(enabled);
      for (const value of ["$&", "$`", "$'", "$$", "$1", "$<name>"]) {
        const plain = colorTag`a ${value} b`;
        expect(stripAnsi(plain)).toBe(`a ${value} b`);
        const styled = colorTag`{red x ${value} y}`;
        expect(stripAnsi(styled)).toBe(`x ${value} y`);
        expect(styled).not.toContain("\u{f0000}");
      }
    }
  });
});

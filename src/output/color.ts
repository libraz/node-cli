// ── ANSI codes ──

/**
 * Mapping of style names to their ANSI open/close code pairs.
 * Each entry is a tuple of [openCode, closeCode].
 */
const styles: Record<string, [number, number]> = {
  // modifiers
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  strikethrough: [9, 29],
  // foreground
  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  grey: [90, 39], // British spelling alias of gray
  // background
  bgRed: [41, 49],
  bgGreen: [42, 49],
  bgYellow: [43, 49],
  bgBlue: [44, 49],
  bgMagenta: [45, 49],
  bgCyan: [46, 49],
  bgWhite: [47, 49],
};

// ── Color support detection ──

let _enabled: boolean | null = null;

/**
 * Determines whether a value looks like a TTY stream.
 */
export function streamIsTTY(stream: object): boolean {
  return (stream as { isTTY?: unknown }).isTTY === true;
}

/**
 * Determines whether color output is enabled.
 *
 * Resolution order: an explicit {@link setColorEnabled} override always wins.
 * Then `NO_COLOR` and `FORCE_COLOR=0` force color off. `FORCE_COLOR` (truthy)
 * forces it on, taking precedence over the `TERM=dumb` / non-TTY disable checks
 * per the de-facto standard. Finally the target stream's TTY status is consulted.
 * When no stream is given, `process.stdout` is used.
 *
 * @param stream - Optional output stream to evaluate. Defaults to `process.stdout`.
 * @returns Whether color escape codes should be emitted.
 */
export function isColorEnabled(stream?: NodeJS.WritableStream): boolean {
  if (_enabled !== null) return _enabled;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  // FORCE_COLOR is evaluated before TERM/TTY checks: "0"/"false" disable, any
  // other non-empty value enables regardless of TERM=dumb or non-TTY output.
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor != null && forceColor !== "") {
    return forceColor !== "0" && forceColor !== "false";
  }
  if (process.env.TERM === "dumb") return false;
  const target = stream ?? process.stdout;
  return streamIsTTY(target);
}

/**
 * Explicitly enable or disable color output.
 * When set, overrides automatic TTY/environment detection.
 *
 * @param enabled - Whether color output should be enabled.
 */
export function setColorEnabled(enabled: boolean): void {
  _enabled = enabled;
}

/**
 * Reset color output to automatic detection mode.
 * After calling this, color support is determined by the environment
 * (TTY, NO_COLOR, FORCE_COLOR, TERM variables).
 */
export function resetColorEnabled(): void {
  _enabled = null;
}

// ── Core apply ──

/**
 * Wraps text in ANSI escape codes for the given style stack.
 *
 * Each style re-opens itself after any matching close code already present in
 * the text, so independently colored fragments nested inside another color do
 * not bleed (e.g. `color.red(\`a ${color.green("b")} c\`)` keeps `c` red).
 *
 * @param text - The text to style.
 * @param codes - The accumulated [open, close] code pairs to apply.
 * @param enabled - Whether color output is active.
 * @returns The styled string, or the original text when color is disabled.
 */
function applyStyle(text: string, codes: [number, number][], enabled: boolean): string {
  if (!enabled) return text;
  const esc = "\x1b[";
  let result = text;
  // Apply from innermost to outermost so each layer re-opens correctly.
  for (let k = codes.length - 1; k >= 0; k--) {
    const [open, close] = codes[k];
    const openSeq = `${esc}${open}m`;
    const closeSeq = `${esc}${close}m`;
    // A close code can be shared by different styles (notably bold and dim
    // both use 22). Preserve the nested close, then reopen this outer style:
    // replacing it outright would leave the inner style active for following
    // text.
    result = openSeq + result.split(closeSeq).join(closeSeq + openSeq) + closeSeq;
  }
  return result;
}

// ── Proxy-based chainable color ──

/**
 * A callable color function that also supports chaining via property access.
 * Can be called directly with a string, or chained with other style names
 * (e.g. `color.bold.red("hello")`).
 */
interface ColorFn {
  (text: string): string;
  [key: string]: ColorFn;
}

function createChain(accumulated: [number, number][], isEnabled: () => boolean): ColorFn {
  const apply = (text: string): string => applyStyle(text, accumulated, isEnabled());

  return new Proxy(apply, {
    get(target, prop: string | symbol): unknown {
      // Symbols are used by language/runtime protocols; string properties are
      // styles only, so inherited Function/Object members must not leak through.
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (!Object.hasOwn(styles, prop)) {
        throw new Error(`Unknown style: ${prop}`);
      }
      return createChain([...accumulated, styles[prop]], isEnabled);
    },
  }) as ColorFn;
}

function createColorProxy(isEnabled: () => boolean): Record<string, ColorFn> {
  return new Proxy({} as Record<string, ColorFn>, {
    get(target, prop: string | symbol): unknown {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (!Object.hasOwn(styles, prop)) {
        throw new Error(`Unknown style: ${prop}`);
      }
      return createChain([styles[prop]], isEnabled);
    },
  });
}

/**
 * Proxy-based color utility. Access any style name as a property to get a
 * chainable {@link ColorFn}. Styles can be chained for combined effects.
 *
 * Color is enabled based on `process.stdout`; use {@link createColorizer} to
 * bind colorization to a specific output stream.
 *
 * @example
 * ```ts
 * color.red("error");          // red text
 * color.bold.underline("hi");  // bold + underlined text
 * ```
 */
export const color: Record<string, ColorFn> = createColorProxy(() => isColorEnabled());

/**
 * Creates a color proxy whose enablement is tied to a specific output stream.
 *
 * Use this when writing to a stream other than `process.stdout` (e.g. a logger
 * on stderr or a redirected command stream) so color is only emitted when that
 * stream is a TTY.
 *
 * @param stream - The output stream color will be written to.
 * @returns A chainable color proxy bound to the stream's TTY status.
 */
export function createColorizer(stream: NodeJS.WritableStream): Record<string, ColorFn> {
  return createColorProxy(() => isColorEnabled(stream));
}

// ── Template tag ──

/**
 * Tagged template literal for inline color formatting.
 * Use `{styleName text}` syntax inside the template to apply styles.
 * Dot-separated style names are supported for chaining.
 *
 * @example
 * ```ts
 * c`Status: {green OK}`;
 * c`{bold.red Error}: something went wrong`;
 * ```
 *
 * @param strings - Template literal string segments.
 * @param values  - Interpolated values.
 * @returns The formatted string with ANSI escape codes applied.
 */
export function c(strings: TemplateStringsArray, ...values: unknown[]): string {
  const valueStrings = values.map(String);
  const allInput = [...strings, ...valueStrings];
  // Build a collision-free marker in a single pass. The marker is a run of
  // U+F0000 (Plane-15 private use) one longer than the longest such run already
  // present in any input part, so it cannot appear inside the literal or
  // interpolated content. Scanning once keeps this O(n) on adversarial input.
  const markerCode = 0xf0000;
  let maxRun = 0;
  for (const part of allInput) {
    let run = 0;
    for (const char of part) {
      if (char.codePointAt(0) === markerCode) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
  }
  const marker = "\u{f0000}".repeat(maxRun + 1);
  const tokens = valueStrings.map((_, index) => `${marker}${index}${marker}`);
  const raw = strings.reduce((acc, str, i) => acc + str + (i < tokens.length ? tokens[i] : ""), "");

  const enabled = isColorEnabled();
  const formatInline = (
    text: string,
    nesting = 0,
    activeCodes: [number, number][] = [],
  ): string => {
    if (nesting > 64) throw new Error("Inline color markup nesting exceeds 64 levels");
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const token = tokens.find((candidate) => text.startsWith(candidate, i));
      if (token) {
        // Values are substituted after inline styles have been rendered. If an
        // interpolated ANSI fragment closes a shared color/style code, reopen
        // every surrounding inline style before the following literal text.
        result += token + activeCodes.map(([open]) => `\x1b[${open}m`).join("");
        i += token.length - 1;
        continue;
      }
      if (text[i] !== "{") {
        result += text[i];
        continue;
      }

      const styleEnd = text.indexOf(" ", i + 1);
      if (styleEnd === -1) {
        result += text[i];
        continue;
      }

      const styleChain = text.slice(i + 1, styleEnd);
      const names = styleChain.split(".");
      if (names.length === 0 || names.some((name) => !Object.hasOwn(styles, name))) {
        result += text[i];
        continue;
      }

      let depth = 1;
      let end = styleEnd + 1;
      for (; end < text.length; end++) {
        if (text[end] === "{") depth++;
        if (text[end] === "}") depth--;
        if (depth === 0) break;
      }
      if (depth !== 0) {
        result += text[i];
        continue;
      }

      const codes = names.map((name) => styles[name]);
      const inner = formatInline(text.slice(styleEnd + 1, end), nesting + 1, [
        ...activeCodes,
        ...codes,
      ]);
      result += applyStyle(inner, codes, enabled);
      i = end;
    }
    return result;
  };

  let result = formatInline(raw);
  for (let index = 0; index < tokens.length; index++) {
    result = result.replaceAll(tokens[index], valueStrings[index]);
  }
  return result;
}

// ── Strip ANSI ──

/** Regular expression matching ANSI escape sequences (CSI and OSC). */
const ansiRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence matching requires control characters
  /[\x1b\x9b][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?(?:\x07|\x1b\\))|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

/**
 * Remove all ANSI escape sequences from the given string.
 *
 * Handles SGR color codes as well as cursor, erase, and OSC sequences.
 *
 * @param text - A string potentially containing ANSI codes.
 * @returns The input string with all ANSI escape sequences removed.
 */
export function stripAnsi(text: string): string {
  return text.replace(ansiRegex, "");
}

/** A run of input tagged as an ANSI escape sequence or as plain visible text. */
export interface AnsiSegment {
  /** True for an ANSI escape sequence (pass through untouched); false for text. */
  ansi: boolean;
  /** The raw substring for this segment. */
  text: string;
}

/**
 * Splits a string into ordered runs of ANSI escape sequences and plain text,
 * using the same recognizer as {@link stripAnsi}. Width- and content-sensitive
 * consumers (e.g. masking, wrapping) can iterate the segments to leave escape
 * sequences — including OSC sequences such as window-title updates — intact
 * while transforming only the visible text.
 *
 * @param text - The string to split.
 * @returns The segments in input order; concatenating their `text` reproduces the input.
 */
export function splitAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let last = 0;
  // matchAll copies the regex, so the shared lastIndex is left untouched.
  for (const match of text.matchAll(ansiRegex)) {
    const start = match.index;
    if (start > last) segments.push({ ansi: false, text: text.slice(last, start) });
    segments.push({ ansi: true, text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ ansi: false, text: text.slice(last) });
  return segments;
}

/**
 * Sanitizes text before it is rendered inside a structured terminal UI.
 *
 * SGR styling and OSC 8 hyperlinks are preserved. Cursor movement, screen
 * clearing, title changes, and every other escape sequence are removed. Visible
 * C0/C1 controls are either collapsed to spaces in single-line mode or dropped.
 */
export function sanitizeTerminalText(
  text: string,
  options: { singleLine?: boolean; allowHyperlinks?: boolean } = {},
): string {
  const { singleLine = true, allowHyperlinks = true } = options;
  return splitAnsi(text)
    .map((segment) => {
      if (segment.ansi) {
        if (segment.text.startsWith("\x1b[") && segment.text.endsWith("m")) {
          return segment.text;
        }
        if (allowHyperlinks && segment.text.startsWith("\x1b]8;;")) {
          return segment.text;
        }
        return "";
      }

      let result = "";
      for (const character of segment.text) {
        const code = character.codePointAt(0) as number;
        if (
          singleLine &&
          (code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d)
        ) {
          result += " ";
        } else if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
          // Drop remaining C0 controls, DEL, and C1 controls.
        } else {
          result += character;
        }
      }
      return result;
    })
    .join("");
}

// ── String width (East Asian Width aware) ──

/**
 * Calculate the visual display width of a string, accounting for
 * ANSI escape codes (which are stripped), zero-width and combining
 * characters (which occupy no columns), and East Asian wide / emoji
 * characters (which occupy two columns).
 *
 * Runs of scalars joined by U+200D (zero-width joiner) — e.g. ZWJ emoji
 * sequences like a family emoji — collapse into a single grapheme and count as
 * one wide (2-column) cell rather than summing each scalar's width.
 *
 * @param text - The string to measure.
 * @returns The visual column width of the string.
 */
export function stringWidth(text: string): number {
  const stripped = stripAnsi(text);
  if (/^[\x20-\x7e]*$/.test(stripped)) return stripped.length;
  let width = 0;
  for (const grapheme of iterateGraphemes(stripped)) width += graphemeWidth(grapheme);
  return width;
}

/**
 * Computes the display width of a single grapheme cluster directly from its
 * code points, taking the maximum width across the cluster so a base character
 * combined with a wide component still counts as wide. Avoids re-segmenting an
 * already-split grapheme via {@link stringWidth}.
 */
function graphemeWidth(grapheme: string): number {
  // Emoji-presentation variation selectors and keycap sequences make otherwise
  // narrow base characters occupy a two-column terminal cell.
  if (grapheme.includes("\ufe0f") || grapheme.includes("\u20e3")) return 2;
  let width = 0;
  for (const char of grapheme) {
    width = Math.max(width, getCharWidth(char.codePointAt(0) as number));
  }
  return width;
}

/**
 * Lazily-initialized, module-level grapheme segmenter. Reusing one instance
 * avoids reconstructing an `Intl.Segmenter` on every width/truncation call,
 * which is the table-rendering hot path. Null when `Intl.Segmenter` is
 * unavailable, in which case callers fall back to code-point iteration.
 */
let _segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (_segmenter === undefined) {
    _segmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return _segmenter;
}

/** Splits visible text into user-perceived grapheme clusters. */
export function splitGraphemes(text: string): string[] {
  return [...iterateGraphemes(text)];
}

/** Iterates graphemes without materializing a complete array for large text. */
function* iterateGraphemes(text: string): Iterable<string> {
  const segmenter = getSegmenter();
  if (segmenter) {
    for (const segment of segmenter.segment(text)) yield segment.segment;
    return;
  }
  yield* text;
}

/**
 * Appends the terminal escapes required to close styling or an OSC 8 hyperlink
 * that remains active at the end of text. Structured renderers use this at
 * cell boundaries so untrusted content cannot style or link their frame.
 */
export function closeAnsiState(text: string): string {
  const active = new Set<string>();
  let hasOpenHyperlink = false;

  for (const segment of splitAnsi(text)) {
    if (!segment.ansi) continue;
    if (segment.text.startsWith("\x1b[") && segment.text.endsWith("m")) {
      const params = segment.text
        .slice(2, -1)
        .split(";")
        .map((value) => (value === "" ? 0 : Number(value)));
      for (let index = 0; index < params.length; index++) {
        const code = params[index];
        if (!Number.isFinite(code)) continue;
        if (code === 0) {
          active.clear();
        } else if (code === 1 || code === 2) {
          active.add("intensity");
        } else if (code === 22) {
          active.delete("intensity");
        } else if (code === 3) {
          active.add("italic");
        } else if (code === 23) {
          active.delete("italic");
        } else if (code === 4 || code === 21) {
          active.add("underline");
        } else if (code === 24) {
          active.delete("underline");
        } else if (code === 5 || code === 6) {
          active.add("blink");
        } else if (code === 25) {
          active.delete("blink");
        } else if (code === 7) {
          active.add("inverse");
        } else if (code === 27) {
          active.delete("inverse");
        } else if (code === 8) {
          active.add("conceal");
        } else if (code === 28) {
          active.delete("conceal");
        } else if (code === 9) {
          active.add("strikethrough");
        } else if (code === 29) {
          active.delete("strikethrough");
        } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          active.add("foreground");
        } else if (code === 39) {
          active.delete("foreground");
        } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
          active.add("background");
        } else if (code === 49) {
          active.delete("background");
        } else if (code === 38 || code === 48 || code === 58) {
          active.add(code === 48 ? "background" : "foreground");
          const mode = params[index + 1];
          index += mode === 2 ? 4 : mode === 5 ? 2 : 0;
        } else if (code === 59) {
          active.delete("foreground");
        } else if (code === 51 || code === 52) {
          active.add("frame");
        } else if (code === 54) {
          active.delete("frame");
        } else if (code === 53) {
          active.add("overline");
        } else if (code === 55) {
          active.delete("overline");
        }
      }
    } else if (segment.text.startsWith("\x1b]8;;")) {
      hasOpenHyperlink = !["\x1b]8;;\x07", "\x1b]8;;\x1b\\"].includes(segment.text);
    }
  }

  return text + (hasOpenHyperlink ? "\x1b]8;;\x1b\\" : "") + (active.size > 0 ? "\x1b[0m" : "");
}

/** Truncates terminal text without splitting graphemes or leaking active ANSI state. */
export function truncateAnsi(text: string, maxWidth: number, marker = "…"): string {
  if (maxWidth <= 0) return "";
  if (stringWidth(text) <= maxWidth) return closeAnsiState(text);

  const takePlain = (value: string, widthLimit: number) => {
    let width = 0;
    let result = "";
    for (const grapheme of iterateGraphemes(value)) {
      const nextWidth = graphemeWidth(grapheme);
      if (width + nextWidth > widthLimit) break;
      result += grapheme;
      width += nextWidth;
    }
    return result;
  };

  const fittedMarker = takePlain(stripAnsi(marker), maxWidth);
  const contentLimit = maxWidth - stringWidth(fittedMarker);
  let visibleWidth = 0;
  let result = "";
  outer: for (const segment of splitAnsi(text)) {
    if (segment.ansi) {
      result += segment.text;
      continue;
    }
    for (const grapheme of iterateGraphemes(segment.text)) {
      const nextWidth = graphemeWidth(grapheme);
      if (visibleWidth + nextWidth > contentLimit) break outer;
      result += grapheme;
      visibleWidth += nextWidth;
    }
  }
  return closeAnsiState(result + fittedMarker);
}

/**
 * Returns true for zero-width code points: combining marks, joiners,
 * variation selectors, and other format characters that should not
 * advance the cursor.
 */
function isZeroWidth(code: number): boolean {
  return (
    code === 0x200b || // zero-width space
    code === 0x200c || // zero-width non-joiner
    code === 0x200d || // zero-width joiner
    code === 0xfeff || // zero-width no-break space (BOM)
    (code >= 0x0300 && code <= 0x036f) || // combining diacritical marks
    (code >= 0x0483 && code <= 0x0489) || // combining Cyrillic
    (code >= 0x0591 && code <= 0x05bd) || // Hebrew points
    (code >= 0x0610 && code <= 0x061a) || // Arabic
    (code >= 0x064b && code <= 0x065f) ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x1ab0 && code <= 0x1aff) || // combining diacritical marks extended
    (code >= 0x1dc0 && code <= 0x1dff) || // combining diacritical marks supplement
    (code >= 0x20d0 && code <= 0x20ff) || // combining marks for symbols
    (code >= 0xfe00 && code <= 0xfe0f) || // variation selectors
    (code >= 0xfe20 && code <= 0xfe2f) || // combining half marks
    (code >= 0xe0100 && code <= 0xe01ef) // variation selectors supplement
  );
}

/**
 * Returns true for code points that occupy two terminal columns:
 * East Asian wide/fullwidth characters and emoji.
 */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2329 && code <= 0x232a) || // angle brackets
    code === 0x231a || // watch
    code === 0x231b || // hourglass
    code === 0x2b50 || // star
    code === 0x2b55 || // heavy circle
    (code >= 0x2e80 && code <= 0xa4cf) || // CJK radicals … Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe10 && code <= 0xfe19) || // vertical forms
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) || // fullwidth signs
    (code >= 0x1f000 && code <= 0x1f2ff) || // mahjong, dominoes, cards, enclosed (incl. regional indicators U+1F1E6–1F1FF)
    (code >= 0x1f300 && code <= 0x1f64f) || // misc symbols & emoticons
    (code >= 0x1f680 && code <= 0x1f6ff) || // transport & map symbols
    (code >= 0x1f900 && code <= 0x1f9ff) || // supplemental symbols & pictographs
    (code >= 0x1fa70 && code <= 0x1faff) || // symbols & pictographs extended-A
    (code >= 0x20000 && code <= 0x2fffd) || // CJK unified ideographs extension B–F
    (code >= 0x30000 && code <= 0x3fffd) // CJK unified ideographs extension G+
  );
}

function getCharWidth(code: number): number {
  // C0 control characters (incl. NUL), DEL, and C1 control characters occupy no
  // columns. ANSI escape sequences are stripped before measuring; this only
  // covers stray raw control bytes (e.g. BEL) left in the input.
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 0;
  if (isZeroWidth(code)) return 0;
  if (isWide(code)) return 2;
  return 1;
}

import type { Writable } from "node:stream";
import { describeReceived, usageError } from "../errors.js";

// ── ANSI codes ──

/** The name of a built-in style, as accepted by {@link color} and the template tag. */
export type StyleName =
  | "bold"
  | "dim"
  | "italic"
  | "underline"
  | "inverse"
  | "strikethrough"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "grey"
  | "bgRed"
  | "bgGreen"
  | "bgYellow"
  | "bgBlue"
  | "bgMagenta"
  | "bgCyan"
  | "bgWhite";

/**
 * A style, or a dot-separated chain of styles, as taken by options such as a
 * progress bar color. The first two links are checked by the type system; any
 * further link is checked when the value is used.
 */
export type StyleSpec =
  | StyleName
  | `${StyleName}.${StyleName}`
  | `${StyleName}.${StyleName}.${string}`;

/**
 * Mapping of style names to their ANSI open/close code pairs.
 * Each entry is a tuple of [openCode, closeCode].
 */
const styles: Record<StyleName, [number, number]> = {
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
 *
 * @param value - Any value; non-objects are never TTYs.
 * @returns True when `value` is an object whose `isTTY` is `true`.
 */
export function isTTY(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && (value as { isTTY?: unknown }).isTTY === true
  );
}

/** Throws the `ERR_INVALID_ARG_TYPE` error for a non-string `text` argument. */
function assertText(fn: string, name: string, value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "${name}" argument of ${fn}() must be a string. Received ${describeReceived(value)}`,
    );
  }
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
 * When this is false, every style is dropped, modifiers such as `bold` and
 * `underline` included: `NO_COLOR` and `setColorEnabled(false)` stop all styling,
 * not only colours.
 *
 * @param stream - Optional output stream to evaluate. Defaults to `process.stdout`.
 * @returns Whether color escape codes should be emitted.
 */
export function isColorEnabled(stream?: Writable): boolean {
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
  return isTTY(target);
}

/**
 * Explicitly enable or disable color output, or restore automatic detection.
 * An explicit boolean overrides TTY/environment detection; `"auto"` returns to
 * detection (TTY, NO_COLOR, FORCE_COLOR, TERM variables).
 *
 * With `false` (or `NO_COLOR`) every style is dropped, modifiers such as `bold`
 * included.
 *
 * @param value - `true` or `false` to force color on or off, `"auto"` to detect.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `value` is neither a boolean nor a string.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `value` is a string other than `"auto"`.
 */
export function setColorEnabled(value: boolean | "auto"): void {
  if (typeof value !== "boolean" && typeof value !== "string") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "value" argument of setColorEnabled() must be true, false or "auto". Received ${describeReceived(value)}`,
    );
  }
  if (typeof value === "string" && value !== "auto") {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "value" argument of setColorEnabled() must be true, false or "auto". Received ${describeReceived(value)}`,
    );
  }
  _enabled = value === "auto" ? null : value;
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
export type ColorFn = ((text: string) => string) & { readonly [K in StyleName]: ColorFn };

/** The object behind {@link color} and {@link createColorizer}: one chainable {@link ColorFn} per style. */
export type Colorizer = { readonly [K in StyleName]: ColorFn };

/**
 * True when `name` is one of the built-in style names. Callers that resolve a
 * style chosen by option (table borders and headers, bar colour) check here so
 * inherited members such as `toString` never resolve. Any other value, including
 * a non-string, yields false.
 *
 * @param value - The value to test.
 * @returns Whether `value` is a {@link StyleName}.
 */
export function isStyleName(value: unknown): value is StyleName {
  return typeof value === "string" && Object.hasOwn(styles, value);
}

/**
 * String-keyed properties the language and the runtime read on their own, without
 * the holder ever writing them: awaiting a value reads `then`, string coercion
 * reads `toString` and `valueOf`, and serialization reads `toJSON`. Treating them
 * as style names would turn passing a colorizer through an `await`, a template
 * literal, or `JSON.stringify` into a crash naming a property nobody typed.
 */
const protocolProperties = new Set(["then", "toString", "valueOf", "toJSON", "constructor"]);

function styleTrap<T extends object>(
  target: T,
  prop: string | symbol,
  resolve: (name: StyleName) => ColorFn,
): unknown {
  // Symbols are protocol hooks too, so they never name a style.
  if (typeof prop !== "string" || protocolProperties.has(prop)) return Reflect.get(target, prop);
  if (!isStyleName(prop)) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `Unknown style: ${prop}. Valid styles: ${Object.keys(styles).join(", ")}`,
    );
  }
  return resolve(prop);
}

function createChain(accumulated: [number, number][], isEnabled: () => boolean): ColorFn {
  const apply = (text: string): string => applyStyle(text, accumulated, isEnabled());

  return new Proxy(apply, {
    get: (target, prop) =>
      styleTrap(target, prop, (name) => createChain([...accumulated, styles[name]], isEnabled)),
  }) as ColorFn;
}

function createColorProxy(isEnabled: () => boolean): Colorizer {
  return new Proxy({} as Colorizer, {
    get: (target, prop) =>
      styleTrap(target, prop, (name) => createChain([styles[name]], isEnabled)),
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
export const color: Colorizer = createColorProxy(() => isColorEnabled());

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
export function createColorizer(stream: Writable): Colorizer {
  return createColorProxy(() => isColorEnabled(stream));
}

// ── Template tag ──

function templateTag(isEnabled: () => boolean): ColorTag {
  return (strings, ...values) => formatTemplate(isEnabled(), strings, values);
}

/**
 * A tagged template literal that applies `{styleName text}` markup.
 *
 * Markup rules:
 * - `{style text}` styles `text`; chain styles with dots, as in `{bold.red text}`.
 * - Markup nests, up to 64 levels.
 * - A brace that does not start with a known style name and a space, or that is
 *   never closed, stays literal text.
 * - Interpolated `${values}` are converted with `String()` and inserted
 *   verbatim; they are never parsed as markup.
 * - With colour disabled the markup is removed and plain text is returned.
 *
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when markup nests deeper than 64 levels.
 *
 * @example
 * ```ts
 * const tag: ColorTag = createColorTag(process.stderr);
 * tag`{bold.red Error}: ${message}`;
 * ```
 */
export type ColorTag = (strings: TemplateStringsArray, ...values: unknown[]) => string;

/**
 * Creates a tagged template literal for inline color formatting whose
 * enablement is tied to a specific output stream.
 *
 * Use `{styleName text}` syntax inside the template to apply styles.
 * Dot-separated style names are supported for chaining, and markup nests. A
 * brace that does not start with a known style name followed by a space, or that
 * is never closed, is kept as literal text. Interpolated values are inserted
 * verbatim and never parsed as markup.
 *
 * @param stream - The output stream the text will be written to.
 * @returns A template tag that emits escapes only when color is enabled for `stream`.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when markup nests deeper than 64 levels (thrown by the returned tag).
 *
 * @example
 * ```ts
 * const e = createColorTag(process.stderr);
 * e`{bold.red Error}: something went wrong`;
 * ```
 */
export function createColorTag(stream: Writable): ColorTag {
  return templateTag(() => isColorEnabled(stream));
}

/**
 * Tagged template literal for inline color formatting, bound to `process.stdout`.
 * Use {@link createColorTag} to bind another stream.
 *
 * Use `{styleName text}` syntax to apply styles; dot-separated names chain
 * (`{bold.red text}`) and markup nests. A brace that does not start with a known
 * style name followed by a space, or that is never closed, stays literal text.
 * Interpolated values are inserted verbatim and never parsed as markup.
 *
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when markup nests deeper than 64 levels.
 *
 * @example
 * ```ts
 * colorTag`Status: {green OK}, {bold.red ${count} failed}`;
 * ```
 */
export const colorTag: ColorTag = templateTag(() => isColorEnabled());

function formatTemplate(
  enabled: boolean,
  strings: TemplateStringsArray,
  values: unknown[],
): string {
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

  const formatInline = (
    text: string,
    nesting = 0,
    activeCodes: [number, number][] = [],
  ): string => {
    if (nesting > 64) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        "Inline color markup nesting exceeds 64 levels",
      );
    }
    let result = "";
    for (let i = 0; i < text.length; i++) {
      const token = tokens.find((candidate) => text.startsWith(candidate, i));
      if (token) {
        // Values are substituted after inline styles have been rendered. If an
        // interpolated ANSI fragment closes a shared color/style code, reopen
        // every surrounding inline style before the following literal text.
        // With color disabled no style was ever opened, so reopening one would
        // put escapes into output that must be plain.
        result += token;
        if (enabled) result += activeCodes.map(([open]) => `\x1b[${open}m`).join("");
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
      if (names.length === 0 || !names.every(isStyleName)) {
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
    // A replacer function inserts the value verbatim; a replacement string
    // would expand `$&`, `$$` and the other substitution patterns.
    result = result.replaceAll(tokens[index], () => valueStrings[index]);
  }
  return result;
}

// ── Strip ANSI ──

/**
 * ECMA-48 escape-sequence grammar: an introducer, a body and a terminator per
 * kind. Every scanner in this module classifies sequences through the patterns
 * built from this one table. Control strings take 7-bit introducers only, since
 * their body runs to ST and a stray 8-bit introducer would swallow the text.
 */
const ansiGrammar = {
  /** CSI: parameter bytes 0x30-0x3F, intermediate bytes 0x20-0x2F, one final byte. */
  csi: {
    open: String.raw`(?:\x1b\[|\x9b)`,
    body: String.raw`[\x30-\x3f]*[\x20-\x2f]*`,
    close: String.raw`[\x40-\x7e]`,
  },
  /** OSC: payload up to BEL or ST; any other ESC aborts it. */
  osc: {
    open: String.raw`\x1b\]`,
    body: String.raw`[^\x07\x1b]*`,
    close: String.raw`(?:\x07|\x1b\\)`,
  },
  /** DCS, SOS, PM and APC: payload up to ST. */
  controlString: {
    open: String.raw`\x1b[PX^_]`,
    body: String.raw`[^\x1b]*`,
    close: String.raw`\x1b\\`,
  },
  /** Any other escape: intermediate bytes, then one final byte. */
  escape: {
    open: String.raw`\x1b`,
    body: String.raw`[\x20-\x2f]*`,
    close: String.raw`[\x30-\x7e]`,
  },
};

const grammarParts = Object.values(ansiGrammar);

/**
 * Matches one escape sequence, complete or cut off (an incomplete one runs to
 * the next ESC or the end of input, as a terminal would consume it).
 */
const ansiRegex = new RegExp(
  grammarParts.map(({ open, body, close }) => `${open}${body}(?:${close})?`).join("|"),
  "g",
);

/** Matches a whole segment that is a complete escape sequence. */
const completeAnsiPattern = new RegExp(
  `^(?:${grammarParts.map(({ open, body, close }) => `${open}${body}${close}`).join("|")})$`,
);

/** SGR: a CSI with only digit, `;` and `:` parameters and final `m`. Captures the parameters. */
const sgrPattern = new RegExp(`^${ansiGrammar.csi.open}([0-9;:]*)m$`);

/** OSC 8 hyperlink, terminated or not. Captures the params field and the URI. */
const hyperlinkPattern = new RegExp(
  `^${ansiGrammar.osc.open}8;([^;\\x07\\x1b]*);(${ansiGrammar.osc.body})(?:${ansiGrammar.osc.close})?$`,
);

/** String terminator; also aborts a cut-off CSI or escape. */
const stringTerminator = "\x1b\\";

/**
 * Remove all ANSI escape sequences from the given string.
 *
 * Handles CSI sequences (colour, cursor, erase), OSC sequences, DCS/SOS/PM/APC
 * control strings and every other escape.
 *
 * @param text - A string potentially containing ANSI codes.
 * @returns The input string with all ANSI escape sequences removed.
 */
export function stripAnsi(text: string): string {
  assertText("stripAnsi", "text", text);
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
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `text` is not a string.
 */
export function splitAnsi(text: string): readonly AnsiSegment[] {
  assertText("splitAnsi", "text", text);
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
 * True for C0 controls, DEL, and C1 controls. None of them occupy a terminal
 * column, and none may reach a rendered region as literal bytes. Every consumer
 * shares this one boundary so a change to it cannot apply to only some of them.
 */
export function isControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/**
 * Splits an SGR parameter body into its parameters, each carrying its own
 * sub-parameters. Both spellings of an extended colour reach this function —
 * `38;2;r;g;b` as five parameters and `38:2:cs:r:g:b` as one parameter with
 * sub-parameters — so callers can tell them apart instead of mistaking a
 * colon-separated colour for a stray reset.
 */
function parseSgrParameters(body: string): number[][] {
  return body
    .split(";")
    .map((parameter) => parameter.split(":").map((value) => (value === "" ? 0 : Number(value))));
}

/** Options for {@link sanitizeTerminalText}. */
export interface SanitizeTerminalTextOptions {
  /** Collapse newlines to spaces. Defaults to true. */
  singleLine?: boolean | undefined;
  /** Keep complete OSC 8 hyperlinks. Defaults to true. */
  allowHyperlinks?: boolean | undefined;
}

/**
 * Sanitizes text before it is rendered inside a structured terminal UI.
 *
 * SGR styling and OSC 8 hyperlinks are preserved. Cursor movement, screen
 * clearing, title changes, and every other escape sequence are removed. Visible
 * C0/C1 controls are either collapsed to spaces in single-line mode or dropped.
 * Any SGR style or OSC 8 hyperlink the text leaves open is closed at the end.
 *
 * @param text - The untrusted text.
 * @param options - Newline and hyperlink handling.
 * @returns The sanitized text.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `text` is not a string, or `options` or one of its flags has the wrong type.
 */
export function sanitizeTerminalText(
  text: string,
  options: SanitizeTerminalTextOptions = {},
): string {
  assertText("sanitizeTerminalText", "text", text);
  if (typeof options !== "object" || options === null) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "options" argument of sanitizeTerminalText() must be an object. Received ${describeReceived(options)}`,
    );
  }
  for (const flag of ["singleLine", "allowHyperlinks"] as const) {
    if (options[flag] !== undefined && typeof options[flag] !== "boolean") {
      throw usageError(
        "type",
        "ERR_INVALID_ARG_TYPE",
        `The "${flag}" option of sanitizeTerminalText() must be a boolean. Received ${describeReceived(options[flag])}`,
      );
    }
  }
  const { singleLine = true, allowHyperlinks = true } = options;
  const sanitized = splitAnsi(text)
    .map((segment) => {
      if (segment.ansi) {
        if (sgrPattern.test(segment.text)) return segment.text;
        if (
          allowHyperlinks &&
          hyperlinkPattern.test(segment.text) &&
          completeAnsiPattern.test(segment.text)
        ) {
          return segment.text;
        }
        return "";
      }

      let result = "";
      // Windows line endings collapse to a bare newline so the carriage return
      // below does not leave a trailing space on every line.
      const text = singleLine ? segment.text : segment.text.replace(/\r\n/g, "\n");
      for (const character of text) {
        const code = character.codePointAt(0) as number;
        if (code === 0x0a) {
          // A newline is the one whitespace control that carries structure, so
          // it survives unless the caller asked for a single line.
          result += singleLine ? " " : "\n";
        } else if (code === 0x09 || code === 0x0b || code === 0x0c || code === 0x0d) {
          // Tab, vertical tab, form feed and carriage return can reposition the
          // cursor, so none of them are emitted; each becomes a space rather
          // than nothing, because dropping them would join words the input kept
          // apart — which is how a stack trace turned into "Error:file".
          result += " ";
        } else if (isControlCode(code)) {
          // Drop remaining C0 controls, DEL, and C1 controls.
        } else {
          result += character;
        }
      }
      return result;
    })
    .join("");
  return closeAnsiState(sanitized);
}

/**
 * Prepares an untrusted string for a rendered terminal region. Strips every
 * escape sequence except SGR styling and OSC 8 links, drops raw control bytes,
 * and closes any styling or link the string leaves open.
 *
 * This is the one boundary a caller-supplied string crosses before it can reach
 * a terminal, so a renderer cannot leave the terminal in a state its own frame
 * did not intend.
 */
export function renderSafe(text: string, options: { singleLine?: boolean } = {}): string {
  return sanitizeTerminalText(text, options);
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
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `text` is not a string.
 */
export function stringWidth(text: string): number {
  assertText("stringWidth", "text", text);
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
    width = Math.max(width, getCharWidth(char));
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

/**
 * Splits visible text into user-perceived grapheme clusters.
 *
 * The input must not contain escape sequences: an escape is split like any other
 * text, so its bytes would count as graphemes. Split with {@link splitAnsi}
 * first, then split only the segments whose `ansi` is false.
 *
 * @param text - Visible text without escape sequences.
 * @returns The grapheme clusters in input order.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `text` is not a string.
 *
 * @example
 * ```ts
 * splitAnsi(input).flatMap((s) => (s.ansi ? [s.text] : splitGraphemes(s.text)));
 * ```
 */
export function splitGraphemes(text: string): readonly string[] {
  assertText("splitGraphemes", "text", text);
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

/** Consecutive integers from `from` to `to`, inclusive. */
function codeSpan(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}

/**
 * SGR attributes as `[reset, opening codes]`: each reset ends only its own
 * attribute, so closing one never ends a style an outer layer opened.
 */
const sgrAttributes: [reset: number, opens: number[]][] = [
  [22, [1, 2]],
  [23, [3, 20]],
  [24, [4, 21]],
  [25, [5, 6]],
  [27, [7]],
  [28, [8]],
  [29, [9]],
  [10, codeSpan(11, 19)],
  [39, [...codeSpan(30, 38), ...codeSpan(90, 97)]],
  [49, [...codeSpan(40, 48), ...codeSpan(100, 107)]],
  [50, [26]],
  [54, [51, 52]],
  [55, [53]],
  [59, [58]],
  [65, codeSpan(60, 64)],
  [75, [73, 74]],
];

const sgrResetFor = new Map(
  sgrAttributes.flatMap(([reset, opens]) => opens.map((code) => [code, reset])),
);
const sgrResets = new Set(sgrAttributes.map(([reset]) => reset));

/**
 * Applies one SGR parameter body to `owed`, the set of reset codes needed to
 * return to the default state. A code with no targeted reset owes `0`.
 */
function trackSgr(body: string, owed: Set<number>): void {
  const params = parseSgrParameters(body);
  for (let index = 0; index < params.length; index++) {
    const parameter = params[index];
    const code = parameter[0];
    if (code === 0) {
      owed.clear();
    } else if (sgrResets.has(code)) {
      owed.delete(code);
    } else if (code === 4 && parameter[1] === 0) {
      // 4:0 is the colon spelling of "underline off".
      owed.delete(24);
    } else {
      owed.add(sgrResetFor.get(code) ?? 0);
      // The colon spelling carries the whole colour spec as sub-parameters of
      // this one parameter; the semicolon spelling spreads it across the
      // parameters that follow.
      if ((code === 38 || code === 48 || code === 58) && parameter.length === 1) {
        const mode = params[index + 1]?.[0];
        index += mode === 2 ? 4 : mode === 5 ? 2 : 0;
      }
    }
  }
}

/**
 * Appends the escapes that return the terminal to its default state at the end
 * of `text`: ST for a sequence the text cuts off, an OSC 8 close for a link
 * left open (whatever its params), and the targeted reset of each SGR attribute
 * left set. A full reset is emitted only for an SGR code that has no targeted
 * reset. Structured renderers use this at cell boundaries so untrusted content
 * cannot style or link their frame.
 */
export function closeAnsiState(text: string): string {
  const owed = new Set<number>();
  let hyperlinkOpen = false;
  let last: AnsiSegment | undefined;

  for (const segment of splitAnsi(text)) {
    last = segment;
    if (!segment.ansi) continue;
    const sgr = sgrPattern.exec(segment.text);
    if (sgr) {
      trackSgr(sgr[1], owed);
      continue;
    }
    const link = hyperlinkPattern.exec(segment.text);
    if (link) hyperlinkOpen = link[2] !== "";
  }

  let suffix = last?.ansi && !completeAnsiPattern.test(last.text) ? stringTerminator : "";
  if (hyperlinkOpen) suffix += `\x1b]8;;${stringTerminator}`;
  if (owed.has(0)) {
    suffix += "\x1b[0m";
  } else {
    for (const [reset] of sgrAttributes) if (owed.has(reset)) suffix += `\x1b[${reset}m`;
  }
  return text + suffix;
}

/**
 * Truncates terminal text without splitting graphemes or leaking active ANSI
 * state.
 *
 * @param text - The text to truncate.
 * @param width - Maximum display width in columns: a positive integer, or `Infinity` for no limit.
 * @param ellipsis - Marker appended when the text is cut. Defaults to `"…"`.
 * @returns The text, cut to `width` columns when it is wider.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `text` or `ellipsis` is not a string, or `width` is not a number.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `width` is 0 or negative, NaN, or fractional.
 */
export function truncateAnsi(text: string, width: number, ellipsis = "…"): string {
  assertText("truncateAnsi", "text", text);
  if (typeof width !== "number") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "width" argument of truncateAnsi() must be a number. Received ${describeReceived(width)}`,
    );
  }
  assertText("truncateAnsi", "ellipsis", ellipsis);
  if (width === Number.POSITIVE_INFINITY) return closeAnsiState(text);
  if (!Number.isInteger(width) || width <= 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "width" argument of truncateAnsi() must be a positive integer or Infinity. Received ${width}`,
    );
  }
  if (stringWidth(text) <= width) return closeAnsiState(text);

  const takePlain = (value: string, widthLimit: number) => {
    let used = 0;
    let result = "";
    for (const grapheme of iterateGraphemes(value)) {
      const nextWidth = graphemeWidth(grapheme);
      if (used + nextWidth > widthLimit) break;
      result += grapheme;
      used += nextWidth;
    }
    return result;
  };

  const fittedMarker = takePlain(stripAnsi(ellipsis), width);
  const contentLimit = width - stringWidth(fittedMarker);
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
 * Combining marks (Mn, Me) and format characters (Cf, which includes the
 * zero-width joiners and the BOM) do not advance the cursor.
 */
const zeroWidthPattern = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/**
 * Code points that occupy two columns, as sorted inclusive `[start, end]` pairs:
 * the East_Asian_Width W and F runs of Unicode 17.0 EastAsianWidth.txt with
 * unassigned gaps bridged, plus the regional indicators (Emoji_Presentation).
 */
const wideRanges: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2630, 0x2637],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x268a, 0x268f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x3247],
  [0x3250, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x1b2fb],
  [0x1d300, 0x1d376],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f1e6, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1faf8],
  [0x20000, 0x3fffd],
];

function isWide(code: number): boolean {
  let low = 0;
  let high = wideRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = wideRanges[middle];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return true;
  }
  return false;
}

function getCharWidth(char: string): number {
  const code = char.codePointAt(0) as number;
  // C0 control characters (incl. NUL), DEL, and C1 control characters occupy no
  // columns. ANSI escape sequences are stripped before measuring; this only
  // covers stray raw control bytes (e.g. BEL) left in the input.
  if (isControlCode(code)) return 0;
  // Below U+0300 the only zero-width code point is U+00AD and nothing is wide.
  if (code < 0x300) return code === 0xad ? 0 : 1;
  if (zeroWidthPattern.test(char)) return 0;
  if (isWide(code)) return 2;
  return 1;
}

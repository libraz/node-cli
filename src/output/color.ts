import type { Writable } from "node:stream";

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
function streamIsTTY(stream: Writable): boolean {
  return "isTTY" in stream && (stream as NodeJS.WriteStream).isTTY === true;
}

/**
 * Determines whether color output is enabled.
 *
 * Resolution order: an explicit {@link setColorEnabled} override always wins.
 * Otherwise `NO_COLOR` and `TERM=dumb` force color off, `FORCE_COLOR` forces it
 * on, and finally the target stream's TTY status is consulted. When no stream is
 * given, `process.stdout` is used.
 *
 * @param stream - Optional output stream to evaluate. Defaults to `process.stdout`.
 * @returns Whether color escape codes should be emitted.
 */
export function isColorEnabled(stream?: Writable): boolean {
  if (_enabled !== null) return _enabled;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  if (process.env.TERM === "dumb") return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "0") return true;
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
    // Re-open this style wherever a nested fragment closed it.
    result = openSeq + result.split(closeSeq).join(openSeq) + closeSeq;
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
      // Pass through symbol and inherited props (e.g. then/Symbol.iterator) so
      // the proxy is safe to introspect; only reject misspelled string styles.
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (!Object.hasOwn(styles, prop)) {
        if (prop in target) return Reflect.get(target, prop);
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
        if (prop in target) return Reflect.get(target, prop);
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
export function createColorizer(stream: Writable): Record<string, ColorFn> {
  return createColorProxy(() => isColorEnabled(stream));
}

// ── Template tag ──

const stylePattern = /\{([a-zA-Z.]+)\s([^}]+)\}/g;

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
  let raw = strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""),
    "",
  );

  const enabled = isColorEnabled();
  raw = raw.replace(stylePattern, (_match, styleChain: string, text: string) => {
    const names = styleChain.split(".");
    const codes: [number, number][] = [];
    for (const name of names) {
      if (!Object.hasOwn(styles, name)) throw new Error(`Unknown style: ${name}`);
      codes.push(styles[name]);
    }
    return applyStyle(text, codes, enabled);
  });

  return raw;
}

// ── Strip ANSI ──

/** Regular expression matching ANSI escape sequences (CSI and OSC). */
const ansiRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence matching requires control characters
  /[\x1b\x9b][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

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

// ── String width (East Asian Width aware) ──

/**
 * Calculate the visual display width of a string, accounting for
 * ANSI escape codes (which are stripped), zero-width and combining
 * characters (which occupy no columns), and East Asian wide / emoji
 * characters (which occupy two columns).
 *
 * @param text - The string to measure.
 * @returns The visual column width of the string.
 */
export function stringWidth(text: string): number {
  const stripped = stripAnsi(text);
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0) as number;
    width += getCharWidth(code);
  }
  return width;
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
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2329 && code <= 0x232a) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) || // misc symbols & emoticons
    (code >= 0x1f900 && code <= 0x1f9ff) || // supplemental symbols
    (code >= 0x1fa70 && code <= 0x1faff) || // symbols extended-A
    (code >= 0x2600 && code <= 0x26ff) || // misc symbols
    (code >= 0x2700 && code <= 0x27bf) || // dingbats
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  );
}

function getCharWidth(code: number): number {
  if (code === 0) return 0;
  if (isZeroWidth(code)) return 0;
  if (isWide(code)) return 2;
  return 1;
}

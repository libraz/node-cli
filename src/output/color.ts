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

function isColorEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  if (process.env.NO_COLOR != null) return false;
  if (process.env.TERM === "dumb") return false;
  if (!process.stdout.isTTY) return false;
  return true;
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
 * (TTY, NO_COLOR, TERM variables).
 */
export function resetColorEnabled(): void {
  _enabled = null;
}

// ── Core apply ──

function applyStyle(text: string, codes: [number, number][]): string {
  if (!isColorEnabled()) return text;
  const open = codes.map(([o]) => `\x1b[${o}m`).join("");
  const close = codes.map(([, c]) => `\x1b[${c}m`).join("");
  return `${open}${text}${close}`;
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

function createChain(accumulated: [number, number][]): ColorFn {
  const apply = (text: string): string => applyStyle(text, accumulated);

  return new Proxy(apply, {
    get(_target, prop: string): ColorFn {
      const style = styles[prop];
      if (!style) {
        throw new Error(`Unknown style: ${prop}`);
      }
      return createChain([...accumulated, style]);
    },
  }) as ColorFn;
}

/**
 * Proxy-based color utility. Access any style name as a property to get a
 * chainable {@link ColorFn}. Styles can be chained for combined effects.
 *
 * @example
 * ```ts
 * color.red("error");          // red text
 * color.bold.underline("hi");  // bold + underlined text
 * ```
 */
export const color: Record<string, ColorFn> = new Proxy({} as Record<string, ColorFn>, {
  get(_target, prop: string): ColorFn {
    const style = styles[prop];
    if (!style) {
      throw new Error(`Unknown style: ${prop}`);
    }
    return createChain([style]);
  },
});

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

  raw = raw.replace(stylePattern, (_match, styleChain: string, text: string) => {
    const names = styleChain.split(".");
    const codes: [number, number][] = [];
    for (const name of names) {
      const style = styles[name];
      if (!style) throw new Error(`Unknown style: ${name}`);
      codes.push(style);
    }
    return applyStyle(text, codes);
  });

  return raw;
}

// ── Strip ANSI ──

/** Regular expression matching all ANSI escape sequences. */
const ansiRegex = /\x1b\[[0-9;]*m/g;

/**
 * Remove all ANSI escape sequences from the given string.
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
 * ANSI escape codes (which are stripped) and East Asian wide characters
 * (which occupy two columns).
 *
 * @param text - The string to measure.
 * @returns The visual column width of the string.
 */
export function stringWidth(text: string): number {
  const stripped = stripAnsi(text);
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0)!;
    width += getCharWidth(code);
  }
  return width;
}

function getCharWidth(code: number): number {
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x2fffd) ||
    (code >= 0x30000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

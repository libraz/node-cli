import { AsyncLocalStorage } from "node:async_hooks";
import type { Writable } from "node:stream";
import { describeReceived, usageError } from "../errors.js";
import { finiteInteger, guardCall, MAX_RENDER_WIDTH } from "../guard.js";
import {
  type Colorizer,
  createColorizer,
  isStyleName,
  isTTY,
  renderSafe,
  type StyleSpec,
  stringWidth,
} from "./color.js";
import { canAnimate, type RegionOwner, setRegionOwner } from "./region.js";

// ── Progress Bar ──

/**
 * Configuration options for creating a progress bar.
 */
export interface BarOptions {
  /** Total number of units to track. A finite number of at least 0. */
  total: number;
  /** Text displayed before the bar and used as the default result message. Defaults to `""`. */
  label?: string | undefined;
  /** Width of the bar in characters, from 1 to 4096. Defaults to 30. */
  width?: number | undefined;
  /** Character for the filled portion of the bar; its display width must be 1. Defaults to `"█"`. */
  filled?: string | undefined;
  /** Character for the empty portion of the bar; its display width must be 1. Defaults to `"░"`. */
  empty?: string | undefined;
  /**
   * Custom renderer that receives the bar state and returns the whole line. It
   * replaces the default line, so `width`, `filled`, `empty` and `style` are not
   * used; `label` still supplies the default result message. The returned text
   * is reduced to one terminal-safe line. If it throws, the bar (or the group
   * that holds it) releases the terminal, becomes inert, and the error
   * propagates from the call that triggered the redraw. Defaults to the built-in line.
   */
  format?: ((state: BarState) => string) | undefined;
  /** Output stream for rendering. Defaults to `process.stderr`. */
  stderr?: Writable | undefined;
  /** Style applied to the bar, such as `"green"` or `"bold.cyan"`. An unknown name throws at creation. Defaults to unstyled. */
  style?: StyleSpec | undefined;
}

/**
 * A read-only snapshot of a progress bar, passed to {@link BarOptions.format}.
 */
export interface BarState {
  /** Current progress value, from 0 to `total`. */
  readonly current: number;
  /** Total target value. */
  readonly total: number;
  /** Completion percentage as an integer from 0 to 100; 100 when `total` is 0. */
  readonly percent: number;
  /** Elapsed time in milliseconds since the bar was created. */
  readonly elapsedMs: number;
  /**
   * Estimated time remaining in milliseconds: `Infinity` until some progress has
   * been made, and 0 once complete. Guard it with `Number.isFinite` before formatting.
   */
  readonly etaMs: number;
  /** Average units per second since the bar was created; 0 before any time has elapsed. */
  readonly ratePerSecond: number;
}

/**
 * Interface for controlling a progress bar instance.
 *
 * The bar starts drawing when it is created. Every terminal verb ends it, and
 * calling any method afterwards does nothing; arguments are still validated.
 */
export interface Bar {
  /**
   * Sets the progress to the specified absolute value, clamped to 0..`total`.
   * A `NaN` or infinite value is ignored and leaves the progress unchanged.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `current` is not a number.
   */
  update(current: number): void;
  /**
   * Increments the progress by `delta` (defaults to 1), clamped to 0..`total`.
   * A `NaN` or infinite result is ignored and leaves the progress unchanged.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `delta` is not a number.
   */
  tick(delta?: number): void;
  /**
   * Replaces the label drawn before the bar and used as the default result message.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `label` is not a string.
   */
  setLabel(label: string): void;
  /**
   * Completes the bar, replacing it with a success line of `message ?? label` (`✔`, or `[OK]` where symbols cannot be drawn).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  succeed(message?: string): void;
  /**
   * Stops the bar at its current position and replaces it with a failure line of `message ?? label` (`✖`, or `[ERROR]`).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  fail(message?: string): void;
  /**
   * Stops the bar at its current position and replaces it with a warning line of `message ?? label` (`⚠`, or `[WARN]`).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  warn(message?: string): void;
  /**
   * Leaves the last frame in place and ends the line. Writes nothing on a stream
   * that cannot animate (non-TTY or `TERM=dumb`). For a bar in a {@link MultiBar},
   * it freezes that bar's row at its current position; the group's own verbs then
   * skip the row, and the group keeps drawing the others.
   */
  stop(): void;
  /** Same as `stop()`: called when a `using` scope is left; leaves the last frame and writes nothing on a stream that cannot animate. Call succeed/fail/warn first for a result line. */
  [Symbol.dispose](): void;
}

// ── Spinner ──

/**
 * Configuration options for creating a spinner.
 */
export interface SpinnerOptions {
  /** Text label displayed next to the spinner. Defaults to `""`. */
  label?: string | undefined;
  /** Animation frames, each drawn whole (any width). Defaults to a dots pattern. Must not be empty. */
  frames?: readonly string[] | undefined;
  /** Animation interval in milliseconds. A finite number above 0. Defaults to 80. */
  intervalMs?: number | undefined;
  /** Output stream for rendering. Defaults to `process.stderr`. */
  stderr?: Writable | undefined;
  /** Style applied to the spinner frame, such as `"cyan"`. An unknown name throws at creation. Defaults to unstyled. */
  style?: StyleSpec | undefined;
}

/**
 * Interface for controlling a spinner instance.
 *
 * The spinner starts animating when it is created. Every terminal verb ends it,
 * and calling any method afterwards does nothing; arguments are still validated.
 */
export interface Spinner {
  /**
   * Replaces the label text shown next to the spinner; it also becomes the default result message.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `label` is not a string.
   */
  setLabel(label: string): void;
  /**
   * Replaces the spinner with a success line of `message ?? label` (`✔`, or `[OK]` where symbols cannot be drawn).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  succeed(message?: string): void;
  /**
   * Replaces the spinner with a failure line of `message ?? label` (`✖`, or `[ERROR]`).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  fail(message?: string): void;
  /**
   * Replaces the spinner with a warning line of `message ?? label` (`⚠`, or `[WARN]`).
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  warn(message?: string): void;
  /** Leaves the last frame in place and ends the line. Writes nothing on a stream that cannot animate. */
  stop(): void;
  /** Same as `stop()`: called when a `using` scope is left; leaves the last frame and writes nothing on a stream that cannot animate. Call succeed/fail/warn first for a result line. */
  [Symbol.dispose](): void;
}

// ── MultiBar ──

/**
 * Configuration options for a multi-bar group.
 */
export interface MultiBarOptions {
  /** Output stream shared by every bar in the group. Defaults to `process.stderr`. */
  stderr?: Writable | undefined;
}

/**
 * Interface for managing multiple progress bars rendered simultaneously.
 *
 * A terminal verb applies the same verb to every bar that has not ended, then
 * closes the group; an optional `message` is written as one unmarked final line.
 */
export interface MultiBar {
  /**
   * Adds a new progress bar drawn in the group's stream and returns its handle.
   * Returns an inert handle once the group is closed.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a wrongly typed option.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an out-of-range option.
   */
  add(options: Omit<BarOptions, "stderr">): Bar;
  /**
   * Completes every unfinished bar with a success mark and closes the group.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  succeed(message?: string): void;
  /**
   * Ends every unfinished bar with a failure mark and closes the group.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  fail(message?: string): void;
  /**
   * Ends every unfinished bar with a warning mark and closes the group.
   *
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` if `message` is neither undefined nor a string.
   */
  warn(message?: string): void;
  /** Leaves the last frame in place and ends the line. Writes nothing on a stream that cannot animate. */
  stop(): void;
  /** Same as `stop()`: called when a `using` scope is left; leaves the last frame and writes nothing on a stream that cannot animate. Call succeed/fail/warn first for a result line. */
  [Symbol.dispose](): void;
}

// ── Patterns ──

const patterns = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  line: ["-", "\\", "|", "/"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
};

/**
 * Prepares caller-supplied text for a single rendered row: no control bytes, no
 * line breaks, and no styling left open to bleed into the rest of the frame.
 */
function safeLine(text: string): string {
  return renderSafe(text);
}

/** Applies a validated style chain such as `bold.cyan`; a failing colorizer leaves the text as is. */
function applyColor(colorizer: Colorizer, spec: StyleSpec | undefined, text: string): string {
  if (spec === undefined) return text;
  return guardCall(
    () => {
      let node = colorizer as unknown as Record<string, unknown>;
      for (const name of spec.split(".")) node = node[name] as Record<string, unknown>;
      return (node as unknown as (text: string) => string)(text);
    },
    () => text,
  );
}

/** Physical terminal rows a single logical line occupies once it wraps. */
function wrappedRows(line: string, stream: Writable): number {
  return Math.max(1, Math.ceil(stringWidth(line) / ((stream as NodeJS.WriteStream).columns || 80)));
}

function createFrameWriter(stream: Writable): {
  write: (frame: string) => void;
  final: (frame: string) => void;
  clear: () => void;
} {
  let waitingForDrain = false;
  let pending: string | null = null;

  const write = (frame: string) => {
    if (waitingForDrain) {
      pending = frame;
      return;
    }
    if (!stream.write(frame)) {
      waitingForDrain = true;
      stream.once("drain", () => {
        waitingForDrain = false;
        const next = pending;
        pending = null;
        if (next !== null) write(next);
      });
    }
  };

  return {
    write,
    final(frame) {
      pending = null;
      stream.write(frame);
    },
    clear() {
      pending = null;
    },
  };
}

type TerminalSession = { users: number };

const terminalSessions = new WeakMap<Writable, TerminalSession>();
type IndicatorKind = "spinner" | "bar" | "multi-bar";

const visualOwners = new WeakMap<Writable, { owner: symbol; kind: IndicatorKind }>();
const activeIndicators = new Set<() => void>();
const progressScope = new AsyncLocalStorage<Set<() => void>>();

/**
 * Records a live indicator's release function, in the process-wide registry and
 * in the progress scope of the current async context, if there is one.
 *
 * @returns A function that forgets the indicator again.
 */
function registerIndicator(release: () => void): () => void {
  activeIndicators.add(release);
  const scope = progressScope.getStore();
  scope?.add(release);
  return () => {
    activeIndicators.delete(release);
    scope?.delete(release);
  };
}

/**
 * Runs `fn` and, once it settles (resolved or rejected), releases only the bars,
 * spinners and multi-bars created inside its async context. Indicators created
 * elsewhere, including by a concurrent call, keep running. A nested call has its
 * own scope. Not exported from the package root: the router and the shell wrap
 * command execution in it, and {@link releaseAll} stays the explicit
 * process-wide reset.
 *
 * @param fn - The work whose indicators should not outlive it.
 * @returns What `fn` resolves to.
 */
export async function runWithProgressScope<T>(fn: () => Promise<T>): Promise<T> {
  const owned = new Set<() => void>();
  try {
    return await progressScope.run(owned, fn);
  } finally {
    for (const release of [...owned]) {
      try {
        release();
      } catch {
        // Keep releasing the rest even if one stream has failed.
      }
    }
  }
}

/**
 * Stops every active progress indicator in the process, whatever created it, and
 * shows the cursor again. Prefer letting command execution release only its own
 * indicators; call this for an explicit process-wide reset.
 */
export function releaseAll(): void {
  for (const release of [...activeIndicators]) {
    try {
      release();
    } catch {
      // Keep cleaning the remaining indicators even if one stream has failed.
    }
  }
  restoreCursor();
}

/**
 * Streams that currently have their cursor hidden. Tracked separately from the
 * per-stream session map (a WeakMap is not iterable) so {@link restoreCursor}
 * can re-show the cursor everywhere on an abrupt exit.
 */
const cursorHiddenStreams = new Set<Writable>();
let exitRestoreRegistered = false;
const cursorRestoreSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const cursorSignalHandlers = new Map<NodeJS.Signals, () => void>();

/**
 * Re-shows the cursor on every stream that currently has it hidden and forgets
 * those streams. Safe to call repeatedly. Registered on `process.exit` and also
 * exposed so the command router can invoke it from its force-quit / SIGINT path,
 * ensuring a Ctrl-C (or uncaught crash) during a spinner or progress bar never
 * leaves the terminal cursor invisible.
 */
export function restoreCursor(): void {
  for (const stream of cursorHiddenStreams) {
    try {
      stream.write("\x1b[?25h");
    } catch {
      // Best-effort: the stream may already be gone during teardown.
    }
  }
  cursorHiddenStreams.clear();
  removeSignalRestore();
  removeExitRestore();
}

/** Removes the standalone signal handlers installed for hidden cursors. */
function removeSignalRestore(): void {
  for (const [signal, handler] of cursorSignalHandlers) {
    process.removeListener(signal, handler);
  }
  cursorSignalHandlers.clear();
}

/**
 * Restores a cursor for standalone progress renderers before reproducing the
 * terminating signal. CLI command execution installs its own cancellation
 * handlers first, so it remains responsible for cooperative cancellation.
 */
function registerSignalRestore(): void {
  for (const signal of cursorRestoreSignals) {
    if (cursorSignalHandlers.has(signal)) continue;
    // Do not supersede an embedding application's policy for THIS signal, or the
    // router's cooperative Ctrl-C handler installed around command execution.
    // Each signal is judged on its own: a listener on one of them must not
    // suppress cursor restoration for the other two, which is what happens for
    // the whole lifetime of an interactive shell session otherwise.
    if (process.listenerCount(signal) > 0) continue;
    const handler = () => {
      restoreCursor();
      // Signal delivery is asynchronous; re-send only after our listeners have
      // been removed so Node performs its normal default termination.
      setImmediate(() => process.kill(process.pid, signal));
    };
    cursorSignalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
}

/** Removes the last-chance exit handler once no cursor is hidden any more. */
function removeExitRestore(): void {
  if (!exitRestoreRegistered) return;
  exitRestoreRegistered = false;
  process.removeListener("exit", restoreCursor);
}

/**
 * Lazily installs a last-chance cursor-restore on process exit. `exit` handlers
 * cannot do async work, but a synchronous escape-sequence write is fine. No
 * SIGINT handler is installed here on purpose: that would suppress Node's default
 * termination for standalone spinner use; SIGINT-time restore is driven by the
 * router, which owns signal handling during command execution.
 */
function registerExitRestore(): void {
  if (exitRestoreRegistered) return;
  exitRestoreRegistered = true;
  process.once("exit", restoreCursor);
}

/** Shares cursor ownership between every indicator writing to the same stream. */
function acquireTerminal(stream: Writable): () => void {
  if (!isTTY(stream)) return () => {};

  let session = terminalSessions.get(stream);
  if (!session) {
    session = { users: 0 };
    terminalSessions.set(stream, session);
  }
  session.users++;
  if (session.users === 1) {
    stream.write("\x1b[?25l");
    cursorHiddenStreams.add(stream);
    registerExitRestore();
    registerSignalRestore();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = terminalSessions.get(stream);
    if (!current) return;
    current.users = Math.max(0, current.users - 1);
    if (current.users === 0) {
      stream.write("\x1b[?25h");
      cursorHiddenStreams.delete(stream);
      terminalSessions.delete(stream);
      if (cursorHiddenStreams.size === 0) {
        removeSignalRestore();
        removeExitRestore();
      }
    }
  };
}

/**
 * Structured progress renderers need exclusive ownership of their terminal
 * region. Multiple standalone renderers cannot infer one another's row layout;
 * callers that need concurrent bars should use progress.multi().
 */
function acquireVisualTerminal(
  stream: Writable,
  owner: symbol,
  kind: IndicatorKind,
  region: RegionOwner,
): () => void {
  if (!canAnimate(stream)) return () => {};
  const current = visualOwners.get(stream);
  if (current && current.owner !== owner) {
    const hint =
      current.kind === "bar" && kind === "bar"
        ? ", or draw concurrent bars with progress.multi()"
        : "";
    throw usageError(
      "state",
      "ERR_OUTPUT_BUSY",
      `A ${current.kind} is already rendering to this stream; finish it with succeed(), fail(), warn() or stop() before starting a ${kind}${hint}`,
    );
  }
  visualOwners.set(stream, { owner, kind });
  // Publish how this renderer steps aside, so a logger or diagnostic writing to
  // the same stream cannot splice its output into a half-drawn frame.
  setRegionOwner(stream, region);
  const releaseCursor = acquireTerminal(stream);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (visualOwners.get(stream)?.owner === owner) {
      visualOwners.delete(stream);
      setRegionOwner(stream, null);
    }
    releaseCursor();
  };
}

function clearStandaloneFrame(renderedRows: number): string {
  if (renderedRows <= 0) return "\r\x1b[K";
  const up = renderedRows > 1 ? `\x1b[${renderedRows - 1}A` : "";
  let frame = `${up}\r`;
  for (let row = 0; row < renderedRows; row++) {
    frame += "\x1b[K";
    if (row < renderedRows - 1) frame += "\x1b[1B\r";
  }
  if (renderedRows > 1) frame += `\x1b[${renderedRows - 1}A`;
  return `${frame}\r`;
}

function progressPercent(current: number, total: number): number {
  return total === 0 ? 100 : Math.min(100, Math.round((current / total) * 100));
}

function progressEta(current: number, total: number, rate: number): number {
  if (current >= total) return 0;
  return rate > 0 ? Math.max(0, ((total - current) / rate) * 1000) : Number.POSITIVE_INFINITY;
}

/** Ignores invalid updates instead of allowing NaN to poison future renders. */
function clampProgressValue(value: number, total: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(value, total));
}

// ── Validation ──

/** Throws the usage error for one rejected option or argument, in Node's message form. */
function reject(
  kind: "type" | "range",
  subject: string,
  name: string,
  noun: "option" | "argument",
  expectation: string,
  value: unknown,
): never {
  throw usageError(
    kind,
    kind === "type" ? "ERR_INVALID_ARG_TYPE" : "ERR_INVALID_ARG_VALUE",
    `The "${name}" ${noun} of ${subject} must be ${expectation}. Received ${describeReceived(value, kind)}`,
  );
}

/** Checks that the options bag itself is an object. */
function checkBag(options: unknown, subject: string): void {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    reject("type", subject, "options", "argument", "an object", options);
  }
}

/** Checks an optional string option and returns it. */
function checkString(value: unknown, name: string, subject: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") reject("type", subject, name, "option", "a string", value);
  return value;
}

/** Checks a style name or dot-separated chain; every segment must be a built-in style. */
function checkStyle(value: unknown, subject: string): void {
  if (value === undefined) return;
  if (typeof value !== "string") reject("type", subject, "style", "option", "a string", value);
  for (const segment of value.split(".")) {
    if (!isStyleName(segment)) {
      reject("range", subject, "style", "option", "a chain of built-in style names", value);
    }
  }
}

/** Resolves the output stream, defaulting to stderr. */
function checkStream(value: unknown, subject: string): Writable {
  if (value === undefined) return process.stderr;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Writable).write !== "function"
  ) {
    reject("type", subject, "stderr", "option", "a writable stream", value);
  }
  return value as Writable;
}

function checkTotal(value: unknown, subject: string): number {
  if (typeof value !== "number") reject("type", subject, "total", "option", "a number", value);
  if (!Number.isFinite(value) || value < 0) {
    reject("range", subject, "total", "option", "a finite number of at least 0", value);
  }
  return value;
}

function checkWidth(value: unknown, subject: string): number {
  if (value === undefined) return 30;
  if (typeof value !== "number") reject("type", subject, "width", "option", "a number", value);
  const whole = value > 0 ? finiteInteger(value, 0) : undefined;
  if (whole === undefined) {
    reject("range", subject, "width", "option", "a positive finite number", value);
  }
  if (whole > MAX_RENDER_WIDTH) {
    reject("range", subject, "width", "option", `at most ${MAX_RENDER_WIDTH}`, value);
  }
  // A fractional width draws its whole part, and never fewer than one cell.
  return Math.max(1, whole);
}

/** Checks a bar glyph: a string that is exactly one cell wide. */
function checkGlyph(value: unknown, name: string, fallback: string, subject: string): string {
  const text = checkString(value, name, subject);
  if (text === undefined) return fallback;
  if (stringWidth(text) !== 1) {
    reject("range", subject, name, "option", "a single character of display width 1", value);
  }
  return text;
}

function checkFormat(value: unknown, subject: string): BarOptions["format"] {
  if (value !== undefined && typeof value !== "function") {
    reject("type", subject, "format", "option", "a function", value);
  }
  return value as BarOptions["format"];
}

function checkFrames(value: unknown, subject: string): readonly string[] {
  if (value === undefined) return patterns.dots;
  if (!Array.isArray(value) || !value.every((frame) => typeof frame === "string")) {
    reject("type", subject, "frames", "option", "an array of strings", value);
  }
  if (value.length === 0) reject("range", subject, "frames", "option", "a non-empty array", value);
  return value;
}

function checkIntervalMs(value: unknown, subject: string): number {
  if (value === undefined) return 80;
  if (typeof value !== "number") reject("type", subject, "intervalMs", "option", "a number", value);
  if (!Number.isFinite(value) || value <= 0) {
    reject("range", subject, "intervalMs", "option", "a positive finite number", value);
  }
  return value;
}

/** Checks the label passed to a handle's `setLabel`. */
function checkLabelArg(value: unknown, subject: string): string {
  if (typeof value !== "string") reject("type", subject, "label", "argument", "a string", value);
  return value;
}

/** Checks the optional message passed to a terminal verb, before any state changes. */
function checkMessageArg(value: unknown, subject: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    reject("type", subject, "message", "argument", "a string", value);
  }
  return value;
}

/** Checks a number passed to a handle's `update` or `tick`; `NaN` is accepted and ignored later. */
function checkNumberArg(value: unknown, name: string, subject: string): number {
  if (typeof value !== "number") reject("type", subject, name, "argument", "a number", value);
  return value;
}

// ── Terminal verbs ──

const verbMarks = {
  succeed: { style: "green", symbol: "✔", ascii: "[OK]" },
  fail: { style: "red", symbol: "✖", ascii: "[ERROR]" },
  warn: { style: "yellow", symbol: "⚠", ascii: "[WARN]" },
} as const;

type Verb = keyof typeof verbMarks;

/**
 * The row that replaces a finished indicator: a marker, then the one-line
 * message. The marker is a symbol where the stream can animate and an ASCII tag
 * elsewhere; colour follows the colorizer's own policy, independently.
 */
function resultLine(col: Colorizer, stream: Writable, verb: Verb, message: string): string {
  const mark = verbMarks[verb];
  const glyph = col[mark.style](canAnimate(stream) ? mark.symbol : mark.ascii);
  const text = safeLine(message);
  return text === "" ? glyph : `${glyph} ${text}`;
}

// ── Bar Implementation ──

/**
 * Bar options after defaults and validation have been applied. Renderers take
 * this type rather than {@link BarOptions}, so a path that skips
 * {@link normalizeBarOptions} cannot reach a renderer.
 */
type ResolvedBarOptions = Required<
  Pick<BarOptions, "total" | "label" | "width" | "filled" | "empty">
> &
  Pick<BarOptions, "format" | "style">;

/**
 * Applies defaults and validates a caller's bar options once. Both the
 * standalone bar and each bar added to a multi-bar group resolve here, so the
 * two cannot disagree about what a given option means.
 */
function normalizeBarOptions(
  options: Omit<BarOptions, "stderr">,
  subject: string,
): ResolvedBarOptions {
  checkBag(options, subject);
  const total = checkTotal(options.total, subject);
  const width = checkWidth(options.width, subject);
  const label = checkString(options.label, "label", subject) ?? "";
  const filled = checkGlyph(options.filled, "filled", "█", subject);
  const empty = checkGlyph(options.empty, "empty", "░", subject);
  const format = checkFormat(options.format, subject);
  checkStyle(options.style, subject);
  return { total, label, width, filled, empty, format, style: options.style };
}

/** Renders the shared single-line representation used by standalone and multi bars. */
function renderBarLine(state: BarState, options: ResolvedBarOptions, colorizer: Colorizer): string {
  if (options.format) return safeLine(options.format(state));

  const filled = safeLine(options.filled);
  const empty = safeLine(options.empty);
  const filledCount = Math.round((state.percent / 100) * options.width);
  const bar = applyColor(
    colorizer,
    options.style,
    filled.repeat(filledCount) + empty.repeat(options.width - filledCount),
  );

  const parts: string[] = [];
  if (options.label) parts.push(safeLine(options.label));
  parts.push(`[${bar}]`, `${state.percent}%`, `${state.current}/${state.total}`);
  return parts.join("  ");
}

function barState(current: number, total: number, startTime: number): BarState {
  const elapsedMs = Date.now() - startTime;
  const ratePerSecond = elapsedMs > 0 ? (current / elapsedMs) * 1000 : 0;
  return {
    current,
    total,
    percent: progressPercent(current, total),
    elapsedMs,
    etaMs: progressEta(current, total, ratePerSecond),
    ratePerSecond,
  };
}

const BAR_SUBJECT = "progress.bar()";
const MULTI_ADD_SUBJECT = "progress.multi().add()";

function createBar(options: BarOptions): Bar {
  const resolved = normalizeBarOptions(options, BAR_SUBJECT);
  const stream = checkStream(options.stderr, BAR_SUBJECT);
  const { total } = resolved;

  let current = 0;
  let finished = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-bar");
  const startTime = Date.now();
  const tty = canAnimate(stream);
  const col = createColorizer(stream);
  const frameWriter = createFrameWriter(stream);

  function render(): void {
    try {
      const line = renderBarLine(barState(current, total, startTime), resolved, col);
      frameWriter.write(`${clearStandaloneFrame(renderedRows)}${line}`);
      renderedRows = wrappedRows(line, stream);
    } catch (error) {
      finished = true;
      cleanup();
      throw error;
    }
  }

  function cleanup(): void {
    releaseTerminal?.();
    releaseTerminal = null;
    unregister?.();
    unregister = null;
    frameWriter.clear();
  }

  function stop(): void {
    if (finished) return;
    finished = true;
    cleanup();
    if (tty) stream.write("\n");
  }

  function end(verb: Verb, message?: string): void {
    if (finished) return;
    finished = true;
    if (verb === "succeed") current = total;
    frameWriter.clear();
    const line = `${resultLine(col, stream, verb, message ?? resolved.label)}\n`;
    stream.write(tty ? `${clearStandaloneFrame(renderedRows)}${line}` : line);
    cleanup();
  }

  if (tty) {
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, "bar", {
      clear: () => {
        const frame = clearStandaloneFrame(renderedRows);
        renderedRows = 0;
        return frame;
      },
      redraw: render,
    });
    unregister = registerIndicator(stop);
    render();
  }

  return {
    update(value: number) {
      checkNumberArg(value, "current", "Bar.update()");
      if (finished) return;
      current = clampProgressValue(value, total, current);
      if (tty) render();
    },
    tick(delta = 1) {
      checkNumberArg(delta, "delta", "Bar.tick()");
      if (finished) return;
      current = clampProgressValue(current + delta, total, current);
      if (tty) render();
    },
    setLabel(newLabel: string) {
      const next = checkLabelArg(newLabel, "Bar.setLabel()");
      if (finished) return;
      resolved.label = next;
      if (tty) render();
    },
    succeed: (message) => end("succeed", checkMessageArg(message, "Bar.succeed()")),
    fail: (message) => end("fail", checkMessageArg(message, "Bar.fail()")),
    warn: (message) => end("warn", checkMessageArg(message, "Bar.warn()")),
    stop,
    [Symbol.dispose]: stop,
  };
}

// ── Spinner Implementation ──

const SPINNER_SUBJECT = "progress.spinner()";

function createSpinner(options: SpinnerOptions = {}): Spinner {
  checkBag(options, SPINNER_SUBJECT);
  const frames = checkFrames(options.frames, SPINNER_SUBJECT);
  const intervalMs = checkIntervalMs(options.intervalMs, SPINNER_SUBJECT);
  checkStyle(options.style, SPINNER_SUBJECT);
  const stream = checkStream(options.stderr, SPINNER_SUBJECT);
  const spinnerColor = options.style;

  const safeFrames = frames.map((frame) => safeLine(frame));
  let label = checkString(options.label, "label", SPINNER_SUBJECT) ?? "";
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-spinner");
  const tty = canAnimate(stream);
  const col = createColorizer(stream);
  const frameWriter = createFrameWriter(stream);

  function render(): void {
    const frame = applyColor(col, spinnerColor, safeFrames[frameIndex % safeFrames.length]);
    const line = `${frame} ${safeLine(label)}`;
    frameWriter.write(`${clearStandaloneFrame(renderedRows)}${line}`);
    renderedRows = wrappedRows(line, stream);
    frameIndex++;
  }

  function cleanup(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    releaseTerminal?.();
    releaseTerminal = null;
    unregister?.();
    unregister = null;
    frameWriter.clear();
  }

  function stop(): void {
    if (done) return;
    done = true;
    cleanup();
    if (tty) stream.write("\n");
  }

  function end(verb: Verb, message?: string): void {
    if (done) return;
    done = true;
    frameWriter.clear();
    const line = `${resultLine(col, stream, verb, message ?? label)}\n`;
    stream.write(tty ? `${clearStandaloneFrame(renderedRows)}${line}` : line);
    cleanup();
  }

  if (tty) {
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, "spinner", {
      clear: () => {
        if (renderedRows <= 0) return "";
        const frame = clearStandaloneFrame(renderedRows);
        renderedRows = 0;
        return frame;
      },
      redraw: render,
    });
    unregister = registerIndicator(stop);
    render();
    // Keep the interval from holding the event loop open on its own.
    timer = setInterval(render, intervalMs);
    timer.unref();
  }

  return {
    setLabel(newLabel: string) {
      label = checkLabelArg(newLabel, "Spinner.setLabel()");
    },
    succeed: (message) => end("succeed", checkMessageArg(message, "Spinner.succeed()")),
    fail: (message) => end("fail", checkMessageArg(message, "Spinner.fail()")),
    warn: (message) => end("warn", checkMessageArg(message, "Spinner.warn()")),
    stop,
    [Symbol.dispose]: stop,
  };
}

// ── MultiBar Implementation ──

/** A handle whose operations are all no-ops, returned once a group is closed. */
function inertBar(): Bar {
  const noop = () => {};
  return {
    update: noop,
    tick: noop,
    setLabel: noop,
    succeed: noop,
    fail: noop,
    warn: noop,
    stop: noop,
    [Symbol.dispose]: noop,
  };
}

type MultiEntry = {
  options: ResolvedBarOptions;
  current: number;
  startTime: number;
  finished: boolean;
  /** Set once the bar ended with a verb; it replaces the bar's row. */
  result: string | null;
};

const MULTI_SUBJECT = "progress.multi()";

function createMultiBar(options: MultiBarOptions = {}): MultiBar {
  checkBag(options, MULTI_SUBJECT);
  const stream = checkStream(options.stderr, MULTI_SUBJECT);
  const tty = canAnimate(stream);
  const col = createColorizer(stream);
  const bars: MultiEntry[] = [];
  // Number of physical rows written by the previous renderAll, used to move the
  // cursor up. Wrapped lines occupy multiple rows, so this is not bars.length.
  let renderedRows = 0;
  let closed = false;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-multi");
  const frameWriter = createFrameWriter(stream);

  function startTerminalSession(): void {
    if (releaseTerminal || !tty) return;
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, "multi-bar", {
      clear: () => {
        if (renderedRows <= 0) return "";
        let frame = `\x1b[${renderedRows}A`;
        for (let row = 0; row < renderedRows; row++) frame += "\r\x1b[K\x1b[1B";
        frame += `\x1b[${renderedRows}A\r`;
        renderedRows = 0;
        return frame;
      },
      redraw: () => renderAll(),
    });
    unregister = registerIndicator(stop);
  }

  function cleanup(): void {
    releaseTerminal?.();
    releaseTerminal = null;
    unregister?.();
    unregister = null;
    frameWriter.clear();
  }

  function stop(): void {
    if (closed) return;
    closed = true;
    const drew = renderedRows > 0;
    cleanup();
    if (tty && drew) stream.write("\n");
  }

  /** Ends one bar with a verb; on a non-TTY stream its result row is written at once. */
  function endEntry(entry: MultiEntry, verb: Verb, message?: string): void {
    entry.finished = true;
    if (verb === "succeed") entry.current = entry.options.total;
    entry.result = resultLine(col, stream, verb, message ?? entry.options.label);
    if (!tty) stream.write(`${entry.result}\n`);
  }

  function endGroup(verb: Verb, message?: string): void {
    if (closed) return;
    for (const entry of bars) if (!entry.finished) endEntry(entry, verb);
    const note = message === undefined ? "" : safeLine(message);
    try {
      if (tty) renderAll(true);
    } finally {
      closed = true;
      if (tty) {
        const drew = renderedRows > 0;
        cleanup();
        if (note !== "") stream.write(`${note}\n`);
        else if (drew) stream.write("\n");
      } else if (note !== "") {
        stream.write(`${note}\n`);
      }
    }
  }

  if (tty) startTerminalSession();

  return {
    add(barOptions: Omit<BarOptions, "stderr">): Bar {
      // Every other operation on a closed group is a silent no-op, so a worker
      // that adds a bar just after `finally { multi.stop() }` gets an inert
      // handle rather than an unhandled rejection that fails the command.
      const resolved = normalizeBarOptions(barOptions, MULTI_ADD_SUBJECT);
      if (closed) return inertBar();
      const entry: MultiEntry = {
        options: resolved,
        current: 0,
        startTime: Date.now(),
        finished: false,
        result: null,
      };
      bars.push(entry);
      if (tty) renderAll();
      const total = entry.options.total;

      const handle: Bar = {
        update(value: number) {
          checkNumberArg(value, "current", "Bar.update()");
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(value, total, entry.current);
          if (tty) renderAll();
        },
        tick(delta = 1) {
          checkNumberArg(delta, "delta", "Bar.tick()");
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(entry.current + delta, total, entry.current);
          if (tty) renderAll();
        },
        setLabel(newLabel: string) {
          const next = checkLabelArg(newLabel, "Bar.setLabel()");
          if (closed || entry.finished) return;
          entry.options.label = next;
          if (tty) renderAll();
        },
        succeed(message) {
          const note = checkMessageArg(message, "Bar.succeed()");
          if (closed || entry.finished) return;
          endEntry(entry, "succeed", note);
          if (tty) renderAll();
        },
        fail(message) {
          const note = checkMessageArg(message, "Bar.fail()");
          if (closed || entry.finished) return;
          endEntry(entry, "fail", note);
          if (tty) renderAll();
        },
        warn(message) {
          const note = checkMessageArg(message, "Bar.warn()");
          if (closed || entry.finished) return;
          endEntry(entry, "warn", note);
          if (tty) renderAll();
        },
        stop() {
          if (closed || entry.finished) return;
          entry.finished = true;
          if (tty) renderAll();
        },
        [Symbol.dispose]: () => handle.stop(),
      };
      return handle;
    },

    succeed: (message) => endGroup("succeed", checkMessageArg(message, "MultiBar.succeed()")),
    fail: (message) => endGroup("fail", checkMessageArg(message, "MultiBar.fail()")),
    warn: (message) => endGroup("warn", checkMessageArg(message, "MultiBar.warn()")),
    stop,
    [Symbol.dispose]: stop,
  };

  function renderAll(final = false): void {
    try {
      drawFrame(final);
    } catch (error) {
      // Give the terminal back before the caller's error propagates, so a
      // throwing formatter cannot strand the cursor or the region claim; the
      // closed group must not re-claim the stream on a later call.
      closed = true;
      cleanup();
      renderedRows = 0;
      throw error;
    }
  }

  function drawFrame(final: boolean): void {
    startTerminalSession();
    const previousRows = renderedRows;
    // Terminal width used to estimate how many physical rows each logical line
    // occupies once it wraps.
    const columns = (stream as NodeJS.WriteStream).columns || 80;

    // Move the cursor up over exactly the physical rows we last wrote so wrapped
    // lines do not leave orphaned fragments in the scrollback.
    let frame = renderedRows > 0 ? `\x1b[${renderedRows}A` : "";

    let rows = 0;
    for (const entry of bars) {
      const line =
        entry.result ??
        renderBarLine(
          barState(entry.current, entry.options.total, entry.startTime),
          entry.options,
          col,
        );

      frame += `\r\x1b[K${line}\n`;
      rows += Math.max(1, Math.ceil(stringWidth(line) / columns));
    }

    // A frame that shrank — a line stopped wrapping, or fewer bars are drawn —
    // leaves the extra physical rows of the previous frame on screen, because
    // the erase above only clears the row the cursor sits on. Wipe the surplus
    // and come back to the end of the new frame.
    const surplus = previousRows - rows;
    if (surplus > 0) frame += `${"\r\x1b[K\n".repeat(surplus)}\x1b[${surplus}A`;

    renderedRows = rows;
    if (final) frameWriter.final(frame);
    else frameWriter.write(frame);
  }
}

// ── Public API ──

/** The members of {@link progress}, declared here so hover shows their full documentation. */
interface ProgressNamespace {
  /**
   * Creates a single progress bar and starts drawing it. On a TTY (and unless
   * `TERM=dumb`) the bar claims its stream and draws 0% before returning; on any
   * other stream it writes nothing until a terminal verb. Pass `{ ...ctx, total }`
   * to draw on a command's `stderr`.
   *
   * @param options - Bar configuration; `total` is required.
   * @returns A handle that updates and ends the bar.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a wrongly typed option.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an out-of-range option, or a
   * `filled` or `empty` whose display width is not 1.
   * @throws {Error} `ERR_OUTPUT_BUSY` if another indicator is rendering to the same stream.
   * @example
   * ```ts
   * const bar = progress.bar({ ...ctx, total: files.length, label: "Copying" });
   * for (const file of files) {
   *   await copy(file);
   *   bar.tick();
   * }
   * bar.succeed("Copied");
   * ```
   */
  bar(options: BarOptions): Bar;
  /**
   * Creates an animated spinner and starts it. On a TTY (and unless `TERM=dumb`)
   * the spinner claims its stream and starts animating before returning; on any
   * other stream it writes nothing until a terminal verb. Pass `ctx` to draw on
   * a command's `stderr`.
   *
   * @param options - Spinner configuration. Defaults to `{}`.
   * @returns A handle that relabels and ends the spinner.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a wrongly typed option.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an out-of-range option.
   * @throws {Error} `ERR_OUTPUT_BUSY` if another indicator is rendering to the same stream.
   * @example
   * ```ts
   * const spinner = progress.spinner({ ...ctx, label: "Installing" });
   * try {
   *   await install();
   *   spinner.succeed("Installed");
   * } catch (error) {
   *   spinner.fail("Install failed");
   *   throw error;
   * }
   * ```
   */
  spinner(options?: SpinnerOptions): Spinner;
  /**
   * Creates a multi-bar manager for simultaneous progress bars. On a TTY (and
   * unless `TERM=dumb`) the group claims its stream when it is created.
   *
   * @param options - Group configuration. Defaults to `{}`.
   * @returns A handle whose `add()` creates the bars and whose verbs end the group.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a wrongly typed option.
   * @throws {Error} `ERR_OUTPUT_BUSY` if another indicator is rendering to the same stream.
   * @example
   * ```ts
   * const multi = progress.multi(ctx);
   * const a = multi.add({ total: 10, label: "a" });
   * const b = multi.add({ total: 20, label: "b" });
   * a.tick();
   * b.tick(5);
   * multi.succeed();
   * ```
   */
  multi(options?: MultiBarOptions): MultiBar;
  /**
   * Stops every indicator that is still active in the process and shows the
   * cursor again. Command execution releases only the indicators its own command
   * created; this is the explicit process-wide reset.
   */
  releaseAll(): void;
}

/**
 * Progress indicators for CLI applications.
 *
 * Provides factory functions for creating progress bars, spinners,
 * and multi-bar displays. Indicators draw to stderr by default and start as
 * soon as they are created. On a stream that is not a TTY, or when `TERM=dumb`,
 * they draw nothing and each terminal verb writes one final line.
 */
export const progress: ProgressNamespace = {
  bar: createBar,
  spinner: createSpinner,
  multi: createMultiBar,
  releaseAll,
};

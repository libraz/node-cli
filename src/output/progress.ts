import type { Writable } from "node:stream";
import { usageError } from "../errors.js";
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
import { type RegionOwner, setRegionOwner } from "./region.js";

// ── Progress Bar ──

/**
 * Configuration options for creating a progress bar.
 */
export interface BarOptions {
  /** Total number of units to track. A finite number of at least 0. */
  total: number;
  /** Optional label displayed before the bar. */
  label?: string;
  /** Width of the bar in characters, from 1 to 4096. Defaults to 30. */
  width?: number;
  /** Character used for the filled portion of the bar. Defaults to "█". */
  filled?: string;
  /** Character used for the empty portion of the bar. Defaults to "░". */
  empty?: string;
  /** Custom format function that receives bar state and returns a display string. */
  format?: (state: BarState) => string;
  /** Output stream for rendering. Defaults to process.stderr. */
  stderr?: Writable;
  /** Style applied to the bar, such as `"green"` or `"bold.cyan"`. An unknown name throws at creation. */
  style?: StyleSpec;
}

/**
 * Represents the current state of a progress bar.
 */
export interface BarState {
  /** Current progress value. */
  current: number;
  /** Total target value. */
  total: number;
  /** Completion percentage (0-100). */
  percent: number;
  /** Elapsed time in milliseconds since the bar was created. */
  elapsedMs: number;
  /** Estimated time remaining in milliseconds. */
  etaMs: number;
  /** Current rate of progress (units per second). */
  ratePerSecond: number;
}

/**
 * Interface for controlling a progress bar instance.
 *
 * The bar starts drawing when it is created. Every terminal verb ends it, and
 * calling any method afterwards does nothing.
 */
export interface Bar {
  /** Sets the progress to the specified absolute value. */
  update(current: number): void;
  /** Increments the progress by the given delta (defaults to 1). */
  tick(delta?: number): void;
  /** Completes the bar, replacing it with a `✔` result line of `message ?? label`. */
  succeed(message?: string): void;
  /** Stops the bar at its current position and replaces it with a `✖` result line of `message ?? label`. */
  fail(message?: string): void;
  /** Stops the bar at its current position and replaces it with a `⚠` result line of `message ?? label`. */
  warn(message?: string): void;
  /** Leaves the last frame in place and ends the line. Writes nothing on a non-TTY stream. */
  stop(): void;
  /** Releases the bar when leaving a `using` scope. */
  [Symbol.dispose](): void;
}

// ── Spinner ──

/**
 * Configuration options for creating a spinner.
 */
export interface SpinnerOptions {
  /** Text label displayed next to the spinner. */
  label?: string;
  /** Animation frame characters. Defaults to a dots pattern. Must not be empty. */
  frames?: readonly string[];
  /** Animation interval in milliseconds. A finite number above 0. Defaults to 80. */
  intervalMs?: number;
  /** Output stream for rendering. Defaults to process.stderr. */
  stderr?: Writable;
  /** Style applied to the spinner frame, such as `"cyan"`. An unknown name throws at creation. */
  style?: StyleSpec;
}

/**
 * Interface for controlling a spinner instance.
 *
 * The spinner starts animating when it is created. Every terminal verb ends it,
 * and calling any method afterwards does nothing.
 */
export interface Spinner {
  /** Replaces the label text shown next to the spinner. */
  setLabel(label: string): void;
  /** Replaces the spinner with a `✔` result line of `message ?? label`. */
  succeed(message?: string): void;
  /** Replaces the spinner with a `✖` result line of `message ?? label`. */
  fail(message?: string): void;
  /** Replaces the spinner with a `⚠` result line of `message ?? label`. */
  warn(message?: string): void;
  /** Leaves the last frame in place and ends the line. Writes nothing on a non-TTY stream. */
  stop(): void;
  /** Releases the spinner when leaving a `using` scope. */
  [Symbol.dispose](): void;
}

// ── MultiBar ──

/**
 * Configuration options for a multi-bar group.
 */
export interface MultiBarOptions {
  /** Output stream shared by every bar in the group. Defaults to process.stderr. */
  stderr?: Writable;
}

/**
 * Interface for managing multiple progress bars rendered simultaneously.
 *
 * A terminal verb applies the same verb to every bar that has not ended, then
 * closes the group; an optional `message` is written as one unmarked final line.
 */
export interface MultiBar {
  /** Adds a new progress bar drawn in the group's stream and returns its handle. */
  add(options: Omit<BarOptions, "stderr">): Bar;
  /** Completes every unfinished bar with `✔` and closes the group. */
  succeed(message?: string): void;
  /** Ends every unfinished bar with `✖` and closes the group. */
  fail(message?: string): void;
  /** Ends every unfinished bar with `⚠` and closes the group. */
  warn(message?: string): void;
  /** Leaves the last frame in place and ends the line. Writes nothing on a non-TTY stream. */
  stop(): void;
  /** Releases the multi-bar when leaving a `using` scope. */
  [Symbol.dispose](): void;
}

// ── Patterns ──

const patterns = {
  dots: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  line: ["-", "\\", "|", "/"],
  arrow: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
};

// ── isTTY check ──

/**
 * Checks whether the given stream is a TTY (terminal).
 */
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
const visualOwners = new WeakMap<Writable, symbol>();
const activeIndicators = new Set<() => void>();

/**
 * Stops every active progress indicator. Command execution calls this from its
 * finalizer so a thrown action cannot strand a terminal session or cursor.
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
function acquireVisualTerminal(stream: Writable, owner: symbol, region: RegionOwner): () => void {
  if (!isTTY(stream)) return () => {};
  const currentOwner = visualOwners.get(stream);
  if (currentOwner && currentOwner !== owner) {
    throw usageError(
      "state",
      "ERR_OUTPUT_BUSY",
      "Another progress indicator is already rendering to this stream; use progress.multi() for concurrent bars",
    );
  }
  visualOwners.set(stream, owner);
  // Publish how this renderer steps aside, so a logger or diagnostic writing to
  // the same stream cannot splice its output into a half-drawn frame.
  setRegionOwner(stream, region);
  const releaseCursor = acquireTerminal(stream);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (visualOwners.get(stream) === owner) {
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

/** Checks a style name or dot-separated chain; every segment must be a built-in style. */
function checkStyle(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "string") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "style must be a string");
  }
  for (const segment of value.split(".")) {
    if (!isStyleName(segment)) {
      throw usageError(
        "range",
        "ERR_INVALID_ARG_VALUE",
        `style contains the unknown style "${segment}" in "${value}"`,
      );
    }
  }
}

function checkTotal(value: unknown): number {
  if (typeof value !== "number") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "total must be a number");
  }
  if (!Number.isFinite(value) || value < 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `total must be a finite number of at least 0, received ${value}`,
    );
  }
  return value;
}

function checkWidth(value: unknown): number {
  if (value === undefined) return 30;
  if (typeof value !== "number") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "width must be a number");
  }
  const whole = value > 0 ? finiteInteger(value, 0) : undefined;
  if (whole === undefined) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `width must be a positive finite number, received ${value}`,
    );
  }
  if (whole > MAX_RENDER_WIDTH) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `width must not exceed ${MAX_RENDER_WIDTH}, received ${value}`,
    );
  }
  // A fractional width draws its whole part, and never fewer than one cell.
  return Math.max(1, whole);
}

function checkFrames(value: unknown): readonly string[] {
  if (value === undefined) return patterns.dots;
  if (!Array.isArray(value) || !value.every((frame) => typeof frame === "string")) {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "frames must be an array of strings");
  }
  if (value.length === 0) {
    throw usageError("range", "ERR_INVALID_ARG_VALUE", "frames must not be empty");
  }
  return value;
}

function checkIntervalMs(value: unknown): number {
  if (value === undefined) return 80;
  if (typeof value !== "number") {
    throw usageError("type", "ERR_INVALID_ARG_TYPE", "intervalMs must be a number");
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `intervalMs must be a positive finite number, received ${value}`,
    );
  }
  return value;
}

// ── Terminal verbs ──

const verbMarks = {
  succeed: { style: "green", symbol: "✔" },
  fail: { style: "red", symbol: "✖" },
  warn: { style: "yellow", symbol: "⚠" },
} as const;

type Verb = keyof typeof verbMarks;

/** The row that replaces a finished indicator: a marker, then the one-line message. */
function resultLine(col: Colorizer, verb: Verb, message: string): string {
  const mark = verbMarks[verb];
  const text = safeLine(message);
  return text === "" ? col[mark.style](mark.symbol) : `${col[mark.style](mark.symbol)} ${text}`;
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
function normalizeBarOptions(options: Omit<BarOptions, "stderr">): ResolvedBarOptions {
  const total = checkTotal(options.total);
  const width = checkWidth(options.width);
  checkStyle(options.style);
  return {
    total,
    label: options.label ?? "",
    width,
    filled: options.filled ?? "█",
    empty: options.empty ?? "░",
    format: options.format,
    style: options.style,
  };
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

/**
 * Creates a new progress bar with the specified options. On a TTY the bar claims
 * its stream and draws 0% before returning.
 */
function createBar(options: BarOptions): Bar {
  const resolved = normalizeBarOptions(options);
  const stream = options.stderr ?? process.stderr;
  const { total } = resolved;

  let current = 0;
  let finished = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-bar");
  const startTime = Date.now();
  const tty = isTTY(stream);
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
    const line = `${resultLine(col, verb, message ?? resolved.label)}\n`;
    stream.write(tty ? `${clearStandaloneFrame(renderedRows)}${line}` : line);
    cleanup();
  }

  if (tty) {
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, {
      clear: () => {
        const frame = clearStandaloneFrame(renderedRows);
        renderedRows = 0;
        return frame;
      },
      redraw: render,
    });
    activeIndicators.add(stop);
    unregister = () => activeIndicators.delete(stop);
    render();
  }

  return {
    update(value: number) {
      if (finished) return;
      current = clampProgressValue(value, total, current);
      if (tty) render();
    },
    tick(delta = 1) {
      if (finished) return;
      current = clampProgressValue(current + delta, total, current);
      if (tty) render();
    },
    succeed: (message) => end("succeed", message),
    fail: (message) => end("fail", message),
    warn: (message) => end("warn", message),
    stop,
    [Symbol.dispose]: stop,
  };
}

// ── Spinner Implementation ──

/**
 * Creates a new spinner with the specified options. On a TTY the spinner claims
 * its stream and starts animating before returning.
 */
function createSpinner(options: SpinnerOptions = {}): Spinner {
  const frames = checkFrames(options.frames);
  const intervalMs = checkIntervalMs(options.intervalMs);
  checkStyle(options.style);
  const stream = options.stderr ?? process.stderr;
  const spinnerColor = options.style;

  const safeFrames = frames.map((frame) => safeLine(frame));
  let label = options.label ?? "";
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-spinner");
  const tty = isTTY(stream);
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
    const line = `${resultLine(col, verb, message ?? label)}\n`;
    stream.write(tty ? `${clearStandaloneFrame(renderedRows)}${line}` : line);
    cleanup();
  }

  if (tty) {
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, {
      clear: () => {
        if (renderedRows <= 0) return "";
        const frame = clearStandaloneFrame(renderedRows);
        renderedRows = 0;
        return frame;
      },
      redraw: render,
    });
    activeIndicators.add(stop);
    unregister = () => activeIndicators.delete(stop);
    render();
    // Keep the interval from holding the event loop open on its own.
    timer = setInterval(render, intervalMs);
    timer.unref();
  }

  return {
    setLabel(newLabel: string) {
      label = newLabel;
    },
    succeed: (message) => end("succeed", message),
    fail: (message) => end("fail", message),
    warn: (message) => end("warn", message),
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

/**
 * Creates a multi-bar manager that renders multiple progress bars simultaneously.
 * On a TTY the group claims its stream when it is created.
 */
function createMultiBar(options: MultiBarOptions = {}): MultiBar {
  const stream = options.stderr ?? process.stderr;
  const tty = isTTY(stream);
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
    releaseTerminal = acquireVisualTerminal(stream, visualOwner, {
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
    activeIndicators.add(stop);
    unregister = () => activeIndicators.delete(stop);
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
    entry.result = resultLine(col, verb, message ?? entry.options.label);
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
      if (closed) return inertBar();
      const entry: MultiEntry = {
        options: normalizeBarOptions(barOptions),
        current: 0,
        startTime: Date.now(),
        finished: false,
        result: null,
      };
      bars.push(entry);
      if (tty) renderAll();
      const total = entry.options.total;

      return {
        update(value: number) {
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(value, total, entry.current);
          if (tty) renderAll();
        },
        tick(delta = 1) {
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(entry.current + delta, total, entry.current);
          if (tty) renderAll();
        },
        succeed(message) {
          if (closed || entry.finished) return;
          endEntry(entry, "succeed", message);
          if (tty) renderAll();
        },
        fail(message) {
          if (closed || entry.finished) return;
          endEntry(entry, "fail", message);
          if (tty) renderAll();
        },
        warn(message) {
          if (closed || entry.finished) return;
          endEntry(entry, "warn", message);
          if (tty) renderAll();
        },
        stop() {
          if (closed || entry.finished) return;
          entry.finished = true;
          if (tty) renderAll();
        },
        [Symbol.dispose]() {
          this.stop();
        },
      };
    },

    succeed: (message) => endGroup("succeed", message),
    fail: (message) => endGroup("fail", message),
    warn: (message) => endGroup("warn", message),
    stop,
    [Symbol.dispose]: stop,
  };

  function renderAll(final = false): void {
    try {
      drawFrame(final);
    } catch (error) {
      // Give the terminal back before the caller's error propagates, so a
      // throwing formatter cannot strand the cursor or the region claim.
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

/**
 * Progress indicators for CLI applications.
 *
 * Provides factory functions for creating progress bars, spinners,
 * and multi-bar displays. Indicators draw to stderr by default and start as
 * soon as they are created.
 */
export const progress = {
  /** Creates a single progress bar and starts drawing it. */
  bar: createBar,
  /** Creates an animated spinner and starts it. */
  spinner: createSpinner,
  /** Creates a multi-bar manager for simultaneous progress bars. */
  multi: createMultiBar,
  /** Stops all indicators that are still active and shows the cursor again. */
  releaseAll,
};

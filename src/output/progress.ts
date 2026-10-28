import type { Writable } from "node:stream";
import { finiteInteger, guardCall, MAX_RENDER_WIDTH } from "../guard.js";
import { createColorizer, isStyleName, renderSafe, streamIsTTY, stringWidth } from "./color.js";
import { type RegionOwner, setRegionOwner } from "./region.js";

// ── Progress Bar ──

/**
 * Configuration options for creating a progress bar.
 */
export interface BarOptions {
  /** Total number of units to track. */
  total: number;
  /** Optional label displayed before the bar. */
  label?: string;
  /** Width of the bar in characters. Defaults to 30. */
  width?: number;
  /** Character used for the filled portion of the bar. Defaults to "█". */
  filled?: string;
  /** Character used for the empty portion of the bar. Defaults to "░". */
  empty?: string;
  /** Custom format function that receives bar state and returns a display string. */
  format?: (state: BarState) => string;
  /** Output stream for rendering. Defaults to process.stderr. */
  stream?: Writable;
  /** Color name to apply to the bar (must be a valid color function name). */
  color?: string;
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
  elapsed: number;
  /** Estimated time remaining in milliseconds. */
  eta: number;
  /** Current rate of progress (units per second). */
  rate: number;
}

/**
 * Interface for controlling a progress bar instance.
 */
export interface Bar {
  /** Sets the progress to the specified absolute value. */
  update(current: number): void;
  /** Increments the progress by the given delta (defaults to 1). */
  tick(delta?: number): void;
  /** Completes the bar by setting progress to total and writing a newline. */
  finish(): void;
  /** Stops the bar and writes a newline without completing it. */
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
  /** Array of animation frame characters. Defaults to dots pattern. */
  frames?: string[];
  /** Animation interval in milliseconds. Defaults to 80. */
  interval?: number;
  /** Output stream for rendering. Defaults to process.stderr. */
  stream?: Writable;
  /** Color name to apply to the spinner frame. */
  color?: string;
}

/**
 * Interface for controlling a spinner instance.
 */
export interface Spinner {
  /** Starts the spinner animation. */
  start(): void;
  /** Updates the spinner label text. */
  update(label: string): void;
  /** Stops the spinner and displays a success message with a check mark. */
  succeed(message?: string): void;
  /** Stops the spinner and displays a failure message with a cross mark. */
  fail(message?: string): void;
  /** Stops the spinner and displays a warning message. */
  warn(message?: string): void;
  /** Stops the spinner and clears the line. */
  stop(): void;
  /** Releases the spinner when leaving a `using` scope. */
  [Symbol.dispose](): void;
}

// ── MultiBar ──

/**
 * Interface for managing multiple progress bars rendered simultaneously.
 */
export interface MultiBar {
  /** Adds a new progress bar with the given options and returns a Bar handle. */
  add(options: BarOptions): Bar;
  /** Completes all bars and writes a trailing newline. */
  finish(): void;
  /** Stops all bars and writes a trailing newline. */
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

/** Applies the named style when it is a built-in one; any other name leaves the text as is. */
function applyColor(
  colorizer: Record<string, (text: string) => string>,
  name: string | undefined,
  text: string,
): string {
  if (name === undefined || !isStyleName(name)) return text;
  return guardCall(
    () => colorizer[name](text),
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
  if (!streamIsTTY(stream)) return () => {};

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
  if (!streamIsTTY(stream)) return () => {};
  const currentOwner = visualOwners.get(stream);
  if (currentOwner && currentOwner !== owner) {
    throw new Error(
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

/** Normalizes an invalid total to a completed, zero-unit operation. */
function normalizeProgressTotal(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Ignores invalid updates instead of allowing NaN to poison future renders. */
function clampProgressValue(value: number, total: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(value, total));
}

function progressPercent(current: number, total: number): number {
  return total === 0 ? 100 : Math.min(100, Math.round((current / total) * 100));
}

function progressEta(current: number, total: number, rate: number): number {
  if (current >= total) return 0;
  return rate > 0 ? Math.max(0, ((total - current) / rate) * 1000) : Number.POSITIVE_INFINITY;
}

/** Renders the shared single-line representation used by standalone and multi bars. */
function renderBarLine(
  state: BarState,
  options: Pick<BarOptions, "label" | "width" | "filled" | "empty" | "format" | "color">,
  colorizer: Record<string, (text: string) => string>,
): string {
  if (options.format) return safeLine(options.format(state));

  const width = options.width ?? 30;
  const filled = safeLine(options.filled ?? "█");
  const empty = safeLine(options.empty ?? "░");
  const filledCount = Math.round((state.percent / 100) * width);
  // An unrecognized color must not stop progress reporting.
  const bar = applyColor(
    colorizer,
    options.color,
    filled.repeat(filledCount) + empty.repeat(width - filledCount),
  );

  const parts: string[] = [];
  if (options.label) parts.push(safeLine(options.label));
  parts.push(`[${bar}]`, `${state.percent}%`, `${state.current}/${state.total}`);
  return parts.join("  ");
}

// ── Bar Implementation ──

/**
 * Bar options after defaults, validation and normalization have been applied.
 * Renderers take this type rather than {@link BarOptions}, so a path that skips
 * {@link normalizeBarOptions} cannot reach a renderer.
 */
type ResolvedBarOptions = Required<
  Pick<BarOptions, "total" | "label" | "width" | "filled" | "empty">
> &
  Pick<BarOptions, "format" | "color"> & { stream: Writable };

/**
 * Applies defaults and validates a caller's bar options once. Both the
 * standalone bar and each bar added to a multi-bar group resolve here, so the
 * two cannot disagree about what a given option means.
 */
function normalizeBarOptions(options: BarOptions): ResolvedBarOptions {
  const requested = options.width ?? 30;
  const whole =
    typeof requested === "number" && requested > 0 ? finiteInteger(requested, 0) : undefined;
  if (whole === undefined) {
    throw new RangeError("Bar width must be a positive finite number");
  }
  if (whole > MAX_RENDER_WIDTH) {
    throw new RangeError(`Bar width must not exceed ${MAX_RENDER_WIDTH}`);
  }
  // A fractional width draws its whole part, and never fewer than one cell.
  const width = Math.max(1, whole);
  return {
    total: normalizeProgressTotal(options.total),
    label: options.label ?? "",
    width,
    filled: options.filled ?? "█",
    empty: options.empty ?? "░",
    format: options.format,
    color: options.color,
    stream: options.stream ?? process.stderr,
  };
}

/**
 * Creates a new progress bar with the specified options.
 */
function createBar(options: BarOptions): Bar {
  const {
    total,
    label,
    width,
    filled,
    empty,
    format: customFormat,
    stream,
    color: barColor,
  } = normalizeBarOptions(options);

  let current = 0;
  let finished = false;
  let started = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-bar");
  const startTime = Date.now();
  const tty = streamIsTTY(stream);
  const col = createColorizer(stream);
  const frameWriter = createFrameWriter(stream);

  function getState(): BarState {
    const elapsed = Date.now() - startTime;
    const percent = progressPercent(current, total);
    const rate = elapsed > 0 ? (current / elapsed) * 1000 : 0;
    const eta = progressEta(current, total, rate);
    return { current, total, percent, elapsed, eta, rate };
  }

  function render(final = false): void {
    if (!tty) return;
    if (!started) {
      releaseTerminal = acquireVisualTerminal(stream, visualOwner, {
        clear: () => {
          const frame = clearStandaloneFrame(renderedRows);
          renderedRows = 0;
          return frame;
        },
        redraw: () => render(),
      });
      started = true;
      activeIndicators.add(stop);
      unregister = () => activeIndicators.delete(stop);
    }

    try {
      const state = getState();
      const line = renderBarLine(
        state,
        { label, width, filled, empty, format: customFormat, color: barColor },
        col as Record<string, (text: string) => string>,
      );

      const frame = `${clearStandaloneFrame(renderedRows)}${line}`;
      if (final) frameWriter.final(frame);
      else frameWriter.write(frame);
      renderedRows = wrappedRows(line, stream);
    } catch (error) {
      cleanup();
      started = false;
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
    const drew = started;
    cleanup();
    // Only close a line this bar actually opened. Disposing a bar whose block
    // returned or threw before the first update must leave the terminal exactly
    // as it found it.
    if (tty && drew) stream.write("\n");
  }

  return {
    update(value: number) {
      if (finished) return;
      current = clampProgressValue(value, total, current);
      render();
    },
    tick(delta = 1) {
      if (finished) return;
      current = clampProgressValue(current + delta, total, current);
      render();
    },
    finish() {
      if (finished) return;
      finished = true;
      current = total;
      try {
        render(true);
      } finally {
        cleanup();
        if (tty) stream.write("\n");
      }
    },
    stop,
    [Symbol.dispose]: stop,
  };
}

// ── Spinner Implementation ──

/**
 * Creates a new spinner with the specified options.
 */
function createSpinner(options: SpinnerOptions = {}): Spinner {
  const {
    label: initialLabel = "",
    frames = patterns.dots,
    interval = 80,
    stream = process.stderr,
    color: spinnerColor,
  } = options;

  if (
    !Array.isArray(frames) ||
    frames.length === 0 ||
    !frames.every((frame) => typeof frame === "string")
  ) {
    throw new RangeError("Spinner frames must be a non-empty array of strings");
  }
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new RangeError("Spinner interval must be a positive finite number");
  }

  const safeFrames = frames.map((frame) => safeLine(frame));
  let label = initialLabel;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  let renderedRows = 0;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-spinner");
  const tty = streamIsTTY(stream);
  const col = createColorizer(stream);
  const frameWriter = createFrameWriter(stream);

  function render(): void {
    if (!tty) return;
    const frame = applyColor(
      col as Record<string, (s: string) => string>,
      spinnerColor,
      safeFrames[frameIndex % safeFrames.length],
    );
    const line = `${frame} ${safeLine(label)}`;
    frameWriter.write(`${clearStandaloneFrame(renderedRows)}${line}`);
    renderedRows = wrappedRows(line, stream);
    frameIndex++;
  }

  function clearLine(): void {
    // Erasing a line this spinner never drew would wipe whatever the caller had
    // already written there.
    if (tty && renderedRows > 0) stream.write(clearStandaloneFrame(renderedRows));
    renderedRows = 0;
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
    clearLine();
  }

  return {
    start() {
      if (timer || done) return;
      releaseTerminal = acquireVisualTerminal(stream, visualOwner, {
        clear: () => {
          if (renderedRows <= 0) return "";
          const frame = clearStandaloneFrame(renderedRows);
          renderedRows = 0;
          return frame;
        },
        redraw: () => render(),
      });
      activeIndicators.add(stop);
      unregister = () => activeIndicators.delete(stop);
      render();
      // Keep the interval from holding the event loop open on its own.
      timer = setInterval(render, interval);
      timer.unref();
    },

    update(newLabel: string) {
      label = newLabel;
    },

    succeed(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      const msg = safeLine(message ?? label);
      stream.write(`${col.green("✔")} ${msg}\n`);
    },

    fail(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      const msg = safeLine(message ?? label);
      stream.write(`${col.red("✖")} ${msg}\n`);
    },

    warn(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      const msg = safeLine(message ?? label);
      stream.write(`${col.yellow("⚠")} ${msg}\n`);
    },

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
    finish: noop,
    stop: noop,
    [Symbol.dispose]: noop,
  };
}

/**
 * Creates a multi-bar manager that renders multiple progress bars simultaneously.
 */
function createMultiBar(): MultiBar {
  const bars: { options: BarOptions; current: number; startTime: number; finished: boolean }[] = [];
  // The whole group renders to a single stream, fixed by the first bar that
  // provides one. Later per-bar stream values are intentionally ignored: a
  // multi-bar frame cannot be split safely across terminal regions.
  let stream: Writable = process.stderr;
  let streamSet = false;
  // Number of physical rows written by the previous renderAll, used to move the
  // cursor up. Wrapped lines occupy multiple rows, so this is not bars.length.
  let renderedRows = 0;
  let closed = false;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-multi");
  let frameWriter = createFrameWriter(stream);

  function startTerminalSession(): void {
    if (releaseTerminal || !streamIsTTY(stream)) return;
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
    if (streamIsTTY(stream) && drew) stream.write("\n");
  }

  return {
    add(options: BarOptions): Bar {
      // Every other operation on a closed group is a silent no-op, so a worker
      // that adds a bar just after `finally { multi.finish() }` gets an inert
      // handle rather than an unhandled rejection that fails the command.
      if (closed) return inertBar();
      // The stream is fixed for good once the group has drawn a frame.
      if (!streamSet && options.stream && !releaseTerminal && renderedRows === 0) {
        stream = options.stream;
        frameWriter = createFrameWriter(stream);
        streamSet = true;
      }
      const entry = {
        options: normalizeBarOptions(options),
        current: 0,
        startTime: Date.now(),
        finished: false,
      };
      bars.push(entry);

      // The normalized total, not the caller's raw value: clamping against a
      // NaN or negative total is what let a multi bar render "NaN/0".
      const total = entry.options.total;

      const wrapper: Bar = {
        update(value: number) {
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(value, total, entry.current);
          if (streamIsTTY(stream)) renderAll();
        },
        tick(delta = 1) {
          if (closed || entry.finished) return;
          entry.current = clampProgressValue(entry.current + delta, total, entry.current);
          if (streamIsTTY(stream)) renderAll();
        },
        finish() {
          if (closed || entry.finished) return;
          entry.current = total;
          entry.finished = true;
          if (streamIsTTY(stream)) renderAll();
        },
        stop() {
          if (closed || entry.finished) return;
          entry.finished = true;
          if (streamIsTTY(stream)) renderAll();
        },
        [Symbol.dispose]() {
          this.stop();
        },
      };

      return wrapper;
    },

    finish() {
      if (closed) return;
      for (const entry of bars) {
        entry.current = entry.options.total;
        entry.finished = true;
      }
      try {
        if (streamIsTTY(stream)) renderAll(true);
      } finally {
        closed = true;
        if (streamIsTTY(stream)) {
          cleanup();
          stream.write("\n");
        }
      }
    },

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
    const col = createColorizer(stream);
    // Terminal width used to estimate how many physical rows each logical line
    // occupies once it wraps.
    const columns = (stream as NodeJS.WriteStream).columns || 80;

    // Move the cursor up over exactly the physical rows we last wrote so wrapped
    // lines do not leave orphaned fragments in the scrollback.
    let frame = renderedRows > 0 ? `\x1b[${renderedRows}A` : "";

    let rows = 0;
    for (const entry of bars) {
      const { options: opts, current, startTime } = entry;
      const total = opts.total;
      const percent = progressPercent(current, total);
      const elapsed = Date.now() - startTime;
      const rate = elapsed > 0 ? (current / elapsed) * 1000 : 0;
      const eta = progressEta(current, total, rate);
      const line = renderBarLine(
        { current, total, percent, elapsed, eta, rate },
        opts,
        col as Record<string, (text: string) => string>,
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
 * and multi-bar displays.
 */
export const progress = {
  /** Creates a single progress bar. */
  bar: createBar,
  /** Creates an animated spinner. */
  spinner: createSpinner,
  /** Creates a multi-bar manager for simultaneous progress bars. */
  multi: createMultiBar,
  /** Stops all indicators that are still active. */
  releaseAll,
};

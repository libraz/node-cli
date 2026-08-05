import type { Writable } from "node:stream";
import { createColorizer, sanitizeTerminalText, streamIsTTY, stringWidth } from "./color.js";

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
function singleLine(text: string): string {
  return sanitizeTerminalText(text);
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
  if (cursorSignalHandlers.size > 0) return;
  // Do not supersede an embedding application's signal policy, or the router's
  // cooperative Ctrl-C handler installed around command execution.
  if (cursorRestoreSignals.some((signal) => process.listenerCount(signal) > 0)) return;

  for (const signal of cursorRestoreSignals) {
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
      if (cursorHiddenStreams.size === 0) removeSignalRestore();
    }
  };
}

/**
 * Structured progress renderers need exclusive ownership of their terminal
 * region. Multiple standalone renderers cannot infer one another's row layout;
 * callers that need concurrent bars should use progress.multi().
 */
function acquireVisualTerminal(stream: Writable, owner: symbol): () => void {
  if (!streamIsTTY(stream)) return () => {};
  const currentOwner = visualOwners.get(stream);
  if (currentOwner && currentOwner !== owner) {
    throw new Error(
      "Another progress indicator is already rendering to this stream; use progress.multi() for concurrent bars",
    );
  }
  visualOwners.set(stream, owner);
  const releaseCursor = acquireTerminal(stream);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (visualOwners.get(stream) === owner) visualOwners.delete(stream);
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
  if (options.format) return singleLine(options.format(state));

  const width = options.width ?? 30;
  const filled = options.filled ?? "█";
  const empty = options.empty ?? "░";
  const filledCount = Math.round((state.percent / 100) * width);
  let bar = filled.repeat(filledCount) + empty.repeat(width - filledCount);
  if (options.color) {
    try {
      bar = colorizer[options.color](bar);
    } catch {
      // An unrecognized color must not stop progress reporting.
    }
  }

  const parts: string[] = [];
  if (options.label) parts.push(singleLine(options.label));
  parts.push(`[${bar}]`, `${state.percent}%`, `${state.current}/${state.total}`);
  return parts.join("  ");
}

// ── Bar Implementation ──

/**
 * Creates a new progress bar with the specified options.
 */
function createBar(options: BarOptions): Bar {
  const {
    total: requestedTotal,
    label = "",
    width = 30,
    filled = "█",
    empty = "░",
    format: customFormat,
    stream = process.stderr,
    color: barColor,
  } = options;
  const total = normalizeProgressTotal(requestedTotal);

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
      releaseTerminal = acquireVisualTerminal(stream, visualOwner);
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
      renderedRows = Math.max(
        1,
        Math.ceil(stringWidth(line) / ((stream as NodeJS.WriteStream).columns || 80)),
      );
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
    cleanup();
    if (tty) stream.write("\n");
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

  let label = initialLabel;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  let releaseTerminal: (() => void) | null = null;
  let unregister: (() => void) | null = null;
  const visualOwner = Symbol("progress-spinner");
  const tty = streamIsTTY(stream);
  const col = createColorizer(stream);
  const frameWriter = createFrameWriter(stream);

  function render(): void {
    if (!tty) return;
    let frame = frames[frameIndex % frames.length];
    if (spinnerColor) {
      try {
        frame = (col as Record<string, (s: string) => string>)[spinnerColor](frame);
      } catch {
        // ignore
      }
    }
    frameWriter.write(`\r\x1b[K${frame} ${singleLine(label)}`);
    frameIndex++;
  }

  function clearLine(): void {
    if (tty) stream.write("\r\x1b[K");
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
      releaseTerminal = acquireVisualTerminal(stream, visualOwner);
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
      const msg = singleLine(message ?? label);
      stream.write(`${col.green("✔")} ${msg}\n`);
    },

    fail(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      const msg = singleLine(message ?? label);
      stream.write(`${col.red("✖")} ${msg}\n`);
    },

    warn(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      const msg = singleLine(message ?? label);
      stream.write(`${col.yellow("⚠")} ${msg}\n`);
    },

    stop,
    [Symbol.dispose]: stop,
  };
}

// ── MultiBar Implementation ──

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
    releaseTerminal = acquireVisualTerminal(stream, visualOwner);
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
    cleanup();
    if (streamIsTTY(stream)) stream.write("\n");
  }

  return {
    add(options: BarOptions): Bar {
      if (closed) {
        throw new Error("Cannot add a bar after multi progress has been closed");
      }
      if (!streamSet && options.stream) {
        stream = options.stream;
        frameWriter = createFrameWriter(stream);
        streamSet = true;
      }
      const entry = {
        options: { ...options, total: normalizeProgressTotal(options.total) },
        current: 0,
        startTime: Date.now(),
        finished: false,
      };
      bars.push(entry);

      const total = options.total;

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
      if (streamIsTTY(stream)) {
        renderAll(true);
        cleanup();
        stream.write("\n");
      }
      closed = true;
    },

    stop,
    [Symbol.dispose]: stop,
  };

  function renderAll(final = false): void {
    startTerminalSession();
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

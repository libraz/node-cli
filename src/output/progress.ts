import type { Writable } from "node:stream";
import { createColorizer, stringWidth } from "./color.js";

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
function isTTY(stream: Writable): boolean {
  return "isTTY" in stream && (stream as NodeJS.WriteStream).isTTY === true;
}

// ── Bar Implementation ──

/**
 * Creates a new progress bar with the specified options.
 */
function createBar(options: BarOptions): Bar {
  const {
    total,
    label = "",
    width = 30,
    filled = "█",
    empty = "░",
    format: customFormat,
    stream = process.stderr,
    color: barColor,
  } = options;

  let current = 0;
  let finished = false;
  const startTime = Date.now();
  const tty = isTTY(stream);
  const col = createColorizer(stream);

  function getState(): BarState {
    const elapsed = Date.now() - startTime;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const rate = elapsed > 0 ? (current / elapsed) * 1000 : 0;
    const eta = rate > 0 ? Math.max(0, ((total - current) / rate) * 1000) : 0;
    return { current, total, percent, elapsed, eta, rate };
  }

  function render(): void {
    if (!tty) return;

    const state = getState();

    if (customFormat) {
      const line = customFormat(state);
      stream.write(`\r\x1b[K${line}`);
      return;
    }

    const filledCount = Math.round((state.percent / 100) * width);
    const emptyCount = width - filledCount;
    let bar = filled.repeat(filledCount) + empty.repeat(emptyCount);

    if (barColor) {
      try {
        bar = (col as Record<string, (s: string) => string>)[barColor](bar);
      } catch {
        // ignore unknown color
      }
    }

    const parts: string[] = [];
    if (label) parts.push(label);
    parts.push(`[${bar}]`);
    parts.push(`${state.percent}%`);
    parts.push(`${state.current}/${state.total}`);

    stream.write(`\r\x1b[K${parts.join("  ")}`);
  }

  return {
    update(value: number) {
      current = Math.max(0, Math.min(value, total));
      render();
    },
    tick(delta = 1) {
      current = Math.max(0, Math.min(current + delta, total));
      render();
    },
    finish() {
      if (finished) return;
      finished = true;
      current = total;
      render();
      if (tty) stream.write("\n");
    },
    stop() {
      if (finished) return;
      finished = true;
      if (tty) stream.write("\n");
    },
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

  let label = initialLabel;
  let frameIndex = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let done = false;
  let sigintHandler: (() => void) | null = null;
  const tty = isTTY(stream);
  const col = createColorizer(stream);

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
    stream.write(`\r\x1b[K${frame} ${label}`);
    frameIndex++;
  }

  function clearLine(): void {
    if (tty) stream.write("\r\x1b[K");
  }

  function showCursor(): void {
    if (tty) stream.write("\x1b[?25h");
  }

  function cleanup(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (sigintHandler) {
      process.removeListener("SIGINT", sigintHandler);
      sigintHandler = null;
    }
  }

  return {
    start() {
      if (timer || done) return;
      // Restore the terminal and re-raise SIGINT so the default exit behavior
      // (and any other handlers) still apply after we tidy up the animation.
      sigintHandler = () => {
        cleanup();
        clearLine();
        showCursor();
        process.kill(process.pid, "SIGINT");
      };
      process.once("SIGINT", sigintHandler);
      if (tty) stream.write("\x1b[?25l");
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
      showCursor();
      if (!tty) return;
      const msg = message ?? label;
      stream.write(`${col.green("✔")} ${msg}\n`);
    },

    fail(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      showCursor();
      if (!tty) return;
      const msg = message ?? label;
      stream.write(`${col.red("✖")} ${msg}\n`);
    },

    warn(message?: string) {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      showCursor();
      if (!tty) return;
      const msg = message ?? label;
      stream.write(`${col.yellow("⚠")} ${msg}\n`);
    },

    stop() {
      if (done) return;
      done = true;
      cleanup();
      clearLine();
      showCursor();
    },
  };
}

// ── MultiBar Implementation ──

/**
 * Creates a multi-bar manager that renders multiple progress bars simultaneously.
 */
function createMultiBar(): MultiBar {
  const bars: { options: BarOptions; current: number; startTime: number }[] = [];
  // The whole group renders to a single stream, fixed by the first bar that
  // actually provides one (a later add() can supply it if the first omits it).
  let stream: Writable = process.stderr;
  let streamSet = false;
  // Number of physical rows written by the previous renderAll, used to move the
  // cursor up. Wrapped lines occupy multiple rows, so this is not bars.length.
  let renderedRows = 0;
  let closed = false;

  return {
    add(options: BarOptions): Bar {
      if (!streamSet && options.stream) {
        stream = options.stream;
        streamSet = true;
      }
      const entry = { options, current: 0, startTime: Date.now() };
      bars.push(entry);

      const total = options.total;

      const wrapper: Bar = {
        update(value: number) {
          entry.current = Math.max(0, Math.min(value, total));
          if (isTTY(stream)) renderAll();
        },
        tick(delta = 1) {
          entry.current = Math.max(0, Math.min(entry.current + delta, total));
          if (isTTY(stream)) renderAll();
        },
        finish() {
          entry.current = total;
          if (isTTY(stream)) renderAll();
        },
        stop() {
          // no-op for individual bars in multi
        },
      };

      return wrapper;
    },

    finish() {
      if (closed) return;
      closed = true;
      if (isTTY(stream)) {
        renderAll();
        stream.write("\n");
      }
    },

    stop() {
      if (closed) return;
      closed = true;
      if (isTTY(stream)) stream.write("\n");
    },
  };

  function renderAll(): void {
    const col = createColorizer(stream);
    // Terminal width used to estimate how many physical rows each logical line
    // occupies once it wraps.
    const columns = (stream as NodeJS.WriteStream).columns || 80;

    // Move the cursor up over exactly the physical rows we last wrote so wrapped
    // lines do not leave orphaned fragments in the scrollback.
    if (renderedRows > 0) {
      stream.write(`\x1b[${renderedRows}A`);
    }

    let rows = 0;
    for (const entry of bars) {
      const { options: opts, current, startTime } = entry;
      const total = opts.total;
      const width = opts.width ?? 30;
      const filled = opts.filled ?? "█";
      const empty = opts.empty ?? "░";
      const label = opts.label ?? "";

      const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      const elapsed = Date.now() - startTime;
      const rate = elapsed > 0 ? (current / elapsed) * 1000 : 0;
      const eta = rate > 0 ? Math.max(0, ((total - current) / rate) * 1000) : 0;

      let line: string;
      if (opts.format) {
        line = opts.format({ current, total, percent, elapsed, eta, rate });
      } else {
        const filledCount = Math.round((percent / 100) * width);
        const emptyCount = width - filledCount;
        let bar = filled.repeat(filledCount) + empty.repeat(emptyCount);

        if (opts.color) {
          try {
            bar = (col as Record<string, (s: string) => string>)[opts.color](bar);
          } catch {
            // ignore unknown color
          }
        }

        const parts: string[] = [];
        if (label) parts.push(label);
        parts.push(`[${bar}]`);
        parts.push(`${percent}%`);
        parts.push(`${current}/${total}`);
        line = parts.join("  ");
      }

      stream.write(`\r\x1b[K${line}\n`);
      rows += Math.max(1, Math.ceil(stringWidth(line) / columns));
    }

    renderedRows = rows;
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
};

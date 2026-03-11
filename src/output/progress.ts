import type { Writable } from "node:stream";
import { color as c } from "./color.js";

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
  const startTime = Date.now();
  const tty = isTTY(stream);

  function getState(): BarState {
    const elapsed = Date.now() - startTime;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    const rate = elapsed > 0 ? (current / elapsed) * 1000 : 0;
    const eta = rate > 0 ? ((total - current) / rate) * 1000 : 0;
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
        bar = (c as Record<string, (s: string) => string>)[barColor](bar);
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
      current = Math.min(value, total);
      render();
    },
    tick(delta = 1) {
      current = Math.min(current + delta, total);
      render();
    },
    finish() {
      current = total;
      render();
      if (tty) stream.write("\n");
    },
    stop() {
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
  const tty = isTTY(stream);

  function render(): void {
    if (!tty) return;
    let frame = frames[frameIndex % frames.length];
    if (spinnerColor) {
      try {
        frame = (c as Record<string, (s: string) => string>)[spinnerColor](frame);
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

  function cleanup(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start() {
      if (timer) return;
      render();
      timer = setInterval(render, interval);
    },

    update(newLabel: string) {
      label = newLabel;
    },

    succeed(message?: string) {
      cleanup();
      clearLine();
      const msg = message ?? label;
      stream.write(`${c.green("✔")} ${msg}\n`);
    },

    fail(message?: string) {
      cleanup();
      clearLine();
      const msg = message ?? label;
      stream.write(`${c.red("✖")} ${msg}\n`);
    },

    warn(message?: string) {
      cleanup();
      clearLine();
      const msg = message ?? label;
      stream.write(`${c.yellow("⚠")} ${msg}\n`);
    },

    stop() {
      cleanup();
      clearLine();
    },
  };
}

// ── MultiBar Implementation ──

/**
 * Creates a multi-bar manager that renders multiple progress bars simultaneously.
 */
function createMultiBar(): MultiBar {
  const bars: { bar: Bar; options: BarOptions; current: number }[] = [];
  let initialized = false;

  return {
    add(options: BarOptions): Bar {
      const innerBar = createBar({
        ...options,
        stream: undefined as unknown as Writable, // We manage rendering ourselves
      });

      const entry = { bar: innerBar, options, current: 0 };
      bars.push(entry);

      // Create a wrapper that tracks and re-renders
      const stream = options.stream ?? process.stderr;
      const tty = isTTY(stream);

      const wrapper: Bar = {
        update(value: number) {
          entry.current = value;
          if (tty) renderAll(stream);
        },
        tick(delta = 1) {
          entry.current = Math.min(entry.current + delta, options.total);
          if (tty) renderAll(stream);
        },
        finish() {
          entry.current = options.total;
          if (tty) renderAll(stream);
        },
        stop() {
          // no-op for individual bars in multi
        },
      };

      return wrapper;
    },

    finish() {
      const stream = bars[0]?.options.stream ?? process.stderr;
      if (isTTY(stream)) {
        renderAll(stream);
        stream.write("\n");
      }
    },

    stop() {
      const stream = bars[0]?.options.stream ?? process.stderr;
      if (isTTY(stream)) stream.write("\n");
    },
  };

  function renderAll(stream: Writable): void {
    // Move cursor up to overwrite previous render
    if (initialized) {
      stream.write(`\x1b[${bars.length}A`);
    }
    initialized = true;

    for (const entry of bars) {
      const { options: opts, current } = entry;
      const total = opts.total;
      const width = opts.width ?? 30;
      const filled = opts.filled ?? "█";
      const empty = opts.empty ?? "░";
      const label = opts.label ?? "";

      const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
      const filledCount = Math.round((percent / 100) * width);
      const emptyCount = width - filledCount;
      const bar = filled.repeat(filledCount) + empty.repeat(emptyCount);

      const parts: string[] = [];
      if (label) parts.push(label);
      parts.push(`[${bar}]`);
      parts.push(`${percent}%`);
      parts.push(`${current}/${total}`);

      stream.write(`\r\x1b[K${parts.join("  ")}\n`);
    }
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

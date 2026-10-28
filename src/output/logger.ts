import type { Writable } from "node:stream";
import { format } from "node:util";
import { guardCall, ownValue } from "../guard.js";
import { createColorizer, isColorEnabled, renderSafe } from "./color.js";
import { writeThrough } from "./region.js";

// ── Types ──

/**
 * Severity levels for log messages, from most verbose to silent.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Configuration options for creating a logger instance.
 */
export interface LoggerOptions {
  /** Minimum log level to output. Messages below this level are suppressed. Defaults to "info". */
  level?: LogLevel;
  /** Prefix string displayed in brackets before each message. */
  prefix?: string;
  /** Whether to include a timestamp (HH:MM:SS) in each log line. Defaults to false. */
  timestamp?: boolean;
  /** Output stream for log messages. Defaults to process.stderr. */
  stream?: Writable;
  /** Maximum log lines queued while the stream is backpressured. Defaults to 1000. */
  bufferLimit?: number;
}

/**
 * A structured logger that supports leveled output, prefixes, timestamps, and child loggers.
 */
export interface Logger {
  /** Logs a debug-level message (lowest priority). */
  debug(message: string, ...args: unknown[]): void;
  /** Logs an informational message. */
  info(message: string, ...args: unknown[]): void;
  /** Logs a success message (displayed at info level with a check mark). */
  success(message: string, ...args: unknown[]): void;
  /** Logs a warning message. */
  warn(message: string, ...args: unknown[]): void;
  /** Logs an error message (highest priority). */
  error(message: string, ...args: unknown[]): void;
  /** Changes the minimum log level at runtime. */
  setLevel(level: LogLevel): void;
  /** Creates a child logger with an additional prefix segment. */
  child(prefix: string): Logger;
  /** Resolves after buffered lines reach the stream; rejects if the stream errors or closes first. */
  flush(): Promise<void>;
}

// ── Level ordering ──

const levelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// ── Icons ──

/**
 * Display configuration for a single log level.
 */
interface LevelConfig {
  /** Label used when color is disabled, e.g. `[INFO]`. */
  icon: string;
  /** Glyph used when color is enabled, e.g. `\u2139`. */
  ttyIcon: string;
  /** Color style name applied to the icon in TTY mode. */
  colorName: string;
  /** Short label for the level. */
  label: string;
}

const levelConfig: Record<string, LevelConfig> = {
  debug: { icon: "[DEBUG]", ttyIcon: "●", colorName: "dim", label: "DEBUG" },
  info: { icon: "[INFO]", ttyIcon: "ℹ", colorName: "blue", label: "INFO" },
  success: { icon: "[OK]", ttyIcon: "✔", colorName: "green", label: "OK" },
  warn: { icon: "[WARN]", ttyIcon: "⚠", colorName: "yellow", label: "WARN" },
  error: { icon: "[ERROR]", ttyIcon: "✖", colorName: "red", label: "ERROR" },
};

// ── Implementation ──

/**
 * Returns the current time formatted as HH:MM:SS.
 */
function formatTimestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Creates a new Logger instance with the specified options.
 *
 * The logger supports leveled output (debug, info, warn, error, silent),
 * optional timestamps, prefixes, and child logger creation for scoped logging.
 *
 * @param options - Logger configuration options.
 * @returns A Logger instance.
 */
export function logger(options: LoggerOptions = {}): Logger {
  return createLogger(options);
}

/** Returns whether `level` is one of the {@link LogLevel} values. */
function isLogLevel(level: unknown): level is LogLevel {
  return typeof level === "string" && ownValue(levelOrder, level) !== undefined;
}

/** Throws a RangeError naming the accepted levels when `level` is not one of them. */
function assertLogLevel(level: unknown): asserts level is LogLevel {
  if (!isLogLevel(level)) {
    throw new RangeError(`Logger level must be one of: ${Object.keys(levelOrder).join(", ")}`);
  }
}

/**
 * Write queue, backpressure and failure state of one output stream. Every
 * logger writing to the stream, a parent and all of its children, shares it, so
 * their lines keep call order and one failure reaches every `flush()`.
 */
interface StreamState {
  queue: string[];
  backpressured: boolean;
  failure: Error | undefined;
  waiters: Set<{ resolve: () => void; reject: (error: Error) => void }>;
  onDrain: () => void;
}

const streamStates = new WeakMap<Writable, StreamState>();

/** Returns the shared state for `stream`, attaching its persistent listeners on first use. */
function stateFor(stream: Writable): StreamState {
  const existing = streamStates.get(stream);
  if (existing) return existing;

  const state: StreamState = {
    queue: [],
    backpressured: false,
    failure: undefined,
    waiters: new Set(),
    onDrain: () => drain(stream, state),
  };
  streamStates.set(stream, state);
  // Permanent listeners: an error or close at any time, backpressured or not,
  // must be observed here rather than surface as an unhandled error event.
  stream.on("error", (error: Error) => failStream(stream, state, error));
  stream.on("close", () =>
    failStream(
      stream,
      state,
      new Error("Logger output stream closed before buffered data was flushed"),
    ),
  );
  return state;
}

function failStream(stream: Writable, state: StreamState, error: Error): void {
  stream.off("drain", state.onDrain);
  state.failure ??= error;
  state.backpressured = false;
  state.queue.length = 0;
  for (const waiter of state.waiters) waiter.reject(state.failure);
  state.waiters.clear();
}

function drain(stream: Writable, state: StreamState): void {
  stream.off("drain", state.onDrain);
  state.backpressured = false;
  while (state.queue.length > 0) {
    if (!writeThrough(stream, state.queue.shift() as string)) {
      state.backpressured = true;
      stream.once("drain", state.onDrain);
      return;
    }
  }
  for (const waiter of state.waiters) waiter.resolve();
  state.waiters.clear();
}

function enqueue(stream: Writable, state: StreamState, line: string, bufferLimit: number): void {
  if (state.failure) return;
  if (state.backpressured) {
    if (bufferLimit === 0) return;
    if (state.queue.length >= bufferLimit) state.queue.shift();
    state.queue.push(line);
    return;
  }
  // A progress renderer may own this stream's current line; go through the
  // arbiter so the log line lands on a clean row and the renderer redraws.
  if (!writeThrough(stream, line)) {
    state.backpressured = true;
    stream.once("drain", state.onDrain);
  }
}

/** Resolves once the stream has accepted every earlier write; rejects if one fails. */
function confirmWrites(stream: Writable): Promise<void> {
  if (typeof stream.writableLength !== "number" || stream.writableLength === 0) {
    return Promise.resolve();
  }
  // An empty write completes only after every write queued before it.
  return new Promise((resolve, reject) => {
    stream.write("", (error) => (error ? reject(error) : resolve()));
  });
}

async function flushStream(stream: Writable, state: StreamState): Promise<void> {
  if (state.failure) throw state.failure;
  if (state.backpressured || state.queue.length > 0) {
    await new Promise<void>((resolve, reject) => state.waiters.add({ resolve, reject }));
    return flushStream(stream, state);
  }
  try {
    await confirmWrites(stream);
  } catch (error) {
    throw state.failure ?? error;
  }
  if (state.failure) throw state.failure;
}

/** Formats the message and arguments, replacing any value whose formatting throws. */
function formatMessage(message: unknown, args: unknown[]): string {
  return guardCall(
    () => format(message, ...args),
    () =>
      [message, ...args]
        .map((value) =>
          guardCall(
            () => format(value),
            () => "[unprintable]",
          ),
        )
        .join(" "),
  );
}

/**
 * The actual factory. `inheritLevel` is how `child()` wires level inheritance;
 * it stays off the exported signature so it never becomes part of the public
 * type contract in the generated declarations.
 */
function createLogger(options: LoggerOptions = {}, inheritLevel?: () => LogLevel): Logger {
  // A logger uses its own level when one is set, otherwise it inherits its
  // parent's current level dynamically. This means `parent.setLevel(...)`
  // propagates to children that have no explicit level of their own, while
  // `child.setLevel(...)` only overrides that child (never the parent).
  // `inheritLevel` is an internal hook wired up by `child()`.
  if (options.level !== undefined) assertLogLevel(options.level);
  let ownLevel: LogLevel | undefined = options.level;

  const prefix = options.prefix;
  const timestamp = options.timestamp ?? false;
  const stream = options.stream ?? process.stderr;
  const bufferLimit = options.bufferLimit ?? 1000;
  if (!Number.isSafeInteger(bufferLimit) || bufferLimit < 0) {
    throw new RangeError("Logger bufferLimit must be a non-negative safe integer");
  }
  const col = createColorizer(stream);
  const colorOn = () => isColorEnabled(stream);
  const state = stateFor(stream);
  const writeLine = (line: string) => enqueue(stream, state, line, bufferLimit);

  function effectiveLevel(): LogLevel {
    return ownLevel ?? inheritLevel?.() ?? "info";
  }

  function shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[effectiveLevel()];
  }

  function writeLog(level: string, message: string, args: unknown[]): void {
    const config = levelConfig[level];
    if (!config) return;

    // Check level (success maps to info level)
    const effectiveLevel = level === "success" ? "info" : (level as LogLevel);
    if (!shouldLog(effectiveLevel)) return;

    // Always go through `format`, even with no extra arguments. This module is
    // reachable from plain JavaScript where `message` can be an Error or an
    // object; `format` renders those instead of handing a non-string to the
    // text pipeline. Strings pass through unchanged.
    const formatted = formatMessage(message, args);

    const parts: string[] = [];
    const colored = colorOn();

    // Icon
    if (colored) {
      parts.push(col[config.colorName](config.ttyIcon));
    } else {
      parts.push(config.icon);
    }

    // Timestamp
    if (timestamp) {
      const ts = formatTimestamp();
      parts.push(colored ? col.dim(ts) : ts);
    }

    // Prefix
    if (prefix) {
      const safePrefix = renderSafe(prefix);
      parts.push(colored ? col.dim(`[${safePrefix}]`) : `[${safePrefix}]`);
    }

    // Message: styling it opens is closed here, before the newline.
    parts.push(renderSafe(formatted, { singleLine: false }));

    writeLine(`${parts.join(" ")}\n`);
  }

  const instance: Logger = {
    debug(message, ...args) {
      writeLog("debug", message, args);
    },
    info(message, ...args) {
      writeLog("info", message, args);
    },
    success(message, ...args) {
      writeLog("success", message, args);
    },
    warn(message, ...args) {
      writeLog("warn", message, args);
    },
    error(message, ...args) {
      writeLog("error", message, args);
    },
    setLevel(level) {
      assertLogLevel(level);
      ownLevel = level;
    },
    child(childPrefix: string) {
      const fullPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      // No explicit level → the child inherits this logger's effective level
      // dynamically (so later parent.setLevel calls still reach it).
      return createLogger({ prefix: fullPrefix, timestamp, stream, bufferLimit }, effectiveLevel);
    },
    flush() {
      return flushStream(stream, state);
    },
  };

  return instance;
}

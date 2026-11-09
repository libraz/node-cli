import type { Writable } from "node:stream";
import { format } from "node:util";
import { describeReceived, usageError } from "../errors.js";
import { guardCall, ownValue } from "../guard.js";
import { createColorizer, isColorEnabled, renderSafe, type StyleName } from "./color.js";
import { canAnimate, writeThrough } from "./region.js";

// ── Types ──

/**
 * Severity levels for log messages, from most verbose to silent.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Configuration options for creating a logger instance.
 */
export interface LoggerOptions {
  /** Minimum log level to output. Messages below this level are suppressed. Defaults to `"info"`. */
  level?: LogLevel | undefined;
  /** Prefix string displayed in brackets before each message. Defaults to none. */
  prefix?: string | undefined;
  /** Whether to include a timestamp (HH:MM:SS) in each log line. Defaults to `false`. */
  timestamp?: boolean | undefined;
  /** Output stream for log messages. Defaults to `process.stderr`. */
  stderr?: Writable | undefined;
  /**
   * Maximum log lines queued while the stream is backpressured, a non-negative
   * safe integer. When the queue is full the oldest line is dropped; `0` drops
   * every line written while the stream is backpressured, until it drains.
   * Defaults to 1000.
   */
  bufferLimit?: number | undefined;
}

/**
 * A structured logger that supports leveled output, prefixes, timestamps, and child loggers.
 */
export interface Logger {
  /** Logs a debug-level message (lowest priority). */
  debug(message: unknown, ...args: unknown[]): void;
  /** Logs an informational message. */
  info(message: unknown, ...args: unknown[]): void;
  /** Logs a success message (shown at info level, marked `✔` or `[OK]`). */
  success(message: unknown, ...args: unknown[]): void;
  /** Logs a warning message. */
  warn(message: unknown, ...args: unknown[]): void;
  /** Logs an error message (highest priority). */
  error(message: unknown, ...args: unknown[]): void;
  /**
   * Changes the minimum log level at runtime. Returns this logger for chaining.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `level` is not a string.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `level` is not a known level.
   */
  setLevel(level: LogLevel): this;
  /**
   * Creates a child logger with an additional prefix segment (`parent:child`).
   * The child shares the parent's stream, timestamp setting and buffer limit, and
   * follows the parent's current level until its own `setLevel` is called.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `prefix` is not a string.
   */
  child(prefix: string): Logger;
  /**
   * Resolves after buffered lines reach the stream; rejects if the stream errors
   * or closes first. After a stream failure the logger and its children become
   * no-ops: later lines are dropped silently and the failure is reported only
   * through `flush()`.
   */
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
  /** Label used where symbols cannot be drawn, e.g. `[INFO]`. */
  icon: string;
  /** Glyph used where the stream can animate, e.g. `\u2139`. */
  ttyIcon: string;
  /** Color style name applied to the icon when colour is enabled. */
  colorName: StyleName;
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
 * Pass a command's `ctx` to log to its `stderr`. A status line is marked with a
 * symbol where the stream can animate and an ASCII tag elsewhere, coloured
 * independently of that choice.
 *
 * The first logger on a stream attaches one `error` and one `close` listener to
 * it; every logger and child on that stream shares the pair, which stays for the
 * stream's lifetime so a stream failure never surfaces as an unhandled error event.
 *
 * @param options - Logger configuration options. Defaults to `{}`.
 * @returns A Logger instance.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a wrongly typed option.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an unknown `level` or an invalid `bufferLimit`.
 * @example
 * ```ts
 * const log = createLogger({ ...ctx, prefix: "deploy" });
 * log.info("starting");
 * log.child("db").success("migrated");
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return buildLogger(options);
}

/**
 * Returns whether `value` is one of the {@link LogLevel} values.
 *
 * @param value - Any value.
 * @returns True for `"debug"`, `"info"`, `"warn"`, `"error"` and `"silent"`.
 */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && ownValue(levelOrder, value) !== undefined;
}

const LOGGER_SUBJECT = "createLogger()";

/** Throws a RangeError naming the accepted levels when `level` is not one of them. */
function assertLogLevel(level: unknown, noun: "option" | "argument", subject: string): void {
  if (typeof level !== "string") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "level" ${noun} of ${subject} must be a string. Received ${describeReceived(level, "type")}`,
    );
  }
  if (!isLogLevel(level)) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "level" ${noun} of ${subject} must be one of: ${Object.keys(levelOrder).join(", ")}. Received ${describeReceived(level, "range")}`,
    );
  }
}

/** Throws a TypeError for an option that is neither omitted nor of the expected type. */
function assertOptionType(
  value: unknown,
  name: string,
  expected: "string" | "boolean" | "number",
): void {
  if (value !== undefined && typeof value !== expected) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "${name}" option of ${LOGGER_SUBJECT} must be ${expected === "boolean" ? "a boolean" : `a ${expected}`}. Received ${describeReceived(value, "type")}`,
    );
  }
}

function resolveStream(value: unknown): Writable {
  if (value === undefined) return process.stderr;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Writable).write !== "function"
  ) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "stderr" option of ${LOGGER_SUBJECT} must be a writable stream. Received ${describeReceived(value, "type")}`,
    );
  }
  return value as Writable;
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

/**
 * Returns the shared state for `stream`, attaching its single `error` and `close`
 * listener pair on first use. Nothing tells the logger when a stream is no longer
 * wanted, so the pair stays; it is one per stream, never one per logger.
 */
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
      new Error("Logger output stream closed before buffered data was flushed"), // usage-error-exempt: stream failure
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
function buildLogger(options: LoggerOptions = {}, inheritLevel?: () => LogLevel): Logger {
  // A logger uses its own level when one is set, otherwise it inherits its
  // parent's current level dynamically. This means `parent.setLevel(...)`
  // propagates to children that have no explicit level of their own, while
  // `child.setLevel(...)` only overrides that child (never the parent).
  // `inheritLevel` is an internal hook wired up by `child()`.
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "options" argument of ${LOGGER_SUBJECT} must be an object. Received ${describeReceived(options, "type")}`,
    );
  }
  if (options.level !== undefined) assertLogLevel(options.level, "option", LOGGER_SUBJECT);
  let ownLevel: LogLevel | undefined = options.level;

  assertOptionType(options.prefix, "prefix", "string");
  assertOptionType(options.timestamp, "timestamp", "boolean");
  assertOptionType(options.bufferLimit, "bufferLimit", "number");
  const prefix = options.prefix;
  const timestamp = options.timestamp ?? false;
  const stream = resolveStream(options.stderr);
  const bufferLimit = options.bufferLimit ?? 1000;
  if (!Number.isSafeInteger(bufferLimit) || bufferLimit < 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "bufferLimit" option of ${LOGGER_SUBJECT} must be a non-negative safe integer. Received ${describeReceived(bufferLimit, "range")}`,
    );
  }
  const col = createColorizer(stream);
  const state = stateFor(stream);
  const writeLine = (line: string) => enqueue(stream, state, line, bufferLimit);

  function effectiveLevel(): LogLevel {
    return ownLevel ?? inheritLevel?.() ?? "info";
  }

  function shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[effectiveLevel()];
  }

  function writeLog(level: string, message: unknown, args: unknown[]): void {
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
    const colored = isColorEnabled(stream);

    // Symbol where the stream can animate, ASCII tag elsewhere; colour is separate.
    parts.push(col[config.colorName](canAnimate(stream) ? config.ttyIcon : config.icon));

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
      assertLogLevel(level, "argument", "Logger.setLevel()");
      ownLevel = level;
      return this;
    },
    child(childPrefix: string) {
      if (typeof childPrefix !== "string") {
        throw usageError(
          "type",
          "ERR_INVALID_ARG_TYPE",
          `The "prefix" argument of Logger.child() must be a string. Received ${describeReceived(childPrefix, "type")}`,
        );
      }
      const fullPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      // No explicit level → the child inherits this logger's effective level
      // dynamically (so later parent.setLevel calls still reach it).
      return buildLogger(
        { prefix: fullPrefix, timestamp, stderr: stream, bufferLimit },
        effectiveLevel,
      );
    },
    flush() {
      return flushStream(stream, state);
    },
  };

  return instance;
}

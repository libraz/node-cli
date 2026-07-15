import type { Writable } from "node:stream";
import { format } from "node:util";
import { createColorizer, isColorEnabled } from "./color.js";

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
  /** Resolves when all logger-managed buffered lines have been handed to the stream. */
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
  /** Icon used in non-TTY output (plain text). */
  icon: string;
  /** Icon used in TTY output (with color support). */
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
export function logger(options: LoggerOptions = {}, inheritLevel?: () => LogLevel): Logger {
  // A logger uses its own level when one is set, otherwise it inherits its
  // parent's current level dynamically. This means `parent.setLevel(...)`
  // propagates to children that have no explicit level of their own, while
  // `child.setLevel(...)` only overrides that child (never the parent).
  // `inheritLevel` is an internal hook wired up by `child()`.
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
  const bufferedLines: string[] = [];
  const flushWaiters = new Set<() => void>();
  let backpressured = false;

  const resolveFlushWaiters = () => {
    if (backpressured || bufferedLines.length > 0) return;
    for (const resolve of flushWaiters) resolve();
    flushWaiters.clear();
  };

  const flushBuffered = () => {
    backpressured = false;
    while (bufferedLines.length > 0) {
      const line = bufferedLines.shift() as string;
      if (!stream.write(line)) {
        backpressured = true;
        stream.once("drain", flushBuffered);
        return;
      }
    }
    resolveFlushWaiters();
  };

  const writeLine = (line: string) => {
    if (backpressured) {
      if (bufferLimit === 0) return;
      if (bufferedLines.length >= bufferLimit) bufferedLines.shift();
      bufferedLines.push(line);
      return;
    }
    if (!stream.write(line)) {
      backpressured = true;
      stream.once("drain", flushBuffered);
    }
  };

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

    const formatted = args.length > 0 ? format(message, ...args) : message;

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
      parts.push(colored ? col.dim(`[${prefix}]`) : `[${prefix}]`);
    }

    // Message
    parts.push(formatted);

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
      ownLevel = level;
    },
    child(childPrefix: string) {
      const fullPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      // No explicit level → the child inherits this logger's effective level
      // dynamically (so later parent.setLevel calls still reach it).
      return logger({ prefix: fullPrefix, timestamp, stream, bufferLimit }, effectiveLevel);
    },
    flush() {
      if (!backpressured && bufferedLines.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => flushWaiters.add(resolve));
    },
  };

  return instance;
}

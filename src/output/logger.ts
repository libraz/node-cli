import type { Writable } from "node:stream";
import { format } from "node:util";
import { color as c } from "./color.js";

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
  /** Color function applied to the icon in TTY mode. */
  colorFn: (s: string) => string;
  /** Short label for the level. */
  label: string;
}

const levelConfig: Record<string, LevelConfig> = {
  debug: { icon: "[DEBUG]", ttyIcon: "●", colorFn: (s) => c.dim(s), label: "DEBUG" },
  info: { icon: "[INFO]", ttyIcon: "ℹ", colorFn: (s) => c.blue(s), label: "INFO" },
  success: { icon: "[OK]", ttyIcon: "✔", colorFn: (s) => c.green(s), label: "OK" },
  warn: { icon: "[WARN]", ttyIcon: "⚠", colorFn: (s) => c.yellow(s), label: "WARN" },
  error: { icon: "[ERROR]", ttyIcon: "✖", colorFn: (s) => c.red(s), label: "ERROR" },
};

// ── Implementation ──

/**
 * Checks whether the given stream is a TTY (terminal).
 */
function isTTY(stream: Writable): boolean {
  return "isTTY" in stream && (stream as NodeJS.WriteStream).isTTY === true;
}

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
  let currentLevel = options.level ?? "info";
  const prefix = options.prefix;
  const timestamp = options.timestamp ?? false;
  const stream = options.stream ?? process.stderr;

  function shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[currentLevel];
  }

  function writeLog(level: string, message: string, args: unknown[]): void {
    const config = levelConfig[level];
    if (!config) return;

    // Check level (success maps to info level)
    const effectiveLevel = level === "success" ? "info" : (level as LogLevel);
    if (!shouldLog(effectiveLevel)) return;

    const formatted = args.length > 0 ? format(message, ...args) : message;

    const parts: string[] = [];

    const tty = isTTY(stream);

    // Icon
    if (tty) {
      parts.push(config.colorFn(config.ttyIcon));
    } else {
      parts.push(config.icon);
    }

    // Timestamp
    if (timestamp) {
      const ts = formatTimestamp();
      parts.push(tty ? c.dim(ts) : ts);
    }

    // Prefix
    if (prefix) {
      parts.push(tty ? c.dim(`[${prefix}]`) : `[${prefix}]`);
    }

    // Message
    parts.push(formatted);

    stream.write(`${parts.join(" ")}\n`);
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
      currentLevel = level;
    },
    child(childPrefix: string) {
      const fullPrefix = prefix ? `${prefix}:${childPrefix}` : childPrefix;
      return logger({
        level: currentLevel,
        prefix: fullPrefix,
        timestamp,
        stream,
      });
    },
  };

  return instance;
}

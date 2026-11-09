import { createWriteStream } from "node:fs";
import { Writable } from "node:stream";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderSafe, setColorEnabled } from "../src/output/color.js";
import { createLogger } from "../src/output/logger.js";
import { progress, restoreCursor } from "../src/output/progress.js";
import { setRegionOwner } from "../src/output/region.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

describe("logger", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("logs info messages", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream });
    log.info("hello");
    expect(stream.getOutput()).toContain("hello");
    expect(stream.getOutput()).toContain("[INFO]");
  });

  it("removes terminal control sequences from untrusted log messages", () => {
    const stream = createMockStdout();
    createLogger({ stderr: stream }).info("\x1b]2;spoofed\x07hello\rworld");
    expect(stream.getOutput()).not.toContain("\x1b]2;");
    // The carriage return is removed, but as a space: dropping it outright
    // would join two words the caller kept apart.
    expect(stream.getOutput()).toContain("hello world");
    expect(stream.getOutput()).not.toContain("\r");
  });

  it("suppresses debug at info level", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "info" });
    log.debug("hidden");
    expect(stream.getOutput()).toBe("");
  });

  it("shows debug at debug level", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "debug" });
    log.debug("visible");
    expect(stream.getOutput()).toContain("visible");
    expect(stream.getOutput()).toContain("[DEBUG]");
  });

  it("logs all levels correctly", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "debug" });
    log.debug("d");
    log.info("i");
    log.success("s");
    log.warn("w");
    log.error("e");
    const output = stream.getOutput();
    expect(output).toContain("[DEBUG]");
    expect(output).toContain("[INFO]");
    expect(output).toContain("[OK]");
    expect(output).toContain("[WARN]");
    expect(output).toContain("[ERROR]");
  });

  it("silent level suppresses all", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "silent" });
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(stream.getOutput()).toBe("");
  });

  it("adds prefix", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, prefix: "app" });
    log.info("hello");
    expect(stream.getOutput()).toContain("[app]");
  });

  it("creates child logger with combined prefix", () => {
    const stream = createMockStdout();
    const parent = createLogger({ stderr: stream, prefix: "app" });
    const child = parent.child("db");
    child.info("connected");
    expect(stream.getOutput()).toContain("[app:db]");
  });

  it("changes level dynamically", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "info" });
    log.debug("hidden");
    expect(stream.getOutput()).toBe("");

    log.setLevel("debug");
    log.debug("visible");
    expect(stream.getOutput()).toContain("visible");
  });

  it("adds timestamp", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, timestamp: true });
    log.info("hello");
    // Should contain HH:MM:SS pattern
    expect(stream.getOutput()).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("supports printf-style formatting", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream });
    log.info("hello %s, count: %d", "world", 42);
    expect(stream.getOutput()).toContain("hello world, count: 42");
  });

  it("renders icon, then prefix, then message in that order", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, prefix: "app" });
    log.info("hi");
    expect(stream.getOutput()).toBe("[INFO] [app] hi\n");
  });

  it("child setLevel does not affect the parent", () => {
    const stream = createMockStdout();
    const parent = createLogger({ stderr: stream, level: "info" });
    const child = parent.child("db");
    child.setLevel("debug");

    parent.debug("parent-debug");
    expect(stream.getOutput()).toBe("");

    child.debug("child-debug");
    expect(stream.getOutput()).toContain("child-debug");
  });

  it("child dynamically inherits parent level changes until overridden", () => {
    const stream = createMockStdout();
    const parent = createLogger({ stderr: stream, level: "warn" });
    const child = parent.child("db");
    child.info("hidden");
    expect(stream.getOutput()).toBe("");

    parent.setLevel("info");
    child.info("now-visible");
    expect(stream.getOutput()).toContain("now-visible");

    child.setLevel("error");
    parent.setLevel("debug");
    child.warn("still-hidden");
    expect(stream.getOutput()).not.toContain("still-hidden");

    child.warn("shown");
    expect(stream.getOutput()).not.toContain("shown");
  });

  it("bounds queued lines during backpressure and exposes flush", async () => {
    let output = "";
    let writes = 0;
    let onDrain: (() => void) | undefined;
    const stream = {
      write(chunk: string) {
        output += chunk;
        writes++;
        return writes !== 1;
      },
      once(event: string, handler: () => void) {
        if (event === "drain") onDrain = handler;
        return stream;
      },
      on() {
        return stream;
      },
      off() {
        return stream;
      },
    } as unknown as Writable;
    const log = createLogger({ stderr: stream, bufferLimit: 1 });
    log.info("first");
    log.info("dropped");
    log.info("latest");
    const flushed = log.flush();
    onDrain?.();
    await flushed;
    expect(output).toContain("first");
    expect(output).toContain("latest");
    expect(output).not.toContain("dropped");
  });

  it("waits for buffered child logger output when flushing the parent", async () => {
    let writes = 0;
    let onDrain: (() => void) | undefined;
    const stream = {
      write() {
        writes++;
        return writes !== 1;
      },
      once(event: string, handler: () => void) {
        if (event === "drain") onDrain = handler;
        return stream;
      },
      on() {
        return stream;
      },
      off() {
        return stream;
      },
    } as unknown as Writable;
    const parent = createLogger({ stderr: stream });
    const child = parent.child("db");
    child.info("connecting");

    let settled = false;
    const flushed = parent.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    onDrain?.();
    await flushed;
  });

  it("validates bufferLimit", () => {
    expect(() => createLogger({ bufferLimit: -1 })).toThrow(RangeError);
    expect(() => createLogger({ bufferLimit: 1.5 })).toThrow(RangeError);
    expect(() => createLogger({ bufferLimit: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it.each(["error", "close"] as const)(
    "rejects flush when a backpressured stream emits %s before drain",
    async (terminalEvent) => {
      const listeners = new Map<string, (...args: unknown[]) => void>();
      const stream = {
        write() {
          return false;
        },
        once(event: string, handler: (...args: unknown[]) => void) {
          listeners.set(event, handler);
          return stream;
        },
        on(event: string, handler: (...args: unknown[]) => void) {
          listeners.set(event, handler);
          return stream;
        },
        off(event: string, handler: (...args: unknown[]) => void) {
          if (listeners.get(event) === handler) listeners.delete(event);
          return stream;
        },
      } as unknown as Writable;
      const log = createLogger({ stderr: stream });
      log.info("queued");
      const flushed = log.flush();
      if (terminalEvent === "error") {
        listeners.get("error")?.(new Error("disk failed"));
      } else {
        listeners.get("close")?.();
      }
      await expect(flushed).rejects.toThrow(terminalEvent === "error" ? "disk failed" : "closed");
    },
  );
});

/**
 * Replays the carriage returns, line erases and newlines a single-line renderer
 * emits, yielding what each terminal row finally shows.
 */
function renderRows(output: string): string[] {
  const rows: string[] = [""];
  let column = 0;
  for (let i = 0; i < output.length; i++) {
    if (output.startsWith("\x1b[K", i)) {
      rows[rows.length - 1] = rows[rows.length - 1].slice(0, column);
      i += 2;
      continue;
    }
    const ch = output[i];
    if (ch === "\n") {
      rows.push("");
      column = 0;
    } else if (ch === "\r") {
      column = 0;
    } else {
      const row = rows[rows.length - 1].padEnd(column, " ");
      rows[rows.length - 1] = row.slice(0, column) + ch + row.slice(column + 1);
      column++;
    }
  }
  return rows;
}

describe("untrusted logger metadata", () => {
  it("strips control sequences from a prefix and from child names", () => {
    const stream = createMockStdout();
    createLogger({ stderr: stream, prefix: "\x1b]2;spoofed\x07api" }).info("hello");
    expect(stream.getOutput()).not.toContain("\x1b]2;");
    expect(stream.getOutput()).toContain("[api]");

    const childStream = createMockStdout();
    createLogger({ stderr: childStream }).child("\x1b]2;spoofed\x07db").info("hello");
    expect(childStream.getOutput()).not.toContain("\x1b]2;");
    expect(childStream.getOutput()).toContain("[db]");
  });
});

describe("logging beside an active progress renderer", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    restoreCursor();
    setColorEnabled("auto");
  });

  it("emits the log line on a cleared row and lets the renderer redraw", () => {
    restoreCursor();
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "working", stderr: stream });
    const log = createLogger({ stderr: stream, timestamp: false });
    const before = stream.getOutput().length;

    log.info("hello");
    const written = stream.getOutput().slice(before);
    spinner.stop();

    // The row the spinner owns is erased before the log line is written, so the
    // two never share a row in the terminal's scrollback.
    expect(written.startsWith("\r\x1b[K")).toBe(true);
    const logEnd = written.indexOf("hello\n") + "hello\n".length;
    expect(logEnd).toBeGreaterThan(0);
    // ... and the renderer redraws itself below the log line.
    expect(written.slice(logEnd)).toContain("working");

    // Interpreting the control sequences (rather than splitting the raw buffer)
    // is what distinguishes "the log overwrote the frame" from "the log was
    // appended to a live frame and the two merged".
    for (const row of renderRows(stream.getOutput())) {
      expect(row.includes("hello") && row.includes("working")).toBe(false);
    }
  });

  it("writes straight through when no renderer owns the stream", () => {
    const stream = createMockTTY();
    createLogger({ stderr: stream, timestamp: false }).info("hello");
    expect(stream.getOutput().startsWith("\r\x1b[K")).toBe(false);
    expect(stream.getOutput()).toContain("hello");
  });
});

describe("child level inheritance", () => {
  it("follows a later parent setLevel and is not overridden by the child", () => {
    const stream = createMockStdout();
    const parent = createLogger({ stderr: stream });
    const child = parent.child("db");

    parent.setLevel("debug");
    child.debug("inherited");
    expect(stream.getOutput()).toContain("inherited");

    child.setLevel("error");
    child.debug("suppressed");
    expect(stream.getOutput()).not.toContain("suppressed");

    parent.debug("parent unchanged");
    expect(stream.getOutput()).toContain("parent unchanged");
  });
});

describe("logger stream failure", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("rejects flush instead of crashing when the file cannot be opened", async () => {
    const stream = createWriteStream("/nonexistent-logger-dir/x.log");
    const log = createLogger({ stderr: stream });
    log.info("hello");
    await expect(log.flush()).rejects.toThrow(/ENOENT/);
    await expect(log.flush()).rejects.toThrow(/ENOENT/);
  });

  it("rejects flush when a write fails without any backpressure", async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(new Error("disk full")));
      },
    });
    const log = createLogger({ stderr: stream });
    log.info("lost");
    await expect(log.flush()).rejects.toThrow("disk full");
    expect(() => log.info("later")).not.toThrow();
    await expect(log.child("db").flush()).rejects.toThrow("disk full");
  });

  it("does not resolve flush while an earlier write is still pending", async () => {
    let written = false;
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        setTimeout(() => {
          written = true;
          callback();
        }, 20);
      },
    });
    const log = createLogger({ stderr: stream });
    log.info("slow");
    await log.flush();
    expect(written).toBe(true);
  });
});

describe("logger tree sharing one stream", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("delivers parent and child lines in call order on a slow stream", async () => {
    const received: string[] = [];
    const stream = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        received.push(chunk.toString().trim());
        setImmediate(callback);
      },
    });
    const parent = createLogger({ stderr: stream });
    const child = parent.child("c");
    parent.info("p1");
    parent.info("p2");
    child.info("c3");
    parent.info("p4");
    child.info("c5");
    await parent.flush();
    expect(received.map((line) => line.split(" ").at(-1))).toEqual(["p1", "p2", "c3", "p4", "c5"]);
  });

  it("applies bufferLimit to the whole tree", async () => {
    let output = "";
    let writes = 0;
    let onDrain: (() => void) | undefined;
    const stream = {
      write(chunk: string) {
        output += chunk;
        writes++;
        return writes !== 1;
      },
      once(event: string, handler: () => void) {
        if (event === "drain") onDrain = handler;
        return stream;
      },
      on() {
        return stream;
      },
      off() {
        return stream;
      },
    } as unknown as Writable;
    const parent = createLogger({ stderr: stream, bufferLimit: 2 });
    const child = parent.child("c");
    parent.info("first");
    parent.info("p1");
    child.info("c1");
    parent.info("p2");
    const flushed = child.flush();
    onDrain?.();
    await flushed;
    expect(output).not.toContain("p1");
    expect(output.indexOf("c1")).toBeLessThan(output.indexOf("p2"));
  });
});

describe("logger input handling", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("does not throw when formatting an argument runs throwing caller code", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream });
    const hostile = {
      toString() {
        throw new Error("boom");
      },
      [inspect.custom]() {
        throw new Error("boom");
      },
    };
    expect(() => log.info("value: %s", hostile)).not.toThrow();
    expect(() => log.child("db").error("raw", hostile)).not.toThrow();
    expect(stream.getOutput()).toContain("[unprintable]");
    expect(stream.getOutput().split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("closes styling and links a message leaves open before the newline", () => {
    const stream = createMockStdout();
    const message = "\x1b[31mred \x1b]8;;https://example.invalid\x1b\\link";
    createLogger({ stderr: stream }).info(message);
    const closed = renderSafe(message, { singleLine: false });
    expect(closed).not.toBe(message);
    expect(stream.getOutput().endsWith(`${closed}\n`)).toBe(true);
    expect(closed).toContain("\x1b]8;;\x1b\\\x1b[39m");
  });

  it("rejects an unknown level instead of muting every line", () => {
    expect(() => createLogger({ level: "verbose" as never })).toThrow(RangeError);
    const log = createLogger({ stderr: createMockStdout() });
    expect(() => log.setLevel("WARN" as never)).toThrow(RangeError);
    expect(() => log.setLevel("toString" as never)).toThrow(RangeError);
    expect(() => log.setLevel("WARN" as never)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
  });

  it("returns the logger from setLevel so calls chain", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream, level: "error" });
    expect(log.setLevel("debug")).toBe(log);
    log.setLevel("info").setLevel("debug").debug("chained");
    expect(stream.getOutput()).toContain("chained");
  });

  it("accepts non-string messages", () => {
    const stream = createMockStdout();
    const log = createLogger({ stderr: stream });
    log.info(new Error("boom"));
    log.warn({ a: 1 });
    log.error(42);
    expect(stream.getOutput()).toContain("boom");
    expect(stream.getOutput()).toContain("a: 1");
    expect(stream.getOutput()).toContain("42");
  });

  it("keeps working when a region owner throws while a line is written", () => {
    const stream = createMockTTY();
    setRegionOwner(stream, {
      clear: () => {
        throw new Error("clear failed");
      },
      redraw: () => {
        throw new Error("redraw failed");
      },
    });
    const log = createLogger({ stderr: stream });
    expect(() => log.info("one")).not.toThrow();
    expect(() => log.info("two")).not.toThrow();
    expect(stream.getOutput()).toContain("one");
    expect(stream.getOutput()).toContain("two");
    setRegionOwner(stream, null);
  });
});

describe("default output stream", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("writes every level to stderr and nothing to stdout", () => {
    const stderrWrites: string[] = [];
    const stdoutWrites: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    try {
      const log = createLogger({ level: "debug" });
      log.debug("d");
      log.info("i");
      log.success("s");
      log.warn("w");
      log.child("c").error("e");
    } finally {
      stderrSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
    expect(stderrWrites).toHaveLength(5);
    expect(stdoutWrites).toEqual([]);
  });
});

function catchError(fn: () => unknown): Error & { code?: string } {
  try {
    fn();
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error("expected the call to throw");
}

describe("logger option validation", () => {
  const typeCases: [string, () => unknown][] = [
    ["options", () => createLogger(null as never)],
    ["level", () => createLogger({ level: 1 as never })],
    ["prefix", () => createLogger({ prefix: 1 as never })],
    ["timestamp", () => createLogger({ timestamp: "yes" as never })],
    ["stderr", () => createLogger({ stderr: "x" as never })],
    ["bufferLimit", () => createLogger({ bufferLimit: "9" as never })],
  ];
  it.each(typeCases)("rejects a wrongly typed %s with ERR_INVALID_ARG_TYPE", (_name, fn) => {
    const error = catchError(fn);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(error.message).toMatch(/^The "\w+" (option|argument) of createLogger\(\)/);
  });

  it("rejects a bad value with ERR_INVALID_ARG_VALUE and echoes it", () => {
    const level = catchError(() => createLogger({ level: "verbose" as never }));
    expect(level).toBeInstanceOf(RangeError);
    expect(level.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(level.message).toContain('The "level" option of createLogger() must be one of');
    expect(level.message).toContain("verbose");
    const limit = catchError(() => createLogger({ bufferLimit: -1 }));
    expect(limit.message).toContain('The "bufferLimit" option of createLogger()');
    expect(limit.message).toContain("Received -1");
  });

  it("treats undefined option values as omitted", () => {
    expect(() =>
      createLogger({
        level: undefined,
        prefix: undefined,
        timestamp: undefined,
        stderr: createMockStdout(),
        bufferLimit: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects a non-string setLevel argument with a TypeError", () => {
    const log = createLogger({ stderr: createMockStdout() });
    expect(catchError(() => log.setLevel(1 as never)).code).toBe("ERR_INVALID_ARG_TYPE");
  });
});

describe("isLogLevel", () => {
  it("is exported from the root and narrows only the five levels", async () => {
    const { isLogLevel } = await import("../src/index.js");
    for (const level of ["debug", "info", "warn", "error", "silent"]) {
      expect(isLogLevel(level)).toBe(true);
    }
    for (const value of ["INFO", "success", "toString", "", 1, null, undefined, {}]) {
      expect(isLogLevel(value)).toBe(false);
    }
  });
});

describe("logger status marks", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ["NO_COLOR", "FORCE_COLOR", "TERM"]) saved[key] = process.env[key];
    setColorEnabled("auto");
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.TERM = "xterm-256color";
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses symbols on a TTY even when colour is off", () => {
    process.env.NO_COLOR = "1";
    const stream = createMockTTY();
    const log = createLogger({ stderr: stream, level: "debug" });
    log.success("s");
    log.error("e");
    log.warn("w");
    expect(stream.getOutput()).toBe("✔ s\n✖ e\n⚠ w\n");
  });

  it("uses coloured symbols on a coloured TTY", () => {
    const stream = createMockTTY();
    createLogger({ stderr: stream }).success("s");
    expect(stream.getOutput()).toContain("\x1b[32m✔");
  });

  it("uses coloured ASCII marks on a non-TTY under FORCE_COLOR", () => {
    process.env.FORCE_COLOR = "1";
    const stream = createMockStdout();
    createLogger({ stderr: stream }).error("e");
    expect(stream.getOutput()).toContain("\x1b[");
    expect(stream.getOutput()).toContain("[ERROR]");
    expect(stream.getOutput()).not.toContain("✖");
  });

  it("uses plain ASCII marks on a non-TTY", () => {
    const stream = createMockStdout();
    createLogger({ stderr: stream }).success("s");
    expect(stream.getOutput()).toBe("[OK] s\n");
  });

  it("uses ASCII marks and no cursor control when TERM=dumb", () => {
    process.env.TERM = "dumb";
    const stream = createMockTTY();
    createLogger({ stderr: stream }).warn("w");
    expect(stream.getOutput()).toBe("[WARN] w\n");
  });
});

describe("logger stream listeners", () => {
  it("attaches exactly one error and close listener per stream however many loggers share it", () => {
    const stream = createMockStdout();
    const before = [stream.listenerCount("error"), stream.listenerCount("close")];
    const root = createLogger({ stderr: stream });
    root.child("a").child("b");
    createLogger({ stderr: stream, prefix: "other" });
    expect([stream.listenerCount("error"), stream.listenerCount("close")]).toEqual([
      before[0] + 1,
      before[1] + 1,
    ]);
  });
});

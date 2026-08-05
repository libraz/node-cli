import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetColorEnabled, setColorEnabled } from "../src/output/color.js";
import { logger } from "../src/output/logger.js";
import { createMockStdout } from "./helpers.js";

describe("logger", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => resetColorEnabled());

  it("logs info messages", () => {
    const stream = createMockStdout();
    const log = logger({ stream });
    log.info("hello");
    expect(stream.getOutput()).toContain("hello");
    expect(stream.getOutput()).toContain("[INFO]");
  });

  it("removes terminal control sequences from untrusted log messages", () => {
    const stream = createMockStdout();
    logger({ stream }).info("\x1b]2;spoofed\x07hello\rworld");
    expect(stream.getOutput()).not.toContain("\x1b]2;");
    expect(stream.getOutput()).toContain("helloworld");
    expect(stream.getOutput()).not.toContain("\r");
  });

  it("suppresses debug at info level", () => {
    const stream = createMockStdout();
    const log = logger({ stream, level: "info" });
    log.debug("hidden");
    expect(stream.getOutput()).toBe("");
  });

  it("shows debug at debug level", () => {
    const stream = createMockStdout();
    const log = logger({ stream, level: "debug" });
    log.debug("visible");
    expect(stream.getOutput()).toContain("visible");
    expect(stream.getOutput()).toContain("[DEBUG]");
  });

  it("logs all levels correctly", () => {
    const stream = createMockStdout();
    const log = logger({ stream, level: "debug" });
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
    const log = logger({ stream, level: "silent" });
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(stream.getOutput()).toBe("");
  });

  it("adds prefix", () => {
    const stream = createMockStdout();
    const log = logger({ stream, prefix: "app" });
    log.info("hello");
    expect(stream.getOutput()).toContain("[app]");
  });

  it("creates child logger with combined prefix", () => {
    const stream = createMockStdout();
    const parent = logger({ stream, prefix: "app" });
    const child = parent.child("db");
    child.info("connected");
    expect(stream.getOutput()).toContain("[app:db]");
  });

  it("changes level dynamically", () => {
    const stream = createMockStdout();
    const log = logger({ stream, level: "info" });
    log.debug("hidden");
    expect(stream.getOutput()).toBe("");

    log.setLevel("debug");
    log.debug("visible");
    expect(stream.getOutput()).toContain("visible");
  });

  it("adds timestamp", () => {
    const stream = createMockStdout();
    const log = logger({ stream, timestamp: true });
    log.info("hello");
    // Should contain HH:MM:SS pattern
    expect(stream.getOutput()).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("supports printf-style formatting", () => {
    const stream = createMockStdout();
    const log = logger({ stream });
    log.info("hello %s, count: %d", "world", 42);
    expect(stream.getOutput()).toContain("hello world, count: 42");
  });

  it("renders icon, then prefix, then message in that order", () => {
    const stream = createMockStdout();
    const log = logger({ stream, prefix: "app" });
    log.info("hi");
    expect(stream.getOutput()).toBe("[INFO] [app] hi\n");
  });

  it("child setLevel does not affect the parent", () => {
    const stream = createMockStdout();
    const parent = logger({ stream, level: "info" });
    const child = parent.child("db");
    child.setLevel("debug");

    parent.debug("parent-debug");
    expect(stream.getOutput()).toBe("");

    child.debug("child-debug");
    expect(stream.getOutput()).toContain("child-debug");
  });

  it("child dynamically inherits parent level changes until overridden", () => {
    const stream = createMockStdout();
    const parent = logger({ stream, level: "warn" });
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
      off() {
        return stream;
      },
    } as unknown as Writable;
    const log = logger({ stream, bufferLimit: 1 });
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
      off() {
        return stream;
      },
    } as unknown as Writable;
    const parent = logger({ stream });
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
    expect(() => logger({ bufferLimit: -1 })).toThrow(RangeError);
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
        off(event: string, handler: (...args: unknown[]) => void) {
          if (listeners.get(event) === handler) listeners.delete(event);
          return stream;
        },
      } as unknown as Writable;
      const log = logger({ stream });
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

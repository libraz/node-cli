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
});

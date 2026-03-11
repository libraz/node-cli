import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetColorEnabled, setColorEnabled, stripAnsi } from "../src/output/color.js";
import { progress } from "../src/output/progress.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

describe("progress.bar", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => resetColorEnabled());

  it("renders on TTY stream", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stream });
    bar.update(50);
    const output = stripAnsi(stream.getOutput());
    expect(output).toContain("50%");
    expect(output).toContain("50/100");
    bar.finish();
  });

  it("shows label", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, label: "Downloading", stream });
    bar.update(30);
    expect(stream.getOutput()).toContain("Downloading");
    bar.finish();
  });

  it("ticks by delta", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stream });
    bar.tick();
    bar.tick(4);
    const output = stripAnsi(stream.getOutput());
    expect(output).toContain("5/10");
    bar.stop();
  });

  it("clamps to total", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stream });
    bar.update(999);
    const output = stripAnsi(stream.getOutput());
    expect(output).toContain("100%");
    bar.finish();
  });

  it("uses custom format", () => {
    const stream = createMockTTY();
    const format = vi.fn((state) => `${state.current}/${state.total}`);
    const bar = progress.bar({ total: 100, stream, format });
    bar.update(50);
    expect(format).toHaveBeenCalled();
    expect(stream.getOutput()).toContain("50/100");
    bar.finish();
  });

  it("uses custom fill/empty characters", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stream, filled: "#", empty: ".", width: 10 });
    bar.update(50);
    expect(stream.getOutput()).toContain("#");
    expect(stream.getOutput()).toContain(".");
    bar.finish();
  });

  it("applies color to bar", () => {
    setColorEnabled(true);
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stream, color: "green" });
    bar.update(50);
    expect(stream.getOutput()).toContain("\x1b[32m");
    bar.finish();
  });

  it("does not render on non-TTY", () => {
    const stream = createMockStdout();
    const bar = progress.bar({ total: 100, stream });
    bar.update(50);
    expect(stream.getOutput()).toBe("");
    bar.finish();
  });

  it("stop writes newline on TTY", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stream });
    bar.update(50);
    bar.stop();
    expect(stream.getOutput()).toContain("\n");
  });
});

describe("progress.spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setColorEnabled(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetColorEnabled();
  });

  it("renders frames on TTY", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Loading...", stream });
    spinner.start();
    vi.advanceTimersByTime(80);
    expect(stream.getOutput()).toContain("Loading...");
    spinner.stop();
  });

  it("succeed writes check mark", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Loading...", stream });
    spinner.start();
    spinner.succeed("Done");
    expect(stripAnsi(stream.getOutput())).toContain("✔");
    expect(stream.getOutput()).toContain("Done");
  });

  it("fail writes cross mark", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.fail("Error");
    expect(stripAnsi(stream.getOutput())).toContain("✖");
    expect(stream.getOutput()).toContain("Error");
  });

  it("warn writes warning mark", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.warn("Caution");
    expect(stripAnsi(stream.getOutput())).toContain("⚠");
    expect(stream.getOutput()).toContain("Caution");
  });

  it("updates label", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Step 1", stream });
    spinner.start();
    spinner.update("Step 2");
    vi.advanceTimersByTime(80);
    expect(stream.getOutput()).toContain("Step 2");
    spinner.stop();
  });

  it("uses custom frames", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ frames: ["-", "|"], stream });
    spinner.start();
    expect(stream.getOutput()).toContain("-");
    vi.advanceTimersByTime(80);
    expect(stream.getOutput()).toContain("|");
    spinner.stop();
  });

  it("applies color to frames", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream, color: "cyan" });
    spinner.start();
    expect(stream.getOutput()).toContain("\x1b[36m");
    spinner.stop();
  });

  it("does not start twice", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.start(); // Should not throw
    spinner.stop();
  });

  it("succeed uses label as default message", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Processing", stream });
    spinner.start();
    spinner.succeed();
    expect(stream.getOutput()).toContain("Processing");
  });
});

describe("progress.multi", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => resetColorEnabled());

  it("creates and updates multiple bars on TTY", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar1 = multi.add({ total: 100, label: "File 1", stream });
    const bar2 = multi.add({ total: 200, label: "File 2", stream });

    bar1.update(50);
    bar2.update(100);
    const output = stream.getOutput();
    expect(output).toContain("File 1");
    expect(output).toContain("File 2");
    multi.finish();
  });

  it("ticks bars in multi", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, label: "Task", stream });
    bar.tick(5);
    expect(stream.getOutput()).toContain("Task");
    multi.stop();
  });

  it("individual bar finish", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, stream });
    bar.finish();
    expect(stream.getOutput()).toContain("100%");
    multi.stop();
  });

  it("non-TTY multi bars do not output", () => {
    const stream = createMockStdout();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, stream });
    bar.update(5);
    expect(stream.getOutput()).toBe("");
    multi.finish();
  });
});

import type { Writable } from "node:stream";
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

  it("hides and restores the cursor on TTY", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stream });
    bar.update(50);
    expect(stream.getOutput()).toContain("\x1b[?25l");
    bar.finish();
    expect(stream.getOutput()).toContain("\x1b[?25h");
  });

  it("coalesces redraw frames while a stream is backpressured", () => {
    let output = "";
    let frameWrites = 0;
    let onDrain: (() => void) | undefined;
    const stream = {
      isTTY: true,
      columns: 80,
      write(chunk: string) {
        output += chunk;
        if (chunk.includes("\x1b[K")) frameWrites++;
        return frameWrites !== 1;
      },
      once(event: string, handler: () => void) {
        if (event === "drain") onDrain = handler;
        return stream;
      },
    } as unknown as Writable;
    const bar = progress.bar({ total: 10, stream });
    bar.update(1);
    bar.update(2);
    bar.update(3);
    expect(output).toContain("1/10");
    expect(output).not.toContain("2/10");
    onDrain?.();
    expect(output).toContain("3/10");
    bar.stop();
  });

  it("normalizes labels and custom formats to one terminal line", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, label: "line1\nline2\t", stream });
    bar.update(1);
    expect(stripAnsi(stream.getOutput())).toContain("line1 line2 ");
    expect(stripAnsi(stream.getOutput()).split("\n")).toHaveLength(1);
    bar.stop();
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

  it("hides the cursor on start and shows it again on stop", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Loading...", stream });
    spinner.start();
    expect(stream.getOutput()).toContain("\x1b[?25l");
    spinner.stop();
    expect(stream.getOutput()).toContain("\x1b[?25h");
  });

  it("writes final messages on a non-TTY stream", () => {
    const stream = createMockStdout();
    const spinner = progress.spinner({ label: "Loading...", stream });
    spinner.start();
    spinner.succeed("Done");
    expect(stripAnsi(stream.getOutput())).toContain("✔ Done");
  });

  it("keeps final status messages on a single line", () => {
    const stream = createMockStdout();
    const spinner = progress.spinner({ stream, label: "unsafe\tlabel" });
    spinner.succeed("done\nnext");
    expect(stream.getOutput()).toContain("done next\n");
    expect(stream.getOutput()).not.toContain("done\nnext");
  });
});

describe("progress.spinner signal ownership", () => {
  let baseline: number;

  beforeEach(() => {
    setColorEnabled(true);
    baseline = process.listenerCount("SIGINT");
  });

  afterEach(() => {
    resetColorEnabled();
  });

  it("does not take ownership of SIGINT", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    expect(process.listenerCount("SIGINT")).toBe(baseline);
    spinner.stop();
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("removes the SIGINT handler on succeed", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.succeed("Done");
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("removes the SIGINT handler on fail", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.fail("Error");
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("removes the SIGINT handler on warn", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.warn("Caution");
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("cleanup is idempotent across stop then succeed", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    spinner.stop();
    expect(() => spinner.succeed("Done")).not.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("shares cursor ownership between two spinners and a bar", () => {
    const stream = createMockTTY();
    const first = progress.spinner({ stream });
    const second = progress.spinner({ stream });
    const bar = progress.bar({ total: 2, stream });
    first.start();
    second.start();
    bar.tick();
    expect(stream.getOutput().split("\x1b[?25l")).toHaveLength(2);

    second.stop();
    bar.finish();
    expect(stream.getOutput()).not.toContain("\x1b[?25h");
    first.stop();
    expect(stream.getOutput().split("\x1b[?25h")).toHaveLength(2);
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

  it("hides and restores the cursor on TTY", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, stream });
    bar.update(1);
    expect(stream.getOutput()).toContain("\x1b[?25l");
    multi.finish();
    expect(stream.getOutput()).toContain("\x1b[?25h");
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

  it("finishes every bar and ignores late updates", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const first = multi.add({ total: 10, label: "first", stream });
    const second = multi.add({ total: 20, label: "second", stream });
    first.update(2);
    second.update(3);
    multi.finish();
    const before = stream.getOutput();
    first.update(1);
    second.tick();
    expect(stream.getOutput()).toBe(before);
    expect(before).toContain("10/10");
    expect(before).toContain("20/20");
  });

  it("keeps a stopped multi bar at its current value", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, stream });
    bar.update(4);
    bar.stop();
    const before = stream.getOutput();
    bar.update(9);
    expect(stream.getOutput()).toBe(before);
    expect(before).toContain("4/10");
    multi.stop();
  });

  it("honors custom format in multi bars", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const format = vi.fn((state) => `custom:${state.current}/${state.total}`);
    const bar = multi.add({ total: 10, stream, format });

    bar.update(4);

    expect(format).toHaveBeenCalled();
    expect(stream.getOutput()).toContain("custom:4/10");
    multi.stop();
  });

  it("applies color in multi bars", () => {
    setColorEnabled(true);
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: 10, stream, color: "green" });

    bar.update(4);

    expect(stream.getOutput()).toContain("\x1b[32m");
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

  it("moves the cursor up by physical rows for wrapped lines", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 10;
    const multi = progress.multi();
    // A label long enough to wrap several times at 10 columns, plus the bar.
    const bar = multi.add({ total: 10, label: "A".repeat(40), width: 30, stream });

    bar.update(1);
    // Reset the captured output buffer is not possible, so capture the second
    // render's cursor-up directly from the full output.
    const before = stream.getOutput().length;
    bar.update(2);
    const second = stream.getOutput().slice(before);

    const match = second.match(new RegExp(`${String.fromCharCode(27)}\\[(\\d+)A`));
    expect(match).not.toBeNull();
    const rows = Number((match as RegExpMatchArray)[1]);
    expect(rows).toBeGreaterThan(1);
    multi.stop();
  });

  it("captures the stream from a later add when the first omits it", () => {
    const ttyStream = createMockTTY();
    const multi = progress.multi();
    const bar1 = multi.add({ total: 10 });
    const bar2 = multi.add({ total: 10, stream: ttyStream });

    bar1.update(5);
    bar2.update(5);
    expect(ttyStream.getOutput()).not.toBe("");
  });
});

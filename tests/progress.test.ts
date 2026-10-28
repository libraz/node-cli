import { execFileSync } from "node:child_process";
import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetColorEnabled, setColorEnabled, stripAnsi } from "../src/output/color.js";
import { logger } from "../src/output/logger.js";
import { progress, restoreCursor } from "../src/output/progress.js";
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

  it("keeps progress state finite and reports zero-total work as complete", () => {
    const stream = createMockTTY();
    const states: { current: number; total: number; percent: number; eta: number }[] = [];
    const bar = progress.bar({
      total: 10,
      stream,
      format(state) {
        states.push(state);
        return "progress";
      },
    });
    bar.update(Number.NaN);
    expect(states.at(-1)).toMatchObject({ current: 0, total: 10, percent: 0, eta: Infinity });
    bar.stop();

    const empty = progress.bar({
      total: 0,
      stream,
      format(state) {
        states.push(state);
        return "empty";
      },
    });
    empty.update(Number.NaN);
    expect(states.at(-1)).toMatchObject({ current: 0, total: 0, percent: 100, eta: 0 });
    empty.finish();
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

  it("redraws a one-row bar without moving into the preceding terminal row", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 200;
    const bar = progress.bar({ total: 10, stream });
    bar.update(1);
    const before = stream.getOutput().length;
    bar.update(2);
    expect(stream.getOutput().slice(before)).not.toContain("\x1b[1A");
    bar.stop();
  });

  it("releases cursor and visual ownership when the final formatter throws", () => {
    const stream = createMockTTY();
    const bar = progress.bar({
      total: 10,
      stream,
      format(state) {
        if (state.current === state.total) throw new Error("format failed");
        return `${state.current}/${state.total}`;
      },
    });
    bar.update(5);

    expect(() => bar.finish()).toThrow("format failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");
    expect(() => bar.stop()).not.toThrow();

    const replacement = progress.bar({ total: 1, stream });
    expect(() => replacement.update(1)).not.toThrow();
    replacement.stop();
  });

  it("normalizes labels and custom formats to one terminal line", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, label: "line1\nline2\t", stream });
    bar.update(1);
    expect(stripAnsi(stream.getOutput())).toContain("line1 line2 ");
    expect(stripAnsi(stream.getOutput()).split("\n")).toHaveLength(1);
    bar.stop();
  });

  it("removes terminal controls from labels while preserving SGR styling", () => {
    const stream = createMockTTY();
    const bar = progress.bar({
      total: 10,
      label: "\x1b[2J\x1b]2;spoofed\x07bad\r\nok\x07\x1b[31mred\x1b[0m",
      stream,
    });
    bar.update(1);
    const output = stream.getOutput();
    expect(output).not.toContain("\x1b[2J");
    expect(output).not.toContain("\x1b]2;");
    expect(output).not.toContain("\x07");
    expect(output).toMatch(/bad +ok/);
    expect(output).toContain("\x1b[31mred\x1b[0m");
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

  it("rejects empty frames and non-positive animation intervals", () => {
    expect(() => progress.spinner({ frames: [] })).toThrow(/non-empty/);
    expect(() => progress.spinner({ interval: 0 })).toThrow(/positive finite/);
    expect(() => progress.spinner({ interval: Number.NaN })).toThrow(/positive finite/);
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
    const outputAfterFirstStart = stream.getOutput();
    spinner.start();
    expect(stream.getOutput()).toBe(outputAfterFirstStart);
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

  it("installs a temporary SIGINT cursor-restoration handler", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stream });
    spinner.start();
    expect(process.listenerCount("SIGINT")).toBe(baseline + 1);
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

  it("rejects concurrent standalone indicators on the same stream", () => {
    const stream = createMockTTY();
    const first = progress.spinner({ stream });
    const second = progress.spinner({ stream });
    const bar = progress.bar({ total: 2, stream });
    first.start();
    expect(() => second.start()).toThrow(/already rendering/);
    expect(() => bar.tick()).toThrow(/already rendering/);
    first.stop();
    expect(() => second.start()).not.toThrow();
    second.stop();
  });
});

describe("progress process cleanup", () => {
  it("restores hidden cursors through the process exit handler", () => {
    const program = String.raw`
      import { progress } from "./dist/output/progress.js";
      let output = "";
      const stream = {
        isTTY: true,
        columns: 80,
        write(chunk) { output += chunk; return true; },
        once() { return this; },
      };
      progress.bar({ total: 1, stream }).update(0);
      process.emit("exit", 0);
      if (!output.includes("\x1b[?25l") || !output.includes("\x1b[?25h")) process.exitCode = 1;
    `;

    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
        cwd: process.cwd(),
      }),
    ).not.toThrow();
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

  it("keeps the first configured stream for every bar in the group", () => {
    const firstStream = createMockTTY();
    const ignoredStream = createMockTTY();
    const multi = progress.multi();
    multi.add({ total: 10, label: "first", stream: firstStream }).update(1);
    multi.add({ total: 10, label: "second", stream: ignoredStream }).update(2);

    expect(firstStream.getOutput()).toContain("second");
    expect(ignoredStream.getOutput()).toBe("");
    multi.stop();
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

describe("bar option normalization", () => {
  it("rejects an unusable width at creation on both bar paths", () => {
    expect(() => progress.bar({ total: 10, width: -1 })).toThrow(RangeError);
    expect(() => progress.bar({ total: 10, width: Number.NaN })).toThrow(RangeError);
    const multi = progress.multi();
    expect(() => multi.add({ total: 10, width: -1 })).toThrow(RangeError);
    multi.stop();
  });

  it("clamps a multi bar against its normalized total", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({ total: Number.NaN, label: "x", stream });
    bar.update(5);
    multi.stop();
    // A raw NaN total used to reach the renderer and print "NaN/0".
    expect(stream.getOutput()).not.toContain("NaN");
    expect(stripAnsi(stream.getOutput())).toContain("0/0");
  });
});

describe("untrusted text in rendered frames", () => {
  it("closes styling a caller left open in a spinner label", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "\x1b[31mred", stream });
    spinner.start();
    spinner.stop();
    // Without closing at the frame boundary the red would apply to whatever the
    // application writes next.
    expect(stream.getOutput()).toContain("\x1b[31mred\x1b[39m");
  });

  it("strips control sequences from caller-supplied frames and bar glyphs", () => {
    const spinnerStream = createMockTTY();
    const spinner = progress.spinner({ frames: ["\x1b[2Jx"], label: "l", stream: spinnerStream });
    spinner.start();
    spinner.stop();
    expect(spinnerStream.getOutput()).not.toContain("\x1b[2J");

    const barStream = createMockTTY();
    const bar = progress.bar({ total: 2, filled: "\x1b[2J#", stream: barStream });
    bar.update(1);
    bar.stop();
    expect(barStream.getOutput()).not.toContain("\x1b[2J");
  });
});

describe("terminal state ownership", () => {
  it("writes nothing when an indicator is released before it ever renders", () => {
    const barStream = createMockTTY();
    progress.bar({ total: 10, stream: barStream }).stop();
    expect(barStream.getOutput()).toBe("");

    const spinnerStream = createMockTTY();
    progress.spinner({ label: "x", stream: spinnerStream }).stop();
    expect(spinnerStream.getOutput()).toBe("");

    const multiStream = createMockTTY();
    const multi = progress.multi();
    multi.add({ total: 5, stream: multiStream });
    multi.stop();
    expect(multiStream.getOutput()).toBe("");
  });

  it("decides cursor restoration per signal rather than for all of them at once", () => {
    const counts = () => ({
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
      SIGHUP: process.listenerCount("SIGHUP"),
    });
    // Earlier cases in this file may leave an indicator active; start from a
    // known terminal state so the counts below measure only this case.
    restoreCursor();
    const occupy = () => undefined;
    // Stand in for an embedding application (or the interactive shell) that owns
    // SIGINT for the whole session.
    process.on("SIGINT", occupy);
    const before = counts();
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "x", stream });
    try {
      spinner.start();
      const during = counts();
      // The owned signal is left alone, but the other two are still guarded.
      expect(during.SIGINT).toBe(before.SIGINT);
      expect(during.SIGTERM).toBe(before.SIGTERM + 1);
      expect(during.SIGHUP).toBe(before.SIGHUP + 1);
    } finally {
      spinner.stop();
      process.removeListener("SIGINT", occupy);
    }

    const after = counts();
    expect(after.SIGTERM).toBe(before.SIGTERM);
    expect(after.SIGHUP).toBe(before.SIGHUP);
  });
});

describe("multi bar after close", () => {
  it("returns an inert handle instead of throwing", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    multi.add({ total: 10, stream });
    multi.finish();

    const before = stream.getOutput().length;
    const late = multi.add({ total: 5, stream });
    expect(() => {
      late.update(3);
      late.tick();
      late.finish();
      late.stop();
    }).not.toThrow();
    expect(stream.getOutput().length).toBe(before);
  });
});

describe("using declarations release every indicator", () => {
  beforeEach(() => {
    restoreCursor();
  });

  it("restores the cursor when a bar, spinner or multi-bar goes out of scope", () => {
    // A never-drawn indicator releases without touching the terminal, so each
    // one has to render before the scope ends for the restore to be observable.
    const draw: ((stream: Writable) => Disposable)[] = [
      (stream) => {
        const bar = progress.bar({ total: 10, stream });
        bar.update(1);
        return bar;
      },
      (stream) => {
        const spinner = progress.spinner({ label: "work", stream });
        spinner.start();
        return spinner;
      },
      (stream) => {
        const multi = progress.multi();
        multi.add({ total: 10, stream }).update(1);
        return multi;
      },
    ];
    for (const create of draw) {
      const stream = createMockTTY();
      {
        using indicator = create(stream);
        expect(indicator).toBeDefined();
      }
      expect(stream.getOutput()).toContain("\x1b[?25h");
    }
  });
});

describe("documented cursor helpers", () => {
  it("restoreCursor and releaseAll bring the cursor back", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "work", stream });
    spinner.start();
    expect(stream.getOutput()).toContain("\x1b[?25l");

    progress.releaseAll();
    expect(stream.getOutput()).toContain("\x1b[?25h");

    // restoreCursor is the process-wide fallback the exit handlers use.
    const bare = createMockTTY();
    const bar = progress.bar({ total: 1, stream: bare });
    bar.update(0);
    restoreCursor();
    expect(bare.getOutput()).toContain("\x1b[?25h");
  });
});

const ESC = String.fromCharCode(27);

/**
 * Replays cursor movement, line erases and wrapping at `columns` and returns the
 * rows that finally hold visible text.
 */
function screenRows(output: string, columns: number): string[] {
  const rows: string[][] = [[]];
  let row = 0;
  let col = 0;
  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    if (ch === "\x1b") {
      const csi = new RegExp(`^${ESC}\\[([?0-9;]*)([A-Za-z])`).exec(output.slice(i));
      if (csi) {
        const n = Number(csi[1]) || 1;
        if (csi[2] === "K") rows[row].length = Math.min(rows[row].length, col);
        else if (csi[2] === "A") row = Math.max(0, row - n);
        else if (csi[2] === "B") {
          row += n;
          while (rows.length <= row) rows.push([]);
        }
        i += csi[0].length - 1;
      }
      continue;
    }
    if (ch === "\r") col = 0;
    else if (ch === "\n") {
      row++;
      col = 0;
      while (rows.length <= row) rows.push([]);
    } else {
      if (col >= columns) {
        row++;
        col = 0;
        while (rows.length <= row) rows.push([]);
      }
      while (rows[row].length < col) rows[row].push(" ");
      rows[row][col++] = ch;
    }
  }
  return rows.map((r) => r.join("").trimEnd()).filter((r) => r !== "");
}

describe("spinner line wrapping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setColorEnabled(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    resetColorEnabled();
  });

  it("keeps one copy of a label wider than the terminal across frames, logs and stop", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 20;
    const spinner = progress.spinner({ label: "L".repeat(50), stream });
    spinner.start();
    vi.advanceTimersByTime(160);
    expect(screenRows(stream.getOutput(), 20)).toHaveLength(3);

    logger({ stream }).info("hello");
    const rows = screenRows(stream.getOutput(), 20);
    expect(rows.filter((r) => r.includes("hello"))).toHaveLength(1);
    expect(rows.filter((r) => r.includes("L"))).toHaveLength(3);

    spinner.stop();
    expect(screenRows(stream.getOutput(), 20)).toEqual(["[INFO] hello"]);
  });
});

describe("throwing multi-bar formatter", () => {
  beforeEach(() => {
    restoreCursor();
    setColorEnabled(false);
  });
  afterEach(() => resetColorEnabled());

  it("releases the terminal so later log lines and spinners work", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    const bar = multi.add({
      total: 10,
      stream,
      format(state) {
        if (state.current > 1) throw new Error("format failed");
        return "ok";
      },
    });
    bar.update(1);
    expect(() => bar.update(2)).toThrow("format failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");

    expect(() => logger({ stream }).info("after")).not.toThrow();
    expect(stream.getOutput()).toContain("after");
    const spinner = progress.spinner({ label: "next", stream });
    expect(() => spinner.start()).not.toThrow();
    spinner.stop();
    multi.stop();
  });

  it("closes the group and shows the cursor when the final frame throws", () => {
    const stream = createMockTTY();
    const multi = progress.multi();
    multi.add({
      total: 2,
      stream,
      format(state) {
        if (state.current === state.total) throw new Error("final failed");
        return "ok";
      },
    });
    multi.add({ total: 2, stream }).update(1);
    expect(() => multi.finish()).toThrow("final failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");

    const before = stream.getOutput().length;
    const late = multi.add({ total: 1, stream });
    late.update(1);
    expect(stream.getOutput().length).toBe(before);
    const replacement = progress.bar({ total: 1, stream });
    expect(() => replacement.update(1)).not.toThrow();
    replacement.stop();
  });
});

describe("color option names", () => {
  beforeEach(() => setColorEnabled(true));
  afterEach(() => resetColorEnabled());

  it.each(["toString", "valueOf", "constructor", "then", "nonsense"])(
    "renders the plain glyphs for the non-style name %s",
    (name) => {
      const plain = createMockTTY();
      const plainBar = progress.bar({ total: 4, stream: plain, width: 4 });
      plainBar.update(2);
      plainBar.stop();
      const named = createMockTTY();
      const namedBar = progress.bar({ total: 4, stream: named, width: 4, color: name });
      namedBar.update(2);
      namedBar.stop();
      expect(named.getOutput()).toBe(plain.getOutput());

      const multiStream = createMockTTY();
      const multi = progress.multi();
      multi.add({ total: 4, stream: multiStream, width: 4, color: name }).update(2);
      multi.stop();
      expect(multiStream.getOutput()).not.toContain("[object");

      const frames = ["a"];
      const plainSpin = createMockTTY();
      const first = progress.spinner({ frames, stream: plainSpin });
      first.start();
      first.stop();
      const namedSpin = createMockTTY();
      const second = progress.spinner({ frames, stream: namedSpin, color: name });
      second.start();
      second.stop();
      expect(namedSpin.getOutput()).toBe(plainSpin.getOutput());
    },
  );
});

describe("bar width", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => resetColorEnabled());

  const cells = (output: string) => /\[([^\]]*)\]/.exec(stripAnsi(output))?.[1].length;

  it.each([
    [0.4, 1],
    [2.5, 2],
    [7, 7],
  ])("draws exactly max(1, floor(%s)) cells at full progress", (width, expected) => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 2, stream, width });
    bar.update(2);
    bar.stop();
    expect(cells(stream.getOutput())).toBe(expected);

    const multiStream = createMockTTY();
    const multi = progress.multi();
    multi.add({ total: 2, stream: multiStream, width }).update(2);
    multi.stop();
    expect(cells(multiStream.getOutput())).toBe(expected);
  });

  it("rejects a width too large to render at construction", () => {
    expect(() => progress.bar({ total: 2, width: 1e10 })).toThrow(RangeError);
    const multi = progress.multi();
    expect(() => multi.add({ total: 2, width: 1e10 })).toThrow(RangeError);
    multi.stop();
  });
});

describe("default output stream", () => {
  let stderrWrites: string[];
  let stdoutWrites: string[];
  let restore: (() => void)[];

  beforeEach(() => {
    restoreCursor();
    setColorEnabled(false);
    stderrWrites = [];
    stdoutWrites = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string) => {
      stderrWrites.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const hadTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    (process.stderr as unknown as { isTTY: boolean }).isTTY = true;
    restore = [
      () => stderrSpy.mockRestore(),
      () => stdoutSpy.mockRestore(),
      () => {
        if (hadTTY) Object.defineProperty(process.stderr, "isTTY", hadTTY);
        else delete (process.stderr as unknown as { isTTY?: boolean }).isTTY;
      },
    ];
  });
  afterEach(() => {
    restoreCursor();
    for (const undo of restore) undo();
    resetColorEnabled();
  });

  it("draws bars, spinners and multi bars on stderr only", () => {
    const bar = progress.bar({ total: 2 });
    bar.update(1);
    bar.finish();
    const spinner = progress.spinner({ label: "work" });
    spinner.start();
    spinner.succeed("done");
    const multi = progress.multi();
    multi.add({ total: 2, label: "m" }).update(1);
    multi.finish();

    const text = stderrWrites.join("");
    expect(text).toContain("1/2");
    expect(text).toContain("work");
    expect(text).toContain("m");
    expect(stdoutWrites).toEqual([]);
  });

  it("does not move a multi-bar group to another stream once it has drawn", () => {
    const later = createMockTTY();
    const multi = progress.multi();
    multi.add({ total: 2, label: "first" }).update(1);
    multi.add({ total: 2, label: "second", stream: later }).update(1);
    multi.stop();
    expect(later.getOutput()).toBe("");
    expect(stderrWrites.join("")).toContain("second");
  });
});

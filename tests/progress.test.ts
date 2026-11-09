import { execFileSync } from "node:child_process";
import type { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, progress } from "../src/index.js";
import { setColorEnabled, stripAnsi } from "../src/output/color.js";
import { restoreCursor } from "../src/output/progress.js";
import { createMockStdout, createMockTTY } from "./helpers.js";

/** Asserts a usage error by class and `code`, never by message text. */
function expectUsageError(fn: () => unknown, ctor: ErrorConstructor, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ctor);
  expect((caught as { code?: string }).code).toBe(code);
}

const busy = (fn: () => unknown) => expectUsageError(fn, Error, "ERR_OUTPUT_BUSY");

describe("progress.bar", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("draws 0% as soon as it is created on a TTY", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream });
    const output = stripAnsi(stream.getOutput());
    expect(output).toContain("0%");
    expect(output).toContain("0/100");
    expect(stream.getOutput()).toContain("\x1b[?25l");
    bar.stop();
  });

  it("renders updates on TTY stream", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream });
    bar.update(50);
    const output = stripAnsi(stream.getOutput());
    expect(output).toContain("50%");
    expect(output).toContain("50/100");
    bar.stop();
  });

  it("shows label", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, label: "Downloading", stderr: stream });
    bar.update(30);
    expect(stream.getOutput()).toContain("Downloading");
    bar.stop();
  });

  it("ticks by delta", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stderr: stream });
    bar.tick();
    bar.tick(4);
    expect(stripAnsi(stream.getOutput())).toContain("5/10");
    bar.stop();
  });

  it("clamps to total", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, stderr: stream });
    bar.update(999);
    expect(stripAnsi(stream.getOutput())).toContain("100%");
    bar.stop();
  });

  it("keeps progress state finite and reports zero-total work as complete", () => {
    const stream = createMockTTY();
    const states: { current: number; total: number; percent: number; etaMs: number }[] = [];
    const bar = progress.bar({
      total: 10,
      stderr: stream,
      format(state) {
        states.push(state);
        return "progress";
      },
    });
    bar.update(Number.NaN);
    expect(states.at(-1)).toMatchObject({ current: 0, total: 10, percent: 0, etaMs: Infinity });
    bar.stop();

    const empty = progress.bar({
      total: 0,
      stderr: stream,
      format(state) {
        states.push(state);
        return "empty";
      },
    });
    empty.update(Number.NaN);
    expect(states.at(-1)).toMatchObject({ current: 0, total: 0, percent: 100, etaMs: 0 });
    empty.stop();
  });

  it("passes BarState with unit-suffixed field names to the formatter", () => {
    const stream = createMockTTY();
    let seen: Record<string, unknown> = {};
    const bar = progress.bar({
      total: 10,
      stderr: stream,
      format(state) {
        seen = { ...state };
        return "x";
      },
    });
    bar.stop();
    expect(Object.keys(seen).sort()).toEqual(
      ["current", "elapsedMs", "etaMs", "percent", "ratePerSecond", "total"].sort(),
    );
  });

  it("uses custom format", () => {
    const stream = createMockTTY();
    const format = vi.fn((state) => `${state.current}/${state.total}`);
    const bar = progress.bar({ total: 100, stderr: stream, format });
    bar.update(50);
    expect(format).toHaveBeenCalled();
    expect(stream.getOutput()).toContain("50/100");
    bar.stop();
  });

  it("uses custom fill/empty characters", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream, filled: "#", empty: ".", width: 10 });
    bar.update(50);
    expect(stream.getOutput()).toContain("#");
    expect(stream.getOutput()).toContain(".");
    bar.stop();
  });

  it("applies color to bar, including a chained style", () => {
    setColorEnabled(true);
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream, style: "green" });
    bar.update(50);
    expect(stream.getOutput()).toContain("\x1b[32m");
    bar.stop();

    const chained = createMockTTY();
    const second = progress.bar({ total: 100, stderr: chained, style: "bold.cyan" });
    expect(chained.getOutput()).toContain("\x1b[36m");
    second.stop();
  });

  it("does not render on non-TTY", () => {
    const stream = createMockStdout();
    const bar = progress.bar({ total: 100, stderr: stream });
    bar.update(50);
    expect(stream.getOutput()).toBe("");
    bar.stop();
    expect(stream.getOutput()).toBe("");
  });

  it("stop leaves the last frame and ends the line on TTY", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream });
    bar.update(50);
    const before = stream.getOutput();
    bar.stop();
    expect(stream.getOutput().startsWith(before)).toBe(true);
    expect(stream.getOutput().slice(before.length)).not.toContain("\x1b[K");
    expect(stream.getOutput()).toContain("\n");
  });

  it("hides the cursor on creation and restores it when it ends", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 100, stderr: stream });
    expect(stream.getOutput()).toContain("\x1b[?25l");
    bar.succeed();
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
    const bar = progress.bar({ total: 10, stderr: stream });
    bar.update(1);
    bar.update(2);
    bar.update(3);
    expect(output).toContain("0/10");
    expect(output).not.toContain("2/10");
    onDrain?.();
    expect(output).toContain("3/10");
    bar.stop();
  });

  it("redraws a one-row bar without moving into the preceding terminal row", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 200;
    const bar = progress.bar({ total: 10, stderr: stream });
    bar.update(1);
    const before = stream.getOutput().length;
    bar.update(2);
    expect(stream.getOutput().slice(before)).not.toContain("\x1b[1A");
    bar.stop();
  });

  it("releases cursor and visual ownership when the formatter throws", () => {
    const stream = createMockTTY();
    const bar = progress.bar({
      total: 10,
      stderr: stream,
      format(state) {
        if (state.current === 5) throw new Error("format failed");
        return `${state.current}/${state.total}`;
      },
    });

    expect(() => bar.update(5)).toThrow("format failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");
    expect(() => bar.stop()).not.toThrow();

    const replacement = progress.bar({ total: 1, stderr: stream });
    expect(() => replacement.update(1)).not.toThrow();
    replacement.stop();
  });

  it("normalizes labels and custom formats to one terminal line", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, label: "line1\nline2\t", stderr: stream });
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
      stderr: stream,
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

  it("succeed completes the bar and ignores later calls", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 10, label: "Sync", stderr: stream });
    bar.update(3);
    bar.succeed();
    const after = stream.getOutput();
    expect(stripAnsi(after)).toContain("✔ Sync");
    bar.update(5);
    bar.fail();
    bar.stop();
    expect(stream.getOutput()).toBe(after);
  });

  it("fail stops at the current position", () => {
    const states: number[] = [];
    const stream = createMockTTY();
    const bar = progress.bar({
      total: 10,
      stderr: stream,
      format(state) {
        states.push(state.current);
        return `at ${state.current}`;
      },
    });
    bar.update(4);
    bar.fail("broke");
    expect(stripAnsi(stream.getOutput())).toContain("✖ broke");
    expect(states.at(-1)).toBe(4);
  });

  it("has no finish method", () => {
    const stream = createMockStdout();
    const bar = progress.bar({ total: 1, stderr: stream });
    expect("finish" in bar).toBe(false);
  });
});

// Terminal verbs share one rule across every handle. Model (pairwise, seed 1):
//   handle {bar, spinner, multiBar, group} x verb {succeed, fail, warn, stop}
//   x tty {true, false} x message {given, omitted}
// multiBar is one Bar inside a group; group is the MultiBar's own verb.
describe("terminal verbs across handles", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  type Handle = "bar" | "spinner" | "multiBar" | "group";
  type Verb = "succeed" | "fail" | "warn" | "stop";
  const marks = { succeed: "✔", fail: "✖", warn: "⚠" } as const;
  const asciiMarks = { succeed: "[OK]", fail: "[ERROR]", warn: "[WARN]" } as const;

  const cases: [Handle, Verb, boolean, "given" | "omitted"][] = [
    ["spinner", "warn", true, "given"],
    ["bar", "fail", true, "omitted"],
    ["group", "stop", false, "omitted"],
    ["spinner", "stop", false, "given"],
    ["group", "succeed", true, "given"],
    ["multiBar", "succeed", false, "omitted"],
    ["multiBar", "fail", true, "given"],
    ["bar", "warn", false, "given"],
    ["spinner", "fail", false, "given"],
    ["spinner", "warn", false, "omitted"],
    ["multiBar", "stop", true, "omitted"],
    ["group", "warn", true, "given"],
    ["bar", "stop", true, "omitted"],
    ["multiBar", "warn", true, "omitted"],
    ["group", "fail", false, "given"],
    ["bar", "succeed", false, "omitted"],
    ["spinner", "succeed", false, "omitted"],
  ];

  it.each(cases)("%s.%s tty=%s message=%s", (handle, verb, tty, message) => {
    vi.useFakeTimers();
    try {
      const stream = tty ? createMockTTY() : createMockStdout();
      const msg = message === "given" ? "custom note" : undefined;
      let call: (m?: string) => void;
      if (handle === "bar") {
        const bar = progress.bar({ total: 4, label: "L", stderr: stream });
        call = (m) => bar[verb](m);
      } else if (handle === "spinner") {
        const spinner = progress.spinner({ label: "L", stderr: stream });
        call = (m) => spinner[verb](m);
      } else {
        const multi = progress.multi({ stderr: stream });
        const bar = multi.add({ total: 4, label: "L" });
        if (handle === "multiBar") {
          call = (m) => {
            bar[verb](m);
            multi.stop();
          };
        } else {
          call = (m) => multi[verb](m);
        }
      }
      const start = stream.getOutput().length;
      call(msg);
      const written = stripAnsi(stream.getOutput().slice(start));

      if (verb === "stop") {
        // stop() never writes a result row; it only ends the line on a TTY.
        for (const mark of Object.values(marks)) expect(written).not.toContain(mark);
        if (tty) expect(stream.getOutput()).toContain("\n");
        else expect(stream.getOutput()).toBe("");
        return;
      }

      const mark = (tty ? marks : asciiMarks)[verb];
      if (handle === "bar" || handle === "spinner") {
        expect(written).toContain(`${mark} ${msg ?? "L"}\n`);
      } else {
        // A bar inside a group keeps its own label; the group's note is an unmarked line.
        const own = handle === "multiBar" ? (msg ?? "L") : "L";
        expect(written).toContain(`${mark} ${own}`);
        if (handle === "group" && msg) {
          expect(written).toContain(`${msg}\n`);
          expect(written).not.toContain(`${mark} ${msg}`);
        }
      }
      if (!tty) {
        const expectedLines = handle === "group" && msg ? 2 : 1;
        expect(written.split("\n").filter((line) => line !== "")).toHaveLength(expectedLines);
      } else {
        expect(stream.getOutput()).toContain("\x1b[?25h");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("group verbs apply to bars that have not ended and keep earlier results", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const first = multi.add({ total: 4, label: "first" });
    multi.add({ total: 4, label: "second" });
    first.fail("first broke");
    multi.succeed();
    const text = stripAnsi(stream.getOutput());
    expect(text).toContain("✖ first broke");
    expect(text).toContain("✔ second");
    expect(text).not.toContain("✔ first");
  });
});

describe("progress.spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setColorEnabled(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    setColorEnabled("auto");
  });

  it("starts drawing as soon as it is created and keeps animating", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Loading...", stderr: stream });
    expect(stream.getOutput()).toContain("Loading...");
    const first = stream.getOutput().length;
    vi.advanceTimersByTime(80);
    expect(stream.getOutput().length).toBeGreaterThan(first);
    spinner.stop();
  });

  it("has no start or update method", () => {
    const spinner = progress.spinner({ stderr: createMockStdout() });
    expect("start" in spinner).toBe(false);
    expect("update" in spinner).toBe(false);
  });

  it("setLabel changes the next frame", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Step 1", stderr: stream });
    spinner.setLabel("Step 2");
    vi.advanceTimersByTime(80);
    expect(stream.getOutput()).toContain("Step 2");
    spinner.stop();
  });

  it("uses custom frames, including a readonly tuple", () => {
    const stream = createMockTTY();
    const frames = ["-", "|"] as const;
    const spinner = progress.spinner({ frames, stderr: stream });
    expect(stream.getOutput()).toContain("-");
    vi.advanceTimersByTime(80);
    expect(stream.getOutput()).toContain("|");
    spinner.stop();
  });

  it("honors intervalMs, including fractional values", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ frames: ["a", "b"], intervalMs: 10.5, stderr: stream });
    const first = stream.getOutput().length;
    vi.advanceTimersByTime(11);
    expect(stream.getOutput().length).toBeGreaterThan(first);
    spinner.stop();
  });

  it("rejects bad frames and intervals with coded errors", () => {
    const stream = createMockStdout();
    expectUsageError(
      () => progress.spinner({ stderr: stream, frames: [] }),
      RangeError,
      "ERR_INVALID_ARG_VALUE",
    );
    expectUsageError(
      () => progress.spinner({ stderr: stream, frames: [1] as unknown as string[] }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
    expectUsageError(
      () => progress.spinner({ stderr: stream, frames: "ab" as unknown as string[] }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
    for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectUsageError(
        () => progress.spinner({ stderr: stream, intervalMs }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
    }
    expectUsageError(
      () => progress.spinner({ stderr: stream, intervalMs: "80" as unknown as number }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
  });

  it("applies color to frames", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stderr: stream, style: "cyan" });
    expect(stream.getOutput()).toContain("\x1b[36m");
    spinner.stop();
  });

  it("hides the cursor on creation and shows it again on stop", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Loading...", stderr: stream });
    expect(stream.getOutput()).toContain("\x1b[?25l");
    spinner.stop();
    expect(stream.getOutput()).toContain("\x1b[?25h");
  });

  it("stop keeps the last frame and ends the line", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Keep me", stderr: stream });
    const before = stream.getOutput();
    spinner.stop();
    const tail = stream.getOutput().slice(before.length);
    expect(tail).not.toContain("\x1b[K");
    expect(tail).toContain("\n");
  });

  it("writes a result row on a non-TTY stream and nothing else", () => {
    const stream = createMockStdout();
    const spinner = progress.spinner({ label: "Loading...", stderr: stream });
    expect(stream.getOutput()).toBe("");
    spinner.succeed("Done");
    expect(stripAnsi(stream.getOutput())).toBe("[OK] Done\n");
  });

  it("succeed on a TTY replaces the frame row with the result", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "Working", stderr: stream });
    const before = stream.getOutput().length;
    spinner.succeed();
    const tail = stream.getOutput().slice(before);
    expect(tail.startsWith("\r\x1b[K")).toBe(true);
    expect(stripAnsi(tail)).toContain("✔ Working\n");
  });

  it("keeps final status messages on a single line", () => {
    const stream = createMockStdout();
    const spinner = progress.spinner({ stderr: stream, label: "unsafe\tlabel" });
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
    setColorEnabled("auto");
  });

  it("installs a temporary SIGINT cursor-restoration handler", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stderr: stream });
    expect(process.listenerCount("SIGINT")).toBe(baseline + 1);
    spinner.stop();
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it.each(["succeed", "fail", "warn"] as const)("removes the SIGINT handler on %s", (verb) => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stderr: stream });
    spinner[verb]("x");
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("cleanup is idempotent across stop then succeed", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stderr: stream });
    spinner.stop();
    expect(() => spinner.succeed("Done")).not.toThrow();
    expect(process.listenerCount("SIGINT")).toBe(baseline);
  });

  it("rejects a second indicator on the same stream at creation", () => {
    const stream = createMockTTY();
    const first = progress.spinner({ stderr: stream });
    busy(() => progress.spinner({ stderr: stream }));
    busy(() => progress.bar({ total: 2, stderr: stream }));
    busy(() => progress.multi({ stderr: stream }));
    first.stop();
    const second = progress.spinner({ stderr: stream });
    second.stop();
  });

  it("does not claim a non-TTY stream", () => {
    const stream = createMockStdout();
    const first = progress.spinner({ stderr: stream });
    expect(() => progress.spinner({ stderr: stream })).not.toThrow();
    first.stop();
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
      progress.bar({ total: 1, stderr: stream }).update(0);
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
  afterEach(() => setColorEnabled("auto"));

  it("creates and updates multiple bars on TTY", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar1 = multi.add({ total: 100, label: "File 1" });
    const bar2 = multi.add({ total: 200, label: "File 2" });

    bar1.update(50);
    bar2.update(100);
    const output = stream.getOutput();
    expect(output).toContain("File 1");
    expect(output).toContain("File 2");
    multi.stop();
  });

  it("claims its stream at creation and hides the cursor", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    expect(stream.getOutput()).toContain("\x1b[?25l");
    busy(() => progress.bar({ total: 1, stderr: stream }));
    multi.stop();
    expect(stream.getOutput()).toContain("\x1b[?25h");
  });

  it("draws a new bar at 0% when it is added", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    multi.add({ total: 10, label: "fresh" });
    expect(stripAnsi(stream.getOutput())).toContain("0/10");
    multi.stop();
  });

  it("draws every bar on the group stream", () => {
    const groupStream = createMockTTY();
    const multi = progress.multi({ stderr: groupStream });
    multi.add({ total: 10, label: "first" }).update(1);
    multi.add({ total: 10, label: "second" }).update(2);
    expect(groupStream.getOutput()).toContain("second");
    multi.stop();
  });

  it("ticks bars in multi", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 10, label: "Task" });
    bar.tick(5);
    expect(stripAnsi(stream.getOutput())).toContain("5/10");
    multi.stop();
  });

  it("an individual bar's succeed replaces only its own row and the group continues", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const done = multi.add({ total: 10, label: "Task" });
    const other = multi.add({ total: 10, label: "Other" });
    done.succeed();
    other.update(3);
    const text = stripAnsi(stream.getOutput());
    expect(text).toContain("✔ Task");
    expect(text).toContain("3/10");
    multi.stop();
  });

  it("group succeed ends every bar and ignores late updates", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const first = multi.add({ total: 10, label: "first" });
    const second = multi.add({ total: 20, label: "second" });
    first.update(2);
    second.update(3);
    multi.succeed();
    const before = stream.getOutput();
    first.update(1);
    second.tick();
    expect(stream.getOutput()).toBe(before);
    expect(stripAnsi(before)).toContain("✔ first");
    expect(stripAnsi(before)).toContain("✔ second");
  });

  it("keeps a stopped multi bar at its current value", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 10 });
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
    const multi = progress.multi({ stderr: stream });
    const format = vi.fn((state) => `custom:${state.current}/${state.total}`);
    const bar = multi.add({ total: 10, format });

    bar.update(4);

    expect(format).toHaveBeenCalled();
    expect(stream.getOutput()).toContain("custom:4/10");
    multi.stop();
  });

  it("applies color in multi bars", () => {
    setColorEnabled(true);
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 10, style: "green" });

    bar.update(4);

    expect(stream.getOutput()).toContain("\x1b[32m");
    multi.stop();
  });

  it("non-TTY multi bars draw nothing until a verb writes result rows", () => {
    const stream = createMockStdout();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 10, label: "a" });
    bar.update(5);
    expect(stream.getOutput()).toBe("");
    multi.add({ total: 1, label: "b" });
    multi.warn("careful");
    expect(stripAnsi(stream.getOutput())).toBe("[WARN] a\n[WARN] b\ncareful\n");
  });

  it("moves the cursor up by physical rows for wrapped lines", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 10;
    const multi = progress.multi({ stderr: stream });
    // A label long enough to wrap several times at 10 columns, plus the bar.
    const bar = multi.add({ total: 10, label: "A".repeat(40), width: 30 });

    bar.update(1);
    const before = stream.getOutput().length;
    bar.update(2);
    const second = stream.getOutput().slice(before);

    const match = second.match(new RegExp(`${String.fromCharCode(27)}\\[(\\d+)A`));
    expect(match).not.toBeNull();
    expect(Number((match as RegExpMatchArray)[1])).toBeGreaterThan(1);
    multi.stop();
  });
});

describe("bar option validation", () => {
  const stream = () => createMockStdout();

  it("rejects an unusable width at creation on both bar paths", () => {
    for (const width of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, 1e10, 4097]) {
      expectUsageError(
        () => progress.bar({ total: 10, width, stderr: stream() }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
      const multi = progress.multi({ stderr: stream() });
      expectUsageError(() => multi.add({ total: 10, width }), RangeError, "ERR_INVALID_ARG_VALUE");
      multi.stop();
    }
    expectUsageError(
      () => progress.bar({ total: 10, width: "5" as unknown as number, stderr: stream() }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
  });

  it("rejects a total that is not a finite number of at least 0", () => {
    for (const total of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expectUsageError(
        () => progress.bar({ total, stderr: stream() }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
      const multi = progress.multi({ stderr: stream() });
      expectUsageError(() => multi.add({ total }), RangeError, "ERR_INVALID_ARG_VALUE");
      multi.stop();
    }
    expectUsageError(
      () => progress.bar({ total: "3" as unknown as number, stderr: stream() }),
      TypeError,
      "ERR_INVALID_ARG_TYPE",
    );
    expect(() => progress.bar({ total: 0, stderr: stream() })).not.toThrow();
  });

  it.each(["toString", "constructor", "nonsense", "red.nonsense", ""])(
    "rejects the unknown color %j at creation, before anything is drawn",
    (name) => {
      const tty = createMockTTY();
      const color = name as "red";
      expectUsageError(
        () => progress.bar({ total: 4, stderr: tty, style: color }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
      expectUsageError(
        () => progress.spinner({ stderr: tty, style: color }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
      const multi = progress.multi({ stderr: tty });
      expectUsageError(
        () => multi.add({ total: 4, style: color }),
        RangeError,
        "ERR_INVALID_ARG_VALUE",
      );
      multi.stop();
      expectUsageError(
        () => progress.bar({ total: 4, stderr: tty, style: 3 as unknown as "red" }),
        TypeError,
        "ERR_INVALID_ARG_TYPE",
      );
      // Nothing claimed the stream: a valid indicator can still be created.
      progress.bar({ total: 1, stderr: tty }).stop();
    },
  );
});

describe("untrusted text in rendered frames", () => {
  it("closes styling a caller left open in a spinner label", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "\x1b[31mred", stderr: stream });
    spinner.stop();
    expect(stream.getOutput()).toContain("\x1b[31mred\x1b[39m");
  });

  it("strips control sequences from caller-supplied frames and bar glyphs", () => {
    const spinnerStream = createMockTTY();
    const spinner = progress.spinner({ frames: ["\x1b[2Jx"], label: "l", stderr: spinnerStream });
    spinner.stop();
    expect(spinnerStream.getOutput()).not.toContain("\x1b[2J");

    const barStream = createMockTTY();
    const bar = progress.bar({ total: 2, filled: "\x1b[2J#", stderr: barStream });
    bar.update(1);
    bar.stop();
    expect(barStream.getOutput()).not.toContain("\x1b[2J");
  });
});

describe("terminal state ownership", () => {
  it("writes nothing when an indicator on a non-TTY stream is stopped", () => {
    const barStream = createMockStdout();
    progress.bar({ total: 10, stderr: barStream }).stop();
    expect(barStream.getOutput()).toBe("");

    const spinnerStream = createMockStdout();
    progress.spinner({ label: "x", stderr: spinnerStream }).stop();
    expect(spinnerStream.getOutput()).toBe("");

    const multiStream = createMockStdout();
    const multi = progress.multi({ stderr: multiStream });
    multi.add({ total: 5 });
    multi.stop();
    expect(multiStream.getOutput()).toBe("");
  });

  it("stops an empty TTY group without ending a line it never drew", () => {
    const stream = createMockTTY();
    progress.multi({ stderr: stream }).stop();
    expect(stream.getOutput()).not.toContain("\n");
    expect(stream.getOutput()).toContain("\x1b[?25h");
  });

  it("decides cursor restoration per signal rather than for all of them at once", () => {
    const counts = () => ({
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
      SIGHUP: process.listenerCount("SIGHUP"),
    });
    restoreCursor();
    const occupy = () => undefined;
    // Stand in for an embedding application (or the interactive shell) that owns
    // SIGINT for the whole session.
    process.on("SIGINT", occupy);
    const before = counts();
    const stream = createMockTTY();
    let spinner: ReturnType<typeof progress.spinner> | undefined;
    try {
      spinner = progress.spinner({ label: "x", stderr: stream });
      const during = counts();
      expect(during.SIGINT).toBe(before.SIGINT);
      expect(during.SIGTERM).toBe(before.SIGTERM + 1);
      expect(during.SIGHUP).toBe(before.SIGHUP + 1);
    } finally {
      spinner?.stop();
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
    const multi = progress.multi({ stderr: stream });
    multi.add({ total: 10 });
    multi.succeed();

    const before = stream.getOutput().length;
    const late = multi.add({ total: 5 });
    expect(() => {
      late.update(3);
      late.tick();
      late.succeed();
      late.fail();
      late.warn();
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
    const make: ((stream: Writable) => Disposable)[] = [
      (stream) => progress.bar({ total: 10, stderr: stream }),
      (stream) => progress.spinner({ label: "work", stderr: stream }),
      (stream) => {
        const multi = progress.multi({ stderr: stream });
        multi.add({ total: 10 }).update(1);
        return multi;
      },
    ];
    for (const create of make) {
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
  it("progress.releaseAll and restoreCursor bring the cursor back", () => {
    const stream = createMockTTY();
    progress.spinner({ label: "work", stderr: stream });
    expect(stream.getOutput()).toContain("\x1b[?25l");

    progress.releaseAll();
    expect(stream.getOutput()).toContain("\x1b[?25h");

    const bare = createMockTTY();
    progress.bar({ total: 1, stderr: bare });
    restoreCursor();
    expect(bare.getOutput()).toContain("\x1b[?25h");
  });

  it("keeps the low-level helpers off the public entry", async () => {
    const root = (await import("../src/index.js")) as Record<string, unknown>;
    expect(root.releaseAll).toBeUndefined();
    expect(root.restoreCursor).toBeUndefined();
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
      const csi = output.slice(i).match(new RegExp(`^${ESC}\\[([?0-9;]*)([A-Za-z])`));
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
    setColorEnabled("auto");
  });

  it("keeps one copy of a label wider than the terminal across frames and logs", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 20;
    const spinner = progress.spinner({ label: "L".repeat(50), stderr: stream });
    vi.advanceTimersByTime(160);
    expect(screenRows(stream.getOutput(), 20)).toHaveLength(3);

    createLogger({ stderr: stream, timestamp: false }).info("hello");
    const rows = screenRows(stream.getOutput(), 20);
    expect(rows.filter((r) => r.includes("hello"))).toHaveLength(1);
    expect(rows.filter((r) => r.includes("L"))).toHaveLength(3);

    // stop() leaves the last frame in place, so the label is still on screen.
    spinner.stop();
    expect(screenRows(stream.getOutput(), 20).filter((r) => r.includes("L"))).toHaveLength(3);
  });

  it("replaces a wrapped frame with one result row on succeed", () => {
    const stream = createMockTTY();
    (stream as unknown as { columns: number }).columns = 20;
    const spinner = progress.spinner({ label: "L".repeat(50), stderr: stream });
    vi.advanceTimersByTime(160);
    spinner.succeed("ok");
    expect(screenRows(stream.getOutput(), 20)).toEqual(["✔ ok"]);
  });
});

describe("throwing multi-bar formatter", () => {
  beforeEach(() => {
    restoreCursor();
    setColorEnabled(false);
  });
  afterEach(() => setColorEnabled("auto"));

  it("releases the terminal so later log lines and spinners work", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({
      total: 10,
      format(state) {
        if (state.current > 1) throw new Error("format failed");
        return "ok";
      },
    });
    bar.update(1);
    expect(() => bar.update(2)).toThrow("format failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");

    expect(() => createLogger({ stderr: stream }).info("after")).not.toThrow();
    expect(stream.getOutput()).toContain("after");
    const spinner = progress.spinner({ label: "next", stderr: stream });
    spinner.stop();
    multi.stop();
  });

  it("releases the terminal when the first frame throws on add", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    expect(() =>
      multi.add({
        total: 2,
        format() {
          throw new Error("first failed");
        },
      }),
    ).toThrow("first failed");
    expect(stream.getOutput()).toContain("\x1b[?25h");
    multi.stop();
    const replacement = progress.bar({ total: 1, stderr: stream });
    expect(() => replacement.update(1)).not.toThrow();
    replacement.stop();
  });
});

describe("bar width", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  const cells = (output: string) => stripAnsi(output).match(/\[([^\]]*)\]/)?.[1].length;

  it.each([
    [0.4, 1],
    [2.5, 2],
    [7, 7],
  ])("draws exactly max(1, floor(%s)) cells at full progress", (width, expected) => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 2, stderr: stream, width });
    bar.update(2);
    bar.stop();
    expect(cells(stream.getOutput())).toBe(expected);

    const multiStream = createMockTTY();
    const multi = progress.multi({ stderr: multiStream });
    multi.add({ total: 2, width }).update(2);
    multi.stop();
    expect(cells(multiStream.getOutput())).toBe(expected);
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
    setColorEnabled("auto");
  });

  it("draws bars, spinners and multi bars on stderr only", () => {
    const bar = progress.bar({ total: 2 });
    bar.update(1);
    bar.succeed("bar done");
    const spinner = progress.spinner({ label: "work" });
    spinner.succeed("done");
    const multi = progress.multi();
    multi.add({ total: 2, label: "m" }).update(1);
    multi.succeed();

    const text = stderrWrites.join("");
    expect(text).toContain("1/2");
    expect(text).toContain("work");
    expect(text).toContain("m");
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

describe("Bar.setLabel", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("changes the label drawn on a standalone bar and used by succeed", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 4, label: "first", stderr: stream });
    bar.setLabel("second");
    bar.update(1);
    expect(stripAnsi(stream.getOutput())).toContain("second");
    bar.succeed();
    expect(stripAnsi(stream.getOutput())).toContain("✔ second");
  });

  it("changes the row of a bar inside a group", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 4, label: "one" });
    bar.setLabel("renamed");
    expect(stripAnsi(stream.getOutput())).toContain("renamed");
    multi.stop();
  });

  it("does nothing after the bar has ended and on an inert group bar", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 1, stderr: stream });
    bar.stop();
    const after = stream.getOutput();
    bar.setLabel("late");
    expect(stream.getOutput()).toBe(after);
    const multi = progress.multi({ stderr: createMockTTY() });
    multi.stop();
    expect(() => multi.add({ total: 1 }).setLabel("x")).not.toThrow();
  });
});

describe("progress option validation", () => {
  const stream = () => createMockStdout();

  it("names the key and the entry point, and echoes the received value", () => {
    const error = catchError(() => progress.bar({ total: -1, stderr: stream() }));
    expect(error).toBeInstanceOf(RangeError);
    expect(error.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(error.message).toContain('The "total" option of progress.bar() must be');
    expect(error.message).toContain("Received -1");
  });

  const typeCases: [string, () => unknown][] = [
    ["bar options", () => progress.bar(undefined as never)],
    ["bar total", () => progress.bar({ total: "3" as never })],
    ["bar label", () => progress.bar({ total: 1, label: 3 as never })],
    ["bar width", () => progress.bar({ total: 1, width: "3" as never })],
    ["bar filled", () => progress.bar({ total: 1, filled: 1 as never })],
    ["bar empty", () => progress.bar({ total: 1, empty: null as never })],
    ["bar format", () => progress.bar({ total: 1, format: "x" as never })],
    ["bar stderr", () => progress.bar({ total: 1, stderr: "x" as never })],
    ["bar style", () => progress.bar({ total: 1, style: 1 as never })],
    ["spinner options", () => progress.spinner(null as never)],
    ["spinner label", () => progress.spinner({ label: 1 as never })],
    ["spinner frames", () => progress.spinner({ frames: "ab" as never })],
    ["spinner intervalMs", () => progress.spinner({ intervalMs: "1" as never })],
    ["spinner stderr", () => progress.spinner({ stderr: {} as never })],
    ["spinner style", () => progress.spinner({ style: 1 as never })],
    ["multi options", () => progress.multi(null as never)],
    ["multi stderr", () => progress.multi({ stderr: 1 as never })],
    ["multi add options", () => progress.multi({ stderr: stream() }).add(undefined as never)],
    ["multi add total", () => progress.multi({ stderr: stream() }).add({ total: "1" as never })],
  ];
  it.each(typeCases)("rejects a wrongly typed %s with ERR_INVALID_ARG_TYPE", (_name, fn) => {
    const error = catchError(fn);
    expect(error).toBeInstanceOf(TypeError);
    expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    expect(error.message).toMatch(/^The "\w+" (option|argument) of progress\./);
  });

  const rangeCases: [string, () => unknown][] = [
    ["bar total NaN", () => progress.bar({ total: Number.NaN })],
    ["bar width 0", () => progress.bar({ total: 1, width: 0 })],
    ["bar width huge", () => progress.bar({ total: 1, width: 1e9 })],
    ["bar style name", () => progress.bar({ total: 1, style: "nonsense" as never })],
    ["spinner frames empty", () => progress.spinner({ frames: [] })],
    ["spinner intervalMs 0", () => progress.spinner({ intervalMs: 0 })],
    ["spinner style name", () => progress.spinner({ style: "nonsense" as never })],
    ["multi add width", () => progress.multi({ stderr: stream() }).add({ total: 1, width: -1 })],
  ];
  it.each(rangeCases)("rejects a bad %s with ERR_INVALID_ARG_VALUE", (_name, fn) => {
    const error = catchError(fn);
    expect(error).toBeInstanceOf(RangeError);
    expect(error.code).toBe("ERR_INVALID_ARG_VALUE");
    expect(error.message).toMatch(/Received /);
  });

  it("treats undefined option values as omitted", () => {
    const s = stream();
    expect(() =>
      progress
        .bar({
          total: 1,
          label: undefined,
          width: undefined,
          filled: undefined,
          empty: undefined,
          format: undefined,
          style: undefined,
          stderr: s,
        })
        .stop(),
    ).not.toThrow();
    expect(() =>
      progress
        .spinner({ label: undefined, frames: undefined, intervalMs: undefined, stderr: s })
        .stop(),
    ).not.toThrow();
  });

  it("rejects filled and empty whose display width is not 1, but not spinner frames", () => {
    for (const key of ["filled", "empty"] as const) {
      for (const value of ["", "ab", "██", "漢"]) {
        const error = catchError(() => progress.bar({ total: 1, [key]: value }));
        expect(error).toBeInstanceOf(RangeError);
        expect(error.code).toBe("ERR_INVALID_ARG_VALUE");
        expect(error.message).toContain(`The "${key}" option of progress.bar()`);
      }
    }
    const group = progress.multi({ stderr: stream() });
    expect(catchError(() => group.add({ total: 1, filled: "ab" })).code).toBe(
      "ERR_INVALID_ARG_VALUE",
    );
    group.stop();
    expect(() => progress.spinner({ frames: ["ab", "cd"], stderr: stream() }).stop()).not.toThrow();
    expect(() =>
      progress.bar({ total: 1, filled: "#", empty: "-", stderr: stream() }).stop(),
    ).not.toThrow();
  });

  it("rejects wrongly typed arguments to the handle methods", () => {
    const s = stream();
    const bar = progress.bar({ total: 5, stderr: s });
    const spinner = progress.spinner({ stderr: s });
    const group = progress.multi({ stderr: s });
    const child = group.add({ total: 5 });
    const calls: (() => unknown)[] = [
      () => bar.setLabel(1 as never),
      () => bar.update("1" as never),
      () => bar.tick("1" as never),
      () => spinner.setLabel(undefined as never),
      () => child.setLabel(null as never),
      () => child.update({} as never),
      () => child.tick("1" as never),
    ];
    for (const call of calls) {
      const error = catchError(call);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.code).toBe("ERR_INVALID_ARG_TYPE");
    }
    bar.stop();
    spinner.stop();
    group.stop();
  });

  it("still ignores NaN updates", () => {
    const tty = createMockTTY();
    const bar = progress.bar({ total: 10, stderr: tty });
    bar.update(4);
    expect(() => bar.update(Number.NaN)).not.toThrow();
    expect(() => bar.tick(Number.NaN)).not.toThrow();
    expect(stripAnsi(tty.getOutput())).not.toContain("NaN");
    bar.stop();
  });
});

describe("terminals that cannot animate", () => {
  let previousTerm: string | undefined;
  beforeEach(() => {
    previousTerm = process.env.TERM;
    setColorEnabled(false);
  });
  afterEach(() => {
    if (previousTerm === undefined) delete process.env.TERM;
    else process.env.TERM = previousTerm;
    setColorEnabled("auto");
  });

  it("treats TERM=dumb as a non-TTY for spinner, bar and multi", () => {
    process.env.TERM = "dumb";
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "s", stderr: stream });
    const bar = progress.bar({ total: 2, stderr: createMockTTY() });
    const dumb = createMockTTY();
    const multi = progress.multi({ stderr: dumb });
    multi.add({ total: 1 }).update(1);
    expect(stream.getOutput()).toBe("");
    expect(dumb.getOutput()).toBe("");
    spinner.succeed("done");
    expect(stream.getOutput()).toBe("[OK] done\n");
    expect(stream.getOutput()).not.toContain("\x1b[");
    bar.stop();
    multi.stop();
  });

  it("does not claim the stream, so a second indicator is not busy", () => {
    process.env.TERM = "dumb";
    const stream = createMockTTY();
    const a = progress.spinner({ stderr: stream });
    expect(() => progress.spinner({ stderr: stream })).not.toThrow();
    a.stop();
  });
});

describe("status marks", () => {
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

  const verbs = [
    ["succeed", "✔", "[OK]"],
    ["fail", "✖", "[ERROR]"],
    ["warn", "⚠", "[WARN]"],
  ] as const;

  it.each(verbs)("%s: symbol and colour on a coloured TTY", (verb, symbol) => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ label: "x", stderr: stream });
    spinner[verb]("msg");
    expect(stream.getOutput()).toContain(`${symbol}\x1b[`);
    expect(stream.getOutput()).toContain("msg");
  });

  it.each(verbs)("%s: symbol without colour on a TTY under NO_COLOR", (verb, symbol) => {
    process.env.NO_COLOR = "1";
    const stream = createMockTTY();
    const bar = progress.bar({ total: 1, label: "x", stderr: stream });
    bar[verb]("msg");
    expect(stream.getOutput()).toContain(`${symbol} msg\n`);
    expect(stream.getOutput().split("msg")[1]).not.toContain("\x1b[3");
  });

  it.each(verbs)("%s: coloured ASCII on a non-TTY under FORCE_COLOR", (verb, _symbol, ascii) => {
    process.env.FORCE_COLOR = "1";
    const stream = createMockStdout();
    const spinner = progress.spinner({ label: "x", stderr: stream });
    spinner[verb]("msg");
    expect(stream.getOutput()).toMatch(new RegExp(`\\x1b\\[\\d+m\\${ascii.replace("]", "\\]")}`));
    expect(stripAnsi(stream.getOutput())).toBe(`${ascii} msg\n`);
  });

  it.each(verbs)("%s: plain ASCII on a non-TTY", (verb, _symbol, ascii) => {
    const stream = createMockStdout();
    const spinner = progress.spinner({ label: "x", stderr: stream });
    spinner[verb]("msg");
    expect(stream.getOutput()).toBe(`${ascii} msg\n`);
  });

  it("applies the same rule to a group's rows", () => {
    const stream = createMockStdout();
    const multi = progress.multi({ stderr: stream });
    multi.add({ total: 1, label: "a" }).fail();
    multi.stop();
    expect(stream.getOutput()).toBe("[ERROR] a\n");
  });
});

describe("output busy message", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("names a spinner holder and does not suggest multi()", () => {
    const stream = createMockTTY();
    const spinner = progress.spinner({ stderr: stream });
    const error = catchError(() => progress.bar({ total: 1, stderr: stream }));
    expect(error.code).toBe("ERR_OUTPUT_BUSY");
    expect(error.message).toContain("spinner");
    expect(error.message).toMatch(/finish|end/);
    expect(error.message).not.toContain("progress.multi()");
    spinner.stop();
  });

  it("names a bar holder and suggests multi() only to another bar", () => {
    const stream = createMockTTY();
    const bar = progress.bar({ total: 1, stderr: stream });
    const another = catchError(() => progress.bar({ total: 1, stderr: stream }));
    expect(another.message).toContain("bar");
    expect(another.message).toContain("progress.multi()");
    const spinnerError = catchError(() => progress.spinner({ stderr: stream }));
    expect(spinnerError.code).toBe("ERR_OUTPUT_BUSY");
    expect(spinnerError.message).not.toContain("progress.multi()");
    bar.stop();
  });

  it("names a multi-bar holder", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const error = catchError(() => progress.bar({ total: 1, stderr: stream }));
    expect(error.message).toContain("multi-bar");
    expect(error.message).not.toContain("progress.multi()");
    multi.stop();
  });
});

describe("group bar handles", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => setColorEnabled("auto"));

  it("binds [Symbol.dispose] so it works detached from the handle", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({ total: 2, label: "a" });
    const dispose = bar[Symbol.dispose];
    dispose();
    bar.update(1);
    multi.succeed();
    expect(stripAnsi(stream.getOutput())).not.toContain("✔ a");
  });

  it("stops making renders after a throwing format has torn the group down (repro)", () => {
    const stream = createMockTTY();
    const multi = progress.multi({ stderr: stream });
    const bar = multi.add({
      total: 10,
      format(state) {
        if (state.current > 1) throw new Error("format failed");
        return "ok";
      },
    });
    expect(() => bar.update(2)).toThrow("format failed");
    const after = stream.getOutput();
    // A later call must not re-claim the stream and hide the cursor again.
    expect(() => bar.update(1)).not.toThrow();
    expect(() => multi.add({ total: 1 })).not.toThrow();
    expect(stream.getOutput()).toBe(after);
    expect(stream.getOutput().split("\x1b[?25l").length - 1).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCLI, progress } from "../src/index.js";
import { setColorEnabled, stripAnsi } from "../src/output/color.js";
import { runWithProgressScope } from "../src/output/progress.js";
import { createMockTTY } from "./helpers.js";

const SHOW_CURSOR = "\x1b[?25h";

describe("runWithProgressScope", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    progress.releaseAll();
    setColorEnabled("auto");
  });

  it("is not exported from the package root", async () => {
    const root = (await import("../src/index.js")) as Record<string, unknown>;
    expect(root.runWithProgressScope).toBeUndefined();
  });

  it("returns the value of fn", async () => {
    await expect(runWithProgressScope(async () => 42)).resolves.toBe(42);
  });

  it("releases indicators created inside when fn resolves", async () => {
    const bar = createMockTTY();
    const spin = createMockTTY();
    const group = createMockTTY();
    await runWithProgressScope(async () => {
      progress.bar({ total: 1, stderr: bar });
      progress.spinner({ stderr: spin });
      progress.multi({ stderr: group }).add({ total: 1 });
    });
    for (const stream of [bar, spin, group]) expect(stream.getOutput()).toContain(SHOW_CURSOR);
  });

  it("releases indicators created inside when fn rejects", async () => {
    const stream = createMockTTY();
    await expect(
      runWithProgressScope(async () => {
        progress.spinner({ stderr: stream });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(stream.getOutput()).toContain(SHOW_CURSOR);
  });

  it("leaves an indicator created outside the scope running", async () => {
    const outside = createMockTTY();
    const inside = createMockTTY();
    const spinner = progress.spinner({ label: "outer", stderr: outside });
    await runWithProgressScope(async () => {
      progress.spinner({ stderr: inside });
    });
    expect(inside.getOutput()).toContain(SHOW_CURSOR);
    expect(outside.getOutput()).not.toContain(SHOW_CURSOR);
    spinner.succeed("still here");
    expect(stripAnsi(outside.getOutput())).toContain("✔ still here");
  });

  it("does not release an indicator created in a concurrent, unrelated async context", async () => {
    const other = createMockTTY();
    const mine = createMockTTY();
    let create!: () => void;
    const gate = new Promise<void>((resolve) => {
      create = resolve;
    });
    let spinner!: ReturnType<typeof progress.spinner>;
    // Started outside the scope, so its async context carries no scope.
    const outsider = gate.then(() => {
      spinner = progress.spinner({ label: "other", stderr: other });
    });
    await runWithProgressScope(async () => {
      progress.spinner({ stderr: mine });
      create();
      await outsider;
    });
    expect(mine.getOutput()).toContain(SHOW_CURSOR);
    expect(other.getOutput()).not.toContain(SHOW_CURSOR);
    spinner.succeed("alive");
    expect(stripAnsi(other.getOutput())).toContain("✔ alive");
  });

  it("scopes concurrent calls independently", async () => {
    const a = createMockTTY();
    const b = createMockTTY();
    let finishB!: () => void;
    const holdB = new Promise<void>((resolve) => {
      finishB = resolve;
    });
    const first = runWithProgressScope(async () => {
      progress.spinner({ stderr: a });
    });
    const second = runWithProgressScope(async () => {
      progress.spinner({ stderr: b });
      await holdB;
    });
    await first;
    expect(a.getOutput()).toContain(SHOW_CURSOR);
    expect(b.getOutput()).not.toContain(SHOW_CURSOR);
    finishB();
    await second;
    expect(b.getOutput()).toContain(SHOW_CURSOR);
  });

  it("gives a nested call its own scope", async () => {
    const outer = createMockTTY();
    const inner = createMockTTY();
    await runWithProgressScope(async () => {
      progress.spinner({ stderr: outer });
      await runWithProgressScope(async () => {
        progress.spinner({ stderr: inner });
      });
      expect(inner.getOutput()).toContain(SHOW_CURSOR);
      expect(outer.getOutput()).not.toContain(SHOW_CURSOR);
    });
    expect(outer.getOutput()).toContain(SHOW_CURSOR);
  });

  it("releases indicators created after an await inside the scope", async () => {
    const stream = createMockTTY();
    await runWithProgressScope(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      progress.bar({ total: 2, stderr: stream });
    });
    expect(stream.getOutput()).toContain(SHOW_CURSOR);
  });

  it("is harmless for indicators the scope's code already ended", async () => {
    const stream = createMockTTY();
    await runWithProgressScope(async () => {
      progress.spinner({ stderr: stream }).succeed("done");
    });
    const text = stripAnsi(stream.getOutput());
    expect(text.split("done").length - 1).toBe(1);
  });

  it("leaves releaseAll as the explicit process-wide reset", async () => {
    const stream = createMockTTY();
    progress.spinner({ stderr: stream });
    progress.releaseAll();
    expect(stream.getOutput()).toContain(SHOW_CURSOR);
  });
});

describe("command execution scope", () => {
  beforeEach(() => setColorEnabled(false));
  afterEach(() => {
    progress.releaseAll();
    setColorEnabled("auto");
  });

  it("keeps a concurrent command's spinner running when another command ends", async () => {
    const cli = createCLI({ name: "test" });
    const slow = createMockTTY();
    let finish: () => void = () => {};
    let spinnerStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      spinnerStarted = resolve;
    });
    cli.command("slow").action(async () => {
      const spinner = progress.spinner({ label: "slow", stderr: slow });
      spinnerStarted();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      spinner.succeed("slow done");
    });
    cli.command("quick").action(() => {
      progress.spinner({ label: "quick", stderr: createMockTTY() });
    });

    const running = cli.exec(["slow"]);
    await started;
    await cli.exec(["quick"]);
    finish();
    await running;
    expect(stripAnsi(slow.getOutput())).toContain("slow done");
  });

  it("releases a spinner the command left running when it ends", async () => {
    const cli = createCLI({ name: "test" });
    const tty = createMockTTY();
    cli.command("leak").action(() => {
      progress.spinner({ label: "leak", stderr: tty });
    });
    await cli.exec(["leak"]);
    expect(tty.getOutput()).toContain(SHOW_CURSOR);
  });

  it("gives a nested exec its own scope", async () => {
    const cli = createCLI({ name: "test" });
    const outer = createMockTTY();
    const inner = createMockTTY();
    let outerAfterInner = "";
    cli.command("inner").action(() => {
      progress.spinner({ label: "inner", stderr: inner });
    });
    cli.command("outer").action(async (ctx) => {
      const spinner = progress.spinner({ label: "outer", stderr: outer });
      await cli.exec(["inner"], ctx);
      spinner.succeed("outer still running");
      outerAfterInner = stripAnsi(outer.getOutput());
    });
    await cli.execLine("outer");
    expect(inner.getOutput()).toContain(SHOW_CURSOR);
    expect(outerAfterInner).toContain("outer still running");
  });

  it("does not release an indicator created outside any command", async () => {
    const cli = createCLI({ name: "test" });
    const tty = createMockTTY();
    const spinner = progress.spinner({ label: "outside", stderr: tty });
    cli.command("noop").action(() => {});
    await cli.exec(["noop"]);
    spinner.succeed("outside done");
    expect(stripAnsi(tty.getOutput())).toContain("outside done");
  });
});

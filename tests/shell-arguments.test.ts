import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommandRegistry } from "../src/command/registry.js";
import { CommandRouter } from "../src/command/router.js";
import { InteractiveShell, type ModeOptions } from "../src/shell/repl.js";
import { createMockTTY } from "./helpers.js";

function makeShell(): { shell: InteractiveShell; router: CommandRouter } {
  const registry = new CommandRegistry();
  const router = new CommandRouter(registry);
  const shell = new InteractiveShell({
    router,
    registry,
    prompt: "> ",
    historyFile: "shell-history-test",
  });
  return { shell, router };
}

type Internal = {
  runModeAction(mode: ModeOptions, input: string): Promise<void>;
  modeController?: AbortController;
};

/** Runs one mode line with stderr captured, returning what was written there. */
async function runMode(
  shell: InteractiveShell,
  action: ModeOptions["action"],
): Promise<{ stderr: string }> {
  const original = process.stderr;
  const stderr = createMockTTY();
  Object.defineProperty(process, "stderr", { configurable: true, value: stderr });
  try {
    await (shell as unknown as Internal).runModeAction({ prompt: "m> ", action }, "line");
  } finally {
    Object.defineProperty(process, "stderr", { configurable: true, value: original });
  }
  return { stderr: stderr.getOutput() };
}

function abortCurrent(shell: InteractiveShell): void {
  (shell as unknown as Internal).modeController?.abort();
}

describe("mode action failures (C11a)", () => {
  it("emits error once and presents the failure on stderr", async () => {
    const { shell, router } = makeShell();
    const errors: Error[] = [];
    router.on("error", (e) => {
      errors.push(e);
    });
    const failure = new Error("boom");
    const { stderr } = await runMode(shell, () => {
      throw failure;
    });
    expect(errors).toEqual([failure]);
    expect(stderr).toContain("Error: boom");
  });

  it("wraps a non-Error rejection for the error event", async () => {
    const { shell, router } = makeShell();
    const errors: unknown[] = [];
    router.on("error", (e) => {
      errors.push(e);
    });
    await runMode(shell, async () => {
      throw "plain";
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe("plain");
  });

  it("does not emit error when the action fails because the signal aborted", async () => {
    const { shell, router } = makeShell();
    const errors: Error[] = [];
    router.on("error", (e) => {
      errors.push(e);
    });
    const { stderr } = await runMode(shell, (_input, ctx) => {
      abortCurrent(shell);
      ctx.signal.throwIfAborted();
    });
    expect(errors).toHaveLength(0);
    expect(stderr).toContain("Cancelled");
  });

  it("treats an AbortError after the abort as a cancellation", async () => {
    const { shell, router } = makeShell();
    const errors: Error[] = [];
    router.on("error", (e) => {
      errors.push(e);
    });
    const { stderr } = await runMode(shell, async () => {
      abortCurrent(shell);
      throw new DOMException("aborted", "AbortError");
    });
    expect(errors).toHaveLength(0);
    expect(stderr).toContain("Cancelled");
  });

  it("reports an unrelated failure after an abort as an error event and Error: line", async () => {
    const { shell, router } = makeShell();
    const errors: Error[] = [];
    router.on("error", (e) => {
      errors.push(e);
    });
    const { stderr } = await runMode(shell, async () => {
      abortCurrent(shell);
      throw new Error("disk full");
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("disk full");
    expect(stderr).toContain("Error: disk full");
    expect(stderr).not.toContain("Cancelled");
  });
});

describe("Shell argument validation (C11b)", () => {
  const action = () => {};

  it("setPrompt rejects a non-string", () => {
    const { shell } = makeShell();
    for (const bad of [undefined, null, 1, {}, ["a"]]) {
      let caught: unknown;
      try {
        shell.setPrompt(bad as unknown as string);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect((caught as Error).message).toContain("Shell.setPrompt()");
    }
    expect(shell.setPrompt("")).toBe(shell);
  });

  it("enterMode rejects options that are not an object", () => {
    const { shell } = makeShell();
    for (const bad of [undefined, null, "x", 1, [], () => {}]) {
      let caught: unknown;
      try {
        shell.enterMode(bad as unknown as ModeOptions);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TypeError);
      expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
      expect((caught as Error).message).toContain("Shell.enterMode()");
    }
  });

  it.each([
    ["prompt", { prompt: 1, action }],
    ["prompt", { prompt: undefined, action }],
    ["action", { prompt: "m> ", action: "nope" }],
    ["action", { prompt: "m> " }],
    ["banner", { prompt: "m> ", action, banner: 1 }],
    ["banner", { prompt: "m> ", action, banner: null }],
    ["completer", { prompt: "m> ", action, completer: "a" }],
    ["completer", { prompt: "m> ", action, completer: [1] }],
    ["completer", { prompt: "m> ", action, completer: null }],
    ["history", { prompt: "m> ", action, history: 1 }],
    ["history", { prompt: "m> ", action, history: null }],
    ["history", { prompt: "m> ", action, history: true }],
  ])("enterMode rejects a bad %s with a TypeError", (name, options) => {
    const { shell } = makeShell();
    let caught: unknown;
    try {
      shell.enterMode(options as unknown as ModeOptions);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_TYPE");
    expect((caught as Error).message).toContain("Shell.enterMode()");
    expect((caught as Error).message).toContain(name);
  });

  it("enterMode rejects an unknown history with a RangeError listing the candidates", () => {
    const { shell } = makeShell();
    for (const bad of ["", "off", "persist", "SESSION"]) {
      let caught: unknown;
      try {
        shell.enterMode({ prompt: "m> ", action, history: bad as "session" });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RangeError);
      expect(caught).toHaveProperty("code", "ERR_INVALID_ARG_VALUE");
      expect((caught as Error).message).toContain("Shell.enterMode()");
      expect((caught as Error).message).toContain("session");
      expect((caught as Error).message).toContain("none");
    }
  });

  it("enterMode accepts valid options and leaves the shell unchanged on rejection", () => {
    const { shell } = makeShell();
    expect(() => shell.enterMode({ prompt: "m> ", action: 1 as unknown as () => void })).toThrow();
    expect((shell as unknown as { mode: unknown }).mode).toBeNull();
    expect(
      shell.enterMode({
        prompt: "",
        action,
        banner: undefined,
        completer: ["a"],
        history: "none",
      }),
    ).toBe(shell);
    expect(shell.enterMode({ prompt: "m> ", action, completer: () => [] })).toBe(shell);
  });
});

describe("TSDoc phrases in src/shell/repl.ts", () => {
  const source = readFileSync(new URL("../src/shell/repl.ts", import.meta.url), "utf8");

  function docBefore(member: string): string {
    const idx = source.indexOf(member);
    expect(idx).toBeGreaterThan(-1);
    const start = source.lastIndexOf("/**", idx);
    return source.slice(start, idx);
  }

  it("documents the banner default", () => {
    expect(docBefore("banner?: string | undefined;")).toContain("Defaults to");
  });

  it("documents @throws on the Shell members", () => {
    const shellStart = source.indexOf("export interface Shell {");
    const shellBody = source.slice(shellStart, source.indexOf("\n}", shellStart));
    const setPrompt = shellBody.slice(
      shellBody.indexOf("/**"),
      shellBody.indexOf("setPrompt(text: string): this;"),
    );
    expect(setPrompt).toContain("@throws");
    const enterStart = shellBody.indexOf("enterMode(options: ModeOptions): this;");
    const enterDoc = shellBody.slice(shellBody.lastIndexOf("/**", enterStart), enterStart);
    expect(enterDoc).toContain("@throws");
  });
});

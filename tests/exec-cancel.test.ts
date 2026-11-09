/**
 * Cancellation at every entry point.
 *
 * Pairwise model (coverwise, strength 2, seed 1; 24 rows, all 64 pairs):
 *   entry:  exec | execLine | start
 *   pipe:   none | piped
 *   signal: pre-aborted | aborted-during | none
 *   source: optionParse | optionValidate | commandValidate | beforeExecute | action | ignored
 * Constraints:
 *   IF entry IN {exec, start} THEN pipe = none
 *   IF signal = "pre-aborted" THEN entry != start
 *   IF source = ignored THEN signal = "aborted-during"
 * "aborted-during" is the exec signal for exec/execLine and SIGINT for start;
 * "none" means the source throws a CancelledError (a prompt's Ctrl-C) while no
 * signal is aborted; "ignored" is an action that finishes despite the abort.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, createCLI } from "../src/index.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

type Entry = "exec" | "execLine" | "start";
type Pipe = "none" | "piped";
type SignalState = "pre-aborted" | "aborted-during" | "none";
type Source =
  | "optionParse"
  | "optionValidate"
  | "commandValidate"
  | "beforeExecute"
  | "action"
  | "ignored";

const CASES: [Entry, Pipe, SignalState, Source][] = [
  ["start", "none", "aborted-during", "optionParse"],
  ["exec", "none", "none", "commandValidate"],
  ["start", "none", "aborted-during", "ignored"],
  ["exec", "none", "aborted-during", "action"],
  ["execLine", "none", "pre-aborted", "optionValidate"],
  ["start", "none", "none", "beforeExecute"],
  ["execLine", "piped", "aborted-during", "commandValidate"],
  ["execLine", "piped", "none", "action"],
  ["start", "none", "none", "optionValidate"],
  ["execLine", "piped", "aborted-during", "ignored"],
  ["exec", "none", "pre-aborted", "optionParse"],
  ["execLine", "piped", "pre-aborted", "optionParse"],
  ["exec", "none", "aborted-during", "beforeExecute"],
  ["execLine", "piped", "pre-aborted", "commandValidate"],
  ["execLine", "piped", "pre-aborted", "action"],
  ["exec", "none", "pre-aborted", "beforeExecute"],
  ["execLine", "piped", "none", "beforeExecute"],
  ["execLine", "none", "aborted-during", "optionValidate"],
  ["execLine", "piped", "none", "optionValidate"],
  ["exec", "none", "aborted-during", "ignored"],
  ["start", "none", "none", "commandValidate"],
  ["start", "none", "aborted-during", "action"],
  ["exec", "none", "pre-aborted", "optionValidate"],
  ["execLine", "none", "none", "optionParse"],
];

describe("cancellation at every entry point", () => {
  restoreProcessStateAfterEach();
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(CASES)("%s, pipe %s, signal %s, cancelled in %s", async (entry, pipe, state, source) => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const cli = createCLI({ name: "test" });
    const counts = { commandError: 0, error: 0, beforeExecute: 0, action: 0, cancel: 0 };
    const thrown = new CancelledError();
    let started: () => void = () => {};
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });

    // The cancellation as each source meets it.
    const halt = (signal: AbortSignal): Promise<void> => {
      if (state === "none") return Promise.reject(thrown);
      return new Promise<void>((resolve, reject) => {
        const stop = () =>
          source === "ignored" ? resolve() : reject(new DOMException("aborted", "AbortError"));
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
        started();
      });
    };

    cli.on("commandError", () => {
      counts.commandError++;
    });
    cli.on("error", () => {
      counts.error++;
    });
    cli.on("beforeExecute", (ctx) => {
      if (ctx.commandPath[0] !== "work") return;
      counts.beforeExecute++;
      if (source === "beforeExecute") return halt(ctx.signal);
    });
    cli
      .command("work")
      .option("--n <n>", {
        parse:
          source === "optionParse" ? (value, ctx) => halt(ctx.signal).then(() => value) : undefined,
        validate: source === "optionValidate" ? (_value, ctx) => halt(ctx.signal) : undefined,
      })
      .validate((ctx) => (source === "commandValidate" ? halt(ctx.signal) : undefined))
      .onCancel(() => {
        counts.cancel++;
      })
      .action((ctx) => {
        counts.action++;
        if (source === "action" || source === "ignored") return halt(ctx.signal);
      });
    cli.command("sink").action(async (ctx) => {
      for await (const _chunk of ctx.stdin ?? []) {
        // Drain until the upstream stage ends or fails.
      }
    });

    const controller = new AbortController();
    if (state === "pre-aborted") controller.abort("stop");
    const streams = { stdout: createMockStdout(), stderr: createMockStdout() };
    let outcome: Promise<unknown>;
    if (entry === "start") {
      outcome = cli.start(["work", "--n", "1"]);
    } else if (entry === "exec") {
      outcome = cli.exec(["work", "--n", "1"], { ...streams, signal: controller.signal });
    } else {
      const line = pipe === "piped" ? "work --n 1 | sink" : "work --n 1";
      outcome = cli.execLine(line, { ...streams, signal: controller.signal });
    }
    const settled = outcome.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    if (state === "aborted-during") {
      await running;
      if (entry === "start") process.emit("SIGINT");
      else controller.abort("stop");
    }
    const result = await settled;

    expect(counts.commandError).toBe(0);
    expect(counts.error).toBe(0);
    if (state === "pre-aborted") {
      expect(result).toMatchObject({ ok: false });
      const error = (result as { error: unknown }).error;
      expect(error).toBeInstanceOf(CancelledError);
      expect(error).toMatchObject({ code: "CANCELLED", exitCode: 130, cause: "stop" });
      expect(counts).toMatchObject({ beforeExecute: 0, action: 0, cancel: 0 });
      return;
    }
    if (entry === "start") {
      expect(result).toEqual({ ok: true, value: 130 });
    } else if (source === "ignored") {
      expect(result).toEqual({ ok: true, value: undefined });
    } else {
      expect(result).toMatchObject({ ok: false });
      const error = (result as { error: unknown }).error;
      expect(error).toBeInstanceOf(CancelledError);
      if (state === "none") expect(error).toBe(thrown);
      else expect(error).toMatchObject({ cause: "stop" });
    }
    expect(counts.action).toBe(source === "action" || source === "ignored" ? 1 : 0);
    expect(counts.cancel).toBe(state === "aborted-during" ? 1 : 0);
  });
});

describe("exec cancellation", () => {
  it("leaves the process SIGINT to the host", async () => {
    const cli = createCLI({ name: "test" });
    const before = process.listenerCount("SIGINT");
    let during = -1;
    cli.command("probe").action(() => {
      during = process.listenerCount("SIGINT");
    });
    await Promise.all(
      Array.from({ length: 12 }, () => cli.exec(["probe"], { stdout: createMockStdout() })),
    );
    await cli.execLine("probe", { stdout: createMockStdout() });
    expect(during).toBe(before);
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("rejects an aborted signal before waiting for a pending plugin", async () => {
    const cli = createCLI({ name: "test" });
    const plugin = vi.fn();
    cli.use(() => new Promise<void>(() => {}));
    cli.use(plugin);
    const controller = new AbortController();
    controller.abort("stop");
    await expect(cli.exec(["x"], { signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
      cause: "stop",
    });
    expect(plugin).not.toHaveBeenCalled();
  });

  it("reports an aborted signal ahead of a failed plugin", async () => {
    const cli = createCLI({ name: "test" });
    cli.use(async () => {
      throw new Error("plugin failed");
    });
    await expect(cli.execLine("x")).rejects.toMatchObject({ code: "ERR_PLUGIN_FAILED" });
    const controller = new AbortController();
    controller.abort();
    await expect(cli.execLine("x", { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it("does not run onCancel for a command that never started", async () => {
    const cli = createCLI({ name: "test" });
    const cancel = vi.fn();
    cli
      .command("work")
      .onCancel(cancel)
      .action(() => {});
    const controller = new AbortController();
    controller.abort();
    await expect(cli.exec(["work"], { signal: controller.signal })).rejects.toBeInstanceOf(
      CancelledError,
    );
    expect(cancel).not.toHaveBeenCalled();
  });

  it("wraps a cancelled fallback in CancelledError without the error event", async () => {
    const cli = createCLI({ name: "test" });
    const error = vi.fn();
    cli.on("error", error);
    const controller = new AbortController();
    cli.fallback(
      (_input, ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          controller.abort("stop");
        }),
    );
    await expect(cli.exec(["unknown"], { signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
      cause: "stop",
    });
    expect(error).not.toHaveBeenCalled();
  });
});

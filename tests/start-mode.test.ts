/**
 * Mode selection and exit code of `start()`, as pairwise rows from coverwise.
 *
 * Model:
 *   argv           ∈ {omitted-empty, omitted-command, explicit-empty, explicit-dashdash,
 *                     explicit-command, explicit-unknown}
 *   stdinTTY       ∈ {true, false}
 *   stdoutTTY      ∈ {true, false}
 *   commandOutcome ∈ {ok, throws-cli-error, interrupted}
 * Constraint:
 *   IF argv IN {omitted-empty, explicit-empty, explicit-dashdash, explicit-unknown}
 *   THEN commandOutcome = ok
 * Generation: seed 7, 17 pairwise rows, coverage 1.0, plus the required row
 *   {explicit-empty, true, true, ok}, which proves an explicit empty argv opens the REPL.
 *
 * Expectations:
 *   - omitted-empty and explicit-empty open the REPL when both stdin and stdout are TTYs,
 *     and otherwise print the help index and return 0.
 *   - explicit-dashdash prints the help index and returns 0.
 *   - a command returns 0 when it succeeds, the error's exitCode when it throws a CLIError,
 *     and 130 when SIGINT interrupts it.
 *   - explicit-unknown returns 64.
 *   - the resolved value and process.exitCode agree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIError, createCLI } from "../src/index.js";
import { InteractiveShell } from "../src/shell/repl.js";
import { createMockStdout, restoreProcessStateAfterEach } from "./helpers.js";

type Argv =
  | "omitted-empty"
  | "omitted-command"
  | "explicit-empty"
  | "explicit-dashdash"
  | "explicit-command"
  | "explicit-unknown";
type Outcome = "ok" | "throws-cli-error" | "interrupted";
type Row = readonly [argv: Argv, stdinTTY: boolean, stdoutTTY: boolean, outcome: Outcome];

const ROWS: readonly Row[] = [
  ["explicit-command", false, false, "interrupted"],
  ["omitted-empty", true, true, "ok"],
  ["omitted-empty", true, false, "ok"],
  ["omitted-command", false, true, "ok"],
  ["omitted-command", true, false, "throws-cli-error"],
  ["explicit-empty", true, false, "ok"],
  ["omitted-empty", false, true, "ok"],
  ["omitted-command", true, true, "interrupted"],
  ["explicit-command", false, true, "throws-cli-error"],
  ["explicit-unknown", true, true, "ok"],
  ["explicit-dashdash", false, false, "ok"],
  ["explicit-command", true, false, "interrupted"],
  ["explicit-dashdash", true, true, "ok"],
  ["explicit-unknown", true, false, "ok"],
  ["explicit-command", false, false, "ok"],
  ["explicit-unknown", false, true, "ok"],
  ["explicit-empty", false, true, "ok"],
  // Required row.
  ["explicit-empty", true, true, "ok"],
];

const CLI_ERROR_EXIT_CODE = 3;

const ARGV: Record<Argv, readonly string[]> = {
  "omitted-empty": [],
  "omitted-command": ["run"],
  "explicit-empty": [],
  "explicit-dashdash": ["--"],
  "explicit-command": ["run"],
  "explicit-unknown": ["nope"],
};

function expectedResult(
  argv: Argv,
  bothTTY: boolean,
  outcome: Outcome,
): { code: number; repl: boolean; helpIndex: boolean } {
  switch (argv) {
    case "omitted-empty":
    case "explicit-empty":
      return { code: 0, repl: bothTTY, helpIndex: !bothTTY };
    case "explicit-dashdash":
      return { code: 0, repl: false, helpIndex: true };
    case "explicit-unknown":
      return { code: 64, repl: false, helpIndex: false };
    case "omitted-command":
    case "explicit-command": {
      const code =
        outcome === "ok" ? 0 : outcome === "throws-cli-error" ? CLI_ERROR_EXIT_CODE : 130;
      return { code, repl: false, helpIndex: false };
    }
  }
}

function overrideTTY(stream: NodeJS.ReadStream | NodeJS.WriteStream, value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(stream, "isTTY");
  Object.defineProperty(stream, "isTTY", { value, configurable: true, writable: true });
  return () => {
    if (original) Object.defineProperty(stream, "isTTY", original);
    else delete (stream as { isTTY?: boolean }).isTTY;
  };
}

describe("start() mode selection", () => {
  restoreProcessStateAfterEach();

  const restorers: Array<() => void> = [];
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
    process.exitCode = undefined;
  });

  afterEach(() => {
    while (restorers.length > 0) restorers.pop()?.();
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it.each(ROWS)("%s stdinTTY=%s stdoutTTY=%s %s", async (argv, stdinTTY, stdoutTTY, outcome) => {
    const stdout = createMockStdout();
    const stderr = createMockStdout();
    process.stdout.write = stdout.write.bind(stdout) as typeof process.stdout.write;
    process.stderr.write = stderr.write.bind(stderr) as typeof process.stderr.write;
    restorers.push(overrideTTY(process.stdin, stdinTTY), overrideTTY(process.stdout, stdoutTTY));
    const replStart = vi.spyOn(InteractiveShell.prototype, "start").mockResolvedValue(undefined);

    const cli = createCLI({ name: "app", historyFile: "/dev/null" });
    cli.command("run").action(
      (ctx) =>
        new Promise<void>((resolve, reject) => {
          if (outcome === "ok") {
            resolve();
          } else if (outcome === "throws-cli-error") {
            reject(new CLIError("boom", { code: "BOOM", exitCode: CLI_ERROR_EXIT_CODE }));
          } else {
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
            setImmediate(() => process.emit("SIGINT"));
          }
        }),
    );

    let result: number;
    if (argv.startsWith("omitted-")) {
      process.argv = ["node", "app", ...ARGV[argv]];
      result = await cli.start();
    } else {
      result = await cli.start(ARGV[argv]);
    }

    const expected = expectedResult(argv, stdinTTY && stdoutTTY, outcome);
    expect(result).toBe(expected.code);
    expect(process.exitCode ?? 0).toBe(expected.code);
    expect(replStart).toHaveBeenCalledTimes(expected.repl ? 1 : 0);
    if (expected.helpIndex) expect(stdout.getOutput()).toContain("Available commands:");
    else expect(stdout.getOutput()).not.toContain("Available commands:");
  });
});

import type { Readable } from "node:stream";
import type {
  Completer,
  CompletionContext,
  ModeContext,
  ModeOptions,
  Shell,
} from "../../src/index.js";

declare const shell: Shell;

// A mode completer is the shared Completer: it receives a CompletionContext
// and returns plain candidates, sync or async.
const sync: Completer = (ctx) => [ctx.current];
const async_: Completer = async (ctx) => [ctx.line, String(ctx.iteration)];
const config: ModeOptions = {
  prompt: "sql> ",
  banner: "Entering SQL mode",
  completer: sync,
  action(_input, ctx: ModeContext) {
    ctx.stdout.write("ok\n");
  },
};
const asyncConfig: ModeOptions = { prompt: "> ", completer: async_, action: () => {} };
const listConfig: ModeOptions = { prompt: "> ", completer: ["select", "insert"], action: () => {} };
void [config, asyncConfig, listConfig];

// @ts-expect-error the completer takes a context, not a line
const lineCompleter: ModeOptions["completer"] = (line: string) => [line];
void lineCompleter;

// @ts-expect-error a completer returns candidates, not the readline tuple
const tupleCompleter: Completer = () => [["a"], "a"] as [string[], string];
void tupleCompleter;

// @ts-expect-error `message` was renamed to `banner`
const oldName: ModeOptions = { prompt: "> ", message: "hi", action: () => {} };
void oldName;

// A mode action context carries the shell's streams, stdin included, and the signal.
declare const modeCtx: ModeContext;
const signal: AbortSignal = modeCtx.signal;
void signal;
const modeIn: Readable | null = modeCtx.stdin;
void modeIn;
// @ts-expect-error members are readonly
modeCtx.signal = new AbortController().signal;

// setPrompt returns the shell, so configuration calls chain.
const chained: Shell = shell.setPrompt("a> ").setPrompt("b> ");
void chained;

// enterMode and exitMode return the shell; stop is terminal and returns nothing.
const entered: Shell = shell.enterMode(config).exitMode().setPrompt("c> ");
void entered;
// @ts-expect-error stop() returns void, so it cannot be chained
shell.stop().setPrompt("x");

export type { CompletionContext };

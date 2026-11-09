import type { Readable } from "node:stream";
import * as root from "../../src/index.js";
import {
  type CancelHandler,
  type CLI,
  type CLIOptions,
  type CommandBuilder,
  type CommandContext,
  type CommandStreams,
  type CommandValidator,
  createCLI,
  type FallbackContext,
  type FallbackHandler,
  type HistoryFilter,
  type ModeContext,
  type Plugin,
  type PluginContext,
  type StdioOptions,
  tokenize,
} from "../../src/index.js";

declare const ctx: CommandContext;

// Every context member is readonly, and its arrays are readonly too.
// @ts-expect-error rawInput is readonly
ctx.rawInput = "x";
// @ts-expect-error options is readonly
ctx.options = {};
// @ts-expect-error stdout is readonly
ctx.stdout = process.stdout;
// @ts-expect-error commandPath is a readonly array
ctx.commandPath.push("x");
const rawArgv: readonly string[] | null = ctx.rawArgv;
// @ts-expect-error rawArgv is null for string input
const strictArgv: readonly string[] = ctx.rawArgv;
void rawArgv;
void strictArgv;

// One stream shape: a command context can be handed on as streams or stdio options.
const streams: CommandStreams = ctx;
const stdio: StdioOptions = ctx;
const emptyStdio: StdioOptions = {};
const modeContext: ModeContext = ctx;
// A mode context carries stdin, so a mode action can prompt.
const modeStdin: Readable | null = modeContext.stdin;
void modeStdin;
void streams;
void stdio;
void emptyStdio;

// The fallback context carries stdin and signal alongside the output streams.
const fallback: FallbackHandler = (input, fallbackCtx: FallbackContext) => {
  const text: string = input;
  const stdin: Readable | null = fallbackCtx.stdin;
  const signal: AbortSignal = fallbackCtx.signal;
  void text;
  void stdin;
  void signal;
};

const historyFilter: HistoryFilter = (line) => (line.includes("secret") ? null : line);
const options: CLIOptions = {
  name: "test",
  historySize: 10,
  historyFilter,
  historyFile: "~/.app_history",
};
const cli: CLI = createCLI(options);

// @ts-expect-error name is required
createCLI();
// @ts-expect-error name is required
createCLI({});

// Settings are construction-only.
// @ts-expect-error prompt() was removed
cli.prompt("> ");
// @ts-expect-error description() was removed
cli.description("x");
// @ts-expect-error banner() was removed
cli.banner("x");
// @ts-expect-error history() was removed
cli.history("x");
// @ts-expect-error historySize() was removed
cli.historySize(1);
// @ts-expect-error historyFilter() was removed
cli.historyFilter(historyFilter);
// @ts-expect-error catch() is now fallback()
cli.catch(fallback);
const chained: CLI = cli.fallback(fallback);
void chained;

// start resolves to the exit code; both entry points take readonly argv.
const exitCode: Promise<number> = cli.start();
const explicit: Promise<number> = cli.start(["deploy", "prod"] as const);
const runString: Promise<void> = cli.execLine("deploy prod", ctx);
const runArray: Promise<void> = cli.exec(["deploy", "prod"] as const, { stdin: null });
// @ts-expect-error input is a string or a string array
void cli.execLine(42);
void exitCode;
void explicit;
void runString;
void runArray;

// PluginContext's setters chain.
const plugin: Plugin = (pluginCtx) => {
  const self: PluginContext = pluginCtx
    .on("exit", () => {})
    .off("exit", () => {})
    .fallback(fallback);
  const builder: CommandBuilder = self.command("status");
  void builder;
};
const brokenPlugin: Plugin = (pluginCtx) => {
  // @ts-expect-error PluginContext.catch is now fallback
  pluginCtx.catch(fallback);
};
const chainedUse: CLI = cli.use(plugin).use(brokenPlugin);
void chainedUse;

const validator: CommandValidator = async (commandCtx) => {
  void commandCtx.args;
};
const onCancel: CancelHandler = (commandCtx) => {
  void commandCtx.signal;
};
void validator;
void onCancel;

// tokenize stays on the root; CLI and CommandBuilder are type-only.
const tokens: string[] = tokenize("a b");
void tokens;
// @ts-expect-error CLI is exported as a type only
void root.CLI;
// @ts-expect-error CommandBuilder is exported as a type only
void root.CommandBuilder;
// @ts-expect-error parser helpers left the root
void root.stripOptionPrefix;
// @ts-expect-error parser helpers left the root
void root.splitPipes;
// @ts-expect-error parser helpers left the root
void root.activePipeSegment;
// @ts-expect-error ExecOptions became StdioOptions
export type RemovedExecOptions = root.ExecOptions;
// @ts-expect-error CatchContext became FallbackContext
export type RemovedCatchContext = root.CatchContext;
// @ts-expect-error CompletionResult left the root
export type RemovedCompletionResult = root.CompletionResult;

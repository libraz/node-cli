import type { Readable, Writable } from "node:stream";
import type { CommandBuilder } from "./command/builder.js";
import type { Shell } from "./shell/repl.js";

// ── Argument ──

/**
 * Definition of a command argument.
 */
export interface ArgDef {
  /** The name of the argument. */
  name: string;
  /** Whether the argument is required. */
  required: boolean;
  /** Whether the argument accepts multiple values (variadic). */
  variadic: boolean;
}

// ── Option ──

/**
 * Schema that describes the constraints and behavior of a command option.
 */
export interface OptionSchema {
  /** Human-readable description of the option. */
  description?: string;
  /** The expected value type of the option. */
  type?: "string" | "number" | "boolean" | "string[]" | "number[]";
  /** Short alias or list of aliases for the option (e.g. "-v"). */
  alias?: string | string[];
  /** Whether the option must be provided. */
  required?: boolean;
  /**
   * Default value used when the option is not specified. It is run through the
   * same built-in type coercion as an explicit value (so a string `"8080"` on a
   * `type: "number"` option resolves to the number `8080`), but a custom `parse`
   * is not applied to it — a default is treated as an already-resolved value, not
   * raw input. A default already in the option's final type is left unchanged.
   */
  default?: unknown;
  /** Restricts the option value to one of the given choices. */
  choices?: unknown[];
  /** Custom parser that converts the raw string value into the desired type. */
  parse?: (value: string, ctx: CommandContext) => unknown;
  /** Custom validator that throws on invalid values. */
  validate?: (value: unknown, ctx: CommandContext) => void;
  /** If true, the option is hidden from help output. */
  hidden?: boolean;
  /** Completion candidates for this option's value. Can be a static array or a function. */
  autocomplete?: string[] | ((current: string) => string[] | Promise<string[]>);
}

/**
 * Fully resolved definition of a command option, including its long flag,
 * aliases, and associated schema.
 */
export interface OptionDef {
  /** The long flag name (without the "--" prefix). */
  long: string;
  /** All short and long aliases for this option. */
  aliases: string[];
  /** Whether the option expects a value (true) or is a boolean flag (false). */
  takesValue: boolean;
  /** Placeholder name shown for a value-taking option in help output. */
  valueName?: string;
  /** The schema describing this option's constraints. */
  schema: OptionSchema;
}

// ── Command ──

/**
 * An action handler executed when a command is invoked.
 * May be synchronous or asynchronous.
 */
export type Action = (ctx: CommandContext) => void | Promise<void>;

/**
 * A completion provider that returns suggested completions for the current input.
 * May be synchronous or asynchronous.
 */
export type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>;

/**
 * A command-level validator run after option resolution and before the action.
 * Throw (or reject) to stop execution.
 */
export type CommandValidator = (ctx: CommandContext) => void | Promise<void>;

/**
 * A handler invoked when a running command is interrupted: Ctrl-C, an aborted
 * exec signal, or SIGTERM in the shell. It is not awaited; a rejection is
 * reported through the `error` event.
 */
export type CancelHandler = (ctx: CommandContext) => void;

/**
 * A fallback handler invoked with the raw input when no command matches it.
 */
export type FallbackHandler = (input: string, ctx: FallbackContext) => void | Promise<void>;

/**
 * Redacts or rejects a line before it is persisted to shell history. Return
 * `null` to omit the line entirely. It stays synchronous because history is
 * written with synchronous I/O.
 */
export type HistoryFilter = (line: string) => string | null;

/**
 * Full definition of a CLI command, including its arguments, options,
 * subcommands, and action handler.
 */
export interface CommandDefinition {
  /** The command name as it appears on the command line. */
  name: string;
  /** Ordered list of positional argument definitions. */
  argDefs: ArgDef[];
  /** Map of option long-name to its definition. */
  options: Map<string, OptionDef>;
  /** The action handler invoked when this command is executed. */
  action?: Action;
  /** Map of subcommand name to its definition. */
  subcommands: Map<string, CommandDefinition>;
  /** Human-readable description of the command. */
  description?: string;
  /** Excludes the command from generated help and completion. */
  hidden?: boolean;
  /** Completion provider for this command. */
  completer?: Completer;
  /** Reference to the parent command definition, if any. */
  parent?: CommandDefinition;
  /** Alternative names that can be used to invoke this command. */
  aliases?: string[];
  /** Pre-action validator. Throw to reject execution. */
  validate?: CommandValidator;
  /** Handler invoked when this command is interrupted: Ctrl-C, an aborted exec signal, or SIGTERM in the shell. */
  cancelHandler?: CancelHandler;
}

// ── Events ──

/**
 * Map of CLI lifecycle event names to their handler signatures.
 */
export interface CLIEventMap {
  /** Fired before a command action is executed. */
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  /** Fired after a command action completes successfully. */
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  /**
   * Fired when a resolved command fails during argument validation, option
   * resolution, custom validation, or its action handler.
   */
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  /**
   * Fired for any error raised while handling input, including failures that
   * occur before a command is resolved (e.g. command-not-found). Always fires
   * for command failures in addition to {@link CLIEventMap.commandError}.
   */
  error: (error: Error) => void | Promise<void>;
  /**
   * Fired at most once per CLI: after a direct-mode command completes, throws,
   * or is force-quit; after a help index is printed for an empty argv or a
   * non-TTY start; when plugin initialization fails; when the interactive shell
   * ends or receives SIGTERM; and when a force-quit ends a `CLI.exec()` call.
   * The normal `exec()` path never fires it. A process ended by a signal the
   * CLI does not handle (SIGTERM or SIGHUP in direct mode, SIGHUP in the shell)
   * runs neither this event nor cancel handlers.
   */
  exit: () => void | Promise<void>;
}

/**
 * A handler function for a specific CLI event.
 */
export type CLIEventHandler<K extends keyof CLIEventMap> = CLIEventMap[K];

// ── Context ──

/**
 * The standard streams and cancellation signal of one execution. The signal
 * travels with the streams: whoever supplies a command's I/O also supplies the
 * signal that cancels it.
 */
export interface CommandStreams {
  /** Readable stream supplied by the current execution surface, or null when none is available. */
  readonly stdin: Readable | null;
  /** Writable stream for standard output. */
  readonly stdout: Writable;
  /** Writable stream for standard error. */
  readonly stderr: Writable;
  /** Signal that is aborted when the execution is cancelled. */
  readonly signal: AbortSignal;
}

/**
 * Streams and cancellation accepted by `CLI.exec()`. Omitted members fall back
 * to no stdin, `process.stdout`, `process.stderr`, and no external signal. A
 * {@link CommandContext} is assignable, so an action can run a nested command
 * on its own streams.
 */
export type StdioOptions = Partial<CommandStreams>;

/**
 * Context passed to a command's action handler at execution time.
 */
export interface CommandContext extends CommandStreams {
  /** Parsed positional arguments keyed by argument name. This is a null-prototype record. */
  readonly args: Record<string, unknown>;
  /** Parsed options keyed by option long-name. This is a null-prototype record. */
  readonly options: Record<string, unknown>;
  /** The original raw input string. */
  readonly rawInput: string;
  /**
   * The exact argv elements when the input was an array (`start()`, or `exec()`
   * with an array); `null` when the input was a string. Unlike `rawInput`, this
   * is reversible.
   */
  readonly rawArgv: readonly string[] | null;
  /** The resolved command path (e.g. ["git", "commit"]). */
  readonly commandPath: readonly string[];
  /** The interactive shell instance, or null if running non-interactively. */
  readonly shell: Shell | null;
  /**
   * Signal that is aborted when the command is cancelled (e.g. SIGINT in the
   * interactive shell or direct mode). Async actions can pass it to
   * abort-aware APIs (`fetch`, timers, streams) or listen for `"abort"` to stop
   * cooperatively. It is the signal-based counterpart to `cli.command().cancel()`:
   * both fire on the same cancellation, so a command may use either or both.
   */
  readonly signal: AbortSignal;
}

/**
 * {@link CommandContext} with its members writable, for the router and option
 * resolver while they assemble a context.
 */
export type MutableCommandContext = { -readonly [K in keyof CommandContext]: CommandContext[K] };

/**
 * Context passed to a fallback handler invoked when no command matches the
 * input. It carries the execution's streams and signal; no command was
 * resolved, so there are no arguments or options.
 */
export interface FallbackContext extends CommandStreams {}

/**
 * Context passed to a shell mode's action. A mode never reads stdin, so only
 * the output streams and the signal are present.
 */
export type ModeContext = Pick<CommandStreams, "stdout" | "stderr" | "signal">;

/**
 * Context object passed to a plugin for extending the CLI. Its setters return
 * the context so registrations can be chained.
 */
export interface PluginContext {
  /** Registers a new command and returns its builder. */
  command(definition: string): CommandBuilder;
  /** Registers an event listener. A repeated call adds another listener. */
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  /** Removes a previously registered event listener. */
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  /** Sets the fallback handler. A repeated call replaces the previous handler. */
  fallback(handler: FallbackHandler): this;
}

/**
 * A plugin body. A synchronous plugin runs inside `use()`; an asynchronous one
 * is awaited before the first command runs.
 */
export type Plugin = (ctx: PluginContext) => void | Promise<void>;

/**
 * Context passed to a command's completion provider.
 */
export interface CompletionContext {
  /** The active pipeline segment being completed. */
  line: string;
  /** The complete input line, including earlier pipeline segments. */
  fullLine: string;
  /** The current word (token) under the cursor. */
  current: string;
  /** The resolved command path up to the current input. */
  commandPath: string[];
  /** Positional arguments parsed so far. */
  args: Record<string, unknown>;
  /** Raw option values parsed so far; coercion, defaults, and validation are not applied during completion. */
  options: Record<string, unknown>;
  /** Number of consecutive Tab presses (1-based). Resets on any other input. */
  iteration: number;
  /** Aborted when the completion deadline expires. */
  signal: AbortSignal;
}

// ── CLI Options ──

/**
 * Top-level configuration options for the CLI application. Every value is set
 * at construction only; there is no way to change it afterwards (use
 * `ctx.shell?.setPrompt()` to change the prompt of a running shell).
 */
export interface CLIOptions {
  /** The name of the CLI application. */
  name?: string;
  /** The version string displayed by --version. */
  version?: string;
  /** The interactive prompt string (e.g. "> "). */
  prompt?: string;
  /** A short description shown in the help header. */
  description?: string;
  /** Banner text displayed when the interactive shell starts. Set to "" to suppress. */
  banner?: string;
  /**
   * File path used to persist command history. A lone `~` and a leading `~/`
   * expand to the home directory. Defaults to `~/.<name>_history`. An empty
   * string or a non-string throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.
   */
  historyFile?: string;
  /**
   * Maximum number of history entries to retain. Defaults to 1000. A
   * non-number throws a `TypeError`
   * (`ERR_INVALID_ARG_TYPE`); a value that is not a non-negative safe integer
   * throws a `RangeError` (`ERR_INVALID_ARG_VALUE`).
   */
  historySize?: number;
  /**
   * Redacts or rejects a line before it is persisted to shell history. Return
   * `null` to omit sensitive commands entirely. A non-function throws a
   * `TypeError` with code `ERR_INVALID_ARG_TYPE`.
   */
  historyFilter?: HistoryFilter;
}

// ── Parse Result ──

/**
 * The result of parsing a raw command-line input string.
 */
export interface ParseResult {
  /** The resolved command path (e.g. ["git", "commit"]). */
  commandPath: string[];
  /** Parsed positional arguments keyed by argument name. */
  args: Record<string, unknown>;
  /** Parsed options keyed by option long-name. */
  options: Record<string, unknown>;
  /** Positional arguments that were not consumed by the command definition. */
  extraArgs?: string[];
  /** The original raw input string. */
  rawInput: string;
  /** Exact argv elements when parsing an argv array, `null` for string input; unlike `rawInput`, this is reversible. */
  rawArgv: readonly string[] | null;
  /** True only when the parser supplied the implicit `--help`/`-h` flag. */
  builtInHelp?: boolean;
  /** The matched command definition, if found. */
  command?: CommandDefinition;
}

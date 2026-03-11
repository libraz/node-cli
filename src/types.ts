import type { Readable, Writable } from "node:stream";
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
  /** Default value used when the option is not specified. */
  default?: unknown;
  /** Restricts the option value to one of the given choices. */
  choices?: unknown[];
  /** Custom parser that converts the raw string value into the desired type. */
  parse?: (value: string, ctx: CommandContext) => unknown;
  /** Custom validator that throws on invalid values. */
  validate?: (value: unknown, ctx: CommandContext) => void;
  /** If true, the option is hidden from help output. */
  hidden?: boolean;
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
  /** Completion provider for this command. */
  completer?: Completer;
  /** Reference to the parent command definition, if any. */
  parent?: CommandDefinition;
  /** Alternative names that can be used to invoke this command. */
  aliases?: string[];
  /** Pre-action validator. Throw to reject execution. */
  validate?: (ctx: CommandContext) => void | Promise<void>;
  /** Handler invoked when SIGINT is received during this command. */
  cancelHandler?: (ctx: CommandContext) => void;
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
  /** Fired when a command action throws an error. */
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  /** Fired when the interactive shell exits. */
  exit: () => void | Promise<void>;
}

/**
 * A handler function for a specific CLI event.
 */
export type CLIEventHandler<K extends keyof CLIEventMap> = CLIEventMap[K];

// ── Context ──

/**
 * Context passed to a command's action handler at execution time.
 */
export interface CommandContext {
  /** Parsed positional arguments keyed by argument name. */
  args: Record<string, unknown>;
  /** Parsed options keyed by option long-name. */
  options: Record<string, unknown>;
  /** The original raw input string. */
  rawInput: string;
  /** The resolved command path (e.g. ["git", "commit"]). */
  commandPath: string[];
  /** The interactive shell instance, or null if running non-interactively. */
  shell: Shell | null;
  /** Readable stream for standard input (available in piped commands). */
  stdin: Readable | null;
  /** Writable stream for standard output. */
  stdout: Writable;
  /** Writable stream for standard error. */
  stderr: Writable;
}

/**
 * Context passed to a command's completion provider.
 */
export interface CompletionContext {
  /** The full input line being completed. */
  line: string;
  /** The current word (token) under the cursor. */
  current: string;
  /** The resolved command path up to the current input. */
  commandPath: string[];
  /** Positional arguments parsed so far. */
  args: Record<string, unknown>;
  /** Options parsed so far. */
  options: Record<string, unknown>;
}

// ── CLI Options ──

/**
 * Top-level configuration options for the CLI application.
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
  /** File path used to persist command history. */
  historyFile?: string;
  /** Maximum number of history entries to retain. */
  historySize?: number;
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
  /** The original raw input string. */
  rawInput: string;
  /** The matched command definition, if found. */
  command?: CommandDefinition;
}

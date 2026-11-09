import type { Readable, Writable } from "node:stream";
import type { CommandBuilderFor } from "./command/builder.js";
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
 *
 * Passed inline to `CommandBuilder.option()`, every member is checked against
 * the flags and typed from the option's value type. A schema shared between
 * commands keeps that typing only when written with `satisfies OptionSchema`;
 * annotating it as `OptionSchema` widens the option's value to `unknown`.
 *
 * @example
 * ```ts
 * const port = { type: "number", default: 8080 } satisfies OptionSchema;
 * cli.command("serve").option("-p, --port <n>", port);
 * ```
 */
export interface OptionSchema {
  /** Human-readable description of the option. Defaults to none. */
  description?: string | undefined;
  /**
   * The expected value type of the option. Defaults to `"string"` when the
   * flags carry a value placeholder and `"boolean"` when they do not.
   */
  type?: "string" | "number" | "boolean" | "string[]" | "number[]" | undefined;
  /**
   * Extra one-character short names (`"p"` or `"-p"`). A long alias is written
   * in the flags string instead (`"--colour, --color"`). Defaults to none.
   */
  alias?: string | readonly string[] | undefined;
  /** Whether the option must be provided. Cannot be combined with `default`. Defaults to false. */
  required?: boolean | undefined;
  /**
   * Value used when the option is not specified, typed as the option's value.
   * A custom `parse` is not applied to it: a default is an already-resolved
   * value, not raw input. Without `parse` it still goes through the built-in
   * coercion of `type`, so an untyped JavaScript caller's `"8080"` on a number
   * option becomes `8080`. Defaults to `false` for a boolean option and to
   * none otherwise.
   */
  default?: unknown;
  /**
   * Restricts the option value to one of the given choices, typed as the
   * option's value (per element for an array type). The input is converted
   * first and then compared with `===`. Cannot be empty, and cannot be combined
   * with `parse` or with a boolean option. Defaults to none.
   */
  choices?: readonly unknown[] | undefined;
  /**
   * Custom parser that converts the raw string value into the option's value;
   * built-in coercion is skipped. Other options may still be unresolved, so
   * `ctx.options` is partial. A returned Promise is awaited before the action
   * runs. A thrown `CLIError` propagates unchanged, a cancellation of
   * `ctx.signal` stays a cancellation, and any other throw or rejection becomes
   * a `ValidationError` whose `value` is the raw string. Defaults to none.
   */
  parse?: ((value: string, ctx: CommandContext) => unknown) | undefined;
  /**
   * Custom validator called with the resolved value once every option is
   * resolved. It is awaited before the action runs. A thrown `CLIError`
   * propagates unchanged, a cancellation of `ctx.signal` stays a cancellation,
   * and any other throw or rejection becomes a `ValidationError`. Defaults to none.
   */
  validate?: ((value: unknown, ctx: CommandContext) => void | Promise<void>) | undefined;
  /** If true, the option is hidden from help output. Defaults to false. */
  hidden?: boolean | undefined;
  /**
   * Completion candidates for this option's value: a static list, or a
   * {@link Completer} called with the completion context. Either is filtered
   * by the word under the cursor. Takes precedence over `choices` for
   * completion. Defaults to the `choices`.
   */
  completer?: readonly string[] | Completer | undefined;
}

/**
 * Fully resolved definition of a command option, including its long flag,
 * aliases, and associated schema.
 */
export interface OptionDef {
  /** The canonical name: the first long flag, else the first short one, without dashes. */
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
 * May be synchronous or asynchronous. `A` and `O` type `ctx.args` and
 * `ctx.options`; the builder infers them from the command definition.
 */
export type Action<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> = (ctx: CommandContext<A, O>) => void | Promise<void>;

/**
 * A completion provider that returns candidates for the word under the cursor
 * (`ctx.current`). May be synchronous or asynchronous; it is cut off when
 * `ctx.signal` aborts at the completion deadline.
 */
export type Completer = (ctx: CompletionContext) => readonly string[] | Promise<readonly string[]>;

/**
 * A command-level validator run after option resolution and before the action.
 * Throw (or reject) to stop execution.
 */
export type CommandValidator<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> = (ctx: CommandContext<A, O>) => void | Promise<void>;

/**
 * A handler invoked when a running command is interrupted: Ctrl-C, an aborted
 * exec signal, or SIGTERM in the shell. It is not awaited; a rejection is
 * reported through the `error` event.
 */
export type CancelHandler<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> = (ctx: CommandContext<A, O>) => void;

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
  /** Completion candidates for this command: a static list or a provider. */
  completer?: readonly string[] | Completer;
  /** Reference to the parent command definition, if any. */
  parent?: CommandDefinition;
  /** Alternative names that can be used to invoke this command. */
  aliases?: string[];
  /** Pre-action validator. Throw to reject execution. */
  validate?: CommandValidator;
  /** Handler invoked when this command is interrupted: Ctrl-C, an aborted exec signal, or SIGTERM in the shell. */
  cancelHandler?: CancelHandler;
}

// ── Typed context ──

/** Strips spaces from both ends of a string literal. */
type Trim<S extends string> = S extends ` ${infer R}`
  ? Trim<R>
  : S extends `${infer R} `
    ? Trim<R>
    : S;

/** The camelCase tail of a dash-separated name: every part capitalized. */
type CamelTail<S extends string> = S extends `${infer Head}-${infer Rest}`
  ? `${Capitalize<Head>}${CamelTail<Rest>}`
  : Capitalize<S>;

/**
 * The `ctx.options` or `ctx.args` key of an option or argument name: split at
 * `-`, keep the first part, and capitalize the first letter of each later part
 * (`dry-run` → `dryRun`, `x-1` → `x1`, `Foo` → `Foo`).
 */
export type CamelCaseKey<S extends string> = S extends `${infer Head}-${infer Rest}`
  ? `${Head}${CamelTail<Rest>}`
  : S;

/** The positional-argument entry one definition-string token contributes. */
type ArgEntry<T extends string> = T extends `<...${infer N}>` | `[...${infer N}]`
  ? { [K in CamelCaseKey<N>]: readonly string[] }
  : T extends `<${infer N}>`
    ? { [K in CamelCaseKey<N>]: string }
    : T extends `[${infer N}]`
      ? { [K in CamelCaseKey<N>]: string | undefined }
      : Record<never, never>;

/** Accumulates the argument entries of a space-separated definition string. */
type ParseArgs<D extends string, Acc> = D extends `${infer T} ${infer Rest}`
  ? ParseArgs<Rest, Acc & ArgEntry<T>>
  : Acc & ArgEntry<D>;

/**
 * The `ctx.args` type of a command definition string: each `<x>` is a
 * `string`, `[x]` is `string | undefined`, and `<...x>` or `[...x]` is a
 * `readonly string[]`, keyed by the camelCase name. Leading path words add
 * nothing. A non-literal string gives an untyped record.
 */
export type DefinitionArgs<D extends string> = string extends D
  ? Record<string, unknown>
  : { [K in keyof ParseArgs<D, Record<never, never>>]: ParseArgs<D, Record<never, never>>[K] };

/** The flag word of one comma-separated flags part, without its placeholder. */
type FlagWord<P extends string> = Trim<P> extends `${infer W} ${string}` ? W : Trim<P>;

/** Walks the flags parts, stopping at the first `--name` and keeping the first short name. */
type ScanFlags<F extends string, Short extends string> = F extends `${infer Part},${infer Rest}`
  ? ScanPart<FlagWord<Part>, Rest, Short>
  : ScanPart<FlagWord<F>, "", Short>;

type ScanPart<
  W extends string,
  Rest extends string,
  Short extends string,
> = W extends `--${infer L}`
  ? L
  : W extends `-${infer S}`
    ? ScanFlags<Rest, [Short] extends [never] ? S : Short>
    : Rest extends ""
      ? Short
      : ScanFlags<Rest, Short>;

/**
 * The `ctx.options` key an option's flags produce: the camelCase form of the
 * first `--name`, or the first short name when there is none. A comma inside
 * a placeholder only splits the placeholder, whose pieces never start with a
 * dash.
 */
export type OptionKey<F extends string> = CamelCaseKey<ScanFlags<F, never>>;

/** Value types of the built-in `OptionSchema.type` names. */
interface OptionTypeMap {
  string: string;
  number: number;
  boolean: boolean;
  "string[]": readonly string[];
  "number[]": readonly number[];
}

/** Wraps `V` in a readonly array when `T` is an array type name. */
type ArrayOf<T, V> = T extends "string[]" | "number[]" ? readonly V[] : V;

/** Whether the flags carry a value placeholder (`<x>` or `[x]`). */
type HasPlaceholder<F extends string> = F extends
  | `${string} <${string}>${string}`
  | `${string} [${string}]${string}`
  ? true
  : false;

/**
 * The value type of an option with flags `F` whose schema has `type` `T`,
 * `choices` `C` and a `parse` returning `R` (`never` for an absent member).
 * By precedence: the elements of `choices`, the awaited return of `parse`
 * (per element for an array type), then `type`, then `string` when the flags
 * carry a placeholder and `boolean` when they do not.
 */
export type OptionValue<F extends string, T, C, R> = [C] extends [never]
  ? [R] extends [never]
    ? T extends keyof OptionTypeMap
      ? OptionTypeMap[T]
      : HasPlaceholder<F> extends true
        ? string
        : boolean
    : ArrayOf<T, Awaited<R>>
  : ArrayOf<T, C extends readonly (infer E)[] ? E : unknown>;

/** Whether an option is always present in `ctx.options`. */
type OptionPresent<S, V> = S extends { readonly required: true }
  ? true
  : "default" extends keyof S
    ? undefined extends S["default" & keyof S]
      ? false
      : true
    : [V] extends [boolean]
      ? true
      : false;

type OptionEntry<F extends string, S, V> =
  OptionPresent<S, V> extends true ? { [K in OptionKey<F>]: V } : { [K in OptionKey<F>]?: V };

/**
 * The `ctx.options` type after adding an option with flags `F`, schema `S`
 * and value type `V`. Defining the same key again replaces its entry, as it
 * replaces the option at run time. A non-literal flags string widens the
 * options to an untyped record.
 */
export type AddOption<O extends object, F extends string, S, V> = string extends F
  ? O & Record<string, unknown>
  : (OptionKey<F> extends keyof O ? Omit<O, OptionKey<F>> : O) & OptionEntry<F, S, V>;

/**
 * The widest schema `.option()` infers from. Its callbacks accept any
 * parameters so a contextually typed callback still satisfies it;
 * {@link CheckedOptionSchema} gives them their real types.
 */
export type OptionSchemaInput = Omit<OptionSchema, "parse" | "validate"> & {
  readonly parse?: ((value: string, ctx: never) => unknown) | undefined;
  readonly validate?: ((value: never, ctx: never) => void | Promise<void>) | undefined;
};

/** The {@link OptionSchema} members {@link CheckedOptionSchema} takes unchanged. */
type CheckedSchemaMembers = Pick<
  OptionSchema,
  "description" | "alias" | "required" | "hidden" | "completer"
>;

/** The `type` a typed placeholder (`<number>`, `<boolean>`) requires. */
type PlaceholderType<F extends string> = F extends
  | `${string}<number>${string}`
  | `${string}[number]${string}`
  ? "number" | "number[]"
  : F extends `${string}<boolean>${string}` | `${string}[boolean]${string}`
    ? "boolean"
    : never;

/**
 * The type each element of `choices` must have: the option's value type, never
 * for a boolean, unknown when `T` is not one known type name.
 */
type ChoiceElement<F extends string, T> = [T] extends ["number" | "number[]"]
  ? number
  : [T] extends ["string" | "string[]"]
    ? string
    : [T] extends ["boolean"]
      ? never
      : [T] extends [undefined]
        ? HasPlaceholder<F> extends true
          ? string
          : never
        : unknown;

/**
 * The rules that depend on the whole inferred schema `S`, for an option with
 * flags `F` and value type `V`: `default` against `V` and `required`, `choices`
 * against `parse` and emptiness, and a typed placeholder requiring `type`. They
 * are a separate conditional so that checking a `default` does not fix the
 * parameters `parse` is still being inferred into.
 */
type SchemaRules<F extends string, S, V> = (S extends { readonly default: infer D }
  ? S extends { readonly required: true }
    ? { readonly default: never }
    : [D] extends [V | undefined]
      ? unknown
      : { readonly default: V }
  : unknown) &
  (S extends { readonly choices: unknown }
    ? S extends { readonly parse: unknown } | { readonly choices: readonly [] }
      ? { readonly choices: never }
      : unknown
    : unknown) &
  ([PlaceholderType<F>] extends [never]
    ? unknown
    : S extends { readonly type: unknown }
      ? unknown
      : { readonly type: PlaceholderType<F> });

/**
 * The schema `.option()` accepts for flags `F` and an inferred schema `S`, on
 * a builder whose arguments and options are `A` and `O`. `T`, `C` and `R` are
 * inferred from the schema's `type`, `choices` and `parse` return, so the
 * callbacks are typed before `S` is known. It rejects at compile time what
 * `.option()` rejects at run time: `choices` of another type than the value,
 * empty, or combined with `parse` or a boolean; a `default` of another type
 * than the value; `required` with a `default`; and a typed placeholder without
 * its type. A schema typed as the wide {@link OptionSchema} passes, with an
 * `unknown` value. No member is a conditional on the inferred parameters as a
 * whole: resolving one for a contextual type would fix them before `parse`
 * has been inferred.
 */
export type CheckedOptionSchema<
  F extends string,
  S,
  A extends object,
  O extends object,
  T,
  C,
  R,
> = CheckedSchemaMembers & {
  readonly type?: T & ([PlaceholderType<F>] extends [never] ? unknown : PlaceholderType<F>);
  readonly default?: unknown;
  readonly choices?: C & readonly ChoiceElement<F, T>[];
  readonly parse?: (value: string, ctx: CommandContext<A, Partial<O>>) => R;
  readonly validate?: (
    value: NoInfer<OptionValue<F, T, C, R>>,
    ctx: CommandContext<A, O>,
  ) => void | Promise<void>;
} & SchemaRules<F, S, NoInfer<OptionValue<F, T, C, R>>>;

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
 * Streams and cancellation accepted by `CLI.exec()` and `CLI.execLine()`. Omitted members fall back
 * to no stdin, `process.stdout`, `process.stderr`, and no external signal. A
 * {@link CommandContext} is assignable, so an action can run a nested command
 * on its own streams.
 */
export type StdioOptions = { [K in keyof CommandStreams]?: CommandStreams[K] | undefined };

/**
 * Context passed to a command's action handler at execution time. `A` types
 * `args` and `O` types `options`; both default to untyped records.
 */
export interface CommandContext<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> extends CommandStreams {
  /**
   * Parsed positional arguments keyed by the camelCase argument name
   * (`<file-name>` → `fileName`). This is a null-prototype record.
   */
  readonly args: A;
  /**
   * Parsed options keyed by the camelCase form of the first long name
   * (`--dry-run` → `dryRun`), or the first short name when there is none.
   * This is a null-prototype record.
   */
  readonly options: O;
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
   * cooperatively. It is the signal-based counterpart to `cli.command().onCancel()`:
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
  /**
   * Registers a new command and returns its builder, typed from a literal
   * definition the same way as `cli.command()`.
   */
  command<D extends string>(definition: D): CommandBuilderFor<D>;
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
 * Context passed to a {@link Completer}. In a shell mode, `line` and
 * `fullLine` are the whole input line, `commandPath` is empty, and `args` and
 * `options` are empty.
 */
export interface CompletionContext {
  /** The active pipeline segment being completed. */
  readonly line: string;
  /** The complete input line, including earlier pipeline segments. */
  readonly fullLine: string;
  /** The current word (token) under the cursor; `""` at a word boundary. */
  readonly current: string;
  /** The resolved command path up to the current input. */
  readonly commandPath: readonly string[];
  /**
   * Positional arguments typed so far, keyed by their camelCase name: a raw
   * string, or an array of raw strings for a variadic argument.
   */
  readonly args: Readonly<Record<string, string | readonly string[]>>;
  /**
   * Option values typed so far, keyed like `ctx.options`, before coercion,
   * defaults and validation: a raw string for a value option, `true` or
   * `false` for a flag (or its `--no-` form), and an array of raw strings for
   * an array option.
   */
  readonly options: Readonly<Record<string, string | boolean | readonly string[]>>;
  /** Number of consecutive Tab presses (1-based). Resets on any other input. */
  readonly iteration: number;
  /** Aborted when the completion deadline expires. */
  readonly signal: AbortSignal;
}

// ── CLI Options ──

/**
 * Top-level configuration options for the CLI application. Every value is set
 * at construction only; there is no way to change it afterwards (use
 * `ctx.shell?.setPrompt()` to change the prompt of a running shell).
 */
export interface CLIOptions {
  /**
   * The name of the CLI application. Required; it titles the help output and
   * names the default history file. Must match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`:
   * a non-string throws a `TypeError` (`ERR_INVALID_ARG_TYPE`), an empty or
   * non-matching string a `RangeError` (`ERR_INVALID_ARG_VALUE`).
   */
  name: string;
  /** The version string displayed by --version. */
  version?: string | undefined;
  /** The interactive prompt string (e.g. "> "). */
  prompt?: string | undefined;
  /** A short description shown in the help header. */
  description?: string | undefined;
  /** Banner text displayed when the interactive shell starts. Set to "" to suppress. */
  banner?: string | undefined;
  /**
   * File path used to persist command history. A lone `~` and a leading `~/`
   * expand to the home directory. Defaults to `~/.<name>_history`. An empty
   * string or a non-string throws a `TypeError` with code `ERR_INVALID_ARG_TYPE`.
   */
  historyFile?: string | undefined;
  /**
   * Maximum number of history entries to retain. Defaults to 1000. A
   * non-number throws a `TypeError`
   * (`ERR_INVALID_ARG_TYPE`); a value that is not a non-negative safe integer
   * throws a `RangeError` (`ERR_INVALID_ARG_VALUE`).
   */
  historySize?: number | undefined;
  /**
   * Redacts or rejects a line before it is persisted to shell history. Return
   * `null` to omit sensitive commands entirely. A non-function throws a
   * `TypeError` with code `ERR_INVALID_ARG_TYPE`.
   */
  historyFilter?: HistoryFilter | undefined;
}

// ── Parse Result ──

/**
 * The result of parsing a raw command-line input string.
 */
export interface ParseResult {
  /** The resolved command path (e.g. ["git", "commit"]). */
  commandPath: string[];
  /** Parsed positional arguments keyed by the camelCase argument name. */
  args: Record<string, unknown>;
  /** Raw option values keyed by the camelCase option key. */
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

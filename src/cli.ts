import { homedir } from "node:os";
import { join } from "node:path";
import { CommandBuilder, type CommandBuilderFor } from "./command/builder.js";
import { CommandRegistry, visibleSubcommands } from "./command/registry.js";
import { CommandRouter, markBuiltinAction } from "./command/router.js";
import {
  CancelledError,
  CommandNotFoundError,
  describeReceived,
  formatErrorMessage,
  presentError,
  usageError,
} from "./errors.js";
import { HelpGenerator } from "./help/generator.js";
import { isTTY } from "./output/color.js";
import { isShellCommand, SHELL_COMMANDS } from "./shell/builtins.js";
import { InteractiveShell } from "./shell/repl.js";
import type {
  CLIEventMap,
  CLIOptions,
  FallbackHandler,
  HistoryFilter,
  Plugin,
  PluginContext,
  StdioOptions,
} from "./types.js";

/** Throws the usage error for one rejected argument or option, in Node's message form. */
function reject(
  kind: "type" | "range",
  name: string,
  noun: "argument" | "option",
  subject: string,
  expectation: string,
  value: unknown,
): never {
  throw usageError(
    kind,
    kind === "type" ? "ERR_INVALID_ARG_TYPE" : "ERR_INVALID_ARG_VALUE",
    `The "${name}" ${noun} of ${subject} must be ${expectation}. Received ${describeReceived(value, kind)}`,
  );
}

/** Validates an optional string option of `createCLI()`. */
function checkOptionalString(value: unknown, name: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    reject("type", name, "option", "createCLI()", "a string", value);
  }
  return value;
}

/** Rejects a callback argument that is not a function. */
function checkFunction(value: unknown, name: string, subject: string): void {
  if (typeof value !== "function") reject("type", name, "argument", subject, "a function", value);
}

/** Validates `historySize`, returning the default when it is omitted. */
function checkHistorySize(value: unknown): number {
  if (value === undefined) return 1000;
  if (typeof value !== "number") {
    reject("type", "historySize", "option", "createCLI()", "a number", value);
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    reject("range", "historySize", "option", "createCLI()", "a non-negative safe integer", value);
  }
  return value;
}

/** Validates `historyFilter`. */
function checkHistoryFilter(value: unknown): HistoryFilter | undefined {
  if (value === undefined || typeof value === "function") return value as HistoryFilter | undefined;
  return reject("type", "historyFilter", "option", "createCLI()", "a function", value);
}

/** Validates `historyFile` and expands a lone `~` or a leading `~/` or `~\` to the home directory. */
function resolveHistoryFile(value: unknown, name: string): string {
  if (value === undefined) return join(homedir(), `.${name}_history`);
  if (typeof value !== "string" || value === "") {
    reject("type", "historyFile", "option", "createCLI()", "a non-empty string", value);
  }
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

/** Rejects argv that is not a string array, before any of it is executed. */
function checkArgv(value: unknown, subject: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    reject("type", "argv", "argument", subject, "an array of strings", value);
  }
}

/** Rejects a command line that is not a string, before any of it is executed. */
function checkLine(value: unknown): void {
  if (typeof value !== "string") {
    reject("type", "line", "argument", "cli.execLine()", "a string", value);
  }
}

/** Rejects stream and signal options of the wrong shape, before anything is executed. */
function checkStdioOptions(options: unknown, subject: string): void {
  if (options === undefined) return;
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    reject("type", "options", "argument", subject, "an object", options);
  }
  const { stdin, stdout, stderr, signal } = options as Record<string, unknown>;
  if (stdin !== undefined && stdin !== null && !hasMethod(stdin, "on")) {
    reject("type", "stdin", "option", subject, "a readable stream or null", stdin);
  }
  for (const [name, value] of [
    ["stdout", stdout],
    ["stderr", stderr],
  ] as const) {
    if (value !== undefined && !hasMethod(value, "write")) {
      reject("type", name, "option", subject, "a writable stream", value);
    }
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    reject("type", "signal", "option", subject, "an AbortSignal", signal);
  }
}

/** True when `value` is an object with a method of that name. */
function hasMethod(value: unknown, name: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[name] === "function"
  );
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Validates the application `name`, which names the help header and the history file. */
function checkName(value: unknown): string {
  if (typeof value !== "string") reject("type", "name", "option", "createCLI()", "a string", value);
  if (!NAME_PATTERN.test(value)) {
    reject("range", "name", "option", "createCLI()", `a string matching ${NAME_PATTERN}`, value);
  }
  return value;
}

/** The exit code the process would end with now. */
function currentExitCode(): number {
  return Number(process.exitCode ?? 0);
}

/**
 * Main CLI application class that manages command registration,
 * routing, and execution in both direct and interactive shell modes.
 */
export class CLI {
  private readonly registry: CommandRegistry;
  private readonly router: CommandRouter;
  private readonly helpGenerator: HelpGenerator;
  private readonly name: string;
  private readonly version?: string;
  private readonly promptStr: string;
  private readonly bannerStr?: string;
  private readonly historyFile: string;
  private readonly historySizeLimit: number;
  private readonly historyFilterFn?: HistoryFilter;
  private started = false;
  private readonly pendingPlugins: Promise<void>[] = [];
  /** Asynchronous plugins not yet settled; a synchronous plugin runs inline only when this is 0. */
  private pluginsInFlight = 0;
  /** Serializes plugin bodies so async registration preserves use() order. */
  private pluginTail: Promise<void> = Promise.resolve();
  private pluginInitialization?: Promise<void>;
  private pluginInitializationError?: unknown;
  // A separate flag rather than testing `pluginInitializationError !== undefined`:
  // a plugin can reject with `undefined`, which is indistinguishable from "no
  // error" and would otherwise let a failure vanish on the second call.
  private pluginInitializationFailed = false;

  /**
   * Creates a new CLI instance. Use {@link createCLI}; the class is exported as
   * a type only.
   * @param options - Configuration options for the CLI application.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a non-object `options`, a
   *   non-string `name`, `version`, `prompt`, `description` or `banner`, a
   *   non-number `historySize`, a non-function `historyFilter`, or an empty or
   *   non-string `historyFile`.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `name` is empty or does
   *   not match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, or `historySize` is not a
   *   non-negative safe integer.
   */
  constructor(options: CLIOptions) {
    if (typeof options !== "object" || options === null) {
      reject("type", "options", "argument", "createCLI()", "an object", options);
    }
    this.name = checkName(options.name);
    this.version = checkOptionalString(options.version, "version");
    this.promptStr = checkOptionalString(options.prompt, "prompt") ?? "> ";
    const description = checkOptionalString(options.description, "description");
    this.bannerStr = checkOptionalString(options.banner, "banner");
    this.historyFile = resolveHistoryFile(options.historyFile, this.name);
    this.historySizeLimit = checkHistorySize(options.historySize);
    this.historyFilterFn = checkHistoryFilter(options.historyFilter);

    this.registry = new CommandRegistry();
    this.router = new CommandRouter(this.registry);
    this.helpGenerator = new HelpGenerator(this.registry, {
      name: this.name,
      version: this.version,
      description,
    });
    this.router.setHelpGenerator(this.helpGenerator);
    this.router.setVersion(this.version);

    // Register built-in help command
    this.registerHelpCommand();
  }

  /**
   * Registers a command with the given definition string and returns its
   * builder. A literal definition types `ctx.args` from its argument tokens.
   * The same path merges into the existing command: later declarations add to
   * or replace earlier ones, and the returned builder types only what is
   * declared through it.
   * @param definition - The command definition: the command path, then its
   *   arguments (`<x>` required, `[x]` optional, `<...x>` variadic). Each name
   *   is ASCII letters and digits in parts joined by single dashes.
   * @returns A CommandBuilder instance for further configuration.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `definition` is not a string.
   * @throws {Error} `ERR_INVALID_DEFINITION` for a malformed definition or a
   *   command or argument name outside the name rule.
   * @example
   * ```ts
   * cli.command("greet <name> [title]").action((ctx) => {
   *   ctx.stdout.write(`Hello, ${ctx.args.title ?? ""} ${ctx.args.name}\n`);
   * });
   * ```
   */
  command<D extends string>(definition: D): CommandBuilderFor<D> {
    return CommandBuilder.create(this.registry, definition);
  }

  /**
   * Registers an event listener for a lifecycle event. A repeated call adds
   * another listener.
   * @param event - One of `beforeExecute`, `afterExecute`, `commandError`,
   *   `error` or `exit`.
   * @param handler - The handler function.
   * @returns The CLI instance for method chaining.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an unknown event name.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `handler` is not a function.
   */
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this {
    this.router.on(event, handler);
    return this;
  }

  /**
   * Removes an event listener for a lifecycle event.
   * @param event - One of the event names {@link CLI.on} accepts.
   * @param handler - The handler function to remove.
   * @returns The CLI instance for method chaining.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` for an unknown event name.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `handler` is not a function.
   */
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this {
    this.router.off(event, handler);
    return this;
  }

  /**
   * Sets the fallback handler invoked when no command matches the input. A
   * repeated call replaces the previous handler.
   * @param handler - The fallback handler function.
   * @returns The CLI instance for method chaining.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `handler` is not a function.
   */
  fallback(handler: FallbackHandler): this {
    checkFunction(handler, "handler", "cli.fallback()");
    this.router.setCatchHandler(handler);
    return this;
  }

  /**
   * Registers a plugin that receives a context object for extending the CLI.
   *
   * When no earlier asynchronous plugin is still pending, the plugin body runs
   * inside this call, and a synchronous throw propagates to the caller as is.
   * Registrations made before the throw stay in place, and the instance remains
   * usable. A body that returns a promise, or one registered behind a pending
   * plugin, is queued and awaited before the first command runs. An
   * asynchronous failure is wrapped once in an `Error` with code
   * `ERR_PLUGIN_FAILED` and the original value as `cause`, fires `error` once,
   * and every later `start()`, `exec()`, `execLine()` and `use()` fails with
   * that same error.
   * @param plugin - A function that receives a PluginContext and may register commands, events, etc.
   * @returns The CLI instance for method chaining.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `plugin` is not a function.
   * @throws {Error} `ERR_PLUGIN_FAILED` after an asynchronous plugin has failed.
   */
  use(plugin: Plugin): this {
    checkFunction(plugin, "plugin", "cli.use()");
    if (this.pluginInitializationFailed) throw this.pluginInitializationError;
    const context: PluginContext = {
      command: (definition) => this.command(definition),
      on: (event, handler) => {
        this.on(event, handler);
        return context;
      },
      off: (event, handler) => {
        this.off(event, handler);
        return context;
      },
      fallback: (handler) => {
        this.fallback(handler);
        return context;
      },
    };
    if (this.pluginsInFlight === 0) {
      const result = plugin(context);
      if (result !== undefined) this.trackPlugin(Promise.resolve(result));
      return this;
    }
    // Queue behind the pending plugins so registration order stays
    // deterministic even when an earlier plugin awaits I/O.
    this.trackPlugin(this.pluginTail.then(() => plugin(context)));
    return this;
  }

  /** Queues an asynchronous plugin body for {@link drainPendingPlugins}. */
  private trackPlugin(result: Promise<void>): void {
    this.pluginTail = result;
    this.pendingPlugins.push(result);
    this.pluginsInFlight++;
    const settle = () => {
      this.pluginsInFlight--;
    };
    // A consumer may never start/exec this CLI. Mark the rejection handled here;
    // drainPendingPlugins still observes and reports the original failure.
    result.then(settle, settle);
  }

  /**
   * Awaits any pending asynchronous plugins registered via {@link use}, so that
   * async plugin registration completes before any command runs.
   */
  private async drainPendingPlugins(): Promise<void> {
    if (this.pluginInitializationFailed) throw this.pluginInitializationError;
    if (!this.pluginInitialization) {
      this.pluginInitialization = (async () => {
        while (this.pendingPlugins.length > 0) {
          const pending = this.pendingPlugins.splice(0, this.pendingPlugins.length);
          const results = await Promise.allSettled(pending);
          const failure = results.find((result) => result.status === "rejected");
          if (failure) throw (failure as PromiseRejectedResult).reason;
        }
      })()
        .catch(async (cause: unknown) => {
          const failure = usageError(
            "state",
            "ERR_PLUGIN_FAILED",
            `Plugin initialization failed: ${formatErrorMessage(cause)}`,
            { cause },
          );
          this.pluginInitializationError = failure;
          this.pluginInitializationFailed = true;
          await this.router.emit("error", failure);
          throw failure;
        })
        .finally(() => {
          // Keep the (rejected) promise cached on failure so the sticky error is
          // re-surfaced; only clear it after a clean drain so a later use()+drain
          // can retry.
          if (!this.pluginInitializationFailed) this.pluginInitialization = undefined;
        });
    }
    await this.pluginInitialization;
  }

  /**
   * Programmatically executes a command from argv, as if typed by the user. The
   * elements are used as is: nothing is tokenized and `|` is an ordinary
   * character, so untrusted data belongs here rather than in a command line
   * for {@link CLI.execLine}. A leading `"--"` ends the options before the
   * command and is removed once before the command is resolved, so
   * `exec(["--", "greet", "x"])` runs `greet x`. An argv with no command left
   * (`[]`, only empty strings, or a lone `"--"`) resolves without doing
   * anything, even with a fallback. A failure rejects the returned promise.
   *
   * Cancellation goes through `options.signal` only; the process's SIGINT is
   * left to the host. An already-aborted signal rejects before anything runs,
   * including pending plugins. A command cancelled while it runs rejects with
   * `CancelledError` and fires neither `commandError` nor `error`; one that
   * ignores the abort and finishes resolves.
   * @param argv - The argv elements: the command path, then its arguments.
   * @param options - Optional input/output streams and cancellation signal.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `argv` is not an array of
   *   strings (a command line string goes to `execLine`), or a stream or the
   *   signal in `options` has the wrong type.
   * @throws {CancelledError} `CANCELLED` when the signal aborts the execution.
   * @example
   * ```ts
   * await cli.exec(["deploy", userInput, "--force"]);
   * ```
   */
  async exec(argv: readonly string[], options: StdioOptions = {}): Promise<void> {
    checkArgv(argv, "cli.exec()");
    checkStdioOptions(options, "cli.exec()");
    await this.run(argv, options);
  }

  /**
   * Programmatically executes a shell-language command line, as if typed at
   * the prompt: the line is tokenized (single quotes, double quotes and
   * backslashes) and split at `|` into a pipeline. A leading `--` is removed
   * once before the command is resolved, and a line with no command left (`""`
   * or `"--"`) resolves without doing anything, even with a fallback. A
   * failure rejects the returned promise. Untrusted data must not
   * be interpolated into the line (a `|` in it starts another command); pass
   * it through `exec([...])` instead. Cancellation behaves as for
   * {@link CLI.exec}; every stage of a pipeline shares the signal.
   * @param line - The command line.
   * @param options - Optional input/output streams and cancellation signal.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `line` is not a string, or
   *   a stream or the signal in `options` has the wrong type.
   * @throws {ParseError} `PARSE_FAILED` for an unclosed quote, an empty or
   *   trailing pipe segment, or a standalone `<`/`>` redirection operator,
   *   unless a fallback handler takes the line.
   * @throws {CancelledError} `CANCELLED` when the signal aborts the execution.
   * @example
   * ```ts
   * await cli.execLine('greet "Ada Lovelace" | upper');
   * ```
   */
  async execLine(line: string, options: StdioOptions = {}): Promise<void> {
    checkLine(line);
    checkStdioOptions(options, "cli.execLine()");
    await this.run(line, options);
  }

  private async run(input: string | readonly string[], options: StdioOptions): Promise<void> {
    const { stdin = null, stdout = process.stdout, stderr = process.stderr, signal } = options;
    if (signal?.aborted) throw new CancelledError({ cause: signal.reason });
    await this.drainPendingPlugins();
    await this.router.execute(input, { stdin, stdout, stderr, signal });
  }

  /**
   * Starts the CLI application. Non-empty argv runs in direct CLI mode. Empty
   * argv opens the interactive shell when both stdin and stdout are TTYs, and
   * otherwise prints the help index. Errors are reported to stderr rather than
   * rejected.
   * @param argv - Command-line arguments. Defaults to `process.argv.slice(2)`.
   * @returns The code the process will exit with: the failure's code after a
   *   failed or interrupted direct-mode command (which is also set on
   *   `process.exitCode`), otherwise the current `process.exitCode` (0 when
   *   unset). A successful command leaves `process.exitCode` unchanged.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `argv` is not an array of strings.
   * @throws {Error} `ERR_ALREADY_STARTED` when called a second time.
   * @example
   * ```ts
   * await createCLI({ name: "mytool" }).start();
   * ```
   */
  async start(argv?: readonly string[]): Promise<number> {
    if (argv !== undefined) checkArgv(argv, "cli.start()");
    if (this.started) {
      throw usageError(
        "state",
        "ERR_ALREADY_STARTED",
        "CLI.start() has already been called on this instance",
      );
    }
    this.started = true;

    // Await any async plugins before running and report initialization failures
    // through the same user-facing boundary as command failures.
    try {
      await this.drainPendingPlugins();
    } catch (err) {
      this.reportFatal(err);
      await this.router.emitExit();
      return currentExitCode();
    }

    const args = argv ?? process.argv.slice(2);
    // An explicitly supplied empty argument or a bare end-of-options marker has
    // no command to execute. Show the index instead of silently succeeding (or
    // unexpectedly starting a REPL when attached to a terminal). Empty strings
    // are skipped for this check only: an empty string is a legitimate argument
    // value, so the arguments handed to the router stay exactly as supplied.
    const named = args.filter((arg) => arg !== "");
    if (args.length > 0 && (named.length === 0 || (named.length === 1 && named[0] === "--"))) {
      process.stdout.write(`${this.helpGenerator.generateIndex()}\n`);
      await this.router.emitExit();
      return currentExitCode();
    }

    if (args.length > 0) {
      // Direct CLI mode. Route SIGINT to the running command's cancel handler so
      // Ctrl-C cleanup (e.g. removing a lock file) works the same as in the REPL.
      let interrupted = false;
      try {
        interrupted = await this.router.runWithSigintCancel(
          async () => {
            await this.router.execute(args, {
              stdin: process.stdin,
              stdout: process.stdout,
              stderr: process.stderr,
            });
          },
          {
            onInterrupt: () => {
              interrupted = this.router.triggerCancel();
              return interrupted;
            },
          },
        );
        if (interrupted) process.exitCode = 130;
      } catch (err) {
        this.reportFatal(err, interrupted);
      } finally {
        await this.router.emitExit();
      }
    } else if (isTTY(process.stdin) && isTTY(process.stdout)) {
      // Interactive shell mode
      const banner = this.bannerStr ?? (this.version ? `${this.name} v${this.version}` : this.name);

      const shell = new InteractiveShell({
        router: this.router,
        registry: this.registry,
        prompt: this.promptStr,
        banner,
        historyFile: this.historyFile,
        historySize: this.historySizeLimit,
        historyFilter: this.historyFilterFn,
        version: this.version,
        beforeExecute: () => this.drainPendingPlugins(),
      });

      await shell.start();
    } else {
      // No arguments and either standard stream is not a terminal (e.g. piped
      // input or redirected output): avoid an interactive REPL and print help.
      process.stdout.write(`${this.helpGenerator.generateIndex()}\n`);
      await this.router.emitExit();
    }
    return currentExitCode();
  }

  /**
   * Reports a fatal error to stderr and applies the exit code it implies. The
   * direct CLI path owns the process, so unlike the interactive shell it acts on
   * the code the presenter returns and opts into `NODE_CLI_DEBUG` stacks.
   */
  private reportFatal(err: unknown, interrupted = false): void {
    process.exitCode = presentError(err, {
      stream: process.stderr,
      interrupted,
      debugStack: true,
    });
  }

  private registerHelpCommand(): void {
    const helpGenerator = this.helpGenerator;
    const registry = this.registry;

    CommandBuilder.create(this.registry, "help [...command]")
      .description("Show help information")
      .completer(({ args, current }) => {
        const path = (args.command as string[] | undefined) ?? [];
        const parentPath = current ? path.slice(0, -1) : path;
        // Resolve the parent the way dispatch and the help action do, so nothing
        // is offered beneath a command whose arguments shadow its subcommands.
        const match = parentPath.length === 0 ? undefined : registry.matchCommandPath(parentPath);
        if (parentPath.length > 0 && match?.consumed !== parentPath.length) return [];
        const commands = match ? visibleSubcommands(match.command) : registry.visibleTopLevel();
        const names = commands.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
        // At the top level, offer the shell's own commands too: the help footer
        // advertises them, so completion must be able to reach them.
        if (!match) {
          names.push(...SHELL_COMMANDS.filter((name) => !registry.resolve([name])));
        }
        return names.filter((name) => name.startsWith(current));
      })
      .action(
        markBuiltinAction((ctx) => {
          const commandParts = ctx.args.command as string[] | undefined;
          const interactive = ctx.shell != null;

          if (!commandParts || commandParts.length === 0) {
            ctx.stdout.write(`${helpGenerator.generateIndex({ interactive })}\n`);
            return;
          }

          // Resolve the way dispatch would, so help never renders a page for a
          // subcommand the parser could not reach, and report a miss the way the
          // router does: the deepest match's canonical path plus the first
          // unmatched word, with the commands visible there. The shell's own
          // commands have no registry entry, yet the shell's help footer
          // advertises them, so they resolve there and only there.
          const match = registry.matchCommandPath(commandParts);
          const shellCommand =
            interactive && commandParts.length === 1 && isShellCommand(commandParts[0]);
          if (match?.consumed !== commandParts.length && !shellCommand) {
            const consumed = match?.consumed ?? 0;
            const parent = match ? registry.getCommandPath(match.command) : [];
            const visible = match ? visibleSubcommands(match.command) : registry.visibleTopLevel();
            const available = visible.map((command) => command.name).sort();
            throw new CommandNotFoundError(
              [...parent, commandParts[consumed]].join(" "),
              available.length > 0 ? { available } : {},
            );
          }

          ctx.stdout.write(`${helpGenerator.generateCommand(commandParts, { interactive })}\n`);
        }),
      );
  }
}

/**
 * Factory function that creates and returns a new CLI instance.
 * @param options - Configuration options for the CLI application; `name` is required.
 * @returns A new CLI instance.
 * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a non-object `options`, a
 *   non-string `name`, `version`, `prompt`, `description` or `banner`, a
 *   non-number `historySize`, a non-function `historyFilter`, or an empty or
 *   non-string `historyFile`.
 * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `name` is empty or does not
 *   match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, or `historySize` is not a
 *   non-negative safe integer.
 * @example
 * ```ts
 * const cli = createCLI({ name: "mytool", version: "1.0.0" });
 * ```
 */
export function createCLI(options: CLIOptions): CLI {
  return new CLI(options);
}

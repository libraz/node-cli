import { homedir } from "node:os";
import { join } from "node:path";
import { CommandBuilder, type CommandBuilderFor } from "./command/builder.js";
import { CommandRegistry, visibleSubcommands } from "./command/registry.js";
import { CommandRouter } from "./command/router.js";
import { CommandNotFoundError, presentError, usageError } from "./errors.js";
import { HelpGenerator } from "./help/generator.js";
import { streamIsTTY } from "./output/color.js";
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

/** Validates `historySize`, returning the default when it is omitted. */
function checkHistorySize(value: unknown): number {
  if (value === undefined) return 1000;
  if (typeof value !== "number") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "historySize" option must be a number. Received ${describeValue(value)}`,
    );
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw usageError(
      "range",
      "ERR_INVALID_ARG_VALUE",
      `The "historySize" option must be a non-negative safe integer. Received ${value}`,
    );
  }
  return value;
}

/** Validates `historyFilter`. */
function checkHistoryFilter(value: unknown): HistoryFilter | undefined {
  if (value === undefined || typeof value === "function") return value as HistoryFilter | undefined;
  throw usageError(
    "type",
    "ERR_INVALID_ARG_TYPE",
    `The "historyFilter" option must be a function. Received ${describeValue(value)}`,
  );
}

/** Validates `historyFile` and expands a lone `~` or a leading `~/` to the home directory. */
function resolveHistoryFile(value: unknown, name: string): string {
  if (value === undefined) return join(homedir(), `.${name}_history`);
  if (typeof value !== "string" || value === "") {
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "historyFile" option must be a non-empty string. Received ${describeValue(value)}`,
    );
  }
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

/** Rejects argv that is not a string array, before any of it is executed. */
function checkArgv(name: string, value: unknown, allowString: boolean): void {
  const valid =
    (allowString && typeof value === "string") ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"));
  if (!valid) {
    const expected = allowString ? "a string or an array of strings" : "an array of strings";
    throw usageError(
      "type",
      "ERR_INVALID_ARG_TYPE",
      `The "${name}" argument must be ${expected}. Received ${describeValue(value)}`,
    );
  }
}

/** Renders a rejected value for an error message. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array with a non-string element";
  if (typeof value === "string") return value === "" ? "an empty string" : "type string";
  return `type ${typeof value}`;
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
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` for a non-number `historySize`,
   *   a non-function `historyFilter`, or an empty or non-string `historyFile`.
   * @throws {RangeError} `ERR_INVALID_ARG_VALUE` when `historySize` is not a
   *   non-negative safe integer.
   */
  constructor(options: CLIOptions = {}) {
    this.name = options.name ?? "cli";
    this.version = options.version;
    this.promptStr = options.prompt ?? "> ";
    this.bannerStr = options.banner;
    this.historyFile = resolveHistoryFile(options.historyFile, this.name);
    this.historySizeLimit = checkHistorySize(options.historySize);
    this.historyFilterFn = checkHistoryFilter(options.historyFilter);

    this.registry = new CommandRegistry();
    this.router = new CommandRouter(this.registry);
    this.helpGenerator = new HelpGenerator(this.registry, {
      name: this.name,
      version: this.version,
      description: options.description,
    });
    this.router.setHelpGenerator(this.helpGenerator);
    this.router.setVersion(this.version);

    // Register built-in help command
    this.registerHelpCommand();
  }

  /**
   * Registers a new command with the given definition string. A literal
   * definition types `ctx.args` from its argument tokens.
   * @param definition - The command definition (e.g., "greet <name> [title]").
   * @returns A CommandBuilder instance for further configuration.
   */
  command<D extends string>(definition: D): CommandBuilderFor<D> {
    return CommandBuilder.create(this.registry, definition);
  }

  /**
   * Registers an event listener for a lifecycle event.
   * @param event - The event name (e.g., "beforeExecute", "afterExecute", "commandError", "exit").
   * @param handler - The handler function.
   * @returns The CLI instance for method chaining.
   */
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this {
    this.router.on(event, handler);
    return this;
  }

  /**
   * Removes an event listener for a lifecycle event.
   * @param event - The event name.
   * @param handler - The handler function to remove.
   * @returns The CLI instance for method chaining.
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
   */
  fallback(handler: FallbackHandler): this {
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
   * plugin, is queued and awaited before the first command runs; an
   * asynchronous failure makes every later `start()`, `exec()` and `use()` fail.
   * @param plugin - A function that receives a PluginContext and may register commands, events, etc.
   * @returns The CLI instance for method chaining.
   */
  use(plugin: Plugin): this {
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
        .catch((error) => {
          this.pluginInitializationError = error;
          this.pluginInitializationFailed = true;
          throw error;
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
   * Programmatically executes a command as if typed by the user. A string is
   * tokenized and split at pipes; an array is used as argv as is. `""` and `[]`
   * resolve without doing anything. A failure rejects the returned promise.
   * @param input - The command string, or argv elements.
   * @param options - Optional input/output streams and cancellation signal.
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `input` is neither a string
   *   nor an array of strings.
   */
  async exec(input: string | readonly string[], options: StdioOptions = {}): Promise<void> {
    checkArgv("input", input, true);
    await this.drainPendingPlugins();
    const { stdin = null, stdout = process.stdout, stderr = process.stderr, signal } = options;
    await this.router.runWithSigintCancel(async () => {
      await this.router.execute(input, { stdin, stdout, stderr, signal });
    });
  }

  /**
   * Starts the CLI application. Non-empty argv runs in direct CLI mode. Empty
   * argv opens the interactive shell when both stdin and stdout are TTYs, and
   * otherwise prints the help index. Errors are reported to stderr rather than
   * rejected.
   * @param argv - Command-line arguments. Defaults to `process.argv.slice(2)`.
   * @returns The exit code, which is also set on `process.exitCode`. After an
   *   interactive session, the value `process.exitCode` holds then (0 if unset).
   * @throws {TypeError} `ERR_INVALID_ARG_TYPE` when `argv` is not an array of strings.
   * @throws {Error} `ERR_ALREADY_STARTED` when called a second time.
   */
  async start(argv?: readonly string[]): Promise<number> {
    if (argv !== undefined) checkArgv("argv", argv, false);
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
    } else if (streamIsTTY(process.stdin) && streamIsTTY(process.stdout)) {
      // Interactive shell mode
      let banner: string;
      if (this.bannerStr !== undefined) {
        banner = this.bannerStr;
      } else if (this.name) {
        banner = this.version ? `${this.name} v${this.version}` : this.name;
      } else {
        banner = "";
      }

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
      .action((ctx) => {
        const commandParts = ctx.args.command as string[] | undefined;

        if (!commandParts || commandParts.length === 0) {
          ctx.stdout.write(`${helpGenerator.generateIndex()}\n`);
          return;
        }

        // Unknown target: report on stderr with a non-zero exit, matching how a
        // bare unrecognized command is surfaced (not a silent stdout + exit 0).
        // The path is resolved the way dispatch would, so help never renders a
        // page for a subcommand the parser could not reach. The shell's own
        // commands have no registry entry, yet the generated help footer
        // advertises them, so they must resolve here too.
        const match = registry.matchCommandPath(commandParts);
        if (
          match?.consumed !== commandParts.length &&
          !(commandParts.length === 1 && isShellCommand(commandParts[0]))
        ) {
          throw new CommandNotFoundError(commandParts.join(" "));
        }

        ctx.stdout.write(`${helpGenerator.generateCommand(commandParts)}\n`);
      });
  }
}

/**
 * Factory function that creates and returns a new CLI instance.
 * @param options - Optional configuration options for the CLI application.
 * @returns A new CLI instance.
 */
export function createCLI(options?: CLIOptions): CLI {
  return new CLI(options);
}

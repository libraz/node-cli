import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { CommandBuilder } from "./command/builder.js";
import { CommandRegistry, visibleSubcommands } from "./command/registry.js";
import { CommandRouter } from "./command/router.js";
import { CommandNotFoundError, presentError } from "./errors.js";
import { HelpGenerator } from "./help/generator.js";
import { streamIsTTY } from "./output/color.js";
import { isShellCommand, SHELL_COMMANDS } from "./shell/builtins.js";
import { InteractiveShell } from "./shell/repl.js";
import type { CatchContext, CLIEventMap, CLIOptions } from "./types.js";

/**
 * Context object passed to plugins for extending the CLI.
 */
export interface PluginContext {
  /** Register a new command. */
  command: (definition: string) => CommandBuilder;
  /** Register an event listener. */
  on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  /** Remove a previously registered event listener. */
  off: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  /** Register a fallback handler invoked when no command matches the input. */
  catch: (handler: (input: string, ctx: CatchContext) => void | Promise<void>) => void;
}

/** Streams and cancellation supplied to a programmatic execution. */
export interface ExecOptions {
  stdin?: Readable | null;
  stdout?: Writable;
  stderr?: Writable;
  signal?: AbortSignal;
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
  private promptStr: string;
  private descriptionStr?: string;
  private bannerStr?: string;
  private historyFile: string;
  private historySizeLimit: number;
  private historyFilterFn?: (line: string) => string | null;
  private started = false;
  private readonly pendingPlugins: Promise<void>[] = [];
  /** Serializes plugin bodies so async registration preserves use() order. */
  private pluginTail: Promise<void> = Promise.resolve();
  private pluginInitialization?: Promise<void>;
  private pluginInitializationError?: unknown;
  // A separate flag rather than testing `pluginInitializationError !== undefined`:
  // a plugin can reject with `undefined`, which is indistinguishable from "no
  // error" and would otherwise let a failure vanish on the second call.
  private pluginInitializationFailed = false;

  /**
   * Creates a new CLI instance.
   * @param options - Configuration options for the CLI application.
   */
  constructor(options: CLIOptions = {}) {
    this.name = options.name ?? "cli";
    this.version = options.version;
    this.promptStr = options.prompt ?? "> ";
    this.descriptionStr = options.description;
    this.bannerStr = options.banner;
    this.historyFile = options.historyFile ?? join(homedir(), `.${this.name}_history`);
    this.historySizeLimit = options.historySize ?? 1000;
    this.historyFilterFn = options.historyFilter;

    this.registry = new CommandRegistry();
    this.router = new CommandRouter(this.registry);
    this.helpGenerator = new HelpGenerator(this.registry, {
      name: this.name,
      version: this.version,
      description: this.descriptionStr,
    });
    this.router.setHelpGenerator(this.helpGenerator);
    this.router.setVersion(this.version);

    // Register built-in help command
    this.registerHelpCommand();
  }

  /**
   * Registers a new command with the given definition string.
   * @param definition - The command definition (e.g., "greet <name> [title]").
   * @returns A CommandBuilder instance for further configuration.
   */
  command(definition: string): CommandBuilder {
    return CommandBuilder.create(this.registry, definition);
  }

  /**
   * Sets the prompt string displayed in interactive shell mode.
   * @param text - The prompt text to display.
   * @returns The CLI instance for method chaining.
   */
  prompt(text: string): this {
    this.promptStr = text;
    return this;
  }

  /**
   * Sets the description displayed in the help header.
   * @param text - The description text.
   * @returns The CLI instance for method chaining.
   */
  description(text: string): this {
    this.descriptionStr = text;
    this.helpGenerator.setMetadata({
      name: this.name,
      version: this.version,
      description: this.descriptionStr,
    });
    return this;
  }

  /**
   * Sets the banner text displayed when the interactive shell starts.
   * Pass an empty string to suppress the banner entirely.
   * @param text - The banner text.
   * @returns The CLI instance for method chaining.
   */
  banner(text: string): this {
    this.bannerStr = text;
    return this;
  }

  /**
   * Sets the file path for storing command history in interactive mode.
   * @param filePath - The path to the history file.
   * @returns The CLI instance for method chaining.
   */
  history(filePath: string): this {
    this.historyFile = filePath;
    return this;
  }

  /**
   * Sets the maximum number of interactive history entries to retain.
   * @param size - Maximum retained entries.
   * @returns The CLI instance for method chaining.
   */
  historySize(size: number): this {
    this.historySizeLimit = size;
    return this;
  }

  /**
   * Sets a filter that can redact or omit lines before shell history is saved.
   * Return `null` to omit a line entirely.
   */
  historyFilter(filter: (line: string) => string | null): this {
    this.historyFilterFn = filter;
    return this;
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
   * Sets a catch/fallback handler invoked when no command matches the input.
   * @param handler - The fallback handler function.
   * @returns The CLI instance for method chaining.
   */
  catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): this {
    this.router.setCatchHandler(handler);
    return this;
  }

  /**
   * Registers a plugin that receives a context object for extending the CLI.
   * @param plugin - A function that receives a PluginContext and may register commands, events, etc.
   * @returns The CLI instance for method chaining.
   */
  use(plugin: (ctx: PluginContext) => void | Promise<void>): this {
    if (this.pluginInitializationFailed) throw this.pluginInitializationError;
    const context: PluginContext = {
      command: (definition: string) => this.command(definition),
      on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => {
        this.on(event, handler);
      },
      off: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => {
        this.off(event, handler);
      },
      catch: (handler) => {
        this.catch(handler);
      },
    };
    // Invoke plugin bodies through one serial queue. This makes registration
    // order deterministic even when an earlier plugin awaits I/O, and turns a
    // synchronous throw into the same initialization failure path as a rejected
    // async plugin.
    const result = this.pluginTail.then(() => plugin(context));
    this.pluginTail = result;
    this.pendingPlugins.push(result);
    // A consumer may never start/exec this CLI. Mark the rejection handled here;
    // drainPendingPlugins still observes and reports the original failure.
    result.catch(() => {});
    return this;
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
   * Programmatically executes a command as if typed by the user.
   * @param input - The command string to execute.
   * @param options - Optional input/output streams and cancellation signal.
   */
  async exec(input: string, options: ExecOptions = {}): Promise<void> {
    await this.drainPendingPlugins();
    const { stdin = null, stdout = process.stdout, stderr = process.stderr, signal } = options;
    await this.router.runWithSigintCancel(async () => {
      await this.router.execute(input, { stdin, stdout, stderr, signal });
    });
  }

  /**
   * Starts the CLI application. If arguments are provided (or found in process.argv),
   * runs in direct CLI mode. Otherwise, starts an interactive shell session.
   * @param argv - Optional array of command-line arguments. Defaults to process.argv.slice(2).
   */
  async start(argv?: string[]): Promise<void> {
    if (this.started) {
      throw new Error("CLI.start() has already been called on this instance");
    }
    this.started = true;

    // Await any async plugins before running and report initialization failures
    // through the same user-facing boundary as command failures.
    try {
      await this.drainPendingPlugins();
    } catch (err) {
      this.reportFatal(err);
      await this.router.emitExit();
      return;
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
      return;
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
      .complete(({ args, current }) => {
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

import { PassThrough, type Readable, type Writable } from "node:stream";
import { CommandNotFoundError, ExtraArgumentError, MissingArgumentError } from "../errors.js";
import { formatUsage, type HelpGenerator } from "../help/generator.js";
import { resolveOptions } from "../option/resolver.js";
import type { Shell } from "../shell/repl.js";
import type { CatchContext, CLIEventMap, CommandContext, CommandDefinition } from "../types.js";
import { parse, splitPipes, tokenize } from "./parser.js";
import type { CommandRegistry } from "./registry.js";

/** Typed event listener store. */
type EventListeners = {
  [K in keyof CLIEventMap]: CLIEventMap[K][];
};

/**
 * Routes parsed CLI input to the appropriate command action.
 *
 * Handles command resolution, argument validation, option resolution,
 * event emission, and automatic help display for commands without an action or when `--help` is passed.
 */
export class CommandRouter {
  private readonly registry: CommandRegistry;
  private helpGenerator?: HelpGenerator;
  private version?: string;
  private readonly listeners: EventListeners = {
    beforeExecute: [],
    afterExecute: [],
    commandError: [],
    error: [],
    exit: [],
  };

  /**
   * Commands currently executing and their contexts, for cancellation. A set
   * (not a single slot) so concurrent pipeline stages are each tracked and can
   * all receive a cancel signal.
   */
  private readonly active = new Set<{
    command: CommandDefinition;
    ctx: CommandContext;
    controller: AbortController;
  }>();

  /**
   * Creates a new CommandRouter.
   *
   * @param registry - The command registry used to look up command definitions.
   */
  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  /**
   * Registers an event listener for a lifecycle event.
   *
   * @param event - The event name.
   * @param handler - The handler function.
   */
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void {
    (this.listeners[event] as CLIEventMap[K][]).push(handler);
  }

  /**
   * Removes an event listener for a lifecycle event.
   *
   * @param event - The event name.
   * @param handler - The handler function to remove.
   */
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void {
    const list = this.listeners[event] as CLIEventMap[K][];
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  /**
   * Emits an event, calling all registered handlers in order.
   *
   * A handler that throws does not prevent the remaining handlers from running;
   * its error is reported through the `error` event (best-effort) and otherwise
   * swallowed so that listener bugs cannot abort command flow.
   *
   * @param event - The event name.
   * @param args - Arguments to pass to the handlers.
   */
  async emit<K extends keyof CLIEventMap>(
    event: K,
    ...args: Parameters<CLIEventMap[K]>
  ): Promise<void> {
    for (const handler of this.listeners[event]) {
      try {
        await (handler as (...a: Parameters<CLIEventMap[K]>) => void | Promise<void>)(...args);
      } catch (err) {
        // A listener should never break command flow. Surface error-event
        // failures to stderr; route others to the error event when possible.
        if (event === "error") {
          process.stderr.write(
            `Error in error handler: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        } else {
          await this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
      }
    }
  }

  /** Fallback action for unrecognized commands. */
  private catchHandler?: (input: string, ctx: CatchContext) => void | Promise<void>;

  /**
   * Assigns a help generator used to produce help text when needed.
   *
   * @param generator - The help generator instance.
   */
  setHelpGenerator(generator: HelpGenerator): void {
    this.helpGenerator = generator;
  }

  /**
   * Sets the version string surfaced by the built-in `--version` flag.
   *
   * @param version - The version string, or undefined to disable.
   */
  setVersion(version: string | undefined): void {
    this.version = version;
  }

  /**
   * Sets a catch/fallback handler invoked when no command matches.
   *
   * @param handler - The fallback handler.
   */
  setCatchHandler(handler: (input: string, ctx: CatchContext) => void | Promise<void>): void {
    this.catchHandler = handler;
  }

  /**
   * Invokes the cancel handler of the currently executing command, if any.
   * Used by the interactive shell to honour SIGINT during a long-running command.
   *
   * @returns True if a cancel handler was invoked, false otherwise.
   */
  triggerCancel(): boolean {
    let cancelled = false;
    for (const entry of this.active) {
      // Abort the context signal first so signal-based actions stop even when no
      // cancel handler is registered, then invoke the optional handler.
      entry.controller.abort();
      entry.command.cancelHandler?.(entry.ctx);
      cancelled = true;
    }
    return cancelled;
  }

  /**
   * Parses the given input and executes the matched command.
   *
   * If the input is empty or unrecognized, a {@link CommandNotFoundError} is thrown.
   * When `--help` is present or the command has no action, help text is printed instead.
   * Required arguments are validated before the action is invoked.
   *
   * @param input - The raw input string or pre-tokenized argument array.
   * @param options - Optional execution context including shell, stdout, and stderr streams.
   * @throws {CommandNotFoundError} If no matching command is found.
   * @throws {MissingArgumentError} If a required argument is not provided.
   */
  async execute(
    input: string | string[],
    options: {
      shell?: Shell | null;
      stdin?: Readable | null;
      stdout?: Writable;
      stderr?: Writable;
    } = {},
  ): Promise<void> {
    const {
      shell = null,
      stdin = null,
      stdout = process.stdout,
      stderr = process.stderr,
    } = options;

    // Check for pipe chains (only for string input)
    if (typeof input === "string") {
      const segments = splitPipes(input);
      if (segments.length > 1) {
        await this.executePiped(segments, { shell, stderr, stdout });
        return;
      }
    }

    // Built-in --version / -V interception (before command resolution).
    const tokens = Array.isArray(input) ? input : tokenize(input);
    if (this.version !== undefined && tokens.length === 1) {
      if (tokens[0] === "--version" || tokens[0] === "-V") {
        stdout.write(`${this.version}\n`);
        return;
      }
    }
    // Bare top-level --help / -h shows the index.
    if (
      this.helpGenerator &&
      tokens.length === 1 &&
      (tokens[0] === "--help" || tokens[0] === "-h")
    ) {
      stdout.write(`${this.helpGenerator.generateIndex()}\n`);
      return;
    }

    // Parsing happens before a command context exists, so a parse failure
    // (unknown/invalid option) cannot carry a `commandError` context — but it
    // must still surface through the catch-all `error` event so failure
    // monitoring is consistent across every input.
    let result: ReturnType<typeof parse>;
    try {
      result = parse(input, this.registry);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.emit("error", error);
      throw err;
    }

    // Empty input
    if (result.commandPath.length === 0) {
      const rawInput = Array.isArray(input) ? input.join(" ") : input;
      if (rawInput.trim().length > 0) {
        if (this.catchHandler) {
          await this.catchHandler(rawInput, { stdout, stderr });
          return;
        }
        const err = new CommandNotFoundError(rawInput.trim().split(/\s+/)[0]);
        await this.emit("error", err);
        throw err;
      }
      return;
    }

    const command = result.command;
    if (!command) {
      if (this.catchHandler) {
        const rawInput = Array.isArray(input) ? input.join(" ") : input;
        await this.catchHandler(rawInput, { stdout, stderr });
        return;
      }
      const err = new CommandNotFoundError(result.commandPath.join(" "));
      await this.emit("error", err);
      throw err;
    }

    // Check --help flag
    if (result.options.help === true) {
      if (this.helpGenerator) {
        const helpText = this.helpGenerator.generateCommand(result.commandPath);
        stdout.write(`${helpText}\n`);
      }
      return;
    }

    // Group command with no action → show help
    if (!command.action) {
      if (this.helpGenerator) {
        const helpText = this.helpGenerator.generateCommand(result.commandPath);
        stdout.write(`${helpText}\n`);
      }
      return;
    }

    // Build context early so every failure phase can report it via commandError.
    // The controller's signal lets actions observe cancellation; triggerCancel
    // aborts it (see the active-entry tracking below).
    const controller = new AbortController();
    const ctx: CommandContext = {
      args: result.args,
      options: {},
      rawInput: result.rawInput,
      commandPath: result.commandPath,
      shell,
      stdin,
      stdout,
      stderr,
      signal: controller.signal,
    };

    try {
      // Validate required arguments
      for (const argDef of command.argDefs) {
        const provided = result.args[argDef.name];
        const missing = argDef.variadic
          ? !Array.isArray(provided) || provided.length === 0
          : provided === undefined;
        if (argDef.required && missing) {
          // Use the canonical command path so the usage matches the help output.
          const usage = formatUsage(this.registry.getCommandPath(command), command);
          throw new MissingArgumentError(argDef.name, usage);
        }
      }

      if (result.extraArgs && result.extraArgs.length > 0) {
        throw new ExtraArgumentError(result.extraArgs[0]);
      }

      // Resolve options
      ctx.options = resolveOptions(result.options, command.options, ctx);

      // Run command-level validation
      if (command.validate) {
        await command.validate(ctx);
      }

      // Emit beforeExecute
      await this.emit("beforeExecute", ctx);

      // Run the action, tracking it as active so SIGINT can cancel it.
      const activeEntry = { command, ctx, controller };
      this.active.add(activeEntry);
      try {
        await command.action(ctx);
      } finally {
        this.active.delete(activeEntry);
      }
      await this.emit("afterExecute", ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.emit("commandError", error, ctx);
      await this.emit("error", error);
      throw err;
    }
  }

  /**
   * Executes a chain of piped commands, streaming each command's stdout into the
   * next command's stdin. All stages run concurrently so producers and consumers
   * make progress together rather than buffering a stage fully before the next starts.
   *
   * @param segments - Array of command strings to pipe together.
   * @param options - Execution context.
   */
  private async executePiped(
    segments: string[],
    options: { shell?: Shell | null; stdout: Writable; stderr: Writable },
  ): Promise<void> {
    const { shell = null, stderr } = options;

    // Wire stage[i].stdout → stage[i+1].stdin via PassThrough pipes.
    const pipes: PassThrough[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      const pipe = new PassThrough();
      // Swallow the pipe's own error event: a stage failure tears the chain down
      // with `destroy(error)`, and that error is already surfaced through the
      // stage promises. Without this listener the emitted 'error' would crash the
      // process as an uncaught exception.
      pipe.on("error", () => {});
      pipes.push(pipe);
    }

    const runs = segments.map((segment, i) => {
      const isLast = i === segments.length - 1;
      const stdin: Readable | null = i === 0 ? null : pipes[i - 1];
      const stdout: Writable = isLast ? options.stdout : pipes[i];

      return this.execute(segment, { shell, stdin, stdout, stderr })
        .then(() => {
          // Signal end-of-input to the downstream stage.
          if (!isLast) pipes[i].end();
        })
        .catch((err) => {
          // Tear down the ENTIRE chain on failure — both the downstream pipe and
          // any upstream pipes — so a backpressured upstream stage cannot hang
          // forever waiting on a consumer that has already failed.
          const error = err instanceof Error ? err : new Error(String(err));
          for (const pipe of pipes) {
            if (!pipe.destroyed) pipe.destroy(error);
          }
          throw error;
        });
    });

    // Await every stage (allSettled, not all) so that when one stage fails and
    // tears the chain down, the resulting rejections of the other stages are
    // observed rather than surfacing as unhandled promise rejections. The first
    // failure is then re-thrown to the caller.
    const settled = await Promise.allSettled(runs);
    const failure = settled.find((r) => r.status === "rejected");
    if (failure) {
      throw (failure as PromiseRejectedResult).reason;
    }
  }
}

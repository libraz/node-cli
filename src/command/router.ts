import { PassThrough, type Readable, type Writable } from "node:stream";
import { CommandNotFoundError, ExtraArgumentError, MissingArgumentError } from "../errors.js";
import type { HelpGenerator } from "../help/generator.js";
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

  /** The command currently executing and its context, for cancellation. */
  private active: { command: CommandDefinition; ctx: CommandContext } | null = null;

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
    if (this.active?.command.cancelHandler) {
      this.active.command.cancelHandler(this.active.ctx);
      return true;
    }
    return false;
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

    const result = parse(input, this.registry);

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
    const ctx: CommandContext = {
      args: result.args,
      options: {},
      rawInput: result.rawInput,
      commandPath: result.commandPath,
      shell,
      stdin,
      stdout,
      stderr,
    };

    try {
      // Validate required arguments
      for (const argDef of command.argDefs) {
        const provided = result.args[argDef.name];
        const missing = argDef.variadic
          ? !Array.isArray(provided) || provided.length === 0
          : provided === undefined;
        if (argDef.required && missing) {
          const usage = formatUsage(result.commandPath, command);
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
      this.active = { command, ctx };
      try {
        await command.action(ctx);
      } finally {
        this.active = null;
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
      pipes.push(new PassThrough());
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
          // Tear down the rest of the chain on failure.
          if (!isLast) pipes[i].destroy(err instanceof Error ? err : new Error(String(err)));
          throw err;
        });
    });

    await Promise.all(runs);
  }
}

/**
 * Builds a human-readable usage string for a command, including its positional arguments.
 *
 * Required arguments are wrapped in angle brackets (`<name>`), optional in square brackets (`[name]`),
 * and variadic arguments are prefixed with `...`.
 *
 * @param commandPath - The full command path (e.g., `["git", "remote", "add"]`).
 * @param command - An object containing the argument definitions for the command.
 * @returns The formatted usage string.
 */
function formatUsage(
  commandPath: string[],
  command: { argDefs: { name: string; required: boolean; variadic: boolean }[] },
): string {
  const parts = [...commandPath];
  for (const arg of command.argDefs) {
    if (arg.variadic) {
      parts.push(arg.required ? `<...${arg.name}>` : `[...${arg.name}]`);
    } else {
      parts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
    }
  }
  return parts.join(" ");
}

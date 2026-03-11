import { PassThrough, type Readable, type Writable } from "node:stream";
import { CommandNotFoundError, MissingArgumentError } from "../errors.js";
import type { HelpGenerator } from "../help/generator.js";
import { resolveOptions } from "../option/resolver.js";
import type { Shell } from "../shell/repl.js";
import type { CLIEventMap, CommandContext } from "../types.js";
import { parse, splitPipes } from "./parser.js";
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
  private readonly listeners: EventListeners = {
    beforeExecute: [],
    afterExecute: [],
    commandError: [],
    exit: [],
  };

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
   * @param event - The event name.
   * @param args - Arguments to pass to the handlers.
   */
  async emit<K extends keyof CLIEventMap>(
    event: K,
    ...args: Parameters<CLIEventMap[K]>
  ): Promise<void> {
    for (const handler of this.listeners[event]) {
      await (handler as (...a: Parameters<CLIEventMap[K]>) => void | Promise<void>)(...args);
    }
  }

  /** Fallback action for unrecognized commands. */
  private catchHandler?: (
    input: string,
    ctx: { stdout: Writable; stderr: Writable },
  ) => void | Promise<void>;

  /**
   * Assigns a help generator used to produce help text when needed.
   *
   * @param generator - The help generator instance.
   */
  setHelpGenerator(generator: HelpGenerator): void {
    this.helpGenerator = generator;
  }

  /**
   * Sets a catch/fallback handler invoked when no command matches.
   *
   * @param handler - The fallback handler.
   */
  setCatchHandler(
    handler: (input: string, ctx: { stdout: Writable; stderr: Writable }) => void | Promise<void>,
  ): void {
    this.catchHandler = handler;
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

    const result = parse(input, this.registry);

    // Empty input
    if (result.commandPath.length === 0) {
      const rawInput = Array.isArray(input) ? input.join(" ") : input;
      if (rawInput.trim().length > 0) {
        if (this.catchHandler) {
          await this.catchHandler(rawInput, { stdout, stderr });
          return;
        }
        throw new CommandNotFoundError(rawInput.trim().split(/\s+/)[0]);
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
      throw new CommandNotFoundError(result.commandPath.join(" "));
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

    // Validate required arguments
    for (const argDef of command.argDefs) {
      if (argDef.required && result.args[argDef.name] === undefined) {
        const usage = formatUsage(result.commandPath, command);
        throw new MissingArgumentError(argDef.name, usage);
      }
    }

    // Build context (needed for option resolver)
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

    // Resolve options
    ctx.options = resolveOptions(result.options, command.options, ctx);

    // Run command-level validation
    if (command.validate) {
      await command.validate(ctx);
    }

    // Emit beforeExecute
    await this.emit("beforeExecute", ctx);

    try {
      await command.action(ctx);
      await this.emit("afterExecute", ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.emit("commandError", error, ctx);
      throw err;
    }
  }

  /**
   * Executes a chain of piped commands, passing stdout of each to stdin of the next.
   *
   * @param segments - Array of command strings to pipe together.
   * @param options - Execution context.
   */
  private async executePiped(
    segments: string[],
    options: { shell?: Shell | null; stdout: Writable; stderr: Writable },
  ): Promise<void> {
    const { shell = null, stderr } = options;
    let currentStdin: Readable | null = null;

    for (let i = 0; i < segments.length; i++) {
      const isLast = i === segments.length - 1;
      const currentStdout = isLast ? options.stdout : new PassThrough();

      await this.execute(segments[i], {
        shell,
        stdin: currentStdin,
        stdout: currentStdout as Writable,
        stderr,
      });

      if (!isLast) {
        // End the PassThrough so the next command's stdin read will finish
        (currentStdout as PassThrough).end();
        currentStdin = currentStdout as unknown as Readable;
      }
    }
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

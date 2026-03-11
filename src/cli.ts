import { homedir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { CommandBuilder } from "./command/builder.js";
import { CommandRegistry } from "./command/registry.js";
import { CommandRouter } from "./command/router.js";
import { HelpGenerator } from "./help/generator.js";
import { Shell } from "./shell/repl.js";
import type { CLIEventMap, CLIOptions } from "./types.js";

/**
 * Context object passed to plugins for extending the CLI.
 */
export interface PluginContext {
  /** Register a new command. */
  command: (definition: string) => CommandBuilder;
  /** Register an event listener. */
  on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
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
  private historySize: number;
  private readonly pendingPlugins: Promise<void>[] = [];

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
    this.historySize = options.historySize ?? 1000;

    this.registry = new CommandRegistry();
    this.router = new CommandRouter(this.registry);
    this.helpGenerator = new HelpGenerator(this.registry, {
      name: this.name,
      version: this.version,
      description: this.descriptionStr,
    });
    this.router.setHelpGenerator(this.helpGenerator);

    // Register built-in help command
    this.registerHelpCommand();
  }

  /**
   * Registers a new command with the given definition string.
   * @param definition - The command definition (e.g., "greet <name> [title]").
   * @returns A CommandBuilder instance for further configuration.
   */
  command(definition: string): CommandBuilder {
    return new CommandBuilder(this.registry, definition);
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
  catch(
    handler: (input: string, ctx: { stdout: Writable; stderr: Writable }) => void | Promise<void>,
  ): this {
    this.router.setCatchHandler(handler);
    return this;
  }

  /**
   * Registers a plugin that receives a context object for extending the CLI.
   * @param plugin - A function that receives a PluginContext and may register commands, events, etc.
   * @returns The CLI instance for method chaining.
   */
  use(plugin: (ctx: PluginContext) => void | Promise<void>): this {
    const context: PluginContext = {
      command: (definition: string) => this.command(definition),
      on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => {
        this.on(event, handler);
      },
    };
    // Run plugin synchronously or kick off async (fire-and-forget for sync registration)
    const result = plugin(context);
    if (result instanceof Promise) {
      // Store for potential await during start
      this.pendingPlugins.push(result);
    }
    return this;
  }

  /**
   * Programmatically executes a command as if typed by the user.
   * @param input - The command string to execute.
   * @param options - Optional streams for stdout/stderr.
   */
  async exec(input: string, options: { stdout?: Writable; stderr?: Writable } = {}): Promise<void> {
    const { stdout = process.stdout, stderr = process.stderr } = options;
    await this.router.execute(input, { stdout, stderr });
  }

  /**
   * Starts the CLI application. If arguments are provided (or found in process.argv),
   * runs in direct CLI mode. Otherwise, starts an interactive shell session.
   * @param argv - Optional array of command-line arguments. Defaults to process.argv.slice(2).
   */
  async start(argv?: string[]): Promise<void> {
    // Await any async plugins
    if (this.pendingPlugins.length > 0) {
      await Promise.all(this.pendingPlugins);
      this.pendingPlugins.length = 0;
    }

    const args = argv ?? process.argv.slice(2);

    if (args.length > 0) {
      // Direct CLI mode
      try {
        await this.router.execute(args, {
          stdout: process.stdout,
          stderr: process.stderr,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exitCode = 1;
      }
    } else {
      // Interactive shell mode
      let banner: string;
      if (this.bannerStr !== undefined) {
        banner = this.bannerStr;
      } else if (this.name) {
        banner = this.version ? `${this.name} v${this.version}` : this.name;
      } else {
        banner = "";
      }

      const shell = new Shell({
        router: this.router,
        registry: this.registry,
        prompt: this.promptStr,
        banner,
        historyFile: this.historyFile,
        historySize: this.historySize,
      });

      await shell.start();
    }
  }

  private registerHelpCommand(): void {
    const helpGenerator = this.helpGenerator;
    const registry = this.registry;

    new CommandBuilder(this.registry, "help [...command]")
      .description("Show help information")
      .action((ctx) => {
        const commandParts = ctx.args.command as string[] | undefined;

        if (!commandParts || commandParts.length === 0) {
          ctx.stdout.write(`${helpGenerator.generateIndex()}\n`);
        } else {
          ctx.stdout.write(`${helpGenerator.generateCommand(commandParts)}\n`);
        }
      });
  }
}

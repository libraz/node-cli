import { createInterface, type Interface } from "node:readline/promises";
import type { CommandRegistry } from "../command/registry.js";
import type { CommandRouter } from "../command/router.js";
import { PromptCancelError } from "../errors.js";
import { ShellCompleter } from "./completion.js";
import { History } from "./history.js";

/**
 * Interactive REPL (Read-Eval-Print Loop) shell.
 * Provides a command prompt with history persistence and tab-completion,
 * routing user input to the appropriate command handlers.
 */
/**
 * Definition of a mode sub-REPL with its own prompt and action handler.
 */
export interface ModeConfig {
  /** The prompt string displayed in mode. */
  prompt: string;
  /** Handler for each line of input within the mode. */
  action: (
    input: string,
    ctx: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
  ) => void | Promise<void>;
  /** Message displayed when entering the mode. */
  message?: string;
}

export class Shell {
  private readonly router: CommandRouter;
  private promptStr: string;
  private readonly banner: string;
  private readonly history: History;
  private readonly completer: ShellCompleter;
  private rl?: Interface;
  private running = false;
  private reopeningReadline = false;
  private mode: ModeConfig | null = null;

  /**
   * Creates a new Shell instance.
   * @param options - Configuration options for the shell.
   * @param options.router - The command router that dispatches input to handlers.
   * @param options.registry - The command registry for tab-completion lookups.
   * @param options.prompt - The prompt string displayed to the user.
   * @param options.banner - Banner text displayed when the shell starts.
   * @param options.historyFile - File path for persisting command history.
   * @param options.historySize - Maximum number of history entries to retain.
   */
  constructor(options: {
    router: CommandRouter;
    registry: CommandRegistry;
    prompt: string;
    banner?: string;
    historyFile: string;
    historySize?: number;
  }) {
    this.router = options.router;
    this.promptStr = options.prompt;
    this.banner = options.banner ?? "";
    this.history = new History({
      filePath: options.historyFile,
      maxSize: options.historySize,
    });
    this.completer = new ShellCompleter(options.registry);
  }

  /**
   * Creates (or recreates) the readline interface with current history.
   */
  private openReadline(history: string[]): void {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.mode ? this.mode.prompt : this.promptStr,
      // readline expects most-recent-first; our history is stored oldest-first.
      history: [...history].reverse(),
      completer: (line: string) => this.completer.complete(line),
      terminal: true,
    });
    this.rl.on("close", () => {
      if (!this.reopeningReadline) {
        this.running = false;
      }
    });
    // Ctrl+C at the prompt cancels the current line instead of exiting the shell.
    this.rl.on("SIGINT", () => {
      process.stdout.write("\n");
      this.rl?.prompt();
    });
  }

  /**
   * Reads the next line of user input via the readline interface.
   * Returns `null` on EOF / close.
   */
  private readNextLine(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const rl = this.rl;
      if (!rl) {
        resolve(null);
        return;
      }
      const onLine = (line: string) => {
        rl.off("close", onClose);
        resolve(line);
      };
      const onClose = () => {
        rl.off("line", onLine);
        resolve(null);
      };
      rl.once("line", onLine);
      rl.once("close", onClose);
    });
  }

  /**
   * Starts the interactive shell loop.
   * Loads history, sets up readline with tab-completion, and processes
   * user input until "exit", "quit", or EOF is received.
   * Saves history to disk before returning.
   */
  async start(): Promise<void> {
    const historyEntries = await this.history.load();

    this.running = true;

    if (this.banner) {
      process.stdout.write(`${this.banner}\n`);
    }

    this.openReadline(historyEntries);

    while (this.running) {
      this.rl?.prompt();

      const line = await this.readNextLine();
      if (line === null) break;

      const trimmed = line.trim();

      if (trimmed === "") {
        continue;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        if (this.mode) {
          this.exitMode();
          continue;
        }
        break;
      }

      // Only persist top-level commands; mode sub-REPL input (which may be
      // sensitive) must not leak into the shared, on-disk history.
      if (!this.mode) {
        this.history.add(trimmed);
      }

      // Close readline to fully release stdin before command execution.
      // This prevents input contention when commands use prompt.* or
      // create their own readline interface on process.stdin.
      this.reopeningReadline = true;
      this.rl?.close();
      this.reopeningReadline = false;
      this.rl = undefined;

      if (this.mode) {
        try {
          await this.mode.action(trimmed, {
            stdout: process.stdout,
            stderr: process.stderr,
          });
        } catch (err) {
          this.reportError(err);
        }
      } else {
        // Route SIGINT during command execution to the command's cancel handler.
        // A second Ctrl+C (or one with no handler installed) falls through to
        // the default terminate behavior.
        const onSigint = () => {
          this.router.triggerCancel();
        };
        process.once("SIGINT", onSigint);
        try {
          await this.router.execute(trimmed, {
            shell: this,
            stdout: process.stdout,
            stderr: process.stderr,
          });
        } catch (err) {
          this.reportError(err);
        } finally {
          process.removeListener("SIGINT", onSigint);
        }
      }

      // Recreate readline with updated history for the next prompt cycle.
      if (this.running) {
        this.openReadline(this.history.entries());
      }
    }

    await this.history.save();
    await this.router.emit("exit");
    if (this.rl) {
      this.rl.close();
    }
  }

  /**
   * Writes an error to stderr, presenting a cancelled prompt as a clean message
   * rather than a raw `Error: Prompt cancelled` line.
   */
  private reportError(err: unknown): void {
    if (err instanceof PromptCancelError) {
      process.stderr.write("Cancelled\n");
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${message}\n`);
  }

  /**
   * Stops the shell, closing the readline interface and ending the loop.
   */
  stop(): void {
    this.running = false;
    this.rl?.close();
  }

  /**
   * Changes the prompt string displayed in the shell.
   * Takes effect on the next prompt display. If currently in a mode,
   * the change applies after exiting the mode.
   *
   * @param text - The new prompt string.
   */
  setPrompt(text: string): void {
    this.promptStr = text;
    if (this.rl && !this.mode) {
      this.rl.setPrompt(text);
    }
  }

  /**
   * Enters a mode sub-REPL with a custom prompt and action handler.
   * While in a mode, all input is routed to the mode's action handler
   * instead of the command router.
   *
   * @param config - The mode configuration.
   */
  enterMode(config: ModeConfig): void {
    this.mode = config;
    if (config.message) {
      process.stdout.write(`${config.message}\n`);
    }
    this.rl?.setPrompt(config.prompt);
  }

  /**
   * Exits the current mode, returning to the normal command prompt.
   */
  exitMode(): void {
    this.mode = null;
    this.rl?.setPrompt(this.promptStr);
  }
}

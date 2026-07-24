import { createInterface, type Interface } from "node:readline/promises";
import type { CommandRegistry } from "../command/registry.js";
import type { CommandRouter } from "../command/router.js";
import { formatErrorMessage, isCancellationError } from "../errors.js";
import type { CompletionResult } from "./completion.js";
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
  /**
   * Handler for each line of input within the mode. The context carries a
   * `signal` that is aborted when the user presses Ctrl-C during the action, so a
   * long-running mode action (e.g. a slow query) can cancel cooperatively. A
   * second Ctrl-C force-quits the process.
   */
  action: (
    input: string,
    ctx: {
      stdout: NodeJS.WritableStream;
      stderr: NodeJS.WritableStream;
      signal: AbortSignal;
    },
  ) => void | Promise<void>;
  /** Message displayed when entering the mode. */
  message?: string;
  /** Optional mode-specific tab completer. Top-level command completion is disabled by default. */
  completer?: (line: string) => CompletionResult | Promise<CompletionResult>;
  /** In-memory mode history policy. Mode input is never persisted to disk. Defaults to `session`. */
  history?: "session" | "none";
}

export class Shell {
  private readonly router: CommandRouter;
  private promptStr: string;
  private readonly banner: string;
  private readonly history: History;
  private readonly historySize: number;
  private readonly completer: ShellCompleter;
  private rl?: Interface;
  private running = false;
  private reopeningReadline = false;
  private mode: ModeConfig | null = null;
  private modeHistory: string[] = [];
  private readonly beforeExecute?: () => Promise<void>;

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
    historyFilter?: (line: string) => string | null;
    version?: string;
    beforeExecute?: () => Promise<void>;
  }) {
    this.router = options.router;
    this.promptStr = options.prompt;
    this.banner = options.banner ?? "";
    this.beforeExecute = options.beforeExecute;
    this.historySize = options.historySize ?? 1000;
    this.history = new History({
      filePath: options.historyFile,
      maxSize: options.historySize,
      filter: options.historyFilter,
    });
    this.completer = new ShellCompleter(options.registry, {
      hasVersion: options.version !== undefined,
    });
  }

  /**
   * Creates (or recreates) the readline interface with current history.
   */
  private openReadline(history: string[]): void {
    this.completer.reset();
    const mode = this.mode;
    const activeHistory = mode
      ? mode.history === "none"
        ? []
        : [...this.modeHistory].reverse()
      : [...history].reverse();
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.mode ? this.mode.prompt : this.promptStr,
      // readline expects most-recent-first; our history is stored oldest-first.
      history: activeHistory,
      completer: mode
        ? mode.completer
          ? (line: string) => mode.completer?.(line) ?? [[], line]
          : undefined
        : (line: string) => this.completer.complete(line),
      terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
    });
    this.rl.on("close", () => {
      if (!this.reopeningReadline && !this.mode) {
        this.running = false;
      }
    });
    // Ctrl+C at the prompt cancels the current line instead of exiting the shell.
    this.rl.on("SIGINT", () => {
      const rl = this.rl;
      if (!rl) return;
      // Clear the WHOLE line — both sides of the cursor — so no buffered text
      // survives to be executed by a following Enter. Ctrl+U erases left of the
      // cursor and Ctrl+K erases right of it; together they abandon the entire
      // line regardless of cursor position, matching the universal shell
      // convention that Ctrl-C discards the current line.
      rl.write(null, { ctrl: true, name: "u" });
      rl.write(null, { ctrl: true, name: "k" });
      process.stdout.write("\n");
      rl.prompt();
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

    // Persist history on SIGTERM (e.g. a process manager stopping the app) so a
    // session terminated between the end-of-loop saves does not lose its history.
    // The normal exit path still saves below; this only covers abnormal teardown.
    const onSigterm = () => {
      void this.history.save().finally(() => {
        process.exit(143); // 128 + SIGTERM
      });
    };
    process.on("SIGTERM", onSigterm);

    if (this.banner) {
      process.stdout.write(`${this.banner}\n`);
    }

    this.openReadline(historyEntries);

    while (this.running) {
      this.rl?.prompt();

      const line = await this.readNextLine();
      if (line === null) {
        // EOF (Ctrl-D). Inside a mode sub-REPL, leave the mode and return to the
        // parent prompt rather than terminating the whole shell.
        if (this.mode) {
          this.exitMode();
          this.openReadline(this.history.entries());
          continue;
        }
        break;
      }

      const trimmed = line.trim();

      if (trimmed === "") {
        continue;
      }

      if (trimmed === "exit" || trimmed === "quit") {
        if (this.mode) {
          this.exitMode();
          this.reopeningReadline = true;
          this.rl?.close();
          this.reopeningReadline = false;
          this.rl = undefined;
          this.openReadline(this.history.entries());
          continue;
        }
        break;
      }

      // Close readline to fully release stdin before command execution AND before
      // any async persistence below. This prevents input contention: while an
      // `await` runs, an open readline would consume the next buffered line and
      // drop it. It also frees stdin for commands that use prompt.* or create
      // their own readline interface.
      this.reopeningReadline = true;
      this.rl?.close();
      this.reopeningReadline = false;
      this.rl = undefined;
      process.stdin.pause();

      // Only persist top-level commands; mode sub-REPL input (which may be
      // sensitive) must not leak into the shared, on-disk history.
      if (!this.mode) {
        this.history.add(trimmed);
        // Persist before command execution so a later force-quit cannot discard
        // commands already accepted in this session. Readline is closed above,
        // so this async write cannot consume or lose buffered terminal input.
        await this.history.save();
      } else if (this.mode.history !== "none") {
        if (this.modeHistory[this.modeHistory.length - 1] !== trimmed) {
          this.modeHistory.push(trimmed);
          if (this.modeHistory.length > this.historySize) {
            this.modeHistory.splice(0, this.modeHistory.length - this.historySize);
          }
        }
      }

      if (this.mode) {
        // Mode actions bypass the router's command execution, so cancellation is
        // driven by a dedicated controller: the first Ctrl-C aborts this signal
        // (cooperative), a second force-quits the process.
        const controller = new AbortController();
        try {
          await this.router.runWithSigintCancel(
            async () => {
              await this.mode?.action(trimmed, {
                stdout: process.stdout,
                stderr: process.stderr,
                signal: controller.signal,
              });
            },
            {
              stderr: process.stderr,
              onInterrupt: () => {
                if (controller.signal.aborted) return false;
                controller.abort();
                return true;
              },
            },
          );
        } catch (err) {
          this.reportError(err);
        }
      } else {
        try {
          // Drain any pending async plugins (registered but not yet initialized)
          // before running, so a late plugin failure surfaces instead of showing
          // up only as a missing command.
          if (this.beforeExecute) await this.beforeExecute();
          await this.router.runWithSigintCancel(async () => {
            await this.router.execute(trimmed, {
              shell: this,
              stdout: process.stdout,
              stderr: process.stderr,
            });
          });
        } catch (err) {
          this.reportError(err);
        }
      }

      // Recreate readline with updated history for the next prompt cycle.
      if (this.running) {
        // A piped/non-interactive input may have reached EOF while the command
        // (or the history write above) was running. Reopening readline after
        // that point would never receive another close event.
        if (process.stdin.readableEnded) break;
        this.openReadline(this.mode ? [] : this.history.entries());
      }
    }

    process.removeListener("SIGTERM", onSigterm);
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
    // A user-initiated cancellation (prompt cancel or a SIGINT-aborted signal)
    // is presented as a clean "Cancelled" line, without the "Error:" prefix.
    if (isCancellationError(err)) {
      process.stderr.write(`${formatErrorMessage(err)}\n`);
      return;
    }
    const message = formatErrorMessage(err);
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
    this.modeHistory = [];
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
    this.modeHistory = [];
    this.rl?.setPrompt(this.promptStr);
  }
}

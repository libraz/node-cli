import type { CommandRegistry } from "../command/registry.js";
import type { CommandRouter } from "../command/router.js";
import { presentError } from "../errors.js";
import { isTTY } from "../output/color.js";
import { inputExhausted, type LineReader, openLineReader } from "../output/line-reader.js";
import { releaseAll, runWithProgressScope } from "../output/progress.js";
import type { Completer, CompletionContext, ModeContext } from "../types.js";
import { isShellCommand } from "./builtins.js";
import { ShellCompleter } from "./completion.js";
import { History } from "./history.js";

/** Milliseconds a SIGTERM leaves cancelled work to clean up before the shell exits. */
const SIGTERM_GRACE_MS = 200;

/** Handler invoked with each line of input within a mode. */
export type ModeAction = (input: string, ctx: ModeContext) => void | Promise<void>;

/**
 * Definition of a mode sub-REPL with its own prompt and action handler.
 */
export interface ModeOptions {
  /** The prompt string displayed in mode. */
  prompt: string;
  /**
   * Handler for each line of input within the mode. The context carries a
   * `signal` that is aborted when the user presses Ctrl-C or the shell receives
   * SIGTERM during the action, so a long-running mode action (e.g. a slow query)
   * can cancel cooperatively. A second Ctrl-C force-quits the process.
   */
  action: ModeAction;
  /** Banner printed once when entering the mode. */
  banner?: string | undefined;
  /**
   * Tab-completion candidates inside the mode: a static list, or a
   * {@link Completer} called with a {@link CompletionContext} whose `commandPath`
   * is empty. Either is filtered by prefix match on `ctx.current`. Top-level
   * command completion is not offered inside a mode. Defaults to no completion.
   */
  completer?: readonly string[] | Completer | undefined;
  /** In-memory mode history policy. Mode input is never persisted to disk. Defaults to `session`. */
  history?: "session" | "none" | undefined;
}

/**
 * The running interactive shell as a command action sees it through `ctx.shell`.
 */
export interface Shell {
  /** Changes the prompt; inside a mode the change applies after leaving it. */
  setPrompt(text: string): this;
  /** Enters a mode sub-REPL that routes every line to the mode's action. */
  enterMode(config: ModeOptions): this;
  /** Leaves the current mode and returns to the command prompt. */
  exitMode(): this;
  /** Ends the shell session after the current input. Terminal, so it returns nothing. */
  stop(): void;
}

/**
 * Interactive REPL (Read-Eval-Print Loop) shell.
 * Provides a command prompt with history persistence and tab-completion,
 * routing user input to the appropriate command handlers.
 */
export class InteractiveShell implements Shell {
  private readonly router: CommandRouter;
  private readonly registry: CommandRegistry;
  private promptStr: string;
  private readonly banner: string;
  private readonly history: History;
  private readonly historySize: number;
  private readonly completer: ShellCompleter;
  private reader?: LineReader;
  /** Removes the listeners {@link openReader} attached beside the reader. */
  private detachReader?: () => void;
  /** Cancels the running mode action, so SIGTERM reaches it as Ctrl-C does. */
  private modeController?: AbortController;
  private running = false;
  private mode: ModeOptions | null = null;
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
    this.registry = options.registry;
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
   * Opens the line reader for the next prompt with the current history. Lines
   * and unsubmitted text the previous reader left on stdin carry over to it.
   */
  private openReader(history: string[]): void {
    this.completer.reset();
    const mode = this.mode;
    const modeCompleter = mode?.completer;
    const activeHistory = mode
      ? mode.history === "none"
        ? []
        : [...this.modeHistory].reverse()
      : [...history].reverse();
    const reader = openLineReader({
      input: process.stdin,
      output: process.stdout,
      prompt: mode ? mode.prompt : this.promptStr,
      // readline expects most-recent-first; our history is stored oldest-first.
      history: activeHistory,
      completer: mode
        ? modeCompleter
          ? (line: string) => this.completer.runModeProvider(modeCompleter, line)
          : undefined
        : (line: string) => this.completer.complete(line),
      terminal: isTTY(process.stdin) && isTTY(process.stdout),
    });
    const { rl } = reader;

    // Ctrl+C at the prompt cancels the current line instead of exiting the shell.
    rl.on("SIGINT", () => {
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

    // Any key other than Tab edits the line, so progressive completion restarts.
    const onKeypress = (_char: unknown, key?: { name?: string }) => {
      if (key?.name !== "tab") this.completer.reset();
    };
    process.stdin.on("keypress", onKeypress);

    this.reader = reader;
    this.detachReader = () => process.stdin.off("keypress", onKeypress);
  }

  /** Closes the line reader, releasing stdin; unread input stays queued for the next one. */
  private closeReader(): void {
    this.detachReader?.();
    this.detachReader = undefined;
    this.reader?.close();
    this.reader = undefined;
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

    // The process listeners stay installed through teardown, so Ctrl-C and
    // SIGTERM remain handled while history is saved and `exit` listeners run.
    const releaseProcessListeners = this.registerProcessListeners();
    try {
      try {
        await this.runLoop(historyEntries);
      } finally {
        // Release the terminal before the first teardown await, so no prompt is
        // redrawn and no key is read while listeners run.
        this.closeReader();
        await this.history.save();
        await this.router.emitExit();
      }
    } finally {
      releaseProcessListeners();
    }
  }

  /**
   * Installs the process-level listeners a shell session needs and returns the
   * paired release. Registration and removal live in one place so that however
   * the loop ends — normally, by throw, or by `stop()` — an embedding
   * application is left with its own process-level policy and no stray timer.
   */
  private registerProcessListeners(): () => void {
    // Readline owns Ctrl-C while it is open and CommandRouter installs a
    // cancellation handler while an action runs. Between those two states we
    // briefly close/reopen readline; keep a process-level listener registered
    // for the shell lifetime so Ctrl-C in that hand-off cannot trigger Node's
    // default process termination.
    const onSigintGap = () => undefined;

    // Persist history on SIGTERM (e.g. a process manager stopping the app) so a
    // session terminated between the end-of-loop saves does not lose its history.
    // The normal exit path still saves below; this only covers abnormal teardown.
    let terminating = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onSigterm = () => {
      if (terminating) return;
      terminating = true;
      // Match Ctrl-C's cooperative cancellation path before the conventional
      // SIGTERM exit. A short grace period lets handlers release locks and
      // temporary resources without allowing a hung command to block shutdown.
      this.router.triggerCancel();
      this.modeController?.abort();
      graceTimer = setTimeout(() => {
        this.router.terminate(143, () => this.history.save()); // 128 + SIGTERM
      }, SIGTERM_GRACE_MS);
    };

    // A REPL is a long-lived session: asynchronous work started by a command
    // can reject after its command boundary has returned. Keep those process
    // failures visible without silently ending the whole interactive session.
    // These handlers are scoped to this Shell instance and removed below so an
    // embedding application retains its normal process-level policy outside a
    // running REPL.
    const onUnhandledRejection = (reason: unknown) => {
      releaseAll();
      this.reportError(reason);
    };
    const onUncaughtException = (error: Error) => {
      releaseAll();
      this.reportError(error);
    };

    process.on("SIGINT", onSigintGap);
    process.on("SIGTERM", onSigterm);
    process.on("unhandledRejection", onUnhandledRejection);
    process.on("uncaughtException", onUncaughtException);

    return () => {
      // Teardown has finished; a pending grace timer must not override the exit
      // code the normal path settled on.
      if (graceTimer) clearTimeout(graceTimer);
      process.removeListener("SIGINT", onSigintGap);
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("unhandledRejection", onUnhandledRejection);
      process.removeListener("uncaughtException", onUncaughtException);
    };
  }

  /** Reads and dispatches input until the session ends. */
  private async runLoop(historyEntries: string[]): Promise<void> {
    if (this.banner) {
      process.stdout.write(`${this.banner}\n`);
    }

    this.openReader(historyEntries);

    while (this.running && this.reader) {
      // Draws the prompt and types back text the previous reader had buffered
      // but never submitted, so the line on screen is always a prefix of what
      // pressing Enter will run.
      this.reader.prompt();

      let line: string | null;
      try {
        line = await this.reader.read();
      } catch (err) {
        // The input failed; it cannot deliver another line.
        this.reportError(err);
        break;
      }
      if (line === null) {
        // EOF (Ctrl-D). Inside a mode sub-REPL, leave the mode and return to the
        // parent prompt rather than terminating the whole shell — unless the
        // input stream itself is exhausted, in which case a reopened reader
        // would never receive another line and the shell would hang forever.
        if (this.running && this.mode && !inputExhausted(process.stdin)) {
          this.exitMode();
          this.closeReader();
          this.openReader(this.history.entries());
          continue;
        }
        break;
      }

      const trimmed = line.trim();

      if (trimmed === "") {
        continue;
      }

      if (isShellCommand(trimmed)) {
        // Inside a mode, exit always leaves the mode: a mode does not dispatch
        // through the registry, so an application command of the same name is
        // unreachable there and honouring it would strand the user in the mode.
        if (this.mode) {
          this.exitMode();
          this.closeReader();
          if (inputExhausted(process.stdin)) break;
          this.openReader(this.history.entries());
          continue;
        }
        // At the top level an application command of the same name wins.
        if (!this.registry.resolve([trimmed])) break;
      }

      // Close the reader to fully release stdin before command execution AND
      // before any async persistence below. Lines that arrive meanwhile stay
      // queued for the next reader, and commands that use prompt.* or create
      // their own reader get the input to themselves.
      this.closeReader();
      process.stdin.pause();

      // Only persist top-level commands; mode sub-REPL input (which may be
      // sensitive) must not leak into the shared, on-disk history.
      if (!this.mode) {
        this.history.add(trimmed);
        // Persist before command execution so a later force-quit cannot discard
        // commands already accepted in this session.
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
        await this.runModeAction(this.mode, trimmed);
      } else {
        let interrupted = false;
        try {
          // Drain any pending async plugins (registered but not yet initialized)
          // before running, so a late plugin failure surfaces instead of showing
          // up only as a missing command.
          if (this.beforeExecute) await this.beforeExecute();
          await this.router.runWithSigintCancel(
            async () => {
              await this.router.execute(trimmed, {
                shell: this,
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
        } catch (err) {
          this.reportError(err, interrupted);
        }
      }

      // Reopen the reader with updated history for the next prompt cycle.
      if (this.running) {
        // A piped/non-interactive input may have reached EOF while the command
        // (or the history write above) was running, with every line consumed.
        if (inputExhausted(process.stdin)) break;
        this.openReader(this.mode ? [] : this.history.entries());
        // Pair with the `process.stdin.pause()` above: the reopened reader is
        // now attached, so resume the input to guarantee buffered lines (and a
        // pending EOF) flow to it. Attaching a `data` listener does not reliably
        // un-pause an explicitly paused stream across Node versions, so resume
        // explicitly rather than relying on that side effect.
        process.stdin.resume();
      }
    }
  }

  /**
   * Runs one line of mode input. Mode actions bypass the router's command
   * execution, so cancellation is driven by a dedicated controller: Ctrl-C or
   * SIGTERM aborts its signal (cooperative), a second Ctrl-C force-quits.
   */
  private async runModeAction(mode: ModeOptions, input: string): Promise<void> {
    const controller = new AbortController();
    this.modeController = controller;
    try {
      await this.router.runWithSigintCancel(
        () =>
          // Releases only the indicators this action created, before any error
          // is reported below.
          runWithProgressScope(async () => {
            await mode.action(input, {
              stdin: process.stdin,
              stdout: process.stdout,
              stderr: process.stderr,
              signal: controller.signal,
            });
          }),
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
      // Only an interrupt or SIGTERM aborts this controller.
      this.reportError(err, controller.signal.aborted);
    } finally {
      this.modeController = undefined;
    }
  }

  /**
   * Writes an error to stderr through the shared presenter. The shell survives
   * the failure and keeps prompting, so unlike the direct CLI path it discards
   * the exit code and does not opt into `NODE_CLI_DEBUG` stacks.
   * @param interrupted - True when a Ctrl-C caused the failure, which is
   * presented as a clean `Cancelled` line rather than the abort's own message.
   */
  private reportError(err: unknown, interrupted = false): void {
    presentError(err, { stream: process.stderr, interrupted });
  }

  /**
   * Stops the shell, closing the readline interface and ending the loop.
   */
  stop(): void {
    this.running = false;
    this.closeReader();
  }

  /**
   * Changes the prompt string displayed in the shell.
   * Takes effect on the next prompt display. If currently in a mode,
   * the change applies after exiting the mode.
   *
   * @param text - The new prompt string.
   */
  setPrompt(text: string): this {
    this.promptStr = text;
    if (this.reader && !this.mode) {
      this.reader.rl.setPrompt(text);
    }
    return this;
  }

  /**
   * Enters a mode sub-REPL with a custom prompt and action handler.
   * While in a mode, all input is routed to the mode's action handler
   * instead of the command router.
   *
   * @param config - The mode configuration.
   * @returns The shell, so calls chain.
   */
  enterMode(config: ModeOptions): this {
    this.mode = config;
    this.modeHistory = [];
    if (config.banner) {
      process.stdout.write(`${config.banner}\n`);
    }
    this.reader?.rl.setPrompt(config.prompt);
    return this;
  }

  /**
   * Exits the current mode, returning to the normal command prompt.
   * @returns The shell, so calls chain.
   */
  exitMode(): this {
    this.mode = null;
    this.modeHistory = [];
    this.reader?.rl.setPrompt(this.promptStr);
    return this;
  }
}

import { PassThrough, type Readable, type Writable } from "node:stream";
import { CommandNotFoundError, ExtraArgumentError, MissingArgumentError } from "../errors.js";
import { formatUsage, type HelpGenerator } from "../help/generator.js";
import { resolveOptions } from "../option/resolver.js";
import { restoreCursor } from "../output/progress.js";
import type { Shell } from "../shell/repl.js";
import type { CatchContext, CLIEventMap, CommandContext, CommandDefinition } from "../types.js";
import { parse, splitPipes, tokenize } from "./parser.js";
import type { CommandRegistry } from "./registry.js";

/**
 * Sentinel abort reason used when a downstream pipeline stage finishes early and
 * no longer needs its upstream producers. It marks a *graceful* stop, not a
 * failure, so the pipeline does not surface a spurious `AbortError`.
 */
class PipelineStopSignal extends Error {
  constructor() {
    super("pipeline stage stopped early");
    this.name = "PipelineStopSignal";
  }
}

/** True when a value is a {@link PipelineStopSignal} (the graceful-stop marker). */
function isPipelineStop(value: unknown): boolean {
  return value instanceof PipelineStopSignal;
}

/** Typed event listener store. */
type EventListeners = {
  [K in keyof CLIEventMap]: CLIEventMap[K][];
};

type CancellationEntry = {
  command: CommandDefinition;
  ctx: CommandContext;
  controller: AbortController;
};

type CancellationScope = Set<CancellationEntry>;

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
  private readonly active: CancellationScope = new Set();

  /**
   * The stderr stream of the execution currently in flight. A best-effort target
   * for internal diagnostics (e.g. an error handler that itself throws) so they
   * reach a captured stream when an embedder supplied one, rather than always
   * going to the real `process.stderr`.
   */
  private currentStderr: Writable = process.stderr;

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
          this.currentStderr.write(
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
   * Aborts currently executing commands and invokes each cancel handler, if any.
   * Used by the interactive shell to honour SIGINT during a long-running command.
   *
   * @returns True if at least one command was newly cancelled, false otherwise.
   */
  triggerCancel(): boolean {
    return this.cancelEntries(this.active);
  }

  /**
   * Aborts every entry before invoking user cancellation callbacks. This ordering
   * guarantees that one faulty callback cannot keep sibling commands alive.
   */
  private cancelEntries(entries: Iterable<CancellationEntry>, reason?: unknown): boolean {
    const snapshot = [...entries].filter((entry) => !entry.controller.signal.aborted);
    if (snapshot.length === 0) return false;

    for (const entry of snapshot) {
      entry.controller.abort(reason);
    }

    for (const entry of snapshot) {
      try {
        entry.command.cancelHandler?.(entry.ctx);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        // Signal callbacks cannot await. The event machinery already isolates
        // listener failures, and attaching a rejection handler prevents an
        // unhandled rejection if an async error listener itself fails.
        void this.emit("error", error).catch(() => {});
      }
    }
    return true;
  }

  /**
   * Runs an async operation while routing SIGINT to active command cancellation,
   * with a force-quit escalation.
   *
   * The first Ctrl-C requests cooperative cancellation (aborting `ctx.signal` and
   * invoking cancel handlers). A cooperative command stops and the promise
   * resolves normally. A command that ignores cancellation cannot otherwise be
   * interrupted, so a second Ctrl-C — or a Ctrl-C that finds nothing left to
   * cancel — restores the terminal cursor and force-terminates the process with
   * the conventional 130 (128 + SIGINT) status. `onForceQuit` runs synchronously
   * before termination so callers (e.g. the shell) can persist state.
   */
  async runWithSigintCancel(
    action: () => Promise<void>,
    options: {
      onForceQuit?: () => void;
      onInterrupt?: () => boolean;
      stderr?: Writable;
    } = {},
  ): Promise<void> {
    // Where the "press Ctrl-C again" hint is written. For command execution the
    // router already tracks the in-flight stderr; a mode action supplies its own.
    const hintStream = options.stderr ?? this.currentStderr;
    // How a first interrupt is delivered. Defaults to cancelling the router's
    // active commands; callers running work outside the router (e.g. a mode
    // sub-REPL action) supply their own so cooperative cancellation still works.
    const interrupt = options.onInterrupt ?? (() => this.triggerCancel());
    // A later Ctrl-C escalates to a hard exit only after the cooperative cancel
    // has had time to take effect. A rapid repeat press within this window (part
    // of the same frustrated burst, while a command may still be mid-cleanup) is
    // coalesced so a command cancelling in good faith is not killed; a press after
    // it means the first interrupt clearly did not stop the command.
    const FORCE_QUIT_GRACE_MS = 250;
    let interruptRequested = false;
    let firstInterruptAt = 0;
    let forced = false;

    const forceQuit = () => {
      if (forced) return;
      forced = true;
      process.removeListener("SIGINT", onSigint);
      restoreCursor();
      try {
        options.onForceQuit?.();
      } catch {
        // Never let cleanup failure block termination.
      }
      process.exit(130);
    };

    const onSigint = () => {
      if (interruptRequested) {
        // A cancellation was already requested. If enough time has passed that the
        // command clearly ignored it, escalate to a hard exit; otherwise coalesce.
        if (Date.now() - firstInterruptAt >= FORCE_QUIT_GRACE_MS) forceQuit();
        return;
      }
      const newlyCancelled = interrupt();
      if (newlyCancelled) {
        interruptRequested = true;
        firstInterruptAt = Date.now();
        hintStream.write("\nInterrupted. Press Ctrl-C again to force quit.\n");
      } else {
        // Nothing was running to cancel; fall back to default termination.
        forceQuit();
      }
    };
    // Keep the listener installed until the execution boundary closes. A `once`
    // signal listener removes itself before invoking the callback, which can
    // restore Node's default SIGINT termination while cooperative cleanup is
    // still running.
    process.on("SIGINT", onSigint);
    try {
      await action();
    } finally {
      process.removeListener("SIGINT", onSigint);
    }
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
      signal?: AbortSignal;
    } = {},
  ): Promise<void> {
    await this.executeInternal(input, options);
  }

  private async executeInternal(
    input: string | string[],
    options: {
      shell?: Shell | null;
      stdin?: Readable | null;
      stdout?: Writable;
      stderr?: Writable;
      signal?: AbortSignal;
      cancellationScope?: CancellationScope;
    } = {},
  ): Promise<void> {
    const {
      shell = null,
      stdin = null,
      stdout = process.stdout,
      stderr = process.stderr,
      signal,
      cancellationScope,
    } = options;
    this.currentStderr = stderr;

    // Check for pipe chains (only for string input)
    if (typeof input === "string") {
      let segments: string[];
      try {
        segments = splitPipes(input);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        await this.emit("error", error);
        throw err;
      }
      if (segments.length > 1) {
        await this.executePiped(segments, { shell, stdin, stderr, stdout, signal });
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
          try {
            await this.catchHandler(rawInput, { stdout, stderr });
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            await this.emit("error", error);
            throw err;
          }
          return;
        }
        const err = new CommandNotFoundError(tokens[0] ?? rawInput.trim().split(/\s+/)[0]);
        await this.emit("error", err);
        throw err;
      }
      return;
    }

    const command = result.command as CommandDefinition;

    // Check --help flag
    if (result.builtInHelp) {
      if (this.helpGenerator) {
        const helpText = this.helpGenerator.generateCommand(result.commandPath);
        stdout.write(`${helpText}\n`);
      }
      return;
    }

    // Group command with no action → show help
    if (!command.action && (!result.extraArgs || result.extraArgs.length === 0)) {
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
      rawArgv: result.rawArgv,
      commandPath: this.registry.getCommandPath(command),
      shell,
      stdin,
      stdout,
      stderr,
      signal: controller.signal,
    };

    const activeEntry = { command, ctx, controller };
    this.active.add(activeEntry);
    cancellationScope?.add(activeEntry);

    const abortFromExternalSignal = () => this.cancelEntries([activeEntry], signal?.reason);
    if (signal?.aborted) {
      abortFromExternalSignal();
    } else {
      signal?.addEventListener("abort", abortFromExternalSignal, { once: true });
    }

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
          const displayName = argDef.variadic ? `...${argDef.name}` : argDef.name;
          throw new MissingArgumentError(displayName, usage);
        }
      }

      if (result.extraArgs && result.extraArgs.length > 0) {
        throw new ExtraArgumentError(result.extraArgs[0]);
      }

      // An actionless group with extra input reaches this point only to report
      // the unknown child above; the guard keeps the invariant explicit.
      if (!command.action) return;

      // Resolve options
      ctx.options = resolveOptions(result.options, command.options, ctx);

      // Run command-level validation
      if (command.validate) {
        await command.validate(ctx);
      }

      // Emit beforeExecute
      await this.emit("beforeExecute", ctx);

      await command.action(ctx);
      await this.emit("afterExecute", ctx);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      await this.emit("commandError", error, ctx);
      await this.emit("error", error);
      throw err;
    } finally {
      signal?.removeEventListener("abort", abortFromExternalSignal);
      cancellationScope?.delete(activeEntry);
      this.active.delete(activeEntry);
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
    options: {
      shell?: Shell | null;
      stdin?: Readable | null;
      stdout: Writable;
      stderr: Writable;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const { shell = null, stderr } = options;
    const stageScopes: CancellationScope[] = segments.map(() => new Set());
    let pipelineFailed = false;
    // Marks stages that were aborted purely because a downstream stage finished
    // early (a graceful stop), so their resulting rejection is not treated as a
    // pipeline failure — even if the action surfaces a generic abort error rather
    // than the {@link PipelineStopSignal} reason.
    const gracefullyStopped = segments.map(() => false);

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

    const destroyPipe = (pipe: PassThrough, error?: Error) => {
      if (!pipe.destroyed) {
        pipe.destroy(error);
      }
      pipe.emit("drain");
      queueMicrotask(() => pipe.emit("drain"));
    };

    const runs = segments.map((segment, i) => {
      const isLast = i === segments.length - 1;
      const stdin: Readable | null = i === 0 ? (options.stdin ?? null) : pipes[i - 1];
      const stdout: Writable = isLast ? options.stdout : pipes[i];

      return this.executeInternal(segment, {
        shell,
        stdin,
        stdout,
        stderr,
        signal: options.signal,
        cancellationScope: stageScopes[i],
      })
        .then(() => {
          // Once this stage has completed successfully, close its upstream input
          // as well. This lets producers observe teardown when a downstream
          // stage intentionally stops early after consuming enough data.
          if (i > 0 && !pipes[i - 1].destroyed) {
            destroyPipe(pipes[i - 1]);
          }
          // A downstream stage may intentionally stop after consuming enough
          // input. Abort every still-running upstream action, including actions
          // waiting on external I/O rather than on the pipe itself. This is a
          // graceful stop — mark those stages and abort with a sentinel reason so
          // the resulting rejection is not mistaken for a pipeline failure.
          if (i > 0) {
            for (let j = 0; j < i; j++) gracefullyStopped[j] = true;
            this.cancelEntries(
              stageScopes.slice(0, i).flatMap((scope) => [...scope]),
              new PipelineStopSignal(),
            );
          }
          // Signal end-of-input to the downstream stage.
          if (!isLast) pipes[i].end();
        })
        .catch((err) => {
          const error = err instanceof Error ? err : new Error(String(err));

          // Graceful early-stop: this upstream stage was aborted only because a
          // downstream stage finished and no longer needs its output. Close its
          // pipes but do NOT fail the pipeline (mirrors a `producer | head` where
          // the producer's SIGPIPE/abort is expected, not an error).
          if (isPipelineStop(error) || gracefullyStopped[i]) {
            if (i > 0 && !pipes[i - 1].destroyed) destroyPipe(pipes[i - 1]);
            if (!isLast && !pipes[i].destroyed) destroyPipe(pipes[i]);
            return;
          }

          // Tear down the ENTIRE chain on failure — both the downstream pipe and
          // any upstream pipes — so a backpressured upstream stage cannot hang
          // forever waiting on a consumer that has already failed.
          if (!pipelineFailed) {
            pipelineFailed = true;
            this.cancelEntries(
              stageScopes.flatMap((scope) => [...scope]),
              error,
            );
          }
          for (const pipe of pipes) {
            destroyPipe(pipe, error);
          }
          throw error;
        });
    });

    // Await every stage (allSettled, not all) so that when one stage fails and
    // tears the chain down, the resulting rejections of the other stages are
    // observed rather than surfacing as unhandled promise rejections. The first
    // failure is then re-thrown to the caller.
    const settled = await Promise.allSettled(runs);
    const failure = settled.find(
      (r) => r.status === "rejected" && !isPipelineStop((r as PromiseRejectedResult).reason),
    );
    if (failure) {
      throw (failure as PromiseRejectedResult).reason;
    }
  }
}

import { type Completer, createInterface, type Interface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/** Options for {@link openLineReader}. */
export interface LineReaderOptions {
  input: Readable;
  output: Writable;
  /** Whether readline runs in terminal mode (raw input, editing, SIGINT). */
  terminal: boolean;
  prompt?: string;
  /** Most-recent-first history, as readline expects it. */
  history?: string[];
  completer?: Completer;
}

/** A line reader session on one input stream. */
export interface LineReader {
  /**
   * The underlying interface, for prompt text, SIGINT and line editing. Close
   * the session through {@link LineReader.close}, never through this interface.
   */
  readonly rl: Interface;
  /**
   * Draws `query` (or the current prompt) and types back any unsubmitted text
   * the previous reader on this stream left behind.
   */
  prompt(query?: string): void;
  /**
   * Resolves with the next line, taking queued lines first; resolves `null` once
   * the input can deliver no more lines or the session is closed. Rejects with
   * the input's error, or with an `AbortError` when `signal` aborts.
   */
  read(signal?: AbortSignal): Promise<string | null>;
  /** Releases the input, leaving unread lines queued for the next reader. Idempotent. */
  close(): void;
}

interface InputState {
  lines: string[];
  /** Terminal text typed but not submitted when the last reader closed. */
  partial: string;
  open: boolean;
}

const inputStates = new WeakMap<Readable, InputState>();

function stateOf(input: Readable): InputState {
  let state = inputStates.get(input);
  if (!state) {
    state = { lines: [], partial: "", open: false };
    inputStates.set(input, state);
  }
  return state;
}

/** Whether the stream itself can deliver no more data. */
function streamFinished(input: Readable): boolean {
  return input.readableEnded || input.destroyed || input.readable === false;
}

/**
 * Whether `input` has nothing left for a reader: no queued line and a stream
 * that has ended, been destroyed or is no longer readable.
 */
export function inputExhausted(input: Readable): boolean {
  return (inputStates.get(input)?.lines.length ?? 0) === 0 && streamFinished(input);
}

/**
 * Opens a line reader on `options.input`. This is the one owner of line input
 * for prompts and the interactive shell.
 *
 * Readline delivers every line of a chunk at once, so lines can arrive while no
 * read is pending. They are queued per input stream rather than per reader, so
 * the next reader on the same stream (a later prompt, or the shell reopening
 * after a command) answers from them instead of losing them when the previous
 * interface closes. Terminal text typed but not submitted is carried the same
 * way and typed back in by the next {@link LineReader.prompt}.
 *
 * At most one reader is open per input stream. A reader settles its pending
 * read when the stream ends, is destroyed or errors, and holds no listener on
 * the stream once closed.
 *
 * @throws Error when another reader is already open on the same input.
 */
export function openLineReader(options: LineReaderOptions): LineReader {
  const { input, terminal } = options;
  const state = stateOf(input);
  if (state.open) {
    throw new Error("Another prompt is already reading from this input stream");
  }
  state.open = true;

  const rl = createInterface({
    input,
    output: options.output,
    terminal,
    prompt: options.prompt,
    history: options.history,
    completer: options.completer,
  });

  let closed = false;
  // An input that already ended emits no further `end`, so readline never
  // closes on its own; the stream state is checked on every read instead.
  let inputDone = streamFinished(input);
  let failure: { error: unknown } | undefined;
  let pending:
    | { resolve: (line: string | null) => void; reject: (err: unknown) => void }
    | undefined;

  const settle = (line: string | null) => {
    const waiter = pending;
    pending = undefined;
    waiter?.resolve(line);
  };
  const onLine = (line: string) => {
    if (pending) settle(line);
    else state.lines.push(line);
  };
  const onDone = () => {
    inputDone = true;
    settle(null);
  };
  const onError = (error: unknown) => {
    failure = { error };
    const waiter = pending;
    pending = undefined;
    waiter?.reject(error);
  };

  rl.on("line", onLine);
  rl.on("close", onDone);
  // Readline re-emits input errors on the interface.
  rl.on("error", onError);
  // A destroyed input never ends, so readline does not close for it.
  input.on("close", onDone);

  const close = () => {
    if (closed) return;
    closed = true;
    rl.off("line", onLine);
    rl.off("close", onDone);
    rl.off("error", onError);
    input.off("close", onDone);
    // A destroy this reader already saw emits its error on a later tick; take
    // it here rather than leave it unhandled once readline has let go.
    if (input.destroyed && !input.closed) {
      const swallow = () => undefined;
      input.on("error", swallow);
      input.once("close", () => input.off("error", swallow));
    }
    if (terminal && rl.line.length > 0) state.partial = rl.line;
    state.open = false;
    settle(null);
    rl.close();
  };

  const prompt = (query?: string) => {
    if (query !== undefined) rl.setPrompt(query);
    rl.prompt();
    if (terminal && state.partial !== "") {
      const carried = state.partial;
      state.partial = "";
      rl.write(carried);
    }
  };

  const read = (signal?: AbortSignal): Promise<string | null> => {
    const queued = state.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (failure) return Promise.reject(failure.error);
    if (input.errored) return Promise.reject(input.errored);
    if (closed || inputDone || streamFinished(input)) return Promise.resolve(null);
    if (signal?.aborted) return Promise.reject(abortError(signal));
    if (pending) return Promise.reject(new Error("A read is already pending on this line reader"));
    return new Promise<string | null>((resolve, reject) => {
      const onAbort = () => {
        pending = undefined;
        reject(abortError(signal as AbortSignal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const release = () => signal?.removeEventListener("abort", onAbort);
      pending = {
        resolve: (line) => {
          release();
          resolve(line);
        },
        reject: (err) => {
          release();
          reject(err);
        },
      };
    });
  };

  return { rl, prompt, read, close };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error && signal.reason.name === "AbortError"
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

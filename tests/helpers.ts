import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach } from "vitest";

/**
 * Creates a writable stream that captures output into a string buffer.
 */
export function createMockStdout(): Writable & { getOutput(): string } {
  let buffer = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });

  (stream as Writable & { getOutput(): string }).getOutput = () => buffer;

  return stream as Writable & { getOutput(): string };
}

/**
 * Creates a writable stream that mimics a TTY and captures output.
 */
export function createMockTTY(): Writable & { getOutput(): string; isTTY: true } {
  let buffer = "";

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString();
      callback();
    },
  });

  const ttyStream = stream as Writable & { getOutput(): string; isTTY: true };
  ttyStream.getOutput = () => buffer;
  (ttyStream as unknown as Record<string, boolean>).isTTY = true;

  return ttyStream;
}

/**
 * Creates a readable stream that can be fed input programmatically.
 */
export function createMockStdin(): Readable & { feed(input: string): void } {
  const stream = new Readable({
    read() {},
  });

  (stream as Readable & { feed(input: string): void }).feed = (input: string) => {
    stream.push(input);
  };

  return stream as Readable & { feed(input: string): void };
}

/**
 * Registers hooks that restore process-level state after every test in the
 * enclosing suite: the listed environment variables (each key individually,
 * never replacing `process.env`), `process.exitCode` and the `stdout`/`stderr`
 * write methods. Restoration runs on every exit path, including a failed expect.
 */
export function restoreProcessStateAfterEach(envKeys: readonly string[] = []): void {
  let env: Array<[string, string | undefined]> = [];
  let exitCode: typeof process.exitCode;
  let stdoutWrite: typeof process.stdout.write;
  let stderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    env = envKeys.map((key) => [key, process.env[key]]);
    exitCode = process.exitCode;
    stdoutWrite = process.stdout.write;
    stderrWrite = process.stderr.write;
  });

  afterEach(() => {
    for (const [key, value] of env) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.exitCode = exitCode;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  });
}

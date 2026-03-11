import { Readable, Writable } from "node:stream";

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

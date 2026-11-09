import type { Writable } from "node:stream";
import {
  type BarOptions,
  createLogger,
  type LoggerOptions,
  type LogLevel,
  type MultiBarOptions,
  progress,
  type SpinnerOptions,
} from "../../dist/index.js";

declare const text: string | undefined;
declare const count: number | undefined;
declare const flag: boolean | undefined;
declare const stream: Writable | undefined;
declare const level: LogLevel | undefined;
declare const format: BarOptions["format"] | undefined;
declare const style: BarOptions["style"] | undefined;
declare const frames: readonly string[] | undefined;

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into every options bag.
const bar: BarOptions = {
  total: 1,
  label: text,
  width: count,
  filled: text,
  empty: text,
  format,
  stderr: stream,
  style,
};
const spinner: SpinnerOptions = {
  label: text,
  frames,
  intervalMs: count,
  stderr: stream,
  style,
};
const multi: MultiBarOptions = { stderr: stream };
const logger: LoggerOptions = {
  level,
  prefix: text,
  timestamp: flag,
  stderr: stream,
  bufferLimit: count,
};

progress.bar(bar).stop();
progress.spinner(spinner).stop();
progress.multi(multi).stop();
createLogger(logger);

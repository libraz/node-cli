import type { Writable } from "node:stream";
import { type CLIOptions, createCLI, type StdioOptions } from "../../dist/index.js";

declare const text: string | undefined;
declare const size: number | undefined;
declare const stream: Writable | undefined;
declare const signal: AbortSignal | undefined;

// Under exactOptionalPropertyTypes, `string | undefined` values still flow into optional members.
const options: CLIOptions = {
  name: "app",
  version: text,
  prompt: text,
  description: text,
  banner: text,
  historyFile: text,
  historySize: size,
  historyFilter: undefined,
};
const cli = createCLI(options);

const stdio: StdioOptions = { stdin: null, stdout: stream, stderr: stream, signal };
void cli.exec(["a"], stdio);
void cli.execLine("a", { stdout: stream, signal });

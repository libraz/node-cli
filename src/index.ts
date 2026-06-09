export type { PluginContext } from "./cli.js";
export { CLI } from "./cli.js";
export type { CLIErrorCode } from "./errors.js";
export {
  CLIError,
  CommandNotFoundError,
  ExtraArgumentError,
  InvalidOptionError,
  MissingArgumentError,
  MissingOptionError,
  PromptCancelError,
  UnknownOptionError,
  ValidationError,
} from "./errors.js";
export {
  c,
  color,
  createColorizer,
  isColorEnabled,
  resetColorEnabled,
  setColorEnabled,
  stringWidth,
  stripAnsi,
} from "./output/color.js";
export type { Logger, LoggerOptions, LogLevel } from "./output/logger.js";
export { logger } from "./output/logger.js";
export type {
  Bar,
  BarOptions,
  BarState,
  MultiBar,
  Spinner,
  SpinnerOptions,
} from "./output/progress.js";
export { progress } from "./output/progress.js";
export type {
  Choice,
  ConfirmOptions,
  MultiselectOptions,
  PromptBaseOptions,
  SelectChoice,
  SelectOptions,
  TextOptions,
} from "./output/prompt.js";
export { maskInput, prompt } from "./output/prompt.js";
export type { TableChars, TableOptions, TableStyle } from "./output/table.js";
export { table } from "./output/table.js";
export type { ModeConfig } from "./shell/repl.js";
export type {
  Action,
  ArgDef,
  CatchContext,
  CLIEventHandler,
  CLIEventMap,
  CLIOptions,
  CommandContext,
  CommandDefinition,
  Completer,
  CompletionContext,
  OptionDef,
  OptionSchema,
  ParseResult,
} from "./types.js";

import { CLI } from "./cli.js";
import type { CLIOptions } from "./types.js";

/**
 * Factory function that creates and returns a new CLI instance.
 * @param options - Optional configuration options for the CLI application.
 * @returns A new CLI instance.
 */
export function createCLI(options?: CLIOptions): CLI {
  return new CLI(options);
}

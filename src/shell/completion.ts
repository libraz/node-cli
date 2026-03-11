import { tokenize } from "../command/parser.js";
import type { CommandRegistry } from "../command/registry.js";
import type { OptionDef } from "../types.js";

/**
 * Result of a completion operation.
 * May be synchronous (tuple) or asynchronous (Promise of tuple).
 */
export type CompletionResult = [string[], string];

/**
 * Provides tab-completion for the interactive shell.
 * Completes command names, subcommands, option flags, option values,
 * and custom command completers.
 * Tracks consecutive Tab presses to support iteration-based completion.
 */
export class ShellCompleter {
  private readonly registry: CommandRegistry;
  private tabCount = 0;
  private lastLine = "";

  /**
   * Creates a new ShellCompleter.
   * @param registry - The command registry used to look up commands and options.
   */
  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  /**
   * Computes completion candidates for the given input line.
   * Returns a tuple compatible with Node.js readline's completer interface,
   * or a Promise of one when async completers are involved.
   * @param line - The current input line to complete.
   * @returns A tuple of [completionCandidates, substringBeingCompleted] or a Promise thereof.
   */
  complete(line: string): CompletionResult | Promise<CompletionResult> {
    // Track consecutive Tab presses
    if (line === this.lastLine) {
      this.tabCount++;
    } else {
      this.tabCount = 1;
      this.lastLine = line;
    }

    const tokens = tokenize(line);
    const endsWithSpace = line.endsWith(" ");

    // Empty or just starting — show top-level commands (including aliases)
    if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
      const current = tokens[0] ?? "";
      const candidates = this.getTopLevelNames().filter((name) => name.startsWith(current));
      return [candidates, current];
    }

    // Try to match command path
    const match = this.registry.matchCommandPath(tokens);
    if (!match) {
      // No match — try completing first token as command
      const current = tokens[0];
      const candidates = this.getTopLevelNames().filter((name) => name.startsWith(current));
      return [candidates, current];
    }

    const { command, consumed } = match;
    const remaining = tokens.slice(consumed);

    // If we're at a command boundary and expecting subcommand
    if (command.subcommands.size > 0) {
      if (remaining.length === 0 && endsWithSpace) {
        // Show subcommands
        const candidates = [...command.subcommands.values()].map((s) => s.name);
        return [candidates, ""];
      }

      if (remaining.length === 1 && !endsWithSpace) {
        // Partial subcommand
        const current = remaining[0];
        const candidates = [...command.subcommands.values()]
          .map((s) => s.name)
          .filter((name) => name.startsWith(current));
        return [candidates, current];
      }
    }

    // Complete options
    const current = endsWithSpace ? "" : (remaining[remaining.length - 1] ?? "");
    const isTypingOption = current.startsWith("-");

    if (
      isTypingOption ||
      (endsWithSpace && remaining.length === 0 && command.subcommands.size === 0)
    ) {
      // Show option flags
      const candidates: string[] = [];
      for (const [, opt] of command.options) {
        if (opt.schema.hidden) continue;
        const flag = `--${opt.long}`;
        if (flag.startsWith(current)) {
          candidates.push(flag);
        }
        for (const alias of opt.aliases) {
          const shortFlag = `-${alias}`;
          if (shortFlag.startsWith(current)) {
            candidates.push(shortFlag);
          }
        }
      }
      if (candidates.length > 0) {
        return [candidates, current];
      }
    }

    // Check if previous token is an option that accepts a value — complete its value
    if (remaining.length > 0) {
      const optDef = this.findPrecedingOption(remaining, endsWithSpace, command.options);
      if (optDef) {
        const valueCurrent = endsWithSpace ? "" : current;
        return this.completeOptionValue(optDef, valueCurrent);
      }
    }

    // Custom command completer
    if (command.completer) {
      const commandPath = tokens.slice(0, consumed);
      const result = command.completer({
        line,
        current,
        commandPath,
        args: {},
        options: {},
        iteration: this.tabCount,
      });
      if (result instanceof Promise) {
        return result.then((candidates) => [candidates, current] as CompletionResult);
      }
      return [result, current];
    }

    return [[], current];
  }

  /**
   * Returns all top-level command names including aliases.
   */
  private getTopLevelNames(): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const cmd of this.registry.allTopLevel()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        names.push(cmd.name);
        if (cmd.aliases) {
          for (const alias of cmd.aliases) {
            if (!seen.has(alias)) {
              seen.add(alias);
              names.push(alias);
            }
          }
        }
      }
    }
    return names;
  }

  /**
   * Finds the option definition for the token preceding the cursor position.
   * Returns undefined if the previous token is not an option that takes a value.
   */
  private findPrecedingOption(
    remaining: string[],
    endsWithSpace: boolean,
    options: Map<string, OptionDef>,
  ): OptionDef | undefined {
    // If ends with space, previous token is the last one; otherwise it's second-to-last
    const prevIndex = endsWithSpace ? remaining.length - 1 : remaining.length - 2;
    if (prevIndex < 0) return undefined;

    const prevToken = remaining[prevIndex];
    if (!prevToken.startsWith("-")) return undefined;

    const optName = prevToken.startsWith("--") ? prevToken.slice(2) : prevToken.slice(1);

    // Look up by long name
    const byLong = options.get(optName);
    if (byLong?.takesValue) return byLong;

    // Look up by alias
    for (const [, def] of options) {
      if (def.takesValue && def.aliases.includes(optName)) {
        return def;
      }
    }

    return undefined;
  }

  /**
   * Completes an option's value using its `autocomplete` or `choices` config.
   */
  private completeOptionValue(
    optDef: OptionDef,
    current: string,
  ): CompletionResult | Promise<CompletionResult> {
    const { autocomplete, choices } = optDef.schema;

    if (autocomplete) {
      if (Array.isArray(autocomplete)) {
        const candidates = autocomplete.filter((v) => v.startsWith(current));
        return [candidates, current];
      }
      // Function-based autocomplete
      const result = autocomplete(current);
      if (result instanceof Promise) {
        return result.then((candidates) => {
          const filtered = candidates.filter((v) => v.startsWith(current));
          return [filtered, current] as CompletionResult;
        });
      }
      const filtered = result.filter((v) => v.startsWith(current));
      return [filtered, current];
    }

    if (choices) {
      const candidates = choices.map(String).filter((v) => v.startsWith(current));
      return [candidates, current];
    }

    return [[], current];
  }
}

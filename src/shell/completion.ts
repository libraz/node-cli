import { tokenize } from "../command/parser.js";
import type { CommandRegistry } from "../command/registry.js";

/**
 * Provides tab-completion for the interactive shell.
 * Completes command names, subcommands, option flags, and option choices
 * based on the registered command definitions.
 */
export class ShellCompleter {
  private readonly registry: CommandRegistry;

  /**
   * Creates a new ShellCompleter.
   * @param registry - The command registry used to look up commands and options.
   */
  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  /**
   * Computes completion candidates for the given input line.
   * Returns a tuple compatible with Node.js readline's completer interface.
   * @param line - The current input line to complete.
   * @returns A tuple of [completionCandidates, substringBeingCompleted].
   */
  complete(line: string): [string[], string] {
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

    // Check if previous token is an option with choices
    if (endsWithSpace && remaining.length > 0) {
      const prevToken = remaining[remaining.length - 1];
      if (prevToken.startsWith("--")) {
        const optName = prevToken.slice(2);
        const def = command.options.get(optName);
        if (def?.schema.choices) {
          return [def.schema.choices.map(String), ""];
        }
      }
    }

    // Custom completer
    // Note: async completers are not supported by readline's sync completer
    // We return empty for now; async completion could be added later.

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
}

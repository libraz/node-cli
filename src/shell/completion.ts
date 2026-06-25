import { activePipeSegment, parse, tokenize } from "../command/parser.js";
import type { CommandRegistry } from "../command/registry.js";
import type { CommandDefinition, OptionDef } from "../types.js";

/**
 * Finds an option definition by one of its short/long aliases.
 */
function findOptionByAlias(name: string, options: Map<string, OptionDef>): OptionDef | undefined {
  for (const [, def] of options) {
    if (def.aliases.includes(name)) return def;
  }
  return undefined;
}

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

    // Complete within the active pipeline segment (the command the cursor is in),
    // mirroring how execution splits pipes — so `ls | gr<TAB>` completes `grep`,
    // not a candidate derived from the first stage.
    const segment = activePipeSegment(line);
    const tokens = tokenize(segment);
    const endsWithSpace = segment.endsWith(" ");

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
    const lastToken = remaining[remaining.length - 1] ?? "";
    const typingOption = !endsWithSpace && lastToken.startsWith("-");

    // If we're at a command boundary and expecting subcommand (but not when the
    // user is clearly typing an option flag, which should list options instead).
    if (command.subcommands.size > 0 && !typingOption) {
      if (remaining.length === 0 && endsWithSpace) {
        // Show subcommands plus the command's own option flags, so a group that
        // also declares options offers both at the boundary.
        const subs = [...new Set(command.subcommands.values())].map((s) => s.name);
        return [[...subs, ...this.optionFlags(command, "")], ""];
      }

      if (remaining.length === 1 && !endsWithSpace) {
        // Partial subcommand
        const current = remaining[0];
        const candidates = [...new Set(command.subcommands.values())]
          .map((s) => s.name)
          .filter((name) => name.startsWith(current));
        return [candidates, current];
      }
    }

    // Complete an inline option value: --opt=partial or -o=partial. Strip the
    // leading dashes generically so both long and short forms work (the previous
    // hard-coded slice(2) broke single-dash short options).
    if (typingOption) {
      const eq = lastToken.indexOf("=");
      if (eq !== -1) {
        const optName = lastToken.slice(0, eq).replace(/^-+/, "");
        const optDef = command.options.get(optName) ?? findOptionByAlias(optName, command.options);
        if (optDef?.takesValue) {
          const valuePrefix = lastToken.slice(eq + 1);
          return this.completeOptionValue(optDef, valuePrefix);
        }
      }
    }

    const current = endsWithSpace ? "" : (remaining[remaining.length - 1] ?? "");
    const isTypingOption = current.startsWith("-");

    // When the previous token is a value-taking option, complete its value (checked
    // before listing flags so `--region <TAB>` offers values, not more flags).
    if (!isTypingOption && remaining.length > 0) {
      const optDef = this.findPrecedingOption(remaining, endsWithSpace, command.options);
      if (optDef) {
        const valueCurrent = endsWithSpace ? "" : current;
        return this.completeOptionValue(optDef, valueCurrent);
      }
    }

    // Show option flags when the user is typing one, or at a fresh token position
    // on a leaf command — including after positional arguments have been entered.
    if (isTypingOption || (endsWithSpace && command.subcommands.size === 0)) {
      const candidates = this.optionFlags(command, current);
      if (candidates.length > 0) {
        return [candidates, current];
      }
    }

    // Custom command completer
    if (command.completer) {
      // Use the canonical command path (aliases resolved to real names) so the
      // completer always sees the same path regardless of which alias was typed.
      const commandPath = this.registry.getCommandPath(command);
      // Best-effort parse of what has been typed so far, so the completer can
      // make context-aware suggestions. Parsing never throws here.
      let parsedArgs: Record<string, unknown> = {};
      let parsedOptions: Record<string, unknown> = {};
      try {
        const parsed = parse(tokens, this.registry);
        parsedArgs = parsed.args;
        parsedOptions = parsed.options;
      } catch {
        // Ignore parse failures during completion (partial/invalid input).
      }
      const filterByPrefix = (candidates: string[]) =>
        current ? candidates.filter((v) => v.startsWith(current)) : candidates;
      const result = command.completer({
        line,
        current,
        commandPath,
        args: parsedArgs,
        options: parsedOptions,
        iteration: this.tabCount,
      });
      if (result instanceof Promise) {
        return result.then(
          (candidates) => [filterByPrefix(candidates), current] as CompletionResult,
        );
      }
      return [filterByPrefix(result), current];
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
   * Returns a command's visible option flags (long form and short aliases) that
   * start with the given prefix.
   */
  private optionFlags(command: CommandDefinition, prefix: string): string[] {
    const candidates: string[] = [];
    for (const [, opt] of command.options) {
      if (opt.schema.hidden) continue;
      const flag = `--${opt.long}`;
      if (flag.startsWith(prefix)) candidates.push(flag);
      for (const alias of opt.aliases) {
        const shortFlag = `-${alias}`;
        if (shortFlag.startsWith(prefix)) candidates.push(shortFlag);
      }
    }
    return candidates;
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

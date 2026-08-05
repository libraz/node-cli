import {
  activePipeSegment,
  helpFlagBindings,
  parse,
  stripOptionPrefix,
  tokenize,
} from "../command/parser.js";
import { type CommandRegistry, hasUnreachableSubcommands } from "../command/registry.js";
import { ParseError } from "../errors.js";
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

/** Upper bound for a custom completion provider so readline can always resume. */
export const COMPLETION_TIMEOUT_MS = 1_000;

/**
 * Provides tab-completion for the interactive shell.
 * Completes command names, subcommands, option flags, option values,
 * and custom command completers.
 * Tracks consecutive Tab presses to support iteration-based completion.
 */
export class ShellCompleter {
  private readonly registry: CommandRegistry;
  private readonly hasVersion: boolean;
  private readonly completionTimeoutMs: number;
  private tabCount = 0;
  private lastLine = "";

  /**
   * Creates a new ShellCompleter.
   * @param registry - The command registry used to look up commands and options.
   */
  constructor(
    registry: CommandRegistry,
    options: { hasVersion?: boolean; completionTimeoutMs?: number } = {},
  ) {
    this.registry = registry;
    this.hasVersion = options.hasVersion ?? false;
    this.completionTimeoutMs = options.completionTimeoutMs ?? COMPLETION_TIMEOUT_MS;
  }

  /** Resets progressive completion state for a new readline prompt. */
  reset(): void {
    this.tabCount = 0;
    this.lastLine = "";
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
    const tokenization = this.tokenizeIncomplete(segment);
    if (!tokenization) return [[], segment];
    const { tokens, incompleteQuote } = tokenization;
    const endsWithSpace = /\s$/.test(segment);

    // An opening quote by itself tokenizes to an empty token after synthetic
    // closure. It is not the same as an empty command line, so do not enumerate
    // every top-level command in the middle of editing it.
    if (incompleteQuote && tokens.length === 1 && tokens[0] === "") return [[], ""];

    // Empty or just starting — show top-level commands (including aliases)
    if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
      const current = tokens[0] ?? "";
      const candidates = this.getTopLevelNames().filter((name) => name.startsWith(current));
      return [candidates, current];
    }

    // Try to match command path
    if (tokens.length > 1 && !endsWithSpace) {
      const parentMatch = this.registry.matchCommandPath(tokens.slice(0, -1));
      const partial = tokens[tokens.length - 1];
      if (
        parentMatch?.command.subcommands.size &&
        parentMatch.consumed === tokens.length - 1 &&
        !hasUnreachableSubcommands(parentMatch.command) &&
        !partial.startsWith("-")
      ) {
        const candidates = this.subcommandNames(parentMatch.command).filter((name) =>
          name.startsWith(partial),
        );
        if (candidates.length > 0) return [candidates, partial];
      }
    }

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
    const doubleDashIndex = remaining.indexOf("--");
    const pastDoubleDash =
      doubleDashIndex !== -1 && (endsWithSpace || doubleDashIndex < remaining.length - 1);
    const optionScopeRemaining = pastDoubleDash ? remaining.slice(0, doubleDashIndex) : remaining;
    const positionalScopeRemaining = pastDoubleDash
      ? remaining.slice(doubleDashIndex + 1)
      : remaining;
    const currentRemaining = pastDoubleDash ? positionalScopeRemaining : remaining;
    const currentLastToken = currentRemaining[currentRemaining.length - 1] ?? "";
    const typingOption = !pastDoubleDash && !endsWithSpace && lastToken.startsWith("-");

    // If we're at a command boundary and expecting subcommand (but not when the
    // user is clearly typing an option flag, which should list options instead).
    // Unreachable subcommands (a runnable arg-taking command shadows them) are
    // never offered, matching what the parser would actually dispatch.
    if (command.subcommands.size > 0 && !typingOption && !hasUnreachableSubcommands(command)) {
      if (remaining.length === 0 && endsWithSpace) {
        // Show subcommands plus the command's own option flags, so a group that
        // also declares options offers both at the boundary.
        const subs = this.subcommandNames(command);
        return [[...subs, ...this.optionFlags(command, "")], ""];
      }

      if (remaining.length === 1 && !endsWithSpace) {
        // Partial subcommand
        const current = remaining[0];
        const candidates = this.subcommandNames(command).filter((name) => name.startsWith(current));
        if (candidates.length > 0) return [candidates, current];
      }
    }

    // Complete an inline option value: --opt=partial or -o=partial. Strip the
    // leading dashes generically so both long and short forms work (the previous
    // hard-coded slice(2) broke single-dash short options).
    if (typingOption) {
      const eq = lastToken.indexOf("=");
      if (eq !== -1) {
        const optName = stripOptionPrefix(lastToken.slice(0, eq));
        const optDef = command.options.get(optName) ?? findOptionByAlias(optName, command.options);
        if (optDef?.takesValue) {
          const valuePrefix = lastToken.slice(eq + 1);
          return this.completeOptionValue(optDef, valuePrefix);
        }
      }
    }

    const current = endsWithSpace ? "" : currentLastToken;
    const isTypingOption = !pastDoubleDash && current.startsWith("-");

    // When the previous token is a value-taking option, complete its value (checked
    // before listing flags so `--region <TAB>` offers values, not more flags).
    if (!pastDoubleDash && !isTypingOption && optionScopeRemaining.length > 0) {
      const optDef = this.findPrecedingOption(optionScopeRemaining, endsWithSpace, command.options);
      if (optDef) {
        const valueCurrent = endsWithSpace ? "" : current;
        return this.completeOptionValue(optDef, valueCurrent);
      }
    }

    // Show option flags when the user is typing one, or at a fresh token position
    // on a leaf command — including after positional arguments have been entered.
    // Never past `--`: everything after it is a literal positional the parser
    // would not accept as an option, so offering flags there is misleading.
    if (
      isTypingOption ||
      (endsWithSpace && !pastDoubleDash && command.subcommands.size === 0 && !command.completer)
    ) {
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
        formatCompletionCandidates(candidates, current);
      let result: ReturnType<NonNullable<CommandDefinition["completer"]>>;
      const controller = new AbortController();
      try {
        result = command.completer({
          line: segment,
          fullLine: line,
          current,
          commandPath,
          args: parsedArgs,
          options: parsedOptions,
          iteration: this.tabCount,
          signal: controller.signal,
        });
      } catch {
        return [[], current];
      }
      if (result instanceof Promise) {
        return this.completeWithTimeout(result, current, controller, filterByPrefix);
      }
      return [filterByPrefix(result), current];
    }

    return [[], current];
  }

  private completeWithTimeout(
    result: Promise<string[]>,
    current: string,
    controller: AbortController,
    filterByPrefix: (candidates: string[]) => string[],
  ): Promise<CompletionResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve([[], current]);
      }, this.completionTimeoutMs);
      void result.then(
        (candidates) => {
          clearTimeout(timer);
          resolve([filterByPrefix(candidates), current]);
        },
        () => {
          clearTimeout(timer);
          resolve([[], current]);
        },
      );
    });
  }

  /**
   * Returns all top-level command names including aliases.
   */
  private getTopLevelNames(): string[] {
    const names: string[] = ["--help", "-h"];
    if (this.hasVersion) names.push("--version", "-V");
    const seen = new Set<string>();
    for (const cmd of this.registry.allTopLevel()) {
      if (cmd.hidden) continue;
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
    if (!this.registry.resolve(["exit"])) names.push("exit");
    if (!this.registry.resolve(["quit"])) names.push("quit");
    return names;
  }

  private subcommandNames(command: CommandDefinition): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const sub of new Set(command.subcommands.values())) {
      if (sub.hidden) continue;
      for (const name of [sub.name, ...(sub.aliases ?? [])]) {
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
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
    // Only offer the built-in help flags in the forms the parser actually treats
    // as help — i.e. when the command has not bound `--help` / `-h` to one of its
    // own options. This keeps completion in step with help output and the parser,
    // and avoids a duplicate `-h` when an option already uses that alias.
    const bindsHelp = helpFlagBindings(command.options);
    if (!bindsHelp.long && "--help".startsWith(prefix)) candidates.push("--help");
    if (!bindsHelp.short && "-h".startsWith(prefix)) candidates.push("-h");
    for (const [, opt] of command.options) {
      if (opt.schema.hidden) continue;
      const flag = `--${opt.long}`;
      if (flag.startsWith(prefix)) candidates.push(flag);
      if (opt.schema.type === "boolean") {
        const negated = `--no-${opt.long}`;
        if (negated.startsWith(prefix)) candidates.push(negated);
      }
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
        const candidates = formatCompletionCandidates(autocomplete, current);
        return [candidates, current];
      }
      // Function-based autocomplete
      let result: ReturnType<Exclude<typeof autocomplete, string[]>>;
      try {
        result = autocomplete(current);
      } catch {
        return [[], current];
      }
      if (result instanceof Promise) {
        return result
          .then((candidates) => {
            const filtered = formatCompletionCandidates(candidates, current);
            return [filtered, current] as CompletionResult;
          })
          .catch(() => [[], current] as CompletionResult);
      }
      const filtered = formatCompletionCandidates(result, current);
      return [filtered, current];
    }

    if (choices) {
      const candidates = formatCompletionCandidates(choices.map(String), current);
      return [candidates, current];
    }

    return [[], current];
  }

  /** Tokenizes a line under active editing by synthetically closing its quote. */
  private tokenizeIncomplete(
    line: string,
  ): { tokens: string[]; incompleteQuote: boolean } | undefined {
    try {
      return { tokens: tokenize(line), incompleteQuote: false };
    } catch (error) {
      if (!(error instanceof ParseError) || !error.quote) return undefined;
      const closer = error.quote === "single" ? "'" : '"';
      try {
        return { tokens: tokenize(`${line}${closer}`), incompleteQuote: true };
      } catch {
        return undefined;
      }
    }
  }
}

/**
 * Filters candidates against their semantic value, then quotes whitespace and
 * shell-sensitive characters so readline can insert a single valid argv token.
 */
function formatCompletionCandidates(candidates: string[], current: string): string[] {
  return (
    current ? candidates.filter((candidate) => candidate.startsWith(current)) : candidates
  ).map((candidate) => candidate.replace(/([\\\s'"`])/g, "\\$1"));
}

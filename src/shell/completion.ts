import {
  activePipeSegment,
  formatOptionFlag,
  helpFlagBindings,
  parse,
  resolveOptionName,
  stripOptionPrefix,
  tokenize,
} from "../command/parser.js";
import { type CommandRegistry, hasUnreachableSubcommands } from "../command/registry.js";
import { ParseError } from "../errors.js";
import type { CommandDefinition, OptionDef } from "../types.js";

/**
 * Result of a completion operation.
 * May be synchronous (tuple) or asynchronous (Promise of tuple).
 */
export type CompletionResult = [string[], string];

/** Upper bound for a custom completion provider so readline can always resume. */
export const COMPLETION_TIMEOUT_MS = 1_000;

/**
 * Caps a user-supplied completion provider so readline can always resume.
 * Every path that hands a provider's promise to readline goes through here:
 * a provider that never settles, settles late, or rejects all resolve to
 * `fallback` instead of leaving the interface paused. When the caller owns an
 * `AbortController`, a timeout aborts it so the provider can stop early.
 */
function withCompletionTimeout<T>(
  result: Promise<T>,
  fallback: T,
  timeoutMs: number,
  controller?: AbortController,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      controller?.abort();
      resolve(fallback);
    }, timeoutMs);
    void result.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

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
    // What readline will replace: the word under the cursor in its raw spelling.
    const rawCurrent = endsWithSpace ? "" : rawTokenSuffix(segment);

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
        const optDef = resolveOptionName(optName, command.options);
        if (optDef?.takesValue) {
          const valuePrefix = lastToken.slice(eq + 1);
          // Only the value part is being replaced, so drop the `--opt=` head
          // from the raw word as well.
          const rawEq = rawCurrent.indexOf("=");
          return this.completeOptionValue(
            optDef,
            valuePrefix,
            rawEq === -1 ? valuePrefix : rawCurrent.slice(rawEq + 1),
          );
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
        return this.completeOptionValue(optDef, valueCurrent, rawCurrent);
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
        return [[], rawCurrent];
      }
      if (result instanceof Promise) {
        return this.completeWithTimeout(result, rawCurrent, controller, filterByPrefix);
      }
      return [filterByPrefix(result), rawCurrent];
    }

    return [[], rawCurrent];
  }

  private completeWithTimeout(
    result: Promise<string[]>,
    completeOn: string,
    controller: AbortController,
    filterByPrefix: (candidates: string[]) => string[],
  ): Promise<CompletionResult> {
    // Filtering happens inside the capped promise so a throwing filter fails the
    // same way a rejecting provider does, rather than leaving readline paused.
    return withCompletionTimeout(
      result.then((candidates) => [filterByPrefix(candidates), completeOn] as CompletionResult),
      [[], completeOn],
      this.completionTimeoutMs,
      controller,
    );
  }

  /**
   * Runs a caller-supplied completion provider under the same deadline as the
   * built-in paths. The interactive shell uses this for a mode's own completer,
   * which readline drives directly rather than through {@link complete}.
   * @param provider - Invoked once; a synchronous throw yields `fallback`.
   * @param fallback - Result used when the provider throws, rejects, or times out.
   */
  runProvider(
    provider: () => CompletionResult | Promise<CompletionResult>,
    fallback: CompletionResult,
  ): CompletionResult | Promise<CompletionResult> {
    let result: CompletionResult | Promise<CompletionResult>;
    try {
      result = provider();
    } catch {
      return fallback;
    }
    if (!(result instanceof Promise)) return result;
    return withCompletionTimeout(result, fallback, this.completionTimeoutMs);
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
        // Spell the alias the way the parser accepts it; a multi-character alias
        // rendered with one dash is a suggestion the parser would reject.
        const aliasFlag = formatOptionFlag(alias);
        if (aliasFlag.startsWith(prefix)) candidates.push(aliasFlag);
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

    const def = resolveOptionName(stripOptionPrefix(prevToken), options);
    return def?.takesValue ? def : undefined;
  }

  /**
   * Completes an option's value using its `autocomplete` or `choices` config.
   */
  private completeOptionValue(
    optDef: OptionDef,
    current: string,
    rawCurrent: string,
  ): CompletionResult | Promise<CompletionResult> {
    const { autocomplete, choices } = optDef.schema;

    if (autocomplete) {
      if (Array.isArray(autocomplete)) {
        const candidates = formatCompletionCandidates(autocomplete, current);
        return [candidates, rawCurrent];
      }
      // Function-based autocomplete
      let result: ReturnType<Exclude<typeof autocomplete, string[]>>;
      try {
        result = autocomplete(current);
      } catch {
        return [[], rawCurrent];
      }
      if (result instanceof Promise) {
        return withCompletionTimeout(
          result.then(
            (candidates) =>
              [formatCompletionCandidates(candidates, current), rawCurrent] as CompletionResult,
          ),
          [[], rawCurrent],
          this.completionTimeoutMs,
        );
      }
      const filtered = formatCompletionCandidates(result, current);
      return [filtered, rawCurrent];
    }

    if (choices) {
      const candidates = formatCompletionCandidates(choices.map(String), current);
      return [candidates, rawCurrent];
    }

    return [[], rawCurrent];
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
 * The escape set covers everything the framework's own tokenizer and pipe
 * splitter treat as syntax, so a candidate survives a round trip through them.
 */
function formatCompletionCandidates(candidates: string[], current: string): string[] {
  return (
    current ? candidates.filter((candidate) => candidate.startsWith(current)) : candidates
  ).map((candidate) => candidate.replace(/([\\\s'"`|])/g, "\\$1"));
}

/**
 * The word under the cursor exactly as it appears in the line, quoting and
 * escaping included. Readline replaces the trailing `completeOn.length`
 * characters with the chosen candidate, so a completion that inserts an escaped
 * candidate must report the raw text it replaces rather than the tokenizer's
 * unescaped value — otherwise the arithmetic slices the wrong number of
 * characters and corrupts the line.
 */
function rawTokenSuffix(segment: string): string {
  let start = 0;
  let quote: string | undefined;
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i];
    if (!quote && char === "\\") {
      i++;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) start = i + 1;
  }
  return segment.slice(start);
}

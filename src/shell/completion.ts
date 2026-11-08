import {
  activePipeSegment,
  formatOptionFlag,
  helpFlagBindings,
  negatedFlag,
  parse,
  resolveOptionName,
  scanWords,
  stripOptionPrefix,
} from "../command/parser.js";
import {
  type CommandRegistry,
  hasUnreachableSubcommands,
  visibleSubcommands,
} from "../command/registry.js";
import { guardCall } from "../guard.js";
import { renderSafe } from "../output/color.js";
import type { CommandDefinition, Completer, CompletionContext, OptionDef } from "../types.js";
import { SHELL_COMMANDS } from "./builtins.js";

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
    this.countTab(line);

    // Complete within the active pipeline segment (the command the cursor is in),
    // mirroring how execution splits pipes — so `ls | gr<TAB>` completes `grep`,
    // not a candidate derived from the first stage.
    const segment = activePipeSegment(line);
    const { words, openQuote, atBoundary: endsWithSpace } = scanWords(segment);
    const tokens = words.map((word) => word.value);
    // What readline will replace: the word under the cursor in its raw spelling.
    const rawCurrent = endsWithSpace ? "" : (words[words.length - 1]?.raw ?? "");

    // An opening quote by itself scans to an empty word. It is not the same as
    // an empty command line, so do not enumerate every top-level command in the
    // middle of editing it.
    if (openQuote && tokens.length === 1 && tokens[0] === "") return [[], rawCurrent];

    // Empty or just starting — show top-level commands (including aliases)
    if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
      const current = tokens[0] ?? "";
      const candidates = this.getTopLevelNames().filter((name) => name.startsWith(current));
      return [candidates, rawCurrent];
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
        if (candidates.length > 0) return [candidates, rawCurrent];
      }
    }

    const match = this.registry.matchCommandPath(tokens);
    // Past an unknown first word there is nothing to complete: command names are
    // only offered while the cursor is still in that first word (handled above).
    if (!match) return [[], rawCurrent];

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
        if (candidates.length > 0) return [candidates, rawCurrent];
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
            (signal) => this.commandContext(command, tokens, segment, line, valuePrefix, signal),
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
        return this.completeOptionValue(optDef, valueCurrent, rawCurrent, (signal) =>
          this.commandContext(command, tokens, segment, line, valueCurrent, signal),
        );
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
        return [candidates, rawCurrent];
      }
    }

    // Custom command completer
    if (command.completer) {
      const controller = new AbortController();
      const ctx = this.commandContext(command, tokens, segment, line, current, controller.signal);
      return this.runCompleter(command.completer, ctx, controller, rawCurrent, (candidates) =>
        formatCompletionCandidates(candidates, current),
      );
    }

    return [[], rawCurrent];
  }

  /** Counts consecutive Tab presses on the same line; any other line restarts at 1. */
  private countTab(line: string): void {
    if (line === this.lastLine) {
      this.tabCount++;
    } else {
      this.tabCount = 1;
      this.lastLine = line;
    }
  }

  /**
   * Builds the completion context for a command: the canonical command path
   * (aliases resolved, so the completer sees one path whichever alias was
   * typed) and a best-effort parse of what has been typed so far.
   */
  private commandContext(
    command: CommandDefinition,
    tokens: string[],
    segment: string,
    line: string,
    current: string,
    signal: AbortSignal,
  ): CompletionContext {
    let args: Record<string, unknown> = {};
    let options: Record<string, unknown> = {};
    try {
      const parsed = parse(tokens, this.registry);
      args = parsed.args;
      options = parsed.options;
    } catch {
      // Ignore parse failures during completion (partial/invalid input).
    }
    return {
      line: segment,
      fullLine: line,
      current,
      commandPath: this.registry.getCommandPath(command),
      args,
      options,
      iteration: this.tabCount,
      signal,
    };
  }

  /**
   * Calls a completer under the completion deadline. A throw, a rejection or the
   * deadline yields no candidates; the deadline also aborts `controller`.
   * Formatting happens inside the capped promise so a throwing formatter fails
   * the same way a rejecting provider does, rather than leaving readline paused.
   */
  private runCompleter(
    completer: Completer,
    ctx: CompletionContext,
    controller: AbortController,
    completeOn: string,
    format: (candidates: unknown) => string[],
  ): CompletionResult | Promise<CompletionResult> {
    const result = guardCall<ReturnType<Completer> | undefined>(
      () => completer(ctx),
      () => undefined,
    );
    if (result === undefined) return [[], completeOn];
    if (!(result instanceof Promise)) return [format(result), completeOn];
    return withCompletionTimeout(
      result.then((candidates) => [format(candidates), completeOn] as CompletionResult),
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
    const result = guardCall<CompletionResult | Promise<CompletionResult> | undefined>(
      provider,
      () => undefined,
    );
    if (result === undefined) return fallback;
    const wellFormed = (value: unknown): CompletionResult => {
      if (!Array.isArray(value) || typeof value[1] !== "string") return fallback;
      return [safeCandidates(value[0]), value[1]];
    };
    if (!(result instanceof Promise)) return wellFormed(result);
    return withCompletionTimeout(result.then(wellFormed), fallback, this.completionTimeoutMs);
  }

  /**
   * Runs a shell mode's {@link Completer} for the whole input line. The mode's
   * context has `line` and `fullLine` set to the input, `current` set to the
   * last word (`""` at a word boundary), an empty command path, args and
   * options, and the same Tab counting and deadline signal as command
   * completion. Candidates are made terminal-safe but not filtered: the mode
   * owns its own matching.
   * @param completer - The mode's completer.
   * @param line - The input line readline is completing.
   * @returns The candidates paired with the word readline replaces.
   */
  async runModeProvider(completer: Completer, line: string): Promise<CompletionResult> {
    this.countTab(line);
    const { words, atBoundary } = scanWords(line);
    const last = atBoundary ? undefined : words[words.length - 1];
    const controller = new AbortController();
    const ctx: CompletionContext = {
      line,
      fullLine: line,
      current: last?.value ?? "",
      commandPath: [],
      args: {},
      options: {},
      iteration: this.tabCount,
      signal: controller.signal,
    };
    return this.runCompleter(completer, ctx, controller, last?.raw ?? "", safeCandidates);
  }

  /**
   * Returns all top-level command names including aliases.
   */
  private getTopLevelNames(): string[] {
    const names: string[] = ["--help", "-h"];
    if (this.hasVersion) names.push("--version", "-V");
    const seen = new Set<string>();
    for (const cmd of this.registry.visibleTopLevel()) {
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
    for (const name of SHELL_COMMANDS) {
      if (!this.registry.resolve([name])) names.push(name);
    }
    return names;
  }

  private subcommandNames(command: CommandDefinition): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const sub of visibleSubcommands(command)) {
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
      const negated = negatedFlag(opt, command.options);
      if (negated?.startsWith(prefix)) candidates.push(negated);
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
   * Completes an option's value using its `completer` or `choices` config.
   * @param context - Builds the completer's context; called only for a function completer.
   */
  private completeOptionValue(
    optDef: OptionDef,
    current: string,
    rawCurrent: string,
    context: (signal: AbortSignal) => CompletionContext,
  ): CompletionResult | Promise<CompletionResult> {
    const { completer, choices } = optDef.schema;

    if (completer) {
      if (typeof completer !== "function") {
        return [formatCompletionCandidates(completer, current), rawCurrent];
      }
      const controller = new AbortController();
      return this.runCompleter(
        completer,
        context(controller.signal),
        controller,
        rawCurrent,
        (candidates) => formatCompletionCandidates(candidates, current),
      );
    }

    if (choices) {
      const candidates = formatCompletionCandidates(choices.map(String), current);
      return [candidates, rawCurrent];
    }

    return [[], rawCurrent];
  }
}

/**
 * Makes a provider's return value safe to hand to readline: anything but an
 * array yields no candidates, non-string entries are dropped, and each string
 * goes through {@link renderSafe}. A candidate that still carries an escape
 * sequence afterwards (styling survives `renderSafe`) is dropped, because
 * readline would both list and insert it verbatim.
 */
function safeCandidates(candidates: unknown): string[] {
  if (!Array.isArray(candidates)) return [];
  const safe: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const clean = renderSafe(candidate, { singleLine: true });
    if (!clean.includes("\x1b")) safe.push(clean);
  }
  return safe;
}

/**
 * Filters candidates against their semantic value, then quotes whitespace and
 * shell-sensitive characters so readline can insert a single valid argv token.
 * The escape set covers everything the framework's own tokenizer and pipe
 * splitter treat as syntax, so a candidate survives a round trip through them.
 * Never throws, whatever the provider returned.
 */
function formatCompletionCandidates(candidates: unknown, current: string): string[] {
  const safe = safeCandidates(candidates);
  return (current ? safe.filter((candidate) => candidate.startsWith(current)) : safe).map(
    (candidate) => candidate.replace(/([\\\s'"`|])/g, "\\$1"),
  );
}

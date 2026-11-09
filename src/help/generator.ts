import { formatOptionFlag, helpFlagBindings, negatedFlag } from "../command/parser.js";
import { type CommandRegistry, visibleSubcommands } from "../command/registry.js";
import { stringWidth } from "../output/color.js";
import { isShellCommand, shellCommandsLabel } from "../shell/builtins.js";
import type { ArgDef, CommandDefinition, OptionDef } from "../types.js";

/**
 * Generates human-readable help text for CLI commands.
 *
 * Supports both an overview index of all top-level commands and detailed
 * per-command help that includes usage, arguments, options, and subcommands.
 */
/**
 * Metadata about the CLI application, displayed in the help header.
 */
export interface HelpMetadata {
  name?: string;
  version?: string;
  description?: string;
}

export class HelpGenerator {
  private readonly registry: CommandRegistry;
  private readonly metadata: HelpMetadata;

  /**
   * Creates a new {@link HelpGenerator}.
   *
   * @param registry - The command registry to read command definitions from.
   * @param metadata - Optional metadata displayed in the help header.
   */
  constructor(registry: CommandRegistry, metadata: HelpMetadata = {}) {
    this.registry = registry;
    this.metadata = metadata;
  }

  /**
   * Generates the top-level help index listing all available commands.
   *
   * @param options.interactive - Whether the index is shown inside the
   *   interactive shell, which adds the shell's own commands. Defaults to false.
   * @returns A formatted multi-line string with command names and descriptions.
   */
  generateIndex(options: { interactive?: boolean } = {}): string {
    const commands = this.registry
      .visibleTopLevel()
      // The framework's own help command is registered before application
      // commands. Keep application registration order while listing that helper
      // last, so it does not occupy the first, most prominent command slot.
      .sort((left, right) => (left.name === "help" ? 1 : right.name === "help" ? -1 : 0));
    const shellLabel = options.interactive ? shellCommandsLabel(this.registry) : undefined;
    if (commands.length === 0) {
      return shellLabel ? `No commands available.\n\n${shellLabel}` : "No commands available.";
    }

    const lines: string[] = [];

    // Metadata header
    const { name, version, description } = this.metadata;
    if (name) {
      lines.push(version ? `${name} v${version}` : name);
    }
    if (description) {
      lines.push(description);
    }
    if (name || description) {
      lines.push("");
    }

    lines.push("Available commands:", "");

    const entries: [string, string][] = commands.map((cmd) => {
      const usage = formatCommandUsage(cmd);
      // Note aliases here too, matching the per-command subcommand listing, so a
      // command's alternate names are discoverable at every help depth.
      const aliasNote =
        cmd.aliases && cmd.aliases.length > 0 ? ` (alias: ${cmd.aliases.join(", ")})` : "";
      return [usage, `${cmd.description ?? ""}${aliasNote}`];
    });

    appendAlignedEntries(lines, entries);

    const optionEntries: [string, string][] = [["-h, --help", "Show help"]];
    if (version) optionEntries.push(["-V, --version", "Show the CLI version"]);
    lines.push("", "Options:");
    appendAlignedEntries(lines, optionEntries);
    lines.push("");
    if (shellLabel) lines.push(shellLabel);
    lines.push('Type "help <command>" for more information.');

    return lines.join("\n");
  }

  /**
   * Generates detailed help text for a specific command.
   *
   * The output includes usage, description, arguments, options, and
   * subcommands (if any).
   *
   * @param commandPath - The sequence of command/subcommand names
   *   (e.g. `["remote", "add"]`).
   * @returns A formatted multi-line help string, or an "Unknown command"
   *   message if the path cannot be resolved.
   */
  generateCommand(commandPath: string[]): string {
    // Resolve the way dispatch would: a runnable command that takes positional
    // arguments swallows every following token, so its subcommands have no help
    // page to show even though the registry still holds them.
    const match = this.registry.matchCommandPath(commandPath);
    const command = match && match.consumed === commandPath.length ? match.command : undefined;
    // The shell's own commands have no registry entry, so describe them here —
    // but never in place of an application command that took the same name.
    if (!command && commandPath.length === 1 && isShellCommand(commandPath[0])) {
      return `Usage: ${commandPath[0]}\n\nExit the interactive shell.`;
    }
    if (!command) return `Unknown command: ${commandPath.join(" ")}`;

    const lines: string[] = [];

    // Usage line — use the canonical command path so aliases resolve to the real name.
    lines.push(`Usage: ${formatUsage(this.registry.getCommandPath(command), command)}`);

    // Description
    if (command.description) {
      lines.push("", command.description);
    }

    // Aliases
    if (command.aliases && command.aliases.length > 0) {
      lines.push("", `Aliases: ${command.aliases.join(", ")}`);
    }

    // Arguments — listed in declaration order so the help matches the usage line.
    if (command.argDefs.length > 0) {
      lines.push("", "Arguments:");
      for (const arg of command.argDefs) {
        const label = arg.variadic ? `...${arg.name}` : arg.name;
        const suffix = arg.required ? " (required)" : "";
        lines.push(`  ${label}${suffix}`);
      }
    }

    // Options — advertise exactly the built-in help forms the parser still treats
    // as help. When `--help`/`-h` is bound to one of the command's own options
    // (e.g. `-h, --host`), only the remaining unbound form is shown, so a working
    // built-in flag is never hidden and a shadowed one is never falsely promised.
    const visibleOptions = [...command.options.values()].filter((o) => !o.schema.hidden);
    const optionEntries = formatOptionEntries(visibleOptions, command.options);
    const bindsHelp = helpFlagBindings(command.options);
    const helpForms: string[] = [];
    if (!bindsHelp.short) helpForms.push("-h");
    if (!bindsHelp.long) helpForms.push("--help");
    if (helpForms.length > 0) {
      optionEntries.push([helpForms.join(", "), "Show help for this command"]);
    }
    if (optionEntries.length > 0) {
      lines.push("", "Options:");
      appendAlignedEntries(lines, optionEntries);
    }

    // Subcommands — omitted when the command itself takes positional arguments,
    // because the parser would consume any subcommand name as an argument value,
    // making those subcommands unreachable. Advertising them would mislead.
    const visibleSubs = visibleSubcommands(command);
    if (visibleSubs.length > 0) {
      const subEntries: [string, string][] = visibleSubs.map((sub) => {
        const usage = formatCommandUsage(sub);
        const aliasNote =
          sub.aliases && sub.aliases.length > 0 ? ` (alias: ${sub.aliases.join(", ")})` : "";
        return [usage, `${sub.description ?? ""}${aliasNote}`];
      });
      lines.push("", "Commands:");
      appendAlignedEntries(lines, subEntries);
      lines.push("", `Type "help ${commandPath.join(" ")} <command>" for more information.`);
    }

    return lines.join("\n");
  }
}

/** Adds a two-column help listing, wrapping descriptions when terminal width is known. */
function appendAlignedEntries(lines: string[], entries: [string, string][]): void {
  const maxUsageWidth = Math.max(...entries.map(([usage]) => stringWidth(usage)));
  const descriptionIndent = maxUsageWidth + 6;
  const columns = process.stdout.columns;
  const descriptionWidth = columns === undefined ? undefined : columns - descriptionIndent;

  for (const [usage, description] of entries) {
    const padding = " ".repeat(maxUsageWidth - stringWidth(usage) + 4);
    if (!description || descriptionWidth === undefined || descriptionWidth < 10) {
      lines.push(`  ${usage}${description ? padding + description : ""}`);
      continue;
    }
    const words = description.split(/\s+/);
    const wrapped: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && stringWidth(candidate) > descriptionWidth) {
        wrapped.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) wrapped.push(current);
    lines.push(`  ${usage}${padding}${wrapped[0] ?? ""}`);
    for (const continuation of wrapped.slice(1)) {
      lines.push(`${" ".repeat(descriptionIndent)}${continuation}`);
    }
  }
}

/**
 * Builds a full usage string for a command: its path, an optional `<command>`
 * placeholder for actionless groups, its positional arguments, and an `[options]`
 * marker. Shared by the help generator and the router so a
 * single definition drives every usage string.
 *
 * @param commandPath - The command path to prefix (canonical or as typed).
 * @param command - The command definition supplying args/options/subcommands.
 * @returns The formatted usage string.
 */
export function formatUsage(
  commandPath: string[],
  command: Pick<CommandDefinition, "argDefs" | "options" | "subcommands" | "action">,
): string {
  const parts = [...commandPath];
  if (command.subcommands.size > 0 && !command.action) {
    parts.push("<command>");
  }
  for (const arg of command.argDefs) {
    parts.push(formatArgToken(arg));
  }
  parts.push("[options]");
  return parts.join(" ");
}

/**
 * Formats a single positional argument as its usage token: `<name>` (required),
 * `[name]` (optional), and `...name` for variadic. Shared by every usage
 * renderer so the bracketing rules live in one place.
 *
 * @param arg - The argument definition.
 * @returns The bracketed usage token.
 */
function formatArgToken(arg: ArgDef): string {
  const inner = arg.variadic ? `...${arg.name}` : arg.name;
  return arg.required ? `<${inner}>` : `[${inner}]`;
}

/**
 * Formats a single command's usage signature (name + arguments).
 *
 * @param cmd - The command definition to format.
 * @returns A string such as `"deploy <env> [--force]"`.
 */
function formatCommandUsage(cmd: CommandDefinition): string {
  const parts = [cmd.name];
  for (const arg of cmd.argDefs) {
    parts.push(formatArgToken(arg));
  }
  return parts.join(" ");
}

/**
 * Formats an array of option definitions into flag/description pairs.
 *
 * Each entry is a tuple of `[flags, description]` where `flags` contains
 * the short alias(es) and `--long` form, and `description` combines the
 * schema description, required marker, default value, and allowed choices.
 *
 * @param options - The visible option definitions to format.
 * @param allOptions - Every option of the command, used to decide which negations apply.
 * @returns An array of `[flags, description]` tuples.
 */
function formatOptionEntries(
  options: OptionDef[],
  allOptions: Map<string, OptionDef>,
): [string, string][] {
  return options.map((opt) => {
    const parts: string[] = [];

    // Short aliases first, then the long names in the order the flags string
    // declared them: the canonical name before its long aliases.
    const shortAliases = opt.aliases.filter((alias) => alias.length === 1);
    const longAliases = opt.aliases.filter((alias) => alias.length > 1);
    if (shortAliases.length > 0) {
      parts.push(`${shortAliases.map(formatOptionFlag).join(", ")},`);
    } else {
      parts.push("   ");
    }

    // Long names
    let longPart = [opt.long, ...longAliases].map((name) => `--${name}`).join(", ");
    if (opt.takesValue) {
      longPart += ` <${opt.valueName ?? opt.long}>`;
    }
    parts.push(longPart);

    const flags = parts.join(" ");

    // Description parts
    const descParts: string[] = [];
    if (opt.schema.description) descParts.push(opt.schema.description);
    if (opt.schema.required) descParts.push("(required)");
    // Show defaults, including boolean `true` (a meaningful, non-obvious default).
    // A boolean defaulting to `false` is the implicit default and is omitted.
    if (
      opt.schema.default !== undefined &&
      !(opt.schema.type === "boolean" && opt.schema.default === false)
    ) {
      descParts.push(`(default: ${formatDefaultValue(opt.schema.default)})`);
    }
    if (opt.schema.choices) {
      descParts.push(`[${opt.schema.choices.join(", ")}]`);
    }
    // Note the implicit negated form only when parsing it really negates this option.
    const negated = negatedFlag(opt, allOptions);
    if (negated) descParts.push(`(negate with ${negated})`);

    return [flags, descParts.join(" ")] as [string, string];
  });
}

/** Formats arbitrary option defaults without letting help rendering throw. */
function formatDefaultValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

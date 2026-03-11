import type { CommandRegistry } from "../command/registry.js";
import { stringWidth } from "../output/color.js";
import type { CommandDefinition, OptionDef } from "../types.js";

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
  private metadata: HelpMetadata;

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
   * Updates the metadata displayed in the help header.
   */
  setMetadata(metadata: HelpMetadata): void {
    this.metadata = metadata;
  }

  /**
   * Generates the top-level help index listing all available commands.
   *
   * @returns A formatted multi-line string with command names and descriptions.
   */
  generateIndex(): string {
    const commands = this.registry.allTopLevel();
    if (commands.length === 0) return "No commands available.\n";

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
      return [usage, cmd.description ?? ""];
    });

    const maxWidth = Math.max(...entries.map(([usage]) => stringWidth(usage)));

    for (const [usage, desc] of entries) {
      const padding = " ".repeat(maxWidth - stringWidth(usage) + 4);
      lines.push(`  ${usage}${desc ? padding + desc : ""}`);
    }

    lines.push("", 'Type "help <command>" for more information.');

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
    const command = this.registry.resolve(commandPath);
    if (!command) return `Unknown command: ${commandPath.join(" ")}`;

    const lines: string[] = [];

    // Usage line
    const usageParts = [...commandPath];
    if (command.subcommands.size > 0 && !command.action) {
      usageParts.push("<command>");
    }
    for (const arg of command.argDefs) {
      if (arg.variadic) {
        usageParts.push(arg.required ? `<...${arg.name}>` : `[...${arg.name}]`);
      } else {
        usageParts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
      }
    }
    if (command.options.size > 0) {
      usageParts.push("[options]");
    }
    lines.push(`Usage: ${usageParts.join(" ")}`);

    // Description
    if (command.description) {
      lines.push("", command.description);
    }

    // Aliases
    if (command.aliases && command.aliases.length > 0) {
      lines.push("", `Aliases: ${command.aliases.join(", ")}`);
    }

    // Arguments
    const requiredArgs = command.argDefs.filter((a) => a.required);
    const optionalArgs = command.argDefs.filter((a) => !a.required);
    if (command.argDefs.length > 0) {
      lines.push("", "Arguments:");
      for (const arg of [...requiredArgs, ...optionalArgs]) {
        const label = arg.variadic ? `...${arg.name}` : arg.name;
        const suffix = arg.required ? " (required)" : "";
        lines.push(`  ${label}${suffix}`);
      }
    }

    // Options
    const visibleOptions = [...command.options.values()].filter((o) => !o.schema.hidden);
    if (visibleOptions.length > 0) {
      lines.push("", "Options:");
      const optionEntries = formatOptionEntries(visibleOptions);
      const maxWidth = Math.max(...optionEntries.map(([flags]) => stringWidth(flags)));

      for (const [flags, desc] of optionEntries) {
        const padding = " ".repeat(maxWidth - stringWidth(flags) + 4);
        lines.push(`  ${flags}${desc ? padding + desc : ""}`);
      }
    }

    // Subcommands
    if (command.subcommands.size > 0) {
      lines.push("", "Commands:");
      // Deduplicate: aliases point to the same definition object
      const subEntries: [string, string][] = [...new Set(command.subcommands.values())].map(
        (sub) => {
          const usage = formatCommandUsage(sub);
          return [usage, sub.description ?? ""];
        },
      );
      const maxWidth = Math.max(...subEntries.map(([u]) => stringWidth(u)));

      for (const [usage, desc] of subEntries) {
        const padding = " ".repeat(maxWidth - stringWidth(usage) + 4);
        lines.push(`  ${usage}${desc ? padding + desc : ""}`);
      }

      lines.push("", `Type "help ${commandPath.join(" ")} <command>" for more information.`);
    }

    return lines.join("\n");
  }
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
    if (arg.variadic) {
      parts.push(arg.required ? `<...${arg.name}>` : `[...${arg.name}]`);
    } else {
      parts.push(arg.required ? `<${arg.name}>` : `[${arg.name}]`);
    }
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
 * @returns An array of `[flags, description]` tuples.
 */
function formatOptionEntries(options: OptionDef[]): [string, string][] {
  return options.map((opt) => {
    const parts: string[] = [];

    // Aliases
    if (opt.aliases.length > 0) {
      parts.push(`${opt.aliases.map((a) => `-${a}`).join(", ")},`);
    } else {
      parts.push("   ");
    }

    // Long name
    let longPart = `--${opt.long}`;
    if (opt.takesValue) {
      longPart += ` <${opt.long}>`;
    }
    parts.push(longPart);

    const flags = parts.join(" ");

    // Description parts
    const descParts: string[] = [];
    if (opt.schema.description) descParts.push(opt.schema.description);
    if (opt.schema.required) descParts.push("(required)");
    if (opt.schema.default !== undefined && opt.schema.type !== "boolean") {
      descParts.push(`(default: ${JSON.stringify(opt.schema.default)})`);
    }
    if (opt.schema.choices) {
      descParts.push(`[${opt.schema.choices.join(", ")}]`);
    }

    return [flags, descParts.join(" ")] as [string, string];
  });
}

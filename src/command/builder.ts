import type {
  Action,
  CommandContext,
  CommandDefinition,
  Completer,
  OptionSchema,
} from "../types.js";
import { parseDefinitionString, parseOptionFlags } from "./parser.js";
import type { CommandRegistry } from "./registry.js";

/**
 * Fluent builder for defining CLI commands and their options, actions, and subcommands.
 *
 * Instances are created internally when a new command is registered through the CLI
 * and are chained to configure the command incrementally.
 */
export class CommandBuilder {
  private readonly registry: CommandRegistry;
  private readonly definition: CommandDefinition;
  private readonly parentPath: string[];

  /**
   * Creates a new CommandBuilder and registers the command with the given registry.
   *
   * @param registry - The command registry that holds all registered commands.
   * @param definitionStr - A definition string describing the command name and its arguments (e.g., `"serve <port>"`).
   * @param parentPath - The path of parent command names leading to this command. Defaults to an empty array for root commands.
   */
  constructor(registry: CommandRegistry, definitionStr: string, parentPath: string[] = []) {
    this.registry = registry;

    const { parentPath: defParent, name, argDefs } = parseDefinitionString(definitionStr);

    this.parentPath = [...parentPath, ...defParent];

    this.definition = {
      name,
      argDefs,
      options: new Map(),
      subcommands: new Map(),
    };

    registry.register(this.definition, this.parentPath);
  }

  /**
   * Sets a human-readable description for this command, used in help output.
   *
   * @param text - The description text.
   * @returns This builder instance for chaining.
   */
  description(text: string): this {
    this.definition.description = text;
    return this;
  }

  /**
   * Adds an option to this command.
   *
   * The flags string may contain short and long forms separated by commas,
   * with an optional value placeholder (e.g., `"-p, --port <number>"`).
   * If no type is provided in the schema, it is inferred from the flag format.
   *
   * @param flags - The option flags string.
   * @param schema - Optional schema describing the option's type, default value, etc.
   * @returns This builder instance for chaining.
   */
  option(flags: string, schema: OptionSchema = {}): this {
    const { long, aliases, takesValue } = parseOptionFlags(flags);

    // Infer type from flag format
    if (!schema.type) {
      schema.type = takesValue ? "string" : "boolean";
    }

    // Default boolean to false
    if (schema.type === "boolean" && schema.default === undefined) {
      schema.default = false;
    }

    this.definition.options.set(long, {
      long,
      aliases,
      takesValue,
      schema,
    });

    return this;
  }

  /**
   * Sets the action handler that is invoked when this command is executed.
   *
   * @param fn - The async (or sync) function to run when the command matches.
   * @returns This builder instance for chaining.
   */
  action(fn: Action): this {
    this.definition.action = fn;
    return this;
  }

  /**
   * Sets a custom tab-completion function for this command.
   *
   * @param fn - The completer function that returns completion candidates.
   * @returns This builder instance for chaining.
   */
  complete(fn: Completer): this {
    this.definition.completer = fn;
    return this;
  }

  /**
   * Adds one or more aliases for this command.
   *
   * @param names - Alias names that can be used to invoke this command.
   * @returns This builder instance for chaining.
   */
  alias(...names: string[]): this {
    if (!this.definition.aliases) {
      this.definition.aliases = [];
    }
    this.definition.aliases.push(...names);
    this.registry.registerAliases(this.definition, this.parentPath);
    return this;
  }

  /**
   * Sets a pre-action validator for this command.
   * The validator receives the command context and should throw to reject execution.
   *
   * @param fn - The validation function.
   * @returns This builder instance for chaining.
   */
  validate(fn: (ctx: CommandContext) => void | Promise<void>): this {
    this.definition.validate = fn;
    return this;
  }

  /**
   * Sets a handler invoked when SIGINT is received during this command's execution.
   *
   * @param fn - The cancel handler function.
   * @returns This builder instance for chaining.
   */
  cancel(fn: (ctx: CommandContext) => void): this {
    this.definition.cancelHandler = fn;
    return this;
  }

  /**
   * Removes this command from the registry.
   *
   * @returns True if the command was found and removed, false otherwise.
   */
  remove(): boolean {
    return this.registry.unregister([...this.parentPath, this.definition.name]);
  }

  /**
   * Registers a subcommand under this command and returns a new builder for it.
   *
   * @param definitionStr - The definition string for the subcommand (e.g., `"list [filter]"`).
   * @returns A new {@link CommandBuilder} for configuring the subcommand.
   */
  command(definitionStr: string): CommandBuilder {
    const fullParentPath = [...this.parentPath, this.definition.name];
    return new CommandBuilder(this.registry, definitionStr, fullParentPath);
  }
}

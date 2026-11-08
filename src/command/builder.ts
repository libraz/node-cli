import { usageError } from "../errors.js";
import { coerceOptionValue } from "../option/resolver.js";
import type {
  Action,
  AddOption,
  CancelHandler,
  CheckedOptionSchema,
  CommandDefinition,
  CommandValidator,
  Completer,
  DefinitionArgs,
  OptionSchema,
} from "../types.js";
import { parseDefinitionString, parseOptionFlags, stripOptionPrefix } from "./parser.js";
import type { CommandRegistry } from "./registry.js";

/**
 * The builder `command()` returns for a definition string: typed arguments and
 * no options yet for a literal, untyped records otherwise.
 */
export type CommandBuilderFor<D extends string> = string extends D
  ? CommandBuilder
  : CommandBuilder<DefinitionArgs<D>, Record<never, never>>;

/**
 * Fluent builder for defining CLI commands and their options, actions, and subcommands.
 *
 * Instances are created internally when a new command is registered through the CLI
 * and are chained to configure the command incrementally. `A` and `O` are the
 * types of `ctx.args` and `ctx.options` the handlers receive; each `.option()`
 * adds its key to `O`.
 */
export class CommandBuilder<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> {
  private readonly registry: CommandRegistry;
  private readonly definition: CommandDefinition;
  private readonly parentPath: string[];

  /**
   * Creates a new CommandBuilder and registers the command with the given registry.
   * Application code obtains builders from `cli.command()` and `.command()`.
   *
   * @internal
   * @param registry - The command registry that holds all registered commands.
   * @param definitionStr - A definition string describing the command name and its arguments (e.g., `"serve <port>"`).
   * @param parentPath - The path of parent command names leading to this command. Defaults to an empty array for root commands.
   */
  static create<D extends string>(
    registry: CommandRegistry,
    definitionStr: D,
    parentPath: string[] = [],
  ): CommandBuilderFor<D> {
    return new CommandBuilder(registry, definitionStr, parentPath) as CommandBuilderFor<D>;
  }

  private constructor(registry: CommandRegistry, definitionStr: string, parentPath: string[]) {
    this.registry = registry;

    const { parentPath: defParent, name, argDefs } = parseDefinitionString(definitionStr);

    this.parentPath = [...parentPath, ...defParent];

    const definition = {
      name,
      argDefs,
      options: new Map(),
      subcommands: new Map(),
    };

    this.definition = registry.register(definition, this.parentPath);
  }

  private assertRegistered(): void {
    if (!this.registry.isRegistered(this.definition, this.parentPath)) {
      throw usageError(
        "state",
        "ERR_COMMAND_REMOVED",
        `Cannot configure detached command "${this.definition.name}"`,
      );
    }
  }

  /**
   * Sets a human-readable description for this command, used in help output.
   * Repeated call: replaces the previous description.
   *
   * @param text - The description text.
   * @returns This builder instance for chaining.
   */
  description(text: string): this {
    this.assertRegistered();
    this.definition.description = text;
    return this;
  }

  /**
   * Excludes this command from generated help and completion.
   * Repeated call: replaces the previous setting.
   *
   * @param hidden - Whether the command is hidden. Defaults to true.
   * @returns This builder instance for chaining.
   */
  hidden(hidden = true): this {
    this.assertRegistered();
    this.definition.hidden = hidden;
    return this;
  }

  /**
   * Adds an option to this command.
   *
   * The flags string may contain short and long forms separated by commas,
   * with an optional value placeholder (e.g., `"-p, --port <port>"`).
   * If no type is provided in the schema, it is inferred from the flag format:
   * a placeholder means `string`, none means `boolean`. A `<number>` placeholder
   * requires `type: "number"` or `"number[]"`, and a `<boolean>` placeholder
   * requires `type: "boolean"`.
   * Repeated call: the same option name replaces the previous definition in
   * place; a new name adds an option.
   *
   * With a literal flags string the option is added to the type of
   * `ctx.options` under the key described above. Its value type is the awaited
   * return of `parse`, else `type`, else `string` or `boolean` from the
   * placeholder, narrowed to the `choices` union when present. It is optional
   * unless it has a `default`, is `required`, or is a boolean.
   *
   * @param flags - The option flags string.
   * @param schema - Optional schema describing the option's type, default value, etc.
   * @returns This builder instance for chaining.
   * @throws {Error} `ERR_INVALID_DEFINITION` for malformed flags or an invalid
   *   schema, `ERR_DEFINITION_CONFLICT` when a name or alias belongs to another option.
   */
  option<F extends string, const S extends OptionSchema = Record<never, never>>(
    flags: F,
    schema?: S & CheckedOptionSchema<S>,
  ): CommandBuilder<A, AddOption<O, F, S>> {
    this.assertRegistered();
    const { long, aliases, longAliases, takesValue, valueName } = parseOptionFlags(flags);

    // Clone the caller's schema so we never mutate their object.
    const resolved: OptionSchema = { ...schema };

    // Infer type from flag format
    if (!resolved.type) {
      resolved.type = takesValue ? "string" : "boolean";
    }

    // The placeholder names the value's type in help, so it must agree with it.
    const placeholderTypes = valueName === "number" ? ["number", "number[]"] : ["boolean"];
    if (
      (valueName === "number" || valueName === "boolean") &&
      !placeholderTypes.includes(resolved.type)
    ) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Option "--${long}" uses the <${valueName}> placeholder but its type is ${resolved.type}; set type: "${valueName}" or rename the placeholder`,
      );
    }

    if (resolved.required === true && resolved.default !== undefined) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Option "--${long}" cannot be both required and have a default value`,
      );
    }

    // Single source of truth for "does this option take a value": derive it from
    // the resolved type. This keeps the parser, help output, and completion in
    // agreement even when the schema type and the flag placeholder disagree
    // (e.g. `.option("--name", { type: "string" })` with no `<value>` placeholder).
    const finalTakesValue = resolved.type !== "boolean";

    // A boolean flag defaults to `false` only when it is not required; injecting a
    // default for a required boolean would make the required check unsatisfiable.
    if (
      resolved.type === "boolean" &&
      resolved.default === undefined &&
      resolved.required !== true
    ) {
      resolved.default = false;
    }

    if (resolved.default !== undefined) {
      if (
        resolved.default === null &&
        (resolved.type === "boolean" || resolved.type === "number")
      ) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Invalid default for --${long}: null is not a ${resolved.type}`,
        );
      }
      try {
        resolved.default = coerceOptionValue(resolved.default, resolved.type, long);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Invalid default for --${long}: ${message}`,
        );
      }
      if (resolved.choices) {
        const allowed = resolved.choices.map(String);
        const values = Array.isArray(resolved.default) ? resolved.default : [resolved.default];
        if (values.some((value) => !allowed.includes(String(value)))) {
          throw usageError(
            "state",
            "ERR_INVALID_DEFINITION",
            `Invalid default for --${long}: value is not one of the declared choices`,
          );
        }
      }
    }

    // Merge schema-declared aliases (e.g. { alias: "p" }) into the alias list.
    const mergedAliases = [...aliases, ...longAliases];
    if (resolved.alias) {
      const extra = typeof resolved.alias === "string" ? [resolved.alias] : resolved.alias;
      for (const a of extra) {
        const name = stripOptionPrefix(a);
        if (name && !mergedAliases.includes(name)) {
          mergedAliases.push(name);
        }
      }
    }

    if (!long) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Invalid option flags: missing option name in "${flags}"`,
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(long)) {
      throw usageError("state", "ERR_INVALID_DEFINITION", `Invalid option name "${long}"`);
    }
    for (const alias of mergedAliases) {
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(alias)) {
        throw usageError("state", "ERR_INVALID_DEFINITION", `Invalid option alias "${alias}"`);
      }
      if (!longAliases.includes(alias) && alias.length !== 1) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Option alias "-${alias}" must be exactly one character`,
        );
      }
    }

    // Redefinition is intentional: plugins can refine a built-in option without
    // first removing it, so the definition being replaced is skipped rather than
    // deleted up front. Deleting first would leave the option gone if the check
    // below then rejected the new definition, and would also move it to the end
    // of the render order that help and completion follow.
    const candidateNames = new Set([long, ...mergedAliases]);
    for (const [existingLong, existing] of this.definition.options) {
      if (existingLong === long) continue;
      for (const existingName of [existing.long, ...existing.aliases]) {
        if (candidateNames.has(existingName)) {
          throw usageError(
            "state",
            "ERR_DEFINITION_CONFLICT",
            `Option name or alias "${existingName}" is already registered`,
          );
        }
      }
    }

    this.definition.options.set(long, {
      long,
      aliases: mergedAliases,
      takesValue: finalTakesValue,
      valueName,
      schema: resolved,
    });

    return this as CommandBuilder<A, AddOption<O, F, S>>;
  }

  /**
   * Sets the action handler that is invoked when this command is executed.
   * Repeated call: replaces the previous action.
   *
   * @param fn - The async (or sync) function to run when the command matches.
   * @returns This builder instance for chaining.
   */
  action(fn: Action<A, O>): this {
    this.assertRegistered();
    if (this.definition.argDefs.length > 0 && this.definition.subcommands.size > 0) {
      process.emitWarning(
        `Command "${this.definition.name}" has positional arguments, so its subcommands cannot be dispatched once an action is set`,
        { code: "NODE_CLI_UNREACHABLE_SUBCOMMAND" },
      );
    }
    this.definition.action = fn as Action;
    return this;
  }

  /**
   * Sets a custom tab-completion function for this command's arguments. It
   * receives a `CompletionContext` and returns candidates for `ctx.current`.
   * Repeated call: replaces the previous completer.
   *
   * @param fn - The completer function that returns completion candidates.
   * @returns This builder instance for chaining.
   */
  completer(fn: Completer): this {
    this.assertRegistered();
    this.definition.completer = fn;
    return this;
  }

  /**
   * Adds one or more aliases for this command.
   * Repeated call: adds to the existing aliases; duplicates are ignored.
   *
   * @param names - Alias names that can be used to invoke this command.
   * @returns This builder instance for chaining.
   * @throws {Error} `ERR_DEFINITION_CONFLICT` when an alias names another command
   *   or another command's alias at the same level.
   */
  alias(...names: readonly string[]): this {
    this.assertRegistered();
    const aliases = [...(this.definition.aliases ?? [])];
    // Deduplicate against existing aliases and the command's own name.
    for (const name of names) {
      if (name && name !== this.definition.name && !aliases.includes(name)) {
        aliases.push(name);
      }
    }
    this.registry.registerAliases(this.definition, this.parentPath, aliases);
    this.definition.aliases = aliases;
    return this;
  }

  /**
   * Sets a pre-action validator for this command.
   * The validator receives the command context after option resolution and
   * should throw (or reject) to stop execution; it is awaited before the action.
   * Repeated call: replaces the previous validator.
   *
   * @param fn - The validation function.
   * @returns This builder instance for chaining.
   */
  validate(fn: CommandValidator<A, O>): this {
    this.assertRegistered();
    this.definition.validate = fn as CommandValidator;
    return this;
  }

  /**
   * Sets a handler invoked when this command is interrupted while running:
   * Ctrl-C, an aborted exec signal, or SIGTERM in the shell. It is not awaited;
   * a rejection is reported through the `error` event.
   * Repeated call: replaces the previous handler.
   *
   * @param fn - The cancel handler function.
   * @returns This builder instance for chaining.
   */
  onCancel(fn: CancelHandler<A, O>): this {
    this.assertRegistered();
    this.definition.cancelHandler = fn as CancelHandler;
    return this;
  }

  /**
   * Removes this command from the registry. It returns a boolean, so the chain
   * ends here; any later configuration call on this builder throws
   * `ERR_COMMAND_REMOVED`.
   * Repeated call: returns false.
   *
   * @returns True if the command was found and removed, false otherwise.
   */
  remove(): boolean {
    return this.registry.unregister([...this.parentPath, this.definition.name], this.definition);
  }

  /**
   * Registers a subcommand under this command and returns the subcommand's
   * builder, not this one, so the chain continues on the child. The child is
   * typed from its own definition and does not inherit this command's options.
   * Repeated call: the same name merges into the existing subcommand.
   *
   * @param definition - The definition string for the subcommand (e.g., `"list [filter]"`).
   * @returns A new {@link CommandBuilder} for configuring the subcommand.
   * @throws {Error} `ERR_INVALID_DEFINITION` for a malformed definition string.
   */
  command<D extends string>(definition: D): CommandBuilderFor<D> {
    this.assertRegistered();
    const fullParentPath = [...this.parentPath, this.definition.name];
    return CommandBuilder.create(this.registry, definition, fullParentPath);
  }
}

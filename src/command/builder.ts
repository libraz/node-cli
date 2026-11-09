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
  OptionSchemaInput,
  OptionValue,
} from "../types.js";
import {
  NAME_PATTERN,
  parseDefinitionString,
  parseOptionFlags,
  stripOptionPrefix,
  toCamelKey,
} from "./parser.js";
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
 *
 * @example
 * ```ts
 * cli
 *   .command("deploy <target-env>")
 *   .description("Deploy the current build")
 *   .option("--dry-run")
 *   .action((ctx) => {
 *     ctx.stdout.write(`${ctx.args.targetEnv} ${ctx.options.dryRun}\n`);
 *   });
 * ```
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
   * Adds an option to this command and returns the builder typed with it.
   *
   * The flags string may contain short and long forms separated by commas,
   * with an optional value placeholder (e.g., `"-p, --port <port>"`). Every
   * name is ASCII letters and digits in parts joined by single dashes. The
   * first long flag is the canonical name and later long flags are aliases;
   * without a long flag the first short flag is the canonical name.
   * `ctx.options` holds the value under the camelCase form of the canonical
   * name (`--dry-run` → `dryRun`). Help, completion and error messages keep
   * the flag spellings.
   *
   * If no type is provided in the schema, it is inferred from the flag format:
   * a placeholder means `string`, none means `boolean`. A `<number>` placeholder
   * requires `type: "number"` or `"number[]"`, and a `<boolean>` placeholder
   * requires `type: "boolean"`.
   *
   * With a literal flags string the option is added to the type of
   * `ctx.options`. Its value type is the `choices` union when present, else the
   * awaited return of `parse`, else `type`, else `string` or `boolean` from the
   * placeholder. It is optional unless it has a `default`, is `required`, or is
   * a boolean. `default` and `validate` are typed by that value type.
   *
   * Repeated call: the same canonical name replaces the previous definition
   * in place, and its type replaces the previous one; a new name adds an
   * option. The returned builder carries the new type while the receiver keeps
   * the old one, so chain the call or reassign the result.
   *
   * @example
   * ```ts
   * cli
   *   .command("serve")
   *   .option("-p, --port <n>", { type: "number", default: 8080 })
   *   .option("--log-level <level>", { choices: ["debug", "info"] })
   *   .option("--dry-run")
   *   .action((ctx) => {
   *     const { port, logLevel, dryRun } = ctx.options; // number, "debug" | "info" | undefined, boolean
   *   });
   * ```
   *
   * @param flags - The option flags string.
   * @param schema - Optional schema describing the option's type, default value, etc.
   * @returns This builder, typed with the added option.
   * @throws {Error} `ERR_INVALID_DEFINITION` for malformed flags or names, a
   *   schema `alias` that is not one character, a placeholder that disagrees
   *   with `type`, `required` with a `default`, `choices` that are empty, of
   *   another type than the value, non-finite or beyond the safe-integer range,
   *   or combined with `parse` or a boolean, and a `default` that fails
   *   coercion or lies outside `choices`.
   * @throws {Error} `ERR_DEFINITION_CONFLICT` when a name, an alias or the
   *   camelCase key belongs to another option.
   */
  option<
    F extends string,
    const S extends OptionSchemaInput = Record<never, never>,
    const T extends OptionSchema["type"] = undefined,
    const C extends readonly unknown[] = never,
    R = never,
  >(
    flags: F,
    schema?: S & CheckedOptionSchema<F, S, A, O, T, C, R>,
  ): CommandBuilder<A, AddOption<O, F, S, OptionValue<F, T, C, R>>> {
    this.assertRegistered();
    const { long, aliases, longAliases, takesValue, valueName } = parseOptionFlags(flags);

    // Names come first: every later message names the option by them.
    if (!long) {
      throw usageError(
        "state",
        "ERR_INVALID_DEFINITION",
        `Invalid option flags: missing option name in "${flags}"`,
      );
    }
    for (const name of [long, ...aliases, ...longAliases]) {
      if (!NAME_PATTERN.test(name)) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Invalid option name "${name}" in "${flags}": use letters and digits joined by single dashes`,
        );
      }
    }
    for (const alias of aliases) {
      if (alias.length !== 1) {
        throw usageError(
          "state",
          "ERR_INVALID_DEFINITION",
          `Option alias "-${alias}" must be exactly one character; write a long alias as "--${alias}"`,
        );
      }
    }

    // Clone the caller's schema so we never mutate their object.
    const resolved: OptionSchema = { ...(schema as OptionSchema | undefined) };

    // Merge schema-declared short aliases (e.g. { alias: "p" }) into the alias list.
    const mergedAliases = [...aliases, ...longAliases];
    if (resolved.alias !== undefined) {
      const extra = typeof resolved.alias === "string" ? [resolved.alias] : resolved.alias;
      for (const a of extra) {
        if (typeof a !== "string" || !/^-?[A-Za-z0-9]$/.test(a)) {
          throw usageError(
            "state",
            "ERR_INVALID_DEFINITION",
            `Option "--${long}" alias ${JSON.stringify(a)} must be one character ("p" or "-p"); write a long alias in the flags string, as in "--${long}, --other"`,
          );
        }
        const name = stripOptionPrefix(a);
        if (!mergedAliases.includes(name)) mergedAliases.push(name);
      }
    }

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

    if (resolved.choices !== undefined) assertChoices(long, resolved);

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

    // A default on a `parse` option is already a parsed value, so the
    // built-in coercion that stands in for parsing does not apply to it.
    if (resolved.default !== undefined && !resolved.parse) {
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
        const allowed = resolved.choices;
        const values = Array.isArray(resolved.default) ? resolved.default : [resolved.default];
        if (values.some((value) => !allowed.includes(value))) {
          throw usageError(
            "state",
            "ERR_INVALID_DEFINITION",
            `Invalid default for --${long}: value is not one of the declared choices`,
          );
        }
      }
    }

    // Redefinition is intentional: plugins can refine a built-in option without
    // first removing it, so the definition being replaced is skipped rather than
    // deleted up front. Deleting first would leave the option gone if the check
    // below then rejected the new definition, and would also move it to the end
    // of the render order that help and completion follow. Names are compared
    // by their camelCase key, so `--dry-run` and `--dryRun` collide too.
    const candidateKeys = new Set([long, ...mergedAliases].map(toCamelKey));
    for (const [existingLong, existing] of this.definition.options) {
      if (existingLong === long) continue;
      for (const existingName of [existing.long, ...existing.aliases]) {
        if (candidateKeys.has(toCamelKey(existingName))) {
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

    return this as CommandBuilder<A, AddOption<O, F, S, OptionValue<F, T, C, R>>>;
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
   * Sets the tab-completion candidates for this command's arguments: a static
   * list, or a {@link Completer} that receives a `CompletionContext`. Either
   * way the candidates are filtered to those starting with `ctx.current`, as
   * for an option's `completer`.
   * Repeated call: replaces the previous completer.
   *
   * @example
   * ```ts
   * cli.command("deploy <env>").completer(["production", "staging"]);
   * ```
   *
   * @param fnOrList - The candidates, or the function that returns them.
   * @returns This builder instance for chaining.
   */
  completer(fnOrList: readonly string[] | Completer): this {
    this.assertRegistered();
    this.definition.completer = fnOrList;
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

/**
 * Checks a schema's `choices` against its option: not empty, not combined with
 * `parse` or a boolean, every element of the value type, and every number one
 * an input can produce (finite, within the safe-integer range).
 */
function assertChoices(long: string, schema: OptionSchema): void {
  const choices = schema.choices as readonly unknown[];
  const reject = (reason: string): never => {
    throw usageError("state", "ERR_INVALID_DEFINITION", `Option "--${long}" ${reason}`);
  };
  if (!Array.isArray(choices) || choices.length === 0) reject("declares no choices");
  if (schema.parse) reject("cannot combine choices with parse");
  if (schema.type === "boolean") reject("cannot declare choices for a boolean option");
  const expected = schema.type === "number" || schema.type === "number[]" ? "number" : "string";
  for (const choice of choices) {
    const actual = choice === null ? "null" : typeof choice;
    if (actual !== expected) {
      reject(`declares a choice of type ${actual} but its type is ${schema.type}`);
    }
    if (
      typeof choice === "number" &&
      !(Number.isFinite(choice) && Math.abs(choice) <= Number.MAX_SAFE_INTEGER)
    ) {
      reject(`declares the choice ${choice}, which no input can produce`);
    }
  }
}

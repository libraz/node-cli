import type { CommandDefinition } from "../types.js";

/**
 * Registry that stores and resolves hierarchical command definitions.
 * Commands can be nested via subcommands, forming a tree structure.
 */
export class CommandRegistry {
  /** Top-level command map keyed by command name. */
  readonly root: Map<string, CommandDefinition> = new Map();

  /** Alias-to-canonical-name map at each level. Key format: "parentPath.join('/'):alias" → canonical name. */
  private readonly aliasMap: Map<string, string> = new Map();

  /**
   * Register a command definition, optionally nested under a parent path.
   * If a command already exists at the target location, the definitions are merged.
   * Missing intermediate parent groups are auto-created.
   *
   * @param def - The command definition to register.
   * @param parentPath - Ancestor command names leading to the parent (empty for top-level).
   */
  register(def: CommandDefinition, parentPath: string[] = []): void {
    if (parentPath.length === 0) {
      const existing = this.root.get(def.name);
      if (existing) {
        // Merge into existing (add subcommands, update action/description)
        mergeDefinition(existing, def);
      } else {
        this.root.set(def.name, def);
      }
      return;
    }

    // Walk to parent, auto-creating group commands as needed
    let current: CommandDefinition | undefined = this.root.get(parentPath[0]);
    if (!current) {
      current = createGroupCommand(parentPath[0]);
      this.root.set(parentPath[0], current);
    }

    for (let i = 1; i < parentPath.length; i++) {
      let next: CommandDefinition | undefined = current.subcommands.get(parentPath[i]);
      if (!next) {
        next = createGroupCommand(parentPath[i]);
        next.parent = current;
        current.subcommands.set(parentPath[i], next);
      }
      current = next;
    }

    const existing = current.subcommands.get(def.name);
    if (existing) {
      mergeDefinition(existing, def);
    } else {
      def.parent = current;
      current.subcommands.set(def.name, def);
    }
  }

  /**
   * Registers alias mappings for a command definition.
   * Called by CommandBuilder when aliases are added.
   *
   * @param def - The command definition with aliases.
   * @param parentPath - The parent path of the command.
   */
  registerAliases(def: CommandDefinition, parentPath: string[]): void {
    if (!def.aliases) return;
    const prefix = parentPath.join("/");
    // Sibling commands at this level, used to detect alias/name collisions.
    const siblings = parentPath.length === 0 ? this.root : this.resolve(parentPath)?.subcommands;

    for (const alias of def.aliases) {
      const key = `${prefix}:${alias}`;

      // Collision with another command's existing alias at the same level.
      const existingAlias = this.aliasMap.get(key);
      if (existingAlias !== undefined && existingAlias !== def.name) {
        throw new Error(
          `Alias "${alias}" already maps to command "${existingAlias}" and cannot also alias "${def.name}"`,
        );
      }

      // Collision with a real command of that name at the same level.
      const sibling = siblings?.get(alias);
      if (sibling && sibling !== def) {
        throw new Error(`Alias "${alias}" conflicts with existing command "${alias}"`);
      }

      // Aliases are resolved through aliasMap only; they are intentionally not
      // added to the command maps so they cannot shadow real commands or inflate
      // subcommand counts / completion candidates.
      this.aliasMap.set(key, def.name);
    }
  }

  /**
   * Resolves a token to a canonical command name at the given parent level,
   * checking both direct names and aliases.
   *
   * @param token - The input token to resolve.
   * @param parentPath - The parent path context.
   * @returns The canonical command name, or the token itself if no alias matches.
   */
  private resolveAlias(
    token: string,
    parentPath: string[],
    siblings: Map<string, CommandDefinition>,
  ): string {
    // A real command at this level always wins over an alias of the same name,
    // regardless of registration order, so an alias can never shadow a command.
    if (siblings.has(token)) return token;
    const prefix = parentPath.join("/");
    return this.aliasMap.get(`${prefix}:${token}`) ?? token;
  }

  /**
   * Resolve a command by its full path of names, with alias support.
   * Returns `undefined` if any segment of the path does not exist.
   *
   * @param commandPath - Array of command/subcommand names forming the path.
   * @returns The matched command definition, or `undefined` if not found.
   */
  resolve(commandPath: string[]): CommandDefinition | undefined {
    if (commandPath.length === 0) return undefined;

    const resolvedFirst = this.resolveAlias(commandPath[0], [], this.root);
    let current: CommandDefinition | undefined = this.root.get(resolvedFirst);
    if (!current) return undefined;

    const parentNames = [current.name];
    for (let i = 1; i < commandPath.length; i++) {
      const resolvedName = this.resolveAlias(commandPath[i], parentNames, current.subcommands);
      const next: CommandDefinition | undefined = current.subcommands.get(resolvedName);
      if (!next) return undefined;
      parentNames.push(next.name);
      current = next;
    }

    return current;
  }

  /**
   * Given a list of tokens, find the longest matching command path (with alias support).
   * Returns the matched command and the number of tokens consumed.
   *
   * @param tokens - Raw token list (e.g. from user input).
   * @returns An object with the deepest matched command and consumed count, or `undefined`.
   */
  matchCommandPath(tokens: string[]): { command: CommandDefinition; consumed: number } | undefined {
    if (tokens.length === 0) return undefined;

    const resolvedFirst = this.resolveAlias(tokens[0], [], this.root);
    let current: CommandDefinition | undefined = this.root.get(resolvedFirst);
    if (!current) return undefined;

    let consumed = 1;
    const parentNames = [current.name];

    for (let i = 1; i < tokens.length; i++) {
      // Stop descending once we reach a runnable command that takes positional
      // arguments: further tokens are its arguments, not subcommand names. This
      // prevents an argument value that happens to match a subcommand name (e.g.
      // `task run list` where `list` is the task name) from being mis-dispatched.
      if (current.action && current.argDefs.length > 0) break;
      const resolvedName = this.resolveAlias(tokens[i], parentNames, current.subcommands);
      const next: CommandDefinition | undefined = current.subcommands.get(resolvedName);
      if (!next) break;
      parentNames.push(next.name);
      current = next;
      consumed = i + 1;
    }

    return { command: current, consumed };
  }

  /**
   * Removes a command from the registry by its full path.
   *
   * @param commandPath - The full path of the command to remove.
   * @returns True if the command was found and removed, false otherwise.
   */
  unregister(commandPath: string[]): boolean {
    if (commandPath.length === 0) return false;

    if (commandPath.length === 1) {
      const name = commandPath[0];
      const def = this.root.get(name);
      if (!def) return false;

      // Remove aliases from root map
      if (def.aliases) {
        for (const alias of def.aliases) {
          this.root.delete(alias);
          this.aliasMap.delete(`:${alias}`);
        }
      }
      this.root.delete(name);
      return true;
    }

    // Walk to the parent
    const parentPath = commandPath.slice(0, -1);
    const parent = this.resolve(parentPath);
    if (!parent) return false;

    const name = commandPath[commandPath.length - 1];
    const def = parent.subcommands.get(name);
    if (!def) return false;

    // Remove aliases from parent's subcommands
    if (def.aliases) {
      const aliasPrefix = parentPath.join("/");
      for (const alias of def.aliases) {
        parent.subcommands.delete(alias);
        this.aliasMap.delete(`${aliasPrefix}:${alias}`);
      }
    }
    parent.subcommands.delete(name);
    return true;
  }

  /**
   * Return all top-level command definitions.
   *
   * @returns An array of all registered root-level commands.
   */
  allTopLevel(): CommandDefinition[] {
    // Deduplicate: aliases point to the same definition object
    return [...new Set(this.root.values())];
  }

  /**
   * Build the full name path for a command by walking up the parent chain.
   *
   * @param def - The command definition to trace.
   * @returns An array of names from the root ancestor down to `def`.
   */
  getCommandPath(def: CommandDefinition): string[] {
    const path: string[] = [];
    let current: CommandDefinition | undefined = def;
    while (current) {
      path.unshift(current.name);
      current = current.parent;
    }
    return path;
  }
}

/**
 * Create a minimal group command definition (no action, just a name and empty containers).
 *
 * @param name - The command name.
 * @returns A new CommandDefinition suitable as a parent group.
 */
function createGroupCommand(name: string): CommandDefinition {
  return {
    name,
    argDefs: [],
    options: new Map(),
    subcommands: new Map(),
  };
}

/**
 * Merge fields from a source command definition into an existing target.
 * Action, description, completer, options, argDefs, and subcommands are all merged.
 * Subcommands with conflicting names are recursively merged.
 *
 * @param target - The existing definition to merge into.
 * @param source - The new definition providing updated values.
 */
function mergeDefinition(target: CommandDefinition, source: CommandDefinition): void {
  if (source.action) target.action = source.action;
  if (source.description) target.description = source.description;
  if (source.completer) target.completer = source.completer;
  if (source.aliases) target.aliases = source.aliases;
  if (source.validate) target.validate = source.validate;
  if (source.cancelHandler) target.cancelHandler = source.cancelHandler;
  for (const [k, v] of source.options) {
    target.options.set(k, v);
  }
  // Replace the argument list wholesale when the source declares its own, so a
  // redefinition with fewer args does not leave stale trailing arguments behind.
  if (source.argDefs.length > 0) {
    target.argDefs = [...source.argDefs];
  }
  for (const [k, v] of source.subcommands) {
    const existingSub: CommandDefinition | undefined = target.subcommands.get(k);
    if (existingSub) {
      mergeDefinition(existingSub, v);
    } else {
      v.parent = target;
      target.subcommands.set(k, v);
    }
  }
}

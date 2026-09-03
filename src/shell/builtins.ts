/**
 * Names the interactive shell handles itself instead of dispatching them to the
 * command registry. They are not registered commands, so every surface that
 * advertises or resolves them — the help footer, `help <name>`, tab completion,
 * and the shell's own input loop — reads the list from here rather than
 * repeating it, which is what let those surfaces disagree.
 */
export const SHELL_COMMANDS = ["exit", "quit"] as const;

/** The footer line the generated help uses to advertise them. */
export const SHELL_COMMANDS_LABEL = `Shell commands: ${SHELL_COMMANDS.join(", ")}`;

/**
 * True when the shell handles this name itself. An application command of the
 * same name takes precedence, so callers check the registry first.
 */
export function isShellCommand(name: string): boolean {
  return (SHELL_COMMANDS as readonly string[]).includes(name);
}

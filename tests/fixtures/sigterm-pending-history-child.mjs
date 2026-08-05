import { CommandRegistry } from "../../dist/command/registry.js";
import { CommandRouter } from "../../dist/command/router.js";
import { Shell } from "../../dist/shell/repl.js";

const historyFile = process.argv[2];
const registry = new CommandRegistry();
const shell = new Shell({
  router: new CommandRouter(registry),
  registry,
  prompt: "> ",
  historyFile,
});

void shell.start();
setTimeout(() => {
  shell.history.add("pending-before-sigterm");
  process.stdout.write("SIGTERM_HISTORY_READY\n");
}, 20);

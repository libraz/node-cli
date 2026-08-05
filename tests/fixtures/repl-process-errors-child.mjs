import { CommandRegistry } from "../../dist/command/registry.js";
import { CommandRouter } from "../../dist/command/router.js";
import { Shell } from "../../dist/shell/repl.js";

const registry = new CommandRegistry();
const shell = new Shell({
  router: new CommandRouter(registry),
  registry,
  prompt: "> ",
  historyFile: process.argv[2],
});

void shell.start();
setTimeout(() => {
  process.stdout.write("REPL_PROCESS_ERRORS_READY\n");
  Promise.reject(new Error("unhandled rejection"));
}, 20);
setTimeout(() => {
  throw new Error("uncaught exception");
}, 40);

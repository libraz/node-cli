import { CommandBuilder } from "../../dist/command/builder.js";
import { CommandRegistry } from "../../dist/command/registry.js";
import { CommandRouter } from "../../dist/command/router.js";
import { InteractiveShell } from "../../dist/shell/repl.js";

// argv[2] selects the scenario, argv[3] is the history file.
const [scenario, historyFile] = process.argv.slice(2);
const registry = new CommandRegistry();
const router = new CommandRouter(registry);

router.on("exit", () => process.stdout.write("EXIT_FIRST\n"));
router.on("exit", async () => {
  if (scenario === "hung-exit" || scenario === "force-quit-then-sigterm") {
    // Never settles; termination must not wait on it past its bound.
    await new Promise(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write("EXIT_LAST\n");
});

CommandBuilder.create(registry, "hang").action(() => {
  process.stdout.write("HANGING\n");
  return new Promise(() => {});
});

CommandBuilder.create(registry, "sql").action((ctx) => {
  ctx.shell?.enterMode({
    prompt: "sql> ",
    action: (_input, modeCtx) =>
      new Promise((resolve) => {
        process.stdout.write("MODE_STARTED\n");
        if (scenario !== "mode-sigterm") return;
        modeCtx.signal.addEventListener("abort", () => {
          process.stdout.write("MODE_ABORTED\n");
          setTimeout(() => {
            process.stdout.write("MODE_CLEANED\n");
            resolve();
          }, 50);
        });
      }),
  });
});

// Keeps the loop alive while stdin is paused for a running action.
setInterval(() => {}, 1_000);

const shell = new InteractiveShell({ router, registry, prompt: "> ", historyFile });
void shell.start();
setTimeout(() => process.stdout.write("SHELL_READY\n"), 20);

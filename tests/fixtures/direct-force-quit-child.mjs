import { createCLI } from "../../dist/index.js";

// argv[2] selects the scenario; the rest of argv is the command line to run.
const scenario = process.argv[2];
const cli = createCLI({ name: "direct-force-quit-fixture" });

cli.on("exit", () => process.stdout.write("EXIT_FIRST\n"));
cli.on("exit", async () => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  process.stdout.write("EXIT_LAST\n");
});

// Cancels cooperatively, but only after the second Ctrl-C has started the force
// quit, so the action settles while the exit listeners are still running.
cli.command("late").action(
  (ctx) =>
    new Promise((resolve) => {
      const keepAlive = setInterval(() => {}, 1_000);
      ctx.signal.addEventListener("abort", () => {
        setTimeout(() => {
          clearInterval(keepAlive);
          process.stdout.write("SETTLED\n");
          resolve();
        }, 500);
      });
      process.stdout.write("READY\n");
    }),
);

// Ignores cancellation.
cli.command("inner").action(() => {
  setInterval(() => {}, 1_000);
  process.stdout.write("READY\n");
  return new Promise(() => {});
});

// Opens a second SIGINT scope inside the first.
cli.command("outer").action(() => cli.exec("inner"));

if (scenario === "late") await cli.start(["late"]);
else await cli.start(["outer"]);

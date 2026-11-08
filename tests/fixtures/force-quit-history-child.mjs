import { createCLI, progress } from "../../dist/index.js";

const historyFile = process.argv[2];
if (!historyFile) throw new Error("history file argument is required");

const cli = createCLI({
  name: "force-quit-fixture",
  banner: "FORCE_QUIT_READY",
  historyFile,
});
cli.on("exit", () => process.stdout.write("EXIT_EVENT\n"));
// A second, slower listener: a force quit must let every listener finish, not
// just the one that happens to run first.
cli.on("exit", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write("EXIT_EVENT_LAST\n");
});

cli.command("normal").action((ctx) => {
  ctx.stdout.write("NORMAL_DONE\n");
});

cli.command("hang").action((ctx) => {
  const spinner = progress.spinner({ label: "HANGING", stream: ctx.stderr });
  spinner.start();
  setInterval(() => {}, 1_000);
  return new Promise(() => {});
});

await cli.start([]);

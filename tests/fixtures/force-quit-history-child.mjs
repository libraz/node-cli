import { CLI, progress } from "../../dist/index.js";

const historyFile = process.argv[2];
if (!historyFile) throw new Error("history file argument is required");

const cli = new CLI({
  name: "force-quit-fixture",
  banner: "FORCE_QUIT_READY",
  historyFile,
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

import { createCLI, progress } from "../../dist/index.js";

const historyFile = process.argv[2];
const cli = createCLI({
  prompt: "> ",
  historyFile,
});
cli.on("exit", () => process.stdout.write("EXIT_EVENT\n"));
cli
  .command("hang")
  .cancel(() => process.stdout.write("CANCELLED\n"))
  .action((ctx) => {
    progress.spinner({ label: "HANGING", stream: ctx.stderr }).start();
    setInterval(() => {}, 1_000);
    return new Promise(() => {});
  });

setTimeout(() => {
  process.stdout.write("SIGTERM_READY\n");
}, 20);
await cli.start([]);

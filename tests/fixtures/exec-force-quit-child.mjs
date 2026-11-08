import { createCLI } from "../../dist/index.js";

const cli = createCLI({ name: "exec-force-quit-fixture" });

cli.on("exit", () => process.stdout.write("EXIT_FIRST\n"));
cli.on("exit", async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  process.stdout.write("EXIT_LAST\n");
});

cli.command("hang").action(() => {
  setInterval(() => {}, 1_000);
  process.stdout.write("HANGING\n");
  return new Promise(() => {});
});

// Programmatic execution must reach the same force-quit path as the direct
// argv path, so a Ctrl-C during it still notifies every `exit` listener.
const run = cli.exec.bind(cli);
await run("hang");

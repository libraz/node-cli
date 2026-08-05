import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../../dist/index.js";

const cli = new CLI({
  name: "tty-fixture",
  banner: "TTY_REPL_READY",
  historyFile: process.argv[2] ?? join(tmpdir(), `node-cli-tty-${process.pid}.history`),
});
cli.command("fresh").action((ctx) => ctx.stdout.write("FRESH_ACTION\n"));
cli.command("stalefresh").action((ctx) => ctx.stdout.write("STALE_ACTION\n"));
cli.command("one").action((ctx) => ctx.stdout.write("PASTE_ONE\n"));
cli.command("two").action((ctx) => ctx.stdout.write("PASTE_TWO\n"));
cli.command("three").action((ctx) => ctx.stdout.write("PASTE_THREE\n"));

await cli.start([]);

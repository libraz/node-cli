import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../../dist/index.js";

const cli = new CLI({
  name: "mode-fixture",
  banner: "MODE_SHELL_READY",
  historyFile: join(tmpdir(), `node-cli-mode-tty-${process.pid}.history`),
});
cli.command("parent").action((ctx) => ctx.stdout.write("PARENT_ACTION\n"));
cli.command("mode").action((ctx) => {
  ctx.shell?.enterMode({
    prompt: "mode> ",
    message: "MODE_ENTER",
    action(input, modeContext) {
      modeContext.stdout.write(`MODE:${input}\n`);
    },
  });
});

await cli.start([]);

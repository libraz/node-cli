import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCLI } from "../../dist/index.js";

const cli = createCLI({
  name: "mode-fixture",
  banner: "MODE_SHELL_READY",
  historyFile: join(tmpdir(), `node-cli-mode-tty-${process.pid}.history`),
  historySize: 2,
});
cli.command("parent").action((ctx) => ctx.stdout.write("PARENT_ACTION\n"));
cli.command("mode").action((ctx) => {
  ctx.shell?.enterMode({
    prompt: "mode> ",
    banner: "MODE_ENTER",
    action(input, modeContext) {
      modeContext.stdout.write(`MODE:${input}\n`);
    },
  });
});

await cli.start([]);

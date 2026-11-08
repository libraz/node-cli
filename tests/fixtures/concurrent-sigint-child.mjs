import { createCLI } from "../../dist/index.js";

const cli = createCLI({ name: "concurrent-sigint-fixture" });

// Two commands running at once. A single Ctrl-C must cancel both cooperatively;
// neither may read the other's cancellation as "nothing happened" and force quit.
for (const name of ["first", "second"]) {
  cli.command(name).action(async (ctx) => {
    await new Promise((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    process.stdout.write(`CANCELLED ${name}\n`);
  });
}

const run = cli.execLine.bind(cli);
const both = Promise.all([run("first"), run("second")]);

// Nothing else keeps the loop alive while both actions wait on their signal.
const keepAlive = setInterval(() => {}, 1_000);

// Give both executions time to register before interrupting.
setTimeout(() => {
  process.stdout.write("INTERRUPTING\n");
  process.kill(process.pid, "SIGINT");
}, 150);

await both;
clearInterval(keepAlive);
process.stdout.write("BOTH_SETTLED\n");

import { CLI } from "../../dist/index.js";

const cli = new CLI();
cli
  .command("wait")
  .cancel((ctx) => {
    ctx.stdout.write("CANCEL\n");
    throw new Error("cancel cleanup failed");
  })
  .action(
    (ctx) =>
      new Promise((resolve) => {
        const keepAlive = setInterval(() => {}, 1_000);
        const cleanup = () => {
          setTimeout(() => {
            clearInterval(keepAlive);
            ctx.stdout.write("CLEAN\n");
            resolve();
          }, 20);
        };
        if (ctx.signal.aborted) cleanup();
        else ctx.signal.addEventListener("abort", cleanup, { once: true });
        ctx.stdout.write(`READY:${process.listenerCount("SIGINT")}\n`);
      }),
  );

await cli.start(["wait"]);

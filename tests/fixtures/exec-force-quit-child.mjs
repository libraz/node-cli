import { createCLI } from "../../dist/index.js";

// argv[2] selects the scenario:
//   start         a command that ignores cancellation, run through start()
//   programmatic  two concurrent execLine() calls whose cancellation belongs to the host
const scenario = process.argv[2];
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

for (const name of ["first", "second"]) {
  cli.command(name).action(async (ctx) => {
    await new Promise((resolve) => {
      ctx.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    process.stdout.write(`CANCELLED ${name}\n`);
  });
}

if (scenario === "start") {
  await cli.start(["hang"]);
} else {
  process.stdout.write(`LISTENERS:${process.listenerCount("SIGINT")}\n`);
  // The host owns SIGINT: it decides what an interrupt means for its executions.
  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());
  const options = { signal: controller.signal };
  const both = Promise.allSettled([
    cli.execLine("first", options),
    cli.execLine("second", options),
  ]);
  const keepAlive = setInterval(() => {}, 1_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  process.stdout.write(`PENDING_LISTENERS:${process.listenerCount("SIGINT")}\n`);
  process.kill(process.pid, "SIGINT");
  const results = await both;
  clearInterval(keepAlive);
  process.stdout.write(`SETTLED:${results.map((r) => r.status).join(",")}\n`);
}

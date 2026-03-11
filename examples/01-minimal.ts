/**
 * Example: Minimal CLI
 *
 * The simplest possible CLI application with a single command.
 * Demonstrates direct CLI mode and interactive shell mode.
 *
 * Usage:
 *   npx tsx examples/01-minimal.ts greet World
 *   npx tsx examples/01-minimal.ts        # starts interactive shell
 */
import { createCLI } from "../src/index.js";

const cli = createCLI({
  name: "hello",
  version: "1.0.0",
  description: "A friendly greeting CLI",
});

cli
  .command("greet <name>")
  .description("Say hello to someone")
  .action((ctx) => {
    ctx.stdout.write(`Hello, ${ctx.args.name}!\n`);
  });

cli.start();

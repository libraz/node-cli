/**
 * Example: Pipe Commands & Mode Sub-REPL
 *
 * Demonstrates piping output between commands and entering
 * a specialized mode with its own prompt and handler.
 *
 * Usage (interactive shell):
 *   npx tsx examples/07-pipe-and-mode.ts
 *   > list | filter js | count
 *   > calc
 *   calc> 2 + 3
 *   calc> exit
 */
import { createCLI, c } from "../src/index.js";

const cli = createCLI({ name: "pipes", prompt: "pipes> " });

// ── Pipe-friendly commands ──

cli
  .command("list")
  .description("List sample files")
  .action((ctx) => {
    const files = [
      "index.ts",
      "cli.ts",
      "parser.ts",
      "README.md",
      "package.json",
      "styles.css",
      "app.js",
      "test.spec.ts",
    ];
    for (const f of files) {
      ctx.stdout.write(f + "\n");
    }
  });

cli
  .command("filter <pattern>")
  .description("Filter stdin lines by pattern")
  .action(async (ctx) => {
    const pattern = ctx.args.pattern as string;

    if (ctx.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of ctx.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      const lines = Buffer.concat(chunks).toString().split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.includes(pattern)) {
          ctx.stdout.write(line + "\n");
        }
      }
    } else {
      ctx.stderr.write("No input. Use with a pipe: list | filter <pattern>\n");
    }
  });

cli
  .command("count")
  .description("Count stdin lines")
  .action(async (ctx) => {
    if (ctx.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of ctx.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      const lines = Buffer.concat(chunks).toString().split("\n").filter(Boolean);
      ctx.stdout.write(`${lines.length} lines\n`);
    } else {
      ctx.stderr.write("No input. Use with a pipe: list | count\n");
    }
  });

cli
  .command("upper")
  .description("Convert stdin to uppercase")
  .action(async (ctx) => {
    if (ctx.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of ctx.stdin) {
        chunks.push(Buffer.from(chunk));
      }
      ctx.stdout.write(Buffer.concat(chunks).toString().toUpperCase());
    }
  });

// ── Mode: Calculator sub-REPL ──

cli
  .command("calc")
  .description("Enter calculator mode")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("Calculator mode is only available in interactive shell.\n");
      return;
    }

    ctx.shell.enterMode({
      prompt: c`{cyan calc}> `,
      message: c`{bold Calculator Mode} — Type math expressions. 'exit' to return.`,
      action: (input, { stdout, stderr }) => {
        try {
          // Simple and safe evaluation for basic arithmetic
          if (!/^[\d\s+\-*/().]+$/.test(input)) {
            stderr.write("Only basic arithmetic is supported (+, -, *, /, parentheses)\n");
            return;
          }
          const result = Function(`"use strict"; return (${input})`)();
          stdout.write(c`{green =} ${String(result)}\n`);
        } catch {
          stderr.write(c`{red Invalid expression}\n`);
        }
      },
    });
  });

// ── Mode: Note-taking sub-REPL ──

cli
  .command("notes")
  .description("Enter note-taking mode")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("Notes mode is only available in interactive shell.\n");
      return;
    }

    const entries: string[] = [];

    ctx.shell.enterMode({
      prompt: c`{yellow note}> `,
      message: c`{bold Notes Mode} — Type notes to save. 'list' to view. 'exit' to return.`,
      action: (input, { stdout }) => {
        if (input === "list") {
          if (entries.length === 0) {
            stdout.write(c`{dim No notes yet.}\n`);
          } else {
            for (let i = 0; i < entries.length; i++) {
              stdout.write(c`  {dim ${String(i + 1)}.} ${entries[i]}\n`);
            }
          }
        } else {
          entries.push(input);
          stdout.write(c`{green Saved} (${String(entries.length)} notes total)\n`);
        }
      },
    });
  });

cli.start();

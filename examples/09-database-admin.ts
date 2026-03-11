/**
 * Example: Database Admin Tool
 *
 * A simulated database administration CLI demonstrating a real-world
 * use case with subcommands, prompts, tables, validation, and modes.
 *
 * Usage:
 *   npx tsx examples/09-database-admin.ts db status
 *   npx tsx examples/09-database-admin.ts db table list
 *   npx tsx examples/09-database-admin.ts db query "SELECT * FROM users"
 *   npx tsx examples/09-database-admin.ts      # interactive shell with sql mode
 */
import { createCLI, color, c, table, prompt, PromptCancelError } from "../src/index.js";

// Simulated database
const mockDb = {
  tables: {
    users: [
      { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
      { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
      { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" },
    ],
    posts: [
      { id: 1, title: "Hello World", author_id: 1, status: "published" },
      { id: 2, title: "Getting Started", author_id: 2, status: "draft" },
    ],
    comments: [
      { id: 1, post_id: 1, user_id: 2, body: "Great post!" },
      { id: 2, post_id: 1, user_id: 3, body: "Thanks for sharing." },
    ],
  } as Record<string, Record<string, unknown>[]>,
  connected: true,
};

const cli = createCLI({ name: "dbadmin", prompt: c`{cyan db}> ` });

const db = cli.command("db").description("Database operations");

// ── db status ──

db.command("status")
  .alias("s")
  .description("Show database connection status")
  .action((ctx) => {
    ctx.stdout.write(c`{bold Database Status}\n\n`);
    ctx.stdout.write(c`  Connection: ${mockDb.connected ? "{green Connected}" : "{red Disconnected}"}\n`);
    ctx.stdout.write(c`  Tables:     {cyan ${String(Object.keys(mockDb.tables).length)}}\n`);
    ctx.stdout.write(c`  Host:       {dim localhost:5432}\n`);
    ctx.stdout.write(c`  Database:   {dim myapp_dev}\n\n`);

    const tableData = Object.entries(mockDb.tables).map(([name, rows]) => ({
      table: name,
      rows: rows.length,
      columns: Object.keys(rows[0] || {}).length,
    }));

    ctx.stdout.write(
      table(tableData, { border: "rounded", headerStyle: "bold", align: { rows: "right", columns: "right" } }),
    );
    ctx.stdout.write("\n");
  });

// ── db table ──

const dbTable = db.command("table").description("Table operations");

dbTable
  .command("list")
  .alias("ls")
  .description("List all tables")
  .action((ctx) => {
    const names = Object.keys(mockDb.tables);
    for (const name of names) {
      const rowCount = mockDb.tables[name].length;
      ctx.stdout.write(c`  {cyan ${name}} {dim (${String(rowCount)} rows)}\n`);
    }
  });

dbTable
  .command("show <name>")
  .description("Show table contents")
  .option("-l, --limit <n>", { type: "number", default: 10, description: "Max rows" })
  .validate((ctx) => {
    const name = ctx.args.name as string;
    if (!mockDb.tables[name]) {
      const available = Object.keys(mockDb.tables).join(", ");
      throw new Error(`Table "${name}" not found. Available: ${available}`);
    }
  })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const limit = ctx.options.limit as number;
    const rows = mockDb.tables[name].slice(0, limit);

    ctx.stdout.write(c`\n{bold Table: ${name}} {dim (${String(mockDb.tables[name].length)} rows)}\n\n`);
    ctx.stdout.write(table(rows, { border: "rounded", headerStyle: "bold" }));
    ctx.stdout.write("\n");
  });

dbTable
  .command("describe <name>")
  .alias("desc")
  .description("Show table schema")
  .validate((ctx) => {
    if (!mockDb.tables[ctx.args.name as string]) {
      throw new Error(`Table "${ctx.args.name}" not found.`);
    }
  })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const sample = mockDb.tables[name][0] || {};
    const schema = Object.entries(sample).map(([col, val]) => ({
      column: col,
      type: typeof val,
      nullable: "no",
    }));

    ctx.stdout.write(c`\n{bold Schema: ${name}}\n\n`);
    ctx.stdout.write(table(schema, { border: "simple", headerStyle: "bold" }));
    ctx.stdout.write("\n");
  });

// ── db query ──

db.command("query <sql>")
  .alias("q")
  .description("Execute a SQL query (simulated)")
  .action((ctx) => {
    const sql = ctx.args.sql as string;
    executeQuery(sql, ctx.stdout);
  });

// ── db drop ──

db.command("drop <name>")
  .description("Drop a table (with confirmation)")
  .action(async (ctx) => {
    const name = ctx.args.name as string;
    if (!mockDb.tables[name]) {
      throw new Error(`Table "${name}" not found.`);
    }

    try {
      const confirm = await prompt.confirm(
        c`{red.bold WARNING}: This will permanently delete table "${name}". Continue?`,
      );
      if (confirm) {
        delete mockDb.tables[name];
        ctx.stdout.write(c`{green Table "${name}" dropped.}\n`);
      } else {
        ctx.stdout.write(c`{dim Cancelled.}\n`);
      }
    } catch (err) {
      if (err instanceof PromptCancelError) {
        ctx.stdout.write(c`{dim Cancelled.}\n`);
      } else {
        throw err;
      }
    }
  });

// ── SQL mode ──

cli
  .command("sql")
  .description("Enter SQL interactive mode")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("SQL mode requires interactive shell.\n");
      return;
    }

    ctx.shell.enterMode({
      prompt: c`{magenta sql}> `,
      message: c`{bold SQL Mode} — Enter queries. Type 'exit' to return.`,
      action: (input, { stdout }) => {
        executeQuery(input, stdout);
      },
    });
  });

function executeQuery(sql: string, stdout: NodeJS.WritableStream) {
  // Very basic SQL simulation
  const match = sql.match(/SELECT\s+\*\s+FROM\s+(\w+)/i);
  if (match) {
    const tableName = match[1];
    const rows = mockDb.tables[tableName];
    if (rows) {
      stdout.write(table(rows, { border: "simple", headerStyle: "bold" }) + "\n");
      stdout.write(c`{dim ${String(rows.length)} row(s)}\n`);
    } else {
      stdout.write(c`{red Error}: Table "${tableName}" does not exist\n`);
    }
  } else {
    stdout.write(c`{yellow Simulated}: ${sql}\n{dim (Only "SELECT * FROM <table>" is supported in this demo)}\n`);
  }
}

cli.start();

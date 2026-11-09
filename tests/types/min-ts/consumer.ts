import {
  type Action,
  type CommandContext,
  colorTag,
  createCLI,
  createLogger,
  prompt,
  table,
} from "../../../dist/index.js";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

const cli = createCLI({ name: "consumer", version: "1.0.0" });

// Arguments and options are typed from the definition string and option schemas.
cli
  .command("serve <host>")
  .option("-p, --port <n>", { type: "number", default: 8080 })
  .option("--level <l>", { choices: ["debug", "info"] })
  .option("--since <date>", { parse: (value) => new Date(value) })
  .option("-v, --verbose")
  .action((ctx) => {
    const host: Equal<typeof ctx.args.host, string> = true;
    const port: Equal<typeof ctx.options.port, number> = true;
    const level: Equal<typeof ctx.options.level, "debug" | "info" | undefined> = true;
    const since: Equal<typeof ctx.options.since, Date | undefined> = true;
    const verbose: Equal<typeof ctx.options.verbose, boolean> = true;
    // @ts-expect-error an undeclared option is a type error
    void ctx.options.typo;
    void [host, port, level, since, verbose];
  });

// A default that does not match the parsed value type is rejected.
// @ts-expect-error default must be a Date, not a string
cli.command("bad").option("--at <d>", { parse: (v) => new Date(v), default: "2020-01-01" });

const action: Action = (ctx: CommandContext) => {
  ctx.stdout.write("hello\n");
};
cli.command("hello").action(action);

// select and multiselect keep the choice type; a default outside it is rejected.
const picked: Promise<"dev" | "prod"> = prompt.select("Env:", ["dev", "prod"] as const, {
  default: "dev",
});
const many: Promise<readonly ("a" | "b")[]> = prompt.multiselect("Pick:", ["a", "b"] as const, {
  default: ["a"],
});
// @ts-expect-error default is not one of the choices
void prompt.select("Env:", ["dev", "prod"] as const, { default: "stage" });
// @ts-expect-error default is not one of the choices
void prompt.multiselect("Pick:", ["a", "b"] as const, { default: ["c"] });
void [picked, many];

const tagged: string = colorTag`{bold ok}`;
void tagged;

// table is generic over the row type and checks column keys against it.
interface Row {
  name: string;
  size: number;
}
const rows: readonly Row[] = [{ name: "a", size: 1 }];
const rendered: string = table(rows, {
  columns: ["name", { key: "size", label: "Size", align: "right" }],
});
// @ts-expect-error a column key must be a key of the row type
void table(rows, { columns: ["missing"] });
void rendered;

createLogger({ prefix: "app" }).info("ready");

import { type Completer, createCLI, type OptionSchema } from "../../dist/index.js";

declare const text: string | undefined;
declare const flag: boolean | undefined;
declare const alias: string | undefined;
declare const completer: Completer | undefined;
declare const type: OptionSchema["type"];

// Under exactOptionalPropertyTypes, `T | undefined` values still flow into optional members.
const schema: OptionSchema = {
  description: text,
  type,
  alias,
  required: flag,
  default: undefined,
  choices: undefined,
  parse: undefined,
  validate: undefined,
  hidden: flag,
  completer,
};
void schema;

createCLI({ name: "app" })
  .command("serve")
  .option("-p, --port <n>", {
    type: "number",
    description: text,
    alias: "P",
    hidden: flag,
    completer,
    default: 8080,
  })
  .option("--host <h>", { description: text, required: true })
  .option("--level <l>", { choices: ["debug", "info"], description: text })
  .action((ctx) => {
    const port: number = ctx.options.port;
    const host: string = ctx.options.host;
    const level: "debug" | "info" | undefined = ctx.options.level;
    void [port, host, level];
  });

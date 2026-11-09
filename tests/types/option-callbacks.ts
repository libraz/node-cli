import { createCLI, type OptionSchema } from "../../src/index.js";

const cli = createCLI({ name: "test" });

// validate receives the option's value type and the builder's typed context.
cli
  .command("serve <env>")
  .option("--host <h>", { default: "localhost" })
  .option("-p, --port <n>", {
    type: "number",
    validate: (v, ctx) => {
      const x: number = v;
      const env: string = ctx.args.env;
      const host: string = ctx.options.host;
      // @ts-expect-error the value is a number
      const text: string = v;
      // @ts-expect-error an option defined later is not in the context yet
      void ctx.options.level;
      void [x, env, host, text];
    },
  })
  .option("--level <l>", {
    choices: ["debug", "info"],
    validate: (v) => {
      const level: "debug" | "info" = v;
      void level;
    },
  })
  .option("--ids <n>", {
    type: "number[]",
    validate: (v) => {
      const ids: readonly number[] = v;
      void ids;
    },
  })
  .option("--verbose", {
    validate: (v) => {
      const verbose: boolean = v;
      void verbose;
    },
  });

// parse's return type flows into validate.
cli.command("since").option("--since <date>", {
  parse: (value) => new Date(value),
  validate: (v) => {
    const date: Date = v;
    void date;
  },
});
cli.command("since-async").option("--since <date>", {
  parse: async (value) => new Date(value),
  validate: (v) => {
    const date: Date = v;
    void date;
  },
});

// parse gets the raw string and a context whose options may be unresolved.
cli
  .command("scale")
  .option("--factor <n>", { type: "number", default: 1 })
  .option("--size <n>", {
    parse: (value, ctx) => {
      const raw: string = value;
      const factor: number | undefined = ctx.options.factor;
      // @ts-expect-error other options may not be resolved during parse
      const strict: number = ctx.options.factor;
      void [raw, strict];
      return Number(value) * (factor ?? 1);
    },
  });

// An explicitly annotated parameter must agree with the value type.
cli.command("wrong").option("--n <n>", {
  type: "number",
  // @ts-expect-error a number option's validate does not take a string
  validate: (v: string) => {
    void v;
  },
});

// A shared schema written with `satisfies` keeps its literal shape; its callbacks see unknown.
const shared = {
  type: "number",
  validate: (v: unknown) => {
    if (typeof v !== "number") throw new Error("not a number");
  },
} satisfies OptionSchema;
cli
  .command("shared")
  .option("--n <n>", shared)
  .action((ctx) => {
    const n: number | undefined = ctx.options.n;
    void n;
  });

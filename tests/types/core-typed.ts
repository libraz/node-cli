import {
  type Action,
  type CommandBuilder,
  type CommandContext,
  type CommandValidator,
  createCLI,
  type OptionSchema,
  type Plugin,
} from "../../src/index.js";
import type { optionKeyTable } from "./option-key-table.js";

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Flat<T> = { [K in keyof T]: T[K] };
type ContextOf<B> = B extends { action(fn: (ctx: infer C) => void): unknown } ? C : never;
type OptionsOf<B> = ContextOf<B> extends { options: infer O } ? Flat<O> : never;
type ArgsOf<B> = ContextOf<B> extends { args: infer A } ? A : never;

const cli = createCLI();

// Arguments are inferred from a literal definition string; path words are skipped.
const deploy = cli.command("remote deploy <env> [region] [...rest]");
const deployArgs: Equal<
  ArgsOf<typeof deploy>,
  { env: string; region: string | undefined; rest: readonly string[] }
> = true;
void deployArgs;
deploy.action((ctx) => {
  const env: string = ctx.args.env;
  const region: string | undefined = ctx.args.region;
  const rest: readonly string[] = ctx.args.rest;
  // @ts-expect-error an optional argument may be undefined
  const strictRegion: string = ctx.args.region;
  // @ts-expect-error an undeclared argument is a type error
  void ctx.args.missing;
  // @ts-expect-error a variadic argument is a readonly array
  ctx.args.rest.push("x");
  void env;
  void region;
  void rest;
  void strictRegion;
});
const files = cli.command("cat <...files>");
const filesArgs: Equal<ArgsOf<typeof files>, { files: readonly string[] }> = true;
void filesArgs;
files.action((ctx) => {
  // @ts-expect-error a variadic argument is a readonly array
  ctx.args.files.push("x");
});

// Options accumulate along a literal chain.
const serve = cli
  .command("serve")
  .option("-p, --port <n>", { type: "number" })
  .option("-v, --verbose")
  .option("--retries <n>", { type: "number", default: 3 })
  .option("--env <env>", { required: true })
  .option("--level <l>", { choices: ["debug", "info"] })
  .option("--mode <m>", { choices: ["fast", "safe"] as const, default: "fast" })
  .option("--tags <t>", { type: "string[]" })
  .option("--since <date>", { parse: async (value) => new Date(value) })
  .option("--dates <date>", { type: "string[]", parse: (value) => new Date(value) })
  .option("--cache", { type: "boolean", default: true })
  .option("--no-color")
  .option("--name [name]");
const serveOptions: Equal<
  OptionsOf<typeof serve>,
  {
    port?: number;
    verbose: boolean;
    retries: number;
    env: string;
    level?: "debug" | "info";
    mode: "fast" | "safe";
    tags?: readonly string[];
    since?: Date;
    dates?: readonly Date[];
    cache: boolean;
    "no-color": boolean;
    name?: string;
  }
> = true;
void serveOptions;
serve.action((ctx) => {
  const port: number | undefined = ctx.options.port;
  const verbose: boolean = ctx.options.verbose;
  const retries: number = ctx.options.retries;
  const env: string = ctx.options.env;
  const noColor: boolean = ctx.options["no-color"];
  // @ts-expect-error an undeclared option is a type error
  void ctx.options.typo;
  // @ts-expect-error --no-color does not create a "color" key
  void ctx.options.color;
  // @ts-expect-error port is a number
  const portText: string = ctx.options.port;
  // @ts-expect-error ctx.options is readonly
  ctx.options = { verbose: true };
  // @ts-expect-error a string[] option is a readonly array
  ctx.options.tags?.push("x");
  void port;
  void verbose;
  void retries;
  void env;
  void noColor;
  void portText;
});
serve.validate((ctx) => {
  const verbose: boolean = ctx.options.verbose;
  void verbose;
});
serve.onCancel((ctx) => {
  const env: string = ctx.options.env;
  void env;
});

// A default outside the declared choices is rejected.
// @ts-expect-error "slow" is not one of the choices
cli.command("pick").option("--mode <m>", { choices: ["fast", "safe"], default: "slow" });
cli.command("pick-many").option("--modes <m>", {
  type: "string[]",
  choices: ["fast", "safe"],
  default: ["fast"],
});

// A non-literal definition or flags string falls back to untyped records.
declare const definition: string;
declare const flags: string;
cli.command(definition).action((ctx) => {
  const arg: unknown = ctx.args.anything;
  const option: unknown = ctx.options.anything;
  void arg;
  void option;
});
cli
  .command("wide")
  .option("--known")
  .option(flags)
  .action((ctx) => {
    const known: boolean = ctx.options.known;
    const other: unknown = ctx.options.other;
    void known;
    void other;
  });
// A schema typed as the wide OptionSchema gives an unknown value.
declare const schema: OptionSchema;
const wideSchema = cli.command("schema").option("--x <x>", schema);
const wideSchemaOptions: Equal<OptionsOf<typeof wideSchema>, { x?: unknown }> = true;
void wideSchemaOptions;

// A child builder starts from its own definition and does not inherit options.
cli
  .command("parent")
  .option("--shared")
  .command("child <id>")
  .action((ctx) => {
    const id: string = ctx.args.id;
    // @ts-expect-error a parent's options are not inherited
    void ctx.options.shared;
    void id;
  });

// Plugins get the same inference.
const plugin: Plugin = (pluginCtx) => {
  pluginCtx
    .command("status <service>")
    .option("--json")
    .action((ctx) => {
      const service: string = ctx.args.service;
      const json: boolean = ctx.options.json;
      void service;
      void json;
    });
};
void plugin;

// Named handler types take the same parameters, and a typed builder is still a CommandBuilder.
const typedAction: Action<{ env: string }, { force: boolean }> = (ctx) => {
  const env: string = ctx.args.env;
  void env;
};
cli.command("ship <env>").option("--force").action(typedAction);
const typedContext: CommandContext<{ env: string }> = {} as CommandContext<{ env: string }>;
void typedContext.options.anything;
const untyped: CommandBuilder = cli.command("untyped <x>").option("--y");
void untyped;
declare const untypedAction: Action;
declare const untypedValidator: CommandValidator;
cli
  .command("reuse <x>")
  .option("--y <y>", { type: "number" })
  .validate(untypedValidator)
  .action(untypedAction);

// The option key table agrees with the type-level key.
type Table = typeof optionKeyTable;
declare const base: CommandBuilder<Record<never, never>, Record<never, never>>;
type KeyMismatch<E> = E extends { flags: infer F extends string; key: infer K }
  ? Equal<keyof OptionsOf<ReturnType<typeof base.option<F>>>, K> extends true
    ? never
    : F
  : never;
const keysAgree: [KeyMismatch<Table[number]>] extends [never] ? true : KeyMismatch<Table[number]> =
  true;
void keysAgree;

// A 40-option chain stays within the type-instantiation depth.
const long = cli
  .command("long")
  .option("--o1 <v>", { type: "number", default: 1 })
  .option("--o2 <v>", { type: "number", default: 2 })
  .option("--o3 <v>", { type: "number", default: 3 })
  .option("--o4 <v>", { type: "number", default: 4 })
  .option("--o5 <v>", { type: "number", default: 5 })
  .option("--o6 <v>", { type: "number", default: 6 })
  .option("--o7 <v>", { type: "number", default: 7 })
  .option("--o8 <v>", { type: "number", default: 8 })
  .option("--o9 <v>", { type: "number", default: 9 })
  .option("--o10 <v>", { type: "number", default: 10 })
  .option("--o11 <v>", { type: "number", default: 11 })
  .option("--o12 <v>", { type: "number", default: 12 })
  .option("--o13 <v>", { type: "number", default: 13 })
  .option("--o14 <v>", { type: "number", default: 14 })
  .option("--o15 <v>", { type: "number", default: 15 })
  .option("--o16 <v>", { type: "number", default: 16 })
  .option("--o17 <v>", { type: "number", default: 17 })
  .option("--o18 <v>", { type: "number", default: 18 })
  .option("--o19 <v>", { type: "number", default: 19 })
  .option("--o20 <v>", { type: "number", default: 20 })
  .option("--o21 <v>", { type: "number", default: 21 })
  .option("--o22 <v>", { type: "number", default: 22 })
  .option("--o23 <v>", { type: "number", default: 23 })
  .option("--o24 <v>", { type: "number", default: 24 })
  .option("--o25 <v>", { type: "number", default: 25 })
  .option("--o26 <v>", { type: "number", default: 26 })
  .option("--o27 <v>", { type: "number", default: 27 })
  .option("--o28 <v>", { type: "number", default: 28 })
  .option("--o29 <v>", { type: "number", default: 29 })
  .option("--o30 <v>", { type: "number", default: 30 })
  .option("--o31 <v>", { type: "number", default: 31 })
  .option("--o32 <v>", { type: "number", default: 32 })
  .option("--o33 <v>", { type: "number", default: 33 })
  .option("--o34 <v>", { type: "number", default: 34 })
  .option("--o35 <v>", { type: "number", default: 35 })
  .option("--o36 <v>", { type: "number", default: 36 })
  .option("--o37 <v>", { type: "number", default: 37 })
  .option("--o38 <v>", { type: "number", default: 38 })
  .option("--o39 <v>", { type: "number", default: 39 })
  .option("--o40 <v>", { type: "number", default: 40 });
long.action((ctx) => {
  const first: number = ctx.options.o1;
  const last: number = ctx.options.o40;
  void first;
  void last;
});

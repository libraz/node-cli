import {
  type CommandBuilder,
  type Completer,
  type CompletionContext,
  createCLI,
  type OptionSchema,
} from "../../src/index.js";

const cli = createCLI({ name: "test" });
const builder: CommandBuilder = cli.command("deploy <env>");

// The completer receives a context and may return a readonly array, sync or async.
const completer: Completer = (ctx) => [ctx.current, ...ctx.commandPath];
const asyncCompleter: Completer = async (ctx) => (ctx.signal.aborted ? [] : (["a"] as const));
builder.completer(completer).completer(asyncCompleter);
// @ts-expect-error the 1.x `(current: string)` completer form is gone
builder.completer((current: string) => [current]);
// @ts-expect-error `.complete()` is renamed to `.completer()`
builder.complete(completer);

// onCancel replaces cancel; an async handler is accepted.
builder.onCancel(async (ctx) => {
  ctx.stderr.write("stopped\n");
});
// @ts-expect-error `.cancel()` is renamed to `.onCancel()`
builder.cancel(() => {});

// Option completers share the Completer shape or take a static readonly array.
const regions = ["us-east-1", "eu-west-1"] as const;
builder.option("--region <r>", { completer: regions });
builder.option("--zone <z>", { completer: (ctx) => [ctx.current] });
// @ts-expect-error `autocomplete` is renamed to `completer`
builder.option("--old <o>", { autocomplete: ["a"] });
// @ts-expect-error the 1.x `(current: string)` option completer form is gone
builder.option("--older <o>", { completer: (current: string) => [current] });

// Readonly arrays are accepted wherever the builder only reads them.
const levels = ["debug", "info"] as const;
const aliases = ["d", "dep"] as const;
builder.option("--level <l>", { choices: levels });
builder.option("-q, --quiet", { alias: ["s"] as const });
builder.alias(...aliases);
const schema: OptionSchema = { choices: levels, alias: aliases, completer: regions };
void schema;

// Option and command callbacks may be async.
builder.option("--port <p>", {
  parse: async (value) => Number(value),
  validate: async (value) => {
    if (value === 0) throw new Error("zero");
  },
});
builder.validate(async (ctx) => {
  void ctx.args;
});

// Every builder setter returns the builder; remove() ends the chain with a boolean.
const chained: CommandBuilder = builder
  .description("Deploy")
  .hidden(false)
  .option("--force")
  .alias("ship")
  .action(() => {});
const child: CommandBuilder = builder.command("status");
const removed: boolean = child.remove();
void chained;
void removed;

// A command completer may also be a static list.
builder.completer(["production", "staging"]).completer(regions);
// @ts-expect-error a static list holds strings
builder.completer([1, 2]);

// The completion context is readonly; args and options are records of raw values.
declare const ctx: CompletionContext;
// @ts-expect-error current is readonly
ctx.current = "x";
// @ts-expect-error iteration is readonly
ctx.iteration = 2;
// @ts-expect-error commandPath is a readonly array
ctx.commandPath.push("x");
// @ts-expect-error args is readonly
ctx.args.anything = "x";
// @ts-expect-error options is readonly
ctx.options.anything = true;
const arg: string | readonly string[] = ctx.args.anything;
const option: string | boolean | readonly string[] = ctx.options.anything;
// @ts-expect-error an option value is not a number before coercion
const coerced: number = ctx.options.anything;
void arg;
void option;
void coerced;

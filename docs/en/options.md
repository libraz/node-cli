# Options

An option is a named input written with a leading dash — `--force`, `-p 8080`,
`--tag=v2`. Unlike a [positional argument](commands.md), it can appear in any
order, it carries a declared type, and it can have a default value.

Options are declared with `.option()` on a command builder and are read from
`ctx.options` inside the action.

## Declaring an option

`.option()` takes a flag specification string and an optional schema object:

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp" });

cli
  .command("serve")
  .option("-p, --port <number>", {
    type: "number",
    default: 3000,
    description: "Port to listen on",
  })
  .option("--verbose", { description: "Print each request" })
  .action((ctx) => {
    const port = ctx.options.port as number;
    ctx.stdout.write(`listening on ${port}\n`);
  });

await cli.start();
```

The schema may be omitted entirely. `.option("--verbose")` declares a boolean
flag with no description.

Options are per command. A subcommand does not inherit its parent's options;
declare them on each command that accepts them.

## The flag spec string

The specification string is split on commas. A comma inside `<>` or `[]` is not
a separator, so a placeholder may contain one.

![Anatomy of the flag specification string "-p, --port <number>". The string is split at the comma into two parts. The first part, -p, is labelled short alias: one dash, exactly one character. The second part, --port, is labelled canonical long name and is marked as the key used in ctx.options. A space followed by the bracketed token <number> is labelled value placeholder, with a note that the space is required and that the captured word is used only in help output. Below the anatomy, four accepted input forms are listed: --port 8080, --port=8080, -p 8080 and -p=8080.](../assets/option-anatomy.svg)

Each part is read as follows:

| Part | Meaning |
|---|---|
| `--long` | The canonical long name. When several `--` parts appear, the **last one wins** and the earlier ones become long aliases |
| `-x` | A short alias |
| ` <name>` or ` [name]` at the end of a part | A value placeholder |

Three rules follow from this:

**The space before a placeholder is required.** `--port<n>` has no whitespace, so
nothing is recognized as a placeholder and the whole token is read as the long
name `port<n>`, which fails the name check. Write `--port <n>`.

**The placeholder name is used only in help.** `.option("--port <number>")`
renders as `--port <number>` in the help listing; the key in `ctx.options` is
still `port`. When no placeholder is given but the option takes a value, help
falls back to the long name: `--port <port>`.

**With no `--` part, the first short alias becomes the long name.**
`.option("-p")` declares an option whose canonical name is `p`, read as
`ctx.options.p`.

Names — the long name and every alias — must match
`/^[A-Za-z0-9][A-Za-z0-9-]*$/`: start with a letter or digit, then letters,
digits, or hyphens.

The placeholder only sets the *inferred* type when the schema does not state one.
Once the type is settled, that type alone decides whether the option consumes a
value. `.option("--name", { type: "string" })` has no placeholder yet still
consumes the next token, and it renders as `--name <name>` in help.

```typescript
cli
  .command("build")
  .option("-f, --force") //              boolean; key: force
  .option("--tag <tag>") //              string;  key: tag
  .option("--colour, --color <name>") // string;  key: color, alias: colour
  .option("-p"); //                      boolean; key: p
```

## The option schema

| Field | Type | Default | Behavior |
|---|---|---|---|
| `description` | `string` | — | Text shown in help |
| `type` | `"string" \| "number" \| "boolean" \| "string[]" \| "number[]"` | `"string"` when the spec has a placeholder, otherwise `"boolean"` | Selects the built-in conversion |
| `alias` | `string \| string[]` | — | Extra names. A one-character alias becomes a short flag. A longer alias is accepted only for a name the spec already declared with `--`; any other multi-character alias throws |
| `required` | `boolean` | `false` | The command fails with `MissingOptionError` if the flag is absent. Cannot be combined with `default` |
| `default` | `unknown` | boolean options receive `false` unless `required` | Used only when the flag is absent |
| `choices` | `unknown[]` | — | Restricts the accepted values |
| `parse` | `(value: string, ctx) => unknown` | — | Replaces built-in conversion entirely |
| `validate` | `(value: unknown, ctx) => void` | — | Rejects a resolved value by throwing |
| `hidden` | `boolean` | `false` | Excludes the option from help and completion |
| `autocomplete` | `string[] \| ((current: string) => string[] \| Promise<string[]>)` | — | Value candidates for tab completion; takes precedence over `choices` |

Aliases from `alias` are merged with those in the specification string, so
`.option("--port <n>", { alias: "p" })` and `.option("-p, --port <n>")` declare
the same option.

## Types and coercion

*Coercion* is the conversion of the typed text into the declared type. Every
value arrives from the command line as a string; coercion turns it into a
string, number, boolean, or array.

**`string`** applies `String(value)` and accepts anything.

**`boolean`** accepts a fixed set of spellings, compared after trimming and
lower-casing:

| Input | Result |
|---|---|
| `true`, `1`, `yes`, `on` | `true` |
| `false`, `0`, `no`, `off`, empty string | `false` |
| anything else | `InvalidOptionError` |

A boolean option normally needs no value at all: writing `--verbose` sets it to
`true`. The table above applies when a value is attached explicitly, as in
`--verbose=0`.

**`number`** accepts only plain decimal notation, optionally signed, optionally
with a fractional part and an exponent. It rejects several forms that JavaScript's
own `Number()` would accept:

| Input | Result |
|---|---|
| `8080`, `-5`, `3.14`, `1e3` | Accepted |
| `0x1f`, `0o17`, `0b101` | Rejected — hexadecimal, octal, and binary literals |
| `007` | Rejected — zero-padded integers |
| `Infinity`, `NaN` | Rejected |
| `""`, `"   "` | Rejected — blank strings |
| a magnitude above `Number.MAX_SAFE_INTEGER` | Rejected, with a message naming the safe-integer limit rather than calling the value "not a number" |

**`string[]` and `number[]`** always produce an array. A single value is wrapped
into a one-element array, and each element of a multi-value option is converted
individually.

```typescript
cli.command("run").option("--tags <tag>", { type: "string[]" });
// myapp run --tags a --tags b  → ctx.options.tags is ["a", "b"]
// myapp run --tags a           → ctx.options.tags is ["a"]
```

## Defaults and required

`default` supplies the value used when the flag is absent:

```typescript
cli.command("run").option("--retries <n>", { type: "number", default: 3 });
// myapp run             → ctx.options.retries is 3
// myapp run --retries 5 → ctx.options.retries is 5
```

The declared default is run through built-in coercion when the option is
declared, which has two consequences. A default that does not fit the type
throws immediately, at startup rather than at parse time — `{ type: "number",
default: "abc" }` fails as soon as `.option()` runs. And a default that fits is
stored in its converted form, so `{ type: "number", default: "8080" }` yields the
number `8080`.

Three defaults are rejected outright:

- `null` on a `boolean` or `number` option.
- A default that is not among the declared `choices`.
- A default combined with `required: true`.

`required: true` makes the flag mandatory; omitting it raises
`MissingOptionError`.

```typescript
cli
  .command("deploy")
  .option("--env <env>", { required: true, description: "Target environment" });
```

`required` and `default` are mutually exclusive, and combining them throws when
the option is declared. A required option that also had a default could never be
missing, so the requirement would have no effect.

Every boolean option receives `default: false` automatically unless it is
`required`. That is why an unset boolean reads as `false`, never `undefined`.

## Choices

`choices` restricts the accepted values:

```typescript
cli.command("deploy").option("--env <env>", { choices: ["dev", "staging", "prod"] });
// myapp deploy --env qa
// → InvalidOptionError: Invalid value "qa" for --env. Allowed: dev, staging, prod
```

The comparison is lenient: a candidate matches if it equals a declared choice, or
if its string form equals the string form of a declared choice. A `number`
option whose choices are written as the strings `["1", "2"]` therefore still
accepts the input `1`, which coerces to the number `1`.

For an array-typed option every element is checked individually, not the array
as a whole.

The check runs only when the option is present in the resolved set — that is,
when the flag was supplied or a default applied.

## Custom `parse` and `validate`

`parse` replaces built-in coercion. It receives the raw string and the command
context, and returns whatever the action should see:

```typescript
cli.command("log").option("--since <date>", {
  parse: (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${value}`);
    return date;
  },
});
```

Three rules govern it:

- Built-in coercion is skipped entirely; the declared `type` no longer converts
  anything.
- For an array type, `parse` is applied to each element in turn.
- A throw is wrapped in `ValidationError`, whose message reads
  `Invalid value for --since: ...`. See [Errors](errors.md).

`parse` is never applied to a `default`. A default is treated as an
already-resolved value, so it passes through built-in coercion only.

`validate` inspects a resolved value and rejects it by throwing. It runs in a
second pass, after every option on the command has been resolved, so
`ctx.options` is complete and one option may be checked against another:

```typescript
cli
  .command("serve")
  .option("--port <n>", { type: "number" })
  .option("--tls", { type: "boolean" })
  .option("--cert <path>", {
    validate: (value, ctx) => {
      if (ctx.options.tls && !value) throw new Error("--tls requires --cert");
    },
  })
  .action(startServer);
```

A throw from `validate` is wrapped in `ValidationError` in the same way. Like the
`choices` check, it runs only for options that are present in the resolved set.

To validate the command as a whole rather than one option, use
[`validate()` on the command builder](commands.md#validation).

## Accepted input forms

| Form | Behavior |
|---|---|
| `--long value` | Consumes the next token, unless that token looks like an option |
| `--long=value` | Always works. An attached form like this is the only way to pass a value starting with `-` to a non-number option |
| `-s value` | Same as the long form |
| `-s=value` | Same as `--long=value`, and equally usable for a value starting with `-` |
| `-abc` | Short clustering: read as `-a -b -c`. **Every** character must name a boolean option |
| `--no-x` | Negation — sets a boolean option to `false` |
| `--` | Every token after it becomes a positional value, verbatim |
| `-5`, `-3.14` | A positional value. `-5` is an option only if an option or alias is literally named `5`; `-3.14` can never be one, because a name may not contain `.` |
| `-` alone | A positional value |
| a standalone `<` or `>` token | `ParseError: Redirection operator "<" is not supported` |

An unrecognized flag raises `UnknownOptionError`, including a character inside a
short cluster. A character in a cluster that names a value-taking option, and a
value-taking option with no value left to consume, both raise
`InvalidOptionError`; the latter's message names the `--long=<value>` form.

A token starting with `-` normally ends the current option's value, which is why
`--tag -x` fails rather than storing `-x`. The exception is a `number` or
`number[]` option: if the token parses as a number it is taken as the value, so
`--offset -5` stores `-5`.

```typescript
cli
  .command("list")
  .option("--offset <n>", { type: "number" })
  .option("--tag <tag>");

// myapp list --offset -5   → ctx.options.offset is -5
// myapp list --tag -5      → InvalidOptionError
// myapp list --tag=-5      → ctx.options.tag is "-5"
```

## Repeated options

What happens when a flag is supplied more than once depends on its type:

- `string[]` and `number[]` accumulate every occurrence into the array, in the
  order typed.
- Every other type keeps the **last** occurrence and discards the earlier ones.

```typescript
cli.command("collect").option("--tag <tag>", { type: "string[]" });
// myapp collect --tag a --tag b   → ctx.options.tag is ["a", "b"]

cli.command("label").option("--tag <tag>", { type: "string" });
// myapp label --tag a --tag b     → ctx.options.tag is "b"
```

Declaring an option as an array type is the only way to collect repeated values.

## Negation

`--no-<name>` sets a boolean option to `false`:

```typescript
cli.command("build").option("--cache", { type: "boolean", default: true });
// myapp build            → ctx.options.cache is true
// myapp build --no-cache → ctx.options.cache is false
```

Four rules apply:

- Negation works on boolean options only. `--no-port` on a string option raises
  `InvalidOptionError`.
- `--no-x` takes no value. `--no-cache=1` raises `InvalidOptionError`.
- The negated name may be either the long name or an alias.
- Negation is skipped when an option is literally named `no-x`. Declaring
  `.option("--no-color")` creates an option whose key is `no-color`; the token
  `--no-color` then sets that option to `true` rather than setting `color` to
  `false`.

Help notes the negated form automatically next to every boolean option.

## The `--` separator

`--` ends option parsing. Every token after it is treated as a positional value,
exactly as typed, even if it begins with a dash:

```typescript
cli.command("run <...args>").action((ctx) => {
  ctx.stdout.write(`${(ctx.args.args as string[]).join(" ")}\n`);
});
// myapp run -- --verbose -x   → args is ["--verbose", "-x"]
```

There is no separate bucket for these values: no `rest` property, no `"--"` key.
They simply fill the command's remaining positional slots in order. A command
with no free slot left raises `ExtraArgumentError`, so `--` is useful only on a
command that declares enough positional arguments — usually a variadic one — to
receive them.

## Reading options in an action

`ctx.options` is keyed by the canonical long name, and holds values that are
already coerced, defaulted, and validated:

```typescript
cli
  .command("serve")
  .option("-p, --port <number>", { type: "number", default: 3000 })
  .option("-v, --verbose")
  .option("--tags <tag>", { type: "string[]" })
  .action((ctx) => {
    const port = ctx.options.port as number;
    const verbose = ctx.options.verbose as boolean;
    const tags = (ctx.options.tags as string[] | undefined) ?? [];
    ctx.stdout.write(`port=${port} verbose=${verbose} tags=${tags.length}\n`);
  });
```

The values arrive typed as `unknown`, so a cast or a runtime check is needed to
use them. The cast is safe for any option whose type the schema declares.

`ctx.options` is a null-prototype object: it does not inherit the usual `Object`
methods. Testing for a key requires `Object.hasOwn`:

```typescript
cli
  .command("index")
  .option("--tags <tag>", { type: "string[]" })
  .action((ctx) => {
    if (Object.hasOwn(ctx.options, "tags")) {
      // The flag was supplied, or a default applied.
    }
    // ctx.options.hasOwnProperty("tags") throws a TypeError.
  });
```

## Gotchas

**`ctx.options` is never keyed by an alias.** `-p` and `--port` both write
`ctx.options.port`. Reading `ctx.options.p` yields `undefined` unless `p` is the
canonical name, which happens only when the specification string has no `--`
part.

**An omitted boolean option is `false`, not `undefined`.** Booleans receive an
automatic default, so `if (ctx.options.force !== undefined)` is always true.
Test the value itself: `if (ctx.options.force)`.

**`required` and `default` cannot be combined.** Declaring both throws when
`.option()` runs.

**A custom `parse` does not run on a `default`.** A default is coerced by the
built-in conversion only, so a `parse` returning a `Date` and a default written
as a string produce two different value types. Supply the default already in its
final form, or omit it and apply the fallback inside the action.

**A placeholder silently changes the type.** `.option("-v, --verbose")` is a
boolean; `.option("-v, --verbose <level>")` is a string, because the placeholder
changes the inferred type. Set `type` explicitly when the intent matters.

**Every character in a short cluster must be boolean.** `-vp 8080` fails,
because `p` takes a value. Write `-v -p 8080`.

**The last `--` part in a spec wins.** `.option("--colour, --color <name>")`
names the option `color` and makes `colour` an alias, not the other way around.

## Related pages

- [Commands](commands.md) — command names, positional arguments, and the lifecycle
- [Errors](errors.md) — `InvalidOptionError`, `MissingOptionError`, `UnknownOptionError`, `ValidationError`
- [Interactive shell](interactive-shell.md) — tab completion and `autocomplete`
- [API reference](api-reference.md) — full signatures

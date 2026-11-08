# Commands

A command is a named action the user invokes by typing its name. `cli.command()`
declares one and returns a builder whose methods configure it.

This page covers command names, positional arguments, subcommands, and the
lifecycle a command goes through when it runs. Flags such as `--force` are
covered in [Options](options.md).

## Defining a command

`cli.command()` takes a single specification string and returns a
`CommandBuilder`. Chain `description()` and `action()` onto it:

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp" });

cli
  .command("ping")
  .description("Check connectivity")
  .action((ctx) => {
    ctx.stdout.write("pong\n");
  });

await cli.start();
```

The command is registered while `cli.command()` runs, not when the chain ends,
so it exists as soon as the call returns. Every configuration method returns the
same builder, so the order of the chained calls does not matter. Two methods end
or move the chain: `command(spec)` returns the subcommand's builder, and
`remove()` returns a boolean.

The action receives one argument, the [command context](#the-command-context).
Write output through `ctx.stdout` rather than `console.log` so that output
routing works in the interactive shell and in tests.

### Builder methods

| Method | Effect | Returns | Repeated call |
|---|---|---|---|
| `description(text)` | Sets the text shown next to the command in help | the builder | Replaces |
| `option(flags, schema)` | Declares a flag — see [Options](options.md) | the builder | Same name replaces in place; a new name adds |
| `action(fn)` | Sets the function to run when the command is dispatched | the builder | Replaces |
| `alias(...names)` | Adds alternative names for the command | the builder | Adds; duplicates are ignored |
| `hidden(hidden = true)` | Hides the command from help and completion | the builder | Replaces |
| `validate(fn)` | Sets a check that runs before the action | the builder | Replaces |
| `onCancel(fn)` | Sets a handler that runs when the command is interrupted | the builder | Replaces |
| `completer(fn)` | Sets a custom tab-completion provider — see [Interactive shell](interactive-shell.md) | the builder | Replaces |
| `command(spec)` | Declares a subcommand under this command | the subcommand's builder | Same name merges into the existing subcommand |
| `remove()` | Unregisters the command | `true` if removed | Returns `false` |

A completer receives a `CompletionContext` and returns candidates for
`ctx.current`, either as a readonly array or as a promise of one:

```typescript
cli
  .command("checkout <branch>")
  .completer(async (ctx) => {
    const branches = await listBranches({ signal: ctx.signal });
    return branches.filter((name) => name.startsWith(ctx.current));
  })
  .action(checkout);
```

There is no `default()`, `example()`, `usage()`, or `argument()` method. A usage
line is generated from the specification string, and there is no concept of a
default command that runs when no command name is given.

## The argument spec syntax

The specification string is split on whitespace. Each token is classified by its
first character:

- A token starting with `<` or `[` declares a **positional argument** — a value
  the user types in a fixed position, without a flag name.
- Any other token is a **bare name**. The last bare name is the command itself;
  every earlier bare name is a parent command.

```typescript
cli.command("deploy <env> [region]");
//           ^^^^^^ command name
//                  ^^^^^ required argument
//                        ^^^^^^^^ optional argument
```

Four bracket forms are recognized:

| Token | Meaning | Value in `ctx.args` |
|---|---|---|
| `<name>` | Required, exactly one value | `string` |
| `[name]` | Optional, at most one value | `string \| undefined`; the key is absent when omitted |
| `<...name>` | Required variadic — one or more values | `readonly string[]`, never empty |
| `[...name]` | Optional variadic — zero or more values | `readonly string[]`, possibly empty |

When the specification is a string literal, `ctx.args` is typed from it, so no
cast is needed. A specification held in a `string` variable leaves `ctx.args` as
`Record<string, unknown>`.

*Variadic* means the argument collects every remaining value into an array
instead of taking exactly one. See the [glossary](glossary.md).

### Worked transcripts

```typescript
cli.command("copy <source> [dest]").action((ctx) => {
  const source = ctx.args.source;
  const dest = ctx.args.dest ?? ".";
  ctx.stdout.write(`${source} -> ${dest}\n`);
});
```

| Input | Result |
|---|---|
| `myapp copy a.txt b.txt` | `ctx.args` is `{ source: "a.txt", dest: "b.txt" }` |
| `myapp copy a.txt` | `ctx.args` is `{ source: "a.txt" }` — the `dest` key is absent |
| `myapp copy` | `MissingArgumentError`, carrying the command's usage line |
| `myapp copy a.txt b.txt c.txt` | `ExtraArgumentError` for `c.txt` |

With a variadic argument the last row behaves differently:

```typescript
cli.command("copy <...files>").action((ctx) => {
  const files = ctx.args.files;
  ctx.stdout.write(`${files.length} file(s)\n`);
});
```

| Input | Result |
|---|---|
| `myapp copy a.txt b.txt c.txt` | `ctx.args.files` is `["a.txt", "b.txt", "c.txt"]` |
| `myapp copy a.txt` | `ctx.args.files` is `["a.txt"]` |
| `myapp copy` | `MissingArgumentError` for `...files` |

### Errors raised when the spec is invalid

These are thrown as `Error` objects with `code: "ERR_INVALID_DEFINITION"` while
`cli.command()` runs, so a malformed specification fails at startup rather than
when a user types the command:

- A bare name appears after an argument token (`"deploy <env> now"`).
- The string contains no bare name at all (`"<env>"`).
- A bracket is missing its closing character (`"deploy <env"`).
- An argument name is empty (`"deploy <>"`).
- Two arguments share a name (`"copy <file> [file]"`).
- A required argument follows an optional one (`"copy [dest] <source>"`).
- A variadic argument is not the last one (`"copy <...files> <dest>"`).

### What the spec does not support

| Written | Actual meaning |
|---|---|
| `[name=foo]` | An optional argument literally named `name=foo` — there are no default values in the spec |
| `<port:number>` | An argument literally named `port:number` — there are no type annotations |
| `<dev\|prod>` | An argument literally named `dev\|prod` — there are no unions |
| `deploy <env> ...` | A trailing `...` is not a bracket form, so it is read as a bare name — and a bare name after an argument is an error |

Defaults, types, choices, and validation belong to [options](options.md), not to
positional arguments.

## Positional arguments at runtime

`ctx.args` holds the positional arguments, keyed by the names from the
specification string. Its members are readonly. Four rules describe every value
it can hold.

**Values are always strings.** A non-variadic argument is a `string`; a variadic
argument is a `readonly string[]`. No conversion is applied, so a numeric argument must be
converted in the action:

```typescript
cli.command("wait <seconds>").action((ctx) => {
  const seconds = Number(ctx.args.seconds);
  if (!Number.isFinite(seconds)) throw new Error("seconds must be a number");
  ctx.stdout.write(`waiting ${seconds}s\n`);
});
```

**A variadic argument always yields an array.** For `[...name]` that array may be
empty; for `<...name>` zero values are rejected with `MissingArgumentError`
before the action runs.

**A missing optional argument leaves its key absent**, rather than present with
the value `undefined`. Reading it still yields `undefined`, so a default is
usually written with `??`. When the distinction matters, test for the key with
`Object.hasOwn`:

```typescript
cli.command("copy <source> [dest]").action((ctx) => {
  if (Object.hasOwn(ctx.args, "dest")) {
    // The user supplied a destination.
  }
});
```

`ctx.args` is a null-prototype object, which means it does not inherit the usual
`Object` methods. `ctx.args.hasOwnProperty("dest")` throws a `TypeError`;
`Object.hasOwn(ctx.args, "dest")` is the working form.

**Leftover values are an error.** If the user supplies more positional values
than the command declares, and the command has an action, an
`ExtraArgumentError` naming the first extra value is thrown. See
[Errors](errors.md).

## Subcommands and groups

A command can nest under another. Two forms declare the same structure:

```typescript
// Path form: the last bare name is the command, earlier names are parents.
cli.command("db migrate").action(runMigrations);

// Builder form: keep a reference to the parent and call .command() on it.
const db = cli.command("db").description("Database operations");
db.command("migrate").action(runMigrations);
db.command("seed").action(seedDatabase);
```

In the path form, a parent that does not exist yet is created automatically as a
**group** — a command with a name and no action. In the builder form,
`cli.command("db")` is that same group as long as no `action()` is set on it.

![Command tree for an application named myapp: the root has three children. deploy takes an env argument and carries the alias d; db is a group with no action whose children are migrate and seed; user is a group with no action whose children are create <name> and delete <name>. Notes explain that an alias resolves to the real name, that running myapp db alone prints that group's help, and how myapp db migrate --steps 2 splits into the command path db migrate and the option --steps 2. A warning box at the bottom shows the pitfall: report <file> has both an argument and a subcommand, so its child daily is unreachable.](../assets/command-tree.svg)

Dispatch walks the typed tokens from the root downwards, matching each token
against the subcommands of the command matched so far, and stops at the first
token that matches nothing. Everything left over becomes arguments and options.

A group has no action, so it cannot run. It behaves as follows:

- With no extra input (`myapp db`) it prints its own help page, listing its
  subcommands.
- With extra input (`myapp db bogus`) it reports an unknown command. If a
  fallback handler is registered with `cli.fallback()`, that handler receives the
  input instead; otherwise a `CommandNotFoundError` is thrown, carrying the list
  of available subcommands.

### Re-registering the same path

Declaring the same command path twice merges the two declarations rather than
replacing or duplicating the command. `action`, `description`, the completion
provider, `validate`, and the cancel handler each overwrite the previous value
when the new declaration sets one; options merge key by key; aliases are added to
the existing set, so earlier aliases keep resolving; the positional argument list
is replaced wholesale, including with an empty list.

```typescript
cli.command("status <target>").action(showStatus);
cli.command("status").description("Show status"); // argument list is now empty
```

This is how a [plugin](events-and-plugins.md) refines a command another module
already declared.

### Pitfall: unreachable subcommands

Dispatch stops descending at the first command that has **both an action and at
least one positional argument**. From that point on, every remaining token is
treated as an argument value, never as a subcommand name. Any subcommand
underneath such a command can therefore never be dispatched.

```typescript
// Broken: `task` runs and takes an argument, so `list` is only ever an argument.
const task = cli.command("task <name>").action(runTask);
task.command("list").action(listTasks);

// `myapp task list` runs runTask with ctx.args.name === "list".
```

This is not silent. At registration, a warning is emitted through
`process.emitWarning` with the code `NODE_CLI_UNREACHABLE_SUBCOMMAND`, and help
and tab completion both omit the unreachable subcommands so the interface never
advertises something that cannot be run.

The fix is to keep the parent free of both an action and positional arguments,
and to move the argument onto a subcommand:

```typescript
const task = cli.command("task").description("Task operations");
task.command("run <name>").action(runTask);
task.command("list").action(listTasks);

// myapp task run build
// myapp task list
```

The same rule explains why a bare name after an argument is rejected in a
specification string: `cli.command("task <name> list")` would describe exactly
this unreachable arrangement.

## Aliases

`alias()` adds alternative names for a command:

```typescript
cli.command("deploy <env>").alias("d", "dep").action(deploy);

// myapp deploy prod
// myapp d prod
// myapp dep prod
```

Aliases work at any depth, including on subcommands:

```typescript
const user = cli.command("user");
user.command("create <name>").alias("c", "new").action(createUser);

// myapp user new Alice
```

An alias is resolved to the real command name before the action runs, so
`ctx.commandPath` always holds the canonical path — `["user", "create"]`, never
`["user", "new"]`.

Aliases are checked when they are registered. Adding an alias that collides with
a sibling command's name, or with an alias another sibling already claims,
throws an `Error` with `code: "ERR_DEFINITION_CONFLICT"`. A real command always
wins over an alias of the same name, so an alias can never shadow a command.

## Hidden commands

`hidden()` removes a command from the help index and from tab completion:

```typescript
cli.command("debug-dump").hidden().action(dumpState);
```

The command remains fully dispatchable — `myapp debug-dump` runs it — and
`myapp help debug-dump` still prints its page. Hiding keeps an internal or
deprecated command out of the advertised interface; it does not restrict access.

## Validation

`validate()` registers a check that runs after options are resolved and before
the `beforeExecute` event. Throwing from it stops the command:

```typescript
cli
  .command("deploy <env>")
  .option("--force", { type: "boolean" })
  .validate((ctx) => {
    if (ctx.args.env === "prod" && !ctx.options.force) {
      throw new Error("Deploying to prod requires --force");
    }
  })
  .action(deploy);
```

Because it runs after option resolution, the validator sees fully resolved
option values, including defaults and any custom conversion.

The function may be asynchronous, and it is awaited:

```typescript
cli.command("deploy <env>").validate(async (ctx) => {
  const exists = await environmentExists(ctx.args.env);
  if (!exists) throw new Error("Environment not found");
});
```

Whatever it throws propagates unchanged. It is not wrapped in `ValidationError`
— that class is reserved for a failure inside an individual option's `parse` or
`validate`. See [Errors](errors.md).

## Cancellation

A running command is cancelled when the user presses Ctrl+C, or when an
`AbortSignal` supplied to `cli.exec()` aborts. Two mechanisms report this,
and they fire together, so a command may use either or both.

`onCancel()` registers a callback for cleanup. It is not awaited; if it returns
a promise that rejects, the rejection is reported through the `error` event:

```typescript
cli
  .command("sync")
  .onCancel((ctx) => {
    ctx.stderr.write("\nCancelled; rolling back.\n");
    releaseLock();
  })
  .action(runSync);
```

`ctx.signal` is an `AbortSignal` that is aborted at the same moment. Pass it to
any abort-aware API so the work itself stops:

```typescript
cli.command("fetch <url>").action(async (ctx) => {
  const res = await fetch(ctx.args.url, { signal: ctx.signal });
  ctx.stdout.write(await res.text());
});
```

An action that catches errors can tell a cancellation from a failure with
`isCancellationError(err, ctx.signal)`; see [Errors](errors.md).

Cancellation is cooperative: aborting the signal and calling the cancel handler
asks the command to stop, and the command is expected to do so on its own.
Nothing forcibly unwinds a running action.

At a terminal there is an escape hatch for a command that ignores the request: a
second Ctrl+C terminates the process with exit status 130. That escalation
belongs to the interrupt path only. When the signal comes from an
`signal` passed to `cli.exec()`, there is no second press and no
forced exit — a command that ignores the abort runs to completion.

## Removing a command

`remove()` unregisters a command and returns `true` when a command was found and
removed:

```typescript
const temp = cli.command("temporary").action(runTemporary);
temp.remove(); // true
```

Removal takes the command's whole subtree with it, including the aliases
registered anywhere beneath it. Afterwards every other builder method on that
builder throws an `Error` with `code: "ERR_COMMAND_REMOVED"`, so a stale
reference cannot silently reconfigure a command that is no longer registered.

## The command lifecycle

Each stage below runs only if the previous one succeeded. A failure at any stage
skips the action and reports the error.

![Command lifecycle as a left-to-right flow: raw input is tokenized, the command path is matched against the registry, positional arguments are bound, options are parsed, options are resolved, the command validator runs, the beforeExecute event is emitted, the action runs, and the afterExecute event is emitted. A failure branch leaves any stage from argument binding onwards and joins a shared path that emits commandError and then error before the error is rethrown.](../assets/command-lifecycle.svg)

1. **Tokenize** — string input is split into tokens, respecting quotes. Array
   input is already tokenized.
2. **Match the command path** — tokens are walked against the registry, aliases
   resolved, until no further subcommand matches.
3. **Bind positional arguments** — leftover non-flag values are assigned to the
   declared arguments, and required ones are checked.
4. **Parse options** — flags are separated from positional values and grouped by
   canonical name.
5. **Resolve options** — conversion, defaults, required checks, `choices`, and
   per-option `parse` and `validate` run. See [Options](options.md).
6. **Validate** — the command's own `validate()` runs.
7. **beforeExecute** — the event is emitted to every listener.
8. **action** — the command's action runs.
9. **afterExecute** — the event is emitted once the action resolves.

When any stage from step 3 onwards throws, the `commandError` event fires with
the error and the context, then the `error` event fires, and the error is
rethrown. Events are described in
[Events and plugins](events-and-plugins.md).

### The command context

Every action, validator, and cancel handler receives the same context object.
`args` and `options` are typed from the command definition and the `.option()`
calls that precede the handler (see [Typed options](options.md#typed-options)):

| Property | Type | Description |
|---|---|---|
| `args` | typed from the definition string | Positional arguments by name; readonly, null-prototype |
| `options` | typed from the option schemas | Resolved options by canonical long name; readonly, null-prototype |
| `rawInput` | `string` | The input as one string |
| `rawArgv` | `readonly string[] \| null` | The exact input elements, when the input was an array; otherwise `null` |
| `commandPath` | `readonly string[]` | The canonical path, for example `["db", "migrate"]` |
| `shell` | `Shell \| null` | The interactive shell, or `null` |
| `signal` | `AbortSignal` | Aborted when the command is cancelled |
| `stdin` | `Readable \| null` | Input stream, or `null` when none is available |
| `stdout` | `Writable` | Output stream |
| `stderr` | `Writable` | Error stream |

Three of these need care:

- **`rawInput` is lossy.** When the CLI is started from argv — the array of
  command-line words the operating system hands the program — `rawInput` is
  those elements joined with single spaces, so quoting and embedded spaces are
  no longer distinguishable. Use `rawArgv` when the exact values matter.
  `rawArgv` is set only for array input, and is `null` for the string
  input used by `cli.exec()` and by the interactive shell.
- **`shell` is non-null only inside the interactive shell.** It is `null` in
  direct mode and under `cli.exec()`.
- **`stdin` depends on the surface.** In direct mode it is `process.stdin`; for a
  stage in a pipeline it is the upstream stage's output; in the interactive
  shell, for a command that is not part of a pipeline, it is `null`.

Both `args` and `options` are null-prototype objects. Use
`Object.hasOwn(ctx.options, "force")` rather than
`ctx.options.hasOwnProperty("force")`, which throws.

## Built-in help and `--version`

Help is available without declaring anything.

`-h` and `--help` are recognized at any position among a command's arguments,
including inside a cluster of short flags such as `-vh`, and print that
command's page:

```bash
$ myapp deploy --help
Usage: deploy <env> [options]
```

Required arguments are not checked when help is requested, so
`myapp deploy --help` works even though `<env>` was not supplied.

A bare `--help` or `-h` as the only token prints the index of all commands.

These flags stop working on a command that declares an option named `help` or
aliased `h`. That is intentional: an application flag always wins. Help output
and tab completion adapt automatically, advertising only the forms that still
trigger help.

`--version` and `-V` print the version string, but only when they are the sole
token and only when `version` was passed to `createCLI`. There is no `-v` short
form; `-v` is free for the application to use.

```typescript
const cli = createCLI({ name: "myapp", version: "1.0.0" });
// myapp --version  → 1.0.0
// myapp -V         → 1.0.0
```

`help` is also an ordinary registered command, declared as `help [...command]`.
`myapp help db migrate` prints the page for `db migrate`, and an unresolvable
target reports `CommandNotFoundError`. Because it is a normal command, it appears
in the help index like any other, sorted last.

## Related pages

- [Options](options.md) — flags, types, defaults, and the input forms they accept
- [Errors](errors.md) — the error classes raised by dispatch and validation
- [Events and plugins](events-and-plugins.md) — lifecycle events, `cli.fallback()`, and plugins
- [Interactive shell](interactive-shell.md) — the REPL, pipes, and tab completion
- [API reference](api-reference.md) — full signatures

# Interactive shell

The interactive shell is a prompt that reads one command line at a time, runs it, prints the result, and prompts again. This read-run-print loop is usually called a REPL (see [Glossary](glossary.md)). The commands available at that prompt are the same ones the program accepts on the command line — nothing has to be registered twice.

The shell adds four things on top of plain command execution: persistent command history, tab completion, pipes between commands, and mode sub-REPLs.

## When the shell starts

`cli.start()` chooses between two modes. It resolves to the exit code, which is also set on `process.exitCode`.

- **Direct mode** — one or more command-line arguments were supplied. The arguments are executed as a single command and the process ends.
- **Interactive shell** — there are **no** arguments **and** both the standard input stream and the standard output stream are terminals.

A terminal (a "TTY") is a real interactive console. When a program is launched from a shell window, both its input and its output are terminals. When either one is connected to a file or to another program, it is not.

If there are no arguments and either stream is not a terminal, the shell is not started: the help index is printed and `cli.start()` resolves. This is the case that surprises people first:

```
mycli            # both streams are terminals -> interactive shell
mycli | less     # stdout is a pipe, not a terminal -> help index, no shell
mycli < script   # stdin is a file, not a terminal -> help index, no shell
mycli deploy     # an argument was given -> direct mode
```

Two more inputs print the help index instead of running anything: an argument list consisting only of empty strings, and a list whose only non-empty entry is the end-of-options marker `--`.

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "mycli", prompt: "mycli> " });

cli
  .command("status")
  .description("Show system status")
  .action((ctx) => {
    ctx.stdout.write("ok\n");
  });

await cli.start();
```

`cli.start()` may be called only once per `CLI` instance. A second call throws an `Error` with code `ERR_ALREADY_STARTED`.

## The banner and the prompt

The banner is a line printed once, when the shell starts. Set it with the `banner` option of `createCLI`. When it is not set, the banner is the application name, followed by `v` and the version when a version was configured. Pass an empty string to suppress it.

The prompt is the text printed before each input line. Set it with the `prompt` option of `createCLI`; it defaults to `"> "`.

```typescript
const cli = createCLI({
  name: "mycli",
  prompt: "mycli> ",
  banner: "mycli — type help to get started",
});
```

A running command can change the prompt through `ctx.shell` (see [Controlling the shell from a command](#controlling-the-shell-from-a-command)).

## Built-in shell commands

The shell handles exactly two names itself: `exit` and `quit`. Either one ends the session. There is no built-in `clear` and no built-in `history`.

`help` is not a shell built-in — it is an ordinary registered command, so it works in direct mode as well.

A registered command takes precedence over a built-in at the top level. Registering a command named `exit` makes that command run instead of ending the session; pressing Ctrl+D still ends it.

Pressing Ctrl+D at the prompt (an "end of input" keystroke) ends the session. Pressing Ctrl+C at the prompt clears the line being typed — both sides of the cursor — and draws a fresh prompt; it does not end the session.

## Command history

Accepted command lines are stored so they can be recalled with the Up and Down arrow keys, and they persist across sessions in a file.

### Where history is stored

The file defaults to `~/.<name>_history`, where `<name>` is the application name. `historySize` caps how many entries are retained and defaults to `1000`.

```typescript
const cli = createCLI({
  name: "mycli",
  historyFile: "/var/lib/mycli/history",
  historySize: 5000,
});
```

### What gets recorded

A line is added to the history and written to disk **before** the command runs, so a session that is force-quit mid-command still keeps the line that was accepted.

Three kinds of lines never reach the file:

- empty or whitespace-only lines,
- a line identical to the entry immediately before it,
- input typed inside a mode sub-REPL (see [Mode sub-REPL](#mode-sub-repl)).

Control characters are stripped from every entry. Stripping happens after `historyFilter` runs, so a filter cannot introduce terminal escape sequences that would be replayed when the entry is recalled.

### Redacting sensitive lines

`historyFilter` receives each line before it is stored. Returning `null` drops the line entirely; returning a string stores that string instead of the original. This is how a secret typed as an argument is kept out of the file.

```typescript
const cli = createCLI({
  name: "mycli",
  historyFilter: (line) => {
    // Drop the whole line.
    if (line.startsWith("login ")) return null;
    // Or keep the line and replace just the secret.
    return line.replace(/(--token[ =])\S+/g, "$1***");
  },
});
```

With that filter, typing `deploy --token abcd1234` stores `deploy --token ***`.

### File safety

The history file holds whatever was typed, so it is treated as private:

- it is kept at file mode `0600` (readable and writable by its owner only), and reset to that mode if it is found otherwise;
- it is opened without following symbolic links, so a link planted at that path is rejected rather than written through;
- it is rejected if it is not a regular file, or if it is owned by a different user.

When several sessions run at once they coordinate through a `.lock` file next to the history file. A lock left behind by a process that no longer exists is broken immediately, so a crashed session does not block later ones.

A normal save appends the new entries. The whole file is rewritten only when the size limit has been exceeded and old entries must be dropped.

### When history cannot be saved

A failure caused by the environment — denied permissions, a read-only file system, a symbolic link at the path, a file owned by another user — cannot be fixed by retrying. After one warning on the standard error stream, history persistence is switched off for the rest of the session. Any other failure warns on each save attempt.

Either way the shell keeps running and in-session recall with the arrow keys still works.

## Tab completion

Pressing Tab asks the shell for candidate completions of the word under the cursor.

### The completion context

A command supplies its own candidates through `.completer(fn)`, where `fn` matches the `Completer` type:

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>;
```

`CompletionContext` carries:

| Field | Meaning |
|---|---|
| `line` | The **active pipe segment** — the part of the line the cursor is in, not the whole line |
| `fullLine` | The whole input line, earlier pipe segments included |
| `current` | The word being completed |
| `commandPath` | The resolved command path, with aliases replaced by canonical names |
| `args` | Positional arguments parsed so far |
| `options` | Options parsed so far, **raw and uncoerced**: no type conversion, no defaults, no validation |
| `iteration` | How many times Tab has been pressed in a row on an unchanged line, starting at `1`. Any edit resets it |
| `signal` | An `AbortSignal` (see [Glossary](glossary.md)) that is aborted when the completion deadline expires |

Returned candidates are filtered against `current` before they are shown, so a completer returns full candidate values rather than pre-filtered text.

### Resolution order

The shell tries these in order and uses the first that produces candidates:

1. **Top-level command names** and their aliases. `--help` and `-h` are always included; `--version` and `-V` are included when a version is configured; `exit` and `quit` are included unless a registered command shadows them.
2. **Subcommand names** of the command matched so far.
3. **An inline option value** — the part after `=` in `--opt=value` or `-o=value`.
4. **The value of a preceding option** — the word after a value-taking flag, as in `--region <Tab>`.
5. **Option flags** of the matched command, including `--no-` forms for boolean options.
6. **The command's own completer**, registered with `.completer()`.

Hidden options are never offered. Neither are hidden subcommands, nor subcommands that could never be reached because the parent command's own positional arguments would consume them first.

No option flags or option values are offered after the end-of-options marker `--`, because everything past it is a literal positional value. The command's own completer still runs there.

Completion operates on the active pipe segment, so in `ls | gre<Tab>` the shell completes a command name for the second stage, not an argument of `ls`.

### Completing option values

Candidates for an option's value come from its `completer` setting: an array, or a `Completer` that may be synchronous or asynchronous and receives the same `CompletionContext` as a command completer. When `completer` is absent, the option's `choices` are used, converted to strings.

```typescript
async function loadProfileNames(): Promise<string[]> {
  return ["default", "staging", "production"];
}

cli
  .command("deploy <env>")
  .option("--region <region>", {
    completer: ["us-east-1", "us-west-2", "eu-west-1"],
  })
  .option("--profile <profile>", {
    completer: async ({ current }) => {
      const names = await loadProfileNames();
      return names.filter((name) => name.startsWith(current));
    },
  })
  .action((ctx) => {
    ctx.stdout.write(`Deploying to ${String(ctx.args.env)}\n`);
  });
```

See [Options](options.md) for the rest of the option schema.

### A custom completer

```typescript
async function loadKnownHosts(): Promise<string[]> {
  return ["db-1.internal", "db-2.internal", "web-1.internal", "web-2.internal"];
}

cli
  .command("connect <host>")
  .option("--port <port>", { type: "number" })
  .completer(async (ctx) => {
    // The framework already offers flags; only host names are left to add.
    if (ctx.current.startsWith("-")) return [];
    const hosts = await loadKnownHosts();
    // First Tab: the two most common hosts. Second Tab and beyond: all of them.
    return ctx.iteration === 1 ? hosts.slice(0, 2) : hosts;
  })
  .action((ctx) => {
    ctx.stdout.write(`Connecting to ${String(ctx.args.host)}\n`);
  });
```

The `iteration` field is what makes that two-stage behavior possible: it counts consecutive Tab presses on an unchanged line and resets as soon as the line is edited.

### Timeouts and failures

An asynchronous completion provider is capped at 1000 ms. When the cap is reached, the `signal` passed in the completion context is aborted so the provider can stop its own work, and an empty candidate list is returned. A provider that throws or rejects also yields an empty list. Completion never surfaces an error to the user and never leaves the prompt stuck.

Candidates are escaped before insertion, so a candidate containing a space, a quote, a backslash, or a pipe character survives being read back as a single argument. A line that ends inside an unclosed quote is handled by closing the quote internally before the line is analysed.

## Pipes

Two or more commands separated by `|` form a pipe chain: the output of each stage becomes the input of the next.

```
mycli> produce | transform | consume
```

![A pipe chain of three commands. Each stage's standard output is connected to the next stage's standard input through a stream; the first stage reads the caller's input, the last stage writes to the caller's output, and all three stages run at the same time. Standard error is shared by every stage.](../assets/pipeline.svg)

### How a pipe chain runs

Stages are joined by in-memory streams and **all run concurrently**. Stage 1 does not finish before stage 2 begins; data flows through as it is produced.

- `ctx.stdout` of stage *i* is `ctx.stdin` of stage *i+1*.
- `ctx.stdin` of the first stage is the caller's input.
- `ctx.stdout` of the last stage is the caller's output.
- `ctx.stderr` is the same stream for every stage.

### Reading piped input

`ctx.stdin` is a readable stream, or `null` when no input is available.

```typescript
cli
  .command("uppercase")
  .description("Read text and write it in upper case")
  .action(async (ctx) => {
    if (!ctx.stdin) {
      ctx.stderr.write("uppercase expects piped input\n");
      return;
    }
    for await (const chunk of ctx.stdin) {
      ctx.stdout.write(String(chunk).toUpperCase());
    }
  });
```

For a command typed at the shell prompt **without** a pipe, `ctx.stdin` is `null`. The shell releases the terminal input before running a command, so there is nothing for the command to read. To ask the user a question from inside an action, use the prompt functions described in [Prompts](prompts.md) rather than reading `ctx.stdin`.

### Stopping early

When a downstream stage finishes while upstream stages are still producing, the upstream stages are cancelled with an internal stop marker: their `ctx.signal` aborts, but their cancel handlers do not run. This is a **graceful** stop: it does not fail the chain, and it emits neither the `commandError` event nor the `error` event (see [Events and plugins](events-and-plugins.md)). It mirrors what a system shell does for `producer | head`.

### When a stage fails

If any stage throws, the whole chain is torn down in both directions — downstream consumers and upstream producers alike — so no stage is left waiting on a partner that is gone. That first failure is the error the caller sees.

### Pipes exist only for string input

Pipe splitting is applied to a command **string**. That covers the interactive shell and `cli.exec("a | b")` (see [Events and plugins](events-and-plugins.md)).

In direct mode the arguments arrive as an array that is already split into words, and pipe splitting is skipped entirely. A `|` there is an ordinary argument value, not a pipe. (In practice the system shell handles `|` before the program ever sees it.)

### Unsupported syntax

Redirection operators are rejected with a `ParseError`:

```
Error: Redirection operator "<" is not supported
```

An empty pipe segment (`a || b`) and a trailing pipe (`a |`) are also `ParseError`s. See [Errors](errors.md).

## Mode sub-REPL

A mode is a nested prompt with its own handler. While a mode is active, every line typed goes straight to that handler — the command router is bypassed completely. A SQL console, a chat session, and a calculator are all natural modes.

![States of the interactive shell. From the main shell, enterMode moves to the mode sub-REPL, where each input line goes to the mode action and returns to the mode prompt. Typing exit or quit, or pressing Ctrl+D, returns to the main shell; from the main shell, exit or quit ends the session.](../assets/mode-repl.svg)

### Entering a mode

A command enters a mode through `ctx.shell`:

```typescript
async function runQuery(sql: string, options: { signal: AbortSignal }): Promise<unknown[]> {
  options.signal.throwIfAborted();
  return [{ id: 1, name: "alice" }];
}

cli
  .command("sql")
  .description("Open an interactive SQL session")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("sql is only available in the interactive shell\n");
      return;
    }
    ctx.shell.enterMode({
      prompt: "sql> ",
      banner: 'Entering SQL mode. Type "exit" to return.',
      history: "session",
      completer: ({ current }) => {
        const keywords = ["SELECT", "FROM", "WHERE", "ORDER BY", "LIMIT"];
        return keywords.filter((k) => k.startsWith(current.toUpperCase()));
      },
      action: async (input, { stdout, stderr, signal }) => {
        try {
          const rows = await runQuery(input, { signal });
          stdout.write(`${JSON.stringify(rows)}\n`);
        } catch (err) {
          stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
        }
      },
    });
  });
```

`ctx.shell` is `null` whenever the command is not running in the interactive shell — including under `cli.exec()` — so it must always be guarded.

### The mode configuration

`ModeConfig` has these fields:

| Field | Required | Meaning |
|---|---|---|
| `prompt` | yes | The prompt shown while the mode is active |
| `action` | yes | Called with each input line and a small context |
| `banner` | no | Printed once, when the mode is entered |
| `completer` | no | Tab completion inside the mode. **When it is omitted, Tab does nothing in the mode** |
| `history` | no | `"session"` (default) or `"none"` |

A mode `completer` is the same `Completer` a command uses: it receives a `CompletionContext` and returns candidates, synchronously or as a promise. `line` and `fullLine` are the input line, `current` is the last word (`""` after a space), `commandPath` is `[]`, and `args` and `options` are empty; `iteration` and `signal` behave as for commands. Candidates are not filtered against `current`, so the completer returns only the ones that match. It is bound by the same 1000 ms cap as any other provider, and a throw or a rejection yields no candidates.

`history: "session"` keeps recall in memory only, capped at `historySize`, skipping consecutive duplicates. Mode input is never written to the history file under either setting.

### What is different inside a mode

- The context handed to the mode action is only `{ stdout, stderr, signal }`. It is **not** a `CommandContext`: there is no `args`, no `options`, no `shell`, and no `stdin`.
- Every line reaches the action verbatim. Nothing is parsed, routed, or matched against registered commands.
- `exit` and `quit` always leave the mode. A registered command of that name cannot be reached from inside a mode, so honouring it would strand the user there.
- Ctrl+D leaves the mode and returns to the main prompt. If the input stream has already ended, it ends the session instead.
- Ctrl+C aborts the `signal` passed to the running action; a second press force-quits the process.

Leaving a mode with `exit`, `quit`, or Ctrl+D restores the main prompt. A command can also leave programmatically with `ctx.shell?.exitMode()`.

## Interrupting a command

Ctrl+C sends an interrupt to the running command. The framework handles it in two steps.

**First press.** `ctx.signal` is aborted, any handler registered with `.onCancel()` runs, and this line is written to the standard error stream:

```
Interrupted. Press Ctrl-C again to force quit.
```

A command that watches its signal stops here, and the shell returns to the prompt.

**Second press**, after a 250 ms grace window. The terminal cursor is restored, every `exit` event listener runs (bounded at 2000 ms, so a listener that never finishes cannot block the shutdown), and the process ends with status 130. The grace window means a rapid double press — part of the same impatient burst — does not kill a command that is already cancelling in good faith.

A Ctrl+C that arrives when there is nothing to cancel force-quits immediately.

```typescript
cli
  .command("sync")
  .onCancel((ctx) => {
    ctx.stderr.write("\nRolling back...\n");
  })
  .action(async (ctx) => {
    const res = await fetch("https://example.com/data", { signal: ctx.signal });
    ctx.stdout.write(await res.text());
  });
```

The shell also handles SIGTERM, the signal a process manager sends to ask a program to stop: cancellation is requested (a running command's or mode action's `ctx.signal` aborts), a 200 ms grace period follows, history is saved, the `exit` event fires (bounded at 2000 ms, as on a force-quit), and the process ends with status 143. SIGHUP is not handled and ends the process with Node's default action.

Exit codes are listed in full in [Errors](errors.md).

## Controlling the shell from a command

`ctx.shell` is the handle a command uses to affect the session it is running in. `Shell` is exported as a **type only** — it cannot be constructed; the framework creates it.

| Method | Effect |
|---|---|
| `stop()` | Ends the session after the current command returns |
| `setPrompt(text)` | Replaces the prompt text and returns the shell |
| `enterMode(config)` | Enters a mode sub-REPL |
| `exitMode()` | Leaves the current mode |

`setPrompt` applies immediately, unless a mode is active — then it takes effect after `exitMode()`.

```typescript
cli
  .command("use <project>")
  .description("Switch the active project")
  .action((ctx) => {
    const project = String(ctx.args.project);
    ctx.shell?.setPrompt(`${project}> `);
    ctx.stdout.write(`Switched to ${project}\n`);
  });

cli
  .command("logout")
  .description("End the session")
  .action((ctx) => {
    ctx.stdout.write("Goodbye\n");
    ctx.shell?.stop();
  });
```

## Related pages

- [Commands](commands.md) — defining commands, arguments, subcommands, and cancel handlers
- [Options](options.md) — option flags, types, choices, and `completer`
- [Prompts](prompts.md) — asking the user a question from inside an action
- [Events and plugins](events-and-plugins.md) — lifecycle events, plugins, and `cli.exec()`
- [Errors](errors.md) — error classes and exit codes

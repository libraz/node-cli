# Glossary

Terms used throughout this documentation, in alphabetical order.

### AbortSignal

A standard JavaScript object that carries a "stop now" notification to code that is already running. Code holding a signal can check `signal.aborted` or listen for its `abort` event, and many built-in APIs — `fetch`, timers, stream operations — accept one directly and give up when it fires. Every command receives one as `ctx.signal`; it is aborted when the command is cancelled, which happens when the user presses Ctrl-C. Long-running actions should pass it along or watch it so cancellation actually takes effect. See [Commands](commands.md).

### Alias

An alternative name for a command or an option. `.alias("g")` makes `myapp g World` equivalent to `myapp greet World`, and `"-u, --uppercase"` declares `-u` as an alias of `--uppercase`. Aliases exist only at the input surface: `ctx.commandPath` always reports the canonical command name, and `ctx.options` is always keyed by the long option name. See [Commands](commands.md) and [Options](options.md).

### ANSI escape sequence

A short run of characters, beginning with the escape character, that a terminal interprets as an instruction rather than printing. Colour, bold text, cursor movement, and line clearing are all done this way. The library emits them for coloured output and for redrawing progress indicators, and omits them when the destination is not a terminal, so a redirected log file does not fill with unreadable control characters. `stripAnsi()` removes them from a string and `stringWidth()` measures a string as the terminal would display it. See [Colour](color.md).

### Argument (positional)

An input identified by its position on the command line rather than by a name. In `myapp greet World`, `World` is the positional argument bound to `name`, because the command was declared as `greet <name>`. Angle brackets mark an argument required, square brackets optional. Positional values arrive in `ctx.args` keyed by the declared name and are always strings — the library applies no type conversion to them. See [Commands](commands.md).

### argv

The list of words the operating system hands to a program when it starts. In Node it is `process.argv`, whose first two entries are the path to the Node executable and the path to the script; the actual user input starts at index 2. `cli.start()` uses `process.argv.slice(2)` by default, and an explicit array can be passed instead, which is how a command is driven from a test. The exact array is also available to a command as `ctx.rawArgv`. See [Getting started](getting-started.md).

### Banner

The line printed once when the interactive shell opens, above the first prompt. It defaults to the application name and version (`myapp v1.0.0`), or just the name when no version was configured. Setting `banner` to a specific string replaces it; setting it to the empty string suppresses it entirely. It is not printed in direct mode. See [Interactive shell](interactive-shell.md).

### Command path

The sequence of names that identifies a command within the nesting. `myapp db migrate` resolves to the command path `["db", "migrate"]`, which a command reads as `ctx.commandPath`. The path is always canonical: if the command was reached through an alias, the path reports the real names, so a handler shared between several entry points can tell which command it is serving without accounting for every alias. See [Commands](commands.md).

### Direct mode

The execution mode used when arguments are present: one command is parsed, run once, and the process ends. `myapp greet World` is direct mode. `ctx.shell` is `null` in this mode, which is how an action detects that it is not running inside the interactive shell. `cli.start()` selects it whenever the argument list is non-empty. See [Getting started](getting-started.md).

### ESM (ECMAScript modules)

JavaScript's standard module format, using `import` and `export`. Node also supports the older CommonJS format, which uses `require()`; a project declares which one it uses with `"type": "module"` in `package.json`. This library is published as ECMAScript modules only, so a consuming project needs `"type": "module"` and has no separate CommonJS build. Node.js 22.12 and later can still `require()` it; earlier 22.x releases need `await import()`. See [Getting started](getting-started.md).

### Exit code

A small integer a process reports when it ends, telling whatever started it whether the run succeeded. Zero means success; anything else means failure, and shell scripts and CI systems branch on it. The library sets `process.exitCode` rather than terminating the process abruptly, so buffered output is flushed first. A cancelled command exits with 130, and the interactive shell shut down by a termination signal exits with 143. See [Errors](errors.md).

### Flag

An option that takes no value and means something by its presence alone, such as `--uppercase` or `-v`. In this library a flag is an option declared with `type: "boolean"`; it resolves to `true` when present and additionally accepts a negated form, so `--no-uppercase` resolves to `false`. See [Options](options.md).

### Grapheme

One unit of text as a reader perceives it, which may be built from several Unicode code points — an emoji with a skin-tone modifier, or a letter followed by a combining accent. Counting a string's `.length` counts code units, not graphemes, which is why naive alignment breaks on emoji and accented text. The library segments text into graphemes so table columns and truncation line up; `splitGraphemes()` exposes this, and `stringWidth()` also accounts for East Asian characters that occupy two terminal columns. See [Colour](color.md) and [Tables](table.md).

### Interactive shell

The prompt the tool opens inside itself when it is started with no arguments in a terminal. Each line typed there is parsed and dispatched through the same command definitions used in direct mode. The shell adds persistent history, tab completion, pipes between commands, and modes. A command running inside it receives the shell object as `ctx.shell` instead of `null`. See [Interactive shell](interactive-shell.md).

### Mode (sub-REPL)

A temporary state the interactive shell can be pushed into, in which every line typed goes to one handler instead of being parsed as a command. A `sql` command might enter a mode where each line is a query, with its own prompt string, its own completion, and its own in-memory history that is never written to disk. A mode is entered from a command through `ctx.shell`, and exited to return to the normal prompt. See [Interactive shell](interactive-shell.md).

### Option

A named input written with a leading dash, supplied in any order: `--port 8080`, `-p 8080`, `--uppercase`. An option is declared with `.option()` and an [option schema](#option-schema). Parsed values appear in `ctx.options`, always keyed by the long name without the dashes, never by an alias. Unlike positional arguments, options can be typed, defaulted, and validated. See [Options](options.md).

### Option schema

The object describing one option's behaviour: its `type` (`string`, `number`, `boolean`, or an array form), short `alias` names, whether it is `required`, its `default`, the `choices` it is restricted to, a custom `parse` function, a custom `validate` function, whether it is `hidden` from help, and its completion candidates. It is the second argument to `.option()`, and everything the library knows about the option — including how it is rendered in help — comes from it. See [Options](options.md).

### Pipe

Connecting one command's output to another command's input, written with the `|` character. Inside the interactive shell, `list | grep alpha` runs both commands and streams the first one's standard output into the second one's `ctx.stdin`. This works only for commands defined in the same application, and only for lines typed at the shell prompt — it is the shell's own pipe, not the operating system's. Writing to `ctx.stdout` rather than `console.log` is what makes a command usable in a pipeline. See [Interactive shell](interactive-shell.md).

### Plugin

A function that receives a context object and uses it to register commands, event listeners, or a fallback handler on an existing application. Plugins are attached with `cli.use()` and are awaited before any command runs, so a plugin may load configuration or query a service before deciding what to register. A plugin that throws is fatal: the failure is reported and no command runs. See [Events and plugins](events-and-plugins.md).

### Prompt (input function)

`prompt` is an exported object whose methods ask the user a question and resolve with the answer: `prompt.text()`, `prompt.confirm()`, `prompt.select()`, `prompt.multiselect()`, and `prompt.password()`. These are used from inside a command action, and they need a terminal to read from. Not to be confused with the prompt string below. See [Prompts](prompts.md).

### Prompt (string)

The characters printed at the start of each input line in the interactive shell, marking where typing begins. It defaults to `"> "` and is configured with the `prompt` option of `createCLI()` or with `cli.prompt()`. A mode can substitute its own prompt string while it is active. Not to be confused with the prompt input functions above. See [Interactive shell](interactive-shell.md).

### REPL

Read–eval–print loop: a program that repeatedly reads a line of input, acts on it, prints a result, and returns to the prompt. Node's own `node` command with no arguments is one. The interactive shell in this library is a REPL whose vocabulary is the application's commands rather than JavaScript expressions. See [Interactive shell](interactive-shell.md).

### Shebang

The `#!/usr/bin/env node` line at the top of an executable script. When the file is run directly, the operating system reads this line and runs the named program with the file as input — here `env node`, which finds `node` on the current `PATH`. JavaScript treats the line as a comment, so it is harmless in a file that is also imported. It is required on macOS and Linux and ignored on Windows. See [Getting started](getting-started.md).

### SIGINT / SIGTERM

Signals an operating system sends to a running process. SIGINT is what Ctrl-C sends, meaning "interrupt this"; SIGTERM is a polite request to shut down, typically from a process manager. The library turns SIGINT into a cancellation: `ctx.signal` aborts and any registered cancel handler runs, so a command can remove a lock file or close a connection before stopping. A second Ctrl-C force-quits with exit code 130, and the interactive shell handles SIGTERM by tearing down and exiting with 143. See [Errors](errors.md).

### stderr

Standard error: the second output stream every process has, conventionally used for diagnostics, warnings, and error messages. It is separate from standard output so that `myapp export > data.json` captures the data while log lines still reach the terminal. A command writes to it through `ctx.stderr`, and `logger()` uses it by default. See [Logging](logging.md).

### stdin

Standard input: the stream a process reads input from, normally the keyboard, but a file when redirected with `<` or another command's output when piped. A command reads it through `ctx.stdin`, which is `null` when no input stream is available. Whether standard input is a terminal is one of the two conditions `cli.start()` checks before opening the interactive shell. See [Getting started](getting-started.md).

### stdout

Standard output: the stream a process writes its results to, normally the terminal, but a file or another command when redirected or piped. A command writes to it through `ctx.stdout` rather than `console.log`, so that the output can be captured by a pipeline inside the interactive shell or by a test. See [Commands](commands.md).

### Subcommand

A command nested under another command, so it is invoked by naming both: `myapp db migrate`. Subcommands are created by calling `.command()` on a command builder rather than on the application. A parent with no action of its own acts as a namespace and prints its subcommand list when invoked alone. Nesting can go deeper than one level. See [Commands](commands.md).

### Tab completion

Pressing the Tab key to have the tool fill in or suggest the rest of what is being typed. Inside the interactive shell this completes command names, subcommands, option flags, and option values, using candidates the option schema or a `.complete()` handler supplies. It works only at the tool's own prompt: the library does not generate completion scripts for bash, zsh, or fish, so Tab at a system shell prompt still completes filenames. See [Interactive shell](interactive-shell.md).

### TTY

Short for teletype; in practice, "attached to a terminal". A stream is a TTY when it is connected to an interactive terminal window, and is not one when it has been redirected to a file or connected to a pipe. Two behaviours turn on this distinction: colour and progress animation are emitted only to a TTY, and the interactive shell opens only when both standard input and standard output are TTYs. `streamIsTTY()` performs the check. See [Getting started](getting-started.md).

### Variadic argument

A positional argument that collects every remaining value instead of exactly one, declared with a leading ellipsis: `copy <...files>` binds `ctx.args.files` to an array of strings. A variadic argument must come last, since it consumes everything after it. As with all positional arguments, the collected values are strings and are not converted. See [Commands](commands.md).

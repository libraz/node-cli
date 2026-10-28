# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.1] - 2026-09-03

A corrective release. No public API was added, removed, or renamed. Where two
shipped surfaces disagreed, or where behavior contradicted its documented
contract, the implementation was moved to match; several crash, hang, and
lost-input paths are closed.

### Changed

- The generated help and the completion candidates list only what dispatch can
  actually reach, and both advertise the shell built-ins `exit` and `quit` in
  the same place. A command registered under one of those names takes
  precedence over the built-in.
- A flag token resolves to the same option on every surface. Long aliases such
  as `--loud` parse, and help and completion advertise them with two dashes;
  `-h` and `--help` are advertised as the built-in help only when no declared
  option has claimed them.
- The borderless and simple table layouts honor padding, border color, and
  compact spacing, which previously applied to the boxed layout only.
- Progress and table options are normalized through a single path, so a
  multi-bar total, a `colWidths` entry below the padding width, and a column
  keyed `constructor` or `toString` behave as documented.
- Caller-supplied text is sanitized where it reaches the terminal, covering
  bar characters, spinner frames, table borders and truncation markers, and
  prompt messages.
- `logger()` accepts only its documented options, and a rejected numeric option
  value reports whether it failed the declared range or the safe integer bound.
- The toolchain moves to the native TypeScript build; Biome, Vitest, and the
  pinned Node.js, Yarn, and npm versions are updated with it.
- The documentation is restructured into per-topic guide pages in both
  languages, with diagrams and a separate API reference; the READMEs are
  reduced to an overview that links into the guide. The exit-code, subpath
  export, and quick-start descriptions are corrected to match what ships.

### Fixed

- The first Ctrl-C during concurrent command execution cancels the running
  commands instead of terminating the process.
- Every registered `exit` listener runs to completion before a forced quit
  terminates, including on the direct execution entry point.
- An empty-string argument keeps its position in direct argv mode instead of
  being dropped and shifting the arguments after it.
- A rejected asynchronous cancel handler no longer terminates the process, a
  prompt opened after stdin has ended no longer hangs, and a non-string value
  passed to the logger no longer throws.
- The completion deadline applies to every user-supplied provider, so a
  provider that never settles can no longer freeze the shell.
- Completion replaces the word the terminal actually holds, so a candidate
  inserted after a quote, a backslash, or a pipe no longer corrupts the line.
- A password prompt keeps its label readable while the value is being edited.
- A prompt decides its terminal mode from the input stream alone, so Ctrl-C is
  handled when stdin is a TTY and stdout is redirected. The `stderr` option is
  accepted where it applies, on password prompts.
- Leaving a mode always returns to the top level, input typed before a command
  finished is redisplayed afterwards, and a closed stdin is not reopened.
- With color disabled, an interpolated `c` template no longer emits escape
  sequences, and sanitizing multi-line text preserves line and word boundaries
  instead of joining words together.
- A color chain responds to runtime protocol properties such as `then` and
  `toString` instead of throwing.
- A cursor-restoration handler is registered per signal, so an unrelated
  listener on one signal no longer disables restoration for the others.
- Log lines no longer merge into the line a live progress frame is drawing.
- Colon-separated SGR colors are recognized when closing terminal state, and
  wide status emoji are measured as two columns.
- Interactive history reports a permanently failing save once instead of on
  every command.
- A released progress indicator that never drew writes nothing, and adding a
  bar after the group is closed returns an inert handle.
- The published tarball ships a single README.

## [1.4.0] - 2026-08-05

New public API for controlling help visibility, history size, and parse
failures, alongside hardening across plugin registration, cancellation,
option validation, and terminal output. Some entry-point exports were
narrowed; see Removed.

### Added

- `CLI.historySize()` sets the interactive history limit after construction,
  and `CommandBuilder.hidden()` excludes a command from generated help and
  completion.
- `ParseError` (code `PARSE_ERROR`) covers an unclosed quote, an empty or
  trailing pipe, and an unsupported redirection operator. It is raised before a
  command is resolved, so a registered `catch()` fallback handler receives the
  input instead of the error being thrown.
- The package entry point exports `tokenize`, `splitPipes`,
  `stripOptionPrefix`, `formatErrorMessage`, `isCancellationError`,
  `sanitizeTerminalText`, `splitGraphemes`, `streamIsTTY`, `releaseAll`,
  `restoreCursor`, and the `CompletionResult` type.
- Option flags accept long aliases and an explicit value placeholder, which the
  generated help then uses.
- `NODE_CLI_DEBUG=1` prints the full stack trace for an error reaching
  `start()` in direct argv mode instead of only its message.
- The exports map gains a `default` condition and a `./package.json` entry.
- README figures render the real output of the table, progress, prompt, logger,
  and color APIs, and the docs cover the color-enablement precedence, the
  completion deadline and signal, cooperative SIGTERM shutdown, and the
  `[Symbol.dispose]` support on progress indicators.

### Changed

- Plugin bodies run through a single serial queue, so an asynchronous `use()`
  preserves declaration order and a synchronous throw fails initialization the
  same way a rejected asynchronous plugin does.
- The `exit` event fires on every direct-CLI path, not only on shell exit.
- A supplied empty argument or a bare `--` prints the command index instead of
  starting the interactive shell.
- Redefining an option replaces the previous definition, so a plugin can refine
  a built-in option without removing it first; aliases owned by other options
  stay protected.
- Every `CommandBuilder` method rejects a command that has been removed, not
  only `command()`.
- Declaring a subcommand under a command whose action consumes positional
  arguments emits a `NODE_CLI_UNREACHABLE_SUBCOMMAND` warning.
- Interactive history is appended rather than rewritten unless compaction is
  needed.
- The toolchain moves to Yarn 4.18.0, with Node.js and Yarn pinned through
  `mise.toml` instead of a `volta` block.

### Removed

- `Shell` is exported as a type only; it is no longer a value export.
- The structural types `ArgDef`, `CommandDefinition`, `OptionDef`, and
  `ParseResult` are no longer exported from the package entry point.

### Fixed

- SIGINT during a direct argv run reports exit code 130 and prints
  `Cancelled`, matching the interactive shell.
- Option names, aliases, and declared defaults are validated when a command is
  built, and a default outside the declared choices is rejected. Numeric option
  values that are non-decimal or beyond the safe integer range now error.
- Progress indicators are released and the cursor restored after every command,
  and table cell and truncation boundaries close any leftover ANSI state.
- Password prompts fall back to stderr when stdin is a TTY but stdout is
  redirected.
- Custom completion providers are bounded by a timeout and their candidate
  tokens are escaped.
- Readline buffers incoming lines, so pasted or partially typed input survives a
  command run.

## [1.3.3] - 2026-07-24

A correctness and hardening release across parsing, routing, option
resolution, output, and the interactive shell; no breaking API changes.

### Added

- Export the `PasswordOptions` type for password prompts.
- Command definitions are validated up front: duplicate argument names and a
  required argument following an optional one are rejected, and an option
  cannot be both required and carry a default. Adding aliases or subcommands to
  a command that has been removed now throws instead of silently detaching.
- The pack and git-install smoke gates verify the packed `description`, Node.js
  engine range, and README runtime requirement; the package now ships a
  `description` field.

### Changed

- The router isolates its diagnostic stderr per execution via
  `AsyncLocalStorage`, so nested and concurrent programmatic executions no
  longer share or clobber each other's error stream.
- Documentation states the Node.js runtime requirement as `>= 22`, matching the
  package's existing engine floor.

### Fixed

- Parsing treats bare negative numbers as positionals, honors the built-in `-h`
  inside short-flag clusters, and keeps single quotes literal when splitting
  pipelines.
- A second SIGINT escalates to a force quit with exit code 130 and restores the
  terminal cursor. A graceful pipeline early-stop is no longer reported as a
  failure, option-syntax errors on a known command surface through
  `commandError`, and pipeline failure and cancellation propagate to the
  correct stages only.
- Option resolution is driven by raw presence and runs defaults through the same
  built-in coercion as explicit values. Registry alias batches are validated
  before any mapping is committed, and subtree removal only clears aliases it
  still owns.
- Color and table rendering widen emoji and CJK width handling, preserve SGR
  colors and OSC 8 hyperlinks while sanitizing control characters, and stop
  consuming row 0 as a header when columns are explicit. Progress restores a
  hidden cursor on process exit.
- Password prompts keep their label unmasked across readline redraws and
  preserve surrounding whitespace. History reads through an `O_NOFOLLOW`
  descriptor (TOCTOU-safe), strips control characters at both trust boundaries,
  breaks stale locks by PID and mtime, and saves on SIGTERM. The REPL closes
  readline before execution, drains pending plugins, cancels mode actions
  cooperatively, and clears the whole line on Ctrl-C.
- Completion suggests subcommands only at the matching token boundary, and
  `AbortError` is treated as a cancellation for a clean message and exit 130.

### Security

- The `actions/checkout` step is pinned to an audited `v7.0.1` release.

## [1.3.2] - 2026-07-15

### Added

- Programmatic `exec()` now accepts `stdin` and an external `AbortSignal`;
  command contexts expose exact `rawArgv` values for array/direct execution.
- Mode sub-REPLs support isolated completion and in-memory/disabled history
  policies. Logger instances expose bounded backpressure buffering and
  `flush()`.
- Release gates now cover Node 22 and 24 on Linux, typecheck the real
  examples, install and execute the packed tarball, and validate tag/version,
  dist-tag, changelog, source maps, and consumer declarations before publish.

### Changed

- Progress indicators share cursor ownership per stream, coalesce redraws on
  slow streams, sanitize control characters, and use consistent terminal
  `finish()`/`stop()` behavior. Non-TTY spinners emit only final status lines.
- History is written as a private `0600` file using lock/merge, fsync, and atomic
  replacement; applications can redact or omit sensitive history entries.
- Completion tolerates unfinished quotes, isolates provider failures, resets
  progressive state per prompt, and includes built-in and negated flags.

### Fixed

- Cancellation now covers validation and lifecycle hooks, aborts all pipeline
  stages before user cleanup callbacks, isolates callback failures, and keeps
  SIGINT interception active until cooperative cleanup completes.
- Parsing preserves empty quoted arguments and all whitespace boundaries,
  distinguishes implicit help from command-defined `--help`, reports syntax
  failures through `error`, rejects unknown group children, and uses canonical
  command paths for aliases.
- Option resolution uses collision-checked aliases, null-prototype records, and
  two-phase cross-option validation. Registry subtree removal now clears every
  descendant alias.
- ANSI parsing, grapheme width, and truncation handle OSC/ST hyperlinks,
  emoji modifiers, nested styles, narrow markers, and style closure. Ragged
  tables are normalized before layout.
- Confirm validation is honored; multiselect permits zero selections by default;
  passwords preserve surrounding whitespace; REPL Ctrl-C clears partial input
  and interactive mode requires both stdin and stdout TTYs.

### Security

- Published GitHub Actions are pinned to audited commit SHAs. Publish uses the
  exact smoke-tested tarball and extracts release notes from the matching
  changelog section.

## [1.3.1] - 2026-07-04

A correctness release hardening the parser, registry, router, and output
layers against edge cases; no new features or breaking API changes.

### Fixed

- **Parser**: reject unclosed quotes and invalid/trailing empty pipe segments;
  an option long name falls back to its first alias when none is given.
- **Registry**: `register()` returns the registered/merged definition, detects
  name/alias collisions, and no longer deletes live subcommand/root entries
  when removing aliases.
- **Router**: SIGINT-to-cancel wiring is shared between the CLI and shell via
  `runWithSigintCancel()`; `catch` handler errors propagate through the
  `error` event; upstream pipe stages are destroyed once a downstream stage
  finishes so producers observe teardown.
- **Errors**: `formatErrorMessage()` renders `PromptCancelError` as
  "Cancelled" consistently across the CLI and shell.
- **Option resolver**: thrown `parse` errors are wrapped in `ValidationError`;
  non-finite numbers (e.g. `Infinity`) are rejected, not just `NaN`.
- **Color**: the `c` tagged-template formatter supports nested style tags and
  rejects malformed ones instead of relying on a flat regex; string width
  accounts for variation selectors between a base scalar and a ZWJ joiner.
- **Progress**: the cursor is hidden while a bar/spinner is active and
  restored on completion and on SIGINT before re-raising; multi-row custom
  formatted output repositions correctly.
- **Prompts**: multiselect number parsing rejects non-numeric tokens; password
  input is masked without revealing character display width; the prompt
  query script stays un-masked while echoing typed input.
- **Table**: the simple renderer respects custom border characters;
  multi-byte/ANSI-styled cells truncate by grapheme instead of raw character.
- **Shell completion**: subcommand names (including aliases) complete when a
  parent path has already been typed; option flags are no longer offered
  after a literal `--`; `--help`/`-h` are always offered.
- **Help generator**: no duplicate `-h, --help` entry when a command declares
  its own `help` option; `[options]` is always shown in usage since
  `-h/--help` is implicit.

## [1.3.0] - 2026-06-26

A follow-up correctness release that adds signal-based command cancellation,
hardens pipeline and plugin failure handling, and sharpens completion, help, and
option coercion. All changes are additive or fix incorrect behavior; see
"Notable behavior changes" for the few observable differences.

### Added

- **`CommandContext.signal`**: every action receives an `AbortSignal` that is
  aborted on the same cancellation as `.cancel()` (SIGINT in the interactive
  shell and in direct mode), so async actions can pass it to abort-aware APIs
  (`fetch`, timers, streams) or listen for `"abort"`.
- **`-h`** now works as a help shorthand on every command unless explicitly
  bound to another option.
- **Direct CLI mode** routes SIGINT to the running command's cancel handler, so
  Ctrl+C cleanup behaves the same as in the REPL.
- Running with no arguments when stdin is not a TTY (piped/redirected) now prints
  the help index instead of hanging on an interactive prompt.
- New exports: `splitAnsi` and the `AnsiSegment` type (split a string into ANSI
  escape and plain-text runs), and `activePipeSegment` (the trailing pipeline
  segment, used by completion).

### Fixed

- **Pipes**: concurrent pipeline stages are each tracked for cancellation; a
  stage failure tears down the entire chain (upstream and downstream) so a
  back-pressured stage cannot hang, and stage rejections are awaited rather than
  surfacing as unhandled rejections or uncaught pipe `error` events.
- **Errors**: parse failures (unknown/invalid option) now emit the catch-all
  `error` event so failure monitoring is consistent across every input.
- **Aliases**: a real command always wins over an alias of the same name
  regardless of registration order, so an alias can never shadow a command.
- **Dispatch**: descent stops at a runnable command that takes positional
  arguments, so an argument value matching a subcommand name (e.g.
  `task run list`) is no longer mis-dispatched as a subcommand.
- **Options**: boolean coercion recognizes `1/0`, `yes/no`, `on/off` (so
  `--cache=0` is `false`) and rejects unrecognized values; `choices` are
  validated per element for array-typed options; a boolean flag's "takes value"
  is derived from its resolved type; a required boolean no longer receives a
  `false` default that would make its required check unsatisfiable.
- **Completion**: completes within the active pipeline segment; offers option
  flags after positionals and on actionless groups alongside subcommands;
  completes inline values for short options (`-o=`); and passes the canonical
  command path to custom completers.
- **Help/usage**: a single shared `formatUsage` drives both help and router
  usage strings; arguments are listed in declaration order to match the usage
  line; missing-argument usage uses the canonical command path.
- **Plugins**: pending plugin rejections are drained with `allSettled` and can
  no longer surface as unhandled rejections; the first failure is still re-thrown
  on drain.
- **Parser**: an argument token missing its closing bracket or with an empty name
  now throws a clear definition-time error.

### Changed

- Toolchain/dependencies: TypeScript 6, Vitest 4, Biome 2.5, `@types/node` 26;
  development/CI Node pinned to 24.18.0 (supported range remains `>=20`);
  Yarn 4.17.0. CI/publish actions bumped (`checkout`/`setup-node`/`cache` v5,
  `codecov-action` v6, `action-gh-release` v3).

### Notable behavior changes

These correct previously buggy behavior and may be observable:

- A boolean option given `0`/`off`/`no` now coerces to `false` (previously any
  non-empty string was `true`), and an unrecognized boolean value (e.g.
  `--verbose=hello`) now throws instead of being treated as `true`.
- A command that takes positional arguments stops subcommand resolution: a
  positional value matching a subcommand name is treated as the argument.

## [1.2.0] - 2026-06-09

A correctness-focused release that wires up previously documented-but-dead
features, hardens the output layer, and adds a structured error/observability
contract. All changes are additive or fix incorrect behavior; see
"Notable behavior changes" for the few observable differences.

### Added

- **`--version` / `-V`** and bare top-level **`--help` / `-h`** are now handled
  by the router in both direct and interactive modes.
- **Command cancellation**: `.cancel()` handlers are invoked on SIGINT while a
  command runs; the interactive shell wires SIGINT to the active command and no
  longer exits the prompt on Ctrl+C.
- **`OptionSchema.alias`** is now honored (e.g. `{ alias: "p" }` enables `-p`).
- **Prompt cancellation**: `prompt.*` reject with `PromptCancelError` on Ctrl+C
  via `AbortController`/SIGINT; `select`/`multiselect` now honor `default` and
  `validate`, guard against empty choice lists, and de-duplicate selections.
- New exports: `createColorizer`, `isColorEnabled`, `resetColorEnabled`,
  `maskInput`, and the `SelectOptions` type.
- Public type exports: `Action`, `ArgDef`, `Completer`, `CommandDefinition`,
  `OptionDef`, `ParseResult`, `CatchContext`, `CLIErrorCode`, and `ModeConfig`.
- New `error` lifecycle event that fires for every input-handling failure,
  including command-not-found (alongside `commandError` for resolved commands).
- Structured fields on error classes: `input`, `argName`, `optionName`, `flag`,
  `extra`, `value`, `cause`, plus an `exitCode` on every `CLIError`.
- `PluginContext` gains `off` and `catch`.

### Fixed

- **Color**: nested/independent colors no longer bleed; color is now decided
  per output stream (`createColorizer`) so ANSI no longer leaks into piped /
  redirected / non-TTY streams; `FORCE_COLOR` is honored; `stripAnsi` covers
  OSC and cursor sequences.
- **Width**: `stringWidth` now counts zero-width/combining characters as 0 and
  emoji/wide characters as 2, fixing table and help alignment.
- **Table**: over-wide headers are truncated to the frame, embedded newlines are
  sanitized, columns are the union of all row keys, null/undefined render
  consistently, and `align`/`maxWidth` are keyed by column key (not label).
- **Progress**: spinner/bar terminal calls are idempotent and clear their timer;
  ETA is never negative; `MultiBar` renders to a single stream, tracks its line
  count correctly when bars are added incrementally, and clamps updates.
- **Options**: a custom `parse` now runs on the raw string before built-in
  coercion; empty/blank values for numeric options are rejected instead of
  becoming `0`; `choices` are compared leniently across string/number.
- **Aliases**: an alias that collides with an existing command now throws at
  definition time instead of silently shadowing it; aliases no longer inflate
  subcommand counts or duplicate completion candidates.
- **Completion**: option flags are offered after positionals/subcommands, custom
  completers receive parsed args/options and are prefix-filtered, and `--opt=`
  inline values complete.
- **Help**: usage shows the canonical command name, `--help` is always listed,
  boolean `true` defaults are shown, subcommand aliases are listed, and
  `help <unknown>` reports on stderr with a non-zero exit.
- **Shell**: command history is stored most-recent-first for arrow navigation;
  `mode` sub-REPL input is no longer persisted to the on-disk history.
- **Logger**: `setLevel` now propagates to existing child loggers; color is
  decided per stream.
- **Pipes**: piped stages now stream concurrently instead of fully buffering
  each stage, and tear down on failure.
- A throwing event/plugin listener can no longer abort command flow.
- Error subclasses keep `instanceof` after transpilation.

### Changed

- Internal toolchain: `tsconfig` sets `esModuleInterop: true` and
  `types: ["node"]` for TypeScript 6 compatibility; development and CI Node
  pinned to 24 (supported range remains `>=20`).

### Notable behavior changes

These correct previously buggy behavior and may be observable:

- An alias colliding with an existing command name now throws at definition time.
- A numeric option given an empty value (e.g. `--port=`) now errors instead of
  resolving to `0`.
- Invalid command definitions (empty name, a variadic argument that is not last)
  now throw at definition time.
- Help output format changed (canonical names, an always-listed `--help`,
  shown boolean `true` defaults); `help <unknown>` now exits non-zero.
- `PromptCancelError` carries `exitCode` 130; `CLIError.code` is now a typed union.

## [1.1.0]

Initial public feature set: interactive shell, subcommands, tab completion,
color, tables, progress, prompts, logger, events, plugins, and pipes.

[1.4.1]: https://github.com/libraz/node-cli/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/libraz/node-cli/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/libraz/node-cli/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/libraz/node-cli/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/libraz/node-cli/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/libraz/node-cli/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/libraz/node-cli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/libraz/node-cli/releases/tag/v1.1.0

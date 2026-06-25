# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.3.0]: https://github.com/libraz/node-cli/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/libraz/node-cli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/libraz/node-cli/releases/tag/v1.1.0

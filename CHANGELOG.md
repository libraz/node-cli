# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.2.0]: https://github.com/libraz/node-cli/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/libraz/node-cli/releases/tag/v1.1.0

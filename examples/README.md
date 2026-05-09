# Examples

Each example demonstrates a different use case for `@libraz/node-cli`.

## Running

```bash
npx tsx examples/<filename>.ts [args...]
```

If you are new to the library, start with these:

```bash
npx tsx examples/01-minimal.ts greet World
npx tsx examples/02-git-style.ts repo create myrepo --private
npx tsx examples/04-output-showcase.ts table --border rounded
npx tsx examples/07-pipe-and-mode.ts
```

Expected output for the first command:

```text
Hello, World!
```

For interactive examples, run the file without arguments and type the commands
shown in each file header. For example:

```bash
npx tsx examples/07-pipe-and-mode.ts
```

```text
pipes> list | filter ts | count
pipes> calc
calc> 2 + 3
calc> exit
```

## Examples

| # | File | Use Case | Key Features |
|---|------|----------|-------------|
| 01 | [minimal](01-minimal.ts) | Hello World | Basic command, dual mode |
| 02 | [git-style](02-git-style.ts) | Project Management | Subcommands, aliases, options, choices |
| 03 | [deploy-tool](03-deploy-tool.ts) | Deployment Workflow | Validation, events, catch handler, color |
| 04 | [output-showcase](04-output-showcase.ts) | Output Utilities | Color, table, progress bar, spinner, logger |
| 05 | [interactive-prompts](05-interactive-prompts.ts) | Setup Wizard | text, confirm, select, multiselect, password |
| 06 | [plugin-system](06-plugin-system.ts) | Extensible CLI | Plugins, async plugins, event hooks |
| 07 | [pipe-and-mode](07-pipe-and-mode.ts) | Data Processing | Pipe chains, mode sub-REPL |
| 08 | [task-runner](08-task-runner.ts) | Build System | Progress, tables, spinners, validation |
| 09 | [database-admin](09-database-admin.ts) | Database Admin | Deep subcommands, prompts, SQL mode, tables |
| 10 | [advanced-api](10-advanced-api.ts) | API Catalog | completion, cancel, hidden options, parsing, negation, advanced table/progress/logger |

## What Each Example Is For

- `01-minimal.ts`: Copy this when you want the smallest possible app shape.
- `02-git-style.ts`: Use this for nested commands, aliases, repeatable options, and choices.
- `03-deploy-tool.ts`: Use this for validation, lifecycle events, and fallback command handling.
- `04-output-showcase.ts`: Use this to inspect output helpers in isolation.
- `05-interactive-prompts.ts`: Use this for setup wizards and login-style flows.
- `06-plugin-system.ts`: Use this when splitting reusable commands and event hooks into plugins.
- `07-pipe-and-mode.ts`: Use this for command pipelines and mode-specific sub-REPLs.
- `08-task-runner.ts`: Use this for practical long-running task flows.
- `09-database-admin.ts`: Use this for larger command trees and an app-like CLI.
- `10-advanced-api.ts`: Use this as an API catalog for specialized features that are not always needed in everyday CLIs.

## Advanced API Commands

`10-advanced-api.ts` is intentionally dense. It is meant to be searched or copied from by feature:

```bash
npx tsx examples/10-advanced-api.ts config --date 2026-05-09 --no-cache
npx tsx examples/10-advanced-api.ts table
npx tsx examples/10-advanced-api.ts progress
npx tsx examples/10-advanced-api.ts logs
npx tsx examples/10-advanced-api.ts completion-info alp --region us-east-1
npx tsx examples/10-advanced-api.ts cancel-info
npx tsx examples/10-advanced-api.ts help config
```

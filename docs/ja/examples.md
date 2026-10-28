# 実例

リポジトリに含まれる実例はすべて単体で動くプログラムで、チェックアウトした状態から `npx tsx examples/<file>.ts [args...]` で実行できます。端末上で引数なしに実行すると、代わりにそのプログラムの対話シェルが開きます。

```bash
npx tsx examples/01-minimal.ts greet World
npx tsx examples/04-output-showcase.ts table --border rounded
npx tsx examples/07-pipe-and-mode.ts
```

| ファイル | 扱う内容 |
| --- | --- |
| [`01-minimal.ts`](../../examples/01-minimal.ts) | コマンド 1 つを、引数として実行する形とツール自身のプロンプトから実行する形の両方で。 |
| [`02-git-style.ts`](../../examples/02-git-style.ts) | 入れ子のサブコマンドグループ、コマンドのエイリアス、繰り返し指定できるオプション、選択肢による制限。 |
| [`03-deploy-tool.ts`](../../examples/03-deploy-tool.ts) | コマンド単位の検証、ライフサイクルイベント、未知の入力に対するフォールバックハンドラ、色付け。 |
| [`04-output-showcase.ts`](../../examples/04-output-showcase.ts) | 出力ツールキットだけを取り出したもの。色、テーブル、プログレスバー、マルチバー、スピナー、ロガー。 |
| [`05-interactive-prompts.ts`](../../examples/05-interactive-prompts.ts) | 5 種類すべてのプロンプトとキャンセル処理。 |
| [`06-plugin-system.ts`](../../examples/06-plugin-system.ts) | コマンドとイベントフックを追加するプラグイン。非同期のものを含みます。 |
| [`07-pipe-and-mode.ts`](../../examples/07-pipe-and-mode.ts) | コマンド間のパイプライン、および独自ハンドラを持つモードサブプロンプト。 |
| [`08-task-runner.ts`](../../examples/08-task-runner.ts) | ビルド風のランナー。スピナー、全体の進捗バー、サマリテーブル、コマンド単位の検証。 |
| [`09-database-admin.ts`](../../examples/09-database-admin.ts) | 3 階層のコマンドツリー、確認プロンプト、テーブル、SQL モード。 |
| [`10-advanced-api.ts`](../../examples/10-advanced-api.ts) | 独自のオプション解析、隠しオプション、否定形のブール値、補完関数、テーブルとプログレスの高度な設定、コマンドの削除。 |

以下のレシピはいずれも単体で完結したプログラムです。公開パッケージを前提に書いてあるため、import は相対パスではなく `@libraz/node-cli` になっています。端末の記録は色を無効にした出力で、リダイレクトまたはキャプチャされたストリームが受け取る内容と同じです。

## 単一コマンドのツール

実用になる最小のプログラムです。コマンド 1 つ、必須の引数 1 つだけを持ちます。

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({
  name: "hello",
  version: "1.0.0",
  description: "A friendly greeting CLI",
});

cli
  .command("greet <name>")
  .description("Say hello to someone")
  .action((ctx) => {
    ctx.stdout.write(`Hello, ${ctx.args.name}!\n`);
  });

await cli.start();
```

```text
$ hello greet World
Hello, World!
```

ヘルプの一覧とコマンドごとのページは、同じ定義から生成されます。

```text
$ hello --help
hello v1.0.0
A friendly greeting CLI

Available commands:

  greet <name>         Say hello to someone
  help [...command]    Show help information

Options:
  -V, --version    Show the CLI version

Shell commands: exit, quit
Type "help <command>" for more information.
```

必須の引数が欠けている場合はアクションが走る前に失敗し、プロセスは終了コード 1 で終わります。

```text
$ hello greet
Error: Missing required argument: <name>

  Usage: greet <name> [options]
```

[`01-minimal.ts`](../../examples/01-minimal.ts) を要約したものです。[コマンド](commands.md) も参照してください。

## サブコマンドグループを持つツール

`remote` は自身のアクションを持たないグループで、その下にある `add`、`remove`、`list` がコマンドです。グループだけを実行するとそのヘルプが表示されます。

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const remotes = new Map<string, string>([["origin", "https://github.com/acme/app.git"]]);

const cli = createCLI({ name: "vcs", description: "A small version-control front end" });

const remote = cli.command("remote").description("Manage repository remotes");

remote
  .command("add <name> <url>")
  .description("Register a new remote")
  .option("-f, --fetch", { type: "boolean", description: "Fetch immediately after adding" })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const url = ctx.args.url as string;
    if (remotes.has(name)) throw new Error(`Remote "${name}" already exists`);
    remotes.set(name, url);
    ctx.stdout.write(`Added remote ${name} -> ${url}\n`);
    if (ctx.options.fetch) ctx.stdout.write(`Fetching from ${name}...\n`);
  });

remote
  .command("remove <name>")
  .alias("rm")
  .description("Delete a remote")
  .action((ctx) => {
    const name = ctx.args.name as string;
    if (!remotes.delete(name)) throw new Error(`No such remote: ${name}`);
    ctx.stdout.write(`Removed remote ${name}\n`);
  });

remote
  .command("list")
  .alias("ls")
  .description("List configured remotes")
  .option("-v, --verbose", { type: "boolean", description: "Show URLs" })
  .action((ctx) => {
    for (const [name, url] of remotes) {
      ctx.stdout.write(ctx.options.verbose ? `${name}\t${url}\n` : `${name}\n`);
    }
  });

await cli.start();
```

この Map はメモリ上にあるだけなので、実行のたびに初期値からやり直しになります。

```text
$ vcs remote list --verbose
origin	https://github.com/acme/app.git

$ vcs remote add upstream https://github.com/acme/upstream.git --fetch
Added remote upstream -> https://github.com/acme/upstream.git
Fetching from upstream...

$ vcs remote rm nope
Error: No such remote: nope
```

アクションを持たないグループは、エイリアスも含めてサブコマンドを一覧表示します。

```text
$ vcs remote
Usage: remote <command> [options]

Manage repository remotes

Options:
  -h, --help    Show help for this command

Commands:
  add <name> <url>    Register a new remote
  remove <name>       Delete a remote (alias: rm)
  list                List configured remotes (alias: ls)

Type "help remote <command>" for more information.
```

[`02-git-style.ts`](../../examples/02-git-style.ts) を要約したものです。

## 検証と確認とプログレスバーを備えた deploy コマンド

3 つのチェックがこの順に走ります。まずオプション自身の `validate`（`ValidationError` を生じます）、次にコマンドの `validate`、最後にアクションです。確認は `--yes` で省略されるため、このコマンドはスクリプトからも使えます。

```typescript
#!/usr/bin/env node
import { createCLI, isCancellationError, progress, prompt } from "@libraz/node-cli";

const cli = createCLI({ name: "deployer", description: "Ship a release" });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

cli
  .command("deploy <env>")
  .description("Deploy a tagged release to an environment")
  .option("-t, --tag <tag>", {
    type: "string",
    required: true,
    description: "Release tag to deploy",
    validate: (value) => {
      if (!/^v\d+\.\d+\.\d+$/.test(String(value))) {
        throw new Error(`expected a tag like v1.2.3, got "${String(value)}"`);
      }
    },
  })
  .option("--yes", { type: "boolean", description: "Skip the confirmation prompt" })
  .validate((ctx) => {
    const allowed = ["dev", "staging", "prod"];
    const env = ctx.args.env as string;
    if (!allowed.includes(env)) {
      throw new Error(`Unknown environment "${env}". Expected one of: ${allowed.join(", ")}`);
    }
  })
  .action(async (ctx) => {
    const env = ctx.args.env as string;
    const tag = ctx.options.tag as string;

    if (!ctx.options.yes) {
      try {
        const go = await prompt.confirm(`Deploy ${tag} to ${env}?`, {
          default: false,
          stdout: ctx.stdout,
          signal: ctx.signal,
        });
        if (!go) {
          ctx.stdout.write("Aborted.\n");
          return;
        }
      } catch (err) {
        if (isCancellationError(err, ctx.signal)) {
          ctx.stdout.write("Aborted.\n");
          return;
        }
        throw err;
      }
    }

    const steps = ["build", "upload", "migrate", "switch", "verify"];
    const bar = progress.bar({ total: steps.length, label: "deploy", stream: ctx.stderr });
    for (let done = 0; done < steps.length; done++) {
      await sleep(300);
      bar.tick();
    }
    bar.finish();

    ctx.stdout.write(`Deployed ${tag} to ${env}.\n`);
  });

await cli.start();
```

プログレスバーは同じ行を描き直します。以下の記録には最後のフレームだけが現れています。

```text
$ deployer deploy prod --tag v1.2.3
? Deploy v1.2.3 to prod? (y/N) y
deploy  [██████████████████████████████]  100%  5/5
Deployed v1.2.3 to prod.
```

yes 以外を答えると、処理が始まる前に止まります。

```text
$ deployer deploy prod --tag v1.2.3
? Deploy v1.2.3 to prod? (y/N) n
Aborted.
```

拒否のたびに、どのチェックによるものかがメッセージに現れます。

```text
$ deployer deploy prod --tag latest --yes
Error: Invalid value for --tag: expected a tag like v1.2.3, got "latest"

$ deployer deploy edge --tag v1.0.0 --yes
Error: Unknown environment "edge". Expected one of: dev, staging, prod

$ deployer deploy prod --yes
Error: Option --tag is required
```

プログレスバーの出力先は `ctx.stderr` です。stdout が別のプログラムへパイプされる可能性がある以上、進捗はこちらに出すべきものです。[`03-deploy-tool.ts`](../../examples/03-deploy-tool.ts) を土台にしています。[プログレス](progress.md) と [プロンプト](prompts.md) も参照してください。

## 揃えと色を指定したステータステーブル

`headerLabels`、`align`、`maxWidth` はいずれも列キー、つまりオブジェクトのプロパティ名で指定します。ヘッダに表示されるラベルではありません。セルに色を付けても表示幅は増えないため、揃えには影響しません。

```typescript
#!/usr/bin/env node
import { createCLI, createColorizer, table } from "@libraz/node-cli";

const services = [
  { service: "api", replicas: 4, latency: "42ms", state: "healthy" },
  { service: "worker", replicas: 12, latency: "118ms", state: "degraded" },
  { service: "scheduler", replicas: 1, latency: "7ms", state: "healthy" },
];

const cli = createCLI({ name: "fleet", description: "Cluster status" });

cli
  .command("status")
  .description("Show the state of every service")
  .action((ctx) => {
    const col = createColorizer(ctx.stdout);
    const rows = services.map((row) => ({
      ...row,
      state: row.state === "healthy" ? col.green(row.state) : col.yellow(row.state),
    }));

    ctx.stdout.write(
      `${table(rows, {
        border: "rounded",
        headerLabels: { service: "Service", replicas: "Pods", latency: "p95", state: "State" },
        align: { replicas: "right", latency: "right", state: "center" },
        style: { head: "cyan.bold", border: "dim" },
      })}\n`,
    );
  });

await cli.start();
```

```text
$ fleet status
╭───────────┬──────┬───────┬──────────╮
│ Service   │ Pods │   p95 │  State   │
├───────────┼──────┼───────┼──────────┤
│ api       │    4 │  42ms │ healthy  │
│ worker    │   12 │ 118ms │ degraded │
│ scheduler │    1 │   7ms │ healthy  │
╰───────────┴──────┴───────┴──────────╯
```

`createColorizer(ctx.stdout)` は色付けの判定を、そのコマンドが実際に書き込むストリームに結び付けます。そのストリームがファイルへリダイレクトされればエスケープシーケンスは出力されません。[`04-output-showcase.ts`](../../examples/04-output-showcase.ts) を要約したものです。[テーブル](table.md) と [色](color.md) も参照してください。

## プロンプトで組み立てたセットアップウィザード

4 つのプロンプトが順に走ります。プロンプトから外へ抜ける失敗は `PromptCancelError` だけで、`validate` が投げた場合はメッセージを表示して同じ質問をやり直します。そのため、シーケンス全体を 1 つの catch で囲めば、どの段階での Ctrl-C にも対応できます。

```typescript
#!/usr/bin/env node
import { createCLI, PromptCancelError, prompt } from "@libraz/node-cli";

const cli = createCLI({ name: "scaffold", description: "Create a new project" });

cli
  .command("init")
  .description("Create a project interactively")
  .action(async (ctx) => {
    try {
      const name = await prompt.text("Project name:", {
        default: "my-app",
        validate: (value) => {
          if (!/^[a-z0-9-]+$/.test(value)) {
            throw new Error("use lowercase letters, digits and hyphens only");
          }
        },
      });

      const template = await prompt.select(
        "Template:",
        [
          { label: "Minimal", value: "minimal", hint: "one file" },
          { label: "HTTP server", value: "server" },
          { label: "Library", value: "lib" },
        ],
        { default: "minimal" },
      );

      const features = await prompt.multiselect(
        "Features:",
        [
          { label: "TypeScript", value: "ts" },
          { label: "Tests", value: "tests" },
          { label: "Dockerfile", value: "docker" },
        ],
        { min: 1 },
      );

      const git = await prompt.confirm("Initialize a git repository?", { default: true });

      ctx.stdout.write(`\nname:     ${name}\n`);
      ctx.stdout.write(`template: ${template}\n`);
      ctx.stdout.write(`features: ${features.join(", ")}\n`);
      ctx.stdout.write(`git:      ${git ? "yes" : "no"}\n`);
    } catch (err) {
      if (err instanceof PromptCancelError) {
        ctx.stdout.write("\nCancelled.\n");
        return;
      }
      throw err;
    }
  });

await cli.start();
```

最初の質問で Enter を押すと既定値が採用されます。`default` を明示したオプションは `required` のチェックを迂回するためです。

```text
$ scaffold init
? Project name: (my-app) 
? Template:
  1) Minimal (one file) [default]
  2) HTTP server
  3) Library
Enter number (default 1): 2
? Features: (comma-separated numbers)
  1) TypeScript
  2) Tests
  3) Dockerfile
Enter numbers: 1,2
? Initialize a git repository? (Y/n) 

name:     my-app
template: server
features: ts, tests
git:      yes
```

不正な回答はその場で報告され、同じ質問がもう一度出されます。

```text
? Project name: (my-app) My App
✖ use lowercase letters, digits and hyphens only
? Project name: (my-app) 
```

どの質問でも Ctrl-C は `PromptCancelError` による reject になり、その終了コードは 130 です。

```text
? Template:
  1) Minimal (one file) [default]
  2) HTTP server
  3) Library
Enter number (default 1): ^C
Cancelled.
```

[`05-interactive-prompts.ts`](../../examples/05-interactive-prompts.ts) を要約したものです。[プロンプト](prompts.md) も参照してください。

## プラグインによる CLI の拡張

プラグインはコンテキストを受け取って、コマンド・イベントリスナ・フォールバックハンドラを登録する関数です。非同期でも構いません。その場合はどのコマンドが走るよりも前に await されます。

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";
import type { CommandContext, PluginContext } from "@libraz/node-cli";

function timingPlugin(ctx: PluginContext): void {
  const started = new WeakMap<CommandContext, number>();
  ctx.on("beforeExecute", (cmd) => {
    started.set(cmd, Date.now());
  });
  ctx.on("afterExecute", (cmd) => {
    const start = started.get(cmd);
    if (start !== undefined) {
      cmd.stderr.write(`(${cmd.commandPath.join(" ")} took ${Date.now() - start}ms)\n`);
    }
  });
}

function healthPlugin(baseUrl: string) {
  return async (ctx: PluginContext): Promise<void> => {
    await Promise.resolve(); // stand-in for loading configuration

    ctx
      .command("ping")
      .description("Check that the service answers")
      .option("--timeout <ms>", { type: "number", default: 2000, description: "Request timeout" })
      .action((cmd) => {
        cmd.stdout.write(`pong from ${baseUrl} (timeout ${cmd.options.timeout}ms)\n`);
      });

    ctx.catch((input, io) => {
      io.stderr.write(`Unknown command: ${input}\n`);
    });
  };
}

const cli = createCLI({ name: "svc", description: "Service control" });

cli.use(timingPlugin);
cli.use(healthPlugin("https://api.example.com"));

await cli.start();
```

```text
$ svc ping --timeout 500
pong from https://api.example.com (timeout 500ms)
(ping took 0ms)

$ svc wat
Unknown command: wat
```

経過時間の数値は実行ごとに変わります。フォールバックハンドラは呼び出しを解決したものとして扱われるため、一致しなかったコマンドは `CommandNotFoundError` で失敗せず終了コード 0 で終わります。0 以外の終了コードが必要なら、`stderr` へ書き出したうえで `process.exitCode` を設定してください。

[`06-plugin-system.ts`](../../examples/06-plugin-system.ts) を要約したものです。[イベントとプラグイン](events-and-plugins.md) も参照してください。

## パイプとモードサブプロンプトによるコマンドの連結

パイプラインは文字列入力からのみ組み立てられます。対話シェル、または `cli.exec("a | b")` です。直接実行モードは引数の配列を受け取るため、パイプ文字で分割されることはありません。各ステージは並行して走り、2 番目以降のステージは前段の出力を `ctx.stdin` から読みます。

```typescript
#!/usr/bin/env node
import type { Readable } from "node:stream";
import { createCLI } from "@libraz/node-cli";

const files = ["index.ts", "cli.ts", "README.md", "app.js", "parser.ts"];

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
}

const cli = createCLI({ name: "pipes", prompt: "pipes> " });

cli
  .command("list")
  .description("Print the sample file list")
  .action((ctx) => {
    for (const file of files) ctx.stdout.write(`${file}\n`);
  });

cli
  .command("filter <pattern>")
  .description("Keep only the lines that contain a pattern")
  .action(async (ctx) => {
    if (!ctx.stdin) {
      ctx.stderr.write("filter reads standard input; use it after a pipe\n");
      return;
    }
    const lines = (await readAll(ctx.stdin)).split("\n").filter(Boolean);
    for (const line of lines) {
      if (line.includes(ctx.args.pattern as string)) ctx.stdout.write(`${line}\n`);
    }
  });

cli
  .command("count")
  .description("Count the lines on standard input")
  .action(async (ctx) => {
    if (!ctx.stdin) {
      ctx.stderr.write("count reads standard input; use it after a pipe\n");
      return;
    }
    ctx.stdout.write(`${(await readAll(ctx.stdin)).split("\n").filter(Boolean).length}\n`);
  });

cli
  .command("calc")
  .description("Open a calculator sub-prompt")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("calc needs the interactive shell\n");
      return;
    }
    ctx.shell.enterMode({
      prompt: "calc> ",
      message: "Calculator. Type an arithmetic expression, or exit to return.",
      action: (input, io) => {
        if (!/^[\d\s+\-*/().]+$/.test(input)) {
          io.stderr.write("only + - * / and parentheses are supported\n");
          return;
        }
        io.stdout.write(`= ${String(Number(new Function(`return (${input})`)()))}\n`);
      },
    });
  });

await cli.start();
```

端末上で引数なしに実行するとツール自身のプロンプトが開き、パイプラインもモードもそこから使えます。

```text
$ pipes
pipes
pipes> list | filter ts | count
3
pipes> calc
Calculator. Type an arithmetic expression, or exit to return.
calc> 2 + 3 * 4
= 14
calc> exit
pipes> exit
```

モード内の `exit` はシェルではなくモードを抜けます。モードはコマンドレジストリを経由せずに入力を処理するため、同名のコマンドがあってもそこからは到達できないからです。

`exec` は文字列を受け取るので、同じパイプラインをプログラムから実行できます。

```typescript
await cli.exec("list | filter ts | count");
```

`exec` の下では `ctx.shell` が `null` になるため、`calc` はサブプロンプトを開かずガード用のメッセージを出力します。[`07-pipe-and-mode.ts`](../../examples/07-pipe-and-mode.ts) を要約したものです。[対話シェル](interactive-shell.md) も参照してください。

## 並行するプログレスバーを持つタスクランナー

単独のインジケータ 2 つで同じ端末ストリームを共有することはできません。互いに相手の行配置を知り得ないため、2 つ目は例外を投げます。並行して動くバーは `progress.multi()` のグループにまとめてください。グループはすべてのバーを 1 フレームとして描画します。

```typescript
#!/usr/bin/env node
import { createCLI, progress, table } from "@libraz/node-cli";

interface Task {
  name: string;
  steps: number;
  ms: number;
}

const tasks: Task[] = [
  { name: "lint", steps: 4, ms: 120 },
  { name: "build", steps: 10, ms: 90 },
  { name: "test", steps: 6, ms: 200 },
];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const cli = createCLI({ name: "taskr", description: "Run build tasks" });

cli
  .command("run [...names]")
  .description("Run tasks concurrently")
  .action(async (ctx) => {
    const requested = (ctx.args.names as string[] | undefined) ?? [];
    const selected = requested.length > 0
      ? tasks.filter((task) => requested.includes(task.name))
      : tasks;

    if (selected.length === 0) throw new Error("No matching task");

    const multi = progress.multi();
    const started = Date.now();

    try {
      await Promise.all(
        selected.map(async (task) => {
          const bar = multi.add({
            total: task.steps,
            label: task.name,
            width: 20,
            stream: ctx.stderr,
          });
          for (let step = 0; step < task.steps; step++) {
            await sleep(task.ms);
            bar.tick();
          }
        }),
      );
    } finally {
      multi.finish();
    }

    const summary = selected.map((task) => ({
      task: task.name,
      steps: task.steps,
      result: "ok",
    }));

    ctx.stdout.write(`${table(summary, { border: "rounded", align: { steps: "right" } })}\n`);
    ctx.stdout.write(`finished in ${Date.now() - started}ms\n`);
  });

await cli.start();
```

グループは 3 行をまとめて描き直します。実行途中の様子は次のようになります。

```text
lint  [████████████████████]  100%  4/4
build  [████████████░░░░░░░░]  60%  6/10
test  [███████░░░░░░░░░░░░░]  33%  2/6
```

そして `finish()` の後、stdout にサマリテーブルが続きます。

```text
lint  [████████████████████]  100%  4/4
build  [████████████████████]  100%  10/10
test  [████████████████████]  100%  6/6
╭───────┬───────┬────────╮
│ task  │ steps │ result │
├───────┼───────┼────────┤
│ lint  │     4 │ ok     │
│ build │    10 │ ok     │
│ test  │     6 │ ok     │
╰───────┴───────┴────────╯
finished in 1215ms
```

経過時間の数値は実行ごとに変わります。行の幅は揃えられません。各行はラベル、バー、パーセント、カウントをスペース 2 つでつないだものです。列として揃えたい場合はラベル側を自分で埋めてください。

`multi.finish()` は `finally` に置いてあり、グループが閉じた後に追加されたバーは何もしないため、遅れて終わったタスクがコマンドを失敗させることはありません。[`08-task-runner.ts`](../../examples/08-task-runner.ts) を土台にしています。[プログレス](progress.md) も参照してください。

## 深いサブコマンドツリーとモードサブプロンプト

グループは何階層でも入れ子にできます。`db table show` は 3 階層で、グループ、グループ、そして引数とオプションを持つコマンドという構成です。

```typescript
#!/usr/bin/env node
import { createCLI, table } from "@libraz/node-cli";

const db: Record<string, Record<string, unknown>[]> = {
  users: [
    { id: 1, name: "Alice", role: "admin" },
    { id: 2, name: "Bob", role: "member" },
  ],
  posts: [{ id: 1, title: "Hello", author_id: 1 }],
};

const cli = createCLI({ name: "dbadmin", prompt: "db> ", description: "Database console" });

const root = cli.command("db").description("Database operations");

root
  .command("status")
  .description("Show connection status")
  .action((ctx) => {
    const rows = Object.entries(db).map(([name, records]) => ({
      table: name,
      rows: records.length,
      columns: Object.keys(records[0] ?? {}).length,
    }));
    ctx.stdout.write(
      `${table(rows, { border: "rounded", align: { rows: "right", columns: "right" } })}\n`,
    );
  });

const tables = root.command("table").description("Table operations");

tables
  .command("list")
  .alias("ls")
  .description("List every table")
  .action((ctx) => {
    for (const name of Object.keys(db)) ctx.stdout.write(`${name}\n`);
  });

tables
  .command("show <name>")
  .description("Print the rows of a table")
  .option("-l, --limit <n>", { type: "number", default: 10, description: "Maximum rows" })
  .validate((ctx) => {
    if (!Object.hasOwn(db, ctx.args.name as string)) {
      throw new Error(`No such table: ${ctx.args.name}`);
    }
  })
  .action((ctx) => {
    const rows = db[ctx.args.name as string].slice(0, ctx.options.limit as number);
    ctx.stdout.write(`${table(rows, { border: "rounded" })}\n`);
  });

cli
  .command("sql")
  .description("Open a SQL sub-prompt")
  .action((ctx) => {
    if (!ctx.shell) {
      ctx.stderr.write("sql needs the interactive shell\n");
      return;
    }
    ctx.shell.enterMode({
      prompt: "sql> ",
      message: "SQL mode. Type exit to return.",
      history: "none",
      action: (input, io) => {
        const match = /^select\s+\*\s+from\s+(\w+)$/i.exec(input.trim());
        const rows = match ? db[match[1]] : undefined;
        if (!rows) {
          io.stderr.write("only SELECT * FROM <table> is supported\n");
          return;
        }
        io.stdout.write(`${table(rows, { border: "rounded" })}\n`);
      },
    });
  });

await cli.start();
```

```text
$ dbadmin db status
╭───────┬──────┬─────────╮
│ table │ rows │ columns │
├───────┼──────┼─────────┤
│ users │    2 │       3 │
│ posts │    1 │       3 │
╰───────┴──────┴─────────╯

$ dbadmin db table show users
╭────┬───────┬────────╮
│ id │ name  │ role   │
├────┼───────┼────────┤
│ 1  │ Alice │ admin  │
│ 2  │ Bob   │ member │
╰────┴───────┴────────╯

$ dbadmin db table show nope
Error: No such table: nope
```

同じツリーはツール自身のプロンプトからも使え、そこでは SQL モードも動きます。

```text
$ dbadmin
dbadmin
db> db table ls
users
posts
db> sql
SQL mode. Type exit to return.
sql> select * from posts
╭────┬───────┬───────────╮
│ id │ title │ author_id │
├────┼───────┼───────────┤
│ 1  │ Hello │ 1         │
╰────┴───────┴───────────╯
sql> exit
db> exit
```

`history: "none"` は入力されたクエリをメモリ上のモード履歴から外します。なお、モードへの入力はいずれにせよディスク上の履歴ファイルには書かれません。[`09-database-admin.ts`](../../examples/09-database-admin.ts) を土台にしています。

## 独自の補完、独自のオプションパーサ、キャンセルハンドラ

`parse` は指定された値に対する組み込みの型変換を置き換えるため、オプションは任意の型に解決できます。ここでは `Date` です。`default` は解決済みの値として扱われ、`parse` を通ることはありません。

```typescript
#!/usr/bin/env node
import { createCLI } from "@libraz/node-cli";

const regions = ["us-east-1", "us-west-2", "eu-west-1"];
const stacks = ["alpha", "beta", "gamma"];

const cli = createCLI({ name: "infra", version: "2.0.0", prompt: "infra> " });

const inspect = (stack: string): Promise<string> =>
  new Promise((resolve) => setTimeout(() => resolve(stack), 10));

cli
  .command("plan [stack]")
  .description("Preview the changes for a stack")
  .option("--since <date>", {
    type: "string",
    description: "Only consider changes after this date (YYYY-MM-DD)",
    parse: (value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${value}`);
      return date;
    },
  })
  .option("--region <region>", {
    type: "string",
    default: "us-east-1",
    autocomplete: regions,
    description: "Target region",
  })
  .option("--cache", {
    type: "boolean",
    default: true,
    description: "Reuse the cached plan",
  })
  .complete((ctx) => stacks.filter((name) => name.startsWith(ctx.current)))
  .cancel((ctx) => {
    ctx.stderr.write("plan cancelled; nothing was written\n");
  })
  .action(async (ctx) => {
    const since = ctx.options.since as Date | undefined;
    ctx.stdout.write(`stack:  ${(ctx.args.stack as string | undefined) ?? "(all)"}\n`);
    ctx.stdout.write(`region: ${ctx.options.region}\n`);
    ctx.stdout.write(`since:  ${since ? since.toISOString() : "(beginning)"}\n`);
    ctx.stdout.write(`cache:  ${ctx.options.cache ? "on" : "off"}\n`);

    const targets = ctx.args.stack ? [ctx.args.stack as string] : stacks;
    for (const target of targets) {
      if (ctx.signal.aborted) return;
      await inspect(target);
    }
    ctx.stdout.write("no changes\n");
  });

await cli.start();
```

```text
$ infra plan alpha --since 2026-05-09 --no-cache
stack:  alpha
region: us-east-1
since:  2026-05-09T00:00:00.000Z
cache:  off
no changes

$ infra plan
stack:  (all)
region: us-east-1
since:  (beginning)
cache:  on
no changes

$ infra plan --since nope
Error: Invalid value for --since: not a date: nope
```

`parse` が失敗すると、そのオプション名を含む `ValidationError` に包まれます。生成されたヘルプには既定値と、ブール値オプションの否定形が並びます。

```text
$ infra help plan
Usage: plan [stack] [options]

Preview the changes for a stack

Arguments:
  stack

Options:
      --since <date>       Only consider changes after this date (YYYY-MM-DD)
      --region <region>    Target region (default: "us-east-1")
      --cache              Reuse the cached plan (default: true) (negate with --no-cache)
  -h, --help               Show help for this command
```

タブ補完はツール自身のプロンプトで動きます。位置引数の候補は `.complete(...)` が、`--region` の値は `autocomplete` が供給します。

```text
infra> plan a<TAB>
infra> plan alpha
infra> plan alpha --region eu<TAB>
infra> plan alpha --region eu-west-1
```

キャンセルハンドラは Ctrl-C でコマンドが中断されたときに、フレームワーク自身のヒントが表示されるより先に走ります。その時点で `ctx.signal` は abort 済みで、だからこそアクション側のループも自力で止まれます。

```text
$ infra plan
stack:  (all)
region: us-east-1
since:  (beginning)
cache:  on
^Cplan cancelled; nothing was written

Interrupted. Press Ctrl-C again to force quit.
```

ハンドラそのものに実行中のコードを止める力はありません。`ctx.signal` を確認しないアクションは最後まで走り切りますし、2 回目の Ctrl-C はプロセスを終了コード 130 で強制終了します。

[`10-advanced-api.ts`](../../examples/10-advanced-api.ts) を要約したものです。[オプション](options.md) と [対話シェル](interactive-shell.md) も参照してください。

## メモリ上のストリームによる CLI のテスト

`cli.exec(input, { stdout, stderr })` は呼び出し側が用意したストリームに対してコマンドを実行します。プロセスを起動せずに CLI をテストできるのはこの仕組みによるものです。`stdin` の既定値は `null`、`stdout` は `process.stdout`、`stderr` は `process.stderr` なので、テストでは少なくとも `stdout` を渡します。

```typescript
import { PassThrough } from "node:stream";
import { createCLI, type CLI } from "@libraz/node-cli";

function buildCli(): CLI {
  const cli = createCLI({ name: "calc" });
  cli
    .command("add <a> <b>")
    .description("Add two numbers")
    .action((ctx) => {
      ctx.stdout.write(`${Number(ctx.args.a) + Number(ctx.args.b)}\n`);
    });
  return cli;
}

function collect(): { stream: PassThrough; text: () => string } {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  return { stream, text: () => Buffer.concat(chunks).toString() };
}

const out = collect();
const err = collect();

await buildCli().exec("add 2 40", { stdout: out.stream, stderr: err.stream });

console.log(JSON.stringify(out.text())); // "42\n"
console.log(JSON.stringify(err.text())); // ""
```

失敗した場合は、`commandError` と `error` の各イベントが発火した後で、返された Promise が reject されます。投げられた値は機械可読なコードと終了コードを持ちます。

```typescript
import { CLIError } from "@libraz/node-cli";

try {
  await buildCli().exec("add 1", { stdout: out.stream, stderr: err.stream });
} catch (err) {
  if (err instanceof CLIError) {
    console.log(err.code); // "MISSING_ARGUMENT"
    console.log(err.exitCode); // 1
  }
}
```

この書き方でテストを書くときに効いてくる点が 3 つあります。

- `exec` の下では `ctx.shell` が `null` になるため、モードを開くコマンドはガードが必要です。テスト対象になるのはモードではなくガードのほうです。
- `exec` は通常の経路で `exit` イベントを発火しません。発火するのは `start()` だけです。`exit` を検証するテストには `start(argv)` が必要です。
- `createColorizer`、ロガー、`progress` の色付けは、それぞれが結び付けられたストリームから判定されます。`PassThrough` は端末ではないため、その出力はプレーンになります。`color` と `c` は代わりに `process.stdout` に従います。エスケープシーケンスそのものを検証したい場合は `setColorEnabled(true)` を呼び、終わったら `resetColorEnabled()` を呼んでください。

テストごとに新しい `CLI` を作れば、登録内容がケース間で漏れることはありません。`start()` は同じインスタンスで 2 回呼ぶと例外を投げます。

## 次に読むもの

- [はじめかた](getting-started.md) — 空のディレクトリからインストール済みのコマンドまで。
- [コマンド](commands.md) と [オプション](options.md) — 定義まわりの全体像。
- [対話シェル](interactive-shell.md) — 履歴、補完、パイプ、モード。
- [API リファレンス](api-reference.md) — すべてのエクスポートを、シグネチャと既定値付きで。

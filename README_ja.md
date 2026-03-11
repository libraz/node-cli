# node-cli

[![CI](https://img.shields.io/github/actions/workflow/status/libraz/node-cli/ci.yml?branch=main&label=CI)](https://github.com/libraz/node-cli/actions)
[![npm](https://img.shields.io/npm/v/@libraz/node-cli)](https://www.npmjs.com/package/@libraz/node-cli)
[![codecov](https://codecov.io/gh/libraz/node-cli/branch/main/graph/badge.svg)](https://codecov.io/gh/libraz/node-cli)
[![License](https://img.shields.io/github/license/libraz/node-cli)](https://github.com/libraz/node-cli/blob/main/LICENSE)

外部依存ゼロ、フル装備の Node.js / TypeScript CLI フレームワーク。

## 概要

**node-cli** は、リッチなコマンドラインアプリケーションの構築に必要な機能をすべて備えた軽量インタラクティブ CLI シェルフレームワークです。外部の本番依存パッケージは一切不要です。

| 機能 | node-cli | Commander | Vorpal |
|------|---------|-----------|--------|
| インタラクティブシェル (REPL) | Yes | No | Yes |
| サブコマンド階層 | Yes | Yes | Yes |
| タブ補完 | Yes | No | Yes |
| カラー出力 | 内蔵 | 外部 | 外部 |
| テーブル表示 | 内蔵 | 外部 | 外部 |
| プログレスバー / スピナー | 内蔵 | 外部 | 外部 |
| インタラクティブプロンプト | 内蔵 | 外部 | 外部 |
| ロガー | 内蔵 | 外部 | 外部 |
| パイプコマンド | Yes | No | Yes |
| プラグインシステム | Yes | No | Yes |
| イベントシステム | Yes | No | Yes |
| 依存パッケージゼロ | Yes | Yes | No |
| TypeScript ファースト | Yes | 一部 | No |
| ESM ファースト | Yes | Yes | No |

## インストール

```bash
# npm
npm install @libraz/node-cli

# yarn
yarn add @libraz/node-cli

# pnpm
pnpm add @libraz/node-cli
```

## クイックスタート

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp", version: "1.0.0" });

cli
  .command("greet <name>")
  .description("挨拶する")
  .option("-u, --uppercase", { type: "boolean" })
  .action((ctx) => {
    const name = ctx.args.name as string;
    const msg = ctx.options.uppercase ? name.toUpperCase() : name;
    ctx.stdout.write(`Hello, ${msg}!\n`);
  });

cli.start();
```

**ダイレクトモード:**

```bash
$ myapp greet World --uppercase
Hello, WORLD!
```

**インタラクティブシェルモード:**

```bash
$ myapp
myapp v1.0.0
> greet World
Hello, World!
> exit
```

## 機能

### コマンドシステム

引数、オプション、エイリアス、バリデーション、サブコマンドを定義するためのチェーン可能な API。

```typescript
cli
  .command("deploy <env>")
  .alias("d")
  .description("環境にデプロイ")
  .option("-t, --tag <tag>", { type: "string", required: true })
  .option("--force", { type: "boolean" })
  .validate((ctx) => {
    if (!["prod", "staging"].includes(ctx.args.env as string)) {
      throw new Error("無効な環境です");
    }
  })
  .action(async (ctx) => {
    ctx.stdout.write(`${ctx.options.tag} を ${ctx.args.env} にデプロイ中...\n`);
  });
```

### サブコマンド

```typescript
const user = cli.command("user").description("ユーザー管理");
user.command("create <name>").action(/* ... */);
user.command("delete <name>").action(/* ... */);
```

### カラー出力

外部依存なしの ANSI カラー API。プロキシベースのチェーン呼び出しに対応。

```typescript
import { color, c } from "@libraz/node-cli";

console.log(color.bold.green("Success!"));
console.log(c`{red.bold Error}: Something went wrong`);
```

### テーブル表示

```typescript
import { table } from "@libraz/node-cli";

const data = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(data, { border: "rounded", headerStyle: "bold" }));
```

### プログレスインジケーター

```typescript
import { progress } from "@libraz/node-cli";

// プログレスバー
const bar = progress.bar({ total: 100, label: "ダウンロード中" });
bar.update(50); // 50%
bar.finish();

// スピナー
const spinner = progress.spinner({ label: "処理中..." });
spinner.start();
spinner.succeed("完了!");
```

### インタラクティブプロンプト

```typescript
import { prompt } from "@libraz/node-cli";

const name = await prompt.text("名前:");
const sure = await prompt.confirm("よろしいですか?");
const env = await prompt.select("環境:", ["dev", "staging", "prod"]);
```

### ロガー

```typescript
import { logger } from "@libraz/node-cli";

const log = logger({ prefix: "app", timestamp: true });
log.info("サーバーがポート %d で起動しました", 3000);
log.success("デプロイ完了");
log.error("接続に失敗しました");

const db = log.child("db");
db.debug("クエリ実行時間: 12ms");
```

### イベントシステム

```typescript
cli.on("beforeExecute", (ctx) => {
  console.log(`実行中: ${ctx.commandPath.join(" ")}`);
});

cli.on("commandError", (error, ctx) => {
  console.error(`コマンドが失敗しました: ${error.message}`);
});
```

### プラグインシステム

```typescript
function timestampPlugin(ctx) {
  ctx.on("beforeExecute", (cmdCtx) => {
    cmdCtx.stdout.write(`[${new Date().toISOString()}] `);
  });
}

cli.use(timestampPlugin);
```

### パイプコマンド

```typescript
// インタラクティブシェル内で
> produce | transform | consume
```

### モードサブ REPL

```typescript
cli.command("sql").action((ctx) => {
  ctx.shell?.enterMode({
    prompt: "sql> ",
    message: "SQL モードに入ります。'exit' で戻ります。",
    action: async (input, { stdout }) => {
      stdout.write(`実行中: ${input}\n`);
    },
  });
});
```

## 動作要件

- Node.js >= 20
- ESM (type: "module")

## ドキュメント

- [はじめに](docs/ja/getting-started.md)
- [API リファレンス](docs/ja/api.md)
- [コマンド & オプション](docs/ja/commands.md)
- [出力ユーティリティ](docs/ja/output.md)

## ライセンス

[MIT](LICENSE)

## 作者

libraz <libraz@libraz.net>

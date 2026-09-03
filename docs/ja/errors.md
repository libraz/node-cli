# エラー

フレームワークが投げる失敗は、すべて `CLIError` かそのサブクラスのインスタンスです。それぞれが機械可読な `code` と `exitCode` を持ちます。`exitCode` は、その失敗が致命的だった場合にプロセスが終了すべきステータス番号です。終了コードとは、プログラムが自分を起動した相手に返す数値で、`0` は成功、それ以外の値は失敗を表します。

## エラーの現れ方

2 つの実行モードは同じエラーを違う形で見せます。プロセスを握っているのが片方だけだからです。

### 直接実行モード

直接実行モード（コマンドライン引数を伴う `cli.start()`）では、失敗が標準エラーストリームに書き出され、プロセスの終了コードがそのエラーから設定されます。

```
$ mycli deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
$ echo $?
1
```

### 対話シェル

対話シェルでも同じメッセージが表示されますが、終了コードは**破棄**され、プロンプトに戻ります。コマンドが失敗してもセッションは終わりません。

```
mycli> deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
mycli>
```

メッセージの文面はどちらのモードでも同じで、違うのはプロセスレベルの結果だけです。

## エラークラス

ここに挙げるクラスはすべてパッケージからエクスポートされ、すべて `CLIError` を継承しています。

| クラス | `code` | `exitCode` | 追加フィールド | 投げられる場面 |
|---|---|---|---|---|
| `CLIError(message, code, exitCode = 1)` | 指定どおり | `1` | `code`, `exitCode` | 基底クラス。サブクラス化して差し支えありません |
| `CommandNotFoundError(input, { available? })` | `COMMAND_NOT_FOUND` | `1` | `input`, `available?` | `catch` ハンドラがない状態で認識できない入力が来たとき、コマンドグループに未知の子コマンドが指定されたとき、`help <unknown>` を実行したとき |
| `MissingArgumentError(argName, usage?)` | `MISSING_ARGUMENT` | `1` | `argName`, `usage?` | 必須の位置引数がないとき。値が 1 つもない必須の可変長引数は `...name` として報告されます |
| `ExtraArgumentError(extra)` | `EXTRA_ARGUMENT` | `1` | `extra` | コマンドの引数を埋めたあとに位置引数の値が余ったとき |
| `MissingOptionError(optionName)` | `MISSING_OPTION` | `1` | `optionName` | `required: true` を宣言したオプションがないとき |
| `InvalidOptionError(message, { optionName?, value? })` | `INVALID_OPTION` | `1` | `optionName?`, `value?` | 型変換に失敗したとき、`choices` の制約に違反したとき、値を取るオプションに値が渡されなかったとき、`--no-x=v` を使ったとき、ブール以外のオプションに `--no-x` を適用したとき、`-abc` のようなまとめ書きの中に値を取る短縮フラグが現れたとき |
| `UnknownOptionError(flag)` | `UNKNOWN_OPTION` | `1` | `flag` | 認識できないフラグ |
| `ValidationError(message, cause?, { optionName? })` | `VALIDATION_ERROR` | `1` | `cause?`, `optionName?` | **オプション**の独自の `parse` または `validate` が例外を投げたとき |
| `ParseError(message, { quote? })` | `PARSE_ERROR` | `1` | `quote?` | 閉じられていない引用符、空のパイプセグメントや末尾のパイプ、`<` / `>` のリダイレクト演算子 |
| `PromptCancelError()` | `PROMPT_CANCELLED` | **`130`** | — | プロンプトが Ctrl+C、Ctrl+D、入力の終了、中止されたシグナルによってキャンセルされたとき |

`CLIErrorCode` は 9 つのコード文字列のユニオンです。

```typescript
type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_ERROR"
  | "PARSE_ERROR"
  | "PROMPT_CANCELLED";
```

`ValidationError` が扱うのは**オプションレベル**の検証だけです。コマンドレベルの `.validate()` が投げたエラーは、そのまま伝播します。ラップされることはありません。

## エラーを調べる

どのエラーも `code` と `exitCode` を公開しており、サブクラスは何が起きたかを具体的に示すフィールドを足します。

```typescript
import {
  CLIError,
  CommandNotFoundError,
  InvalidOptionError,
  MissingArgumentError,
} from "@libraz/node-cli";

function describe(err: unknown): string {
  if (err instanceof MissingArgumentError) {
    return `argument <${err.argName}> is required`;
  }
  if (err instanceof InvalidOptionError) {
    return `--${err.optionName ?? "?"} rejected ${JSON.stringify(err.value)}`;
  }
  if (err instanceof CommandNotFoundError) {
    const hint = err.available ? ` (try: ${err.available.join(", ")})` : "";
    return `no such command: ${err.input}${hint}`;
  }
  if (err instanceof CLIError) {
    return `${err.code} (exit ${err.exitCode})`;
  }
  return String(err);
}
```

クラスではなく `code` で分岐しても同じように機能し、クラスの同一性が失われる境界を越えたあとでも使えます。

```typescript
cli.on("commandError", (error, ctx) => {
  if (error instanceof CLIError && error.code === "MISSING_OPTION") {
    ctx.stderr.write("Run with --help to see the required options.\n");
  }
});
```

`commandError` と `error` については[イベントとプラグイン](events-and-plugins.md)を参照してください。

## アクションから独自のエラーを投げる

アクションから投げられたものは、すべて失敗として扱われます。素の `Error` はそのメッセージが報告され、プロセスは `1` で終了します。

```typescript
cli
  .command("deploy <env>")
  .option("--force", { description: "Skip the production guard" })
  .action((ctx) => {
    const env = String(ctx.args.env);
    if (env === "prod" && !ctx.options.force) {
      throw new Error("Deploying to prod requires --force");
    }
    ctx.stdout.write(`Deploying to ${env}\n`);
  });
```

出力は次のとおりです。

```
Error: Deploying to prod requires --force
```

### `CLIError` の独自サブクラス

失敗に固有の終了コードが必要なときは `CLIError` をサブクラス化します。たとえば、ラッパースクリプトが設定の問題とネットワークの問題を見分けられるようにする場合です。`code` 引数は `CLIErrorCode` の 9 つの値のいずれかでなければなりませんが、終了コードは自由に決められます。

```typescript
import { access } from "node:fs/promises";
import { CLIError } from "@libraz/node-cli";

class ConfigError extends CLIError {
  readonly path: string;

  constructor(message: string, path: string) {
    // 78 is the conventional "configuration error" status.
    super(message, "VALIDATION_ERROR", 78);
    this.name = "ConfigError";
    this.path = path;
  }
}

cli
  .command("start")
  .action(async (ctx) => {
    const path = "/etc/mycli/config.json";
    try {
      await access(path);
    } catch {
      throw new ConfigError(`Configuration file not found: ${path}`, path);
    }
    ctx.stdout.write("started\n");
  });
```

直接実行モードでは、これでプロセスがステータス `78` で終了します。対話シェルでは、ほかの失敗と同じくメッセージが表示されてプロンプトに戻ります。

## キャンセル

キャンセルは失敗ではありません。利用者が処理の停止を求めた、ということです。表示は 1 語だけで、中断を表す慣例的なステータスを使います。

```
Cancelled
```

投げられた値を分類し、整形するためのヘルパーが 2 つエクスポートされています。

### `isCancellationError(err, signal?)`

その値が利用者によるキャンセルを表す場合に `true` を返します。

- `PromptCancelError` のすべて
- `name` が `"AbortError"` の `Error` のうち、**渡された `signal` が中止されている**もの

`signal` 引数には意味があります。渡さずに呼んだ場合、素の `AbortError` は**キャンセルとは見なされない**点に注意してください。無関係なコードが起こした中止を「利用者がキャンセルした」と黙って報告してしまわないためです。

```typescript
import { isCancellationError } from "@libraz/node-cli";

cli
  .command("sync")
  .action(async (ctx) => {
    try {
      const res = await fetch("https://example.com/data", { signal: ctx.signal });
      ctx.stdout.write(await res.text());
    } catch (err) {
      if (isCancellationError(err, ctx.signal)) {
        ctx.stderr.write("Sync stopped.\n");
        return;
      }
      throw err;
    }
  });
```

### `formatErrorMessage(err, signal?)`

キャンセルに対しては `"Cancelled"` を返し、それ以外はエラーのメッセージを返します。`Error` でない値の場合は、文字列に変換した結果を返します。

```typescript
import { formatErrorMessage } from "@libraz/node-cli";

cli.on("error", (error) => {
  process.stderr.write(`${formatErrorMessage(error)}\n`);
});
```

キャンセルが起きるのは、対話シェルと直接実行モードでの Ctrl+C、利用者が閉じたプロンプト（[プロンプト](prompts.md)を参照）、そして `cli.exec()` に渡した `AbortSignal` です。

## 終了コード

| コード | 意味 |
|---|---|
| `0` | 正常な完了 |
| `1` | `CLIError` の既定値。コマンドから投げられたそれ以外の値も含みます |
| `130` | 中断されたコマンド、あらゆるキャンセル、強制終了（Ctrl+C を 2 回） |
| `143` | 対話シェルの SIGTERM による破棄。SIGTERM は、プロセスマネージャがプログラムに停止を求めるときに送るシグナル |
| 任意 | 独自の `exitCode` を設定した `CLIError` のサブクラス |

`130` は `128 + 2`（中断シグナル）、`143` は `128 + 15`（終了シグナル）で、シグナルによって終了したプロセスの慣例に従っています。

これらのコードを適用するのは直接実行モードだけです。対話シェルではセッションを保つため、コードはすべて破棄されます。

## `NODE_CLI_DEBUG` によるデバッグ

環境変数 `NODE_CLI_DEBUG=1` を設定すると、1 行の `Error: <message>` 形式ではなく完全なスタックトレースが表示されます。

```
$ NODE_CLI_DEBUG=1 mycli deploy prod
Error: Deploying to prod requires --force
    at Object.action (/home/me/mycli/index.ts:24:11)
    ...
```

制限が 2 つあります。

- 効くのは**直接 argv を渡す経路だけ**です。対話シェルは 1 行形式のままなので、スタックトレースが実行中のセッションを埋め尽くすことはありません。
- キャンセルには適用されません。キャンセルは常に `Cancelled` として表示されます。

## 関連ページ

- [コマンド](commands.md) — `validate`、`cancel`、コマンドコンテキスト
- [オプション](options.md) — `InvalidOptionError` と `ValidationError` の出どころ
- [イベントとプラグイン](events-and-plugins.md) — `commandError` と `error` で失敗を観察する
- [対話シェル](interactive-shell.md) — Ctrl+C、強制終了、SIGTERM
- [用語集](glossary.md) — 終了コード、シグナル、`AbortSignal`

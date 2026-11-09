# エラー

失敗は3つの族に分かれます。

- 利用者の入力が原因の失敗は、`CLIError` かそのサブクラスのインスタンスです。それぞれが機械可読な `code` と `exitCode` を持ちます。`exitCode` は、その失敗が致命的だった場合にプロセスが終了すべきステータス番号です。終了コードとは、プログラムが自分を起動した相手に返す数値で、`0` は成功、それ以外の値は失敗を表します。
- プログラムが API を誤って呼んだことが原因の失敗は、`UsageErrorCode` の `code` を持つ `TypeError`、`RangeError`、`Error` です。[プログラマの誤用](#プログラマの誤用)を参照してください。
- キャンセルは `CancelledError` です。終了コード `130` を報告する `CLIError` で、[キャンセル](#キャンセル)を参照してください。

## エラーの現れ方

2 つの実行モードは同じエラーを違う形で見せます。プロセスを握っているのが片方だけだからです。

### 直接実行モード

直接実行モード（コマンドライン引数を伴う `cli.start()`）では、失敗が標準エラーストリームに書き出され、プロセスの終了コードがそのエラーから設定されます。

```
$ mycli deploy
Error: Missing required argument: <env>

  Usage: deploy <env> [region] [options]
$ echo $?
64
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

ここに挙げるクラスはすべてパッケージからエクスポートされ、すべて `CLIError` を継承しています。どのコンストラクタも、示した第1引数と、省略できる options オブジェクトを取ります。

| クラス | `code` | `exitCode` | 追加フィールド | 投げられる場面 |
|---|---|---|---|---|
| `CLIError(message, CLIErrorOptions)` | 指定どおり。既定は `FAILED` | 指定どおり。既定は `1` | `code`, `exitCode`, `cause?` | 基底クラス。サブクラス化して差し支えありません |
| `CommandNotFoundError(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `64` | `input`, `available?` | `fallback` ハンドラがない状態で認識できない入力が来たとき、コマンドグループに未知の子コマンドが指定されたとき、`help <unknown>` を実行したとき |
| `MissingArgumentError(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `64` | `argName`, `usage?` | 必須の位置引数がないとき。値が 1 つもない必須の可変長引数は `...name` として報告されます |
| `ExtraArgumentError(extras, { usage?, cause? })` | `EXTRA_ARGUMENT` | `64` | `extras`, `usage?` | コマンドの引数を埋めたあとに位置引数の値が余ったとき |
| `MissingOptionError(optionName, { usage?, cause? })` | `MISSING_OPTION` | `64` | `optionName`, `usage?` | `required: true` を宣言したオプションがないとき |
| `InvalidOptionError(message, { optionName?, value?, usage?, cause? })` | `INVALID_OPTION` | `64` | `optionName?`, `value?`, `usage?` | 型変換に失敗したとき、`choices` の制約に違反したとき、値を取るオプションに値が渡されなかったとき、`--no-x=v` を使ったとき、ブール以外のオプションに `--no-x` を適用したとき、`-abc` のようなまとめ書きの中に値を取る短縮フラグが現れたとき |
| `UnknownOptionError(flag, { usage?, cause? })` | `UNKNOWN_OPTION` | `64` | `flag`, `optionName`（ダッシュを除いた名前）, `usage?` | 認識できないフラグ |
| `ValidationError(message, { optionName?, value?, usage?, cause? })` | `VALIDATION_FAILED` | `64` | `optionName?`, `value?`, `usage?` | オプションの独自の `parse` または `validate`、あるいはコマンドの `validate` が例外を投げたとき |
| `ParseError(message, { quote?, cause? })` | `PARSE_FAILED` | `64` | `quote?` | 閉じられていない引用符、空のパイプセグメントや末尾のパイプ、`<` / `>` のリダイレクト演算子 |
| `CancelledError({ cause? })` | `CANCELLED` | **`130`** | — | プロンプトが Ctrl+C でキャンセルされたとき、コマンドがキャンセルされたとき、シグナルが中断されたとき |
| `InputEndedError(promptMessage, { cause? })` | `INPUT_ENDED` | **`66`** | `promptMessage` | プロンプトに読み取る入力がなかったとき。`stdin` が `null` だった場合と、答えの前に入力が終わった場合 |

どのコンストラクタも `{ cause }` を受け取り、`Error` に渡して `err.cause` として公開します。`code` と `exitCode` は `readonly` です。

`CLIErrorOptions` は `{ code?, exitCode?, cause? }` です。`code` は任意の文字列で、組み込みのコードは補完候補に出ます。既定値は `"FAILED"` です。`exitCode` は 1 から 255 までの整数で、既定値は `1` です。数値でない値は構築時に `TypeError`（`ERR_INVALID_ARG_TYPE`）、整数でない値や範囲外の値は `RangeError`（`ERR_INVALID_ARG_VALUE`）を投げます。

「追加フィールド」の列は、各クラスが足すものです。フィールドの意味は次のとおりです。

- `usage` は、コマンドの使い方の行です。あればメッセージの末尾に `\n\n  Usage: <usage>` として付きます。コマンドを解決している間に出るエラー（引数の不足と過剰、オプションの不足・不正・未知、検証）はすべて持つため、ヒントはどれも同じ形になります。
- `optionName` は、定義のあるオプションでは、ダッシュなしで kebab-case の綴りのままの正規のロング名（`dry-run`）です。定義のない `UnknownOptionError` では、入力されたフラグからダッシュを除いたものです。同じオプションの `ctx.options` でのキーは camelCase の形（`dryRun`）です。
- `flag` は、未知のフラグ 1 つを正規化した綴りです。`--xyz=3` は `--xyz`、まとめ書き `-vx` の中の未知の `x` は `-x` と報告されます。
- `InvalidOptionError` と `ValidationError` の `value` は、拒否された値です。型変換や `parse` が失敗した場合は入力の生の文字列、`validate` の検査が失敗した場合は `validate` に渡した値です。コマンドレベルの検証の失敗は、`value` も `optionName` も持ちません。
- `ExtraArgumentError` の `extras` は、余った値をすべて入力順に並べたもので、空になることはありません。空の配列を渡すと `RangeError`（`ERR_INVALID_ARG_VALUE`）を投げます。メッセージは 1 件なら `Unexpected argument: "a"`、複数なら `Unexpected arguments: "a", "b"` です。

### メッセージの引用符

メッセージの族によって、引用符の規則が異なります。

- 利用者の入力についてのメッセージは、利用者のテキストを二重引用符で囲み、作者が定義した名前は囲みません。`Unknown option: "--x"`、`Missing required option: --x`、`Command not found: "depoly"` のとおりです。引用した文字列はエスケープされ、端末に出力しても安全な形になります。
- プログラマの誤用についてのメッセージは、Node 自身の引数エラーの形に従い、作者の名前も引用します。`The "total" option of progress.bar() must be a finite number. Received -1` のとおりです。

`CLIErrorCode` は組み込みの 10 個のコード文字列のユニオンです。素の `CLIError` の既定値 `FAILED` は、このユニオンに含まれません。

```typescript
type CLIErrorCode =
  | "COMMAND_NOT_FOUND"
  | "MISSING_ARGUMENT"
  | "EXTRA_ARGUMENT"
  | "MISSING_OPTION"
  | "INVALID_OPTION"
  | "UNKNOWN_OPTION"
  | "VALIDATION_FAILED"
  | "PARSE_FAILED"
  | "CANCELLED"
  | "INPUT_ENDED";
```

`BuiltinCLIError` は、上に挙げた組み込み 10 クラスのユニオン型です。

クラス名と `code` で綴りが異なるのは次の 2 つです。ほかのコードはクラス名に対応しています。

| クラス | `code` |
|---|---|
| `ValidationError` | `VALIDATION_FAILED` |
| `ParseError` | `PARSE_FAILED` |

オプションの独自の `parse` や `validate`、およびコマンドレベルの `.validate()` は、同じ扱いを受けます。投げられた `CLIError` はそのまま通り、キャンセルはキャンセルとして扱われ、それ以外の値は `ValidationError` に包まれて、元の値が `cause` になります。オプションの場合、包んだエラーは `optionName` と `value` も持ち、メッセージは `Invalid value "x" for --name: <cause のメッセージ>` になります。空の `choices` 配列を持つオプションは、定義した時点で `Error`（code `ERR_INVALID_DEFINITION`）として拒否されます。詳しくは[オプション](options.md)を参照してください。

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

cast なしで組み込みの失敗をすべて扱うには、`unknown` を `isBuiltinCLIError` で絞り込み、`code` で `switch` します。各 case で、そのクラス固有のフィールドに届きます。

```typescript
import { isBuiltinCLIError } from "@libraz/node-cli";

function hint(err: unknown): string | undefined {
  if (!isBuiltinCLIError(err)) return undefined;
  switch (err.code) {
    case "MISSING_ARGUMENT":
      return `pass <${err.argName}>`;
    case "EXTRA_ARGUMENT":
      return `drop ${err.extras.join(" ")}`;
    case "UNKNOWN_OPTION":
      return `no option named ${err.optionName}`;
    default:
      return undefined;
  }
}
```

素の `CLIError` と利用者が作ったサブクラスに対して、`isBuiltinCLIError` は `false` を返します。それらは `instanceof CLIError` か自分のクラスで判定してください。

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

アクションから投げられたものは、すべて失敗として扱われます。素の `Error` はそのメッセージが報告され、プロセスは `1` で終了します。`Error` でない値は先に正規化されます。文字列はそのままメッセージになり、それ以外の値は `util.inspect` で描画した結果がメッセージになり、元の値は `cause` に残ります。`commandError` と `error` のリスナーは、常に `Error` を受け取ります。

```typescript
cli
  .command("deploy <env>")
  .option("--force", { description: "Skip the production guard" })
  .action((ctx) => {
    const env = ctx.args.env;
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

失敗に固有の終了コードが必要なときは `CLIError` をサブクラス化します。たとえば、ラッパースクリプトが設定の問題とネットワークの問題を見分けられるようにする場合です。`code` は任意の文字列にできます（`CLIErrorCode` の 10 個の値は補完候補に出ます）。終了コードは 1 から 255 までの任意の整数です。`new CLIError(message)` だけでも有効で、code は `FAILED`、終了コードは `1` になります。元のエラーを残したいときは `{ cause }` を渡します。

```typescript
import { access } from "node:fs/promises";
import { CLIError } from "@libraz/node-cli";

class ConfigError extends CLIError {
  readonly path: string;

  constructor(message: string, path: string) {
    // 78 is the conventional "configuration error" status.
    super(message, { code: "CONFIG_ERROR", exitCode: 78 });
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

キャンセルは失敗ではありません。利用者が処理の停止を求めた、ということです。`CancelledError`（code `CANCELLED`、メッセージ `Cancelled`、終了コード `130`）として表され、表示は 1 語だけで、中断を表す慣例的なステータスを使います。

```
Cancelled
```

キャンセルは `commandError` も `error` も発火しません。どの入口でも扱いは同じです。`cli.exec()`、`cli.execLine()`、`cli.start()`、対話シェルは `CancelledError` を reject または報告し、signal が中断されている間に起きた生の `AbortError` は、signal の `reason` を `cause` にして一度だけ包まれます。すでに中断された signal を `exec()` や `execLine()` に渡すと、フック、検証、アクションのどれも走らず、`CancelledError` で reject されます。中断を無視して正常に戻ったアクションは、そのまま resolve します。

投げられた値を分類し、整形するためのヘルパーが 2 つエクスポートされています。

### `isCancellationError(err, signal)`

その値が利用者によるキャンセルを表す場合に `true` を返します。

- すべての `CancelledError`。`signal` の状態は問いません
- `name` が `"AbortError"` の `Error` のうち、**渡された `signal` が中断されている**もの

`signal` 引数は必須です。`signal` が中断されていない限り、素の `AbortError` は**キャンセルとは見なされません**。無関係なコードが起こした中断を「利用者がキャンセルした」と黙って報告してしまわないためです。

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

### `formatErrorMessage(err)`

フレームワークが `Error: ` の後ろに出す文字列を返します。エラーのメッセージ、または `Error` でない値なら、その文字列自身か `util.inspect` での描画結果です。テキストは端末向けに無害化されます。制御シーケンスとハイパーリンクは除かれ、開いたままのスタイルは閉じられます。改行は残るため、結果は複数行になることがあります。キャンセルの特別扱いはありません。中断や `CancelledError` のときに `Cancelled` と表示するのはフレームワーク自身です。

既定のプレゼンターがすべての失敗をすでに表示するため、ハンドラが同じ文字列を stderr に書くと二重に出ます。`formatErrorMessage` は、ログファイルなど別の場所へ文字列を送るために使います。

```typescript
import { formatErrorMessage } from "@libraz/node-cli";

import { appendFileSync } from "node:fs";

cli.on("error", (error) => {
  appendFileSync("mycli.log", `${formatErrorMessage(error)}\n`);
});
```

キャンセルが起きるのは、対話シェルと直接実行モードでの Ctrl+C、利用者が閉じたプロンプト（[プロンプト](prompts.md)を参照）、そして `cli.exec()` や `cli.execLine()` に渡した `AbortSignal` です。プロセスレベルの SIGINT の処理は `cli.start()` と対話シェルが担い、`exec()` と `execLine()` は `options.signal` だけでキャンセルされます。

## プログラマの誤用

利用者の入力が原因の失敗は、必ず `CLIError` です（[エラークラス](#エラークラス)を参照）。プログラムが API を誤って呼んだことが原因の失敗はそうではなく、Node 自身の `ERR_*` エラーと同じ流儀で、`UsageErrorCode` の `code` を持つ素の `TypeError`、`RangeError`、`Error` になります。

| 状況 | エラー | `code` |
|---|---|---|
| コマンドやオプションの定義を組み立てる途中で拒否された | `Error` | `ERR_INVALID_DEFINITION`, `ERR_DEFINITION_CONFLICT` |
| 引数の型が違う | `TypeError` | `ERR_INVALID_ARG_TYPE` |
| 値が範囲外、または名前が不明（style、border、level、`prompt.select` と `prompt.multiselect` の空の `choices` や、どの選択肢にも一致しない `default`、`min` > `max`、幅、markup の深さ） | `RangeError` | `ERR_INVALID_ARG_VALUE` |
| 状態が衝突した（削除済みのコマンド、開始済み、出力先や入力が使用中） | `Error` | `ERR_COMMAND_REMOVED`, `ERR_ALREADY_STARTED`, `ERR_OUTPUT_BUSY`, `ERR_INPUT_BUSY` |
| 利用者のコードが非同期のプラグインの初期化で失敗した | `Error` | `ERR_PLUGIN_FAILED` |

```typescript
type UsageErrorCode =
  | "ERR_INVALID_ARG_TYPE"
  | "ERR_INVALID_ARG_VALUE"
  | "ERR_INVALID_DEFINITION"
  | "ERR_DEFINITION_CONFLICT"
  | "ERR_COMMAND_REMOVED"
  | "ERR_ALREADY_STARTED"
  | "ERR_OUTPUT_BUSY"
  | "ERR_INPUT_BUSY"
  | "ERR_PLUGIN_FAILED";
```

これらは呼び出し側のコードで直すべきバグであり、実行時に処理する状況ではないため、`CLIError` を継承しません。

空の `choices` 配列は、現れる場所によってエラーが異なります。空の `choices` 配列を宣言したオプションは、オプションを定義した時点で `Error`（code `ERR_INVALID_DEFINITION`）になります。空の `choices` 配列で呼んだ `prompt.select` と `prompt.multiselect` は、code `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

非同期のプラグインの失敗は、code `ERR_PLUGIN_FAILED`、メッセージ `Plugin initialization failed: <メッセージ>`、元の値を `cause` とする `Error` に一度だけ包まれます。`error` はそれで一度だけ発火し、以後の `cli.use()`、`cli.exec()`、`cli.execLine()`、`cli.start()` は同じエラーで reject されます。`use()` の中で同期的に例外を投げたプラグインは、代わりにその値を呼び出し元へ投げ、CLI は使える状態のままです。

## 終了コード

| コード | 意味 |
|---|---|
| `0` | 正常な完了 |
| `1` | `CLIError` の既定値。コマンドから投げられたそれ以外の値も含みます |
| `64` | コマンドの呼び方の誤り。未知のコマンド、引数やオプションの不足・過剰・不正・未知、検証の失敗、解析できないコマンドライン（sysexits の `EX_USAGE`） |
| `66` | プロンプトに読み取る入力がなかった（sysexits の `EX_NOINPUT`） |
| `130` | 中断されたコマンド、あらゆるキャンセル、強制終了（Ctrl+C を 2 回） |
| `143` | 対話シェルの SIGTERM による破棄。SIGTERM は、プロセスマネージャがプログラムに停止を求めるときに送るシグナル |
| 1 から 255 の任意の値 | 独自の `exitCode` を設定した `CLIError` |

`130` は `128 + 2`（中断シグナル）、`143` は `128 + 15`（終了シグナル）で、シグナルによって終了したプロセスの慣例に従っています。

これらのコードを適用するのは直接実行モードだけです。対話シェルではセッションを保つため、コードはすべて破棄されます。

## `NODE_CLI_DEBUG` によるデバッグ

環境変数 `NODE_CLI_DEBUG=1` を設定すると、`Error: <message>` 形式ではなく、完全なスタックトレースに続けて、`cause` の連鎖にある各エラーのスタックが `[cause] <stack>` の形で表示されます。

```
$ NODE_CLI_DEBUG=1 mycli deploy prod
Error: Deploying to prod requires --force
    at Object.action (/home/me/mycli/index.ts:24:11)
    ...
[cause] Error: ...
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

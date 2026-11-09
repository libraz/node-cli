# イベントとプラグイン

イベントを使うと、コマンドに手を入れないまま実行を観察できます。プラグインを使うと、別のモジュールから既存の CLI にコマンドやイベントを登録できます。どちらも `CLI` インスタンスに登録し、どちらもプログラムからの実行の入口である `cli.exec()` と `cli.execLine()` から使われます。この 2 つは、CLI をテストする手段でもあります。

## ライフサイクルイベント

`CLIEventMap` は 5 つのイベントを定義しています。

| イベント | ハンドラのシグネチャ | 発生するタイミング |
|---|---|---|
| `beforeExecute` | `(ctx) => void \| Promise<void>` | オプションの解決とコマンドの `validate` のあと、アクションの直前 |
| `afterExecute` | `(ctx) => void \| Promise<void>` | アクションが成功して解決したときだけ |
| `commandError` | `(error, ctx) => void \| Promise<void>` | 解決済みのコマンドが失敗したとき |
| `error` | `(error) => void \| Promise<void>` | あらゆる失敗。コマンドが解決される前の失敗と、非同期プラグインの初期化失敗も含みます。キャンセルでは発生しません |
| `exit` | `() => void \| Promise<void>` | `cli.start()` が終わったとき、または強制終了や SIGTERM でプロセスが終わるときに一度だけ。`cli.exec()` と `cli.execLine()` からは発生しません |

`ctx` は `CommandContext` で、アクションが受け取るものと同じオブジェクトです。`args`、`options`、`commandPath`、各ストリーム、`signal` を持ちます。[コマンド](commands.md)を参照してください。

### 発生の順序

![1 回のコマンド実行におけるイベントの順序。入力が解析され、コマンドが解決され、オプションが解決され、コマンドの validate が実行され、beforeExecute が発生し、アクションが実行され、成功すると afterExecute が発生します。解決後のいずれかの段階で失敗すると commandError に続いて error が発生し、解決前の失敗では error だけが発生します。これとは別に、cli.use で登録したプラグインは 1 本の直列キューを通り、どのコマンドが実行されるよりも前にコマンドとイベントハンドラを登録します。](../assets/events-ja.svg)

解決済みのコマンドが正常に実行される場合の流れは次のとおりです。

1. 入力が解析され、コマンドが解決されます
2. オプションが解決されます
3. コマンド自身の `validate` が実行されます
4. `beforeExecute` が発生します
5. アクションが実行されます
6. `afterExecute` が発生します

手順 1、2、3、5 のいずれかで失敗すると、`afterExecute` は飛ばされます。`beforeExecute` のリスナーが例外を投げた場合は `error` で報告され、アクションと `afterExecute` は実行されます。

### ハンドラの登録と解除

```typescript
import { createCLI, type CommandContext } from "@libraz/node-cli";

const cli = createCLI({ name: "mycli" });

cli.on("beforeExecute", (ctx) => {
  ctx.stderr.write(`> ${ctx.commandPath.join(" ")}\n`);
});

cli.on("afterExecute", () => {
  // Runs only when the action succeeded.
});
```

`cli.off(event, handler)` はハンドラを**同一性**で解除します。`off` に渡す参照は、`on` に渡したものと同じ関数オブジェクトでなければなりません。その場で書いたアロー関数は解除できません。

```typescript
const trace = (ctx: CommandContext) => {
  ctx.stderr.write(`> ${ctx.commandPath.join(" ")}\n`);
};

cli.on("beforeExecute", trace);
cli.off("beforeExecute", trace);
```

### ハンドラの実行のしかた

1 つのイベントのハンドラは、**登録順に 1 つずつ実行され、それぞれが await されてから**次が始まります。そのため `async` ハンドラはコマンドを遅らせます。これは意図した設計で、アクションが始まる前にハンドラが実際の処理（監査記録の書き込み、トークンの取得）を済ませられるようにするためです。

ハンドラの一覧は、イベントが発生した時点でスナップショットが取られます。ハンドラの中で別のハンドラを登録・解除しても、その同じイベントで実行されるハンドラは変わりません。

### ハンドラ内でのエラー

ハンドラが例外を投げても、コマンドが壊れることはありません。そのエラーは捕捉されて `error` イベントとして再送出され、残りのハンドラも実行されます。

`error` ハンドラ自身が投げたエラーは、再送出すると無限に回ってしまうため、代わりに標準エラーストリームへ書き出されます。

```
Error in error handler: <message>
```

### `commandError` と `error`

2 つのうち範囲が狭いのは `commandError` です。**解決済みの**コマンドが失敗したときに発生します。コマンドパスが認識されているので、ハンドラに渡せるコンテキストが存在します。対象になるのは次の場合です。

- 必須の位置引数の欠落
- 想定外の余分な位置引数
- オプションの解決（未知のフラグ、不正な値、必須オプションの欠落）
- コマンド自身の `validate` が投げた例外
- アクションが投げた例外
- コマンドパス自体が解決したあとで起きたオプション構文の失敗

`error` はキャンセルを除く**あらゆる**失敗で発生します。コマンドが解決される前に起きたものも含みます。

- 引用符の対応が取れていないなど、解析の失敗
- 認識できないコマンド
- `fallback` ハンドラが投げた例外
- `onCancel` ハンドラのPromiseの失敗
- 別のイベントハンドラが投げた例外
- 非同期プラグインの初期化の失敗（`ERR_PLUGIN_FAILED` のエラーで一度だけ。[プラグインが失敗した場合](#プラグインが失敗した場合)を参照）

この 2 つは二者択一ではありません。解決済みのコマンドが失敗したときは、**`commandError` に続いて `error`** が発生します。`error` は「そうでない場合」の分岐ではありません。両方のイベントで失敗を数えるハンドラは、同じ失敗を 2 回数えることになります。

```typescript
const failures: Error[] = [];

cli.on("commandError", (error, ctx) => {
  ctx.stderr.write(`${ctx.commandPath.join(" ")} failed: ${error.message}\n`);
});

cli.on("error", (error) => {
  // Every failure lands here, including the one reported above.
  failures.push(error);
});
```

キャンセルは失敗ではないため、どちらのイベントも発生しません。Ctrl+C や、`cli.exec()`・`cli.execLine()` に渡した `signal` でキャンセルされ、`CancelledError` で reject されたコマンドがこれにあたります。下流のステージが終わったために早めに止まったパイプのステージや、パイプライン全体の主たる失敗によって破棄された兄弟ステージも同じです。報告されるのは主たる失敗だけです。パイプの挙動については[対話シェル](interactive-shell.md)を参照してください。

### `exit` イベント

`exit` は CLI ごとに多くても一度だけ、次の経路で発生します。

- 直接実行モードのコマンドが完了・例外・強制終了のいずれかで終わったとき
- 引数リストが空、あるいは端末以外での起動によりヘルプ一覧が表示されたとき
- プラグインの初期化が失敗したとき
- 対話シェルが終了したとき、または SIGTERM を受け取ったとき
- 強制終了（Ctrl+C を 2 回）したとき

`cli.exec()` と `cli.execLine()` からは**発生しません**。この 2 つは、プロセスのライフサイクルを呼び出し側に任せます。

CLI が処理しないシグナルを受けると、プロセスは Node の既定の動作で終わるため、`exit` ハンドラもキャンセルハンドラも実行されません。直接実行モードの SIGTERM と SIGHUP、対話シェルの SIGHUP がこれにあたります。

```typescript
import { writeFile } from "node:fs/promises";

cli.on("exit", async () => {
  await writeFile("/tmp/mycli-session.log", "session ended\n", { flag: "a" });
});
```

強制終了のときとシェルが SIGTERM で終了処理をするときは、`exit` ハンドラ全体で 2000 ms が与えられます。それまでに終わらなかったハンドラが終了処理を遅らせることはありません。

## `fallback` ハンドラ

`cli.fallback(handler)` は、どのコマンドにも一致しない入力を、`CommandNotFoundError` を投げる代わりに処理します。

```typescript
cli.fallback((input, { stdout }) => {
  stdout.write(`Unknown command: ${input}\nType "help" to list commands.\n`);
});
```

押さえておきたい性質が 3 つあります。

- **ハンドラは 1 つだけです。** あとから `fallback()` を呼ぶと、前のハンドラを置き換えます。
- **コンテキストはストリームと生の argv を持ちます。** `FallbackContext` は `{ stdin, stdout, stderr, signal, rawArgv }` です。コマンドが解決されていないため、`args` も `shell` もありません。`signal` は `cli.exec()` か `cli.execLine()` に渡したもので、渡していなければ中断されることのない signal です。`rawArgv` は、入力が配列だった場合に実行へ渡された argv 全体で、入れ子の子だけが未知でも全体が入ります。コマンドライン文字列では `null` です。入力を外部コマンドへ転送するときに、引用の情報を失わずに済みます。
- **解析できない入力も届きます。** トークン分割やパイプステージへの分割に失敗した入力は、`ParseError` を投げる代わりにハンドラへ渡されます。

`fallback` ハンドラがない場合、認識できない入力は `CommandNotFoundError` を投げます。[エラー](errors.md)を参照してください。

## プラグイン

プラグインは、コンテキストを受け取ってそこに登録を行う関数です。

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>;
```

### `PluginContext`

`PluginContext` はちょうど 4 つのメソッドです。

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder; // typed like cli.command
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
}
```

`on`、`off`、`fallback` はコンテキスト自身を返すので、登録をつなげて書けます。`command` だけは、新しいコマンドの builder を返します。リテラルの定義文字列からは、`cli.command()` と同じく型が付きます。

`use` はありません（プラグインが別のプラグインを登録することはできません）。コマンドレジストリへのアクセスもなく、ロガーや設定オブジェクトもありません。それらが必要なプラグインは、自分のパラメータとして受け取ってください。

### プラグインを書く

```typescript
import { createCLI, type PluginContext } from "@libraz/node-cli";

function statusPlugin(ctx: PluginContext): void {
  ctx.command("status")
    .description("Show service status")
    .action((cmdCtx) => {
      cmdCtx.stdout.write("All systems operational\n");
    });

  ctx.on("beforeExecute", (cmdCtx) => {
    cmdCtx.stderr.write(`[audit] ${cmdCtx.commandPath.join(" ")}\n`);
  });
}

const cli = createCLI({ name: "mycli" });
cli.use(statusPlugin);
```

設定が必要なプラグインは、プラグインを返すファクトリとして書きます。

```typescript
interface MetricsClient {
  record(name: string): Promise<void>;
  flush(): Promise<void>;
}

async function connectMetrics(endpoint: string): Promise<MetricsClient> {
  return {
    record: async (name) => {
      await fetch(`${endpoint}/record`, { method: "POST", body: name });
    },
    flush: async () => {
      await fetch(`${endpoint}/flush`, { method: "POST" });
    },
  };
}

function metricsPlugin(endpoint: string) {
  return async (ctx: PluginContext): Promise<void> => {
    const client = await connectMetrics(endpoint);

    ctx.on("afterExecute", async (cmdCtx) => {
      await client.record(cmdCtx.commandPath.join("."));
    });

    ctx.command("metrics flush")
      .description("Flush buffered metrics")
      .action(async (cmdCtx) => {
        await client.flush();
        cmdCtx.stdout.write("flushed\n");
      });
  };
}

cli.use(metricsPlugin("https://metrics.example.com"));
```

### 順序と非同期プラグイン

先に登録した非同期のプラグインが保留中でなければ、`use()` はプラグインの本体をその呼び出しの中ですぐに実行します。同期的なプラグインは、`use()` から戻った時点で登録を終えています。

Promiseを返したプラグインの本体と、それが保留中の間に登録されたプラグインは、**1 本の直列キュー**を通ります。キューに入った本体は、ひとつ前のPromiseが確定するまで始まりません。そのため、プラグインが入出力を待つ場合でも登録の順序は決まります。同じ名前のコマンドを 2 つのプラグインが登録した場合も、毎回同じ結果に落ち着きます。あとから `use()` したほうが勝ちます。

プラグインが await されるのは次の 3 か所です。

- `cli.exec()` と `cli.execLine()` の開始時
- `cli.start()` の開始時
- 対話シェルで**あらゆる**コマンドを実行する前

3 つ目があるおかげで、セッションの途中で登録されたプラグイン（たとえば先に実行したコマンドが登録したもの）も、次のコマンドが動く前に完全に初期化されます。

### プラグインが失敗した場合

`use()` がその場で実行したプラグインの本体が同期的に例外を投げると、その例外は当の `use()` の呼び出しから投げられたまま伝播するので、呼び出し側で捕まえられ、プラグインを登録した位置も分かります。例外の前にプラグインが登録したものは残り、CLI もそのまま使えます。

非同期のプラグインの本体が失敗すると、その失敗は一度だけ `Error` に包まれます。`code` は `"ERR_PLUGIN_FAILED"`、元の値は `cause`、メッセージは `Plugin initialization failed: <message>` です。この失敗は**残り続けます**。キューに入ったプラグインが例外を投げるか、Promiseが失敗すると、それ以降はこうなります。

- `error` イベントが、包まれたエラーで一度だけ発生します
- 以降の `cli.use()` の呼び出しは、いずれも同じエラーを投げます
- 以降の `cli.exec()` と `cli.execLine()` の呼び出しは、同じエラーで reject します

`cli.start()` の境界では、この失敗は致命的です。エラーが標準エラーストリームに報告され、`exit` イベントが発生し、コマンドは 1 つも実行されません。中途半端に初期化された CLI がディスパッチを行うことはありません。

## プログラムからの実行

コードからコマンドを実行するメソッドは 2 つあります。どちらもコマンドが終わると resolve し、コマンドが失敗するとその失敗で reject します。

`cli.exec(argv, options?)` は文字列の配列を受け取り、そのまま argv として使います。トークン分割もパイプ分割もしないので、`|` は通常の文字です。`[]` は何もせずに resolve します。

```typescript
await cli.exec(["deploy", userInput, "--force"]);
await cli.exec(["note", "add", "a | b"]); // パイプではなく 1 つの引数
```

`cli.execLine(line, options?)` はコマンドラインを文字列で受け取り、プロンプトに入力されたかのように実行します。行は POSIX シェルの単語規則（シングルクォート、ダブルクォート、バックスラッシュ）でトークンに分割され、クォートされていない `|` でパイプラインに分割されます。`""` は何もせずに resolve します。

```typescript
await cli.execLine("deploy prod --force");
await cli.execLine("produce | transform | consume");
```

信頼できないデータは `exec([...])` で渡してください。`execLine` の文字列に埋め込んだ値は、`|` や引用符を含んで別のコマンドを起動させることがあります。行の中の Windows のパスはクォートする（`'C:\Users\me'`）か、配列で渡す必要があります。

型の違う値（`exec` に渡した文字列、`execLine` に渡した文字列以外、文字列でない要素を含む配列）は、`code` が `ERR_INVALID_ARG_TYPE` の `TypeError` で reject します。

アクションの中の `ctx.rawArgv` は、`exec` では配列、`execLine` では `null` です。

### キャンセル

実行を外部からキャンセルする手段は `options.signal` だけです。`cli.exec()` と `cli.execLine()` はプロセスの SIGINT を購読しないので、より大きなプログラムに組み込んでも、そのプログラムの割り込み処理を奪うことはありません。

- すでに abort 済みの signal は、保留中のプラグインの初期化も含めて何かが走る前に、`CancelledError` で reject します。バリデータ、イベントハンドラ、アクション、`onCancel` のコールバックは呼ばれません。
- 実行中にキャンセルされたコマンドは、signal の `reason` を `cause` にした `CancelledError` で reject します。`commandError` も `error` も発生しません。
- abort を無視して正常に終わったコマンドは resolve します。

### `StdioOptions`

| フィールド | 既定値 | 意味 |
|---|---|---|
| `stdin` | `null` | コマンドが読み取る読み取り可能ストリーム |
| `stdout` | `process.stdout` | コマンドが書き込む書き込み可能ストリーム |
| `stderr` | `process.stderr` | 診断出力用の書き込み可能ストリーム |
| `signal` | なし | 実行をキャンセルする `AbortSignal`（[用語集](glossary.md)を参照） |

どのフィールドも省略できます。`CommandContext` もそのまま `StdioOptions` として渡せるので、アクションの中から `cli.exec(argv, ctx)` と書けば、自分のストリームと signal のまま別のコマンドを実行できます。

`cli.exec()` と `cli.execLine()` はシェルを渡さないため、アクションの中では `ctx.shell` が `null` になり、`ctx.shell?.enterMode(...)` は何もしません。どちらも `exit` イベントは発生させません。

### CLI をテストする

CLI のテストは、`stdout` を捕捉した `cli.exec()` で行います。コマンドを登録し、argv を実行し、出力されたテキストを検証します。

```typescript
import { Writable } from "node:stream";
import { createCLI } from "@libraz/node-cli";

function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

const cli = createCLI({ name: "mycli" });

cli
  .command("greet <name>")
  .option("--loud", { description: "Shout the greeting" })
  .action((ctx) => {
    const message = `Hello, ${ctx.args.name}!`;
    ctx.stdout.write(`${ctx.options.loud ? message.toUpperCase() : message}\n`);
  });

const out = captureStream();
await cli.exec(["greet", "Alice", "--loud"], { stdout: out.stream });

// out.text() === "HELLO, ALICE!\n"
```

コマンドが失敗すると `cli.exec()` の返すPromiseも失敗するため、テストではその失敗を検証します。

```typescript
const err = await cli.exec(["greet"]).catch((e: unknown) => e);
// err is a MissingArgumentError with code "MISSING_ARGUMENT"
```

エラークラスについては[エラー](errors.md)を、完成したプログラムについては[サンプル](examples.md)を参照してください。

## 関連ページ

- [コマンド](commands.md) — コマンドの定義と `CommandContext`
- [対話シェル](interactive-shell.md) — パイプ、モード、シェル限定の挙動
- [エラー](errors.md) — エラークラス、キャンセル、終了コード
- [API リファレンス](api-reference.md) — 全シグネチャ

# イベントとプラグイン

イベントを使うと、コマンドに手を入れないまま実行を観察できます。プラグインを使うと、別のモジュールから既存の CLI にコマンドやイベントを登録できます。どちらも `CLI` インスタンスに登録し、どちらもプログラムからの実行の入口である `cli.exec()` から使われます。この `cli.exec()` は、CLI をテストする手段でもあります。

## ライフサイクルイベント

`CLIEventMap` は 5 つのイベントを定義しています。

| イベント | ハンドラのシグネチャ | 発生するタイミング |
|---|---|---|
| `beforeExecute` | `(ctx) => void \| Promise<void>` | オプションの解決とコマンドの `validate` のあと、アクションの直前 |
| `afterExecute` | `(ctx) => void \| Promise<void>` | アクションが成功して解決したときだけ |
| `commandError` | `(error, ctx) => void \| Promise<void>` | 解決済みのコマンドが失敗したとき |
| `error` | `(error) => void \| Promise<void>` | あらゆる失敗。コマンドが解決される前の失敗も含みます |
| `exit` | `() => void \| Promise<void>` | `cli.start()` が終わったとき、または強制終了や SIGTERM でプロセスが終わるときに一度だけ |

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

手順 1 から手順 5 のどこかで失敗すると、`afterExecute` は飛ばされます。

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

`error` は**あらゆる**失敗で発生します。コマンドが解決される前に起きたものも含みます。

- 引用符の対応が取れていないなど、解析の失敗
- 認識できないコマンド
- `catch` ハンドラが投げた例外
- `cancel` ハンドラのプロミスの失敗
- 別のイベントハンドラが投げた例外

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

パイプのステージが想定内のキャンセルで止まった場合、どちらのイベントも発生しません。下流のステージが終わったために早めに止まったステージや、パイプライン全体の主たる失敗によって破棄された兄弟ステージがこれにあたります。報告されるのは主たる失敗だけです。パイプの挙動については[対話シェル](interactive-shell.md)を参照してください。

### `exit` イベント

`exit` は CLI ごとに多くても一度だけ、次の経路で発生します。

- 直接実行モードのコマンドが完了・例外・強制終了のいずれかで終わったとき
- 引数リストが空、あるいは端末以外での起動によりヘルプ一覧が表示されたとき
- プラグインの初期化が失敗したとき
- 対話シェルが終了したとき、または SIGTERM を受け取ったとき
- 強制終了（Ctrl+C を 2 回）したとき

通常の `cli.exec()` の経路では**発生しない**ことに注意してください。`cli.exec()` の実行中に強制終了した場合だけは、プロセスが終わるため発生します。

CLI が処理しないシグナルを受けると、プロセスは Node の既定の動作で終わるため、`exit` ハンドラもキャンセルハンドラも実行されません。直接実行モードの SIGTERM と SIGHUP、対話シェルの SIGHUP がこれにあたります。

```typescript
import { writeFile } from "node:fs/promises";

cli.on("exit", async () => {
  await writeFile("/tmp/mycli-session.log", "session ended\n", { flag: "a" });
});
```

強制終了のときとシェルが SIGTERM で終了処理をするときは、`exit` ハンドラ全体で 2000 ms が与えられます。それまでに終わらなかったハンドラが終了処理を遅らせることはありません。

## `catch` フォールバック

`cli.catch(handler)` は、どのコマンドにも一致しない入力を、`CommandNotFoundError` を投げる代わりに処理します。

```typescript
cli.catch((input, { stdout }) => {
  stdout.write(`Unknown command: ${input}\nType "help" to list commands.\n`);
});
```

押さえておきたい性質が 3 つあります。

- **ハンドラは 1 つだけです。** あとから `catch()` を呼ぶと、前のハンドラを置き換えます。
- **コンテキストは最小限です。** `CatchContext` はちょうど `{ stdout, stderr }` だけで、コマンドが解決されていないため `args` も `signal` も `shell` もありません。
- **解析できない入力も届きます。** トークン分割やパイプステージへの分割に失敗した入力は、`ParseError` を投げる代わりにハンドラへ渡されます。

`catch` ハンドラがない場合、認識できない入力は `CommandNotFoundError` を投げます。[エラー](errors.md)を参照してください。

## プラグイン

プラグインは、コンテキストを受け取ってそこに登録を行う関数です。

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>;
```

### `PluginContext`

`PluginContext` はちょうど 4 つのメソッドです。

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder;
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): void;
}
```

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

プラグインの本体は**1 本の直列キュー**を通ります。2 つ目のプラグインの本体は、1 つ目のプロミスが確定するまで始まりません。そのため、プラグインが入出力を待つ場合でも登録の順序は決まります。同じ名前のコマンドを 2 つのプラグインが登録した場合も、毎回同じ結果に落ち着きます。あとから `use()` したほうが勝ちます。

プラグインが await されるのは次の 3 か所です。

- `cli.exec()` の開始時
- `cli.start()` の開始時
- 対話シェルで**あらゆる**コマンドを実行する前

3 つ目があるおかげで、セッションの途中で登録されたプラグイン（たとえば先に実行したコマンドが登録したもの）も、次のコマンドが動く前に完全に初期化されます。

### プラグインが失敗した場合

プラグインの失敗は**後を引く**性質を持ちます。プラグインが例外を投げるか、プロミスが失敗すると、それ以降はこうなります。

- 以降の `cli.use()` の呼び出しは、いずれも同じエラーを投げ直します
- 以降の `cli.exec()` の呼び出しも、同じエラーを投げ直します

`cli.start()` の境界では、この失敗は致命的です。エラーが標準エラーストリームに報告され、`exit` イベントが発生し、コマンドは 1 つも実行されません。中途半端に初期化された CLI がディスパッチを行うことはありません。

## プログラムからの実行

`cli.exec(input, options?)` は、コマンド文字列を、あたかも入力されたかのように実行します。

```typescript
await cli.exec("deploy prod --force");
```

入力が文字列なので、シェルの入力と同じようにパイプステージへ分割されます。

```typescript
await cli.exec("produce | transform | consume");
```

### `ExecOptions`

| フィールド | 既定値 | 意味 |
|---|---|---|
| `stdin` | `null` | コマンドが読み取る読み取り可能ストリーム |
| `stdout` | `process.stdout` | コマンドが書き込む書き込み可能ストリーム |
| `stderr` | `process.stderr` | 診断出力用の書き込み可能ストリーム |
| `signal` | なし | 実行をキャンセルする `AbortSignal`（[用語集](glossary.md)を参照） |

`cli.exec()` はシェルを渡さないため、アクションの中では `ctx.shell` が `null` になり、`ctx.shell?.enterMode(...)` は何もしません。通常の経路では `exit` イベントも発生しません。

### CLI をテストする

CLI のテストは、`stdout` を捕捉した `cli.exec()` で行います。コマンドを登録し、1 行を実行し、出力されたテキストを検証します。

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
    const message = `Hello, ${String(ctx.args.name)}!`;
    ctx.stdout.write(`${ctx.options.loud ? message.toUpperCase() : message}\n`);
  });

const out = captureStream();
await cli.exec("greet Alice --loud", { stdout: out.stream });

// out.text() === "HELLO, ALICE!\n"
```

コマンドが失敗すると `cli.exec()` の返すプロミスも失敗するため、テストではその失敗を検証します。

```typescript
const err = await cli.exec("greet").catch((e: unknown) => e);
// err is a MissingArgumentError with code "MISSING_ARGUMENT"
```

エラークラスについては[エラー](errors.md)を、完成したプログラムについては[サンプル](examples.md)を参照してください。

## 関連ページ

- [コマンド](commands.md) — コマンドの定義と `CommandContext`
- [対話シェル](interactive-shell.md) — パイプ、モード、シェル限定の挙動
- [エラー](errors.md) — エラークラス、キャンセル、終了コード
- [API リファレンス](api-reference.md) — 全シグネチャ

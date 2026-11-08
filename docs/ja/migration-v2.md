# 1.x からの移行

バージョン 2.0.0 では、公開面の名前、シグネチャ、既定の挙動が変わります。旧い形は deprecated の alias を残さずに削除しています。以下の各節に、1.x のコードと置き換え後のコードを載せます。1〜19 が破壊的変更です。末尾のノートでは、テストやスクリプトを移すときに押さえる挙動を扱います。

多くの変更は TypeScript がコンパイル時に報告します。実行時にだけ現れる変更は 7、8、10、11、16、18、19 です。

### 1. 入口

CLI を作る方法は `createCLI()` だけです。`CLI` と `CommandBuilder` は型としてだけエクスポートされます。`logger()` は `createLogger()` になります。

```typescript
// before
import { CLI, logger } from "@libraz/node-cli";

const cli = new CLI({ name: "app" });
const log = logger({ prefix: "app" });
```

```typescript
// after
import { createCLI, createLogger } from "@libraz/node-cli";
import type { CLI } from "@libraz/node-cli";

const cli: CLI = createCLI({ name: "app" });
const log = createLogger({ prefix: "app" });
```

### 2. 設定は `createCLI` に移る

セッターの `prompt`、`description`、`banner`、`history`、`historySize`、`historyFilter` は削除されました。同じ値を `CLIOptions` で渡します。履歴ファイルのオプション名は `historyFile` です。`historySize`、`historyFilter`、`historyFile` は CLI の作成時に検証するので、不正な値はシェルの起動時ではなく、その場で throw されます。`historyFile` が `~` のみ、または `~/` で始まる場合は、ホームディレクトリに展開されます。シェルの実行中にプロンプトを変えるには `ctx.shell?.setPrompt()` を呼びます。

```typescript
// before
const cli = new CLI({ name: "app" })
  .prompt("app> ")
  .description("Deploy tool")
  .banner("Welcome")
  .history("/tmp/app.history")
  .historySize(500)
  .historyFilter((line) => (line.startsWith("login ") ? null : line));
```

```typescript
// after
const cli = createCLI({
  name: "app",
  prompt: "app> ",
  description: "Deploy tool",
  banner: "Welcome",
  historyFile: "/tmp/app.history",
  historySize: 500,
  historyFilter: (line) => (line.startsWith("login ") ? null : line),
});
```

### 3. builder の改名と completer のシグネチャ

`.complete()` は `.completer()`、`.cancel()` は `.onCancel()`、`OptionSchema.autocomplete` は `OptionSchema.completer` になります。completer 関数は、現在の単語ではなく `CompletionContext` を受け取ります。単語は `ctx.current` から読みます。

```typescript
// before
cli
  .command("open [name]")
  .option("--env <env>", { autocomplete: (current) => ["dev", "prod"].filter((e) => e.startsWith(current)) })
  .complete((current) => ["alpha", "beta"].filter((n) => n.startsWith(current)))
  .cancel((ctx) => ctx.stderr.write("cancelled\n"))
  .action(() => {});
```

```typescript
// after
cli
  .command("open [name]")
  .option("--env <env>", { completer: (ctx) => ["dev", "prod"].filter((e) => e.startsWith(ctx.current)) })
  .completer((ctx) => ["alpha", "beta"].filter((n) => n.startsWith(ctx.current)))
  .onCancel((ctx) => ctx.stderr.write("cancelled\n"))
  .action(() => {});
```

### 4. `catch` は `fallback` になる

`cli.catch()` は `cli.fallback()`、`PluginContext.catch` は `PluginContext.fallback` になります。`CatchContext` は `FallbackContext` に変わり、`stdin` と `signal` も持ちます。

```typescript
// before
import type { CatchContext } from "@libraz/node-cli";

cli.catch((input: string, ctx: CatchContext) => {
  ctx.stderr.write(`Unknown command: ${input}\n`);
});
```

```typescript
// after
import type { FallbackContext } from "@libraz/node-cli";

cli.fallback((input: string, ctx: FallbackContext) => {
  ctx.stderr.write(`Unknown command: ${input}\n`);
});
```

### 5. mode の completer は配列を返す

mode の completer は `CompletionContext` を受け取り、`readonly string[]` を返します。ほかの completer と同じ形です。readline のタプルと `CompletionResult` は削除されました。ライブラリは候補を絞り込まないので、`ctx.current` で絞り込みます。

```typescript
// before
ctx.shell.enterMode({
  prompt: "sql> ",
  completer: (line) => {
    const word = line.split(" ").pop() ?? "";
    return [["select", "insert"].filter((k) => k.startsWith(word)), word];
  },
  action: () => {},
});
```

```typescript
// after
ctx.shell.enterMode({
  prompt: "sql> ",
  completer: (ctx) => ["select", "insert"].filter((k) => k.startsWith(ctx.current)),
  action: () => {},
});
```

### 6. `ModeConfig.message` は `banner` になる

```typescript
// before
ctx.shell.enterMode({ prompt: "calc> ", message: "Calculator mode", action });
```

```typescript
// after
ctx.shell.enterMode({ prompt: "calc> ", banner: "Calculator mode", action });
```

### 7. `start()` は終了コードで resolve する

`start()` は `Promise<number>` を返します。`process.exitCode` は従来どおり設定され、対話シェルを開く条件も変わりません。

```typescript
// before
await cli.start();
```

```typescript
// after
const code = await cli.start();
process.exitCode = code;
```

### 8. `use()` は同期 plugin のエラーをその場で投げる

同期の plugin は `use()` の中で実行され、throw されたエラーは `use()` の呼び出し元に届きます。throw より前に行った登録は残ります。非同期の plugin、および保留中の非同期 plugin の後ろに登録した plugin は、従来どおりキューに積まれ、その失敗は `start()` から報告されます。

```typescript
// before
cli.use(() => {
  throw new Error("bad plugin");
}); // ここではエラーにならず、start() が後で報告した
```

```typescript
// after
try {
  cli.use(() => {
    throw new Error("bad plugin");
  });
} catch (err) {
  // use() 自身が投げる
}
```

### 9. エラーのコンストラクタとヘルパー

すべてのエラーのコンストラクタは options オブジェクトを受け取り、`cause` は `Error` に渡されます。`code` と `exitCode` は `readonly` です。`CLIError.code` の型は `CLIErrorCode | (string & {})` なので、組み込みのサブクラスのフィールドを読むには、`isBuiltinCLIError()` で絞り込んでから `code` で分岐します。`isCancellationError()` には signal が必須になり、`formatErrorMessage()` は signal を受け取りません。余分な引数が複数ある場合は、1 つの `ExtraArgumentError` にまとめて報告され、`extras` に並びます。

```typescript
// before
class DeployError extends CLIError {
  constructor(message: string) {
    super(message, "DEPLOY_FAILED", 3);
  }
}

if (isCancellationError(err)) return;
const text = formatErrorMessage(err, signal);
throw new ValidationError("bad value", cause, { optionName: "port" });
```

```typescript
// after
class DeployError extends CLIError {
  constructor(message: string) {
    super(message, { code: "DEPLOY_FAILED", exitCode: 3 });
  }
}

if (isCancellationError(err, signal)) return;
const text = formatErrorMessage(err);
throw new ValidationError("bad value", { optionName: "port", cause });

if (isBuiltinCLIError(err)) {
  switch (err.code) {
    case "UNKNOWN_OPTION":
      console.error(err.optionName);
      break;
    case "EXTRA_ARGUMENT":
      console.error(err.extras.join(", "));
      break;
  }
}
```

### 10. プログラマの誤用は code 付きのエラーになる

不正な引数や不正な定義は `TypeError`、`RangeError`、`Error` のいずれかで throw され、`UsageErrorCode` 型の `code` が付きます。値は `ERR_INVALID_ARG_TYPE`、`ERR_INVALID_ARG_VALUE`、`ERR_INVALID_DEFINITION`、`ERR_DEFINITION_CONFLICT`、`ERR_COMMAND_REMOVED`、`ERR_ALREADY_STARTED`、`ERR_OUTPUT_BUSY`、`ERR_INPUT_BUSY` です。メッセージや `instanceof Error` だけで判定していたコードは、`code` かより具体的なクラスで判定します。これらは `CLIError` ではありません。ユーザー入力の誤りではなく、プログラムの欠陥を知らせるものです。

```typescript
// before
try {
  createLogger({ level: "verbose" as never });
} catch (err) {
  if (err instanceof Error && /level/.test(err.message)) fallbackLevel();
}
```

```typescript
// after
try {
  createLogger({ level: "verbose" as never });
} catch (err) {
  if (err instanceof RangeError && (err as RangeError & { code?: string }).code === "ERR_INVALID_ARG_VALUE") {
    fallbackLevel();
  }
}
```

### 11. placeholder は `type` と一致させる

flags に `<number>` または `<boolean>` の placeholder を書いたオプションには、一致する `type` が必要です。`type` が無い場合や矛盾する場合は、定義の時点で `ERR_INVALID_DEFINITION` を throw します。

```typescript
// before
cli.command("serve").option("--port <number>").action(() => {});
```

```typescript
// after
cli.command("serve").option("--port <number>", { type: "number" }).action(() => {});
// または placeholder の名前を変える
cli.command("serve").option("--port <n>", { type: "number" }).action(() => {});
```

### 12. ctx のメンバーは readonly になる

`CommandContext` のメンバーはすべて `readonly` です。配列も `readonly string[]` になります。`rawArgv` は `readonly string[] | null` で、文字列入力では `null`、配列入力ではその配列です。`ctx.args` と `ctx.options` は、literal の定義文字列とオプションのスキーマから型が付くので、`ctx.args.env as string` のような cast は不要です。

```typescript
// before
if (ctx.rawArgv !== undefined) run(ctx.rawArgv);
ctx.args.env = "prod";
const env = ctx.args.env as string;
```

```typescript
// after
if (ctx.rawArgv !== null) run(ctx.rawArgv);
const env: string = ctx.args.env; // 定義 "deploy <env>" から推論される
```

### 13. ルートから削除された名前

`stripOptionPrefix`、`splitPipes`、`activePipeSegment`、`maskInput`、`restoreCursor`、トップレベルの `releaseAll`、`resetColorEnabled`、`CompletionResult`、`TableStyle`、`CatchContext`、`PromptBaseOptions`、`ExecOptions` はエクスポートされなくなりました。`exec()` のオプションには `StdioOptions`、prompt のオプションには `PromptOptions`、fallback ハンドラの ctx には `FallbackContext` を使います。色の判定を戻すには `setColorEnabled("auto")`、端末の状態を解放するには `progress.releaseAll()` を使います。`tokenize` は残ります。

```typescript
// before
import { releaseAll, resetColorEnabled, type ExecOptions } from "@libraz/node-cli";

releaseAll();
resetColorEnabled();
const opts: ExecOptions = { stdin };
```

```typescript
// after
import { progress, setColorEnabled, type StdioOptions } from "@libraz/node-cli";

progress.releaseAll();
setColorEnabled("auto");
const opts: StdioOptions = { stdin };
```

### 14. 色

`color.<name>` が受け付けるのは 23 個の `StyleName` だけです。未知の名前は型エラーになり、実行時には有効な名前を並べた `RangeError` になります。動的な名前は `isStyleName()` で確かめます。`setColorEnabled()` は `boolean | "auto"` を受け取ります。stream を取る引数はすべて `Writable` です。`sanitizeTerminalText()` は、開いたままの style を閉じて返します。`createTemplateTag(stream)` が追加され、`c` はそれを `process.stdout` に束縛したものです。

```typescript
// before
const text = color[userInput]("hello"); // 未知の名前は実行時に throw された
resetColorEnabled();
```

```typescript
// after
import { color, isStyleName, setColorEnabled } from "@libraz/node-cli";

const text = isStyleName(userInput) ? color[userInput]("hello") : "hello";
setColorEnabled("auto");
```

### 15. prompt

prompt は stderr に質問を出し、stdin から読みます。ctx をそのまま渡せます。`stdout` オプションは削除されたので、`stderr` を使います。stdout に出すには `{ stderr: process.stdout }` を渡します。`prefix` は `marker` になります。`required` は `text()` と `password()` にだけあります。

```typescript
// before
const name = await prompt.text("Name?", { stdout: ctx.stdout, prefix: ">" });
```

```typescript
// after
const name = await prompt.text("Name?", { ...ctx, marker: ">" });
// stdout に出し続ける場合
const same = await prompt.text("Name?", { stderr: process.stdout });
```

### 16. progress

`Bar`、`Spinner`、`MultiBar` は、`succeed()`、`fail()`、`warn()`、`stop()` を共通で持ちます。`finish()` は削除され、`succeed()` に置き換わります。`stop()` は最後のフレームを残して改行します。行は消さず、`Spinner` も同様です。描画は生成した時点で始まるので、`Spinner.start()` は削除されました。ほかのインジケータが使っている出力先に生成すると、その場で `ERR_OUTPUT_BUSY` を throw します。そのほかの変更は次のとおりです。

- `Spinner.update()` は `setLabel()`、`SpinnerOptions.interval` は `intervalMs` になります。
- `BarState` のフィールドは `current`、`total`、`percent`、`elapsedMs`、`etaMs`、`ratePerSecond` です。
- `progress.multi({ stream })` で出力先を指定します。`add()` は `stream` を受け取りません。
- 未知の `color` は、生成した時点で throw されます。
- `total` が負、`NaN`、Infinity の場合は、bar の生成時に `RangeError` になります。1.x では 0 として扱っていました。
- 非 TTY の stream でも、bar と multi-bar の `succeed()`、`fail()`、`warn()` は結果を 1 行書きます。

```typescript
// before
const spinner = progress.spinner({ label: "Build", interval: 80 });
spinner.start();
spinner.update("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10 });
bar.update(10);
bar.finish();
const { elapsed, eta, rate } = state;
const multi = progress.multi();
multi.add({ total: 5, stream: process.stderr });
```

```typescript
// after
const spinner = progress.spinner({ label: "Build", intervalMs: 80 });
spinner.setLabel("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10 });
bar.update(10);
bar.succeed();
const { elapsedMs, etaMs, ratePerSecond } = state;
const multi = progress.multi({ stream: process.stderr });
multi.add({ total: 5 });
```

### 17. table

列ごとの設定は `columns` にまとまります。色と余白は平らなキーになり、`TableChars` のキーは camelCase になります。

| 1.x | 2.0.0 |
| --- | --- |
| `style.head`、`headerStyle` | `headerStyle` |
| `style.border` | `borderColor` |
| `style["padding-left"]`、`style["padding-right"]` | `paddingLeft`、`paddingRight` |
| `padding` | `gap` |
| `style.compact: false` | `rowSeparators: true` |
| `truncate` | `ellipsis` |
| `align[key]`、`colAligns[i]` | `ColumnSpec.align` |
| `colWidths[i]` | `ColumnSpec.width` |
| `maxWidth[key]` | `ColumnSpec.maxWidth` |
| `headerLabels[key]` | `ColumnSpec.label` |

`TableChars` のキーは、`top-left`、`top-mid`、`top-right`、`bottom-left`、`bottom-mid`、`bottom-right`、`left-mid`、`right-mid` がそれぞれ `topLeft`、`topMid`、`topRight`、`bottomLeft`、`bottomMid`、`bottomRight`、`leftMid`、`rightMid` になります。`mid` は `horizontal`、`mid-mid` は `cross`、`middle` は `vertical` です。未知の style 名や border 名、不正な幅は throw されます。

```typescript
// before
table(rows, {
  headerLabels: { name: "Name" },
  colWidths: [12, 8],
  align: { size: "right" },
  maxWidth: { name: 20 },
  truncate: "..",
  style: { head: "cyan", border: "dim", compact: false, "padding-left": 2 },
});
```

```typescript
// after
table(rows, {
  columns: [
    { key: "name", label: "Name", width: 12, maxWidth: 20 },
    { key: "size", width: 8, align: "right" },
  ],
  ellipsis: "..",
  headerStyle: "cyan",
  borderColor: "dim",
  rowSeparators: true,
  paddingLeft: 2,
});
```

### 18. `truncateAnsi` は幅を検証する

`truncateAnsi(text, width, ellipsis?)` は、`width` が 0 以下、`NaN`、`-Infinity`、小数のとき `RangeError` を throw します。1.x は空文字列を返していました。`Infinity` は制限なしを表します。

```typescript
// before
truncateAnsi(text, process.stdout.columns - 10); // 狭い端末では ""
```

```typescript
// after
const width = Math.max(1, process.stdout.columns - 10);
truncateAnsi(text, width);
```

### 19. ctx を渡した prompt は ctx の stdin を読む

ctx を渡した prompt は `ctx.stdin` を読みます。それが `null` の場合（`stdin` オプション無しの `exec()` や、対話シェルの中）は `process.stdin` を読みます。テストでは stream を明示的に渡します。

```typescript
// before
await cli.exec("greet");
```

```typescript
// after
import { PassThrough } from "node:stream";

const stdin = new PassThrough();
stdin.end("Ada\n");
await cli.exec("greet", { stdin });
```

## ノート

### キャンセル

プロセス全体の `error` イベントのハンドラは signal を受け取りません。prompt のキャンセルは `err instanceof PromptCancelError` で判定します。コマンドの `ctx.signal` が手元にある場所では `isCancellationError(err, signal)` を使います。

```typescript
cli.on("error", (err) => {
  if (err instanceof PromptCancelError) return;
  console.error(err.message);
});
```

### テストでの終了コード

`start()` は `process.exitCode` を設定します。テストで呼んだ場合は元の値に戻します。戻さないと、テストランナーがコマンドの終了コードで終了します。

```typescript
const saved = process.exitCode;
try {
  const code = await cli.start(["deploy", "prod"]);
  expect(code).toBe(0);
} finally {
  process.exitCode = saved;
}
```

### prompt は stderr に書く

`app 2>log` のようにシェルでリダイレクトすると、質問が見えなくなります。stdout に出すには `{ stderr: process.stdout }` を渡します。

### prompt の前にインジケータを終える

prompt と progress のインジケータは stderr を共有します。質問の前に、bar や spinner の `succeed()`、`fail()`、`warn()`、`stop()` のいずれかを呼びます。呼ばないと、質問の行がインジケータのフレームに割り込みます。

```typescript
const spinner = progress.spinner({ label: "Checking" });
await check();
spinner.stop();
const ok = await prompt.confirm("Continue?", ctx);
```

### prompt を使うテストでは `exec()` に stdin を渡す

`prompt.*(..., ctx)` を呼ぶコマンドをテストするとき、`exec()` に `stdin` を渡さないと `process.stdin` を待って止まります。必ず渡します。

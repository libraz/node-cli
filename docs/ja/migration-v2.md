# 1.x からの移行

バージョン 2.0.0 では、公開面の名前、シグネチャ、既定の挙動が変わります。旧い形は非推奨の別名を残さずに削除しています。以下の各節に、1.x のコードと置き換え後のコードを載せます。1〜25 が破壊的変更です。末尾のノートでは、テストやスクリプトを移すときに押さえる挙動を扱います。

多くの変更は TypeScript がコンパイル時に報告します。実行時にだけ現れる変更は 1、7、8、9（終了コード）、10、11、16、18、19、20〜25 です。

### 1. 入口

CLI を作る方法は `createCLI(options)` だけで、`name` は必須です。名前に使えるのは英数字と `.`、`_`、`-` で、先頭は英数字にします。名前は履歴ファイル `~/.<name>_history` と help の見出しに使われます。`CLI` と `CommandBuilder` は型としてだけエクスポートされます。`logger()` は `createLogger()` になります。

`cli.exec()` が受け取るのは引数の配列だけです。クォートや `|` によるパイプを含む 1 行の文字列は `cli.execLine()` に渡します。`exec()` に文字列を、`execLine()` に文字列以外を渡すと `TypeError` を送出します。

```typescript
// before
import { CLI, logger } from "@libraz/node-cli";

const cli = new CLI({ version: "1.0.0" }); // name の既定値は "cli" だった
const log = logger({ prefix: "app" });
await cli.exec("greet Ada | upper");
await cli.exec(["greet", "Ada"]);
```

```typescript
// after
import { createCLI, createLogger } from "@libraz/node-cli";
import type { CLI } from "@libraz/node-cli";

const cli: CLI = createCLI({ name: "app", version: "1.0.0" });
const log = createLogger({ prefix: "app" });
await cli.execLine("greet Ada | upper");
await cli.exec(["greet", "Ada"]);
```

### 2. 設定は `createCLI` に移る

セッターの `prompt`、`description`、`banner`、`history`、`historySize`、`historyFilter` は削除されました。同じ値を `CLIOptions` で渡します。履歴ファイルのオプション名は `historyFile` です。`historySize`、`historyFilter`、`historyFile` は CLI の作成時に検証するので、不正な値はシェルの起動時ではなく、その場で例外が送出されます。`historyFile` が `~` のみ、または `~/` で始まる場合は、ホームディレクトリに展開されます。シェルの実行中にプロンプトを変えるには `ctx.shell?.setPrompt()` を呼びます。

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

`cli.catch()` は `cli.fallback()`、`PluginContext.catch` は `PluginContext.fallback` になります。`CatchContext` は `FallbackContext` に変わり、`stdin`、`signal`、`rawArgv` も持ちます。`rawArgv` は、配列で呼ばれたときはその引数全体、1 行の文字列のときは `null` です。

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

モードの completer は `CompletionContext` を受け取り、`readonly string[]` を返します。ほかの completer と同じ形です。readline のタプルと `CompletionResult` は削除されました。ライブラリが `ctx.current` で始まる候補だけを残すので、全候補を返します。静的な `readonly string[]` も渡せます。

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
  completer: ["select", "insert"],
  action: () => {},
});
```

### 6. mode の `message` は `banner` になる

`enterMode()` に渡すオプションの型は `ModeOptions`（1.x では `ModeConfig`）、ハンドラの型は `ModeAction` です。

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

同期のプラグインは `use()` の中で実行され、送出されたエラーは `use()` の呼び出し元に届きます。送出より前に行った登録は残ります。非同期のプラグイン、および保留中の非同期プラグインの後ろに登録したプラグインは、従来どおりキューに積まれ、その失敗は後から報告されます。報告されるのは、`code: "ERR_PLUGIN_FAILED"` を持ち、元の値を `cause` に入れた `Error` に一度だけ包んだものです。以後の `use()` はそれを投げ、`exec()` と `execLine()` はそれで reject され、`start()` はそれを報告して 1 を返します。

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

### 9. エラーのコンストラクタ、code、終了コード

すべてのエラーのコンストラクタは options オブジェクトを受け取り、`cause` は `Error` に渡されます。`new CLIError(message, { code?, exitCode?, cause? })` では、`code` の既定値が `"FAILED"`、`exitCode` の既定値が 1 です。`exitCode` は 1〜255 の整数にします。`code` と `exitCode` は `readonly` です。`CLIError.code` の型は `CLIErrorCode | (string & {})` なので、組み込みのサブクラスのフィールドを読むには、`isBuiltinCLIError()` で絞り込んでから `code` で分岐します。`isCancellationError()` には signal が必須になり、`formatErrorMessage()` は signal を受け取らず、端末向けに無害化した、複数行になりうるテキストを返します。余分な引数が複数ある場合は、1 つの `ExtraArgumentError` にまとめて報告され、`extras`（1.x では `extra`）に並びます。

code の名前は状態を表します。`VALIDATION_ERROR` は `VALIDATION_FAILED`、`PARSE_ERROR` は `PARSE_FAILED`、`PROMPT_CANCELLED` は `CANCELLED` になり、`PromptCancelError` は `CancelledError` になります。`InputEndedError`（`INPUT_ENDED`）が加わります。

ユーザーの入力が原因のエラーは終了コード 64 で終了します（1.x では 1）。対象は `CommandNotFoundError`、`MissingArgumentError`、`ExtraArgumentError`、`MissingOptionError`、`InvalidOptionError`、`UnknownOptionError`、`ValidationError`、`ParseError` です。`InputEndedError` は 66、`CancelledError` は 130 で終了し、アクションが投げたそのほかのエラーは 1 です。終了コード 1 を判定しているラッパースクリプトは直します。

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
if (err instanceof PromptCancelError || err.code === "PROMPT_CANCELLED") return;
if (err.code === "VALIDATION_ERROR") report(err.optionName);
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
if (err instanceof CancelledError) return;

if (isBuiltinCLIError(err)) {
  switch (err.code) {
    case "UNKNOWN_OPTION":
      console.error(err.optionName);
      break;
    case "EXTRA_ARGUMENT":
      console.error(err.extras.join(", "));
      break;
    case "VALIDATION_FAILED":
      report(err.optionName);
      break;
  }
}
```

### 10. プログラマの誤用は code 付きのエラーになる

不正な引数や不正な定義は `TypeError`、`RangeError`、`Error` のいずれかで送出され、`UsageErrorCode` 型の `code` が付きます。値は `ERR_INVALID_ARG_TYPE`、`ERR_INVALID_ARG_VALUE`、`ERR_INVALID_DEFINITION`、`ERR_DEFINITION_CONFLICT`、`ERR_COMMAND_REMOVED`、`ERR_ALREADY_STARTED`、`ERR_OUTPUT_BUSY`、`ERR_INPUT_BUSY` です。メッセージや `instanceof Error` だけで判定していたコードは、`code` かより具体的なクラスで判定します。これらは `CLIError` ではありません。ユーザー入力の誤りではなく、プログラムの欠陥を知らせるものです。

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

`CommandContext` のメンバーはすべて `readonly` です。配列も `readonly string[]` になります。`rawArgv` は `readonly string[] | null` で、文字列入力（`execLine()`）では `null`、配列入力ではその配列です。`ctx.args` と `ctx.options` は、リテラルの定義文字列とオプションのスキーマから型が付くので、`ctx.args.env as string` のような型アサーションは不要です。

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

### 13. ルートから削除・改名された名前

`stripOptionPrefix`、`splitPipes`、`activePipeSegment`、`maskInput`、`restoreCursor`、トップレベルの `releaseAll`、`resetColorEnabled`、`CompletionResult`、`TableStyle`、`CatchContext`、`PromptBaseOptions`、`ExecOptions` はエクスポートされなくなりました。`exec()` のオプションには `StdioOptions`、プロンプトのオプションには `PromptOptions`、fallback ハンドラの ctx には `FallbackContext` を使います。色の判定を戻すには `setColorEnabled("auto")`、端末の状態を解放するには `progress.releaseAll()` を使います。`streamIsTTY` は、任意の値を受け取る `isTTY` になります。`ModeConfig` は `ModeOptions` になります。`tokenize` は残ります。

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

`color.<name>` が受け付けるのは 23 個の `StyleName` だけです。未知の名前は型エラーになり、実行時には有効な名前を並べた `RangeError` になります。動的な名前は `isStyleName()` で確かめます。`setColorEnabled()` は `boolean | "auto"` を受け取ります。ストリームを取る引数はすべて `Writable` です。`sanitizeTerminalText()` は、開いたままのスタイルを閉じて返します。`colorTag` は `process.stdout` に束縛したテンプレートタグで、`createColorTag(ストリーム)` は任意のストリームに束縛したタグを作ります。どちらも新規です。`NO_COLOR` と `setColorEnabled(false)` は、bold などの修飾も含めてすべてのスタイルを止めます。

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

プロンプトは stderr に質問を出し、stdin から読みます。ctx をそのまま渡せます。`stdout` オプションは削除されたので、`stderr` を使います。stdout に出すには `{ stderr: process.stdout }` を渡します。`prefix` は `marker` になります。`required` は `text()` と `password()` にだけあります。message と marker は 1 行で描かれます。改行は空白になり、カーソル制御は取り除かれます。

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

`Bar`、`Spinner`、`MultiBar` は、`succeed()`、`fail()`、`warn()`、`stop()` を共通で持ちます。`finish()` は削除され、`succeed()` に置き換わります。`stop()` は最後のフレームを残して改行します。行は消さず、`Spinner` も同様です。描画は生成した時点で始まるので、`Spinner.start()` は削除されました。ほかのインジケーターが使っている出力先に生成すると、その場で `ERR_OUTPUT_BUSY` を送出します。そのほかの変更は次のとおりです。

- `bar`、`spinner`、`multi`、`createLogger` の出力先のオプションは `stderr`（1.x では `stream`）です。`CommandContext` と同じ名前なので、`progress.spinner({ ...ctx, label })` と書けます。`MultiBar.add()` は出力先のオプションを受け取りません。
- `bar` と `spinner` の色のオプションは `style`（1.x では `color`）です。未知のスタイルは、生成した時点で例外が送出されます。
- `Spinner.update()` は `setLabel()` になり、`Bar` にも `setLabel()` があります。`SpinnerOptions.interval` は `intervalMs` です。
- `BarState` のフィールドは `current`、`total`、`percent`、`elapsedMs`、`etaMs`、`ratePerSecond` で、すべて `readonly` です。
- `total` が負、`NaN`、Infinity の場合は、bar の生成時に `RangeError` になります。1.x では 0 として扱っていました。
- `filled` と `empty` は 1 桁幅にします。
- 非 TTY のストリームでも、bar と multi-bar の `succeed()`、`fail()`、`warn()` は結果を 1 行書きます。`TERM=dumb` は非 TTY と同じ扱いです。
- コマンドの実行中に作ったインジケーターは、そのコマンドの終了時に解放されます。並行して動く別のコマンドのインジケーターは残ります。プロセス内のすべてを解放するには、従来どおり `progress.releaseAll()` を呼びます。

```typescript
// before
const spinner = progress.spinner({ label: "Build", interval: 80, color: "cyan", stream: ctx.stderr });
spinner.start();
spinner.update("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10, color: "green" });
bar.update(10);
bar.finish();
const { elapsed, eta, rate } = state;
const multi = progress.multi();
multi.add({ total: 5, stream: process.stderr });
```

```typescript
// after
const spinner = progress.spinner({ label: "Build", intervalMs: 80, style: "cyan", stderr: ctx.stderr });
spinner.setLabel("Linking");
spinner.succeed("Done");

const bar = progress.bar({ total: 10, style: "green" });
bar.update(10);
bar.succeed();
const { elapsedMs, etaMs, ratePerSecond } = state;
const multi = progress.multi({ stderr: process.stderr });
multi.add({ total: 5 });
```

### 17. table

列ごとの設定は `columns` にまとまります。色のスタイルと余白は平らなキーになり、`TableChars` のキーは camelCase になります。

| 1.x | 2.0.0 |
| --- | --- |
| `style.head`、`headerStyle` | `headerStyle` |
| `style.border` | `borderStyle` |
| `style["padding-left"]`、`style["padding-right"]` | `paddingLeft`、`paddingRight` |
| `padding` | `gap` |
| `style.compact: false` | `rowSeparators: true` |
| `truncate` | `ellipsis` |
| `align[key]`、`colAligns[i]` | `ColumnSpec.align` |
| `colWidths[i]` | `ColumnSpec.width` |
| `maxWidth[key]` | `ColumnSpec.maxWidth` |
| `headerLabels[key]` | `ColumnSpec.label` |

`TableChars` のキーは、`top-left`、`top-mid`、`top-right`、`bottom-left`、`bottom-mid`、`bottom-right`、`left-mid`、`right-mid` がそれぞれ `topLeft`、`topMid`、`topRight`、`bottomLeft`、`bottomMid`、`bottomRight`、`leftMid`、`rightMid` になります。`mid` は `horizontal`、`mid-mid` は `cross`、`middle` は `vertical` です。未知のスタイル名や border 名、不正な幅は例外になります。`chars` の文字は 1 桁幅にします。`ColumnSpec.width` と `maxWidth` は、どちらも padding を含まない中身の幅です。列のキーと行は行の型から型付けされるので、interface やクラスのインスタンスも渡せ、配列の行には `key` が要りません。

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
  borderStyle: "dim",
  rowSeparators: true,
  paddingLeft: 2,
});
```

### 18. `truncateAnsi` は幅を検証する

`truncateAnsi(text, width, ellipsis?)` は、`width` が 0 以下、`NaN`、`-Infinity`、小数のとき `RangeError` を送出します。1.x は空文字列を返していました。`Infinity` は制限なしを表します。

```typescript
// before
truncateAnsi(text, process.stdout.columns - 10); // 狭い端末では ""
```

```typescript
// after
const width = Math.max(1, process.stdout.columns - 10);
truncateAnsi(text, width);
```

### 19. prompt の入力の終わりは `InputEndedError` になる

ctx を渡したプロンプトは `ctx.stdin` を読みます。`ctx.stdin` が `null` のとき（`stdin` オプションなしの `exec()` や `execLine()`）は、質問を書く前に `InputEndedError` で reject されます。1.x は `process.stdin` を読んでいました。`process.stdin` を意味するのは、`stdin` を省略したときだけです。答える前に入力が終わった場合（再質問中も含む）も `InputEndedError`（終了コード 66）で reject されます。1.x ではキャンセル扱いでした。ストリームの読み取りエラーはそのまま reject され、Ctrl-C と abort は `CancelledError` で reject されます。

対話シェルでは、コマンドとモードのアクションの `ctx.stdin` は、行エディタと共有する端末です（`ModeContext` が `stdin` を持ち、`null` ではなくなります）。`prompt.*` を通して読みます。端末を最後まで読むコマンドは、シェルを止めます。

```typescript
// before
await cli.exec("greet"); // process.stdin を待っていた
```

```typescript
// after
import { PassThrough } from "node:stream";

const stdin = new PassThrough();
stdin.end("Ada\n");
await cli.execLine("greet", { stdin });
// stdin なしでは InputEndedError で reject される
```

### 20. option と引数のキーは camelCase になる

`ctx.options` と `ctx.args` のキーは、名前を camelCase にしたものです。`--dry-run` は `ctx.options.dryRun`、`<file-name>` は `ctx.args.fileName` になり、型も同じ規則で付きます。flags 文字列に long 名が複数あるときは、最初のものが正規の名前（1.x では最後）で、help にも最初の綴りが先に出ます。`--no-x` は、`x` が定義されていれば `x` を false にします。定義されていなければ、`--no-x` はキー `noX` の独立したオプションです。`CompletionContext.options` と `CompletionContext.args` も同じキーを使います。

オプション、引数、コマンド、別名の名前は、英数字を単一のダッシュでつないだものに限ります。`_`、非 ASCII 文字、連続または末尾のダッシュを含む名前は `ERR_INVALID_DEFINITION` を送出します。一つのコマンドの中で、変換後のキーが重なる 2 つのオプション（`--dry-run` と `--dryRun`）は `ERR_DEFINITION_CONFLICT` を送出します。

```typescript
// before
cli.command("deploy").option("--dry-run").option("--colour, --color <n>").action((ctx) => {
  const dry = ctx.options["dry-run"]; // 2 つ目の option は "color"
});
```

```typescript
// after
cli.command("deploy").option("--dry-run").option("--colour, --color <n>").action((ctx) => {
  const { dryRun, colour } = ctx.options;
});
```

### 21. choices、default、validate

`choices` の要素の型は値の型に一致させます。`type: "number"` なら `readonly number[]`、文字列なら `readonly string[]` です。不一致は型エラーになり、定義の時点で `ERR_INVALID_DEFINITION` を送出します。入力は型変換したあとで `===` で比べ、文字列としての緩い一致はなくなりました。`choices` は `parse` や `type: "boolean"` と併用できず、空の `choices` は例外になります。数値の選択肢は有限で、絶対値が `Number.MAX_SAFE_INTEGER` 以下でなければなりません。

`default` の型はオプションの値の型（`parse` があればその戻り値の型）で、`parse` を通りません。`validate` と `parse` のコールバックは型付きの値を受け取ります。

command の `validate` が投げた値は `ValidationError` に包まれ、終了コードは 64 になります（1.x ではそのまま通り、終了コードは 1）。オプションの `validate` と `parse` の失敗は、以前から同じ扱いです。投げられた `CLIError` はそのまま通り、キャンセルはキャンセルのままです。

```typescript
// before
cli.command("scale").option("--n <n>", { type: "number", choices: ["1", "2"] as never });
cli.command("check").validate(() => {
  throw new Error("not allowed"); // 終了コード 1、素の Error
});
```

```typescript
// after
cli.command("scale").option("--n <n>", { type: "number", choices: [1, 2] });
cli.command("check").validate(() => {
  throw new Error("not allowed"); // ValidationError、終了コード 64
});
```

### 22. キャンセルは `CancelledError` で reject される

`exec()` と `execLine()` は、abort 済みの `signal` やプロンプトでコマンドがキャンセルされたとき、`CancelledError` で reject されます。`cause` は signal の reason です。`start()` は reject されず、終了コード 130 を返します。キャンセルでは `commandError` も `error` も発火しません。すでに abort 済みの signal を渡すと、プラグインの初期化やコマンドのフックが走る前に reject されます。`exec()` と `execLine()` は `SIGINT` を購読しなくなったので、キャンセルは `options.signal` で行います。`SIGINT` の処理（1 回目でキャンセル、2 回目で強制終了）は `start()` と対話シェルが持ちます。

```typescript
// before
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") return;
  throw err;
}
```

```typescript
// after
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (err instanceof CancelledError) return;
  throw err;
}
```

### 23. トップレベルの flag

`app --help deploy` と `app -h deploy` は、`app help deploy` と同じく `deploy` の help を表示します。そのほかの未知のトップレベルフラグと、`version` が未設定のときの `--version`、`-V` は `UnknownOptionError`（終了コード 64）になります。1.x は `Command not found` と報告していました。コマンド一覧の `Options:` には常に `-h, --help` が出て、version があれば `-V, --version` も出ます。`Shell commands: exit, quit` は対話シェルの help にだけ出ます。

```text
# before
$ app --frobnicate
Command not found: "--frobnicate"
```

```text
# after
$ app --frobnicate
Unknown option: "--frobnicate"
```

### 24. 返す配列と select の default

`prompt.multiselect()` は `readonly T[]` で resolve し、`splitAnsi()` は `readonly AnsiSegment[]`、`splitGraphemes()` と `tokenize()` は `readonly string[]` を返します。`prompt.select()` と `prompt.multiselect()` は、`as const` なしで choices からリテラルの union を推論します。choices のどれにも一致しない `default` は、質問の前に `RangeError` を送出します。

```typescript
// before
const features: string[] = await prompt.multiselect("Features", ["a", "b"], ctx);
const level = await prompt.select("Level", ["low", "high"] as const, { ...ctx, default: "hgih" });
```

```typescript
// after
const features: readonly string[] = await prompt.multiselect("Features", ["a", "b"], ctx);
const level = await prompt.select("Level", ["low", "high"], { ...ctx, default: "high" }); // "low" | "high"
```

### 25. 状態行

`log.success`、`log.error`、`log.warn` と、bar と spinner の `succeed`、`fail`、`warn` の行は、記号と色を独立に決めます。記号は、ストリームが TTY で `TERM` が `dumb` でなければ `✔`、`✖`、`⚠`、そうでなければ `[OK]`、`[ERROR]`、`[WARN]` です。色は、そのストリームで色が有効なら付きます。1.x は色の有無で記号を選んでいたので、2 つの場合で表示が変わります。`NO_COLOR` を設定した TTY は記号が付いた色なしの表示になり（1.x では ASCII の印）、`FORCE_COLOR` を設定した非 TTY は色付きの ASCII の印になります（1.x では記号）。

```text
# before: TTY with NO_COLOR=1
[OK] Build finished
```

```text
# after: TTY with NO_COLOR=1
✔ Build finished
```

## ノート

### キャンセル

プロセス全体の `error` イベントのハンドラは signal を受け取らず、キャンセルはそのハンドラに届きません。キャンセルは `err instanceof CancelledError` で判定します。コマンドの `ctx.signal` が手元にある場所では `isCancellationError(err, signal)` を使います。こちらは生の `AbortError` も判定します。

```typescript
try {
  await cli.exec(["build"], { signal });
} catch (err) {
  if (!(err instanceof CancelledError)) throw err;
}
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

### prompt の前にインジケーターを終える

prompt と progress のインジケーターは stderr を共有します。質問の前に、bar や spinner の `succeed()`、`fail()`、`warn()`、`stop()` のいずれかを呼びます。呼ばないと、質問の行がインジケーターのフレームに割り込みます。

```typescript
const spinner = progress.spinner({ label: "Checking" });
await check();
spinner.stop();
const ok = await prompt.confirm("Continue?", ctx);
```

### prompt を使うテストでは `exec()` に stdin を渡す

`prompt.*(..., ctx)` を呼ぶコマンドをテストするとき、`exec()` や `execLine()` に `stdin` を渡さないと `InputEndedError` で reject されます。答えを入れたストリームを渡します。

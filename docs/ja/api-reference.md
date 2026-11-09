# API リファレンス

公開するコードのシンボルはすべてパッケージルートからエクスポートされます。例外はパッケージメタデータを読むための `./package.json` だけです。

```typescript
import { createCLI, table, progress, prompt, createLogger } from "@libraz/node-cli";
```

このパッケージは ESM 専用で、Node 22 以降が必要です。

## 目次

- [型のみのエクスポート](#型のみのエクスポート)
- [CLI の作成](#cli-の作成)
- [コマンドの定義](#コマンドの定義)
- [メソッドチェーンと繰り返し呼び出し](#メソッドチェーンと繰り返し呼び出し)
- [実行コンテキスト](#実行コンテキスト)
- [オプション](#オプション)
- [イベントとプラグイン](#イベントとプラグイン)
- [対話シェル](#対話シェル)
- [色と端末テキスト](#色と端末テキスト)
- [テーブル](#テーブル)
- [プログレス](#プログレス)
- [プロンプト](#プロンプト)
- [ログ出力](#ログ出力)
- [エラー](#エラー)
- [低レベルの解析ヘルパー](#低レベルの解析ヘルパー)
- [環境変数](#環境変数)
- [エクスポート一覧](#エクスポート一覧)

## 型のみのエクスポート

一部のエクスポートは値ではなく TypeScript の型です。変数へ型注釈を付けるために存在し、実行時には消えます。`import { Shell } from "@libraz/node-cli"` は失敗し、`Shell` を構築することもできません。CLI を得る手段は `createCLI` だけで、`CLI` と `CommandBuilder` はその戻り値に型注釈を付けるための型です。

型のみのエクスポートは `CLI`、`CommandBuilder`、`Shell`、`ModeOptions`、`ModeAction`、`ModeContext`、`Action`、`CancelHandler`、`CommandValidator`、`Completer`、`CompletionContext`、`FallbackHandler`、`FallbackContext`、`HistoryFilter`、`CLIEventHandler`、`CLIEventMap`、`CLIOptions`、`CommandContext`、`CommandStreams`、`StdioOptions`、`OptionSchema`、`Plugin`、`PluginContext`、`CLIErrorCode`、`CLIErrorOptions`、`BuiltinCLIError`、`UsageErrorCode`、`StyleName`、`StyleSpec`、`ColorFn`、`Colorizer`、`ColorTag`、`AnsiSegment`、`SanitizeTerminalTextOptions`、`ColumnSpec`、`TableChars`、`TableOptions`、`Bar`、`BarOptions`、`BarState`、`MultiBar`、`MultiBarOptions`、`Spinner`、`SpinnerOptions`、`PromptOptions`、`TextOptions`、`ConfirmOptions`、`SelectOptions`、`MultiselectOptions`、`PasswordOptions`、`Choice`、`SelectChoice`、`Logger`、`LoggerOptions`、`LogLevel` です。

動作中の `Shell` には、コマンドのアクション内で `ctx.shell` を通じて到達します。

```typescript
import type { CLI, CommandContext, Shell } from "@libraz/node-cli";

function register(cli: CLI): void {
  cli.command("repl").action((ctx: CommandContext) => {
    const shell: Shell | null = ctx.shell;
    shell?.setPrompt("app> ");
  });
}
```

## CLI の作成

### `createCLI`

```typescript
function createCLI(options: CLIOptions): CLI
```

`CLI` を構築します。唯一のエントリポイントで、クラス自体は値としてエクスポートされません。`options` と `options.name` は必須です。

### `CLI`

```typescript
interface CLI {
  command(definition: string): CommandBuilder; // A and O are inferred from a literal definition
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
  use(plugin: Plugin): this;
  exec(argv: readonly string[], options?: StdioOptions): Promise<void>;
  execLine(line: string, options?: StdioOptions): Promise<void>;
  start(argv?: readonly string[]): Promise<number>;
}
```

| メソッド | 説明 |
| --- | --- |
| `command` | 定義文字列からコマンドを登録し、[`CommandBuilder`](#commandbuilder) を返します。同じパスは既存のコマンドに合流するため、2 回目の登録は最初の定義を拡張します。 |
| `on` / `off` | ライフサイクルのリスナーを追加または削除します。[`CLIEventMap`](#clieventmap) を参照してください。`off` は最初に一致した登録を 1 つ外し、登録されていないハンドラは無視します。未知のイベント名はコード `ERR_INVALID_ARG_VALUE` の `RangeError` を、関数でないハンドラはコード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。 |
| `fallback` | 入力に一致するコマンドがないときに呼ばれるハンドラを設定します。保持できるハンドラは 1 つで、後の呼び出しが置き換えます。 |
| `use` | プラグインを登録します。プラグインの本体は登録順に実行されます。同期プラグインは呼び出しの中で実行され、同期的な throw はそのまま呼び出し元へ伝わり、インスタンスは使える状態のままです。非同期プラグインは最初のコマンドが走る前に待機されます。その失敗は 1 度だけコード `ERR_PLUGIN_FAILED` の `Error` に包まれ、元の値が `cause` に入り、`error` が 1 度発行され、これ以降の `start`、`exec`、`execLine`、`use` は同じエラーで失敗します。 |
| `exec` | argv をトークン化せずにプログラムから実行します。[プログラムからの実行](#プログラムからの実行)を参照してください。 |
| `execLine` | シェル言語のコマンドラインを、引用符と `\|` によるパイプラインつきで実行します。[プログラムからの実行](#プログラムからの実行)を参照してください。 |
| `start` | CLI を実行し、終了コードで解決します。[start](#start) を参照してください。 |

#### `CLIOptions`

各フィールドは `createCLI` を呼ぶときに 1 度だけ読まれます。セッターはありません。動作中のシェルのプロンプトは `ctx.shell?.setPrompt(...)` で変更します。

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `name` | `string` | — | 必須。アプリケーション名。ヘルプのヘッダ、既定のバナー、既定の履歴パスに使われます。英数字、`.`、`_`、`-` で、先頭は英数字です。 |
| `version` | `string` | — | バージョン文字列。設定すると `--version` と `-V` が唯一のトークンとして認識され、ヘルプの一覧にも並びます。 |
| `prompt` | `string` | `"> "` | 対話シェルのプロンプト文字列。 |
| `description` | `string` | — | ヘルプのヘッダに表示される 1 行の説明。 |
| `banner` | `string` | `"<name> v<version>"`、バージョンがなければ `"<name>"` | 対話シェルの起動時に表示されるテキスト。`""` を設定すると表示しません。 |
| `historyFile` | `string` | `~/.<name>_history` | 対話シェルが履歴を保存するパス。`~` だけの値、先頭の `~/`、先頭の `~\` はホームディレクトリに展開されます。 |
| `historySize` | `number` | `1000` | 保持する履歴の最大件数。 |
| `historyFilter` | [`HistoryFilter`](#historyfilter) | — | 保存前に行を書き換えます。`null` を返すとその行は保存されません。 |

文字列でない `name` は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。空の `name` や、上記の文字集合に収まらない `name` は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。空文字列または文字列以外の `historyFile`、数値以外の `historySize`、関数以外の `historyFilter` は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。非負の安全な整数でない `historySize` は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

##### `HistoryFilter`

```typescript
type HistoryFilter = (line: string) => string | null
```

履歴ファイルへ書き込む前に、行を伏せ字にするか拒否します。履歴は同期 I/O で書かれるため、このフィルタも同期です。

#### start

```typescript
start(argv?: readonly string[]): Promise<number>
```

`argv` の既定値は `process.argv.slice(2)` です。動作モードは `argv` の中身で決まります。

| 入力 | 挙動 |
| --- | --- |
| 1 個以上の引数 | 直接実行モード。引数が 1 つのコマンドとして振り分けられ、その後に `exit` が発行されます。 |
| コマンドを含まない引数（空文字列だけ、または `--` だけ） | ヘルプの一覧が表示され、その後に `exit` が発行されます。 |
| 引数がなく、stdin と stdout の両方が端末 | 対話シェルが起動します。シェルが終わると `exit` が発行されます。 |
| 引数がなく、どちらかのストリームが端末でない | ヘルプの一覧が表示され、その後に `exit` が発行されます。 |

Promise は終了コードで解決され、同じ値が `process.exitCode` にも設定されます。対話セッションの後は、その時点で `process.exitCode` が持っている値で解決され、未設定なら `0` です。失敗は reject されず、stderr に書かれて終了コードに反映されます。[エラー](errors.md)を参照してください。

同じインスタンスで 2 回呼ぶと、コード `ERR_ALREADY_STARTED` のエラーを投げます。文字列の配列でない `argv` は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。

直接実行モードでは引数が配列で届くため、再トークン化は行われず、`|` 文字は普通の引数値です。パイプラインが存在するのは、`execLine` で実行するコマンドラインと、対話プロンプトに入力された行だけです。次の節と[対話シェル](interactive-shell.md)を参照してください。

#### プログラムからの実行

```typescript
exec(argv: readonly string[], options?: StdioOptions): Promise<void>
execLine(line: string, options?: StdioOptions): Promise<void>
```

`exec` は `argv` を、コマンドパスとそれに続く引数として実行します。要素はそのまま使われ、トークン化は行われず、`|` は普通の文字です。そのため、信頼できないデータはこちらに渡します。`[]` は何もせずに解決されます。文字列の配列でない値は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。

`execLine` は、シェル言語の 1 行を、対話プロンプトで入力されたものとして実行します。行はトークン化され（シングルクォート、ダブルクォート、バックスラッシュエスケープ）、最上位の `|` でパイプラインに分割されて、各ステージが並行して実行されます。`""` は何もせずに解決されます。文字列でない値は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。閉じていない引用符は、fallback ハンドラがその行を受け取らない限り `ParseError` で reject されます。信頼できないデータを行に埋め込んではいけません。データ中の `|` が別のコマンドを起動するためです。そのようなデータは `exec([...])` で渡します。Windows のパスは、行の中で引用するか、`exec` で渡します。

キャンセルは `options.signal` だけで行い、プロセスの SIGINT はホストに任されます。すでに abort 済みのシグナルは、何かが走る前に、保留中のプラグインの初期化も含めて、`CancelledError` で reject されます。実行中にキャンセルされたコマンドは `CancelledError` で reject され、`commandError` も `error` も発行されません。abort を無視して終了したコマンドは、そのまま解決されます。

どちらのメソッドも、正常系では `exit` イベントを発行 **しません**。発行するのは `start` と、プロセスを終了させる強制終了の経路だけです。それ以外の失敗は、`commandError` と `error` の各イベントが発行された後で、返された Promise を reject します。

ここでは `ctx.shell` が常に `null` です。そのため `ctx.shell.enterMode(...)` を使うコマンドは、`null` を確認する必要があります。

##### `StdioOptions`

```typescript
type StdioOptions = Partial<CommandStreams>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `stdin` | `Readable \| null` | `null` | パイプラインの最初のステージに `ctx.stdin` として渡されるストリーム。 |
| `stdout` | `Writable` | `process.stdout` | 最後のステージに `ctx.stdout` として渡されるストリーム。 |
| `stderr` | `Writable` | `process.stderr` | すべてのステージに `ctx.stderr` として渡されるストリーム。 |
| `signal` | `AbortSignal` | — | 外部からのキャンセル。abort すると `ctx.signal` が abort され、コマンドの `onCancel` ハンドラが呼ばれます。[AbortSignal](glossary.md#abortsignal) を参照してください。 |

[`CommandContext`](#commandcontext) は `StdioOptions` に代入できます。そのためアクションの中から、自身のストリームとシグナルを使って入れ子のコマンドを実行できます。

```typescript
cli.command("release").action(async (ctx) => {
  await cli.exec(["build", "--production"], ctx);
});
```

メモリ上で完結する実例は[実例](examples.md)にあります。

### `FallbackHandler`

```typescript
type FallbackHandler = (input: string, ctx: FallbackContext) => void | Promise<void>
```

どのコマンドにも一致しなかった入力を、そのまま受け取ります。閉じていない引用符のようにトークン化できない入力も、投げられる代わりにハンドラへ届きます。throw または reject は `error` イベントで報告されて実行を reject し、`ctx.signal` のキャンセルは代わりに `CancelledError` で reject されます。

### `FallbackContext`

```typescript
interface FallbackContext extends CommandStreams {
  readonly rawArgv: readonly string[] | null;
}
```

コマンドが解決されていないため、コンテキストが持つのは実行のストリームとシグナルに加えて `rawArgv` です。`rawArgv` は、実行が配列で呼ばれたときは argv 全体（未知だったのが入れ子の子だけでも全体）で、コマンドライン文字列のときは `null` です。`CommandContext` と同様に元へ戻せる形で、`input` の文字列は argv の要素を空白で連結したものです。

## コマンドの定義

### `CommandBuilder`

`cli.command(...)`、`builder.command(...)`、プラグインコンテキストの `command(...)` が返します。`A` と `O` は、ハンドラが受け取る `ctx.args` と `ctx.options` の型です。

```typescript
class CommandBuilder<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> {
  description(text: string): this;
  hidden(hidden?: boolean): this;
  option(flags: string, schema?: OptionSchema): CommandBuilder<A, O>; // O gains the option's key
  action(fn: Action<A, O>): this;
  completer(fnOrList: readonly string[] | Completer): this;
  alias(...names: readonly string[]): this;
  validate(fn: CommandValidator<A, O>): this;
  onCancel(fn: CancelHandler<A, O>): this;
  remove(): boolean;
  command(definition: string): CommandBuilder; // the child builder
}
```

| メソッド | 説明 |
| --- | --- |
| `description` | ヘルプ出力でこのコマンドに表示するテキストを設定します。 |
| `hidden` | 生成されるヘルプとタブ補完からコマンドを除外します。引数なしで呼ぶと `true` になります。隠したコマンドも、名前が入力されれば通常どおり実行されます。 |
| `option` | オプションを宣言し、そのオプションを型に加えたビルダーを返します。[オプション](#オプション)を参照してください。 |
| `action` | コマンドの呼び出し時に実行されるハンドラを設定します。 |
| `completer` | このコマンドの引数に対するタブ補完の候補を設定します。静的なリストか、[`Completer`](#completer) を渡します。 |
| `alias` | 別名を追加します。同じ階層の別のコマンドまたはエイリアスに属する名前は、コード `ERR_DEFINITION_CONFLICT` のエラーを投げます。 |
| `validate` | アクション前のチェックを設定します。throw すると、アクションが走る前に呼び出しを拒否します。 |
| `onCancel` | 実行中のコマンドがキャンセルされたときに呼ばれるハンドラを設定します。 |
| `remove` | コマンドの登録を解除します。見つかって削除されたときは `true` を返します。 |
| `command` | サブコマンドを登録し、そのサブコマンドのビルダーを返します。同じパスは既存のサブコマンドに合流します。 |

定義文字列は、コマンド名とその位置引数を表します。`"deploy <env> [region]"`、`"db migrate"`、`"run <...tasks>"` のように書きます。`<name>` は必須、`[name]` は任意で、先頭の `...` は可変長の引数を表します。位置引数は常に文字列です。型、既定値、型変換、`choices` はありません。可変長の引数は `string[]` になります。コマンド名、別名、引数名は、ASCII の英数字を単一のダッシュでつないだ形（`dry-run`、`x1`）に限られ、この規則に合わない名前は、不正な定義と同じくコード `ERR_INVALID_DEFINITION` のエラーを投げます。`ctx.args` では、引数は名前を camelCase にしたキーで引けます。`<file-name>` は `ctx.args.fileName` です。[コマンド](commands.md)を参照してください。

削除済みのコマンドに設定を呼ぶと、コード `ERR_COMMAND_REMOVED` のエラーを投げます。削除済みコマンドのビルダーは使えません。

#### 引数とオプションの型付け

定義文字列がリテラルなら、ビルダーは定義と各 `option` の呼び出しから `ctx.args` と `ctx.options` の型を導きます。

| 由来 | `ctx.args` での型 |
| --- | --- |
| `<name>` | `string` |
| `[name]` | `string \| undefined` |
| `<...names>` と `[...names]` | `readonly string[]` |

キーは引数名の camelCase 形です（`<file-name>` は `fileName`）。`"db migrate <target>"` の `db migrate` のような先頭のパス語は、キーを加えません。

オプションは `ctx.options` に 1 つのキーを加えます。キーは、フラグ中の最初の `--name` を camelCase にしたものです。ロング形がなければ、最初のショート名になります（`--dry-run` は `dryRun`、`-v` は `v`）。値の型は次の優先順位で決まります。

1. `choices` の要素のユニオン。
2. `parse` の戻り値を await した型。配列型なら要素ごと。
3. スキーマの `type`。
4. 値のプレースホルダがあれば `string`、なければ `boolean`。

`choices` の要素はオプションの値の型を持つ必要があり、`type: "number"` のオプションには数値を渡します。`choices` は空にできず、`parse` や boolean のオプションとは併用できません。`default` と `validate` に渡される値は値の型で型付けされるため、別の型の `default` はコンパイル時にエラーになります。キーは、オプションが `required` であるか、`default` を持つか、boolean であるときを除いて省略可能です。同じキーを再び定義すると、実行時にオプションが置き換わるのと同じく、型でもそのエントリが置き換わります。リテラルでない定義文字列やフラグ文字列では、型が `Record<string, unknown>` に広がります。

```typescript
cli
  .command("deploy <env> [region]")
  .option("-p, --port <port>", { type: "number", default: 8080 })
  .option("--tag <tag>")
  .option("--force")
  .option("--dry-run")
  .action((ctx) => {
    ctx.args.env; // string
    ctx.args.region; // string | undefined
    ctx.options.port; // number
    ctx.options.tag; // string | undefined
    ctx.options.force; // boolean
    ctx.options.dryRun; // boolean
  });
```

サブコマンドのビルダーは自身の定義から型付けされ、親のオプションを引き継ぎません。

`option()` が返すビルダーは新しいオプションを型に持ちますが、呼び出した側のビルダーは以前の型のままです。呼び出しを連鎖させるか、結果を再代入します。

#### 到達できないサブコマンド

位置引数とアクションの両方を持つコマンドは、後続のトークンをすべて引数の値として消費するため、サブコマンドには決して振り分けられません。そのようなコマンドで `action` を呼ぶと、コード `NODE_CLI_UNREACHABLE_SUBCOMMAND` のプロセス警告が発行されます。すでにそうなっているコマンドの下にサブコマンドを登録した場合も、同じ警告が発行されます。この状態のサブコマンドは、振り分けられない経路を案内しないよう、ヘルプ出力とタブ補完から外されます。

#### validate

```typescript
validate(fn: CommandValidator<A, O>): this
```

オプションの解決後、`beforeExecute` の前に実行されます。ここで投げられた `CLIError` はそのまま伝わり、元のクラス、コード、終了コードを保ちます。`ctx.signal` のキャンセルはキャンセルのままです。それ以外の値は、元の値を `cause` に持つ `ValidationError` に包まれます。オプション自身の `parse` や `validate` の失敗と同じ扱いです。

#### onCancel

```typescript
onCancel(fn: CancelHandler<A, O>): this
```

実行中のコマンドが中断されたときに呼ばれます。中断は、Ctrl-C、abort された `exec` のシグナル、シェル内の SIGTERM のいずれかです。ハンドラは待機されず、reject は `error` イベントで報告されます。ハンドラが走る時点で `ctx.signal` はすでに abort されているため、ハンドラとシグナルのリスナーは同じ出来事の 2 つの見え方です。どちらか一方でも両方でも使えます。

### `Action`

```typescript
type Action<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void | Promise<void>
```

### `CommandValidator`

```typescript
type CommandValidator<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void | Promise<void>
```

### `CancelHandler`

```typescript
type CancelHandler<A extends object = Record<string, unknown>, O extends object = Record<string, unknown>> =
  (ctx: CommandContext<A, O>) => void
```

### `Completer`

```typescript
type Completer = (ctx: CompletionContext) => readonly string[] | Promise<readonly string[]>
```

補完フックはどれも同じ形です。`builder.completer`、`OptionSchema.completer`、`ModeOptions.completer` の 3 つで、いずれも静的な `readonly string[]` も受け付けます。候補は、リストでも関数でも、提示される前に `ctx.current` で始まるものへ絞られます。そのためプロバイダは全候補を返して構いません。

補完は、1000 ms の期限で `ctx.signal` が abort されると打ち切られます。同期的な throw、reject、タイムアウトのいずれも候補を空のリストにし、プロンプトを止めたままにすることはありません。

#### `CompletionContext`

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `line` | `string` | 処理中のパイプラインのセグメント。カーソルがあるコマンドです。 |
| `fullLine` | `string` | 入力行の全体。前のパイプラインのセグメントも含みます。 |
| `current` | `string` | カーソル位置の単語。単語の境界では `""` です。 |
| `commandPath` | `readonly string[]` | 正式なコマンドパス。エイリアスは解決済みです。 |
| `args` | `Readonly<Record<string, string \| readonly string[]>>` | ここまでに解析された位置引数。camelCase の名前をキーとし、値は生の文字列か、可変長引数なら生の文字列の配列です。 |
| `options` | `Readonly<Record<string, string \| boolean \| readonly string[]>>` | ここまでに解析されたオプションの値。`ctx.options` と同じキーで、型変換、既定値、検証の前の値です。値を取るオプションは生の文字列、フラグは `true` または `false`、配列オプションは生の文字列の配列です。 |
| `iteration` | `number` | 連続した Tab の押下回数で、1 から始まります。ほかの入力があるとリセットされます。 |
| `signal` | `AbortSignal` | 補完の期限が切れると abort されます。 |

シェルのモードでは、`line` と `fullLine` が入力行の全体になり、`commandPath` は空で、`args` と `options` も空です。

## メソッドチェーンと繰り返し呼び出し

設定系のメソッドは `this` を返すため、呼び出しを連鎖できます。対象は `CLI.on`、`off`、`fallback`、`use`、`PluginContext` の対応するメソッド（コンテキストを返します）、`CommandBuilder` のセッターです。例外は次のとおりです。

| メソッド | 戻り値 |
| --- | --- |
| `CommandBuilder.option()` | 追加したオプションを型に持つビルダー。呼び出した側は以前の型のままなので、呼び出しを連鎖させるか、結果を再代入します。 |
| `CommandBuilder.command()` | サブコマンドのビルダー。連鎖は子の上で続きます。 |
| `CommandBuilder.remove()` | boolean。連鎖はここで終わります。 |
| `CLI.command()`, `PluginContext.command()` | `CommandBuilder`。 |
| `CLI.exec()`, `CLI.execLine()`, `CLI.start()` | Promise。 |
| `Shell.setPrompt()`, `Shell.enterMode()`, `Shell.exitMode()` | シェル自身。呼び出しを連鎖できます。 |
| `Shell.stop()` | `void`。セッションを終えるためです。 |
| `Logger.setLevel()` | ロガー自身。呼び出しを連鎖できます。 |
| `Logger.child()` | 新しい `Logger`。 |
| `Logger.flush()` | Promise。 |
| `Bar`、`Spinner`、`MultiBar` のメソッド | `void`。 |

同じ対象への 2 回目の呼び出しがどうなるかは、メソッドによって異なります。

| メソッド | 繰り返した呼び出し |
| --- | --- |
| `CommandBuilder.description()` | 説明を置き換えます。 |
| `CommandBuilder.hidden()` | 設定を置き換えます。 |
| `CommandBuilder.option()` | 同じオプション名は以前の定義をその場で置き換え、型のエントリも置き換わります。新しい名前はオプションを追加します。 |
| `CommandBuilder.action()` | アクションを置き換えます。 |
| `CommandBuilder.completer()` | 補完を置き換えます。 |
| `CommandBuilder.alias()` | 既存の別名に追加します。重複は無視されます。 |
| `CommandBuilder.validate()` | バリデータを置き換えます。 |
| `CommandBuilder.onCancel()` | ハンドラを置き換えます。 |
| `CommandBuilder.command()` | 同じ名前は既存のサブコマンドに合流します。 |
| `CommandBuilder.remove()` | `false` を返します。 |
| `CLI.command()`, `PluginContext.command()` | 同じパスは既存のコマンドに合流します。 |
| `CLI.fallback()`, `PluginContext.fallback()` | ハンドラを置き換えます。 |
| `CLI.on()`, `PluginContext.on()` | リスナーをもう 1 つ追加します。 |
| `CLI.off()`, `PluginContext.off()` | 最初に一致した登録を 1 つ外します。登録されていないハンドラは無視されます。 |
| `CLI.use()` | プラグインをもう 1 つ登録します。本体は登録順に実行されます。非同期プラグインが失敗した後は、その失敗を投げます。 |
| `CLI.start()` | コード `ERR_ALREADY_STARTED` のエラーを投げます。 |
| `Shell.setPrompt()` | プロンプトを置き換えます。 |
| `Shell.enterMode()` | 有効なモードを置き換え、そのメモリ上の履歴を新しく始めます。 |
| `Shell.exitMode()` | モードの外では何もしません。 |
| `Shell.stop()` | シェルが止まった後は何もしません。 |
| `Logger.setLevel()` | レベルを置き換えます。 |
| `Logger.child()` | 子ロガーをもう 1 つ作ります。 |

## 実行コンテキスト

### `CommandContext`

```typescript
interface CommandContext<
  A extends object = Record<string, unknown>,
  O extends object = Record<string, unknown>,
> extends CommandStreams {
  readonly args: A;
  readonly options: O;
  readonly rawInput: string;
  readonly rawArgv: readonly string[] | null;
  readonly commandPath: readonly string[];
  readonly shell: Shell | null;
  readonly signal: AbortSignal;
}
```

| フィールド | 説明 |
| --- | --- |
| `args` | 位置引数。引数名を camelCase にしたキーで引けます（`<file-name>` は `fileName`）。 |
| `options` | 解決済みのオプション。オプションの最初のロング名を camelCase にしたキー（`--dry-run` は `dryRun`）で、ロング形がなければ最初のショート名で引けます。 |
| `rawInput` | 文字列入力ならその元の文字列。argv 入力なら `argv.join(" ")` で、これは情報が落ちます。空白を含む 1 つの引数と、2 つの引数を区別できません。 |
| `rawArgv` | 配列入力（`start`、`exec`）のときは argv の要素そのままで、文字列入力のときは `null` です。元へ戻せる形なので、引数の境界が重要なときに使います。 |
| `commandPath` | 解決されたコマンドの正式なパス。たとえば `["db", "migrate"]` です。エイリアスは実名に解決されるため、利用者が何を入力したかには左右されません。 |
| `shell` | 対話モードでは動作中の `Shell`。直接実行モードとプログラムからの実行では `null` です。 |
| `signal` | コマンドがキャンセルされると abort されます。`fetch` やタイマーなど、abort に対応した API に渡してください。 |
| `stdin` | この実行面の読み取りストリーム。該当するものがなければ `null` です。対話シェルでは、行エディタと共有する端末です。`prompt.*` を通して読み、EOF まで読んではいけません。 |
| `stdout` | 通常の出力用の書き込みストリーム。 |
| `stderr` | 診断出力用の書き込みストリーム。 |

`args` と `options` はプロトタイプを持たないオブジェクトです。`Object.create(null)` で作られるため `Object.prototype` から何も継承しません。`ctx.options.hasOwnProperty("force")` はメソッドを継承していないので `TypeError` になります。任意のオブジェクトで動く `Object.hasOwn` を使ってください。

```typescript
if (Object.hasOwn(ctx.options, "force")) {
  // the option resolved to a value
}
```

これは意図的な取引です。`constructor` や `toString` という名前のオプションや列があっても、継承された値を拾ってしまうことがありません。

### `CommandStreams`

```typescript
interface CommandStreams {
  readonly stdin: Readable | null;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly signal: AbortSignal;
}
```

1 回の実行が持つ標準ストリームとキャンセル用のシグナルです。シグナルはストリームと一緒に渡されます。コマンドの I/O を供給する側が、そのコマンドをキャンセルするシグナルも供給します。`CommandContext` と `FallbackContext` がこれを拡張し、`StdioOptions` はその部分型です。

#### 引数の有無

| 宣言 | 何も渡されなかったとき |
| --- | --- |
| `<name>`（必須） | `MissingArgumentError` で呼び出しが失敗します。 |
| `[name]`（任意） | キーは `args` に **含まれません**。 |
| `<...names>`（必須の可変長） | 呼び出しが失敗します。値がゼロ個であることは引数の欠落にあたります。 |
| `[...names]`（任意の可変長） | キーは存在し、空の配列を保持します。 |

#### 実行面ごとの標準入力

| 実行面 | `ctx.stdin` |
| --- | --- |
| `start(argv)` の直接コマンド | `process.stdin` |
| 対話シェルのコマンドまたはモードのアクション | `process.stdin`。行エディタと共有する端末 |
| パイプラインの最初のステージ | その実行面が渡したストリーム |
| パイプラインの 2 番目以降のステージ | 前段の出力 |
| プログラムからの実行（`exec`、`execLine`） | `StdioOptions.stdin`。既定は `null` |

## オプション

### `OptionSchema`

```typescript
interface OptionSchema {
  description?: string;
  type?: "string" | "number" | "boolean" | "string[]" | "number[]";
  alias?: string | readonly string[];
  required?: boolean;
  default?: unknown;
  choices?: readonly unknown[];
  parse?: (value: string, ctx: CommandContext) => unknown;
  validate?: (value: unknown, ctx: CommandContext) => void | Promise<void>;
  hidden?: boolean;
  completer?: readonly string[] | Completer;
}
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `description` | `string` | — | ヘルプ出力でオプションに表示されるテキスト。 |
| `type` | 上記のとおり | 推論 | フラグ文字列に `<value>` のプレースホルダがなければ `"boolean"`、あれば `"string"`。 |
| `alias` | `string \| readonly string[]` | — | 1 文字の短縮名を追加します。`"p"` または `"-p"` と書き、フラグ文字列で宣言された名前とマージされます。ロング形の別名はフラグ文字列に書きます（`"--colour, --color"`）。 |
| `required` | `boolean` | `false` | オプションが指定されないと `MissingOptionError` で失敗します。 |
| `default` | `unknown` | — | オプションがないときに使う値。オプションの値の型で型付けされます。 |
| `choices` | `readonly unknown[]` | — | 値を制限します。オプションの値の型で型付けされ、配列型なら要素ごとです。入力は先に型変換され、`===` で比較されます。空にはできず、`parse` や boolean のオプションとは併用できません。 |
| `parse` | 関数 | — | 明示的に渡された値に対するカスタムパーサ。生の文字列とコンテキストを受け取り、コンテキストでは他のオプションがまだ解決されていないことがあります。返された Promise は await されます。投げられた `CLIError` はそのまま伝わり、キャンセルはキャンセルのままで、それ以外の throw や reject は、`value` が生の文字列の `ValidationError` になります。 |
| `validate` | 関数 | — | 型変換後に走るカスタムチェック。すべてのオプションが解決された後の値を受け取ります。throw または reject で値を拒否します。`CLIError` はそのまま伝わり、キャンセルはキャンセルのままで、それ以外の値は `ValidationError` になります。 |
| `hidden` | `boolean` | `false` | ヘルプ出力とタブ補完からオプションを除外します。 |
| `completer` | `readonly string[]` または [`Completer`](#completer) | — | このオプションの値に対して提示する候補。補完では `choices` より優先されます。 |

見落としやすい規則は次のとおりです。

- 入力で省略された boolean のオプションは、`undefined` ではなく `false` に解決されます。ビルダーが、オプションが `required` でない限りこの既定値を差し込みます。
- 同じオプションに `required: true` と `default` を宣言すると、既定値が必須の条件を満たせなくするため、定義時にコード `ERR_INVALID_DEFINITION` のエラーを投げます。
- `default` は解決済みの値です。カスタムの `parse` は適用されず、`parse` があるときは組み込みの型変換も行われません。`parse` がなければ、型付けされていない JavaScript から渡した `"8080"` は、`"number"` のオプションで `8080` に解決されます。
- 宣言した `choices` の外にある `default` は、定義時にコード `ERR_INVALID_DEFINITION` のエラーを投げます。
- `parse` は組み込みの型変換を完全に置き換えます。したがって `parse` を持つオプションは、`Date` を含めどんな型にも解決できます。
- プレースホルダが `<number>` なら `type: "number"` か `"number[]"` が、`<boolean>` なら `type: "boolean"` が必要です。
- `"number"` は通常の 10 進数と指数表記を受け付けます。`Number.MAX_SAFE_INTEGER` を超える大きさは、桁を正確に表せないため拒否されます。
- コマンド内の別のオプションがすでに使っている名前や別名は、コード `ERR_DEFINITION_CONFLICT` のエラーを投げます。不正なフラグや、フラグと矛盾するスキーマは `ERR_INVALID_DEFINITION` を投げます。
- フラグ文字列の最初の `--name` が正の名前で、以降のロング名は別名です。`ctx.options` では、正の名前を camelCase にしたキーでオプションを引きます。ヘルプ、補完、エラーメッセージはフラグの綴りのままです。1 つのコマンドの 2 つのオプションで camelCase のキーが重なる場合（`--dry-run` と `--dryRun` など）は、`ERR_DEFINITION_CONFLICT` を投げます。
- 別名を含む名前は、ASCII の英数字を単一のダッシュでつないだ形に限られます。スキーマの `alias` はちょうど 1 文字です。
- `--no-x` は boolean のオプション `x` を否定します。`x` を持たずに `--no-x` として宣言されたオプションは独立したオプションで、キーは `noX` です。
- コマンド間で共有するスキーマは、`satisfies OptionSchema` で書くと型付けが保たれます。`OptionSchema` と注釈すると、オプションの値が `unknown` に広がります。

### 解析のルール

| 形式 | 結果 |
| --- | --- |
| `--name value`、`--name=value` | 値を取るロングオプション。 |
| `-n value`、`-n=value` | 値を取るショートエイリアス。 |
| `--flag`、`-f` | boolean が `true` になります。 |
| `--no-flag` | boolean が `false` になります。boolean でないオプションには拒否され、`no-flag` という名前のオプションが実在する場合は適用されません。 |
| `-abc` | 短い boolean フラグの束。値を取るフラグを束ねると拒否されます。束ねられるのは boolean だけです。 |
| `-5`、`-3.14` | その名前のオプションやエイリアスがなければ位置引数の値。 |
| `--offset -5` | `-5` を `number` または `number[]` のオプションの値として結び付けます。ほかの型では先頭の `-` が次のフラグと解釈されるため、`--offset=-5` と書く必要があります。 |
| `--` | オプションの解析を終えます。以降のトークンは普通の位置引数になり、`rest` のような別の入れ物はありません。 |
| `--label a --label b` | `string[]` と `number[]` のオプションでは配列に蓄積されます。ほかの型では最後の値が勝ちます。 |

### 組み込みのフラグ

`--help` と `-h` はコマンドのヘルプページを表示します。入力のどの位置でも、`-vh` のような短い束の中でも使えます。`help` という名前、または `h` というエイリアスのオプションを宣言したコマンドでは使えなくなります。その場合、ヘルプ出力と補完は、引き続き使える方の形だけを案内します。

`--version` と `-V` が横取りされるのは、CLI に `version` が設定されていて、かつそのフラグが入力の唯一のトークンであるときだけです。`-v` の形はありません。`version` がなければ、宣言されていない他のトップレベルのフラグと同じく未知のオプションです。トップレベルの `--help <command>` と `-h <command>` は、`help <command>` と同じくそのコマンドのヘルプを表示します。

`--help` または `-h` だけを単独で入力すると、コマンドのページではなくヘルプの一覧が表示されます。

### 組み込みの help コマンド

`help [...command]` は自動的に登録されます。引数なしなら一覧を、パスを渡せばそのコマンドのページを表示します。解決できないパスは、stdout に表示されず、stderr への `CommandNotFoundError` で失敗します。

## イベントとプラグイン

### `CLIEventMap`

```typescript
interface CLIEventMap {
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  error: (error: Error) => void | Promise<void>;
  exit: () => void | Promise<void>;
}
```

| イベント | 発行されるとき |
| --- | --- |
| `beforeExecute` | 検証とオプションの解決の後、アクションが走る直前。 |
| `afterExecute` | アクションが正常に解決された後。 |
| `commandError` | 解決済みのコマンドが、引数の検証、オプションの解決、自身の `validate`、アクションのいずれかで失敗したとき。 |
| `error` | 入力の処理中に起きる失敗のすべて。コマンドが解決される前に起きるもの（コマンドが見つからない、解析の失敗など）も含みます。非同期プラグインの初期化が失敗したときにも 1 度だけ発行されます。 |
| `exit` | 多くとも 1 度。`start` が終わったとき、または強制終了やシェルでの SIGTERM がプロセスを終わらせるとき。 |

解決済みのコマンドの失敗では、`commandError` と `error` の **両方** が発行されます。`commandError` はコンテキストを持ち、`error` は包括的なイベントです。失敗をちょうど 1 度だけ見たいハンドラは、両方ではなくどちらか一方を購読します。キャンセルは失敗ではありません。実行中のコマンドが `ctx.signal` でキャンセルされたときは、どちらも発行されず、実行は `CancelledError` で reject されます。

`exit` が発行されるのは、直接実行モードのコマンドが完了したとき、throw したとき、強制終了されたとき、引数のない非端末での起動でヘルプの一覧が表示された後、プラグインの初期化が失敗したとき、対話シェルが終了または SIGTERM を受け取ったとき、そして強制終了が `exec` または `execLine` の呼び出しを終わらせたときです。プログラムからの実行は、正常系では発行しません。CLI が扱わないシグナル（直接実行モードの SIGTERM と SIGHUP、シェルの SIGHUP）は、`exit` もキャンセルハンドラも実行せずにプロセスを終了させます。

throw するリスナーがコマンドを壊すことはありません。その失敗は `error` イベントとして再発行され、残りのリスナーも実行されます。`error` リスナー自身が throw した場合は、再帰を止めるために stderr に報告されます。

1 つのイベントに対するリスナーは登録順に実行され、非同期のリスナーは次のリスナーが走る前に待機されます。

### `CLIEventHandler`

```typescript
type CLIEventHandler<K extends keyof CLIEventMap> = CLIEventMap[K]
```

1 つのイベントのハンドラ型に名前を付けます。これにより `on` の呼び出しとは別にリスナーを宣言でき、`off` で削除できるようにもなります。

```typescript
import type { CLIEventHandler } from "@libraz/node-cli";

const onExit: CLIEventHandler<"exit"> = () => {
  process.stderr.write("bye\n");
};

cli.on("exit", onExit);
cli.off("exit", onExit);
```

### `PluginContext`

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder; // typed like cli.command
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this;
  fallback(handler: FallbackHandler): this;
}
```

`cli.use(...)` に渡した関数が受け取るオブジェクトです。公開するのは拡張の面だけで、プラグインは CLI を開始することも、そのオプションを変更することもできません。セッターはコンテキストを返すため、登録を連鎖できます。`command` は、パスがすでに登録されていれば既存のコマンドに合流します。

### `Plugin`

```typescript
type Plugin = (ctx: PluginContext) => void | Promise<void>
```

同期プラグインは `use` の中で実行され、非同期プラグインは最初のコマンドが走る前に待機されます。

非同期プラグインの本体は 1 本の直列キューで実行されるため、先のプラグインが I/O を待っていても、登録順は決定的です。非同期の失敗は 1 度だけコード `ERR_PLUGIN_FAILED` の `Error` に包まれ、元の値が `cause` に入ります。`error` が 1 度発行され、`start` はそれを報告して `exit` を発行し、これ以降の `use`、`exec`、`execLine` は同じエラーで reject されます。`use` の中での同期的な throw は、そのまま呼び出し元へ伝わり、CLI は使える状態のままです。[イベントとプラグイン](events-and-plugins.md)を参照してください。

## 対話シェル

### `Shell`

型のみです。動作中のインスタンスには `ctx.shell` を通じて到達します。対話シェルの外では `null` です。

```typescript
interface Shell {
  setPrompt(text: string): this;
  enterMode(options: ModeOptions): this;
  exitMode(): this;
  stop(): void;
}
```

| メソッド | 説明 |
| --- | --- |
| `setPrompt` | プロンプト文字列を変更します。次のプロンプトから有効になり、モードの間に変更した場合はモードを抜けた後に反映されます。 |
| `enterMode` | 独自のプロンプトとハンドラを持つサブ REPL に入力を渡します。 |
| `exitMode` | 現在のモードを抜け、コマンドのプロンプトに戻ります。 |
| `stop` | 現在の入力の処理を終えた後、シェルのセッションを終了します。 |

シェルが起動するのは、stdin と stdout の **両方** が端末のときだけです。組み込みコマンドは `exit` と `quit` だけで、同名のコマンドが登録されていれば最上位ではそちらが優先されます。`help` は通常の登録コマンドで、`clear` や `history` の組み込みはありません。

### `ModeOptions`

```typescript
interface ModeOptions {
  prompt: string;
  action: ModeAction;
  banner?: string;
  completer?: readonly string[] | Completer;
  history?: "session" | "none";
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `prompt` | — | モードが有効な間に表示されるプロンプト文字列。 |
| `action` | — | 送信された各行に対するハンドラで、[`ModeAction`](#modeaction) です。モードはコマンドレジストリを通してディスパッチしません。 |
| `banner` | — | モードに入ったときに 1 度だけ表示されるテキスト。 |
| `completer` | — | モード固有の補完。静的なリストか、`commandPath` が空の `CompletionContext` で呼ばれる [`Completer`](#completer) を渡します。どちらも `ctx.current` との前方一致で絞られます。指定がなければ Tab は何も提示しません。モードの中ではトップレベルのコマンド補完は出ません。ほかのプロバイダと同じく 1000 ms で打ち切られます。 |
| `history` | `"session"` | `"session"` はモードの入力をモードの間だけメモリに保持し、`"none"` は無効にします。モードの入力がディスクの履歴ファイルに書かれることはありません。 |

モードの中では、`exit` と `quit` は常にシェルではなくモードを抜けます。最初の Ctrl-C は `ctx.signal` を abort し、2 回目はステータス 130 でプロセスを強制終了します。SIGTERM も同じ協調的な経路をたどり、続いて履歴を保存し、`exit` を発行し、200 ms の猶予の後にステータス 143 で終了します。

### `ModeAction`

```typescript
type ModeAction = (input: string, ctx: ModeContext) => void | Promise<void>
```

モードの中で送信された各行を受け取ります。throw または reject は stderr に報告され、シェルはモードに留まります。

### `ModeContext`

```typescript
interface ModeContext extends CommandStreams {}
```

モードのアクションに渡されるコンテキストです。シェルのストリームと、アクションを abort するシグナルを持ちます。`stdin` は行エディタと共有する端末なので、モードの中でも `prompt.text("…", ctx)` が動きます。読むときは `prompt.*` を通し、EOF まで読んではいけません。

## 色と端末テキスト

### `color`

```typescript
const color: Colorizer
```

プロパティがスタイル名になっているプロキシです。それぞれが、呼び出し可能でありチェーンもできる関数を返します。

```typescript
import { color } from "@libraz/node-cli";

color.red("error");
color.bold.green("ok");
color.bgCyan.white.underline("banner");
```

未知のスタイル名にアクセスすると、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を **投げます**。そのため、無スタイルのテキストが黙って出力されるのではなく、打ち間違いがその場で表面化します。プロトコル用のプロパティ（`then`、`toString`、`valueOf`、`toJSON`、`constructor`、およびすべてのシンボル）は対象外なので、colorizer を `await` やテンプレートリテラル、`JSON.stringify` に通してもクラッシュしません。

有効・無効の判定は `process.stdout` に従います。ほかへ書き込む場合は `createColorizer` を使ってください。

### スタイルの型

```typescript
type StyleName = "bold" | "dim" | /* … */ "bgWhite"
type StyleSpec = StyleName | `${StyleName}.${StyleName}` | `${StyleName}.${StyleName}.${string}`
type ColorFn = ((text: string) => string) & { readonly [K in StyleName]: ColorFn }
type Colorizer = { readonly [K in StyleName]: ColorFn }
```

`StyleName` は、下の表にある名前のユニオンです。`StyleSpec` は 1 つのスタイル、またはドットでつないだスタイルの連鎖で、プログレスバーの `style` やテーブルの `borderStyle` のようなオプションが取ります。型システムが検査するのは連鎖の最初の 2 つまでで、それ以降は値が使われるときに検査されます。`ColorFn` は連鎖できる呼び出し可能な値で、`Colorizer` は `color` と `createColorizer` の実体となるオブジェクトです。

### スタイルの一覧

修飾が 6 つ、前景色が 10 個、背景色が 7 つ。これだけです。`bgBlack` はなく、明色の変種もなく、256 色や 16 進数の API もありません。

| 分類 | 名前 |
| --- | --- |
| 修飾 | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| 前景色 | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `grey` |
| 背景色 | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

`gray` と `grey` は同じ色の 2 通りの綴りです。

### `isStyleName`

```typescript
function isStyleName(value: unknown): value is StyleName
```

`value` が組み込みのスタイル名かどうかを判定します。文字列でない値を含め、それ以外の値は `false` になり、`toString` のような継承されたメンバーも該当しません。

### `colorTag`

```typescript
const colorTag: ColorTag
```

`{styleName text}` というマークアップでスタイルを適用する、`process.stdout` に結び付いたタグ付きテンプレートです。スタイル名はドットで連鎖でき、マークアップは入れ子にできます。

```typescript
import { colorTag } from "@libraz/node-cli";

const message = "disk full";

colorTag`Status: {green OK}`;
colorTag`{bold.red Error}: ${message}`;
colorTag`{dim outer {cyan inner} outer}`;
```

`color` と違い、このタグは未知の名前でも投げません。未知のスタイル名、閉じていない波括弧、欠けた空白は、そのままの文字として出力されます。埋め込まれた値はそのまま挿入され、マークアップとして解釈されないため、`{green ...}` を含む値もマークアップとは見なされません。色が無効のときはマークアップが取り除かれ、プレーンテキストが返されます。64 段を超える入れ子は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

### `ColorTag`

```typescript
type ColorTag = (strings: TemplateStringsArray, ...values: unknown[]) => string
```

`colorTag` の型であり、`createColorTag` が返すすべてのタグの型です。

### `createColorTag`

```typescript
function createColorTag(stream: Writable): ColorTag
```

`colorTag` と同じ意味を持ち、有効かどうかを `stream` から判定するタグを返します。そのため、そのストリームで色が有効なときにだけエスケープが出力されます。

```typescript
const e = createColorTag(process.stderr);
process.stderr.write(e`{bold.red Error}: something went wrong\n`);
```

### `createColorizer`

```typescript
function createColorizer(stream: Writable): Colorizer
```

有効・無効の判定を `process.stdout` ではなく `stream` から行う、`color` と同じ形のプロキシを返します。コマンドのアクション内で使うと、アクションが実際に書き込むストリームに色が追従します。

```typescript
const col = createColorizer(ctx.stdout);
ctx.stdout.write(`${col.green("done")}\n`);
```

### `isColorEnabled`

```typescript
function isColorEnabled(stream?: Writable): boolean
```

`stream` に対してエスケープコードが出力されるかどうかを返します。`stream` の既定値は `process.stdout` です。判定は次の順で行われます。

1. 明示的な `setColorEnabled()` による上書き。`NO_COLOR` を含め、すべてに優先します。
2. `NO_COLOR` が空でない値で設定されている場合は、色は無効です。
3. `FORCE_COLOR` が空でない値で設定されている場合、`"0"` と `"false"` は無効に、それ以外は有効に強制します。これは `TERM=dumb` にも、端末でないストリームにも優先します。
4. `TERM=dumb` の場合は、色は無効です。
5. ストリームが端末かどうか。

答えが `false` のときは、`bold` や `underline` のような修飾を含め、すべてのスタイルが落とされます。`NO_COLOR` と `setColorEnabled(false)` が止めるのは、色だけでなくスタイル全体です。

### `setColorEnabled`

```typescript
function setColorEnabled(value: boolean | "auto"): void
```

`true` と `false` は、プロセス全体で判定結果を固定します。`"auto"` は上書きを解除して自動判定に戻します。上書きは、プレーンテキストを検証するテストに向いた手段です。値が boolean でも文字列でもないときは、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を、`"auto"` 以外の文字列は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

### `stringWidth`

```typescript
function stringWidth(text: string): number
```

テキストが占める端末の桁数を返します。ANSI シーケンスは先に取り除かれ、結合文字、書式文字、制御文字は 0 桁として数えられます。East Asian Width が Wide または Fullwidth の文字と、絵文字表示の文字は 2 桁です。ゼロ幅接合子でつながれたスカラー値の並び（家族の絵文字など）は、2 桁の 1 つの書記素にまとめられます。

### `stripAnsi`

```typescript
function stripAnsi(text: string): string
```

ANSI エスケープシーケンスをすべて取り除きます。CSI、OSC、DCS/SOS/PM/APC の制御文字列、その他のあらゆるエスケープが対象です。

### `truncateAnsi`

```typescript
function truncateAnsi(text: string, width: number, ellipsis?: string): string
```

書記素を分割せずに `width` 桁へ切り詰めます。切り詰めたときは `ellipsis`（既定値は `"…"`）を付け、結果が開いたままにしてしまうスタイルやハイパーリンクを閉じます。このとき各スタイル属性を個別にリセットするため、外側のスタイルは残ります。`width` は正の整数で、`Infinity` は制限なしを表します。数値でない値はコード `ERR_INVALID_ARG_TYPE` の `TypeError` を、`0`、負の値、`NaN`、小数はコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

### `splitAnsi`

```typescript
function splitAnsi(text: string): readonly AnsiSegment[]

interface AnsiSegment {
  ansi: boolean;
  text: string;
}
```

入力を、エスケープシーケンス（`ansi: true`）と可視テキスト（`ansi: false`）の順序付きの並びに分割します。認識には `stripAnsi` と同じ認識器を使います。すべてのセグメントの `text` を連結すると入力が復元されるので、呼び出し側は可視部分だけを変換できます。

### `splitGraphemes`

```typescript
function splitGraphemes(text: string): readonly string[]
```

表示されるテキストを、ユーザーが 1 文字として知覚する書記素クラスタに分割します。そのため、修飾子つきの絵文字は 1 単位として数えられます。入力にエスケープシーケンスを含めてはいけません。含めると、ほかのテキストと同じように分割されてしまいます。先に `splitAnsi` で分け、`ansi` が `false` のセグメントだけを渡します。

### `sanitizeTerminalText`

```typescript
function sanitizeTerminalText(text: string, options?: SanitizeTerminalTextOptions): string

interface SanitizeTerminalTextOptions {
  singleLine?: boolean;
  allowHyperlinks?: boolean;
}
```

信頼できないテキストを、描画領域に出せる形に整えます。SGR のスタイルと OSC 8 のハイパーリンクは残り、カーソル移動、画面消去、タイトル変更は取り除かれます。テキストが開いたままにしたスタイルやハイパーリンクは閉じられます。

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `singleLine` | `true` | 改行が空白になります。`false` なら改行を保ちます。 |
| `allowHyperlinks` | `true` | `false` にすると OSC 8 のハイパーリンクも取り除きます。 |

### `isTTY`

```typescript
function isTTY(value: unknown): boolean
```

値が、`isTTY` が `true` のオブジェクトかどうかを判定します。オブジェクトでない値を含め、それ以外の値は `false` になります。[TTY](glossary.md#tty) を参照してください。

解説は[色](color.md)にあります。

## テーブル

### `table`

```typescript
function table<T extends object>(
  data: readonly T[],
  options?: TableOptions<T>,
): string
```

行を、末尾の改行なしで、揃えた文字列として描画します。オブジェクトの配列と配列の配列を受け付けます。結果は返されるだけで、書き込まれることはありません。行には、プレーンなオブジェクト、interface で型付けされた値、クラスのインスタンスを使えます。

`table` は折り返しません。列より幅の広いセルは省略記号付きで切り詰められ、セル内の改行とタブはすでに空白に畳まれています。全体の幅も端末に合わせて切り詰められることはなく、幅の広いテーブルは再整形されずに端末側で折り返されます。

未知の罫線やスタイル名、範囲外の数値は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。型の違う値は、文字列でも `ColumnSpec` でもない `columns` の要素を含め、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。

#### 列

`columns` には文字列と [`ColumnSpec`](#columnspec) のオブジェクトを渡せます。文字列は `{ key }` の省略形です。

| データの形 | 列 |
| --- | --- |
| オブジェクトの配列で、`columns` なし | すべての行が持つプロパティ名の和集合で、最初に現れた順。 |
| オブジェクトの配列で、`columns` あり | 列挙した列だけ。`key` がプロパティを選びます。 |
| 配列の配列で、`columns` なし | 0 行目がヘッダ。列は位置で対応付けられ、キーは `"0"`、`"1"`、… になります。 |
| 配列の配列、`columns` あり | 列は位置で対応付けられ、`ColumnSpec` は `key` を持ちません。このとき 0 行目はヘッダではなくデータです。 |

### `TableOptions`

```typescript
interface TableOptions<T extends object = Record<string, unknown>> {
  columns?: readonly (string | ColumnSpec<T>)[]; // a string is keyof T & string for object rows
  header?: boolean;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;
  borderStyle?: StyleSpec;
  headerStyle?: StyleSpec | "none";
  paddingLeft?: number;
  paddingRight?: number;
  gap?: number;
  rowSeparators?: boolean;
  ellipsis?: string;
  stream?: Writable;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `columns` | データから導出 | 描画する列を順に並べたもの。[列](#列)を参照してください。 |
| `header` | `true` | ヘッダ行を描画するかどうか。 |
| `border` | `"none"` | 罫線のプリセット。`border` なしで `chars` を渡すと `"custom"` になります。`"none"` では `chars` と `rowSeparators` は無視されます。 |
| `chars` | — | 罫線の文字を上書きします。`"custom"` は `"single"` プリセットを土台にします。どの文字も端末の 1 桁幅でなければならず、そうでなければコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。上辺と下辺の `top`、`bottom` と `horizontal` の埋め文字は、その線を省くために `""` にもできます。`border: "simple"` では、`vertical` と `cross` に任意の文字列を使えます。 |
| `borderStyle` | — | 罫線の文字のスタイル。`"dim"` や `"cyan.bold"` など。`border` が形を選び、`borderStyle` が色と修飾を選びます。 |
| `headerStyle` | `"bold"` | ヘッダ文字のスタイル。`"none"` はそのままにします。 |
| `paddingLeft` | 枠あり（`rounded`、`single`、`double`、`custom`）なら `1`、`none` と `simple` なら `0` | 各セルの内側の左の空白数。 |
| `paddingRight` | `paddingLeft` と同じ規則 | 各セルの内側の右の空白数。 |
| `gap` | `2` | 罫線のないテーブルの列の間の空白数。`border: "none"` のときだけ有効です。 |
| `rowSeparators` | `false` | データ行の間に区切り線を引きます。 |
| `ellipsis` | `"…"` | 切り詰めたセルに付ける記号。 |
| `stream` | `process.stdout` | 返される文字列に色を含めるかどうかを決めます。`table` はテキストを返すだけで書き込まないため、結果を出力する先のストリームを渡します。 |

### `ColumnSpec`

```typescript
type ColumnSpec<T extends object = Record<string, unknown>> = {
  key: keyof T & string; // object rows only; array rows have no key
  label?: string;
  align?: "left" | "right" | "center";
  width?: number;
  maxWidth?: number;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `key` | — | オブジェクトの行で読むプロパティ。`keyof T & string` で型付けされます。配列の行は位置で対応付けられ、`key` を持ちません。 |
| `label` | `key` | ヘッダの文字列。 |
| `align` | `"left"` | ヘッダとセルの揃え。 |
| `width` | 自動 | 列の内容の固定幅。パディングを含まない正の整数です。`maxWidth` より優先されます。 |
| `maxWidth` | — | パディングを除いた内容の幅の上限。正の整数か `Infinity` です。 |

`width` と `maxWidth` はどちらも内容の桁数を数えるため、パディングが文字の入る余地を減らすことはありません。内容の幅より広いセルは省略記号つきで切り詰められ、どの罫線モードでも、パディングはその外側に描かれます。

### `TableChars`

```typescript
interface TableChars {
  top?: string;
  topMid?: string;
  topLeft?: string;
  topRight?: string;
  bottom?: string;
  bottomMid?: string;
  bottomLeft?: string;
  bottomRight?: string;
  left?: string;
  leftMid?: string;
  right?: string;
  rightMid?: string;
  horizontal?: string;
  cross?: string;
  vertical?: string;
}
```

| フィールド | 枠の部品 |
| --- | --- |
| `top`、`bottom` | 上端と下端の水平線。 |
| `topMid`、`bottomMid` | 上端と下端で、2 つの列の間にある接合部。 |
| `topLeft`、`topRight`、`bottomLeft`、`bottomRight` | 四隅。 |
| `left`、`right` | すべての行の左端と右端。 |
| `leftMid`、`rightMid` | 行間の区切り線の左端と右端。 |
| `horizontal` | 行間の区切り線の水平線。 |
| `cross` | 区切り線と列の区切りが交わる部分。 |
| `vertical` | 1 行の中で 2 つの列を分ける区切り。 |

渡したグリフはサニタイズされるため、罫線の文字にエスケープシーケンスを入れても、テーブルの残りの部分のスタイルは変わりません。実際のレイアウトは[テーブル](table.md)を参照してください。

## プログレス

インジケータの出力先の既定値はすべて `process.stderr` で、リダイレクトされた stdout に進捗表示が混ざりません。インジケータは作成と同時に描画を始め、終了動詞（`succeed`、`fail`、`warn`、`stop`）のどれかで終わります。終了後にどのメソッドを呼んでも何も起きません。コマンドコンテキストをオプションのオブジェクトとして渡すこともでき（`progress.spinner(ctx)`）、その場合は `ctx.stderr` に描画されます。

動詞 `succeed`、`fail`、`warn` は、指標を結果の行に置き換えます。緑の `✔`、赤の `✖`、黄の `⚠` の後に `message` が続き、既定値はラベルです。ストリームが記号を描けない場合（端末でない、または `TERM=dumb`）は、行頭が記号の代わりに ASCII の印 `[OK]`、`[ERROR]`、`[WARN]` になります。色は [`isColorEnabled`](#iscolorenabled) が別に判定します。`stop` は最後のフレームを残して行を終えます。

### progress.bar

```typescript
progress.bar(options: BarOptions): Bar
```

#### `BarOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `total` | `number` | — | 必須。`0` 以上の有限の数。それ以外は例外を投げます。`total` が `0` なら完了として描画されます。 |
| `label` | `string` | `""` | バーの前に置くテキスト。 |
| `width` | `number` | `30` | バーの幅（文字数）。`1` から `4096` まで。小数は整数部分で描画されます。それ以外は例外を投げます。 |
| `filled` | `string` | `"█"` | 塗りつぶし部分の文字。表示幅は `1` でなければなりません。 |
| `empty` | `string` | `"░"` | 空の部分の文字。表示幅は `1` でなければなりません。 |
| `format` | `(state: BarState) => string` | — | 描画される行全体を置き換えます。そのため `width`、`filled`、`empty`、`style` は使われず、`label` は既定の結果メッセージにだけ使われます。結果は端末で安全な 1 行にまとめられます。throw すると、バー（またはそのグループ）は端末を解放して何もしなくなり、エラーは再描画を引き起こした呼び出しから伝わります。 |
| `stderr` | `Writable` | `process.stderr` | 出力先のストリーム。 |
| `style` | [`StyleSpec`](#style-types) | — | バーに適用するスタイル。`"green"` や `"bold.cyan"` など。未知の名前は作成時に投げます。 |

不正なオプションは、コード `ERR_INVALID_ARG_TYPE` の `TypeError` か、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

#### `Bar`

| メソッド | 説明 |
| --- | --- |
| `update(current: number)` | 進捗を絶対値で設定し、`0` から `total` の範囲に収めます。`NaN` と無限大は無視されます。数値でない値は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。 |
| `tick(delta?: number)` | `delta`（既定は `1`）を加え、`0` から `total` の範囲に収めます。結果が `NaN` または無限大のときは無視されます。 |
| `setLabel(label: string)` | バーの前に描かれるラベル、および既定の結果メッセージを置き換えます。 |
| `succeed(message?: string)` | 進捗を `total` にして、バーを `✔` の結果行で終えます。 |
| `fail(message?: string)` | 現在の位置のまま、バーを `✖` の結果行で終えます。 |
| `warn(message?: string)` | 現在の位置のまま、バーを `⚠` の結果行で終えます。 |
| `stop()` | 最後のフレームを残して行を終えます。`MultiBar` の中では、そのバーの行を固定し、グループの動詞はその行を飛ばします。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

`Symbol.dispose` があるので、バーは `using` 宣言で使えます。`using` はブロックの終わりで、ブロックが throw した場合も含めて、破棄用のメソッドを自動的に呼びます。

```typescript
{
  using bar = progress.bar({ total: 100 });
  bar.update(50);
} // stop() runs here
```

#### `BarState`

```typescript
interface BarState {
  readonly current: number;
  readonly total: number;
  readonly percent: number; // integer, 0 to 100; 100 when total is 0
  readonly elapsedMs: number; // ms since the bar was created
  readonly etaMs: number; // ms remaining; Infinity until some progress is made, 0 once complete
  readonly ratePerSecond: number; // units per second
}
```

`etaMs` は、書式化する前に `Number.isFinite` で確認します。

### progress.spinner

```typescript
progress.spinner(options?: SpinnerOptions): Spinner
```

#### `SpinnerOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `label` | `string` | `""` | フレームの横に置くテキスト。 |
| `frames` | `readonly string[]` | 点字のドット | アニメーションのフレーム。配列でない値や文字列でない要素は `TypeError`、空の配列は `RangeError` を投げます。 |
| `intervalMs` | `number` | `80` | フレーム間のミリ秒数。正の有限な数でなければなりません。 |
| `stderr` | `Writable` | `process.stderr` | 出力先のストリーム。 |
| `style` | [`StyleSpec`](#style-types) | — | フレームに適用するスタイル。未知の名前は作成時に投げます。 |

#### `Spinner`

| メソッド | 説明 |
| --- | --- |
| `setLabel(label: string)` | ラベルを置き換えます。次のフレームから反映されます。 |
| `succeed(message?: string)` | スピナーを `✔` の結果行で終えます。 |
| `fail(message?: string)` | スピナーを `✖` の結果行で終えます。 |
| `warn(message?: string)` | スピナーを `⚠` の結果行で終えます。 |
| `stop()` | 最後のフレームをそのまま残して、行を終わらせます。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

### 端末でないストリームでの挙動

端末でないストリームに書くバーやスピナーは、動作中は何も出力せず、`stop` も何も書きません。リダイレクトしたログが制御シーケンスで埋まることはありません。`succeed`、`fail`、`warn` は、結果の行を必ず 1 行書きます。そのため、出力を取り込むスクリプトにインジケータを残しておいても安全です。結果は記録され、アニメーションは記録されません。`TERM=dumb` のときも同じです。

### progress.multi

```typescript
progress.multi(options?: MultiBarOptions): MultiBar
```

#### `MultiBarOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `stderr` | `Writable` | `process.stderr` | グループ内のすべてのバーが共有するストリーム。 |

グループは作成時にストリームを確保します。1 つのフレームを複数の端末領域に分けることはできないため、`add` は `stderr` を取りません。

#### `MultiBar`

| メソッド | 説明 |
| --- | --- |
| `add(options: Omit<BarOptions, "stderr">): Bar` | グループのストリームに描かれるバーを追加し、そのハンドルを返します。 |
| `succeed(message?: string)` | 未完了のバーをすべて `✔` で終え、グループを閉じます。 |
| `fail(message?: string)` | 未完了のバーをすべて `✖` で終え、グループを閉じます。 |
| `warn(message?: string)` | 未完了のバーをすべて `⚠` で終え、グループを閉じます。 |
| `stop()` | 最後のフレームをそのまま残して、グループを閉じます。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

グループのメソッドでは、`message` が記号なしの最終行として 1 行書かれます。端末でないストリームでは、各バーの結果行がバーの終了時に書かれます。

グループが閉じた後に呼んだ `add` は、すべてのメソッドが何もしない無効なバーを返します。そのため、`finally { multi.stop() }` の直後にバーを追加するワーカーがいても失敗しません。

2 つの単独の指標は、同じ端末ストリームに同時には描画できません。互いの行レイアウトを知り得ないため、2 つ目は、ストリームを保持している指標の種類を名指しした、コード `ERR_OUTPUT_BUSY` のエラーを投げます。並行して動くバーは `multi` グループに入れます。

### progress.releaseAll

```typescript
progress.releaseAll(): void
```

プロセス内でまだ動いているすべての指標を、どのコマンドが作ったかに関係なく停止し、端末のカーソルを元に戻します。コマンドの実行が解放するのは、そのコマンド自身が作った指標だけなので、終了したコマンドが別のコマンドのスピナーを消すことはありません。プロセス全体を明示的にリセットしたいときに `releaseAll` を呼びます。

使い方の実例は[プログレス](progress.md)を参照してください。

## プロンプト

プロンプトは stderr で質問するため、質問がリダイレクトされた stdout を汚すことはありません。どのプロンプトも、Ctrl-C のとき、または `signal` が abort されたときに `CancelledError` で reject されます。後者の `cause` はシグナルの reason です。すでに abort 済みの `signal` は、すぐに reject されます。`stdin` が `null` のとき、または答える前に入力が終わった（Ctrl-D）ときは、再質問の最中も含めて `InputEndedError` で reject されます。入力ストリームの読み取りエラーは、そのストリーム自身のエラーで reject されます。throw する `validate` は reject ではありません。メッセージが表示され、プロンプトはもう一度質問します。メッセージと `marker` は 1 行で描画され、改行は空白になり、カーソル制御は取り除かれます。

同じ入力ストリームから 2 つのプロンプトが同時に読もうとすると、コード `ERR_INPUT_BUSY` のエラーを投げます。2 つ目が 1 つ目のキー入力を奪ってしまうためです。

### `PromptOptions`

```typescript
type PromptOptions<T = unknown> = Pick<StdioOptions, "stdin" | "stderr" | "signal"> & {
  validate?: (value: T) => void | Promise<void>;
  marker?: string;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `stdin` | `process.stdin` | 答えを読む先。省略すると `process.stdin` が選ばれます。`null` は入力なしを意味し、プロンプトは質問を書く前に `InputEndedError` で reject されます。 |
| `stderr` | `process.stderr` | 質問を書き込む出力。 |
| `signal` | — | abort すると、保留中のプロンプトが `CancelledError` で reject されます。 |
| `validate` | — | throw または reject で値を拒否します。プロンプトはメッセージを表示して、もう一度尋ねます。 |
| `marker` | `"?"` | 質問の前に表示される記号。 |

すべてのプロンプトのオプション型がこの型を拡張しています。ストリーム関連のメンバーは `StdioOptions` と同じなので、コマンドコンテキストをオプションとして渡せます。`prompt.confirm("Continue?", ctx)` のように書きます。

### prompt.text

```typescript
prompt.text(message: string, options?: TextOptions): Promise<string>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `string` | — | 空のまま送信されたときに補う値。 |
| `placeholder` | `string` | — | `(e.g. …)` の形で表示される例。`default` がないときだけ表示されます。 |
| `trim` | `boolean` | `true` | 回答の前後の空白を取り除きます。 |
| `required` | `boolean` | `true` | 空の回答を拒否します。 |

明示した `default`（`""` を含む）は `required` を迂回します。何も入力せずに送信すると、「値が必要です」というメッセージではなく既定値が返ります。

### prompt.confirm

```typescript
prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `boolean` | `false` | 空のまま送信されたときに返す値。`(Y/n)` と `(y/N)` のどちらのヒントを出すかも決めます。 |

`y`、`yes`、`n`、`no` を大文字・小文字を問わず受け付けます。それ以外は再度尋ねます。

### prompt.select

```typescript
prompt.select<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options?: SelectOptions<NoInfer<T>>,
): Promise<T>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `T` | — | 空の入力に対して返される値。選択肢の `value`、または選択肢のオブジェクト自体と同一性で照合されます。どの選択肢にも一致しない `default` は、質問を書く前にコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。 |

選択肢には、表示された番号で答えるか、ラベルを入力して答えます。ラベルの照合は大文字・小文字を区別しません。リストの範囲内の数値は常に番号として選択されるため、数字に見えるラベルも位置で選べます。それ以外の入力はラベルと照合されます。`choices` の配列が空なら、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

### prompt.multiselect

```typescript
prompt.multiselect<const T = string>(
  message: string,
  choices: readonly Choice<T>[],
  options?: MultiselectOptions<NoInfer<T>>,
): Promise<readonly T[]>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `readonly T[]` | — | あらかじめ選択される値で、空の入力に対して返されます。各要素はいずれかの選択肢に一致する必要があり、そうでなければ質問を書く前にコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。 |
| `min` | `number` | — | 重複を除いた選択数の下限。省略すると、空の結果も受け付けます。 |
| `max` | `number` | — | 重複を除いた選択数の上限。 |

カンマ区切りの番号で答えます。`min` と `max` を検査する前に、重複は 1 つにまとめられます。`min` が `max` より大きい場合、`min` が選択肢の数より大きい場合、境界が整数でない場合は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

### prompt.password

```typescript
prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `trim` | `boolean` | `false` | 既定ではオフです。`prompt.text` と違い、前後の空白が秘密の一部である場合があるためです。 |
| `required` | `boolean` | `true` | 空の回答を拒否します。 |

`default` はありません。入力された文字は、書記素ごとに 1 つのアスタリスクでマスクされます。そのため、マスクから入力した文字の表示幅もスカラー値の数も分かりません。

`required` があるのは `prompt.text` と `prompt.password` だけです。ほかのプロンプトにこのオプションはありません。

### Choice と SelectChoice

```typescript
interface SelectChoice<T> {
  label: string;
  value: T;
  hint?: string;
}

type Choice<T> = SelectChoice<T> | Exclude<T, { label: unknown }>;
```

選択肢は、値そのものか、記述子のどちらかです。`label` はあるが `value` がない記述子は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。たまたま `label` プロパティを持つ普通のドメインオブジェクトが、黙って `undefined` に変えられることはありません。`label` メンバーを持つ値のオブジェクトをそのまま渡すと型エラーになります。`{ label, value }` で包みます。

使い方の実例は[プロンプト](prompts.md)を参照してください。

## ログ出力

### `createLogger`

```typescript
function createLogger(options?: LoggerOptions): Logger
```

`info` と `success` を含むすべてのレベルは、1 つのストリームに書かれ、既定は `process.stderr` です。レベルによって stdout と stderr を振り分けることはありません。ストリームは `stderr` オプションで指定し、コマンドコンテキストをオプションのオブジェクトとして渡すこともできます（`createLogger({ ...ctx, prefix: "deploy" })`）。ログを stdout に出すには、`stderr: process.stdout` を渡します。

未知の `level` や不正な `bufferLimit` は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

#### `LoggerOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `"info"` | 最低レベル。これより低いレベルは捨てられます。 |
| `prefix` | `string` | — | 各行に付く、角括弧で囲まれた接頭辞。 |
| `timestamp` | `boolean` | `false` | `HH:MM:SS` を先頭に付けます。 |
| `stderr` | `Writable` | `process.stderr` | 出力先のストリーム。 |
| `bufferLimit` | `number` | `1000` | ストリームが背圧を受けている間にキューに溜める行数。満杯になると最も古い行を捨てます。`0` は、背圧を受けている間に書かれた行をドレインされるまですべて捨てます。非負の安全な整数でなければなりません。 |

#### `Logger`

| メソッド | 判定されるレベル | 記号 | ASCII の印 |
| --- | --- | --- | --- |
| `debug(message, ...args)` | `debug` | `●` | `[DEBUG]` |
| `info(message, ...args)` | `info` | `ℹ` | `[INFO]` |
| `success(message, ...args)` | `info` | `✔` | `[OK]` |
| `warn(message, ...args)` | `warn` | `⚠` | `[WARN]` |
| `error(message, ...args)` | `error` | `✖` | `[ERROR]` |

`success` は独立したレベルではなく `info` でゲートされます。したがってレベルを `warn` にすると出力されなくなります。

記号が使われるのは、ストリームが端末で、かつ `TERM` が `dumb` でないときです。それ以外では ASCII の印が使われます。色は [`isColorEnabled`](#iscolorenabled) が別に判定し、どちらにも適用されます。そのため、端末で `NO_COLOR` を設定しても記号は残り、パイプで `FORCE_COLOR` を設定すると印に色が付きます。

メッセージは `node:util` の `format` 関数を通るため、`%s`、`%d`、`%j` のプレースホルダが使え、文字列でない最初の引数もそのまま渡されずに整形されます。

| メソッド | 説明 |
| --- | --- |
| `setLevel(level: LogLevel)` | 最小レベルを実行時に変更し、ロガー自身を返します。 |
| `child(prefix: string): Logger` | プレフィックスが `parent:child` の子を作ります。子が独自のレベルを持たない間は親の現在のレベルに従うため、後から `parent.setLevel(...)` を呼ぶと子にも及びます。 |
| `flush(): Promise<void>` | キューにある行が、すべての子の分も含めてストリームに届くと解決します。先にストリームがエラーになるか閉じると reject されます。ストリームが失敗した後は、ロガーとその子は何もしなくなります。以降の行は黙って捨てられ、失敗は `flush()` を通じてだけ報告されます。 |

### `LogLevel`

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

`"silent"` はすべてのレベルを抑制します。[ログ出力](logging.md)を参照してください。

### `isLogLevel`

```typescript
function isLogLevel(value: unknown): value is LogLevel
```

`value` が `LogLevel` の文字列のいずれかかどうかを判定します。文字列でない値を含め、それ以外の値は `false` になります。

## エラー

### `CLIError`

```typescript
class CLIError extends Error {
  readonly code: CLIErrorCode | (string & {});
  readonly exitCode: number;
  constructor(message: string, options?: CLIErrorOptions);
}
```

フレームワークがユーザー入力について投げるすべてのエラーの基底クラスであり、アプリケーションが自分で投げるエラーにも使えます。`code` は機械可読で、既定値は `"FAILED"` です。これは `CLIErrorCode` のメンバーではありません。`exitCode` は失敗が意味するプロセスのステータスで、`1` から `255` の整数、既定値は `1` です。`cause` は `Error` に渡されます。アプリケーションのサブクラスは独自のコードを持てます。

```typescript
throw new CLIError("Deployment target is locked", { code: "LOCKED", exitCode: 75 });
```

数値でない `exitCode` は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げます。`1` から `255` の整数でない `exitCode` は、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。`0` は成功に見え、`256` は POSIX では `0` に折り返されるためです。

### `CLIErrorOptions`

```typescript
interface CLIErrorOptions {
  code?: CLIErrorCode | (string & {});
  exitCode?: number;
  cause?: unknown;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `code` | `"FAILED"` | 機械可読なエラーコード。 |
| `exitCode` | `1` | プロセスの終了ステータス。`1` から `255` の整数です。 |
| `cause` | — | 根本のエラー。`Error` に渡されます。 |

### `CLIErrorCode`

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

### サブクラス

どのサブクラスのコンストラクタも、先頭に対象を、最後にオプションのオブジェクトを取ります。オプションのオブジェクトは省略でき、どれも `cause` を受け付けます。

| クラス | コンストラクタ | `code` | `exitCode` | 追加のフィールド | 投げられるとき |
| --- | --- | --- | --- | --- | --- |
| `CommandNotFoundError` | `(input, { available?, cause? })` | `COMMAND_NOT_FOUND` | `64` | `input`, `available?` | 入力に一致するコマンドがないとき、またはコマンドグループに未知の子が渡されたとき。 |
| `MissingArgumentError` | `(argName, { usage?, cause? })` | `MISSING_ARGUMENT` | `64` | `argName`, `usage?` | 必須の位置引数がないとき、または必須の可変長引数が値をゼロ個しか受け取らないとき。 |
| `ExtraArgumentError` | `(extras, { usage?, cause? })` | `EXTRA_ARGUMENT` | `64` | `extras`, `usage?` | コマンドが宣言した数より多くの位置引数の値が渡されたとき。`extras` は空でない `readonly string[]` で、空配列はコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。 |
| `MissingOptionError` | `(optionName, { usage?, cause? })` | `MISSING_OPTION` | `64` | `optionName`, `usage?` | `required` なオプションがないとき。 |
| `InvalidOptionError` | `(message, { optionName?, value?, usage?, cause? })` | `INVALID_OPTION` | `64` | `optionName?`, `value?`, `usage?` | 値が組み込みの型変換または `choices` のチェックに通らないとき、あるいはオプションが受け付けない形式で使われたとき。 |
| `UnknownOptionError` | `(flag, { usage?, cause? })` | `UNKNOWN_OPTION` | `64` | `flag`, `optionName`, `usage?` | コマンドが宣言していないフラグが渡されたとき。`flag` は未知のフラグを 1 つ、正規化した形で表します（`--xyz=3` は `--xyz`、クラスタ `-vx` の中の未知の `x` は `-x`）。`optionName` は先頭のダッシュを除いた名前です。 |
| `ValidationError` | `(message, { optionName?, value?, usage?, cause? })` | `VALIDATION_FAILED` | `64` | `optionName?`, `value?`, `usage?` | オプション自身の `parse` または `validate` が throw または reject したとき、あるいはコマンドの `validate` が `CLIError` でない値を投げたとき。 |
| `ParseError` | `(message, { quote?, cause? })` | `PARSE_FAILED` | `64` | `quote?` | 入力をトークン化できない、またはパイプラインのステージに分割できないとき。 |
| `CancelledError` | `({ cause? })` | `CANCELLED` | `130` | — | プロンプトが Ctrl-C または abort されたシグナルでキャンセルされたとき、あるいは実行中のコマンドがそのシグナルでキャンセルされたとき。`cause` は、あればシグナルの reason です。 |
| `InputEndedError` | `(promptMessage, { cause? })` | `INPUT_ENDED` | `66` | `promptMessage` | プロンプトに読み取れる入力がないとき。`stdin` が `null` のとき、または答える前に入力が終わったとき。 |

`ValidationError` が包むのは、オプションの `parse` と `validate`、および `CommandBuilder.validate()` の失敗です。ただし、投げられた `CLIError` は元のクラス、コード、終了コードを保ったままそのまま伝わり、キャンセルは `CancelledError` のままです。オプションの場合は `optionName` が設定され、`value` は `parse` が失敗したときは生の入力文字列、`validate` が失敗したときは `validate` に渡された値になり、`cause` には元の値が入ります。

`optionName` は、ダッシュを除いた正のロング名を kebab-case の綴りのまま表したもの（`dry-run`）で、そのオプションの `ctx.options` でのキーは camelCase の形（`dryRun`）です。`UnknownOptionError.optionName` には対応する定義がないため、入力されたフラグからダッシュを除いたものです。

コマンドの解決中に起きたエラーは、コマンドの使い方の行である `usage` を持ち、メッセージの末尾に `\n\n  Usage: <usage>` を付けます。メッセージは、ユーザーが入力したものを引用符で囲み、アプリケーションが定義した名前は囲みません（`Unknown option: "--x"`、`Missing required option: --x`）。API の誤用のメッセージ（`UsageErrorCode` を参照）は、Node 自身のエラーと同じ形で、アプリケーションの名前も引用符で囲みます。

`ParseError` が扱うのは、閉じていない引用符（`quote` が `"single"` か `"double"` で、どちらかを示します）、空のパイプまたは末尾のパイプ、サポートされないリダイレクト演算子です。コマンドが解決される前に投げられるため、登録済みの `fallback` ハンドラには、エラーが投げられる代わりに入力が渡されます。

ユーザー入力に関するクラスの終了コードは、コマンドラインの使い方の誤りに対する慣例のステータスである `64` です。`InputEndedError` は `66`（入力なし）、`CancelledError` は、中断されたプログラムに対する慣例のステータスである `130` です。素の `CLIError` の既定値は `1` で、アクションが投げたそれ以外の値も `1` です。対話シェルの SIGTERM の経路は `143` で終了します。[終了コード](glossary.md#exit-code)を参照してください。

クラス名 `ValidationError` と `ParseError` は、コード `VALIDATION_FAILED` と `PARSE_FAILED` に対応します。ほかのコードはすべて、クラス名を大文字のスネークケースにしたものです。

### `BuiltinCLIError`

```typescript
type BuiltinCLIError =
  | CommandNotFoundError
  | MissingArgumentError
  | ExtraArgumentError
  | MissingOptionError
  | InvalidOptionError
  | UnknownOptionError
  | ValidationError
  | ParseError
  | CancelledError
  | InputEndedError;
```

上記の 10 個のクラスのユニオンで、`code` で判別できます。

### `isBuiltinCLIError`

```typescript
function isBuiltinCLIError(e: unknown): e is BuiltinCLIError
```

値が 10 個の組み込みサブクラスのいずれかかどうかを判定します。素の `CLIError` とアプリケーションのサブクラスは一致しないため、それらは `instanceof` で調べます。

```typescript
import { isBuiltinCLIError } from "@libraz/node-cli";

try {
  await cli.exec(["deploy"]);
} catch (err) {
  if (isBuiltinCLIError(err) && err.code === "MISSING_ARGUMENT") {
    // err is narrowed to MissingArgumentError
    console.error(err.argName);
  }
}
```

### `UsageErrorCode`

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

呼び出し側のプログラムによる API の誤用を知らせるエラーが持つコードです。利用者の入力が原因の失敗とは区別されます。これらのエラーは `CLIError` のインスタンスではなく、Node 自身のエラーと同じ流儀で `code` プロパティを持つ、素の `TypeError`、`RangeError`、`Error` です。

| コード | クラス | 投げられるとき |
| --- | --- | --- |
| `ERR_INVALID_ARG_TYPE` | `TypeError` | 引数やオプションの型が正しくないとき。 |
| `ERR_INVALID_ARG_VALUE` | `RangeError` | 値が範囲外のとき、またはスタイル、罫線、ログレベルなど未知のものを指しているとき。 |
| `ERR_INVALID_DEFINITION` | `Error` | 定義文字列、オプションのフラグ、オプションのスキーマが不正、または自己矛盾しているとき。 |
| `ERR_DEFINITION_CONFLICT` | `Error` | オプションの名前やエイリアス、あるいはコマンドのエイリアスがすでに使われているとき。 |
| `ERR_COMMAND_REMOVED` | `Error` | 削除済みのコマンドに設定を呼んだとき。 |
| `ERR_ALREADY_STARTED` | `Error` | `start` を 2 回呼んだとき。 |
| `ERR_OUTPUT_BUSY` | `Error` | 2 つ目のインジケータが、別のインジケータが保持している端末ストリームを確保しようとしたとき。 |
| `ERR_INPUT_BUSY` | `Error` | 2 つ目のプロンプトが、別のプロンプトが保持している入力ストリームから読もうとしたとき。 |
| `ERR_PLUGIN_FAILED` | `Error` | 非同期プラグインが初期化中に失敗したとき。`cause` に元の値が入ります。 |

### `formatErrorMessage`

```typescript
function formatErrorMessage(err: unknown): string
```

投げられた値をユーザー向けのテキストにして返します。テキストは複数行になりえます。`Error` ならそのメッセージ、文字列ならその文字列、それ以外の値なら `util.inspect` の出力です。テキストはフレームワーク自身の `Error:` の行と同じく、端末向けに無害化されます。制御シーケンスとハイパーリンクは取り除かれ、スタイルは閉じられ、改行は残ります。

### `isCancellationError`

```typescript
function isCancellationError(err: unknown, signal: AbortSignal): boolean
```

失敗が本物の障害ではなく、ユーザーが起こしたキャンセルかどうかを判定します。`CancelledError` は常に該当します。素の `AbortError` が該当するのは、`signal` が abort 済みのときに **限ります**。その根拠がなければ、誰のキャンセルなのかを判別できず、無関係な abort 済みのリクエストが、ユーザーが Ctrl-C を押したものと誤って報告されてしまいます。

```typescript
import { isCancellationError } from "@libraz/node-cli";

try {
  await work(ctx.signal);
} catch (err) {
  if (isCancellationError(err, ctx.signal)) return;
  throw err;
}
```

[エラー](errors.md)を参照してください。

## 低レベルの解析ヘルパー

### `tokenize`

```typescript
function tokenize(input: string): readonly string[]
```

1 つのコマンドを、シングルクォート、ダブルクォート、バックスラッシュエスケープを尊重して、argv 形式のトークンに分割します。パイプラインは扱いません。ここでは `|` は普通の文字ですが、`execLine` は引用符に囲まれていない `|` で先に行を分割します。そのため、行に `|` が含まれていると `exec(tokenize(line))` と `execLine(line)` は異なります。文字列でない値は、コード `ERR_INVALID_ARG_TYPE` の `TypeError` を投げ、閉じていない引用符は `ParseError` を投げます。連携するコードがフレームワークと全く同じ挙動を再利用できるようにエクスポートされており、通常のアプリケーションでは必要ありません。

## 環境変数

| 変数 | 効果 |
| --- | --- |
| `NO_COLOR` | 空でない値なら色を無効にします。`setColorEnabled(true)` が呼ばれていれば無効になりません。 |
| `FORCE_COLOR` | `"0"` または `"false"` なら色を無効にし、それ以外の空でない値なら有効にします。`TERM=dumb` にも端末でないストリームにも優先します。 |
| `TERM` | `TERM=dumb` なら色を無効にします。`FORCE_COLOR` が別の指定をしていればそちらに従います。 |
| `NODE_CLI_DEBUG` | `NODE_CLI_DEBUG=1` は、致命的なエラーを通常の `Error: <message>` の行の代わりに、完全なスタックトレースと、`cause` の連鎖をたどった各 `cause` のスタックで表示します。 |

```bash
NODE_CLI_DEBUG=1 myapp deploy prod
```

`NODE_CLI_DEBUG` が効くのは、直接 argv で実行する経路だけです。対話シェルの中で失敗したコマンドは、常にメッセージだけを表示します。シェルはその後も動き続けるため、セッションの途中でスタックトレースを出してもノイズになるからです。

## エクスポート一覧

| エクスポート | 種別 | セクション |
| --- | --- | --- |
| `createCLI` | 関数 | [CLI の作成](#createcli) |
| `CLI` | 型 | [CLI の作成](#cli) |
| `CLIOptions` | 型 | [CLI の作成](#clioptions) |
| `HistoryFilter` | 型 | [CLI の作成](#historyfilter) |
| `StdioOptions` | 型 | [CLI の作成](#stdiooptions) |
| `FallbackHandler` | 型 | [CLI の作成](#fallbackhandler) |
| `FallbackContext` | 型 | [CLI の作成](#fallbackcontext) |
| `CommandBuilder` | 型 | [コマンドの定義](#commandbuilder) |
| `Action` | 型 | [コマンドの定義](#action) |
| `CommandValidator` | 型 | [コマンドの定義](#commandvalidator) |
| `CancelHandler` | 型 | [コマンドの定義](#cancelhandler) |
| `Completer` | 型 | [コマンドの定義](#completer) |
| `CompletionContext` | 型 | [コマンドの定義](#completioncontext) |
| `CommandContext` | 型 | [実行コンテキスト](#commandcontext) |
| `CommandStreams` | 型 | [実行コンテキスト](#commandstreams) |
| `OptionSchema` | 型 | [オプション](#optionschema) |
| `CLIEventMap` | 型 | [イベントとプラグイン](#clieventmap) |
| `CLIEventHandler` | 型 | [イベントとプラグイン](#clieventhandler) |
| `PluginContext` | 型 | [イベントとプラグイン](#plugincontext) |
| `Plugin` | 型 | [イベントとプラグイン](#plugin) |
| `Shell` | 型 | [対話シェル](#shell) |
| `ModeOptions` | 型 | [対話シェル](#modeoptions) |
| `ModeAction` | 型 | [対話シェル](#modeaction) |
| `ModeContext` | 型 | [対話シェル](#modecontext) |
| `tokenize` | 関数 | [低レベルの解析ヘルパー](#tokenize) |
| `color` | 値 | [色と端末テキスト](#color) |
| `StyleName` | 型 | [色と端末テキスト](#スタイルの型) |
| `StyleSpec` | 型 | [色と端末テキスト](#スタイルの型) |
| `ColorFn` | 型 | [色と端末テキスト](#スタイルの型) |
| `Colorizer` | 型 | [色と端末テキスト](#スタイルの型) |
| `ColorTag` | 型 | [色と端末テキスト](#colortag) |
| `isStyleName` | 関数 | [色と端末テキスト](#isstylename) |
| `colorTag` | 値 | [色と端末テキスト](#colortag) |
| `createColorTag` | 関数 | [色と端末テキスト](#createcolortag) |
| `createColorizer` | 関数 | [色と端末テキスト](#createcolorizer) |
| `isColorEnabled` | 関数 | [色と端末テキスト](#iscolorenabled) |
| `setColorEnabled` | 関数 | [色と端末テキスト](#setcolorenabled) |
| `stringWidth` | 関数 | [色と端末テキスト](#stringwidth) |
| `stripAnsi` | 関数 | [色と端末テキスト](#stripansi) |
| `truncateAnsi` | 関数 | [色と端末テキスト](#truncateansi) |
| `splitAnsi` | 関数 | [色と端末テキスト](#splitansi) |
| `AnsiSegment` | 型 | [色と端末テキスト](#splitansi) |
| `splitGraphemes` | 関数 | [色と端末テキスト](#splitgraphemes) |
| `sanitizeTerminalText` | 関数 | [色と端末テキスト](#sanitizeterminaltext) |
| `SanitizeTerminalTextOptions` | 型 | [色と端末テキスト](#sanitizeterminaltext) |
| `isTTY` | 関数 | [色と端末テキスト](#istty) |
| `table` | 関数 | [テーブル](#table) |
| `TableOptions` | 型 | [テーブル](#tableoptions) |
| `ColumnSpec` | 型 | [テーブル](#columnspec) |
| `TableChars` | 型 | [テーブル](#tablechars) |
| `progress` | 値 | [プログレス](#プログレス) |
| `Bar` | 型 | [プログレス](#bar) |
| `BarOptions` | 型 | [プログレス](#baroptions) |
| `BarState` | 型 | [プログレス](#barstate) |
| `Spinner` | 型 | [プログレス](#spinner) |
| `SpinnerOptions` | 型 | [プログレス](#spinneroptions) |
| `MultiBar` | 型 | [プログレス](#multibar) |
| `MultiBarOptions` | 型 | [プログレス](#multibaroptions) |
| `prompt` | 値 | [プロンプト](#プロンプト) |
| `PromptOptions` | 型 | [プロンプト](#promptoptions) |
| `TextOptions` | 型 | [プロンプト](#prompttext) |
| `ConfirmOptions` | 型 | [プロンプト](#promptconfirm) |
| `SelectOptions` | 型 | [プロンプト](#promptselect) |
| `MultiselectOptions` | 型 | [プロンプト](#promptmultiselect) |
| `PasswordOptions` | 型 | [プロンプト](#promptpassword) |
| `Choice` | 型 | [プロンプト](#choice-と-selectchoice) |
| `SelectChoice` | 型 | [プロンプト](#choice-と-selectchoice) |
| `createLogger` | 関数 | [ログ出力](#createlogger) |
| `Logger` | 型 | [ログ出力](#logger) |
| `LoggerOptions` | 型 | [ログ出力](#loggeroptions) |
| `LogLevel` | 型 | [ログ出力](#loglevel) |
| `isLogLevel` | 関数 | [ログ出力](#isloglevel) |
| `CLIError` | クラス | [エラー](#clierror) |
| `CLIErrorCode` | 型 | [エラー](#clierrorcode) |
| `CLIErrorOptions` | 型 | [エラー](#clierroroptions) |
| `CommandNotFoundError` | クラス | [エラー](#サブクラス) |
| `MissingArgumentError` | クラス | [エラー](#サブクラス) |
| `ExtraArgumentError` | クラス | [エラー](#サブクラス) |
| `MissingOptionError` | クラス | [エラー](#サブクラス) |
| `InvalidOptionError` | クラス | [エラー](#サブクラス) |
| `UnknownOptionError` | クラス | [エラー](#サブクラス) |
| `ValidationError` | クラス | [エラー](#サブクラス) |
| `ParseError` | クラス | [エラー](#サブクラス) |
| `CancelledError` | クラス | [エラー](#サブクラス) |
| `InputEndedError` | クラス | [エラー](#サブクラス) |
| `BuiltinCLIError` | 型 | [エラー](#builtinclierror) |
| `isBuiltinCLIError` | 関数 | [エラー](#isbuiltinclierror) |
| `UsageErrorCode` | 型 | [エラー](#usageerrorcode) |
| `formatErrorMessage` | 関数 | [エラー](#formaterrormessage) |
| `isCancellationError` | 関数 | [エラー](#iscancellationerror) |

## 関連ページ

- [コマンド](commands.md) — コマンドの定義、サブコマンド、検証、キャンセル。
- [オプション](options.md) — オプションスキーマを解説の形で。
- [対話シェル](interactive-shell.md) — プロンプト、履歴、補完、パイプ、モード。
- [色](color.md)、[テーブル](table.md)、[プログレス](progress.md)、[プロンプト](prompts.md)、[ログ出力](logging.md) — 出力ツールキット。
- [イベントとプラグイン](events-and-plugins.md) — ライフサイクルのフックとプラグインのパッケージング。
- [エラー](errors.md) — 失敗がどう報告され、それぞれどの終了コードになるか。
- [実例](examples.md) — 動作する完全なプログラム。
- [用語集](glossary.md) — これらのページで使う用語。

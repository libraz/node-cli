# API リファレンス

公開シンボルはすべてパッケージルートからエクスポートされます。サブパスのエクスポートはありません。

```typescript
import { createCLI, table, progress, prompt, logger } from "@libraz/node-cli";
```

このパッケージは ESM 専用で、Node 22 以降が必要です。

## 目次

- [型のみのエクスポート](#型のみのエクスポート)
- [CLI の作成](#cli-の作成)
- [コマンドの定義](#コマンドの定義)
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
- [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー)
- [環境変数](#環境変数)
- [エクスポート一覧](#エクスポート一覧)

## 型のみのエクスポート

一部のエクスポートは値ではなく TypeScript の型です。変数へ型注釈を付けるために存在し、実行時には消えます。`import { Shell } from "@libraz/node-cli"` は失敗し、`new Shell(...)` もできません。

型のみのエクスポートは `ExecOptions`、`PluginContext`、`CLIErrorCode`、`AnsiSegment`、`Logger`、`LoggerOptions`、`LogLevel`、`Bar`、`BarOptions`、`BarState`、`MultiBar`、`Spinner`、`SpinnerOptions`、`Choice`、`ConfirmOptions`、`MultiselectOptions`、`PasswordOptions`、`PromptBaseOptions`、`SelectChoice`、`SelectOptions`、`TextOptions`、`TableChars`、`TableOptions`、`TableStyle`、`CompletionResult`、`ModeConfig`、`Shell`、`Action`、`CatchContext`、`CLIEventHandler`、`CLIEventMap`、`CLIOptions`、`CommandContext`、`Completer`、`CompletionContext`、`OptionSchema` です。

とくに `Shell`、`ModeConfig`、`CompletionResult` と、オプションや結果を表すインターフェースはすべて型のみです。`Shell` をアプリケーション側のコードが構築することはありません。動作中のインスタンスには、コマンドのアクション内で `ctx.shell` を通じて到達します。

```typescript
import type { CommandContext, Shell } from "@libraz/node-cli";

function useShell(ctx: CommandContext): void {
  const shell: Shell | null = ctx.shell;
  shell?.setPrompt("app> ");
}
```

## CLI の作成

### `createCLI`

```typescript
function createCLI(options?: CLIOptions): CLI
```

`CLI` を構築します。`new CLI(options)` と等価です。

### `CLI`

```typescript
class CLI {
  constructor(options?: CLIOptions);
}
```

#### `CLIOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `name` | `string` | `"cli"` | アプリケーション名。ヘルプのヘッダ、既定のバナー、既定の履歴パスに使われます。 |
| `version` | `string` | — | バージョン文字列。設定すると `--version` と `-V` が唯一のトークンとして認識され、ヘルプの一覧にも並びます。 |
| `prompt` | `string` | `"> "` | 対話シェルのプロンプト文字列。 |
| `description` | `string` | — | ヘルプのヘッダに表示される 1 行の説明。 |
| `banner` | `string` | `"<name> v<version>"`、バージョンがなければ `"<name>"` | 対話シェルの起動時に表示されるテキスト。`""` を設定すると表示しません。 |
| `historyFile` | `string` | `~/.<name>_history` | 対話シェルが履歴を保存するパス。 |
| `historySize` | `number` | `1000` | 保持する履歴の最大件数。 |
| `historyFilter` | `(line: string) => string \| null` | — | 保存前に行を書き換えます。`null` を返すとその行は保存されません。 |

#### メソッド

```typescript
command(definition: string): CommandBuilder
prompt(text: string): this
description(text: string): this
banner(text: string): this
history(filePath: string): this
historySize(size: number): this
historyFilter(filter: (line: string) => string | null): this
on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this
off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): this
catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): this
use(plugin: (ctx: PluginContext) => void | Promise<void>): this
start(argv?: string[]): Promise<void>
```

残る `exec` については後述の項目で扱います。

| メソッド | 説明 |
| --- | --- |
| `command` | 定義文字列からコマンドを登録し、[`CommandBuilder`](#commandbuilder) を返します。 |
| `prompt` | 対話シェルのプロンプト文字列を設定します。 |
| `description` | ヘルプヘッダの説明を設定します。 |
| `banner` | 対話シェルのバナーを設定します。`""` を渡すと表示しません。 |
| `history` | 履歴ファイルのパスを設定します。 |
| `historySize` | 保持する履歴の最大件数を設定します。 |
| `historyFilter` | 履歴へ書き込む前に適用する伏せ字用フィルタを設定します。 |
| `on` / `off` | ライフサイクルのリスナを追加・削除します。[`CLIEventMap`](#clieventmap) を参照してください。 |
| `catch` | 入力にどのコマンドも一致しなかったときに呼ばれるフォールバックハンドラを設定します。保持されるのは 1 つだけで、後の呼び出しが置き換えます。 |
| `use` | プラグインを登録します。プラグイン本体は登録順に走り、非同期プラグインはどのコマンドが走るよりも前に await されます。 |
| `start` | CLI を実行します。同じインスタンスで 2 回呼ぶと例外を投げます。 |

#### start

```typescript
start(argv?: string[]): Promise<void>
```

`argv` の既定値は `process.argv.slice(2)` です。その内容によって動作モードが決まります。

| 入力 | 動作 |
| --- | --- |
| 引数が 1 つ以上ある | 直接実行モード。引数がひとまとまりのコマンドとしてディスパッチされ、その後 `exit` が発火します。 |
| コマンドを含まない引数（空文字列のみ、または `--` 単独） | ヘルプの一覧を表示し、その後 `exit` が発火します。 |
| 引数がなく、stdin と stdout がどちらも端末 | 対話シェルが起動します。シェルの終了時に `exit` が発火します。 |
| 引数がなく、どちらかのストリームが端末でない | ヘルプの一覧を表示し、その後 `exit` が発火します。 |

直接実行モードでは引数が配列として渡されるため、トークン化がやり直されることはなく、`|` 文字はただの引数値になります。パイプラインは文字列入力にのみ存在します。次の項目と [対話シェル](interactive-shell.md) を参照してください。

直接実行モードでの失敗は stderr に書き出され、`process.exitCode` にはそのエラーが示す終了コードが設定されます。[エラー](errors.md) を参照してください。

#### プログラムからの実行

```typescript
exec(input: string, options?: ExecOptions): Promise<void>
```

`input` を対話プロンプトで入力されたものとして実行します。文字列はトークン化され、トップレベルの `|` があればパイプラインに分割されて各ステージが並行して走ります。

このメソッドは通常の経路では `exit` イベントを **発火しません。** 発火するのは `start()` と、プロセスを終了させる強制終了の経路だけです。reject された場合は、`commandError` と `error` の各イベントが発火した後で、エラーが呼び出し側へ伝わります。

ここでは `ctx.shell` が常に `null` になるため、`ctx.shell.enterMode(...)` に触れるコマンドはガードが必要です。

##### `ExecOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `stdin` | `Readable \| null` | `null` | パイプラインの最初のステージに `ctx.stdin` として渡されるストリーム。 |
| `stdout` | `Writable` | `process.stdout` | 最後のステージに `ctx.stdout` として渡されるストリーム。 |
| `stderr` | `Writable` | `process.stderr` | すべてのステージに `ctx.stderr` として渡されるストリーム。 |
| `signal` | `AbortSignal` | — | 外部からのキャンセル。abort すると `ctx.signal` も abort され、コマンドの `cancel()` ハンドラが呼ばれます。[AbortSignal](glossary.md#abortsignal) を参照してください。 |

メモリ上のストリームを使った実例は [実例](examples.md) にあります。

## コマンドの定義

### `CommandBuilder`

`cli.command(...)`、`builder.command(...)`、およびプラグインコンテキストの `command(...)` が返します。どのメソッドもビルダー自身を返すので、呼び出しをチェーンできます。

```typescript
class CommandBuilder {
  description(text: string): this;
  hidden(hidden?: boolean): this;
  option(flags: string, schema?: OptionSchema): this;
  action(fn: Action): this;
  complete(fn: Completer): this;
  alias(...names: string[]): this;
  validate(fn: (ctx: CommandContext) => void | Promise<void>): this;
  cancel(fn: (ctx: CommandContext) => void): this;
  remove(): boolean;
  command(definition: string): CommandBuilder;
}
```

| メソッド | 説明 |
| --- | --- |
| `description` | ヘルプ出力でこのコマンドに表示されるテキストを設定します。 |
| `hidden` | 生成されるヘルプとタブ補完からコマンドを除きます。引数なしで呼ぶと `true` になります。隠しコマンドでも、名前を入力すれば通常どおりディスパッチされます。 |
| `option` | オプションを宣言します。[オプション](#オプション) を参照してください。 |
| `action` | コマンドが呼び出されたときに走るハンドラを設定します。 |
| `complete` | このコマンド専用のタブ補完関数を設定します。 |
| `alias` | 別名を追加します。エイリアスが同じ階層の実コマンドを覆い隠すことはありません。 |
| `validate` | アクションの前に走るチェックを設定します。ここで例外を投げると、アクションが走る前に呼び出しが拒否されます。 |
| `cancel` | コマンドがキャンセルされたとき（Ctrl-C、または外部シグナルの abort）に呼ばれるハンドラを設定します。 |
| `remove` | コマンドの登録を解除します。見つかって削除された場合は `true` を返します。 |
| `command` | サブコマンドを登録し、そのための新しいビルダーを返します。 |

定義文字列はコマンド名と位置引数を表します。`"deploy <env> [region]"`、`"db migrate"`、`"run <...tasks>"` のように書きます。`<name>` は必須、`[name]` は任意で、先頭の `...` は可変長を意味します。位置引数は常に文字列で、型・既定値・型変換・`choices` はありません。可変長の引数は `string[]` になります。[コマンド](commands.md) を参照してください。

#### 到達できないサブコマンド

位置引数とアクションの両方を持つコマンドは、後続のトークンをすべて引数値として取り込むため、そのサブコマンドは決してディスパッチされません。このようなコマンドで `action()` を呼ぶと `NODE_CLI_UNREACHABLE_SUBCOMMAND` のコードでプロセス警告が出され、その下にサブコマンドを登録した場合にも同じ警告が出ます。ヘルプ出力とタブ補完は、この状態のサブコマンドを、ディスパッチされない経路として宣伝する代わりに省略します。

#### validate

```typescript
validate(fn: (ctx: CommandContext) => void | Promise<void>): this
```

オプションの解決後、`beforeExecute` の前に走ります。ここで投げられたエラーはそのまま伝播し、`ValidationError` には包まれません。`ValidationError` はオプション自身の `parse` と `validate` のためのものです。

#### cancel

```typescript
cancel(fn: (ctx: CommandContext) => void): this
```

コマンドがキャンセルされたときに呼ばれます。ハンドラが走る時点で `ctx.signal` はすでに abort されているため、ハンドラとシグナルのリスナは同じ出来事を二方向から見ているにすぎません。どちらか一方でも両方でも使えます。

### `Action`

```typescript
type Action = (ctx: CommandContext) => void | Promise<void>
```

### `Completer`

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>
```

候補は提示前に `ctx.current` で絞り込まれるので、補完関数は全件を返して構いません。

独自の補完関数には 1000 ms の上限があります。同期的な例外、reject、タイムアウトのいずれでも候補は空になり、プロンプトが止まったままになることはありません。

#### `CompletionContext`

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `line` | `string` | 対象となるパイプラインの区間。カーソルが置かれているコマンドです。 |
| `fullLine` | `string` | 入力行の全体。前段のパイプライン区間も含みます。 |
| `current` | `string` | カーソル位置の語。 |
| `commandPath` | `string[]` | エイリアスを解決した正式なコマンドパス。 |
| `args` | `Record<string, unknown>` | ここまでに解析された位置引数。 |
| `options` | `Record<string, unknown>` | ここまでに解析されたオプションの生の値。補完中は型変換・既定値・検証を適用しません。 |
| `iteration` | `number` | Tab を連続して押した回数。1 から始まり、ほかの入力があるとリセットされます。 |
| `signal` | `AbortSignal` | 1000 ms の補完期限が切れると abort されます。 |

### `CatchContext`

```typescript
interface CatchContext {
  stdout: Writable;
  stderr: Writable;
}
```

`cli.catch(...)` のフォールバックハンドラに渡されます。コマンドが解決されていないため、使えるのは出力ストリームだけです。

## 実行コンテキスト

### `CommandContext`

```typescript
interface CommandContext {
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  rawInput: string;
  rawArgv?: string[];
  commandPath: string[];
  shell: Shell | null;
  signal: AbortSignal;
  stdin: Readable | null;
  stdout: Writable;
  stderr: Writable;
}
```

| フィールド | 説明 |
| --- | --- |
| `args` | 引数名をキーとする位置引数。 |
| `options` | オプションのロング名をキーとする、解決済みのオプション。 |
| `rawInput` | 文字列入力ならその元の文字列。argv 入力なら `argv.join(" ")` で、これは情報が落ちます。空白を含む 1 つの引数と、2 つの引数を区別できません。 |
| `rawArgv` | argv の要素そのもの。argv 入力のときだけ存在します。可逆なのはこちらなので、引数の区切りが問題になる場面ではこれを使ってください。 |
| `commandPath` | 解決されたコマンドの正式なパス。たとえば `["db", "migrate"]` です。エイリアスは実名に解決されるため、利用者が何を入力したかには左右されません。 |
| `shell` | 対話モードでは動作中の `Shell`。直接実行モードとプログラムからの実行では `null` です。 |
| `signal` | コマンドがキャンセルされると abort されます。`fetch` やタイマーなど、abort に対応した API に渡してください。 |
| `stdin` | この実行面の読み取りストリーム。該当するものがなければ `null` です。 |
| `stdout` | 通常の出力用の書き込みストリーム。 |
| `stderr` | 診断出力用の書き込みストリーム。 |

`args` と `options` はプロトタイプを持たないオブジェクトです。`Object.create(null)` で作られるため `Object.prototype` から何も継承しません。`ctx.options.hasOwnProperty("force")` はメソッドを継承していないので `TypeError` になります。任意のオブジェクトで動く `Object.hasOwn` を使ってください。

```typescript
if (Object.hasOwn(ctx.options, "force")) {
  // the option resolved to a value
}
```

これは意図的な取引です。`constructor` や `toString` という名前のオプションや列があっても、継承された値を拾ってしまうことがありません。

#### 引数の有無

| 宣言 | 何も渡されなかったとき |
| --- | --- |
| `<name>`（必須） | `MissingArgumentError` で呼び出しが失敗します。 |
| `[name]`（任意） | キーは `args` に **含まれません。** |
| `<...names>`（必須の可変長） | 呼び出しが失敗します。値がゼロ個であることは引数の欠落にあたります。 |
| `[...names]`（任意の可変長） | キーは存在し、空の配列を保持します。 |

#### 実行面ごとの標準入力

| 実行面 | `ctx.stdin` |
| --- | --- |
| `start(argv)` の直接コマンド | `process.stdin` |
| 対話シェルで、パイプなしのコマンド | `null` |
| パイプラインの最初のステージ | その実行面が渡したストリーム |
| パイプラインの 2 番目以降のステージ | 前段の出力 |
| プログラムからの実行 | `ExecOptions.stdin`、既定値は `null` |

## オプション

### `OptionSchema`

```typescript
interface OptionSchema {
  description?: string;
  type?: "string" | "number" | "boolean" | "string[]" | "number[]";
  alias?: string | string[];
  required?: boolean;
  default?: unknown;
  choices?: unknown[];
  parse?: (value: string, ctx: CommandContext) => unknown;
  validate?: (value: unknown, ctx: CommandContext) => void;
  hidden?: boolean;
  autocomplete?: string[] | ((current: string) => string[] | Promise<string[]>);
}
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `description` | `string` | — | ヘルプ出力でこのオプションに表示されるテキスト。 |
| `type` | 上記を参照 | 推論 | フラグ文字列に `<value>` のプレースホルダがなければ `"boolean"`、あれば `"string"`。 |
| `alias` | `string \| string[]` | — | 追加のエイリアス。フラグ文字列で宣言したものと統合されます。先頭の `-` や `--` は取り除かれます。ロング形式で宣言されていないエイリアスはちょうど 1 文字でなければなりません。 |
| `required` | `boolean` | `false` | オプションがない場合に `MissingOptionError` で失敗します。 |
| `default` | `unknown` | — | オプションがないときに使われる値。 |
| `choices` | `unknown[]` | — | 値を制限します。比較は緩やかで、文字列で宣言した選択肢は型変換後の数値にも一致します。配列型のオプションは各要素をチェックします。 |
| `parse` | 関数 | — | 明示的に渡された値のための独自パーサ。生の文字列とコンテキストを受け取ります。 |
| `validate` | 関数 | — | 型変換の後に走る独自チェック。例外を投げると拒否されます。 |
| `hidden` | `boolean` | `false` | ヘルプ出力とタブ補完からオプションを除きます。 |
| `autocomplete` | `string[]` または関数 | — | このオプションの値として提示される候補。指定がない場合は `choices` が使われます。 |

見落としやすいルールを挙げます。

- 入力に現れなかったブール値オプションは `undefined` ではなく `false` に解決されます。`required` でない限り、ビルダーがその既定値を注入します。
- 同じオプションに `required: true` と `default` の両方を宣言すると、定義時に例外を投げます。既定値があると必須という条件を満たせなくなるためです。
- 独自の `parse` が適用されるのは明示的に渡された値だけです。`default` は解決済みの値として扱われ、`type` に対する組み込みの型変換だけが走ります。
- `parse` は組み込みの型変換を完全に置き換えるため、`parse` を持つオプションは `Date` を含む任意の型に解決できます。
- `"number"` は通常の十進表記と指数表記を受け付けます。`Number.MAX_SAFE_INTEGER` を超える大きさは、桁を正確に表現できないため拒否されます。

### 解析のルール

| 形式 | 結果 |
| --- | --- |
| `--name value`、`--name=value` | 値を伴うロングオプション。 |
| `-n value`、`-n=value` | 値を伴うショートエイリアス。 |
| `--flag`、`-f` | ブール値を `true` に設定します。 |
| `--no-flag` | ブール値を `false` に設定します。ブール値以外のオプションでは拒否され、`no-flag` という名前のオプションが実在する場合はこの解釈をしません。 |
| `-abc` | ショートなブールフラグのまとめ書き。値を取るフラグをまとめ書きに含めると拒否されます。まとめ書きはブール値専用です。 |
| `-5`、`-3.14` | その名前のオプションやエイリアスが存在しない限り、位置引数の値になります。 |
| `--offset -5` | `number` または `number[]` のオプションの値として `-5` を束縛します。ほかの型では先頭の `-` が次のフラグとして読まれるため、`--offset=-5` と書く必要があります。 |
| `--` | オプションの解析を終了します。以降のトークンは通常の位置引数になります。`rest` のような別枠はありません。 |
| `--label a --label b` | `string[]` と `number[]` のオプションでは配列に蓄積されます。ほかの型では最後の値が残ります。 |

### 組み込みのフラグ

`--help` と `-h` はそのコマンドのヘルプページを表示します。入力中のどの位置でも働き、`-vh` のようなショートのまとめ書きの中でも働きます。`help` という名前や `h` というエイリアスのオプションを宣言したコマンドでは働かなくなり、ヘルプ出力と補完もその時点で動くほうの形式だけを提示します。

`--version` と `-V` が横取りされるのは、CLI に `version` が設定されていて、かつそのフラグが入力の唯一のトークンである場合だけです。`-v` の形式はありません。

`--help` や `-h` が唯一のトークンとして単独で渡された場合は、コマンドのページではなくヘルプの一覧を表示します。

### 組み込みの help コマンド

`help [...command]` は自動的に登録されます。引数なしなら一覧を、パスを渡せばそのコマンドのページを表示します。解決できないパスは、stdout へ出力せず `CommandNotFoundError` として stderr に出て失敗します。

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

| イベント | 発火するタイミング |
| --- | --- |
| `beforeExecute` | 検証とオプションの解決が終わり、アクションが走る直前。 |
| `afterExecute` | アクションが正常に完了した後。 |
| `commandError` | 解決済みのコマンドが、引数の検証、オプションの解決、自身の `validate`、またはアクションで失敗したとき。 |
| `error` | 入力の処理中に起きたあらゆる失敗。コマンド未検出や解析の失敗など、コマンドが解決される前に生じたものも含みます。 |
| `exit` | `start()` のどの終了経路でも 1 回。 |

解決済みコマンドの失敗では `commandError` と `error` の **両方が**発火します。`commandError` はコンテキストを伴い、`error` は総受けです。それぞれの失敗をちょうど 1 回だけ観測したいハンドラは、両方ではなくどちらか一方を購読してください。

`exit` は、直接実行モードのコマンドが完了・例外・強制終了のいずれかで終わった後、引数のない非端末起動でヘルプの一覧が表示された後、プラグインの初期化が失敗したとき、そして対話シェルが終了したときに発火します。プログラムからの実行は、通常の経路ではこれを発火しません。

リスナが例外を投げてもコマンドは壊れません。その失敗は `error` イベントとして再度発火し、残りのリスナはそのまま走ります。`error` のリスナが投げた場合は代わりに stderr へ報告され、ループの再帰を防ぎます。

同じイベントのリスナは登録順に走り、非同期のリスナは次のリスナが走る前に await されます。

### `CLIEventHandler`

```typescript
type CLIEventHandler<K extends keyof CLIEventMap> = CLIEventMap[K]
```

1 つのイベントに対するハンドラの型を表します。これにより、リスナを `on` の呼び出しとは別に宣言でき、その結果として `off` で削除できるようになります。

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
  command: (definition: string) => CommandBuilder;
  on: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  off: <K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]) => void;
  catch: (handler: (input: string, ctx: CatchContext) => void | Promise<void>) => void;
}
```

`cli.use(...)` に渡した関数へ手渡されるオブジェクトです。公開しているのは拡張のための面だけで、プラグインが CLI を起動したりメタデータを変更したりすることはできません。

プラグイン本体は 1 本の直列キューを通るため、先行するプラグインが I/O を await していても登録順は決定的です。プラグインが例外を投げるか reject すると初期化が失敗します。`start()` はそれを報告して `exit` を発火し、同じインスタンスに対する以降の `use()` は保存された失敗を再度投げます。[イベントとプラグイン](events-and-plugins.md) を参照してください。

## 対話シェル

### `Shell`

型のみです。動作中のインスタンスには `ctx.shell` を通じて到達します。対話シェルの外では `null` です。

```typescript
class Shell {
  setPrompt(text: string): void;
  enterMode(config: ModeConfig): void;
  exitMode(): void;
  stop(): void;
}
```

| メソッド | 説明 |
| --- | --- |
| `setPrompt` | プロンプト文字列を変更します。次のプロンプトから反映され、モードが動作中の場合はモードを抜けた後に反映されます。 |
| `enterMode` | 独自のプロンプトとハンドラを持つサブ REPL に入力を引き渡します。 |
| `exitMode` | 現在のモードを抜け、コマンドプロンプトに戻ります。 |
| `stop` | シェルのセッションを終了します。 |

シェルが起動するのは stdin と stdout の **両方が**端末であるときだけです。組み込みコマンドは `exit` と `quit` だけで、同名のコマンドを登録した場合はトップレベルではそちらが優先されます。`help` は通常の登録済みコマンドで、`clear` や `history` の組み込みはありません。

### `ModeConfig`

```typescript
interface ModeConfig {
  prompt: string;
  action: (
    input: string,
    ctx: {
      stdout: NodeJS.WritableStream;
      stderr: NodeJS.WritableStream;
      signal: AbortSignal;
    },
  ) => void | Promise<void>;
  message?: string;
  completer?: (line: string) => CompletionResult | Promise<CompletionResult>;
  history?: "session" | "none";
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `prompt` | — | モードが動作中に表示されるプロンプト文字列。 |
| `action` | — | 送信された各行のハンドラ。モードはコマンドレジストリを経由しません。 |
| `message` | — | モードに入ったときに 1 度だけ表示されるテキスト。 |
| `completer` | — | モード専用の補完。指定しなければ Tab は何も提示しません。モード内ではコマンド補完が無効になります。ほかの補完関数と同じく上限は 1000 ms です。 |
| `history` | `"session"` | `"session"` はモードの入力をモードが続く間だけメモリに保持し、`"none"` は無効にします。モードの入力がディスク上の履歴ファイルに書かれることはありません。 |

モード内では `exit` と `quit` が常にシェルではなくモードを抜けます。1 回目の Ctrl-C は `ctx.signal` を abort し、2 回目はプロセスを終了コード 130 で強制終了します。SIGTERM も同じ協調的な経路をたどり、その後に履歴を保存し、`exit` を発火し、200 ms の猶予を置いて終了コード 143 で終了します。

### `CompletionResult`

```typescript
type CompletionResult = [candidates: string[], completeOn: string]
```

Node の readline の補完関数インターフェースが期待するタプルです。候補のリストと、その候補が置き換える行中の部分文字列を表します。

## 色と端末テキスト

### `color`

```typescript
const color: Record<string, ColorFn>
```

プロパティがスタイル名になっているプロキシです。それぞれが、呼び出し可能でありチェーンもできる関数を返します。

```typescript
import { color } from "@libraz/node-cli";

color.red("error");
color.bold.green("ok");
color.bgCyan.white.underline("banner");
```

未知のスタイル名にアクセスすると `Error: Unknown style: <name>` を **投げます。** そのため、無スタイルのテキストが黙って出力されるのではなく、打ち間違いがその場で表面化します。プロトコル用のプロパティ（`then`、`toString`、`valueOf`、`toJSON`、`constructor`、およびすべてのシンボル）は対象外なので、colorizer を `await` やテンプレートリテラル、`JSON.stringify` に通してもクラッシュしません。

有効・無効の判定は `process.stdout` に従います。ほかへ書き込む場合は `createColorizer` を使ってください。

### スタイルの一覧

修飾が 6 つ、前景色が 10 個、背景色が 7 つ。これだけです。`bgBlack` はなく、明色の変種もなく、256 色や 16 進数の API もありません。

| 分類 | 名前 |
| --- | --- |
| 修飾 | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| 前景色 | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`, `grey` |
| 背景色 | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

`gray` と `grey` は同じ色の 2 通りの綴りです。

### `c`

```typescript
function c(strings: TemplateStringsArray, ...values: unknown[]): string
```

`{styleName text}` というマークアップでスタイルを適用するタグ付きテンプレートです。スタイル名はドットでつなげられ、マークアップは入れ子にできます。

```typescript
import { c } from "@libraz/node-cli";

const message = "disk full";

c`Status: {green OK}`;
c`{bold.red Error}: ${message}`;
c`{dim outer {cyan inner} outer}`;
```

`color` と違い、このタグは不正なマークアップでも例外を投げません。未知のスタイル名、閉じられていない波括弧、空白の欠落はそのまま文字として描画されます。補間される値はスタイル適用の後に差し込まれるため、値そのものが `{green ...}` を含んでいてもマークアップとして扱われません。入れ子が 64 段を超えると例外を投げます。

### `createColorizer`

```typescript
function createColorizer(stream: NodeJS.WritableStream): Record<string, ColorFn>
```

有効・無効の判定を `process.stdout` ではなく `stream` から決める、`color` と同じ形のプロキシを返します。コマンドのアクション内で使えば、色付けはそのアクションが実際に書き込んでいるストリームに従います。

```typescript
const col = createColorizer(ctx.stdout);
ctx.stdout.write(`${col.green("done")}\n`);
```

### `isColorEnabled`

```typescript
function isColorEnabled(stream?: NodeJS.WritableStream): boolean
```

`stream` に対してエスケープコードが出力されるかどうかを返します。`stream` の既定値は `process.stdout` です。判定の順序は次のとおりです。

1. `setColorEnabled()` による明示的な上書き。`NO_COLOR` を含め、ほかのすべてに優先します。
2. `NO_COLOR` が空でない値に設定されている場合は、色は無効。
3. `FORCE_COLOR` が空でない値に設定されている場合は、`"0"` と `"false"` が無効を、それ以外が有効を強制します。これは `TERM=dumb` にも、端末でないストリームにも優先します。
4. `TERM=dumb` の場合は、色は無効。
5. ストリームが端末かどうか。

### setColorEnabled と resetColorEnabled

```typescript
function setColorEnabled(enabled: boolean): void
function resetColorEnabled(): void
```

`setColorEnabled` はプロセス全体で答えを固定します。`resetColorEnabled` はその上書きを解除し、自動判定に戻します。プレーンなテキストを検証するテストには、この上書きが適した手段です。

### `stringWidth`

```typescript
function stringWidth(text: string): number
```

テキストが占める端末の桁数です。まず ANSI シーケンスが取り除かれ、結合文字と幅ゼロの文字は 0 と数え、東アジアの全角文字と絵文字は 2 と数えます。ゼロ幅接合子でつながれたスカラーの並び、たとえば家族の絵文字は、2 桁幅の書記素 1 つにまとまります。

### `stripAnsi`

```typescript
function stripAnsi(text: string): string
```

CSI と OSC を問わず、あらゆる ANSI エスケープシーケンスを取り除きます。

### `truncateAnsi`

```typescript
function truncateAnsi(text: string, maxWidth: number, marker?: string): string
```

書記素を分断せずに表示幅 `maxWidth` 桁へ切り詰め、`marker`（既定値は `"…"`）を末尾に付け、結果に開きっぱなしで残るはずだったスタイルやハイパーリンクを閉じます。`maxWidth` が 0 以下なら `""` を返します。

### `splitAnsi`

```typescript
function splitAnsi(text: string): AnsiSegment[]

interface AnsiSegment {
  ansi: boolean;
  text: string;
}
```

入力を、エスケープシーケンスの並び（`ansi: true`）と可視テキスト（`ansi: false`）へ順序どおりに分割します。認識には `stripAnsi` と同じ仕組みを使います。全セグメントの `text` を連結すると入力が復元でき、それによって利用側は可視部分だけを加工できます。

説明的な解説は [色](color.md) を参照してください。

## テーブル

### `table`

```typescript
function table(
  data: unknown[][] | Record<string, unknown>[],
  options?: TableOptions,
): string
```

行を揃えた文字列として描画します。末尾に改行は付きません。オブジェクトの配列と配列の配列のどちらも受け付けます。

`table()` は折り返しをしません。列より幅の広いセルは切り詰めマーカーを付けて切り詰められ、セル内の改行とタブはすでに空白へ畳まれており、全体幅が端末に合わせて抑えられることもありません。幅の広いテーブルは、組み直されるのではなく端末側で折り返されます。

#### 列キーとラベルの違い

`align`、`maxWidth`、`headerLabels` は列 **キー**で指定するもので、表示されるラベルでは指定できません。

| データの形 | キー |
| --- | --- |
| オブジェクトの配列、`columns` なし | 各行が自身で持つプロパティ名の和集合。最初に現れた順です。 |
| オブジェクトの配列、`columns` あり | `columns` に並べた文字列そのもの。 |
| 配列の配列、`columns` なし | 行 0 のヘッダ文字列。行 0 が名前を与えていない列と、`header: false` のときのすべての列は `"0"`、`"1"`、… になります。 |
| 配列の配列、`columns` あり | `columns` に並べた文字列。この場合、行 0 はヘッダではなくデータとして扱われます。 |

### `TableOptions`

```typescript
interface TableOptions {
  columns?: string[];
  header?: boolean;
  headerLabels?: Record<string, string>;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];
  colWidths?: number[];
  maxWidth?: Record<string, number>;
  padding?: number;
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;
  style?: TableStyle;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `columns` | データから導出 | 含める列キーを順に並べたもの。配列データではこれがヘッダのラベルも兼ね、行 0 はヘッダとして消費されません。 |
| `header` | `true` | ヘッダ行を描画するかどうか。 |
| `headerLabels` | — | 列キーをキーとする表示ラベル。 |
| `border` | `"none"` | 罫線のプリセット。`border` なしで `chars` を渡すと `"custom"` とみなされます。 |
| `chars` | — | 罫線の字形の上書き。`"custom"` は `"single"` のプリセットを土台にします。 |
| `align` | `"left"` | 列キーごとの揃え。 |
| `colAligns` | — | 列インデックスによる揃え。`align` より優先されます。 |
| `colWidths` | 自動 | 列インデックスごとの、パディングを含む固定の総幅。`0` 以下は自動を意味します。 |
| `maxWidth` | — | 列キーごとの内容幅の上限。`0` 以下は上限なしを意味します。 |
| `padding` | `2` | 列と列の間の空白数。`border: "none"` にのみ適用されます。 |
| `headerStyle` | `"bold"` | ヘッダのラベルに適用するテキストスタイル。 |
| `truncate` | `"…"` | 切り詰めたセルの末尾に付けるマーカー。 |
| `style` | — | [`TableStyle`](#tablestyle) を参照してください。 |

`colWidths[i]` はパディングを含む列の総幅です。有効な最小値は `padding-left + padding-right + 1` で、それを下回る指定はこの最小値で描画されます。どの罫線モードでも計上したパディングは実際に描画されるため、指定した幅がそのまま描画される幅になります。

### `TableStyle`

```typescript
interface TableStyle {
  "padding-left"?: number;
  "padding-right"?: number;
  head?: string;
  border?: string;
  compact?: boolean;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `padding-left` | `rounded`、`single`、`double`、`custom` では `1`、`none` と `simple` では `0` | 各セル内の左側の空白数。 |
| `padding-right` | 上と同じ規則 | 各セル内の右側の空白数。 |
| `head` | — | ヘッダのテキストに適用する、ドットでつないだスタイル。`"cyan"` や `"cyan.bold"` のように書きます。 |
| `border` | — | 罫線の字形に適用する、ドットでつないだスタイル。`"dim"` のように書きます。 |
| `compact` | `true` | `false` にするとデータ行の間に区切り線を引きます。 |

`head` や `border` に未知のスタイル名を渡した場合は無視され、テキストは無スタイルで描画されます。例外を投げる `color.<name>` とは異なる挙動です。

### `TableChars`

```typescript
interface TableChars {
  top?: string;
  "top-mid"?: string;
  "top-left"?: string;
  "top-right"?: string;
  bottom?: string;
  "bottom-mid"?: string;
  "bottom-left"?: string;
  "bottom-right"?: string;
  left?: string;
  "left-mid"?: string;
  right?: string;
  "right-mid"?: string;
  mid?: string;
  "mid-mid"?: string;
  middle?: string;
}
```

各フィールドが枠の 1 箇所に対応します。渡された字形はサニタイズされるため、罫線の文字に紛れ込んだエスケープシーケンスがテーブルの残りのスタイルを変えてしまうことはありません。組み上げた実例は [テーブル](table.md) を参照してください。

## プログレス

どちらのインジケータも既定の出力先は `process.stderr` です。これにより、リダイレクトされた stdout に進捗の出力が混ざりません。

### progress.bar

```typescript
progress.bar(options: BarOptions): Bar
```

#### `BarOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `total` | `number` | — | 必須。有限でない値や負の値は `0` に正規化され、完了として描画されます。 |
| `label` | `string` | `""` | バーの前に置くテキスト。 |
| `width` | `number` | `30` | バーの文字数。正の有限値でなければ `RangeError` を投げます。 |
| `filled` | `string` | `"█"` | 埋まった部分の字形。 |
| `empty` | `string` | `"░"` | 空の部分の字形。 |
| `format` | `(state: BarState) => string` | — | 描画される行の全体を置き換えます。 |
| `stream` | `Writable` | `process.stderr` | 出力ストリーム。 |
| `color` | `string` | — | バーに適用するスタイル名。未知の名前は無視されます。 |

#### `Bar`

| メソッド | 説明 |
| --- | --- |
| `update(current: number)` | 進捗を絶対値で設定します。`0`〜`total` に丸められます。有限でない値は無視されます。 |
| `tick(delta?: number)` | `delta`（既定値は `1`）を加算します。 |
| `finish()` | 進捗を `total` にし、最後のフレームを描画して行を閉じます。 |
| `stop()` | 完了させずに停止します。バーが行を描いていた場合にだけ行を閉じます。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

`Symbol.dispose` があるおかげで、バーは `using` 宣言と組み合わせられます。`using` は囲みブロックの末尾で破棄メソッドを自動的に呼び、ブロックが例外を投げた場合も同様です。

```typescript
{
  using bar = progress.bar({ total: 100 });
  bar.update(50);
} // stop() runs here
```

#### `BarState`

```typescript
interface BarState {
  current: number;
  total: number;
  percent: number; // 0 to 100
  elapsed: number; // ms since the bar was created
  eta: number;     // estimated ms remaining
  rate: number;    // units per second
}
```

### progress.spinner

```typescript
progress.spinner(options?: SpinnerOptions): Spinner
```

#### `SpinnerOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `label` | `string` | `""` | フレームの横に置くテキスト。 |
| `frames` | `string[]` | 点字のドット | アニメーションのフレーム。配列でない値、空の配列、文字列でない要素は `RangeError` を投げます。 |
| `interval` | `number` | `80` | フレーム間のミリ秒。正の有限値でなければなりません。 |
| `stream` | `Writable` | `process.stderr` | 出力ストリーム。 |
| `color` | `string` | — | フレームに適用するスタイル名。未知の名前は無視されます。 |

#### `Spinner`

| メソッド | 説明 |
| --- | --- |
| `start()` | アニメーションを開始します。 |
| `update(label: string)` | ラベルを差し替えます。次のフレームから反映されます。 |
| `succeed(message?)` | 停止して、緑のチェック付きの行を書き出します。既定では現在のラベルを使います。 |
| `fail(message?)` | 停止して、赤のバツ付きの行を書き出します。 |
| `warn(message?)` | 停止して、黄の警告付きの行を書き出します。 |
| `stop()` | 停止して行を消去し、最後のメッセージは書きません。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

### 端末でないストリームでの挙動

端末でないストリームへ書き込むプログレスバーは、`finish()` を含めて **何も出力しません。** リダイレクトされたログが制御シーケンスで埋まることはありません。

端末でないストリームへ書き込むスピナーも同様に何も出力しませんが、`succeed`、`fail`、`warn` だけは常に最後の 1 行を書きます。おかげで、出力をキャプチャするスクリプトにスピナーを残しておいても安全です。結果は記録され、アニメーションは記録されません。

### progress.multi

```typescript
progress.multi(): MultiBar
```

引数を取りません。グループは 1 つのストリームへ描画し、その出力先は最初にストリームを渡した `add()` で確定します。後から追加したバーの `stream` は無視されます。1 つのフレームを端末上の複数の領域に分割することはできないためです。

| メソッド | 説明 |
| --- | --- |
| `add(options: BarOptions): Bar` | バーを追加し、そのハンドルを返します。 |
| `finish()` | すべてのバーを完了させ、グループを閉じます。 |
| `stop()` | すべてのバーを停止し、グループを閉じます。 |
| `[Symbol.dispose]()` | `stop()` の別名。 |

グループを閉じた後に `add()` を呼ぶと、メソッドが何もしない不活性なバーが返ります。そのため `finally { multi.finish() }` の直後にバーを追加したワーカーがあっても失敗しません。

単独のインジケータ 2 つが同じ端末ストリームへ同時に描画することはできません。互いに相手の行配置を知り得ないため、2 つ目は例外を投げます。並行して動くバーは `multi()` のグループにまとめてください。

### `releaseAll`

```typescript
function releaseAll(): void
```

まだ動作中のインジケータをすべて停止し、端末のカーソルを復元します。コマンドの実行は終了処理でこれを呼ぶため、アクションが例外を投げてもカーソルが隠れたままになることはありません。コマンドの外でインジケータを操作する場合は直接呼んでください。トップレベルと `progress.releaseAll` の両方でエクスポートされています。

### `restoreCursor`

```typescript
function restoreCursor(): void
```

現在カーソルを隠しているすべてのストリームで、カーソルを再表示します。これはトップレベルのエクスポートであり、`progress` のメンバーでは **ありません。**

使用例は [プログレス](progress.md) を参照してください。

## プロンプト

どのプロンプトも、Ctrl-C または入力の終わり（Ctrl-D）では `PromptCancelError` で reject されます。`validate` が例外を投げるのは reject ではありません。メッセージが表示され、プロンプトはもう一度尋ねます。呼び出しの外へ抜けるのはキャンセルだけです。

同じ入力ストリームから 2 つのプロンプトが同時に読もうとすると例外を投げます。2 つ目が 1 つ目のキー入力を横取りしてしまうためです。

### `PromptBaseOptions`

```typescript
interface PromptBaseOptions<T = unknown> {
  validate?: (value: T) => void;
  required?: boolean;
  prefix?: string;
  stdout?: Writable;
  stdin?: Readable;
  signal?: AbortSignal;
}
```

| フィールド | 既定値 | 説明 |
| --- | --- | --- |
| `validate` | — | 例外を投げると拒否され、プロンプトが再度尋ねます。 |
| `required` | `true` | `prompt.text` と `prompt.password` だけが参照します。 |
| `prefix` | `"?"` | 質問の前に表示される記号。 |
| `stdout` | `process.stdout` | 質問の書き出し先。 |
| `stdin` | `process.stdin` | 回答の読み取り元。 |
| `signal` | — | abort すると、待機中のプロンプトが `PromptCancelError` で reject されます。 |

プロンプトのオプションインターフェースはすべてこれを継承します。`stderr` を持つのは `PasswordOptions` だけです。

### prompt.text

```typescript
prompt.text(message: string, options?: TextOptions): Promise<string>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `string` | — | 空の送信に対して補われる値。 |
| `placeholder` | `string` | — | 括弧内に表示されるヒント。`default` がないときだけ表示されます。 |
| `trim` | `boolean` | `true` | 回答の前後の空白を取り除きます。 |

`default` を明示した場合は、`""` であっても `required` を迂回します。何も入力せずに送信すると「値が必要です」というメッセージではなく既定値が返ります。

### prompt.confirm

```typescript
prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `boolean` | `false` | 空の送信に対して返される値。`(Y/n)` と `(y/N)` のどちらのヒントを出すかも決めます。 |

`y`、`yes`、`n`、`no` を大文字小文字を問わず受け付けます。それ以外は再度尋ねます。

### prompt.select

```typescript
prompt.select<T>(
  message: string,
  choices: Choice<T>[],
  options?: SelectOptions<T>,
): Promise<T>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `T` | — | 空の送信に対して返される値。選択肢の `value`、または選択肢オブジェクト自身と同一性で照合されます。 |

選択肢は表示された番号で答えるか、ラベルを正確に入力して答えます。数値の入力は常に番号による選択として扱われるため、数字に見えるラベルにも到達できます。空の `choices` 配列は例外を投げます。

### prompt.multiselect

```typescript
prompt.multiselect<T>(
  message: string,
  choices: Choice<T>[],
  options?: MultiselectOptions<T>,
): Promise<T[]>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `default` | `T[]` | — | あらかじめ選択された値。空の送信に対して返されます。 |
| `min` | `number` | — | 重複を除いた選択数の下限。省略すると空の結果も受け付けます。 |
| `max` | `number` | — | 重複を除いた選択数の上限。 |

カンマ区切りの番号で答えます。`min` と `max` のチェックの前に重複はまとめられます。`max` を超える `min`、選択肢の数を超える `min`、整数でない境界値はいずれも `RangeError` を投げます。

### prompt.password

```typescript
prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `trim` | `boolean` | `false` | `prompt.text` とは違い既定で無効です。前後の空白が秘密の一部でありうるためです。 |
| `stderr` | `Writable` | `process.stderr` | stdin が端末で stdout が端末でないときに、質問を書き出す先。 |

`default` はありません。入力された文字は書記素 1 つにつきアスタリスク 1 つで伏せられるため、マスクからは入力内容の表示幅もスカラー数も読み取れません。

stdin が端末で stdout がリダイレクトされている場合、質問と伏せられた入力は代わりに `stderr` へ出ます。キャプチャされた stdout にこのやり取りが混ざらないようにするためです。

### Choice と SelectChoice

```typescript
interface SelectChoice<T> {
  label: string;
  value: T;
  hint?: string;
}

type Choice<T> = T | SelectChoice<T>;
```

選択肢は、値そのものか記述子のどちらかです。`label` はあるのに `value` がない記述子は `TypeError` を投げます。そのため、たまたま `label` プロパティを持っていた普通のドメインオブジェクトが、黙って `undefined` に変わることはありません。

### `maskInput`

```typescript
function maskInput(chunk: string): string
```

チャンク内の可視の書記素をそれぞれ `*` に置き換え、ANSI シーケンスと改行はそのまま通します。これは `prompt.password` が適用しているマスク処理そのもので、自前で入力をエコーする端末 UI のためにエクスポートされています。

使用例は [プロンプト](prompts.md) を参照してください。

## ログ出力

### `logger`

```typescript
function logger(options?: LoggerOptions): Logger
```

`info` と `success` を含むすべてのレベルが 1 つのストリームへ書き出されます。既定値は `process.stderr` です。レベルによる stdout と stderr の振り分けはありません。ログを stdout へ出したい場合は `stream: process.stdout` を渡してください。

#### `LoggerOptions`

| フィールド | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `level` | `LogLevel` | `"info"` | 最小のログレベル。これより低いレベルは捨てられます。 |
| `prefix` | `string` | — | 各行に付く角括弧付きのプレフィックス。 |
| `timestamp` | `boolean` | `false` | `HH:MM:SS` を先頭に付けます。 |
| `stream` | `Writable` | `process.stderr` | 出力ストリーム。 |
| `bufferLimit` | `number` | `1000` | ストリームが詰まっている間に待機させる行数。いっぱいになると最も古い行が捨てられます。非負の安全な整数でなければなりません。 |

#### `Logger`

| メソッド | 有効になるレベル | 色ありの字形 | 色なしのラベル |
| --- | --- | --- | --- |
| `debug(message, ...args)` | `debug` | `●` | `[DEBUG]` |
| `info(message, ...args)` | `info` | `ℹ` | `[INFO]` |
| `success(message, ...args)` | `info` | `✔` | `[OK]` |
| `warn(message, ...args)` | `warn` | `⚠` | `[WARN]` |
| `error(message, ...args)` | `error` | `✖` | `[ERROR]` |

`success` は独立したレベルではありません。`info` で判定されるため、レベルを `warn` にすると出力されなくなります。

メッセージは `node:util` の `format` 関数を通るので、`%s`、`%d`、`%j` のプレースホルダが働き、第 1 引数が文字列でない場合はそのまま渡されるのではなく整形されます。

| メソッド | 説明 |
| --- | --- |
| `setLevel(level: LogLevel)` | 実行時に最小のログレベルを変更します。 |
| `child(prefix: string): Logger` | プレフィックスが `parent:child` になる子を作ります。自身のレベルを持たない場合は親の現在のレベルに従うため、後からの `parent.setLevel(...)` も届きます。 |
| `flush(): Promise<void>` | 待機中の行が、すべての子の分も含めてストリームへ届いた時点で resolve します。先にストリームがエラーになるか閉じた場合は reject します。 |

### `LogLevel`

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

`"silent"` はすべてのレベルを抑止します。[ログ出力](logging.md) を参照してください。

## エラー

### `CLIError`

```typescript
class CLIError extends Error {
  code: CLIErrorCode;
  exitCode: number;
  constructor(message: string, code: CLIErrorCode, exitCode?: number);
}
```

フレームワークが投げるすべてのエラーの基底クラスです。`code` は機械可読で、`exitCode` はその失敗が示すプロセスの終了コードです。既定値は `1` です。

### `CLIErrorCode`

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

### サブクラス

| クラス | `code` | `exitCode` | 追加のフィールド | 発生する状況 |
| --- | --- | --- | --- | --- |
| `CommandNotFoundError` | `COMMAND_NOT_FOUND` | `1` | `input`, `available?` | 入力にどのコマンドも一致しない、またはコマンドグループに未知の子が渡されたとき。 |
| `MissingArgumentError` | `MISSING_ARGUMENT` | `1` | `argName`, `usage?` | 必須の位置引数が欠けているか、必須の可変長引数が値を 1 つも受け取っていないとき。 |
| `ExtraArgumentError` | `EXTRA_ARGUMENT` | `1` | `extra` | コマンドが宣言しているより多くの位置引数の値が渡されたとき。 |
| `MissingOptionError` | `MISSING_OPTION` | `1` | `optionName` | `required` のオプションが欠けているとき。 |
| `InvalidOptionError` | `INVALID_OPTION` | `1` | `optionName?`, `value?` | 値が組み込みの型変換または `choices` のチェックに通らないとき、あるいはオプションが受け付けない形式で使われたとき。 |
| `UnknownOptionError` | `UNKNOWN_OPTION` | `1` | `flag` | コマンドが宣言していないフラグが渡されたとき。 |
| `ValidationError` | `VALIDATION_ERROR` | `1` | `cause?`, `optionName?` | オプション自身の `parse` または `validate` が例外を投げたとき。 |
| `ParseError` | `PARSE_ERROR` | `1` | `quote?` | 入力をトークン化できないか、パイプラインのステージに分割できないとき。 |
| `PromptCancelError` | `PROMPT_CANCELLED` | `130` | — | プロンプトが Ctrl-C または入力の終わりでキャンセルされたとき。 |

`ValidationError` が包むのは **オプション自身が持つ** `parse` または `validate` の失敗だけです。`CommandBuilder.validate()` が投げたエラーはそのまま伝播し、自身のクラスとメッセージを保ちます。

`ParseError` は、閉じられていない引用符（`quote` がどちらかを示します）、空のパイプや末尾のパイプ、そして未対応のリダイレクト演算子を扱います。コマンドが解決される前に発生するため、`catch()` のフォールバックを登録している場合はエラーが投げられるのではなくそちらが入力を受け取ります。

`PromptCancelError` は終了コード `130` を持ちます。これは中断されたプログラムの慣例的な終了コードです。ほかの `CLIError` は既定で `1` です。対話シェルの SIGTERM の経路は `143` で終了します。[終了コード](glossary.md#終了コードexit-code) を参照してください。

### `formatErrorMessage`

```typescript
function formatErrorMessage(err: unknown, signal?: AbortSignal): string
```

投げられたあらゆる値を、利用者に見せる 1 行のテキストとして描画します。キャンセルなら `"Cancelled"`、そうでなければ `Error` のメッセージ、それもなければ `String(err)` です。

### `isCancellationError`

```typescript
function isCancellationError(err: unknown, signal?: AbortSignal): boolean
```

その失敗が本当の不具合ではなく、利用者が起こしたキャンセルかどうかを返します。`PromptCancelError` は常に該当します。素の `AbortError` が該当するのは、`signal` が渡され、かつその signal が abort されている場合 **だけです。** その裏付けがなければ誰のキャンセルなのか判別できず、無関係な abort 済みリクエストを利用者の Ctrl-C として誤って報告してしまいます。

```typescript
import { isCancellationError } from "@libraz/node-cli";

try {
  await work(ctx.signal);
} catch (err) {
  if (isCancellationError(err, ctx.signal)) return;
  throw err;
}
```

[エラー](errors.md) を参照してください。

## 低レベルの解析と端末ヘルパー

フレームワークとまったく同じ挙動を再利用できるよう、これらもエクスポートしています。通常のアプリケーションには必要ありません。

```typescript
function tokenize(input: string): string[]
function splitPipes(input: string): string[]
function activePipeSegment(input: string): string
function stripOptionPrefix(flag: string): string
function sanitizeTerminalText(
  text: string,
  options?: { singleLine?: boolean; allowHyperlinks?: boolean },
): string
function splitGraphemes(text: string): string[]
function streamIsTTY(stream: object): boolean
function restoreCursor(): void
```

| 関数 | 説明 |
| --- | --- |
| `tokenize` | 行を argv 形式のトークンへ分割します。単一引用符、二重引用符、バックスラッシュのエスケープを解釈します。閉じられていない引用符があると `ParseError` を投げます。 |
| `splitPipes` | 行をトップレベルのパイプ文字で分割します。各区間の引用符をそのまま残すので、あらためてトークン化できます。空のパイプや末尾のパイプがあると `ParseError` を投げます。 |
| `activePipeSegment` | 引用符の外にある最後のパイプ以降の区間を返します。先頭の空白は取り除き、末尾の空白は残します。`splitPipes` と違って末尾の空の区間を保つため、パイプの直後でも補完がコマンドを提示できます。 |
| `stripOptionPrefix` | 先頭のハイフンを取り除きます。`--name` と `-n` はそれぞれ `name` と `n` になります。 |
| `sanitizeTerminalText` | 信頼できないテキストを、描画する領域向けに整えます。SGR のスタイルと OSC 8 のハイパーリンクは残り、カーソル移動・画面消去・タイトル変更は取り除かれます。`singleLine: true`（既定値）では改行が空白になります。`allowHyperlinks: false` にするとリンクも取り除きます。 |
| `splitGraphemes` | 可視テキストを、利用者が 1 文字と認識する書記素クラスタへ分割します。修飾子付きの絵文字も 1 単位として数えられます。 |
| `streamIsTTY` | 値が端末ストリームらしいかどうかを返します。[TTY](glossary.md#tty端末) を参照してください。 |
| `restoreCursor` | 現在カーソルを隠しているすべてのストリームで、カーソルを再表示します。 |

## 環境変数

| 変数 | 効果 |
| --- | --- |
| `NO_COLOR` | 空でない値なら色を無効にします。ただし `setColorEnabled(true)` が呼ばれている場合を除きます。 |
| `FORCE_COLOR` | `"0"` または `"false"` なら色を無効にし、それ以外の空でない値なら有効にします。`TERM=dumb` にも、端末でないストリームにも優先します。 |
| `TERM` | `TERM=dumb` なら色を無効にします。ただし `FORCE_COLOR` の指定が優先されます。 |
| `NODE_CLI_DEBUG` | `NODE_CLI_DEBUG=1` にすると、致命的エラーで通常の `Error: <message>` の行の代わりにスタックトレース全体を表示します。 |

```bash
NODE_CLI_DEBUG=1 myapp deploy prod
```

`NODE_CLI_DEBUG` が効くのは argv を直接渡す経路だけです。対話シェルの中で失敗したコマンドは常にメッセージだけを表示します。シェルはその後も動き続けるので、セッション中のスタックトレースは雑音になるからです。

## エクスポート一覧

| エクスポート | 種別 | セクション |
| --- | --- | --- |
| `createCLI` | 関数 | [CLI の作成](#createcli) |
| `CLI` | クラス | [CLI の作成](#cli) |
| `CLIOptions` | 型 | [CLI の作成](#clioptions) |
| `ExecOptions` | 型 | [CLI の作成](#execoptions) |
| `PluginContext` | 型 | [イベントとプラグイン](#plugincontext) |
| `CommandBuilder` | クラス | [コマンドの定義](#commandbuilder) |
| `Action` | 型 | [コマンドの定義](#action) |
| `Completer` | 型 | [コマンドの定義](#completer) |
| `CompletionContext` | 型 | [コマンドの定義](#completioncontext) |
| `CatchContext` | 型 | [コマンドの定義](#catchcontext) |
| `CommandContext` | 型 | [実行コンテキスト](#commandcontext) |
| `OptionSchema` | 型 | [オプション](#optionschema) |
| `CLIEventMap` | 型 | [イベントとプラグイン](#clieventmap) |
| `CLIEventHandler` | 型 | [イベントとプラグイン](#clieventhandler) |
| `Shell` | 型 | [対話シェル](#shell) |
| `ModeConfig` | 型 | [対話シェル](#modeconfig) |
| `CompletionResult` | 型 | [対話シェル](#completionresult) |
| `color` | 値 | [色](#color) |
| `c` | 関数 | [色](#c) |
| `createColorizer` | 関数 | [色](#createcolorizer) |
| `isColorEnabled` | 関数 | [色](#iscolorenabled) |
| `setColorEnabled` | 関数 | [色](#setcolorenabled-と-resetcolorenabled) |
| `resetColorEnabled` | 関数 | [色](#setcolorenabled-と-resetcolorenabled) |
| `stringWidth` | 関数 | [色](#stringwidth) |
| `stripAnsi` | 関数 | [色](#stripansi) |
| `truncateAnsi` | 関数 | [色](#truncateansi) |
| `splitAnsi` | 関数 | [色](#splitansi) |
| `AnsiSegment` | 型 | [色](#splitansi) |
| `table` | 関数 | [テーブル](#table) |
| `TableOptions` | 型 | [テーブル](#tableoptions) |
| `TableStyle` | 型 | [テーブル](#tablestyle) |
| `TableChars` | 型 | [テーブル](#tablechars) |
| `progress` | 値 | [プログレス](#プログレス) |
| `Bar` | 型 | [プログレス](#bar) |
| `BarOptions` | 型 | [プログレス](#baroptions) |
| `BarState` | 型 | [プログレス](#barstate) |
| `Spinner` | 型 | [プログレス](#spinner) |
| `SpinnerOptions` | 型 | [プログレス](#spinneroptions) |
| `MultiBar` | 型 | [プログレス](#progressmulti) |
| `releaseAll` | 関数 | [プログレス](#releaseall) |
| `restoreCursor` | 関数 | [プログレス](#restorecursor) |
| `prompt` | 値 | [プロンプト](#プロンプト) |
| `PromptBaseOptions` | 型 | [プロンプト](#promptbaseoptions) |
| `TextOptions` | 型 | [プロンプト](#prompttext) |
| `ConfirmOptions` | 型 | [プロンプト](#promptconfirm) |
| `SelectOptions` | 型 | [プロンプト](#promptselect) |
| `MultiselectOptions` | 型 | [プロンプト](#promptmultiselect) |
| `PasswordOptions` | 型 | [プロンプト](#promptpassword) |
| `Choice` | 型 | [プロンプト](#choice-と-selectchoice) |
| `SelectChoice` | 型 | [プロンプト](#choice-と-selectchoice) |
| `maskInput` | 関数 | [プロンプト](#maskinput) |
| `logger` | 関数 | [ログ出力](#logger) |
| `Logger` | 型 | [ログ出力](#logger-1) |
| `LoggerOptions` | 型 | [ログ出力](#loggeroptions) |
| `LogLevel` | 型 | [ログ出力](#loglevel) |
| `CLIError` | クラス | [エラー](#clierror) |
| `CLIErrorCode` | 型 | [エラー](#clierrorcode) |
| `CommandNotFoundError` | クラス | [エラー](#サブクラス) |
| `MissingArgumentError` | クラス | [エラー](#サブクラス) |
| `ExtraArgumentError` | クラス | [エラー](#サブクラス) |
| `MissingOptionError` | クラス | [エラー](#サブクラス) |
| `InvalidOptionError` | クラス | [エラー](#サブクラス) |
| `UnknownOptionError` | クラス | [エラー](#サブクラス) |
| `ValidationError` | クラス | [エラー](#サブクラス) |
| `ParseError` | クラス | [エラー](#サブクラス) |
| `PromptCancelError` | クラス | [エラー](#サブクラス) |
| `formatErrorMessage` | 関数 | [エラー](#formaterrormessage) |
| `isCancellationError` | 関数 | [エラー](#iscancellationerror) |
| `tokenize` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `splitPipes` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `activePipeSegment` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `stripOptionPrefix` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `sanitizeTerminalText` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `splitGraphemes` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |
| `streamIsTTY` | 関数 | [低レベルの解析と端末ヘルパー](#低レベルの解析と端末ヘルパー) |

## 関連ページ

- [コマンド](commands.md) — コマンドの定義、サブコマンド、検証、キャンセル。
- [オプション](options.md) — オプションスキーマを解説の形で。
- [対話シェル](interactive-shell.md) — プロンプト、履歴、補完、パイプ、モード。
- [色](color.md)、[テーブル](table.md)、[プログレス](progress.md)、[プロンプト](prompts.md)、[ログ出力](logging.md) — 出力ツールキット。
- [イベントとプラグイン](events-and-plugins.md) — ライフサイクルのフックとプラグインのパッケージング。
- [エラー](errors.md) — 失敗がどう報告され、それぞれどの終了コードになるか。
- [実例](examples.md) — 動作する完全なプログラム。
- [用語集](glossary.md) — これらのページで使う用語。

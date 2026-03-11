# API リファレンス

## createCLI

```typescript
function createCLI(options?: CLIOptions): CLI
```

新しい CLI インスタンスを作成するファクトリ関数。

## CLI

### コンストラクタ

```typescript
new CLI(options?: CLIOptions)
```

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `options.name` | `string` | `"cli"` | アプリケーション名 |
| `options.version` | `string` | — | バージョン文字列 |
| `options.prompt` | `string` | `"> "` | インタラクティブシェルプロンプト |
| `options.description` | `string` | — | ヘルプヘッダーに表示する説明 |
| `options.banner` | `string` | 自動生成 | インタラクティブシェル起動時に表示するバナーテキスト。`""` で抑制 |
| `options.historyFile` | `string` | `~/.{name}_history` | 履歴ファイルパス |
| `options.historySize` | `number` | `1000` | 最大履歴エントリ数 |

### メソッド

#### `command(definition: string): CommandBuilder`

新しいコマンドを登録。チェーン用のビルダーを返す。

```typescript
cli.command("deploy <env> [region]")
```

#### `prompt(text: string): this`

インタラクティブシェルのプロンプト文字列を設定。

#### `description(text: string): this`

ヘルプヘッダーに表示する説明を設定。

#### `banner(text: string): this`

インタラクティブシェル起動時に表示するバナーテキストを設定。`""` を渡すと抑制。未設定の場合は `name` と `version` から自動生成。

#### `history(filePath: string): this`

履歴ファイルパスを設定。

#### `on<K>(event: K, handler: CLIEventMap[K]): this`

イベントリスナーを登録。

| イベント | ハンドラシグネチャ |
|---------|-------------------|
| `"beforeExecute"` | `(ctx: CommandContext) => void \| Promise<void>` |
| `"afterExecute"` | `(ctx: CommandContext) => void \| Promise<void>` |
| `"commandError"` | `(error: Error, ctx: CommandContext) => void \| Promise<void>` |
| `"exit"` | `() => void \| Promise<void>` |

#### `off<K>(event: K, handler: CLIEventMap[K]): this`

イベントリスナーを削除。

#### `catch(handler): this`

未認識コマンドのフォールバックハンドラを設定。

```typescript
catch(handler: (input: string, ctx: { stdout: Writable; stderr: Writable }) => void | Promise<void>): this
```

#### `use(plugin): this`

プラグインを登録。

```typescript
use(plugin: (ctx: PluginContext) => void | Promise<void>): this
```

#### `exec(input: string, options?): Promise<void>`

コマンドをプログラムから実行。

| パラメータ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `input` | `string` | — | コマンド文字列 |
| `options.stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `options.stderr` | `Writable` | `process.stderr` | エラーストリーム |

#### `start(argv?: string[]): Promise<void>`

CLI を開始。`argv` が提供された場合 (または `process.argv` に引数がある場合) はダイレクトモードで実行。それ以外はインタラクティブシェルを起動。

---

## Shell

コマンドハンドラ内で `ctx.shell` 経由でアクセス可能。

### メソッド

#### `setPrompt(text: string): void`

プロンプト文字列を動的に変更。次のプロンプト表示時に反映される。モード中の場合、モード終了後に適用。

```typescript
cli.command("prompt <text>")
  .description("プロンプトを変更")
  .action((ctx) => {
    ctx.shell?.setPrompt(ctx.args.text as string);
  });
```

#### `enterMode(config: ModeConfig): void`

カスタムプロンプトとアクションハンドラを持つモードサブ REPL に入る。

#### `exitMode(): void`

現在のモードを終了し、通常のコマンドプロンプトに戻る。

#### `stop(): void`

シェルを停止し、readline インターフェースを閉じる。

---

## CommandBuilder

`cli.command()` が返すチェーン可能なビルダー。

### メソッド

#### `description(text: string): this`

コマンドの説明を設定 (ヘルプに表示)。

#### `option(flags: string, schema?: OptionSchema): this`

コマンドにオプションを追加。

| パラメータ | 型 | 説明 |
|-----------|------|------|
| `flags` | `string` | フラグ定義 (例: `"-p, --port <port>"`) |
| `schema` | `OptionSchema` | オプション設定 |

#### `action(fn: Action): this`

アクションハンドラを設定。

```typescript
type Action = (ctx: CommandContext) => void | Promise<void>
```

#### `complete(fn: Completer): this`

カスタムタブ補完プロバイダを設定。

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>
```

#### `alias(...names: string[]): this`

コマンドの別名を追加。

#### `validate(fn): this`

アクション前バリデーターを設定。例外を投げると実行を拒否できる。

```typescript
validate(fn: (ctx: CommandContext) => void | Promise<void>): this
```

#### `cancel(fn): this`

コマンドの SIGINT ハンドラを設定。

```typescript
cancel(fn: (ctx: CommandContext) => void): this
```

#### `remove(): boolean`

レジストリからコマンドを削除。見つかって削除された場合 `true` を返す。

#### `command(definition: string): CommandBuilder`

サブコマンドを登録。サブコマンド用の新しいビルダーを返す。

---

## CommandContext

すべてのアクションハンドラに渡されるコンテキスト。

```typescript
interface CommandContext {
  args: Record<string, unknown>;
  options: Record<string, unknown>;
  rawInput: string;
  commandPath: string[];
  shell: Shell | null;
  stdin: Readable | null;
  stdout: Writable;
  stderr: Writable;
}
```

| プロパティ | 説明 |
|-----------|------|
| `args` | 名前をキーとするパース済み位置引数 |
| `options` | ロング名をキーとするパース済みオプション |
| `rawInput` | 元の入力文字列 |
| `commandPath` | 解決されたコマンドパス (例: `["db", "migrate"]`) |
| `shell` | インタラクティブモードの Shell インスタンス、ダイレクトモードでは `null` |
| `stdin` | Readable ストリーム (パイプコマンドで利用可能) |
| `stdout` | 出力用 Writable ストリーム |
| `stderr` | エラー用 Writable ストリーム |

---

## OptionSchema

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
}
```

| プロパティ | デフォルト | 説明 |
|-----------|---------|------|
| `type` | 推論 | 値の型。`<value>` なしのフラグは `"boolean"`、それ以外は `"string"` と推論 |
| `required` | `false` | 未提供時にエラーを発生 |
| `default` | — | デフォルト値。ブールオプションは `false` がデフォルト |
| `choices` | — | 列挙された値に制限 |
| `parse` | — | 生の文字列値のカスタムパーサー |
| `validate` | — | カスタムバリデーター（無効時に例外を投げる） |
| `hidden` | `false` | ヘルプ出力から非表示 |

---

## PluginContext

`cli.use()` で登録するプラグイン関数に渡されるコンテキスト。

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder;
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
}
```

---

## CLIEventMap

```typescript
interface CLIEventMap {
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  exit: () => void | Promise<void>;
}
```

---

## ModeConfig

モードサブ REPL の設定。

```typescript
interface ModeConfig {
  prompt: string;
  action: (input: string, ctx: { stdout: WritableStream; stderr: WritableStream }) => void | Promise<void>;
  message?: string;
}
```

---

## color

プロキシベースのチェーン可能なカラー API。

```typescript
color.red("text")
color.bold.green("text")
color.bgCyan.white.underline("text")
```

ANSI エスケープコード付きのスタイル適用済み文字列を返します (カラー無効時はプレーン文字列)。

## c

インラインカラーフォーマット用のタグ付きテンプレートリテラル。

```typescript
c`{styleName text}`
c`{bold.red Error}: ${message}`
```

## setColorEnabled

```typescript
function setColorEnabled(enabled: boolean): void
```

カラー検出を上書き。`false` を渡すとすべてのカラー出力を無効化。

## stripAnsi

```typescript
function stripAnsi(text: string): string
```

文字列から ANSI エスケープコードを除去。

## stringWidth

```typescript
function stringWidth(text: string): number
```

ANSI コードと東アジアワイド文字を考慮した表示幅を計算。

---

## table

```typescript
function table(
  data: unknown[][] | Record<string, unknown>[],
  options?: TableOptions
): string
```

表形式のデータをフォーマット済み文字列としてレンダリング。

### TableOptions

```typescript
interface TableOptions {
  columns?: string[];
  header?: boolean;                         // デフォルト: true
  headerLabels?: Record<string, string>;
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;                       // カスタムボーダー文字
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];  // インデックス指定のアライメント
  colWidths?: number[];                     // インデックス指定の固定カラム幅
  maxWidth?: Record<string, number>;
  padding?: number;                         // デフォルト: 2 (ボーダーなし)
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;                        // デフォルト: "…"
  style?: TableStyle;
}

interface TableStyle {
  "padding-left"?: number;   // デフォルト: 1 (ボーダー有), 0 (なし)
  "padding-right"?: number;  // デフォルト: 1 (ボーダー有), 0 (なし)
  head?: string;             // ヘッダー色 (例: "red", "cyan.bold")
  border?: string;           // ボーダー色 (例: "grey", "dim")
  compact?: boolean;         // 行間セパレータ非表示 (デフォルト: true)
}

interface TableChars {
  top?: string;       "top-mid"?: string;    "top-left"?: string;   "top-right"?: string;
  bottom?: string;    "bottom-mid"?: string; "bottom-left"?: string;"bottom-right"?: string;
  left?: string;      "left-mid"?: string;   right?: string;        "right-mid"?: string;
  mid?: string;       "mid-mid"?: string;    middle?: string;
}
```

---

## progress

### progress.bar

```typescript
function progress.bar(options: BarOptions): Bar
```

#### BarOptions

| プロパティ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `total` | `number` | — | **必須。** 合計ユニット数 |
| `label` | `string` | — | ラベルプレフィックス |
| `width` | `number` | `30` | バー幅 (文字数) |
| `filled` | `string` | `"█"` | 塗りつぶし文字 |
| `empty` | `string` | `"░"` | 空文字 |
| `color` | `string` | — | カラー名 |
| `stream` | `Writable` | `process.stdout` | 出力ストリーム |
| `format` | `(state: BarState) => string` | — | カスタムフォーマッター |

#### Bar

| メソッド | 説明 |
|---------|------|
| `update(current: number)` | 絶対値で進捗を設定 |
| `tick(delta?: number)` | 進捗を加算 (デフォルト: 1) |
| `finish()` | バーを完了 (100% に設定) |
| `stop()` | 完了せずに停止 |

#### BarState

```typescript
interface BarState {
  current: number;
  total: number;
  percent: number;    // 0-100
  elapsed: number;    // ミリ秒
  eta: number;        // 残りミリ秒
  rate: number;       // ユニット/秒
}
```

### progress.spinner

```typescript
function progress.spinner(options?: SpinnerOptions): Spinner
```

#### SpinnerOptions

| プロパティ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `label` | `string` | — | スピナー横のテキスト |
| `frames` | `string[]` | dots パターン | アニメーションフレーム |
| `interval` | `number` | `80` | フレーム間のミリ秒 |
| `color` | `string` | — | フレームカラー |
| `stream` | `Writable` | `process.stdout` | 出力ストリーム |

#### Spinner

| メソッド | 説明 |
|---------|------|
| `start()` | アニメーション開始 |
| `update(label: string)` | ラベルを変更 |
| `succeed(message?: string)` | チェックマークで停止 |
| `fail(message?: string)` | バツ印で停止 |
| `warn(message?: string)` | 警告マークで停止 |
| `stop()` | ステータスなしで停止 |

### progress.multi

```typescript
function progress.multi(): MultiBar
```

#### MultiBar

| メソッド | 説明 |
|---------|------|
| `add(options: BarOptions): Bar` | 新しいプログレスバーを追加 |
| `finish()` | 全バーを完了 |
| `stop()` | 全バーを停止 |

---

## prompt

### prompt.text

```typescript
function prompt.text(message: string, options?: TextOptions): Promise<string>
```

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `default` | `string` | — | デフォルト値 |
| `placeholder` | `string` | — | プレースホルダーテキスト |
| `validate` | `(v: unknown) => void` | — | 無効時に例外を投げる |
| `required` | `boolean` | `true` | 空でないことを要求 |

### prompt.confirm

```typescript
function prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `default` | `boolean` | `false` | デフォルト値 |

### prompt.select

```typescript
function prompt.select<T>(
  message: string,
  choices: (T | { label: string; value: T; hint?: string })[],
  options?: PromptBaseOptions
): Promise<T>
```

### prompt.multiselect

```typescript
function prompt.multiselect<T>(
  message: string,
  choices: (T | { label: string; value: T; hint?: string })[],
  options?: MultiselectOptions<T>
): Promise<T[]>
```

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `default` | `T[]` | — | 事前選択済みの値 |
| `min` | `number` | — | 最小選択数 |
| `max` | `number` | — | 最大選択数 |

### prompt.password

```typescript
function prompt.password(message: string, options?: PromptBaseOptions): Promise<string>
```

入力はアスタリスクでマスクされます。

すべてのプロンプトは Ctrl+C または Ctrl+D で `PromptCancelError` を投げる。

---

## logger

```typescript
function logger(options?: LoggerOptions): Logger
```

### LoggerOptions

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `level` | `LogLevel` | `"info"` | 最小ログレベル |
| `prefix` | `string` | — | 角括弧付きのプレフィックス |
| `timestamp` | `boolean` | `false` | `[HH:MM:SS]` を表示 |
| `stream` | `Writable` | `process.stderr` | 出力ストリーム |

### Logger

| メソッド | レベル | アイコン |
|---------|-------|---------|
| `debug(msg, ...args)` | debug | (なし) |
| `info(msg, ...args)` | info | ℹ |
| `success(msg, ...args)` | info | ✔ |
| `warn(msg, ...args)` | warn | ⚠ |
| `error(msg, ...args)` | error | ✖ |

追加メソッド:

| メソッド | 説明 |
|---------|------|
| `setLevel(level: LogLevel)` | ランタイムで最小レベルを変更 |
| `child(prefix: string): Logger` | ネストプレフィックスの子ロガーを作成 |

### LogLevel

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

---

## エラークラス

すべて `CLIError` を継承し、`code: string` プロパティを持つ。

| クラス | コード | 説明 |
|-------|--------|------|
| `CLIError` | (各種) | 基底エラークラス |
| `CommandNotFoundError` | `COMMAND_NOT_FOUND` | 不明なコマンド |
| `MissingArgumentError` | `MISSING_ARGUMENT` | 必須引数の不足 |
| `ExtraArgumentError` | `EXTRA_ARGUMENT` | 予期しない位置引数 |
| `MissingOptionError` | `MISSING_OPTION` | 必須オプションの不足 |
| `InvalidOptionError` | `INVALID_OPTION` | 不正なオプション値 |
| `UnknownOptionError` | `UNKNOWN_OPTION` | 未認識のフラグ |
| `ValidationError` | `VALIDATION_ERROR` | カスタムバリデーション失敗 |
| `PromptCancelError` | `PROMPT_CANCELLED` | プロンプトのキャンセル |

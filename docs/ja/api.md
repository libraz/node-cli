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
| `options.historyFilter` | `(line: string) => string \| null` | — | 履歴行を編集し、`null` なら保存しない |

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

#### 組み込みフラグ

各コマンドは、そのフラグを明示定義していない限り `--help` と `-h` をサポートします。`options.version` を持つトップレベル CLI は `--version` と `-V` もサポートします。

#### `history(filePath: string): this`

履歴ファイルパスを設定。

#### `historySize(size: number): this`

対話モードで保持する履歴エントリ数の上限を設定。

#### `historyFilter(filter: (line: string) => string | null): this`

private な履歴ファイルへ書く前にコマンドを編集または除外します。資格情報などの秘密を含むコマンドは `null` を返して保存対象から外せます。

#### `on<K>(event: K, handler: CLIEventMap[K]): this`

イベントリスナーを登録。

| イベント | ハンドラシグネチャ | 説明 |
|---------|-------------------|------|
| `"beforeExecute"` | `(ctx: CommandContext) => void \| Promise<void>` | コマンドアクション実行前に発火 |
| `"afterExecute"` | `(ctx: CommandContext) => void \| Promise<void>` | コマンドアクション正常完了後に発火 |
| `"commandError"` | `(error: Error, ctx: CommandContext) => void \| Promise<void>` | 解決済みコマンドがバリデーション・オプション解決・アクションで失敗した際に発火 |
| `"error"` | `(error: Error) => void \| Promise<void>` | 入力処理中のあらゆるエラーを捕捉する全般ハンドラ。コマンド解決前の失敗（command-not-found など）も含む。コマンド失敗時は `"commandError"` に加えて発火 |
| `"exit"` | `() => void \| Promise<void>` | インタラクティブシェル終了時に発火 |

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
| `options.stdin` | `Readable \| null` | `null` | `ctx.stdin` として公開する入力ストリーム |
| `options.stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `options.stderr` | `Writable` | `process.stderr` | エラーストリーム |
| `options.signal` | `AbortSignal` | — | `ctx.signal` と `.cancel()` に連結する外部キャンセルシグナル |

#### `start(argv?: string[]): Promise<void>`

CLI を開始。`argv` が提供された場合 (または `process.argv` に引数がある場合) はダイレクトモードで実行。引数がない場合、stdin と stdout の両方が TTY のときだけインタラクティブシェルを起動し、それ以外はヘルプ一覧を出力。

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

#### `hidden(hidden?: boolean): this`

このコマンドを生成ヘルプとタブ補完から除外。引数なしで呼ぶと `true` を指定したことになる。除外されたコマンドも実行自体は可能。

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

カスタムタブ補完プロバイダを設定。`CompletionContext` には連続 Tab 押下回数を示す `iteration`（1始まり）が含まれ、段階的な補完候補の提示が可能です。非同期プロバイダの期限は1秒で、期限切れ時は `signal` で進行中の処理をキャンセルできます。

```typescript
type Completer = (ctx: CompletionContext) => string[] | Promise<string[]>

interface CompletionContext {
  line: string;           // 補完対象のパイプライン区間
  fullLine: string;       // 以前の区間も含む入力行全体
  current: string;        // 補完中の単語
  commandPath: string[];  // 解決済みコマンドパス
  args: Record<string, unknown>;
  options: Record<string, unknown>; // 生の値。coerce/default/validation は未適用
  iteration: number;      // 連続 Tab 押下回数（1始まり）
  signal: AbortSignal;    // 1秒の補完期限切れ時に abort される
}
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
  rawArgv?: string[];
  commandPath: string[];
  shell: Shell | null;
  stdin: Readable | null;
  stdout: Writable;
  stderr: Writable;
  signal: AbortSignal;
}
```

| プロパティ | 説明 |
|-----------|------|
| `args` | 名前をキーとするパース済み位置引数 |
| `options` | ロング名をキーとするパース済みオプション |
| `rawInput` | 元の入力文字列 |
| `rawArgv` | 配列・ダイレクト実行時の正確な argv 要素。空文字や空白を含む引数も保持。文字列入力では未定義 |
| `commandPath` | 解決されたコマンドパス (例: `["db", "migrate"]`) |
| `shell` | インタラクティブモードの Shell インスタンス、ダイレクトモードでは `null` |
| `stdin` | 実行サーフェスが選択した入力ストリーム。利用できない場合は `null` |
| `stdout` | 出力用 Writable ストリーム |
| `stderr` | エラー用 Writable ストリーム |
| `signal` | コマンドのキャンセル (SIGINT) で abort される `AbortSignal`。abort 対応 API や `cancel()` と併用 |

`rawInput` は文字列実行では元のコマンド文字列です。配列・ダイレクト実行では表示用に再構成されるため、引数境界を正確に扱う場合は `rawArgv` を使用してください。

### 実行サーフェス別の標準入力

| サーフェス | `ctx.stdin` |
|-----------|-------------|
| `start(argv)` のダイレクトコマンド | `process.stdin` |
| パイプライン | 第1 stage: 呼び出し元サーフェスの入力、後続 stage: 直前 stage の出力 |
| インタラクティブ REPL | `null` |
| `exec(input)` | `options.stdin`。デフォルトは `null` |

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
  autocomplete?: string[] | ((current: string) => string[] | Promise<string[]>);
}
```

| プロパティ | デフォルト | 説明 |
|-----------|---------|------|
| `description` | — | ヘルプ出力に表示するこのオプションの説明 |
| `type` | 推論 | 値の型。`<value>` なしのフラグは `"boolean"`、それ以外は `"string"` と推論 |
| `alias` | — | 追加の別名。`flags` で宣言した別名とマージされる。先頭の `-` / `--` は除去され、ロング形式で宣言していない別名は 1 文字でなければならない |
| `required` | `false` | 未提供時にエラーを発生。`default` とは併用不可 |
| `default` | — | 未指定時だけ使う値。組み込み型変換は適用し、カスタム `parse` は適用しない。ブールオプションは `false` がデフォルト |
| `choices` | — | 列挙された値に制限 |
| `parse` | — | 生の文字列値のカスタムパーサー |
| `validate` | — | カスタムバリデーター（無効時に例外を投げる） |
| `hidden` | `false` | ヘルプ出力から非表示 |
| `autocomplete` | — | オプション値の補完候補。文字列配列または `(current: string) => string[] \| Promise<string[]>` |

明示値はカスタム `parse` があればそれを使い、なければ `type` の組み込み型変換を
使います。デフォルト値は、組み込み型変換を除いて解決済みの値として扱われます。
`required: true` と `default` を同時に宣言するとオプション定義時に例外になります。

---

## PluginContext

`cli.use()` で登録するプラグイン関数に渡されるコンテキスト。

```typescript
interface PluginContext {
  command(definition: string): CommandBuilder;
  on<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  off<K extends keyof CLIEventMap>(event: K, handler: CLIEventMap[K]): void;
  catch(handler: (input: string, ctx: CatchContext) => void | Promise<void>): void;
}
```

| メンバー | 説明 |
|---------|------|
| `command` | 新しいコマンドを登録 |
| `on` | イベントリスナーを登録 |
| `off` | 登録済みのイベントリスナーを削除 |
| `catch` | どのコマンドにもマッチしない入力時に呼ばれるフォールバックハンドラを登録 |

---

## CLIEventMap

```typescript
interface CLIEventMap {
  beforeExecute: (ctx: CommandContext) => void | Promise<void>;
  afterExecute: (ctx: CommandContext) => void | Promise<void>;
  commandError: (error: Error, ctx: CommandContext) => void | Promise<void>;
  error: (error: Error) => void | Promise<void>;
  exit: () => void | Promise<void>;
}
```

`error` イベントは全般的な捕捉ハンドラです。コマンド解決前の失敗（command-not-found
など）を含む、入力処理中のあらゆるエラーで発火します。コマンド失敗時は
`commandError` に加えて発火します。

---

## ModeConfig

モードサブ REPL の設定。

```typescript
interface ModeConfig {
  prompt: string;
  action: (input: string, ctx: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    signal: AbortSignal;
  }) => void | Promise<void>;
  message?: string;
  completer?: (line: string) => [string[], string] | Promise<[string[], string]>;
  history?: "session" | "none";
}
```

`completer` を指定しない限りモード内の補完は無効です。モード履歴は親 REPL とディスク履歴から分離され、既定の `"session"` はメモリ内だけに保持し、`"none"` は履歴を無効にします。

モード action 実行中の最初の Ctrl+C は `ctx.signal` を abort します。長時間処理では
この signal を `fetch` や abort 対応 timer へ渡してください。2回目の Ctrl+C は
プロセスを強制終了します。

SIGTERM も同じ協調キャンセル経路を通り、200ms の猶予後にシェル履歴を保存し、`exit` を emit して終了コード 143 で終了します。

```typescript
shell.enterMode({
  prompt: "query> ",
  async action(input, { stdout, signal }) {
    const response = await fetch(`/query?q=${encodeURIComponent(input)}`, { signal });
    stdout.write(`${await response.text()}\n`);
  },
});
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

## splitAnsi

```typescript
function splitAnsi(text: string): AnsiSegment[]
// interface AnsiSegment { ansi: boolean; text: string }
```

文字列を ANSI エスケープシーケンス (`ansi: true`) と可視テキスト (`ansi: false`) の区間へ順番に分割。`stripAnsi` と同じ認識器を使用し、各区間の `text` を連結すると元の文字列に戻る。

## stringWidth

```typescript
function stringWidth(text: string): number
```

ANSI コードと東アジアワイド文字を考慮した表示幅を計算。

## その他の color / parser helper

| export | 説明 |
|--------|------|
| `createColorizer(stream)` | 出力 stream に紐づくチェーン可能な colorizer を作成 |
| `isColorEnabled(stream?)` | stream で color が有効かを返す |
| `resetColorEnabled()` | 上書き後に color の自動判定へ戻す |
| `truncateAnsi(text, width, suffix?)` | ANSI 状態を維持しつつ表示幅で切り詰める |
| `activePipeSegment(input)` | 補完用に最後の非 quote pipeline segment を返す |
| `maskInput(chunk)` | terminal control sequence を維持しつつ可視 grapheme をマスクする |

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
| `stream` | `Writable` | `process.stderr` | 出力ストリーム |
| `format` | `(state: BarState) => string` | — | カスタムフォーマッター |

#### Bar

| メソッド | 説明 |
|---------|------|
| `update(current: number)` | 絶対値で進捗を設定 |
| `tick(delta?: number)` | 進捗を加算 (デフォルト: 1) |
| `finish()` | バーを完了 (100% に設定) |
| `stop()` | 完了せずに停止 |
| `[Symbol.dispose]()` | `stop()` の別名。`using` で宣言したバーはスコープを抜けると解放される |

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
| `stream` | `Writable` | `process.stderr` | 出力ストリーム |

#### Spinner

| メソッド | 説明 |
|---------|------|
| `start()` | アニメーション開始 |
| `update(label: string)` | ラベルを変更 |
| `succeed(message?: string)` | チェックマークで停止 |
| `fail(message?: string)` | バツ印で停止 |
| `warn(message?: string)` | 警告マークで停止 |
| `stop()` | ステータスなしで停止 |
| `[Symbol.dispose]()` | `stop()` の別名。`using` で宣言したスピナーはスコープを抜けると解放される |

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
| `[Symbol.dispose]()` | `stop()` の別名。`using` で宣言したマルチバーはスコープを抜けると解放される |

### progress.releaseAll

```typescript
function progress.releaseAll(): void
```

まだ動作中のインジケーターをすべて停止し、端末のカーソルを復帰します。コマンド実行は
finalizer でこれを呼ぶため、アクションが例外を投げてもカーソルが隠れたままになることは
ありません。コマンド外でインジケーターを扱う場合は直接呼び出してください。トップレベル
export の `releaseAll` としても利用できます。

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
| `trim` | `boolean` | `true` | 先頭・末尾の空白を除去 |
| `prefix` | `string` | `"?"` | プロンプト接頭辞 |
| `stdin` | `Readable` | `process.stdin` | 入力ストリーム |
| `stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `signal` | `AbortSignal` | — | abort されると待機中のプロンプトを `PromptCancelError` で reject |

### prompt.confirm

```typescript
function prompt.confirm(message: string, options?: ConfirmOptions): Promise<boolean>
```

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `default` | `boolean` | `false` | デフォルト値 |
| `validate` | `(v: unknown) => void` | — | 無効時に例外を投げる |
| `prefix` | `string` | `"?"` | プロンプト接頭辞 |
| `stdin` | `Readable` | `process.stdin` | 入力ストリーム |
| `stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `signal` | `AbortSignal` | — | abort されると待機中のプロンプトを `PromptCancelError` で reject |

### prompt.select

```typescript
function prompt.select<T>(
  message: string,
  choices: (T | { label: string; value: T; hint?: string })[],
  options?: SelectOptions<T>
): Promise<T>
```

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `default` | `T` | — | デフォルトの選択値。ユーザーが何も入力せず Enter を押した際に返される |
| `validate` | `(v: unknown) => void` | — | 無効時に例外を投げる |
| `prefix` | `string` | `"?"` | プロンプト接頭辞 |
| `stdin` | `Readable` | `process.stdin` | 入力ストリーム |
| `stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `signal` | `AbortSignal` | — | abort されると待機中のプロンプトを `PromptCancelError` で reject |

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
| `min` | `number` | `0` | 最小選択数。省略時は Enter だけで空配列を返せる |
| `max` | `number` | — | 最大選択数 |
| `validate` | `(v: unknown) => void` | — | 無効時に例外を投げる |
| `prefix` | `string` | `"?"` | プロンプト接頭辞 |
| `stdin` | `Readable` | `process.stdin` | 入力ストリーム |
| `stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `signal` | `AbortSignal` | — | abort されると待機中のプロンプトを `PromptCancelError` で reject |

### prompt.password

```typescript
function prompt.password(message: string, options?: PasswordOptions): Promise<string>
```

入力はアスタリスクでマスクされ、既定では先頭・末尾の空白も保持されます。`trim: true` を指定すると空白を取り除けます。

| オプション | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `validate` | `(v: unknown) => void` | — | 無効時に例外を投げる |
| `required` | `boolean` | `true` | 空でないことを要求 |
| `trim` | `boolean` | `false` | 先頭・末尾の空白を除去 |
| `prefix` | `string` | `"?"` | プロンプト接頭辞 |
| `stdin` | `Readable` | `process.stdin` | 入力ストリーム |
| `stdout` | `Writable` | `process.stdout` | 出力ストリーム |
| `stderr` | `Writable` | `process.stderr` | stdin が TTY で stdout がリダイレクトされている場合のプロンプト出力先 |
| `signal` | `AbortSignal` | — | abort されると待機中のプロンプトを `PromptCancelError` で reject |

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
| `timestamp` | `boolean` | `false` | `HH:MM:SS` を表示 |
| `stream` | `Writable` | `process.stderr` | 出力ストリーム |
| `bufferLimit` | `number` | `1000` | backpressure 中に保持する最大行数。上限到達時は最も古い待機行を破棄 |

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
| `flush(): Promise<void>` | 待機行がストリームへ渡されるまで待つ。先に stream が error / close した場合は reject |

### LogLevel

```typescript
type LogLevel = "debug" | "info" | "warn" | "error" | "silent"
```

---

## エラークラス

すべて `CLIError` を継承し、機械判定用の `code: CLIErrorCode` と推奨終了コード
`exitCode: number` を持ちます。

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
| `ParseError` | `PARSE_ERROR` | 入力をトークン化、またはパイプライン区間へ分割できない |
| `PromptCancelError` | `PROMPT_CANCELLED` | プロンプトのキャンセル |

追加の構造化フィールド:

| クラス | フィールド |
|-------|-----------|
| `CommandNotFoundError` | `input`、任意の `available` |
| `MissingArgumentError` | `argName`、任意の `usage` |
| `ExtraArgumentError` | `extra` |
| `MissingOptionError` | `optionName` |
| `InvalidOptionError` | 任意の `optionName`、任意の `value` |
| `UnknownOptionError` | `flag` |
| `ValidationError` | 任意の `cause`、任意の `optionName` |
| `ParseError` | 任意の `quote` |

`ParseError` は、閉じられていないクォート (`quote` がどちらかを示します)、空または末尾の
パイプ、未対応のリダイレクト演算子で発生します。コマンド解決より前に発生するため、
`catch()` フォールバックハンドラを登録している場合は例外を投げずにそのハンドラへ入力が
渡されます。

### デバッグ出力

直接引数モードで `start()` までエラーが到達した場合、既定ではメッセージのみが
`Error: <message>` の形式で出力されます。`NODE_CLI_DEBUG=1` を設定すると、代わりに
スタックトレース全体が出力されます。メッセージだけでは発生元を特定できないときに
利用してください。

```bash
NODE_CLI_DEBUG=1 myapp deploy prod
```

対象は直接引数モードのみです。インタラクティブシェル内でのコマンド失敗は、以降も
実行を継続するため常にメッセージのみを出力します。

## パースと端末ユーティリティ

CLI 本体と同じパース・端末安全化の挙動が必要な統合向けに、次のヘルパーを公開しています。

```typescript
tokenize(input: string): string[]
splitPipes(input: string): string[]
stripOptionPrefix(flag: string): string
sanitizeTerminalText(text: string, options?): string
splitGraphemes(text: string): string[]
streamIsTTY(stream: object): boolean
restoreCursor(): void
isCancellationError(error: unknown, signal?: AbortSignal): boolean
formatErrorMessage(error: unknown, signal?: AbortSignal): string
```

カスタム shell / mode completer 向けに `CompletionResult` 型も公開しています。

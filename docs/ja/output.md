# 出力ユーティリティ

node-cli にはカラー、テーブル、プログレスインジケーター、インタラクティブプロンプト、ロギングの出力ユーティリティが内蔵されています。外部依存は一切不要です。

## カラー

### プロキシベース API

```typescript
import { color } from "@libraz/node-cli";

color.red("Error!")
color.bold.green("Success!")
color.bgYellow.black("Warning")
color.dim.italic("hint")
```

カラーは Proxy 経由でチェーン可能。スタイルの任意の組み合わせが使えます。

### テンプレートリテラルタグ

```typescript
import { c } from "@libraz/node-cli";

console.log(c`{green OK} All tests passed`);
console.log(c`{bold.red ERROR}: ${message}`);
console.log(c`{dim [${timestamp}]} {cyan ${url}}`);
```

### 利用可能なスタイル

| カテゴリ | スタイル |
|----------|---------|
| 修飾子 | `bold`, `dim`, `italic`, `underline`, `inverse`, `strikethrough` |
| 前景色 | `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray` |
| 背景色 | `bgRed`, `bgGreen`, `bgYellow`, `bgBlue`, `bgMagenta`, `bgCyan`, `bgWhite` |

### カラー制御

```typescript
import { setColorEnabled, stripAnsi, stringWidth } from "@libraz/node-cli";

// グローバルにカラーを無効化 (NO_COLOR 環境変数にも対応)
setColorEnabled(false);

// 文字列から ANSI エスケープコードを除去
stripAnsi("\x1b[31mred\x1b[0m"); // "red"

// 表示幅を計算 (東アジア文字幅対応)
stringWidth("Hello");     // 5
stringWidth("こんにちは"); // 10
```

## テーブル

```typescript
import { table } from "@libraz/node-cli";
```

### オブジェクト配列

```typescript
const data = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(data));
```

出力:
```
name     role     active
Alice    Admin    true
Bob      User     false
```

### 配列の配列

```typescript
const data = [
  ["Name", "Role"],
  ["Alice", "Admin"],
  ["Bob", "User"],
];

console.log(table(data, { header: true }));
```

### オプション

```typescript
interface TableOptions {
  columns?: string[];           // カラムキー (オブジェクト用) またはラベル
  header?: boolean;             // ヘッダー行を表示 (デフォルト: true)
  headerLabels?: Record<string, string>;  // カスタムヘッダーラベル
  border?: "none" | "simple" | "rounded" | "single" | "double" | "custom";
  chars?: TableChars;           // カスタムボーダー文字
  align?: Record<string, "left" | "right" | "center">;
  colAligns?: ("left" | "right" | "center")[];  // インデックス指定のアライメント
  colWidths?: number[];         // インデックス指定の固定カラム幅
  maxWidth?: Record<string, number>;      // カラムの切り詰め
  padding?: number;             // ボーダーなし時のカラム間スペース (デフォルト: 2)
  headerStyle?: "bold" | "dim" | "underline" | "none";
  truncate?: string;            // 切り詰め文字 (デフォルト: "…")
  style?: TableStyle;           // パディング、色、コンパクトモード
}

interface TableStyle {
  "padding-left"?: number;      // セル左パディング (デフォルト: ボーダー有=1)
  "padding-right"?: number;     // セル右パディング (デフォルト: ボーダー有=1)
  head?: string;                // ヘッダー色 (例: "red", "cyan.bold")
  border?: string;              // ボーダー色 (例: "grey", "dim")
  compact?: boolean;            // 行間セパレータ非表示 (デフォルト: true)
}

interface TableChars {
  top?: string;        "top-mid"?: string;     "top-left"?: string;    "top-right"?: string;
  bottom?: string;     "bottom-mid"?: string;  "bottom-left"?: string; "bottom-right"?: string;
  left?: string;       "left-mid"?: string;    right?: string;         "right-mid"?: string;
  mid?: string;        "mid-mid"?: string;     middle?: string;
}
```

### ボーダースタイル

```typescript
// ボーダーなし (デフォルト)
table(data, { border: "none" });

// シンプル ASCII
table(data, { border: "simple" });
// name  | role
// ------|------
// Alice | Admin

// 角丸 Unicode
table(data, { border: "rounded" });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// ╰───────┴───────╯

// シングルライン
table(data, { border: "single" });
// ┌───────┬───────┐
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// └───────┴───────┘

// ダブルライン
table(data, { border: "double" });
// ╔═══════╦═══════╗
// ║ name  ║ role  ║
// ╠═══════╬═══════╣
// ║ Alice ║ Admin ║
// ╚═══════╩═══════╝

// カスタム文字
table(data, {
  chars: {
    "top-left": "+", "top-right": "+", "top": "=", "top-mid": "+",
    "bottom-left": "+", "bottom-right": "+", "bottom": "=", "bottom-mid": "+",
    "left": "|", "right": "|", "middle": "|",
    "left-mid": "+", "right-mid": "+", "mid": "-", "mid-mid": "+",
  },
});
```

### カラム配置

```typescript
// カラム名で指定
table(data, {
  align: { amount: "right", name: "left" },
});

// インデックスで指定 (align より優先)
table(data, {
  colAligns: ["left", "right", "center"],
});
```

### カラム幅と切り詰め

```typescript
table(data, {
  colWidths: [20, 15, 10],       // インデックス指定の固定幅
  maxWidth: { description: 40 }, // カラム名指定の最大幅
  truncate: "..",                 // カスタム切り詰め文字
});
```

### スタイルとコンパクトモード

```typescript
// コンパクトモード (デフォルト) — 行間セパレータなし
table(data, { border: "rounded", style: { compact: true } });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// │ Bob   │ User  │
// ╰───────┴───────╯

// 非コンパクト — 全行間にセパレータ
table(data, { border: "rounded", style: { compact: false } });
// ╭───────┬───────╮
// │ name  │ role  │
// ├───────┼───────┤
// │ Alice │ Admin │
// ├───────┼───────┤
// │ Bob   │ User  │
// ╰───────┴───────╯

// カスタムパディング
table(data, {
  border: "single",
  style: { "padding-left": 3, "padding-right": 3 },
});
```

## プログレス

```typescript
import { progress } from "@libraz/node-cli";
```

### プログレスバー

```typescript
const bar = progress.bar({
  total: 100,
  label: "ダウンロード中",
  width: 30,
  color: "green",
});

bar.update(50);   // 絶対値で設定
bar.tick();       // 1 ずつ加算
bar.tick(10);     // 10 加算
bar.finish();     // 完了 (100% に設定)
bar.stop();       // 完了せずに停止
```

**BarOptions:**

```typescript
interface BarOptions {
  total: number;                           // 合計ユニット数
  label?: string;                          // ラベルプレフィックス
  width?: number;                          // バー幅 (文字数、デフォルト: 30)
  filled?: string;                         // 塗りつぶし文字 (デフォルト: "█")
  empty?: string;                          // 空文字 (デフォルト: "░")
  color?: string;                          // カラー名
  stream?: Writable;                       // 出力ストリーム
  format?: (state: BarState) => string;    // カスタムフォーマッター
}
```

**BarState** (カスタムフォーマットに渡される):

```typescript
interface BarState {
  current: number;   // 現在の進捗
  total: number;     // 合計目標
  percent: number;   // 0-100
  elapsed: number;   // 経過ミリ秒
  eta: number;       // 残り推定ミリ秒
  rate: number;      // ユニット/秒
}
```

**カスタムフォーマット:**

```typescript
const bar = progress.bar({
  total: 1000,
  format: (state) =>
    `${state.current}/${state.total} (${state.percent}%) ETA: ${Math.round(state.eta / 1000)}秒`,
});
```

### スピナー

```typescript
const spinner = progress.spinner({
  label: "処理中...",
  color: "cyan",
});

spinner.start();
spinner.update("まだ処理中...");
spinner.succeed("完了!");       // ✔ 完了!
spinner.fail("失敗!");          // ✖ 失敗!
spinner.warn("注意!");          // ⚠ 注意!
spinner.stop();                 // ステータスなしで停止
```

**SpinnerOptions:**

```typescript
interface SpinnerOptions {
  label?: string;          // スピナー横のテキスト
  frames?: string[];       // カスタムアニメーションフレーム
  interval?: number;       // フレーム間のミリ秒 (デフォルト: 80)
  color?: string;          // フレームのカラー
  stream?: Writable;       // 出力ストリーム
}
```

### マルチバー

複数のプログレスバーを同時に追跡:

```typescript
const multi = progress.multi();

const bar1 = multi.add({ total: 100, label: "ファイル 1" });
const bar2 = multi.add({ total: 200, label: "ファイル 2" });

bar1.update(50);
bar2.update(100);

multi.finish();  // 全バーを完了
multi.stop();    // 全バーを停止
```

### TTY 検出

プログレスバーとスピナーは TTY ストリームでのみレンダリングされます。非 TTY (パイプ出力、CI) では、すべての操作がサイレントに no-op となります。

## プロンプト

```typescript
import { prompt } from "@libraz/node-cli";
```

### テキスト入力

```typescript
const name = await prompt.text("名前:");
const email = await prompt.text("メールアドレス:", {
  default: "user@example.com",
  validate: (v) => {
    if (!(v as string).includes("@")) throw new Error("無効なメールアドレス");
  },
});
```

### 確認

```typescript
const ok = await prompt.confirm("すべてのファイルを削除しますか?");
// Y/n プロンプト、boolean を返す

const ok2 = await prompt.confirm("続行しますか?", { default: true });
```

### セレクト (単一選択)

```typescript
const env = await prompt.select("環境:", [
  "development",
  "staging",
  "production",
]);

// ラベル付き選択肢:
const action = await prompt.select("アクション:", [
  { label: "デプロイ", value: "deploy", hint: "本番環境にプッシュ" },
  { label: "ロールバック", value: "rollback", hint: "直前のデプロイを巻き戻し" },
]);
```

### マルチセレクト

```typescript
const features = await prompt.multiselect("有効にする機能:", [
  { label: "ログ", value: "logging" },
  { label: "メトリクス", value: "metrics" },
  { label: "トレーシング", value: "tracing" },
], {
  min: 1,
  max: 2,
});
```

### パスワード

```typescript
const password = await prompt.password("パスワードを入力:");
// 入力はアスタリスクでマスクされます
```

### キャンセル処理

すべてのプロンプトは Ctrl+C または Ctrl+D で `PromptCancelError` を投げます:

```typescript
import { PromptCancelError } from "@libraz/node-cli";

try {
  const name = await prompt.text("名前:");
} catch (err) {
  if (err instanceof PromptCancelError) {
    console.log("キャンセルされました");
  }
}
```

## ロガー

```typescript
import { logger } from "@libraz/node-cli";
```

### 基本的な使い方

```typescript
const log = logger();

log.debug("詳細情報");          // debug レベルでのみ表示
log.info("情報");               // ℹ 情報
log.success("完了");            // ✔ 完了
log.warn("注意してください");    // ⚠ 注意してください
log.error("エラーが発生");      // ✖ エラーが発生
```

### オプション

```typescript
const log = logger({
  level: "debug",         // "debug" | "info" | "warn" | "error" | "silent"
  prefix: "server",       // [server] プレフィックス
  timestamp: true,        // [HH:MM:SS] プレフィックス
  stream: process.stderr, // 出力ストリーム (デフォルト: stderr)
});
```

### printf スタイルのフォーマット

```typescript
log.info("ポート: %d", 3000);
log.info("ホスト: %s", "localhost");
log.info("設定: %j", { port: 3000 });
```

### 子ロガー

```typescript
const log = logger({ prefix: "app" });
const dbLog = log.child("db");
const httpLog = log.child("http");

dbLog.info("接続完了");       // [app:db] ℹ 接続完了
httpLog.info("GET /api");    // [app:http] ℹ GET /api
```

### ランタイムレベル変更

```typescript
log.setLevel("debug");   // すべてのメッセージを表示
log.setLevel("silent");  // すべての出力を抑制
```

### ログレベル

| レベル | 表示されるメソッド |
|--------|-------------------|
| `debug` | debug, info, success, warn, error |
| `info` | info, success, warn, error |
| `warn` | warn, error |
| `error` | error |
| `silent` | (なし) |

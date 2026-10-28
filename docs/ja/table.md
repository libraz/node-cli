# テーブル

`table(data, options?)` は行の配列を、桁の揃った、必要なら罫線で囲んだテキストのブロックに変換します。パッケージが公開する素の関数で、`CLI` インスタンスは要らず、どの Node スクリプトからでも import できます。戻り値は文字列で、この関数自体は何も出力しません。

![name・role・active の列を太字のヘッダー行に持ち、2行のデータを角丸の罫線で囲んだテーブルを表示している端末](../assets/table.svg)

## 最初の例

```ts
import { table } from "@libraz/node-cli";

const rows = [
  { name: "Alice", role: "Admin", active: true },
  { name: "Bob", role: "User", active: false },
];

console.log(table(rows, { border: "rounded" }));
```

戻り値に **末尾の改行** は付きません。描画するものが何もない入力は `""` を返します。結果は `console.log` に渡すか、コマンドの中ならコンテキストの出力ストリームへ渡してください（[コマンド](commands.md)を参照）。

```ts
import { createCLI, table } from "@libraz/node-cli";

const cli = createCLI({ name: "mycli" });

cli.command("users").action((ctx) => {
  const rows = [{ name: "Alice", role: "Admin" }];
  ctx.stdout.write(`${table(rows, { border: "rounded" })}\n`);
});
```

## 入力の形

`table` は2つの形を受け付けます。

**オブジェクトの配列。** 各オブジェクトが1行、各プロパティが1列になります。

```ts
import { table } from "@libraz/node-cli";

console.log(
  table([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]),
);
```

列は既定で **全行のキーの和集合** になり、順序は最初に現れた順です。後ろの行にしか現れないキーもきちんと描画されます。

**配列の配列。** 内側の配列がそれぞれ1行になります。

```ts
import { table } from "@libraz/node-cli";

console.log(
  table([
    ["name", "role"],
    ["Alice", "Admin"],
    ["Bob", "User"],
  ]),
);
```

既定では行 0 がヘッダー行として消費されます。`columns` を渡すとそこが変わり、渡したラベルがヘッダーになって、**すべての** 配列行がデータとして扱われます。

列数は最も長い行に合わせ、短い行は空のセルで埋めます。`null` と `undefined` のセルは `""` として描画されます。各セルの値は `String()` で変換されたあと `sanitizeTerminalText`（[カラー](color.md)を参照）を通ります。この処理はカラーコードを残し、カーソル移動や画面消去など、枠を壊しかねないエスケープシーケンスを取り除きます。

### 列キーと表示ラベルの違い

いくつかのオプションは、画面に出るヘッダーの文字列ではなく列の **キー** で指定します。キーは次のとおりです。

- オブジェクトの配列: オブジェクトのプロパティ名
- ヘッダーのある配列の配列: ヘッダーセルのテキスト
- ヘッダーのない配列の配列: インデックスを文字列にしたもの（`"0"`、`"1"`、`"2"` など）

```ts
import { table } from "@libraz/node-cli";

// headerless array data: align the second column right
console.log(
  table(
    [
      ["Alice", 42],
      ["Bob", 7],
    ],
    { header: false, align: { "1": "right" } },
  ),
);
```

## `TableOptions`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `columns` | `string[]` | データから導出 | オブジェクトデータでは、描画する列の **キー** を指定します。配列データではヘッダーのラベルを指定し、渡した時点で行 0 は **ヘッダーとして消費されなくなります。** |
| `header` | `boolean` | `true` | `false` にするとヘッダー行を出しません。 |
| `headerLabels` | `Record<string, string>` | — | 列の **キー** で指定する、表示テキストの差し替え。 |
| `border` | `"none" \| "simple" \| "rounded" \| "single" \| "double" \| "custom"` | `"none"`。`chars` を渡した場合は `"custom"` | 罫線のプリセット。 |
| `chars` | `TableChars` | — | 独自の罫線文字。`border` が選んだプリセット(`border` を省略した場合や `"custom"` の場合は `single`)の上に重ねて統合します。 |
| `align` | `Record<string, "left" \| "right" \| "center">` | `"left"` | 列の **キー** で指定する揃え。 |
| `colAligns` | `("left" \| "right" \| "center")[]` | — | 列インデックスで指定する揃え。**`align` より優先します。** |
| `colWidths` | `number[]` | — | インデックスで指定する、余白を含んだ列の **合計** 幅。0 以下の値は「この列の幅は自動で決める」という意味です。 |
| `maxWidth` | `Record<string, number>` | — | 列キーで指定する内容幅の上限。0 以下の値は **上限なし** を意味します。 |
| `padding` | `number` | `2` | 列と列の間の空白。`border: "none"` のときだけ効きます。 |
| `headerStyle` | `"bold" \| "dim" \| "underline" \| "none"` | `"bold"` | ヘッダーセルに適用するテキストスタイル。 |
| `truncate` | `string` | `"…"` | 切り詰めが起きたセルの末尾に付ける記号。 |
| `style` | `TableStyle` | — | 下記を参照。 |

## `TableStyle`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `padding-left` | `number` | `rounded` / `single` / `double` / `custom` では `1`、`none` / `simple` では `0` | 各セルの内側、左に入れる空白。 |
| `padding-right` | `number` | 上と同じ | 各セルの内側、右に入れる空白。 |
| `head` | `string` | — | ヘッダーセルに適用する、ドットで連結したスタイル名。例えば `"cyan"` や `"cyan.bold"`。 |
| `border` | `string` | — | 同じものを罫線の文字に適用します。 |
| `compact` | `boolean` | `true` | `false` にすると、`"simple"` と罫線付きの枠では、データ行と行の間すべてに区切り線を入れます。`border: "none"` には区切り用の文字がないため、効果はありません。 |

`head` や `border` に未知の名前を渡しても例外にはならず、スタイルの付かない素のテキストになります。使えるスタイル名は[カラー](color.md)に一覧があります。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

console.log(
  table(rows, {
    border: "rounded",
    style: { head: "cyan.bold", border: "dim", "padding-left": 2, "padding-right": 2 },
  }),
);
```

## 罫線

| プリセット | 角 | 備考 |
| --- | --- | --- |
| `"none"` | — | 枠は一切なし。列は `padding` 個の空白で区切ります。これが既定値です。 |
| `"simple"` | — | 外枠なし。区切り線は `-`、列と列の間は ` \| ` です。 |
| `"rounded"` | `╭ ╮ ╰ ╯` | 角を丸めた全周の枠。 |
| `"single"` | `┌ ┐ └ ┘` | 角が直角の全周の枠。 |
| `"double"` | `╔ ╗ ╚ ╝` | 二重線で描いた全周の枠。 |
| `"custom"` | `chars` から | `single` プリセットを土台に `chars` を重ねます。 |

`chars` は次のキーを受け付け、値はいずれも文字列です: `top`, `top-mid`, `top-left`, `top-right`, `bottom`, `bottom-mid`, `bottom-left`, `bottom-right`, `left`, `left-mid`, `right`, `right-mid`, `mid`, `mid-mid`, `middle`。`border` を指定せずに `chars` を渡すと `border: "custom"` とみなされます。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

console.log(
  table(rows, {
    chars: { "top-left": "+", "top-right": "+", "bottom-left": "+", "bottom-right": "+" },
  }),
);
```

## 幅と切り詰め

列の幅は最も広いセルから決まります。測定は JavaScript の文字列長ではなく **表示幅** で行うため、日本語や絵文字のような幅の広いテキストも正しく揃います。カラーは幅を増やしません。測定に使うのは `stringWidth` で、[カラー](color.md)に説明があります。

結果を制約するオプションは2つあり、それぞれ意味が違います。

- `maxWidth[key]` は1つの列の **内容** 幅に上限を掛けます。上限より広いセルは `truncate` の記号を付けて切り詰めます。
- `colWidths[index]` は1つの列の **合計** 幅を、余白込みで固定します。内容幅は `colWidths[i] - padding-left - padding-right` となり、下限は 1 です。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin", note: "promoted last quarter" }];

console.log(
  table(rows, {
    border: "single",
    maxWidth: { name: 12 },
    colWidths: [0, 20, 0], // auto, fixed 20, auto
  }),
);
```

ヘッダーのラベルもデータセルと同じ幅に切り詰められるため、狭い列でヘッダーだけが枠からはみ出すことはありません。

## よくある落とし穴

- **`border` の既定値は `"none"` で、枠付きのスタイルではありません。** `border` を指定しないテーブルは、桁を揃えただけの素のブロックです。枠が欲しいときは `border: "rounded"` などのプリセットを渡してください。
- **テーブルは折り返しません。** 列に収まらないセルは記号を付けて切り詰められ、2行目に折り返されることはありません。埋め込まれた改行は無害化の段階で空白へ潰れているため、複数行のセルは作れません。
- **合計幅が端末の幅に丸められることはありません。** 幅の広いテーブルは、`maxWidth` や `colWidths` で狭めない限り端末側で折り返されます。
- **`colWidths[i] <= 0` は自動、`maxWidth[key] <= 0` は上限なしです。** どちらも列を幅 0 に潰しません。
- **`colAligns` は `align` に優先します。** 両方が同じ列を指すときは、インデックス指定のほうが勝ちます。
- **`align`、`maxWidth`、`headerLabels` はヘッダーのラベルではなく列キーで指定します。** ヘッダーのない配列テーブルでは、キーは `"0"`、`"1"` のようになります。
- **何も出力しません。** `table` は末尾に改行を含まない文字列を返します。

## 関連ページ

- [カラー](color.md) — 幅の測定、スタイル名、テキストの無害化。
- [コマンド](commands.md) — テーブルを `ctx.stdout` へ書き出す方法。
- [サンプル](examples.md) — テーブルを描画する完全なプログラム。

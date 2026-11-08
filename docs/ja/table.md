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

既定では行 0 がヘッダー行として消費されます。`columns` を渡すとそこが変わり、渡した要素がヘッダーになって、**すべての** 配列行がデータとして扱われます。

列数は最も長い行に合わせ、短い行は空のセルで埋めます。`null` と `undefined` のセルは `""` として描画されます。各セルの値は `String()` で変換されたあと `sanitizeTerminalText`（[カラー](color.md)を参照）を通ります。この処理はカラーコードを残し、カーソル移動や画面消去など、枠を壊しかねないエスケープシーケンスを取り除きます。

### 列の指定

`columns` は readonly の配列で、要素は文字列か `ColumnSpec` です。文字列は `{ key: 文字列 }` の省略形です。

```ts
import { table } from "@libraz/node-cli";

const rows = [
  { id: 1, name: "Alice", score: 42 },
  { id: 2, name: "Bob", score: 7 },
];

console.log(
  table(rows, {
    columns: [
      "id",
      { key: "name", label: "Full name", maxWidth: 10 },
      { key: "score", align: "right" },
    ],
  }),
);
```

オブジェクトデータでは、`key` が読み取るプロパティ名、`label` がヘッダーの文字列（既定は `key`）で、`columns` は描画する列とその順序も決めます。

配列データでは、列は **位置** で対応させ、`key` で何かを探すことはしません。文字列の要素はそのままヘッダーになり、`ColumnSpec` は `label ?? key` がヘッダーになります。列ごとの設定も同じ位置に従います。

```ts
import { table } from "@libraz/node-cli";

console.log(
  table(
    [
      ["Alice", 42],
      ["Bob", 7],
    ],
    { columns: ["Name", { key: "score", label: "Score", align: "right" }] },
  ),
);
```

## `TableOptions`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `columns` | `readonly (string \| ColumnSpec)[]` | データから導出 | 描画する列を順に指定します。配列データでは、渡した時点で行 0 は **ヘッダーとして消費されなくなります。** |
| `header` | `boolean` | `true` | `false` にするとヘッダー行を出しません。 |
| `border` | `"none" \| "simple" \| "rounded" \| "single" \| "double" \| "custom"` | `"none"`。`chars` を渡した場合は `"custom"` | 罫線のプリセット。 |
| `chars` | `TableChars` | — | 独自の罫線文字。`border` が選んだプリセット(`border` を省略した場合や `"custom"` の場合は `single`)の上に重ねて統合します。 |
| `borderColor` | `StyleSpec` | — | 罫線の文字に適用するスタイル名、またはドットで連結したスタイル。例えば `"dim"` や `"cyan.bold"`。 |
| `headerStyle` | `StyleSpec \| "none"` | `"bold"` | ヘッダーのテキストに適用するスタイル。`"none"` なら素のテキストのままです。 |
| `paddingLeft` | `number` | 枠ありでは `1`、`none` / `simple` では `0` | 各セルの内側、左に入れる空白。 |
| `paddingRight` | `number` | 上と同じ | 各セルの内側、右に入れる空白。 |
| `gap` | `number` | `2` | 列と列の間の空白。`border: "none"` のときだけ効きます。 |
| `rowSeparators` | `boolean` | `false` | `true` にすると、`"simple"` と罫線付きの枠では、データ行と行の間すべてに区切り線を入れます。`border: "none"` には区切り用の文字がないため、効果はありません。 |
| `ellipsis` | `string` | `"…"` | 切り詰めが起きたセルの末尾に付ける記号。 |
| `stream` | `Writable` | `process.stdout` | 色を出すかどうかの判定に使います。TTY なら色が付きます。`table` がこのストリームへ書き込むことはありません。 |

`gap`、`paddingLeft`、`paddingRight` は 0 以上の整数です。

## `ColumnSpec`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `key` | `string` | 必須 | 読み取るオブジェクトのプロパティ名。配列データでは使いません。 |
| `label` | `string` | `key` | 列のヘッダーの文字列。 |
| `align` | `"left" \| "right" \| "center"` | `"left"` | ヘッダーとセルの揃え。 |
| `width` | `number` | 自動 | 列の **合計** 幅を、**余白を含めて** 固定します。正の整数です。 |
| `maxWidth` | `number` | 上限なし | **内容** 幅の上限で、余白は含みません。正の整数、または上限なしを表す `Infinity`。 |

`width` と `maxWidth` は測るものが違います。`width` は `paddingLeft` と `paddingRight` を含む列全体の幅で、内容にはその残りが割り当てられ、下限は 1 です。そのため `paddingLeft + paddingRight + 1` より小さい `width` は、その最小値で描画されます。`maxWidth` は内容だけに上限を掛けます。両方を指定した場合は `width` が優先します。

## スタイル

`headerStyle` と `borderColor` には、スタイル名か、`"cyan.bold"` のようにドットで連結した指定を渡します。各要素は `table()` を呼んだ時点で検査され、未知の名前は `ERR_INVALID_ARG_VALUE` の `RangeError` になります。使えるスタイル名は[カラー](color.md)に一覧があります。

色を付けるかどうかは `stream` で決まります。既定値は `process.stdout` です。リダイレクトされた出力先や TTY でない出力先に素のテキストを渡したいときは、書き込み先のストリームを渡してください。`NO_COLOR`、`FORCE_COLOR`、`setColorEnabled` は、ライブラリのほかの箇所と同じように効きます。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

process.stderr.write(
  `${table(rows, {
    border: "rounded",
    headerStyle: "cyan.bold",
    borderColor: "dim",
    paddingLeft: 2,
    paddingRight: 2,
    stream: process.stderr,
  })}\n`,
);
```

## 入力の検証

不正なオプションは、描画を始める前に `code` 付きの例外になります。

| 入力 | エラー |
| --- | --- |
| 数値でない `width`、`maxWidth`、`gap`、`paddingLeft`、`paddingRight`。または、文字列でも、文字列の `key` を持つ `ColumnSpec` でもない `columns` の要素（`undefined` を含む） | `TypeError` `ERR_INVALID_ARG_TYPE` |
| 0 以下・`NaN`・小数の `width` と `maxWidth`。`Infinity` の `width`。負数・`NaN`・無限大・小数・安全でない整数の `gap` と余白 | `RangeError` `ERR_INVALID_ARG_VALUE` |
| 未知の `border`、または `headerStyle` や `borderColor` の未知の名前 | `RangeError` `ERR_INVALID_ARG_VALUE` |

幅と余白は 2^32 まで受け付けます。描画時には 4096 セルを上限に丸められます。

## 罫線

| プリセット | 角 | 備考 |
| --- | --- | --- |
| `"none"` | — | 枠は一切なし。列は `gap` 個の空白で区切ります。これが既定値です。 |
| `"simple"` | — | 外枠なし。区切り線は `-`、列と列の間は ` \| ` です。 |
| `"rounded"` | `╭ ╮ ╰ ╯` | 角を丸めた全周の枠。 |
| `"single"` | `┌ ┐ └ ┘` | 角が直角の全周の枠。 |
| `"double"` | `╔ ╗ ╚ ╝` | 二重線で描いた全周の枠。 |
| `"custom"` | `chars` から | `single` プリセットを土台に `chars` を重ねます。 |

`chars` は次のキーを受け付け、値はいずれも文字列です: `top`, `topMid`, `topLeft`, `topRight`, `bottom`, `bottomMid`, `bottomLeft`, `bottomRight`, `left`, `leftMid`, `right`, `rightMid`, `horizontal`（行と行の間の線）, `cross`（その線が列の区切りと交わる位置）, `vertical`（列と列の区切り）。`border` を指定せずに `chars` を渡すと `border: "custom"` とみなされます。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin" }];

console.log(
  table(rows, {
    chars: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+" },
  }),
);
```

## 幅と切り詰め

列の幅は最も広いセルから決まります。測定は JavaScript の文字列長ではなく **表示幅** で行うため、日本語や絵文字のような幅の広いテキストも正しく揃います。カラーは幅を増やしません。測定に使うのは `stringWidth` で、[カラー](color.md)に説明があります。

結果を制約する `ColumnSpec` のフィールドは2つあり、それぞれ意味が違います。

- `maxWidth` は1つの列の **内容** 幅に上限を掛けます。上限より広いセルは `ellipsis` の記号を付けて切り詰めます。
- `width` は1つの列の **合計** 幅を、**余白込みで** 固定します。内容幅は `width - paddingLeft - paddingRight` となり、下限は 1 です。

```ts
import { table } from "@libraz/node-cli";

const rows = [{ name: "Alice", role: "Admin", note: "promoted last quarter" }];

console.log(
  table(rows, {
    border: "single",
    columns: [{ key: "name", maxWidth: 12 }, { key: "role", width: 20 }, "note"],
  }),
);
```

ヘッダーのラベルもデータセルと同じ幅に切り詰められるため、狭い列でヘッダーだけが枠からはみ出すことはありません。

## よくある落とし穴

- **`border` の既定値は `"none"` で、枠付きのスタイルではありません。** `border` を指定しないテーブルは、桁を揃えただけの素のブロックです。枠が欲しいときは `border: "rounded"` などのプリセットを渡してください。
- **テーブルは折り返しません。** 列に収まらないセルは記号を付けて切り詰められ、2行目に折り返されることはありません。埋め込まれた改行は無害化の段階で空白へ潰れているため、複数行のセルは作れません。
- **合計幅が端末の幅に丸められることはありません。** 幅の広いテーブルは、`maxWidth` や `width` で狭めない限り端末側で折り返されます。
- **`width` は余白を含み、`maxWidth` は含みません。** 枠付きの既定の余白（左右に 1 ずつ）では、`width: 20` の内容は 18 セルです。
- **幅の 0 は「自動」ではなくエラーです。** 内容から幅を決めたいときは `width` と `maxWidth` を省略し、上限なしを明示したいときは `maxWidth: Infinity` を使ってください。
- **列ごとの設定は、別のマップではなく要素に付けます。** 配列データでは `key` を探さないため、`columns` の位置に従います。
- **`stream` は色の判定にしか使いません。** `table` は末尾に改行を含まない文字列を返すだけで、何も書き込みません。

## 関連ページ

- [カラー](color.md) — 幅の測定、スタイル名、テキストの無害化。
- [コマンド](commands.md) — テーブルを `ctx.stdout` へ書き出す方法。
- [サンプル](examples.md) — テーブルを描画する完全なプログラム。

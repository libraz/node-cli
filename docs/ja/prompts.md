# プロンプト

`prompt` はキーボードの前にいる人に質問し、その答えで解決します。自由入力のテキスト、はい/いいえの確認、1つだけの選択肢、複数の選択肢、伏せ字のパスワードの5種類です。どのメソッドもパッケージが公開する素の非同期関数なので、`CLI` インスタンスは要りません。

![テキストのプロンプト、既定値のヒントが付いた yes/no の確認、番号付きの単一選択リストを表示している端末](../assets/prompt.svg)

## 最初の例

```ts
import { prompt } from "@libraz/node-cli";

const name = await prompt.text("Your name:");
const sure = await prompt.confirm("Are you sure?");
const env = await prompt.select("Environment:", ["dev", "staging", "prod"]);

console.log(name, sure, env);
```

1回の呼び出しで1つの答えを読み取り、受け入れられる入力が来るまで質問を繰り返します。質問は既定で `process.stderr` へ書き、答えは `process.stdin` から読みます。

質問を stderr に書くので、`mycli init | jq` のようにパイプしてもプロンプトの文字列は流れ込みません。stdout へ出したいときは `{ stderr: process.stdout }` を渡します。stderr をリダイレクトした場合（`2>log`）は、質問が端末に表示されません。

### コマンドの中で

コマンドの ctx は `stdin`、`stderr`、`signal` を持ち、これはプロンプトが受け取るストリームのオプションそのものです。そのまま渡せます。

```ts
cli.command("init").action(async (ctx) => {
  const name = await prompt.text("Name?", ctx);
  ctx.stdout.write(`${name}\n`);
});
```

テストでは、`exec()` は stdin を渡さない限り stdin なし（`null`）で実行され、入力のないプロンプトは `InputEndedError` で reject されます。コマンドがプロンプトを出すときは `exec(argv, { stdin })` でストリームを渡してください。

### プロンプトの前にインジケーターを終わらせる

[スピナーやバー](progress.md)はプロンプトと同じ stderr に描画します。質問する前に `stop()` や `succeed()` などで終わらせてください。終わらせないと、質問の行がアニメーションのフレームと入り混じります。

## オブジェクトの中身

`prompt` は `text`、`confirm`、`select`、`multiselect`、`password` の5つを持ちます。

## 共通のオプション

どのメソッドも、`PromptOptions<T>` を通じて次のオプションを受け取ります。

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `validate` | `(value: T) => void \| Promise<void>` | — | 中で例外を投げるか reject すると値を拒否します。 |
| `marker` | `string` | `"?"` | 質問の前に置く記号。 |
| `stderr` | `Writable` | `process.stderr` | 質問を書き出す先。 |
| `stdin` | `Readable \| null` | `process.stdin` | 答えを読み取る先。省略すると `process.stdin` を使います。`null` は入力がないことを表し、質問を書く前に `InputEndedError` で reject されます。 |
| `signal` | `AbortSignal` | — | abort されると、待機中のプロンプトをキャンセルします。 |

`required` は共通ではありません。`text` と `password` にだけあります。

`message` と `marker` は1行で描画します。改行は空白に置き換わり、カーソル制御シーケンスは取り除かれます。質問の前に空行を出したいときは、先に stderr のストリームへ書いてください。

### `validate` は Promise を拒否しません

`validate` の中で例外を投げる（または reject する Promise を返す）と、質問の下にエラーメッセージが表示され、もう一度質問します。非同期の検証関数は await されます。返された Promise は、受け入れられる値が来るまで待機したままです。このループから抜け出せるのはキャンセルと入力の終了だけです。

```ts
import { prompt } from "@libraz/node-cli";

const port = await prompt.text("Port:", {
  validate: (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error("Enter a port between 1 and 65535");
    }
  },
});
```

## `prompt.text(message, options?)`

`Promise<string>` を返します。

| フィールド | 既定値 | 挙動 |
| --- | --- | --- |
| `default` | — | 入力が空だったときに使う値。 |
| `placeholder` | — | 質問の後ろに ` (e.g. …)` の形で表示する例。`default` がないときだけ表示されます。 |
| `trim` | `true` | 答えの前後の空白を取り除きます。 |
| `required` | `true` | 空の入力は拒否され、質問を繰り返します。 |

`default` を明示すると、**空文字列であっても** 空の入力がその値で埋められ、必須チェックは **迂回されます。** `required` はそのままに空の答えを受け入れたい場合は、`default: ""` を渡してください。

```ts
import { prompt } from "@libraz/node-cli";

const branch = await prompt.text("Branch:", { default: "main" });
const note = await prompt.text("Note:", { default: "" }); // may come back empty
const email = await prompt.text("Email:", { placeholder: "you@example.com" });
```

## `prompt.confirm(message, options?)`

`Promise<boolean>` を返します。追加のオプションは `default` だけで、既定値は `false` です。

質問の後に出るヒントは、既定値が `true` なら `(Y/n)`、`false` なら `(y/N)` です。受け付ける答えは、空の入力（既定値が採用されます）と、大文字小文字を区別しない `y`、`yes`、`n`、`no` です。それ以外はメッセージを表示して、もう一度質問します。

```ts
import { prompt } from "@libraz/node-cli";

if (await prompt.confirm("Delete all local branches?", { default: false })) {
  console.log("deleting");
}
```

## `prompt.select(message, choices, options?)`

`Promise<T>` を返します。`choices` が空の配列だと、コード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。`default` がどの選択肢にも一致しないときも同じで、検査は質問を書く前に行われます。

`select` と `multiselect` は `T` を `const` 型パラメーターとして宣言しているため、リテラルの配列は `as const` なしでも値のユニオンとして推論され、`default` はそのユニオンに対して検査されます。

選択肢は番号付きのリストとして表示されます。入力は **1 始まりの番号** か、大文字小文字を区別しない選択肢ラベルの一致です。何も入力せずに Enter を押すと、既定値が設定されていればそれが選ばれます。ラベルが重複している場合は警告を出したうえで最初の1つに解決するため、後ろのほうを選ぶには番号を入力します。

```ts
import { prompt } from "@libraz/node-cli";

const env = await prompt.select("Environment:", ["dev", "staging", "prod"], {
  default: "staging",
});
```

## `prompt.multiselect(message, choices, options?)`

`Promise<readonly T[]>` を返します。結果は読み取り専用です。

| フィールド | 挙動 |
| --- | --- |
| `default` | あらかじめ選択しておく値の `readonly T[]`。どの要素も選択肢のいずれかに一致する必要があり、一致しないと質問を出す前にコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。 |
| `min` | 選択する項目数の下限。 |
| `max` | 選択する項目数の上限。 |

`choices` が空の配列のとき、`min` または `max` が非負の安全な整数でないとき、`min` が `max` を超えるとき、`min` が選択肢の数を超えるときは、質問を出す前にコード `ERR_INVALID_ARG_VALUE` の `RangeError` を投げます。

入力はカンマ区切りの 1 始まりの番号です。同じ番号の重複は `min` と `max` を数える **前に** 取り除かれるため、`1,1,2` は2件の選択として数えられます。空の入力は既定値を使います。

```ts
import { prompt } from "@libraz/node-cli";

const features = await prompt.multiselect("Enable:", ["auth", "cache", "metrics"], {
  default: ["auth"],
  min: 1,
});
```

## `prompt.password(message, options?)`

`Promise<string>` を返します。入力した文字はアスタリスクとして表示されます。

| フィールド | 既定値 | 挙動 |
| --- | --- | --- |
| `trim` | `false` | `text` と違って空白を残します。秘密の一部かもしれないためです。 |
| `required` | `true` | 空の入力は拒否されます。 |

パスワードのプロンプトに **`default` フィールドはありません。**

質問と伏せ字の表示は、ほかのプロンプトと同じく `stderr` へ書かれるため、取り込まれた stdout にやり取りの断片が混ざることはありません。

```ts
import { prompt } from "@libraz/node-cli";

const token = await prompt.password("API token:");
```

## 選択肢

```ts
type SelectChoice<T> = { label: string; value: T; hint?: string };
type Choice<T> = SelectChoice<T> | Exclude<T, { label: unknown }>;
```

選択肢は、文字列化した形がそのままラベルになる裸の値か、説明用のオブジェクトのどちらかです。`label` を持つ値オブジェクトを裸のまま渡すことはできず、`{ label, value }` で包む必要があります。型がこれを強制します。

```ts
import { prompt } from "@libraz/node-cli";

const region = await prompt.select("Region:", [
  { label: "Tokyo", value: "ap-northeast-1", hint: "closest" },
  { label: "Frankfurt", value: "eu-central-1" },
]);
```

`label` を持つのに `value` を持たないオブジェクトはコード `ERR_INVALID_ARG_TYPE` の `TypeError` になるため、普通のドメインオブジェクトが黙って `undefined` に変わることはありません。

`hint` は `select` と `multiselect` のどちらでもラベルの横に描画されます。

`choices` には `readonly` の配列を渡せるので、`as const` のリストも使えます。

既定値の照合には、選択肢の `value` または選択肢オブジェクト自身に対する `Object.is` を使います。**構造的な等価ではありません。** その場で書いたオブジェクトリテラルを既定値にしても、見た目が同じ選択肢とは一致しません。プリミティブな値で照合するか、同じオブジェクト参照を渡してください。

## キャンセルと入力の終了

プロンプトは、次のいずれの状況でも解決せずに reject します。

`CancelledError`（コード `CANCELLED`、終了コード `130`）になる場合です。

- Ctrl+C が押された
- 渡された `signal` が abort された（最初から abort 済みの signal を含む）。エラーの `cause` は signal の `reason` です

`InputEndedError`（コード `INPUT_ENDED`、終了コード `66`、`promptMessage` に質問文を保持）になる場合です。

- `stdin` が `null` で、読み取る入力がない
- Ctrl+D が押された、または答えが届く前に入力が終端に達した、もしくは閉じられた（値を拒否して再質問している最中も含む）

入力ストリームの I/O エラーは、包まずにそのストリームのエラーで reject されます。

検出には `isCancellationError` を使います。

```ts
import { isCancellationError, prompt } from "@libraz/node-cli";

cli.command("greet").action(async (ctx) => {
  try {
    const name = await prompt.text("Your name:", ctx);
    ctx.stdout.write(`Hello, ${name}\n`);
  } catch (err) {
    if (isCancellationError(err, ctx.signal)) {
      ctx.stderr.write("Cancelled.\n");
      return;
    }
    throw err;
  }
});
```

`AbortSignal` を渡すと、プロンプトに制限時間や外部からの中止ボタンを与えられます。

```ts
import { prompt } from "@libraz/node-cli";

const answer = await prompt.text("Quick — a word:", {
  signal: AbortSignal.timeout(5000),
});
```

捕捉しなかったエラーを CLI がどう扱うかは、[エラー](errors.md)を参照してください。

## 端末がない場合の挙動

端末かどうかは **stdin だけ** から判定します。本物の端末であれば、stdout がリダイレクトされていても行編集と Ctrl+C の処理は残るため、`mycli init | tee log.txt` も対話的なセッションとして振る舞います。

入力がパイプの場合は状況が変わります。

- SIGINT のイベントが起きないため、Ctrl+C は `CancelledError` を発生させず、通常どおりプロセスを終了させます
- 文字のエコーがないため、伏せ字にする対象も画面に現れません
- パイプから読んだ行が、質問の順に1行ずつ答えになります。ある質問が使わなかった行はストリームに残って次のプロンプトの答えになるため、答えの一式をまとめて流し込めます
- 入力が終端に達すると `InputEndedError` になります

着色はストリームごとに判定されるので、リダイレクトされた stderr に色のコードは届きません。ただし質問は届きます。さらに stdin が端末の場合は、readline がエコーする内容、つまり入力された答えと行編集のカーソル制御シーケンスも届きます。このエコーを伏せ字にするのは `password` で、ほかのプロンプトは伏せません。

## 同時実行

同じ入力ストリームから2つのプロンプトが同時に読もうとすると、コード `ERR_INPUT_BUSY` の `Error` を投げます。次のプロンプトを始める前に、必ず前のプロンプトを await してください。

## インタラクティブシェルの中で

[インタラクティブシェル](interactive-shell.md)では、コマンドと mode の action の `ctx.stdin` は、行エディターと共有する端末です。入力はここで説明した関数だけで読み、最後まで読み切らないでください。`prompt.text("Name?", ctx)` は、シェルでも単発の実行でも同じように動きます。

## よくある落とし穴

- **`validate` が Promise を拒否することはありません。** 表示して質問し直すだけです。
- **`text` は既定で切り詰めますが、`password` は切り詰めません。**
- **`text` は既定で必須です。** 空の答えを受け入れるには `default: ""` を渡します。
- **`password` に `default` はありません。**
- **既定値の照合は参照ベースです。** 深い等価ではなく `Object.is` を使います。
- **質問は stderr に出ます。** stdout に出したいときは `{ stderr: process.stdout }` を渡します。
- **`required` があるのは `text` と `password` だけです。**
- **選択の番号は 1 始まりです。** `multiselect` の答えに含まれる重複は、`min` と `max` の判定前にまとめられます。
- **キャンセルは `null` の結果ではなく例外です。** 答えを作れないプロンプトは `CancelledError` か `InputEndedError` を投げます。

## 関連ページ

- [エラー](errors.md) — `CancelledError`、`InputEndedError`、`isCancellationError`、終了コード。
- [インタラクティブシェル](interactive-shell.md) — セッションの中でプロンプトを動かす方法。
- [カラー](color.md) — 書記素の分割とテキストの無害化。
- [サンプル](examples.md) — 対話的なプログラムの完全な例。

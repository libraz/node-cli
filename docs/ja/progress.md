# プログレス

`progress` は、時間のかかる処理がまだ動いていることを示すインジケーターを作ります。合計が分かっている作業のためのプログレスバー、長さが分からない作業のためのスピナー、同時に走る複数の作業のためのマルチバーの3種類です。どのファクトリもパッケージが公開する素の関数なので、`CLI` インスタンスは要りません。

![ダウンロードのプログレスバーが 30・50・100 パーセントでその場に描き直され、続いてスピナーのフレームと成功を示す最終行が並んでいる端末](../assets/progress.svg)

## 最初の例

```ts
import { progress } from "@libraz/node-cli";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const bar = progress.bar({ total: 100, label: "Downloading" });
for (let done = 0; done <= 100; done += 10) {
  bar.update(done);
  await wait(100);
}
bar.succeed("Downloaded");

const spinner = progress.spinner({ label: "Processing..." });
await wait(1000);
spinner.succeed("Done!");
```

どちらのインジケーターも、作った時点で描画を始め、その場で描き直します。端末より幅の広い行は折り返され、再描画、ログ行、結果の行のたびに、その行が占めていたすべての行が消去されます。書き込み先は既定でどちらも **`process.stderr`** で、他のプログラムが読むかもしれない `process.stdout` を空けたままにします。ストリームのオプション名はコマンドの ctx のメンバーと同じ `stderr` なので、ctx をそのままオプションとして渡せます。`progress.spinner({ ...ctx, label })` のように書けます。

## オブジェクトの中身

`progress` は `bar`、`spinner`、`multi`、`releaseAll` の4つを持ちます。`releaseAll` は `progress` のメンバーとしてだけ使えます。`releaseAll` と、その裏にあるカーソル復帰の関数は、パッケージのルートからはエクスポートされません。

## 終了動詞

バー、スピナー、マルチバーのグループは、どれも同じ4つの動詞で終わります。どの動詞も `void` を返します。

| 動詞 | 端末での挙動 | 端末がないときの挙動 |
| --- | --- | --- |
| `succeed(message?)` | フレームを、緑の `✔` と `message ?? label` に置き換えます。バーは先に `total` まで進みます。 | `[OK]` を付けたその1行を書きます。 |
| `fail(message?)` | フレームを、赤の `✖` と `message ?? label` に置き換えます。バーはその位置で止まります。 | `[ERROR]` を付けたその1行を書きます。 |
| `warn(message?)` | フレームを、黄の `⚠` と `message ?? label` に置き換えます。バーはその位置で止まります。 | `[WARN]` を付けたその1行を書きます。 |
| `stop()` | 最後のフレームを残して、行を終えます。 | 何も書きません。 |

動詞を一度呼ぶと、そのハンドルは終了します。以後の呼び出しは何もしません。`[Symbol.dispose]()` は `stop()` と同じです。

結果の行の記号と色は、別々に決まります。

- 記号は、ストリームが端末で `TERM` が `dumb` でなければ `✔`、`✖`、`⚠` です。それ以外では ASCII の印 `[OK]`、`[ERROR]`、`[WARN]` になります。
- 色（緑、赤、黄）は、そのストリームで色が有効なら記号または印に付きます。判定は[カラー](color.md)のとおりです。

| ストリーム | 色 | 結果の行 |
| --- | --- | --- |
| 端末 | 有効 | 色付きの記号 |
| 端末 | 無効（`NO_COLOR`） | 色なしの記号 |
| 端末ではない | 強制（`FORCE_COLOR`） | 色付きの ASCII の印 |
| 端末ではない | 無効 | 色なしの ASCII の印 |

[ロギング](logging.md)の `log.success`、`log.error`、`log.warn` も同じ規則です。

## `progress.bar(options)`

合計が分かっている作業のためのバーを作ります。端末では、`bar()` が戻る前にバーが出力先を取得し、0% を描きます。

### `BarOptions`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `total` | `number` | 必須 | ユニットの総数。`0` 以上の有限な数である必要があり、`0` のときは 100% として描画されます。数値でなければ `TypeError`、それ以外の不正な値は `RangeError` を投げます。 |
| `label` | `string` | `""` | バーの前に置くテキスト。空のときは行から省かれます。 |
| `width` | `number` | `30` | バーの幅（文字数）。小数は切り捨てられ、最低 1 セルになります。有限でない値、`0` 以下の値、`4096` を超える値は `RangeError`、数値でない値は `TypeError` を投げます。 |
| `filled` | `string` | `"█"` | 完了した部分を描く文字。表示幅は 1 である必要があり、満たさないと `RangeError` を投げます。 |
| `empty` | `string` | `"░"` | 残っている部分を描く文字。表示幅は 1 である必要があり、満たさないと `RangeError` を投げます。 |
| `format` | `(state: BarState) => string` | — | 描画される行全体を差し替えます。そのため `width`、`filled`、`empty`、`style` は使われません。`label` は既定の結果メッセージにだけ使われます。返したテキストは端末で安全な1行に整えられます。例外を投げると、バーは端末を解放して動作しなくなり、再描画のきっかけになった呼び出しからそのエラーが伝わります。 |
| `stderr` | `Writable` | `process.stderr` | バーを描く先。 |
| `style` | `StyleSpec` | — | バーの文字に適用するスタイル名、または `"bold.cyan"` のようにドットでつないだ指定。未知の名前は、バーを作った時点で `RangeError` を投げます。 |

既定の行は `` `${label}  [${bar}]  ${percent}%  ${current}/${total}` `` で、ラベルが空のときはラベルを落とします。

### `BarState`

再描画のたびに `format` へ渡されます。どのフィールドも `readonly` です。

| フィールド | 意味 |
| --- | --- |
| `current` | 完了したユニット数。 |
| `total` | 合計。 |
| `percent` | 0 から 100 までの整数の百分率。`total` が `0` のときは `100` です。 |
| `elapsedMs` | バーを作ってからの経過時間（ミリ秒）。 |
| `etaMs` | 残り時間の推定値（ミリ秒）。進捗が出るまでは `Infinity`、完了後は `0` です。 |
| `ratePerSecond` | 1秒あたりのユニット数。 |

```ts
import { progress } from "@libraz/node-cli";

const bar = progress.bar({
  total: 100,
  format: (state) =>
    Number.isFinite(state.etaMs)
      ? `${state.percent}% - ${Math.round(state.etaMs / 1000)}s left`
      : `${state.percent}%`,
});
```

### `Bar`

| メソッド | 挙動 |
| --- | --- |
| `update(current)` | 進捗の値を絶対値で設定します。 |
| `tick(delta = 1)` | 値を `delta` だけ進めます。 |
| `setLabel(label)` | バーの前に描くラベルと、既定の結果メッセージを差し替えます。 |
| `succeed(message?)`、`fail(message?)`、`warn(message?)`、`stop()` | [終了動詞](#終了動詞)です。 |
| `[Symbol.dispose]()` | `stop()` と同じです。 |

`update` や `tick` に渡した `NaN` と無限大は無視され、数値でない値は `TypeError` を投げ、どの値も `[0, total]` の範囲に丸められます。端末がないとき、`update` と `tick` は何もしません。マルチバーのグループの中では、バーの `stop()` がそのバーの行を固定し、グループの動詞はその行を飛ばします。

## `progress.spinner(options?)`

所要時間が分からない作業のための、アニメーションするインジケーターを作ります。端末では、`spinner()` が戻る前にスピナーが出力先を取得してアニメーションを始めます。

### `SpinnerOptions`

| フィールド | 型 | 既定値 | 挙動 |
| --- | --- | --- | --- |
| `label` | `string` | `""` | アニメーションの横に置くテキスト。 |
| `frames` | `readonly string[]` | `["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]` | アニメーションのフレーム。各フレームは幅を問わず丸ごと描かれます。空の配列は `RangeError`、文字列の配列でないものは `TypeError` を投げます。 |
| `intervalMs` | `number` | `80` | フレーム間のミリ秒。`0` より大きい有限な数で、小数も使えます。それ以外は `RangeError`（数値でなければ `TypeError`）を投げます。 |
| `stderr` | `Writable` | `process.stderr` | スピナーを描く先。 |
| `style` | `StyleSpec` | — | フレームの文字に適用するスタイル名、またはドットでつないだ指定。未知の名前は、スピナーを作った時点で `RangeError` を投げます。 |

既定のフレームは上に挙げた点字のドットです。ソースにはもう2種類のフレーム集合がありますが、エクスポートはされていません。使う場合は明示的に渡してください。

```ts
import { progress } from "@libraz/node-cli";

const lineSpinner = progress.spinner({ label: "Working", frames: ["-", "\\", "|", "/"] });
const arrowSpinner = progress.spinner({
  label: "Working",
  frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
});
```

### `Spinner`

| メソッド | 挙動 |
| --- | --- |
| `setLabel(label)` | ラベルを差し替えます。次のフレームから反映されます。繰り返し呼ぶと、そのたびに差し替わります。 |
| `succeed(message?)`、`fail(message?)`、`warn(message?)`、`stop()` | [終了動詞](#終了動詞)です。 |
| `[Symbol.dispose]()` | `stop()` と同じです。 |

アニメーションのタイマー自体は Node プロセスを生かし続けないため、スピナーを動かしたままでも、作業を終えたプログラムは通常どおり終了します。

## `progress.multi(options?)`

複数のバーを1つのブロックとして描くグループを作ります。`options.stderr` は、グループ内のすべてのバーが共有するストリームで、既定は `process.stderr` です。端末では、グループを作った時点でそのストリームを取得します。

```ts
import { progress } from "@libraz/node-cli";

const group = progress.multi();
const download = group.add({ total: 100, label: "download" });
const extract = group.add({ total: 100, label: "extract " });

download.update(60);
extract.update(25);

group.succeed("All done");
```

| メンバー | 挙動 |
| --- | --- |
| `add(options)` | バーを追加して 0% で描き、`Bar` のハンドルを返します。`options` は `stderr` を除いた `BarOptions` です。 |
| `succeed(message?)`、`fail(message?)`、`warn(message?)`、`stop()` | [終了動詞](#終了動詞)です。下に書く規則で適用されます。 |
| `[Symbol.dispose]()` | `stop()` と同じです。 |

グループの中のバーには、単体のバーと同じ動詞を使えます。バーが終わると、そのバー自身の行だけが結果の行になり、グループの残りは描画を続けます。グループの動詞は、まだ終わっていないすべてのバーに同じ動詞を適用してから、グループを閉じます。`message` を渡すと、記号を付けない最後の1行として書かれます。端末がないときは、各バーの結果の行がバーの終了時にすぐ書かれ、そのあとにメッセージの行が続きます。

グループが閉じた後に `add()` を呼ぶと、例外ではなく、どのメソッドも何もしない不活性なハンドルが返ります。グループが閉じた直後にバーを登録したワーカーがあっても、コマンドは失敗しません。

## `using` による自動的な後始末

`using` は JavaScript の宣言で、囲みブロックを抜けるときに後始末の処理を走らせます。通常の終了でも、途中の `return` でも、例外による離脱でも同じです。対象になるのは `[Symbol.dispose]()` メソッドを持つ値で、バー、スピナー、マルチバーのグループはいずれもこれを持ちます。利用にはランタイムと TypeScript の設定で明示的リソース管理が有効になっている必要があります。

```ts
import { copyFileSync } from "node:fs";
import { progress } from "@libraz/node-cli";

function copyAll(files: readonly string[], target: string): void {
  using bar = progress.bar({ total: files.length, label: "Copying" });
  for (const file of files) {
    copyFileSync(file, `${target}/${file}`);
    bar.tick();
  }
}
```

`using` を使わずに書いた、まったく同じ内容のコードです。

```ts
import { copyFileSync } from "node:fs";
import { progress } from "@libraz/node-cli";

function copyAll(files: readonly string[], target: string): void {
  const bar = progress.bar({ total: files.length, label: "Copying" });
  try {
    for (const file of files) {
      copyFileSync(file, `${target}/${file}`);
      bar.tick();
    }
  } finally {
    bar.stop();
  }
}
```

どちらの書き方でも、コピーが途中で例外を投げたときに行が閉じられ、カーソルが元に戻ることは保証されます。

## 端末がない場合の挙動

ここが最も混乱を招くところです。出力先のストリームが **端末** ではない場合、つまり出力をファイルへリダイレクトしたとき、他のプログラムへパイプしたとき、CI のランナーに取り込まれたときには、インジケーターはフレームを描きません。

- **フレームは一切書かれません。** `stop()` で終えたバーやスピナーは、ログに何も残しません。
- **`succeed`、`fail`、`warn` は、結果の行を必ず1行書きます。** バーとマルチバーのグループも同じで、実行結果が CI のログに残ります。あとに残る記録を作る手段はこれです。
- **カーソルを隠して元に戻すのは端末のときだけです。**
- **`TERM=dumb` は、描画については端末ではないものとして扱います。** カーソルを動かせないため、インジケーターは端末ではないストリームと同じに振る舞います。

アニメーションできないストリームでは、結果の行に上の表の ASCII の印が使われます。

どちらの状況でも読めるログを残すには、節目を [`logger`](logging.md) で報告し、対話的な場合はバーに任せてください。

## 後始末とカーソルの復帰

バーやスピナーは描画中に端末のカーソルを隠し、終わるときに再び表示します。

コマンドの実行中に作られたインジケーターは、そのコマンドの範囲に属します。コマンドが成功でも失敗でも終わると、フレームワークはそのコマンドで作られたものだけを止めます。並行する別のコマンドが始めたインジケーターは動き続けます。対話シェルのモードのアクションでも同じです。

`progress.releaseAll()` は、明示的にプロセス全体を解放するための操作です。誰が作ったかにかかわらず、まだ動いているインジケーターをすべて止め、カーソルを隠しているすべてのストリームでカーソルを元に戻します。何度呼んでも安全で、対話シェルのクラッシュハンドラが呼びます。突然の終了に備えて、`process.exit` のハンドラでもカーソルを元に戻します。

## その他の挙動

- **1つのストリームにつき、単体のインジケーターは1つだけです。** 同じ端末ストリームで2つ目のバー、スピナー、マルチバーを作ると、作った時点で code が `ERR_OUTPUT_BUSY` の `Error` を投げます。メッセージはストリームを握っているインジケーターの種類を挙げ、`succeed()`、`fail()`、`warn()`、`stop()` のいずれかで終わらせるよう案内します。両方がバーのときだけ、並行するバーには `progress.multi()` を使うよう併せて案内します。2つのインジケーターは互いの行配置を知りようがないためです。端末でないストリームでは何も描かないので、このガードは働きません。
- **プログレスとログの出力はきれいに混ざります。** 同じストリームへ書く [`logger`](logging.md) は描画中のフレームを避けて書き、その後でインジケーターが自分を描き直します。共有の調停役を介して両者が協調しているためです。生の `stream.write` は協調しないので、描きかけのフレームの途中に割り込みます。

## よくある落とし穴

- **既定のストリームは `process.stdout` ではなく `process.stderr` です。** stdout をファイルへリダイレクトしてもバーは消えません。消えるのは stderr をリダイレクトしたときです。
- **インジケーターは作った時点で始まります。** 作ったまま終わらせないと、出力先を握り続けます。動詞で終えるか、`using` で宣言してください。
- **`stop()` は最後のフレームを残します。** 結果の行に置き換えたいときは、`succeed`、`fail`、`warn` を使います。
- **端末がないとき、バーは動詞を呼ぶまで何も描きません。** 動詞を呼んでも書かれるのは結果の1行だけです。
- **`etaMs` の単位はミリ秒であり、秒ではありません。** 実際に進捗が出るまでは `Infinity` なので、整形する前に `Number.isFinite` で確かめてください。
- **`width` の `0` は例外になりますが、`total` の `0` はなりません。** 後者は最初から完了しているバーとして描画されます。

## 関連ページ

- [ロギング](logging.md) — 動作中のインジケーターと共存するレベル付き出力。
- [カラー](color.md) — `style` が受け付けるスタイル名。
- [コマンド](commands.md) — インジケーターが描画先にする、コマンドの ctx の `stderr`。
- [エラー](errors.md) — キャンセル時とクラッシュ時の挙動。

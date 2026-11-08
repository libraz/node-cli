# オプション

オプションは、先頭にダッシュを付けて書く名前付きの入力です。`--force`、`-p 8080`、`--tag=v2` などがそれにあたります。[位置引数](commands.md)と違って順序を問わず、宣言された型を持ち、既定値を持てます。

オプションはコマンドビルダーの `.option()` で宣言し、アクションの中では `ctx.options` から読み取ります。`ctx.options` の型は宣言から決まります（[型付きのオプション](#型付きのオプション)を参照）。

## オプションを宣言する

`.option()` はフラグ仕様文字列と、任意でスキーマオブジェクトを受け取ります。

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp" });

cli
  .command("serve")
  .option("-p, --port <number>", {
    type: "number",
    default: 3000,
    description: "Port to listen on",
  })
  .option("--verbose", { description: "Print each request" })
  .action((ctx) => {
    const port: number = ctx.options.port;
    ctx.stdout.write(`listening on ${port}\n`);
  });

await cli.start();
```

スキーマは丸ごと省略できます。`.option("--verbose")` は説明のない boolean フラグを宣言します。

オプションはコマンドごとに独立しています。サブコマンドは親のオプションを引き継がないので、受け付けるコマンドそれぞれで宣言してください。

## フラグ仕様文字列

仕様文字列はカンマで分割されます。`<>` や `[]` の内側のカンマは区切りとみなされないため、プレースホルダの中にカンマを含められます。

![フラグ仕様文字列 "-p, --port <number>" の構造。文字列はカンマで 2 つの部分に分割されます。前半の -p には、ショートエイリアス、ダッシュ 1 つとちょうど 1 文字、というラベルが付いています。後半の --port には正規のロング名というラベルが付き、ctx.options で使われるキーであることが示されています。スペースに続く括弧付きのトークン <number> には値のプレースホルダというラベルが付き、スペースが必須であること、取り込まれた語はヘルプ出力にしか使われないことが注記されています。構造図の下には、受け付けられる 4 つの入力形式 --port 8080、--port=8080、-p 8080、-p=8080 が並んでいます。](../assets/option-anatomy-ja.svg)

各部分は次のように読まれます。

| 部分 | 意味 |
|---|---|
| `--long` | 正規のロング名。`--` の部分が複数ある場合、**優先されるのは最後のもの**で、それより前のものはロングエイリアスになります |
| `-x` | ショートエイリアス |
| 各部分の末尾の ` <name>` または ` [name]` | 値のプレースホルダ |

ここから 3 つの規則が導かれます。

**プレースホルダの前のスペースは必須です。** `--port<n>` には空白がないため、プレースホルダとして認識されるものがなく、トークン全体がロング名 `port<n>` として読まれて名前のチェックに失敗します。`--port <n>` と書いてください。

**プレースホルダの名前はヘルプにしか使われません。** `.option("--port <number>")` はヘルプの一覧に `--port <number>` と表示されますが、`ctx.options` のキーは `port` のままです。プレースホルダを書かずにオプションが値を取る場合、ヘルプはロング名で代用して `--port <port>` と表示します。

**`--` の部分がない場合、最初のショートエイリアスがロング名になります。** `.option("-p")` は正規名が `p` のオプションを宣言し、`ctx.options.p` で読み取ります。

名前 — ロング名とすべてのエイリアス — は `/^[A-Za-z0-9][A-Za-z0-9-]*$/` に一致しなければなりません。先頭は英字か数字、以降は英字、数字、ハイフンです。

プレースホルダは、スキーマで `type` を指定しなかったときの推論結果を決めるだけです。型がいったん決まれば、値を取るかどうかはその型だけで決まります。`.option("--name", { type: "string" })` はプレースホルダを持ちませんが次のトークンを消費し、ヘルプには `--name <name>` と表示されます。

```typescript
cli
  .command("build")
  .option("-f, --force") //              boolean; key: force
  .option("--tag <tag>") //              string;  key: tag
  .option("--colour, --color <name>") // string;  key: color, alias: colour
  .option("-p"); //                      boolean; key: p
```

## オプションスキーマ

| フィールド | 型 | 既定値 | 挙動 |
|---|---|---|---|
| `description` | `string` | — | ヘルプに表示される文言 |
| `type` | `"string" \| "number" \| "boolean" \| "string[]" \| "number[]"` | 仕様にプレースホルダがあれば `"string"`、なければ `"boolean"` | 組み込みの型変換を選びます |
| `alias` | `string \| string[]` | — | 追加の名前。1 文字のエイリアスはショートフラグになります。2 文字以上のエイリアスは、仕様が `--` ですでに宣言した名前に対してのみ受け付けられ、それ以外の複数文字エイリアスは例外を送出します |
| `required` | `boolean` | `false` | フラグが与えられないとコマンドが `MissingOptionError` で失敗します。`default` とは併用できません |
| `default` | `unknown` | boolean オプションは `required` でないかぎり `false` を受け取ります | フラグが与えられなかったときにだけ使われます |
| `choices` | `unknown[]` | — | 受け付ける値を制限します |
| `parse` | `(value: string, ctx) => unknown` | — | 組み込みの型変換を完全に置き換えます |
| `validate` | `(value: unknown, ctx) => void` | — | 例外を送出して解決済みの値を拒否します |
| `hidden` | `boolean` | `false` | ヘルプと補完からオプションを除外します |
| `completer` | `readonly string[] \| Completer` | — | タブ補完用の値の候補。固定のリストか、`CompletionContext` を受け取る関数で指定します。`choices` より優先されます |

`alias` で指定したエイリアスは仕様文字列のものとマージされるので、`.option("--port <n>", { alias: "p" })` と `.option("-p, --port <n>")` は同じオプションを宣言します。

## 型と型変換

*型変換*とは、入力された文字列を宣言された型へ変換することです。値はコマンドラインからすべて文字列として届き、型変換がそれを文字列、数値、真偽値、配列に変えます。

**`string`** は `String(value)` を適用し、どんな値でも受け付けます。

**`boolean`** は決まった綴りだけを受け付けます。比較は前後の空白を取り除き、小文字にしてから行われます。

| 入力 | 結果 |
|---|---|
| `true`, `1`, `yes`, `on` | `true` |
| `false`, `0`, `no`, `off`, 空文字列 | `false` |
| それ以外 | `InvalidOptionError` |

boolean オプションは通常、値をまったく必要としません。`--verbose` と書けば `true` になります。上の表が効くのは、`--verbose=0` のように値を明示的に付けた場合です。

**`number`** はプレーンな十進表記だけを受け付けます。先頭の `-` は付けられますが、先頭の `+` は拒否します。小数部と指数部は任意で、指数部には `+` または `-` を付けられます。JavaScript 自身の `Number()` なら受け付ける形のいくつかは拒否します。

| 入力 | 結果 |
|---|---|
| `8080`, `-5`, `3.14`, `1e3` | 受け付けます |
| `0x1f`, `0o17`, `0b101` | 拒否します — 十六進、八進、二進のリテラル |
| `007` | 拒否します — ゼロ埋めの整数 |
| `+5` | 拒否します — 先頭のプラス記号 |
| `Infinity`, `NaN` | 拒否します |
| `""`, `"   "` | 拒否します — 空白だけの文字列 |
| `Number.MAX_SAFE_INTEGER` を超える絶対値 | 拒否します。メッセージは値を「数値ではない」と呼ぶのではなく、安全な整数の上限を示します |

**`string[]` と `number[]`** は常に配列を作ります。単一の値は 1 要素の配列に包まれ、複数の値を取るオプションでは各要素が個別に変換されます。

```typescript
cli.command("run").option("--tags <tag>", { type: "string[]" });
// myapp run --tags a --tags b  → ctx.options.tags is ["a", "b"]
// myapp run --tags a           → ctx.options.tags is ["a"]
```

## 既定値と必須

`default` は、フラグが与えられなかったときに使われる値です。

```typescript
cli.command("run").option("--retries <n>", { type: "number", default: 3 });
// myapp run             → ctx.options.retries is 3
// myapp run --retries 5 → ctx.options.retries is 5
```

宣言された既定値は、オプションの宣言時に組み込みの型変換を通ります。ここから 2 つの帰結が生まれます。型に合わない既定値は、解析時ではなく起動時にただちに例外を送出します。`{ type: "number", default: "abc" }` は `.option()` が走った時点で失敗します。そして型に合う既定値は変換後の形で保持されるので、`{ type: "number", default: "8080" }` は数値の `8080` になります。

無条件に拒否される既定値が 3 つあります。

- `boolean` または `number` のオプションに対する `null`。
- 宣言された `choices` に含まれない既定値。
- `required: true` と組み合わせた既定値。

`required: true` はフラグを必須にします。省くと `MissingOptionError` が送出されます。

```typescript
cli
  .command("deploy")
  .option("--env <env>", { required: true, description: "Target environment" });
```

`required` と `default` は排他で、両方を指定するとオプションの宣言時に例外が送出されます。既定値を持つ必須オプションは決して欠けようがなく、必須指定が何の意味も持たなくなるためです。

boolean オプションは `required` でないかぎり自動的に `default: false` を受け取ります。設定されていない boolean が `undefined` ではなく `false` として読めるのはこのためです。

## 選択肢

`choices` は受け付ける値を制限します。

```typescript
cli.command("deploy").option("--env <env>", { choices: ["dev", "staging", "prod"] });
// myapp deploy --env qa
// → InvalidOptionError: Invalid value "qa" for --env. Allowed: dev, staging, prod
```

比較は緩やかです。宣言された選択肢と等しい候補に加えて、文字列にした形が宣言された選択肢の文字列形と等しい候補も一致します。そのため、選択肢を文字列 `["1", "2"]` で書いた `number` オプションでも入力 `1` を受け付け、これは数値の `1` に変換されます。

配列型のオプションでは、配列全体ではなく各要素が個別に検査されます。

このチェックが走るのは、そのオプションが解決結果に存在するとき、つまりフラグが与えられたか既定値が適用されたときだけです。

## 独自の `parse` と `validate`

`parse` は組み込みの型変換を置き換えます。生の文字列とコマンドコンテキストを受け取り、アクションに見せたいものを返します。

```typescript
cli.command("log").option("--since <date>", {
  parse: (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`not a date: ${value}`);
    return date;
  },
});
```

これを支配する規則が 3 つあります。

- 組み込みの型変換は完全に飛ばされ、宣言された `type` は何も変換しなくなります。
- 配列型では、`parse` が各要素へ順に適用されます。
- 送出された例外は `ValidationError` に包まれ、そのメッセージは `Invalid value for --since: ...` となります。[エラー](errors.md)を参照してください。

`parse` が `default` に適用されることはありません。既定値はすでに解決された値として扱われ、組み込みの型変換だけを通ります。

`validate` は解決済みの値を検査し、例外を送出して拒否します。コマンド上のすべてのオプションが解決された後、2 回目のパスで走るため、`ctx.options` は完成しており、あるオプションを別のオプションと突き合わせて検査できます。

```typescript
cli
  .command("serve")
  .option("--port <n>", { type: "number" })
  .option("--tls", { type: "boolean" })
  .option("--cert <path>", {
    validate: (value, ctx) => {
      if (ctx.options.tls && !value) throw new Error("--tls requires --cert");
    },
  })
  .action(startServer);
```

`validate` が送出した例外も同じように `ValidationError` に包まれます。`choices` のチェックと同様、解決結果に存在するオプションに対してのみ走ります。

オプション 1 つではなくコマンド全体を検証したい場合は、[コマンドビルダーの `validate()`](commands.md#検証) を使ってください。

## 受け付ける入力形式

| 形式 | 挙動 |
|---|---|
| `--long value` | 次のトークンを消費します。ただしそのトークンがオプションらしく見える場合は消費しません |
| `--long=value` | 常に使えます。number 以外のオプションへ `-` で始まる値を渡すには、この形のように値を連結する必要があります |
| `-s value` | ロング形式と同じ |
| `-s=value` | `--long=value` と同じで、`-` で始まる値にも同様に使えます |
| `-abc` | ショートフラグのまとめ書き。`-a -b -c` として読まれます。**すべての**文字が boolean オプションを指していなければなりません |
| `--no-x` | 否定形 — boolean オプションを `false` にします |
| `--` | これより後のトークンはすべて、書いたそのままの位置値になります |
| `-5`, `-3.14` | 位置値。`-5` がオプションになるのは `5` という名前のオプションやエイリアスがある場合だけで、名前に `.` は使えないため `-3.14` がオプションになることはありません |
| `-` 単独 | 位置値 |
| `--` より前にある、引用符で囲まれていない単独の `<` または `>` の語（テキスト行の場合） | `ParseError: Redirection operator "<" is not supported`。argv 配列は検査されず、要素はそのままリテラルとして扱われます |

認識されないフラグは `UnknownOptionError` を送出します。ショートフラグのまとめ書きの中の 1 文字も同じです。まとめ書きの中に値を取るオプションを指す文字がある場合と、値を取るオプションに消費できる値が残っていない場合は、どちらも `InvalidOptionError` を送出します。後者のメッセージは `--long=<value>` の形を示します。

`-` で始まるトークンは通常、現在のオプションの値をそこで打ち切ります。`--tag -x` が `-x` を格納せずに失敗するのはこのためです。例外は `number` と `number[]` のオプションで、トークンが数値として解析できればそれが値として取られるので、`--offset -5` は `-5` を格納します。

```typescript
cli
  .command("list")
  .option("--offset <n>", { type: "number" })
  .option("--tag <tag>");

// myapp list --offset -5   → ctx.options.offset is -5
// myapp list --tag -5      → InvalidOptionError
// myapp list --tag=-5      → ctx.options.tag is "-5"
```

## 繰り返し指定されたオプション

フラグを複数回与えたときの挙動は型によって変わります。

- `string[]` と `number[]` は、出現をすべて入力された順に配列へ蓄積します。
- それ以外の型は**最後**の出現を残し、それより前を捨てます。

```typescript
cli.command("collect").option("--tag <tag>", { type: "string[]" });
// myapp collect --tag a --tag b   → ctx.options.tag is ["a", "b"]

cli.command("label").option("--tag <tag>", { type: "string" });
// myapp label --tag a --tag b     → ctx.options.tag is "b"
```

繰り返し与えられた値を集める方法は、オプションを配列型として宣言することだけです。

## 否定形

`--no-<name>` は boolean オプションを `false` にします。

```typescript
cli.command("build").option("--cache", { type: "boolean", default: true });
// myapp build            → ctx.options.cache is true
// myapp build --no-cache → ctx.options.cache is false
```

規則は 4 つです。

- 否定形が効くのは boolean オプションだけです。string オプションに `--no-port` を使うと `InvalidOptionError` が送出されます。
- `--no-x` は値を取りません。`--no-cache=1` は `InvalidOptionError` を送出します。
- 否定する名前はロング名でもエイリアスでもかまいません。
- オプションの名前が文字どおり `no-x` の場合、否定形は適用されません。`.option("--no-color")` はキーが `no-color` のオプションを作るので、トークン `--no-color` は `color` を `false` にするのではなく、そのオプションを `true` にします。

ヘルプとタブ補完は、否定形が実際に機能する boolean オプションの横にそれを示します。`--no-<name>` という綴りが別のオプションのものである場合は示されません。

## `--` セパレータ

`--` はオプションの解析を終わらせます。これより後のトークンは、ダッシュで始まっていても、書いたそのままの位置値として扱われます。

```typescript
cli.command("run <...args>").action((ctx) => {
  ctx.stdout.write(`${ctx.args.args.join(" ")}\n`);
});
// myapp run -- --verbose -x   → args is ["--verbose", "-x"]
```

これらの値を入れる専用の入れ物はありません。`rest` プロパティも `"--"` というキーもなく、コマンドに残っている位置スロットを順に埋めるだけです。空きスロットがなくなったコマンドは `ExtraArgumentError` を送出するので、`--` が役に立つのは、受け取るだけの位置引数 — たいていは可変長引数 — を宣言したコマンドに限られます。

## アクションでオプションを読む

`ctx.options` は正規のロング名をキーとし、型変換と既定値の適用と検証がすでに済んだ値を保持します。

```typescript
cli
  .command("serve")
  .option("-p, --port <number>", { type: "number", default: 3000 })
  .option("-v, --verbose")
  .option("--tags <tag>", { type: "string[]" })
  .action((ctx) => {
    const port: number = ctx.options.port;
    const verbose: boolean = ctx.options.verbose;
    const tags: readonly string[] = ctx.options.tags ?? [];
    ctx.stdout.write(`port=${port} verbose=${verbose} tags=${tags.length}\n`);
  });
```

キャストは要りません。連鎖の中の `.option()` が、それぞれのキーと値の型を `ctx.options` に加えるからです。規則は次の節で説明します。

`ctx.options` は null プロトタイプのオブジェクトで、通常の `Object` のメソッドを継承しません。キーの有無を調べるには `Object.hasOwn` が必要です。

```typescript
cli
  .command("index")
  .option("--tags <tag>", { type: "string[]" })
  .action((ctx) => {
    if (Object.hasOwn(ctx.options, "tags")) {
      // The flag was supplied, or a default applied.
    }
    // ctx.options.hasOwnProperty("tags") throws a TypeError.
  });
```

## 型付きのオプション

flags 文字列が literal のとき、`.option()` は `ctx.options` の型に項目を 1 つ加えます。この型は、同じ連鎖の中でそれより後に設定するハンドラ（`.action()`、`.validate()`、`.onCancel()`）が受け取ります。

**キー**は、[フラグ仕様文字列](#フラグ仕様文字列)の実行時の規則と同じです。最後の `--name` がキーになり、`--` の部分がなければ最初のショートエイリアスがキーになります。`.option("--no-color")` はキー `no-color` を加え、`color` というキーは生まれません。宣言していないキーを読むと型エラーになります。

**値の型**は、次の表で最初に当てはまる行で決まります。

| スキーマ | 値の型 |
|---|---|
| `choices` | その要素の union（`"string[]"` と `"number[]"` ではその readonly 配列） |
| `parse` | 戻り値を await した型（配列型ではその readonly 配列） |
| `type` | `string`、`number`、`boolean`、`readonly string[]`、`readonly number[]` のいずれか |
| どれもない | flags にプレースホルダがあれば `string`、なければ `boolean` |

**項目は省略可能**（`T | undefined`）になります。ただし、`default` を持つ場合、`required: true` の場合、boolean の場合は省略可能になりません。設定されなかった boolean には既定値 `false` が入るので、boolean は常に値を持ちます。

```typescript
cli
  .command("deploy")
  .option("--env <env>", { choices: ["dev", "prod"], default: "dev" })
  .option("--replicas <n>", { type: "number" })
  .option("--since <date>", { parse: (value) => new Date(value) })
  .option("--dry-run")
  .action((ctx) => {
    ctx.options.env; //      "dev" | "prod"
    ctx.options.replicas; // number | undefined
    ctx.options.since; //    Date | undefined
    ctx.options["dry-run"]; // boolean
  });
```

宣言した `choices` に含まれない `default` は型エラーになります。`.option()` が実行時に送出するエラーと対応しています。`ctx.options` と `ctx.args` は readonly で、その中の配列の値も readonly です。

コマンド自身のオプションは、サブコマンドに引き継がれません。`.command()` が返す builder は、実行時と同じく、オプションを持たない状態から始まります。

位置引数も、literal の定義文字列から同じように型が付きます。`<x>` は `string`、`[x]` は `string | undefined`、`<...x>` と `[...x]` は `readonly string[]` です。

literal でない定義文字列や flags 文字列は、型検査器には読めません。定義文字列が literal でなければ、`ctx.args` と `ctx.options` は `Record<string, unknown>` のままです。flags 文字列が literal でなければ、`ctx.options` は任意のキーを `unknown` 型の値として受け付けるように広がります。名前付きのハンドラ型も同じ 2 つの型パラメータを取るので、コマンドと別に書いたハンドラでは `Action<{ env: string }, { force: boolean }>` のように型を明示できます。

## 落とし穴

**`ctx.options` がエイリアスをキーにすることはありません。** `-p` も `--port` もどちらも `ctx.options.port` に書き込みます。`ctx.options.p` を読むと型エラーになり、実行時には `undefined` になります。`p` が正規名である場合だけは別で、それは仕様文字列に `--` の部分がないときにだけ起こります。

**省略された boolean オプションは `undefined` ではなく `false` です。** boolean には自動的に既定値が入るので、`if (ctx.options.force !== undefined)` は常に真になります。値そのものを調べてください。`if (ctx.options.force)` と書きます。

**`required` と `default` は併用できません。** 両方を宣言すると `.option()` の実行時に例外が送出されます。

**独自の `parse` は `default` には走りません。** 既定値は組み込みの型変換だけを通るので、`Date` を返す `parse` と文字列で書いた既定値を組み合わせると、型の異なる 2 つの値が生まれます。既定値を最終的な形で与えるか、既定値を省いてアクションの中でフォールバックを当ててください。

**プレースホルダは型を気付かれずに変えます。** `.option("-v, --verbose")` は boolean ですが、`.option("-v, --verbose <level>")` は string です。プレースホルダが推論される型を変えるからです。意図が重要な場合は `type` を明示してください。

**ショートフラグのまとめ書きは全文字が boolean でなければなりません。** `p` が値を取るため `-vp 8080` は失敗します。`-v -p 8080` と書いてください。

**仕様の最後の `--` の部分が優先されます。** `.option("--colour, --color <name>")` はオプションを `color` と名付け、`colour` をエイリアスにします。その逆ではありません。

## 関連ページ

- [コマンド](commands.md) — コマンド名、位置引数、ライフサイクル
- [エラー](errors.md) — `InvalidOptionError`、`MissingOptionError`、`UnknownOptionError`、`ValidationError`
- [対話シェル](interactive-shell.md) — タブ補完と `completer`
- [API リファレンス](api-reference.md) — 全シグネチャ

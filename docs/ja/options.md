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
| `--long` | 正規のロング名。`--` の部分が複数ある場合、**優先されるのは最初のもの**で、それ以降のものはロングエイリアスになります |
| `-x` | ショートエイリアス |
| 各部分の末尾の ` <name>` または ` [name]` | 値のプレースホルダ |

ここから 3 つの規則が導かれます。

**プレースホルダの前のスペースは必須です。** `--port<n>` には空白がないため、プレースホルダとして認識されるものがなく、トークン全体がロング名 `port<n>` として読まれて名前のチェックに失敗します。`--port <n>` と書いてください。

**プレースホルダの名前はヘルプにしか使われません。** `.option("--port <number>")` はヘルプの一覧に `--port <number>` と表示されますが、`ctx.options` のキーは `port` のままです。プレースホルダを書かずにオプションが値を取る場合、ヘルプはロング名で代用して `--port <port>` と表示します。

**`--` の部分がない場合、最初のショートエイリアスがロング名になります。** `.option("-p")` は正規名が `p` のオプションを宣言し、`ctx.options.p` で読み取ります。

名前 — ロング名とすべてのエイリアス — は `/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/` に一致しなければなりません。ASCII の英数字を、単一のハイフンでつないだ形です。`_`、連続または末尾のハイフン、ASCII 以外の文字を含む名前は `ERR_INVALID_DEFINITION` を送出します。

### `ctx.options` のキー

キーは正規名を camelCase にしたものです。名前を `-` で分割し、先頭の部分はそのままにして、以降の各部分は先頭を大文字にします。

| フラグ | キー |
|---|---|
| `--dry-run` | `dryRun` |
| `--ipv6-only` | `ipv6Only` |
| `--x-1` | `x1` |
| `--Foo` | `Foo` |
| `-V` | `V` |

ヘルプ、タブ補完、エラーメッセージはフラグの綴り（`--dry-run`）のままで、camelCase のキーを使うのは `ctx.options` だけです。1 つのコマンドの中で、名前から同じキーが作られる 2 つのオプションは、2 つ目の `.option()` の実行時に `ERR_DEFINITION_CONFLICT` を送出します。たとえば `--dry-run` と `--dryRun`、あるいは別のオプションのエイリアスと同じ長い名前です。同じフラグを再度宣言した場合は、先の定義が置き換わります。

`<number>` プレースホルダには `type: "number"` か `"number[]"` が、`<boolean>` プレースホルダには `type: "boolean"` が必要で、ほかの組み合わせは例外を送出します。`<n>` や `<tag>` など、それ以外のプレースホルダ名は自由に付けられます。

プレースホルダは、スキーマで `type` を指定しなかったときの推論結果を決めるだけです。型がいったん決まれば、値を取るかどうかはその型だけで決まります。`.option("--name", { type: "string" })` はプレースホルダを持ちませんが次のトークンを消費し、ヘルプには `--name <name>` と表示されます。

```typescript
cli
  .command("build")
  .option("-f, --force") //              boolean; key: force
  .option("--tag <tag>") //              string;  key: tag
  .option("--colour, --color <name>") // string;  key: colour, alias: color
  .option("-p"); //                      boolean; key: p
```

## オプションスキーマ

| フィールド | 型 | 既定値 | 挙動 |
|---|---|---|---|
| `description` | `string` | — | ヘルプに表示される文言 |
| `type` | `"string" \| "number" \| "boolean" \| "string[]" \| "number[]"` | 仕様にプレースホルダがあれば `"string"`、なければ `"boolean"` | 組み込みの型変換を選びます |
| `alias` | `string \| readonly string[]` | — | 追加のショート名。英字か数字 1 文字で、`"p"` または `"-p"` と書きます。ロングエイリアスはフラグ文字列に書きます（`"--colour, --color"`）。それ以外の複数文字エイリアスは例外を送出します |
| `required` | `boolean` | `false` | フラグが与えられないとコマンドが `MissingOptionError` で失敗します。`default` とは併用できません |
| `default` | オプションの値の型 | boolean オプションは `required` でないかぎり `false` を受け取ります | フラグが与えられなかったときにだけ使われます |
| `choices` | オプションの値の型の `readonly` 配列 | — | 受け付ける値を制限します |
| `parse` | `(value: string, ctx) => unknown` | — | 組み込みの型変換を完全に置き換えます |
| `validate` | `(value, ctx) => void \| Promise<void>` | — | 例外を送出して解決済みの値を拒否します |
| `hidden` | `boolean` | `false` | ヘルプと補完からオプションを除外します |
| `completer` | `readonly string[] \| Completer` | `choices` | タブ補完用の値の候補。固定のリストか、`CompletionContext` を受け取る関数で指定します。`choices` より優先されます |

不正なフラグ文字列や不正なスキーマは、`.option()` の実行時に `code: "ERR_INVALID_DEFINITION"` を持つ `Error` を送出します。同じコマンドの別のオプションがすでに使っている名前やエイリアスは `ERR_DEFINITION_CONFLICT` を送出します。

コマンドは自分の `-h` や `--help` を宣言できます。その場合、コマンドがそのスペルをオプションとして使い、組み込みのヘルプはもう一方の形と `help <command>` に残ります。たとえば `.option("-h, --host <name>")` では、`-h` がオプションを指し、`--help` は引き続きコマンドのヘルプを表示します。このとき、ヘルプのページは `--help` を `-h, ` なしで載せます。両方を宣言すると、組み込みのヘルプには `help <command>` でしか届きません。

`alias` で指定したエイリアスは仕様文字列のものとマージされるので、`.option("--port <n>", { alias: "p" })` と `.option("-p, --port <n>")` は同じオプションを宣言します。

`completer` に関数を渡すと、`CompletionContext` を受け取ります。その値は変換前の生の値で、ここまでに入力された状態のままです。`args` は位置引数を camelCase の名前をキーに、文字列（可変長引数では文字列の配列）で保持します。`options` は `ctx.options` と同じキーで、値を取るオプションは文字列、フラグまたはその `--no-` 形は `true` か `false`、配列オプションは文字列の配列です。

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

`default` は、フラグが与えられなかったときに使われる値です。その型はオプションの値の型です（[型付きのオプション](#型付きのオプション)を参照）。

```typescript
cli.command("run").option("--retries <n>", { type: "number", default: 3 });
// myapp run             → ctx.options.retries is 3
// myapp run --retries 5 → ctx.options.retries is 5
```

独自の `parse` を持たないオプションでは、宣言された既定値はオプションの宣言時に組み込みの型変換を通ります。ここから 2 つの帰結が生まれます。型に合わない既定値は、解析時ではなく起動時にただちに例外を送出します。`{ type: "number", default: "abc" }` は `.option()` が走った時点で失敗します。そして型に合う既定値は変換後の形で保持されるので、`{ type: "number", default: "8080" }` は数値の `8080` になります。型検査は文字列の形を拒否し、この変換は素の JavaScript の呼び出し元のために残されています。

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

`choices` は受け付ける値を制限します。要素の型はオプションの値の型です。`string` オプションなら文字列、`number` オプションなら数値、配列オプションなら要素の型になります。

```typescript
cli.command("deploy").option("--env <env>", { choices: ["dev", "staging", "prod"] });
// myapp deploy --env qa
// → InvalidOptionError: Invalid value "qa" for --env. Allowed: dev, staging, prod

cli.command("scale").option("--replicas <n>", { type: "number", choices: [1, 2, 4] });
```

入力はまずオプションの型へ変換され、変換後の値が選択肢と厳密等価（`===`）で比較されます。`--replicas 2` は数値の `2` に変換されて一致します。`number` オプションでは、選択肢の文字列表記は受け付けられません。

配列型のオプションでは、配列全体ではなく各要素が個別に検査されます。

型の違う選択肢、空の `choices` 配列、有限でない数値や `Number.MAX_SAFE_INTEGER` を超える数値、`parse` との併用、`boolean` オプションへの指定は、`.option()` の実行時に `ERR_INVALID_DEFINITION` を送出し、型エラーにもなります。

このチェックが走るのは、そのオプションが解決結果に存在するとき、つまりフラグが与えられたか既定値が適用されたときだけです。

## 独自の `parse` と `validate`

`parse` は組み込みの型変換を置き換えます。生の文字列とコマンドコンテキストを受け取り、アクションに見せたいものを返します。この時点では他のオプションが未解決のことがあるため、コンテキストの `options` は部分的です。

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
- 送出された `CLIError` はそのまま伝播し、`ctx.signal` のキャンセルはキャンセルのままです。それ以外の例外は `ValidationError` に包まれ、メッセージは `Invalid value "<raw>" for --since: ...`、`value` は生の文字列になります。[エラー](errors.md)を参照してください。

`parse` が `default` に適用されることはなく、`parse` を持つオプションの既定値は型変換もされません。既定値はオプションの値の型で書かれた、解決済みの値として扱われます。`parse: (value) => new Date(value)` なら `default: new Date(0)` と書きます。

`validate` は解決済みの値を検査し、例外を送出して拒否します。`value` パラメータの型はオプションの値の型で、`ctx` はコマンドの完全な `CommandContext` です。コマンド上のすべてのオプションが解決された後、2 回目のパスで走るため、`ctx.options` は完成しており、あるオプションを別のオプションと突き合わせて検査できます。

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

`validate` が送出した例外は `parse` と同じ扱いになります。`choices` のチェックと同様、解決結果に存在するオプションに対してのみ走ります。非同期でもよく、その場合は await されます。

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
- `--no-x` が `x` を `false` にするのは、`x` というオプションが定義されている場合だけです。`no-x` という名前で宣言したオプションは独立したオプションとして扱われます。`.option("--no-color")` はキーが `noColor` のオプションを作り、トークン `--no-color` は `color` を `false` にするのではなく、そのオプションを `true` にします。

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

`ctx.options` は最初のロング名を camelCase にしたものをキーとし、型変換と既定値の適用と検証がすでに済んだ値を保持します。

```typescript
cli
  .command("serve")
  .option("-p, --port <number>", { type: "number", default: 3000 })
  .option("-v, --verbose")
  .option("--tags <tag>", { type: "string[]" })
  .option("--log-level <level>", { choices: ["debug", "info"] })
  .action((ctx) => {
    const { port, verbose, logLevel } = ctx.options;
    const tags: readonly string[] = ctx.options.tags ?? [];
    ctx.stdout.write(`port=${port} verbose=${verbose} level=${logLevel} tags=${tags.length}\n`);
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

**`.option()` は新しい型を持つビルダーを返します。** ビルダーを保持していた変数は以前の型のままなので、呼び出しをチェーンでつなぐか、結果を代入し直してください。

```typescript
const serve = cli.command("serve");
const typed = serve.option("--port <n>", { type: "number", default: 3000 });
typed.action((ctx) => {
  ctx.options.port; // number
});
// serve.action((ctx) => ctx.options.port) is a type error: serve has no options in its type.
```

**キー**は、[フラグ仕様文字列](#フラグ仕様文字列)の実行時の規則と同じです。最初の `--name` を camelCase にしたものがキーになり、`--` の部分がなければ最初のショートエイリアスがキーになります。`.option("--dry-run")` はキー `dryRun` を、`.option("--no-color")` はキー `noColor` を加えます。宣言していないキーを読むと型エラーになります。同じキーをもう一度宣言すると、実行時にオプションが置き換わるのと同様に、型でも前の項目が置き換わります。

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
    ctx.options.dryRun; //   boolean
  });
```

スキーマのメンバーは、この値の型に対して検査されます。型の違う `default`、宣言した `choices` に含まれない `default`、型の違う・空の・`parse` や boolean と併用した `choices`、`default` を持つ `required` のオプションは型エラーになり、`.option()` が実行時に送出するエラーと対応しています。`parse` の `value` は `string`、`validate` の `value` は値の型で、`ctx` はそれより前に宣言したオプションから型付けされます。`ctx.options` と `ctx.args` は readonly で、その中の配列の値も readonly です。

複数のコマンドで共有するスキーマは、`satisfies OptionSchema` で書いたときだけこの型付けを保ちます。`OptionSchema` と注釈すると、オプションの値は `unknown` に広がります。

```typescript
import type { OptionSchema } from "@libraz/node-cli";

const port = { type: "number", default: 8080 } satisfies OptionSchema;

cli.command("serve").option("-p, --port <n>", port);
cli.command("proxy").option("-p, --port <n>", port);
```

コマンド自身のオプションは、サブコマンドに引き継がれません。`.command()` が返す builder は、実行時と同じく、オプションを持たない状態から始まります。

位置引数も、literal の定義文字列から同じように型が付きます。`<x>` は `string`、`[x]` は `string | undefined`、`<...x>` と `[...x]` は `readonly string[]` で、キーは camelCase の名前です。

literal でない定義文字列や flags 文字列は、型検査器には読めません。定義文字列が literal でなければ、`ctx.args` と `ctx.options` は `Record<string, unknown>` のままです。flags 文字列が literal でなければ、`ctx.options` は任意のキーを `unknown` 型の値として受け付けるように広がります。名前付きのハンドラ型も同じ 2 つの型パラメータを取るので、コマンドと別に書いたハンドラでは `Action<{ env: string }, { force: boolean }>` のように型を明示できます。

## 落とし穴

**`ctx.options` がエイリアスをキーにすることはありません。** `-p` も `--port` もどちらも `ctx.options.port` に書き込みます。`ctx.options.p` を読むと型エラーになり、実行時には `undefined` になります。`p` が正規名である場合だけは別で、それは仕様文字列に `--` の部分がないときにだけ起こります。

**省略された boolean オプションは `undefined` ではなく `false` です。** boolean には自動的に既定値が入るので、`if (ctx.options.force !== undefined)` は常に真になります。値そのものを調べてください。`if (ctx.options.force)` と書きます。

**`required` と `default` は併用できません。** 両方を宣言すると `.option()` の実行時に例外が送出されます。

**独自の `parse` は `default` には走りません。** 既定値は解決済みの値なので、オプションの値の型の最終的な形で書いてください。`Date` を返す `parse` なら、文字列ではなく `default: new Date(0)` と書きます。

**プレースホルダは型を気付かれずに変えます。** `.option("-v, --verbose")` は boolean ですが、`.option("-v, --verbose <level>")` は string です。プレースホルダが推論される型を変えるからです。意図が重要な場合は `type` を明示してください。

**ショートフラグのまとめ書きは全文字が boolean でなければなりません。** `p` が値を取るため `-vp 8080` は失敗します。`-v -p 8080` と書いてください。

**仕様の最初の `--` の部分が優先されます。** `.option("--colour, --color <name>")` はオプションを `colour` と名付け、`color` をエイリアスにします。その逆ではありません。

## 関連ページ

- [コマンド](commands.md) — コマンド名、位置引数、ライフサイクル
- [エラー](errors.md) — `InvalidOptionError`、`MissingOptionError`、`UnknownOptionError`、`ValidationError`
- [対話シェル](interactive-shell.md) — タブ補完と `completer`
- [API リファレンス](api-reference.md) — 全シグネチャ

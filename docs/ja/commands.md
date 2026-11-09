# コマンド

コマンドは、名前を入力して呼び出す名前付きの動作です。`cli.command()` はコマンドを 1 つ宣言し、それを設定するためのビルダーを返します。

このページではコマンド名、位置引数、サブコマンド、そしてコマンドが実行時にたどるライフサイクルを扱います。`--force` のようなフラグは[オプション](options.md)で扱います。

## コマンドを定義する

`cli.command()` は仕様文字列を 1 つ受け取り、`CommandBuilder` を返します。そこに `description()` と `action()` をチェーンでつなげます。

```typescript
import { createCLI } from "@libraz/node-cli";

const cli = createCLI({ name: "myapp" });

cli
  .command("ping")
  .description("Check connectivity")
  .action((ctx) => {
    ctx.stdout.write("pong\n");
  });

await cli.start();
```

コマンドはチェーンが終わった時点ではなく `cli.command()` の実行中に登録されるため、呼び出しが返った時点ですでに存在しています。設定用のメソッドはすべて同じビルダーを返すので、チェーンする順序は問いません。チェーンを終えるか移すメソッドは 2 つで、`command(definition)` はサブコマンドのビルダーを返し、`remove()` は真偽値を返します。`option()` は新しい型を持つ同じビルダーを返すので、チェーンでつなぐか結果を代入し直してください（[型付きオプション](options.md#型付きのオプション)を参照）。

アクションは引数を 1 つ、[コマンドコンテキスト](#コマンドコンテキスト)を受け取ります。出力は `console.log` ではなく `ctx.stdout` を通して書き込んでください。対話シェルとテストで出力の振り分けが正しく働きます。

### ビルダーメソッド

| メソッド | 効果 | 戻り値 | 繰り返し呼んだとき |
|---|---|---|---|
| `description(text)` | ヘルプでコマンドの横に表示される文言を設定します | ビルダー | 置き換えます |
| `option(flags, schema)` | フラグを宣言します — [オプション](options.md)を参照 | オプションの型を加えたビルダー | 同じ名前なら同じ位置で置き換え、新しい名前なら追加します |
| `action(fn)` | コマンドがディスパッチされたときに実行する関数を設定します | ビルダー | 置き換えます |
| `alias(...names)` | コマンドの別名を追加します | ビルダー | 追加します。重複は無視します |
| `hidden(hidden = true)` | ヘルプと補完からコマンドを隠します | ビルダー | 置き換えます |
| `validate(fn)` | アクションの前に走るチェックを設定します | ビルダー | 置き換えます |
| `onCancel(fn)` | コマンドが中断されたときに走るハンドラを設定します | ビルダー | 置き換えます |
| `completer(fnOrList)` | タブ補完の候補を、固定のリストまたは関数で設定します — [対話シェル](interactive-shell.md)を参照 | ビルダー | 置き換えます |
| `command(definition)` | このコマンドの下にサブコマンドを宣言します | サブコマンドのビルダー | 同じ名前なら既存のサブコマンドに統合します |
| `remove()` | コマンドの登録を解除します | 削除したら `true` | `false` を返します |

メソッド名は 1 つの規則に従います。コマンド定義の部品と、それを実装するハンドラは役割の名前で呼びます。`action`、`completer`、`validate`、CLI 側の `fallback` がそれにあたります。`on*` と名付けるのは、実行中のコマンドに外から届く出来事への反応だけです。ビルダーの `onCancel` と、ライフサイクルイベント用の `cli.on(...)` が該当します。

completer は文字列の固定リストか関数です。関数は `CompletionContext` を受け取り、候補を読み取り専用の配列か、その Promise で返します。どちらの形も `ctx.current` に対する前方一致で絞り込まれるため、completer は絞り込み前の候補をそのまま返します。

```typescript
cli.command("deploy <env>").completer(["production", "staging"]);

cli
  .command("checkout <branch>")
  .completer(async (ctx) => {
    return await listBranches({ signal: ctx.signal });
  })
  .action(checkout);
```

`default()`、`example()`、`usage()`、`argument()` にあたるメソッドはありません。使用法の行は仕様文字列から生成され、コマンド名を省いたときに走る既定コマンドという概念もありません。

## 引数仕様の構文

仕様文字列は空白で分割されます。各トークンは先頭の文字で分類されます。

- `<` または `[` で始まるトークンは**位置引数**を宣言します。フラグ名を伴わず、決まった位置に入力する値です。
- それ以外のトークンは**素の名前**です。最後の素の名前がコマンド自身で、それより前の素の名前はすべて親コマンドになります。

```typescript
cli.command("deploy <env> [region]");
//           ^^^^^^ command name
//                  ^^^^^ required argument
//                        ^^^^^^^^ optional argument
```

認識される括弧の形は 4 つです。

| トークン | 意味 | `ctx.args` での値 |
|---|---|---|
| `<name>` | 必須、値はちょうど 1 つ | `string` |
| `[name]` | 任意、値は最大 1 つ | `string \| undefined`。省略するとキー自体が存在しない |
| `<...name>` | 必須の可変長 — 値は 1 つ以上 | `readonly string[]`、空にはならない |
| `[...name]` | 任意の可変長 — 値は 0 個以上 | `readonly string[]`、空の場合もある |

仕様が文字列リテラルのとき、`ctx.args` はその文字列から型付けされるので、キャストは不要です。仕様を `string` 型の変数で渡すと、`ctx.args` は `Record<string, unknown>` のままです。

コマンド名、エイリアス、引数名は、ASCII の英数字を単一のハイフンでつないだ形に限ります。`ctx.args` のキーは引数名を camelCase にしたものです。先頭の部分はそのままにし、以降の各部分は先頭を大文字にするので、`<file-name>` は `ctx.args.fileName` で読みます。同じキーになる 2 つの引数は拒否されます。

*可変長*とは、値をちょうど 1 つ取るのではなく、残りの値をすべて配列へ集めることを指します。[用語集](glossary.md)を参照してください。

### 実際の動作

```typescript
cli.command("copy <source> [dest]").action((ctx) => {
  const source = ctx.args.source;
  const dest = ctx.args.dest ?? ".";
  ctx.stdout.write(`${source} -> ${dest}\n`);
});
```

| 入力 | 結果 |
|---|---|
| `myapp copy a.txt b.txt` | `ctx.args` は `{ source: "a.txt", dest: "b.txt" }` |
| `myapp copy a.txt` | `ctx.args` は `{ source: "a.txt" }` — `dest` キーは存在しません |
| `myapp copy` | `MissingArgumentError`。コマンドの使用法の行を伴います |
| `myapp copy a.txt b.txt c.txt` | `c.txt` に対する `ExtraArgumentError` |

可変長引数にすると、最後の行の挙動が変わります。

```typescript
cli.command("copy <...files>").action((ctx) => {
  const files = ctx.args.files;
  ctx.stdout.write(`${files.length} file(s)\n`);
});
```

| 入力 | 結果 |
|---|---|
| `myapp copy a.txt b.txt c.txt` | `ctx.args.files` は `["a.txt", "b.txt", "c.txt"]` |
| `myapp copy a.txt` | `ctx.args.files` は `["a.txt"]` |
| `myapp copy` | `...files` に対する `MissingArgumentError` |

### 仕様が不正なときに送出されるエラー

以下は `cli.command()` の実行中に、`code: "ERR_INVALID_DEFINITION"` を持つ `Error` として送出されます。不正な仕様は、ユーザーがコマンドを入力した時点ではなく起動時に失敗します。

- 引数トークンの後ろに素の名前が現れる（`"deploy <env> now"`）。
- 素の名前がまったく含まれない（`"<env>"`）。
- 括弧の閉じ文字が欠けている（`"deploy <env"`）。
- 引数名が空（`"deploy <>"`）。
- コマンド名または引数名が名前の規則に反する。`_`、連続または末尾のハイフン、ASCII の英数字以外の文字を含む場合です（`"deploy <my_env>"`）。
- 2 つの引数が同じ名前または同じ camelCase キーを共有する（`"copy <file> [file]"`）。
- 任意引数の後ろに必須引数が続く（`"copy [dest] <source>"`）。
- 可変長引数が最後になっていない（`"copy <...files> <dest>"`）。

### 仕様がサポートしないもの

| 書いた内容 | 実際の意味 |
|---|---|
| `[name=foo]` | 拒否されます — `=` は名前の規則の外で、仕様に既定値はありません |
| `<port:number>` | 拒否されます — `:` は名前の規則の外で、型注釈はありません |
| `<dev\|prod>` | 拒否されます — `\|` は名前の規則の外で、共用体はありません |
| `deploy <env> ...` | 末尾の `...` は括弧の形ではないので素の名前として読まれ、引数の後ろの素の名前はエラーになります |

既定値、型、選択肢、検証は位置引数ではなく[オプション](options.md)が受け持ちます。

## 実行時の位置引数

`ctx.args` は、仕様文字列に書いた名前を camelCase にしたものをキーとして位置引数を保持します。メンバーは読み取り専用です。保持されうる値は次の 4 つの規則で説明できます。

**値は常に文字列です。** 可変長でない引数は `string`、可変長引数は `readonly string[]` です。変換は一切行われないので、数値の引数はアクションの中で変換します。

```typescript
cli.command("wait <seconds>").action((ctx) => {
  const seconds = Number(ctx.args.seconds);
  if (!Number.isFinite(seconds)) throw new Error("seconds must be a number");
  ctx.stdout.write(`waiting ${seconds}s\n`);
});
```

**可変長引数は常に配列になります。** `[...name]` ではその配列が空になることもあり、`<...name>` で値が 0 個の場合はアクションが走る前に `MissingArgumentError` で拒否されます。

**任意引数を省くと、そのキー自体が存在しません。** キーが `undefined` という値で存在するわけではありません。読み出せば `undefined` が返るので、既定値はたいてい `??` で書きます。この違いが問題になる場合は `Object.hasOwn` でキーの有無を調べます。

```typescript
cli.command("copy <source> [dest]").action((ctx) => {
  if (Object.hasOwn(ctx.args, "dest")) {
    // The user supplied a destination.
  }
});
```

`ctx.args` は null プロトタイプのオブジェクトで、通常の `Object` のメソッドを継承しません。`ctx.args.hasOwnProperty("dest")` は `TypeError` を送出します。動く形は `Object.hasOwn(ctx.args, "dest")` です。

**余った値はエラーになります。** コマンドが宣言した数より多くの位置値を与え、かつそのコマンドがアクションを持つ場合、`ExtraArgumentError` が送出されます。その `extras` プロパティに余った値がすべて入ります。[エラー](errors.md)を参照してください。

## サブコマンドとグループ

コマンドは別のコマンドの下に入れ子にできます。同じ構造を宣言する形が 2 つあります。

```typescript
// Path form: the last bare name is the command, earlier names are parents.
cli.command("db migrate").action(runMigrations);

// Builder form: keep a reference to the parent and call .command() on it.
const db = cli.command("db").description("Database operations");
db.command("migrate").action(runMigrations);
db.command("seed").action(seedDatabase);
```

パス形式では、まだ存在しない親は**グループ**として自動的に作られます。グループとは名前を持ちアクションを持たないコマンドです。ビルダー形式では、`action()` を設定しないかぎり `cli.command("db")` がそのグループそのものです。

![myapp という名前のアプリケーションのコマンドツリー。ルートの子は 3 つあります。deploy は env 引数を取り、エイリアス d を持ちます。db はアクションを持たないグループで、migrate と seed を子に持ちます。user はアクションを持たないグループで、create <name> と delete <name> を子に持ちます。注記では、エイリアスは実名に解決されること、myapp db だけを実行するとそのグループのヘルプが出ること、myapp db migrate --steps 2 がコマンド経路 db migrate とオプション --steps 2 に分かれることを説明しています。下部の警告枠は落とし穴を示しており、report <file> は引数とサブコマンドの両方を持つため、子の daily には到達できません。](../assets/command-tree-ja.svg)

ディスパッチは入力されたトークンをルートから順にたどり、そこまでに一致したコマンドのサブコマンドと各トークンを照合して、どれにも一致しない最初のトークンで停止します。残ったものはすべて引数とオプションになります。

グループはアクションを持たないため実行できません。挙動は次のとおりです。

- 追加の入力がない場合（`myapp db`）は自身のヘルプページを表示し、サブコマンドを一覧します。
- 追加の入力がある場合（`myapp db bogus`）は未知のコマンドとして報告します。`cli.fallback()` でフォールバックハンドラが登録されていれば、代わりにそのハンドラが入力を受け取ります。登録されていなければ、利用可能なサブコマンドの一覧を伴う `CommandNotFoundError` が送出されます。

### 同じパスを再登録する

同じコマンドパスを二度宣言すると、コマンドを置き換えたり重複させたりせず、既存のコマンドに 2 つの宣言をマージします。これは `cli.command()`、`builder.command()`、プラグインの `ctx.command()` のいずれにも当てはまります。`action`、`description`、補完プロバイダ、`validate`、キャンセルハンドラは、新しい宣言が値を設定していればそれぞれ従来の値を上書きします。オプションはキーごとにマージされます。エイリアスは既存の集合に追加されるため、以前のエイリアスも引き続き解決されます。位置引数のリストは丸ごと置き換えられ、空のリストで置き換えることもできます。

```typescript
cli.command("status <target>").action(showStatus);
cli.command("status").description("Show status"); // argument list is now empty
```

これは、[プラグイン](events-and-plugins.md)が別のモジュールですでに宣言されたコマンドに手を入れるための仕組みです。

### 落とし穴: 到達できないサブコマンド

ディスパッチは、**アクションと 1 つ以上の位置引数の両方**を持つ最初のコマンドで下降を止めます。そこから先のトークンはすべて引数の値として扱われ、サブコマンド名として扱われることはありません。したがって、そうしたコマンドの下にあるサブコマンドは決してディスパッチされません。

```typescript
// Broken: `task` runs and takes an argument, so `list` is only ever an argument.
const task = cli.command("task <name>").action(runTask);
task.command("list").action(listTasks);

// `myapp task list` runs runTask with ctx.args.name === "list".
```

これは黙って起きるわけではありません。登録時に `process.emitWarning` を通じてコード `NODE_CLI_UNREACHABLE_SUBCOMMAND` の警告が出ます。ヘルプとタブ補完はどちらも到達できないサブコマンドを省くので、実行できないものがインターフェースに現れることはありません。

対処は、親からアクションと位置引数の両方を取り除き、引数をサブコマンド側へ移すことです。

```typescript
const task = cli.command("task").description("Task operations");
task.command("run <name>").action(runTask);
task.command("list").action(listTasks);

// myapp task run build
// myapp task list
```

仕様文字列で引数の後ろの素の名前が拒否される理由も、同じ規則で説明できます。`cli.command("task <name> list")` は、まさにこの到達できない構造を書き表したものだからです。

## エイリアス

`alias()` はコマンドの別名を追加します。

```typescript
cli.command("deploy <env>").alias("d", "dep").action(deploy);

// myapp deploy prod
// myapp d prod
// myapp dep prod
```

エイリアスはサブコマンドを含め、どの階層でも使えます。

```typescript
const user = cli.command("user");
user.command("create <name>").alias("c", "new").action(createUser);

// myapp user new Alice
```

エイリアスはアクションが走る前に本来のコマンド名へ解決されるので、`ctx.commandPath` が保持するのは常に正規のパスです。`["user", "create"]` であって `["user", "new"]` にはなりません。

エイリアスは登録時に検査されます。兄弟コマンドの名前と衝突するエイリアスや、別の兄弟がすでに使っているエイリアスを追加すると、`code: "ERR_DEFINITION_CONFLICT"` を持つ `Error` が送出されます。同じ名前なら実在のコマンドが常に優先されるため、エイリアスがコマンドを覆い隠すことはありません。

## 非表示コマンド

`hidden()` はコマンドをヘルプの一覧とタブ補完から取り除きます。

```typescript
cli.command("debug-dump").hidden().action(dumpState);
```

コマンド自体は変わらずディスパッチできます。`myapp debug-dump` は実行されますし、`myapp help debug-dump` はそのページを表示します。非表示は内部用や非推奨のコマンドを公開されるインターフェースから外すためのもので、アクセスを制限するものではありません。

## 検証

`validate()` は、オプションが解決された後、`beforeExecute` イベントの前に走るチェックを登録します。ここで例外を送出するとコマンドは止まります。

```typescript
cli
  .command("deploy <env>")
  .option("--force", { type: "boolean" })
  .validate((ctx) => {
    if (ctx.args.env === "prod" && !ctx.options.force) {
      throw new Error("Deploying to prod requires --force");
    }
  })
  .action(deploy);
```

オプション解決の後に走るため、バリデータは既定値や独自の型変換を含めて完全に解決されたオプション値を見られます。

この関数は非同期でもよく、その場合は await されます。

```typescript
cli.command("deploy <env>").validate(async (ctx) => {
  const exists = await environmentExists(ctx.args.env);
  if (!exists) throw new Error("Environment not found");
});
```

送出された `CLIError` はそのまま伝播するので、バリデータは独自の `code` と終了コードを選べます。`ctx.signal` のキャンセルはキャンセルのままです。それ以外の値は、元の値を `cause` に持つ `ValidationError` にラップされ、終了ステータスは 64 になります。オプションの `parse` と `validate` も同じ扱いです。[エラー](errors.md)を参照してください。

## キャンセル

実行中のコマンドは、Ctrl+C が押されたとき、または `cli.exec()` か `cli.execLine()` に渡した `AbortSignal` が abort されたときにキャンセルされます。これを伝える仕組みは 2 つあり、両方が同時に発火するので、コマンドはどちらか一方でも両方でも使えます。

`onCancel()` は後始末用のコールバックを登録します。このコールバックは await されません。返した Promise が reject した場合、その理由は `error` イベントで報告されます。

```typescript
cli
  .command("sync")
  .onCancel((ctx) => {
    ctx.stderr.write("\nCancelled; rolling back.\n");
    releaseLock();
  })
  .action(runSync);
```

`ctx.signal` は同じタイミングで abort される `AbortSignal` です。abort に対応した API に渡せば、処理そのものが止まります。

```typescript
cli.command("fetch <url>").action(async (ctx) => {
  const res = await fetch(ctx.args.url, { signal: ctx.signal });
  ctx.stdout.write(await res.text());
});
```

キャンセルされたコマンドは `CancelledError`（コード `CANCELLED`、終了コード 130）で reject され、`commandError` も `error` も発火しません。キャンセルは失敗ではないためです。エラーを捕捉するアクションは、`isCancellationError(err, ctx.signal)` でキャンセルと通常の失敗を区別できます。[エラー](errors.md)を参照してください。

キャンセルは協調的です。シグナルの abort とキャンセルハンドラの呼び出しは停止の要請であり、コマンドは自力で止まることを期待されます。実行中のアクションが強制的に巻き戻されることはありません。abort を無視して正常に戻ったアクションは、正常に resolve されます。

端末では、要請を無視するコマンドに対する逃げ道が用意されています。2 回目の Ctrl+C はプロセスを終了ステータス 130 で終了させます。この段階的な強制は `cli.start()` と対話シェルにだけ存在します。`cli.exec()` と `cli.execLine()` は SIGINT を購読しません。これらで走らせたコマンドは `options` に渡した `signal` でキャンセルされ、abort を無視するコマンドは最後まで走ります。

## コマンドを削除する

`remove()` はコマンドの登録を解除し、対象のコマンドが見つかって削除された場合に `true` を返します。

```typescript
const temp = cli.command("temporary").action(runTemporary);
temp.remove(); // true
```

削除はそのコマンドの部分木全体に及び、その下のどこかに登録されたエイリアスも巻き込みます。以後、そのビルダーの他のメソッドはすべて `code: "ERR_COMMAND_REMOVED"` を持つ `Error` を送出するので、古い参照が、登録済みでなくなったコマンドを気付かれずに再設定してしまうことはありません。

## コマンドのライフサイクル

以下の段階のうち 1 から 6 は、直前の段階が成功した場合にだけ実行されます。いずれかで失敗すると、アクションは飛ばされエラーが報告されます。段階 7 または 9 のリスナーが例外を投げた場合は `error` で報告されますが、実行は止まりません。

![左から右へ流れるコマンドのライフサイクル。生の入力をトークン化し、コマンドパスをレジストリと照合し、位置引数を束縛し、オプションを解析し、オプションを解決し、コマンドのバリデータを実行し、beforeExecute イベントを発行し、アクションを実行し、afterExecute イベントを発行します。引数の束縛以降のどの段階からも失敗の分岐が伸びており、共通の経路に合流して commandError、続いて error を発行してからエラーを再送出します。](../assets/command-lifecycle-ja.svg)

1. **トークン化** — コマンドライン文字列を、POSIX シェルの単語規則でトークンへ分割します。シングルクォートは中身をそのまま保ち、ダブルクォートは語をまとめてバックスラッシュのエスケープを許し、クォート外のバックスラッシュは次の 1 文字をエスケープします。クォートされていない `|` は行をパイプの段に分けます。Windows のパスはクォートする（`'C:\Users\me'`）か、`cli.exec([...])` で渡してください。配列はすでにトークン化されており、何も解釈されません。
2. **コマンドパスの照合** — トークンをレジストリと突き合わせ、エイリアスを解決しながら、これ以上サブコマンドが一致しなくなるまでたどります。
3. **位置引数の束縛** — 残ったフラグ以外の値を宣言済みの引数へ割り当て、必須のものが揃っているか確認します。
4. **オプションの解析** — フラグを位置値から切り分け、正規名ごとにまとめます。
5. **オプションの解決** — 型変換、既定値、必須チェック、`choices`、オプションごとの `parse` と `validate` が走ります。[オプション](options.md)を参照してください。
6. **検証** — コマンド自身の `validate()` が走ります。
7. **beforeExecute** — すべてのリスナーへイベントが発行されます。
8. **action** — コマンドのアクションが実行されます。
9. **afterExecute** — アクションが解決した時点でイベントが発行されます。

手順 3、4、5、6、8 のいずれかで例外が送出されると、エラーとコンテキストを伴って `commandError` イベントが発火し、続いて `error` イベントが発火して、エラーが再送出されます。ただしキャンセルは例外で、どちらのイベントも発火しません。手順 7 または 9 のリスナーが例外を投げた場合は `error` だけが発火し、コマンドは最後まで完了します。イベントについては[イベントとプラグイン](events-and-plugins.md)で説明します。

### コードからコマンドを実行する

`cli.exec(argv)` は文字列の配列を受け取り、要素をそのまま使います。`cli.execLine(line)` は文字列を受け取り、手順 1 のトークン化とパイプ分割を通して実行します。信頼できない値は `exec` の配列に入れてください。`execLine` の文字列に埋め込んだ値は `|` を含むことがあり、別のコマンドを起動させます。

```typescript
await cli.exec(["deploy", userInput, "--force"]);
await cli.execLine('greet "Ada Lovelace" | upper');
```

[イベントとプラグイン](events-and-plugins.md#プログラムからの実行)を参照してください。

### コマンドコンテキスト

すべてのアクション、バリデータ、キャンセルハンドラは同じコンテキストオブジェクトを受け取ります。`args` と `options` は、コマンドの定義文字列と、ハンドラより前の `.option()` 呼び出しから型付けされます（[型付きオプション](options.md#型付きのオプション)を参照）。

| プロパティ | 型 | 説明 |
|---|---|---|
| `args` | 定義文字列から型付け | camelCase の名前をキーとする位置引数。読み取り専用、null プロトタイプ |
| `options` | オプションのスキーマから型付け | 最初のロング名を camelCase にしたものをキーとする解決済みオプション。読み取り専用、null プロトタイプ |
| `rawInput` | `string` | 入力を 1 つの文字列にまとめたもの |
| `rawArgv` | `readonly string[] \| null` | 入力が配列だった場合の入力要素そのもの。それ以外は `null` |
| `commandPath` | `readonly string[]` | 正規のパス。例えば `["db", "migrate"]` |
| `shell` | `Shell \| null` | 対話シェル、または `null` |
| `signal` | `AbortSignal` | コマンドがキャンセルされると abort されます |
| `stdin` | `Readable \| null` | 入力ストリーム。利用できない場合は `null` |
| `stdout` | `Writable` | 出力ストリーム |
| `stderr` | `Writable` | エラーストリーム |

このうち 3 つは注意が必要です。

- **`rawInput` は情報が落ちます。** CLI を argv — オペレーティングシステムがプログラムへ渡すコマンドライン語の配列 — から起動した場合、`rawInput` はその要素を半角スペース 1 つでつないだものになるため、引用符や埋め込まれたスペースは区別できなくなります。正確な値が必要なときは `rawArgv` を使ってください。`rawArgv` は配列入力（`cli.start()` と `cli.exec()`）のときだけ設定され、`cli.execLine()` と対話シェルが使う文字列入力では `null` です。
- **`shell` が非 null になるのは対話シェルの中だけです。** 直接実行モードと、`cli.exec()`、`cli.execLine()` の下では `null` です。
- **`stdin` は実行面によって変わります。** 直接実行モードでは `process.stdin`、パイプラインの一段としては上流の段の出力、対話シェルでパイプラインに属さないコマンドでは行エディタと共有する端末です。`cli.exec()` と `cli.execLine()` では `stdin` オプションで、渡さなければ `null` です。[モード](interactive-shell.md#モードサブ-repl)のアクションも端末を受け取ります。

`args` と `options` はどちらも null プロトタイプのオブジェクトです。`ctx.options.hasOwnProperty("force")` は例外を送出するので、`Object.hasOwn(ctx.options, "force")` を使ってください。

## 組み込みヘルプと `--version`

ヘルプは何も宣言しなくても使えます。

`-h` と `--help` はコマンドの引数のどの位置でも認識され、`-vh` のようなショートフラグのまとめ書きの中でも認識されて、そのコマンドのページを表示します。

```bash
$ myapp deploy --help
Usage: myapp deploy <env> [options]
```

ヘルプを要求したときは必須引数のチェックが行われないので、`<env>` を与えていなくても `myapp deploy --help` は動きます。

`--help` または `-h` を唯一のトークンとして与えると、全コマンドの一覧を表示します。`myapp --help deploy` のようにコマンドが続く場合は、`myapp help deploy` と同じくそのコマンドのページを表示します。

`help` という名前のオプション、または `h` をエイリアスに持つオプションを宣言したコマンドでは、これらのフラグは効かなくなります。これは意図した動作で、アプリケーションのフラグが常に優先されます。ヘルプ出力とタブ補完は自動的に追随し、ヘルプを起動できる形だけを案内します。コマンドが自分のオプションに割り当てるのが `-h` だけなら、`--help` がそのコマンドのヘルプのフラグのまま残り、`help <command>` も引き続き使えます。

ヘルプやバージョンの表示はコマンドの実行ではないので、`beforeExecute`、`afterExecute`、`commandError` のイベントは発生しません（[イベントとプラグイン](events-and-plugins.md)を参照）。

`--version` と `-V` はバージョン文字列を表示しますが、それが唯一のトークンであり、かつ `createCLI` に `version` を渡したときに限ります。`version` を渡していなければ、これらは他と同じ未知のフラグです。`-v` というショート形はありません。`-v` はアプリケーションが自由に使えます。

```typescript
const cli = createCLI({ name: "myapp", version: "1.0.0" });
// myapp --version  → 1.0.0
// myapp -V         → 1.0.0
```

コマンド名の位置にある未知のフラグは、`CommandNotFoundError` ではなく終了コード 64 の `UnknownOptionError` になります。

`help` も `help [...command]` として宣言された通常の登録済みコマンドです。`myapp help db migrate` は `db migrate` のページを表示し、解決できない対象については `CommandNotFoundError` を報告します。通常のコマンドなので、他と同じくヘルプ一覧に現れ、並び順は最後になります。

## 関連ページ

- [オプション](options.md) — フラグ、型、既定値、受け付ける入力形式
- [エラー](errors.md) — ディスパッチと検証が送出するエラークラス
- [イベントとプラグイン](events-and-plugins.md) — ライフサイクルイベント、`cli.fallback()`、プラグイン
- [対話シェル](interactive-shell.md) — REPL、パイプ、タブ補完
- [API リファレンス](api-reference.md) — 全シグネチャ

# セルの書き込み・クリア

[利用ガイドへ戻る](./README.md)

セルへ値を入れるときは `cells.set`、値だけを消すときは `cells.clear`、書式なども取り除くときは `cells.delete` を使います。クリア・削除では周囲のセルを移動しません。行や列そのものを削除する操作とは別です。

## 既存の値を上書きするか

書き込み系コマンドの `onConflict` で、書き込み先に異なる非空の値がある場合の扱いを指定します。既定は `overwrite` です。

| 値 | 動作 |
| --- | --- |
| `overwrite` | 入力値を反映する |
| `error` | 競合が1つでもあれば操作全体を中止する |
| `skip` | 競合セルを残し、それ以外を反映する |

対象は `cells.set` / `cells.paste` / `cells.fill` / `cells.replace` / `cells.move` / `cells.writeTable` / `tables.insert` です。空セルや、保存済みの入力値と同じ値は競合しません。比較するのは数式の計算結果ではなく、保存されている文字列です。書式・コメントだけがある空セルも、値の競合にはなりません。

```ts
import { createWorkbook, createSpreadsheetSession } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
session.execute({ type: "cells.set", sheetId, values: { A1: "既存の値" } });

const result = session.execute({
  type: "cells.set", sheetId,
  values: { A1: "新しい値", B1: "追加する値" },
  onConflict: "skip",
});
if (!result.ok) throw new Error(result.message);
console.log(session.getCell(sheetId, "A1")?.value); // "既存の値"
console.log(session.getCell(sheetId, "B1")?.value); // "追加する値"
console.log(result.results[0].write);
// { changedCount: 1, skippedCount: 1, skippedAddresses: ["A1"] }
```

`error` の場合は `ok: false`, `code: "WRITE_CONFLICT"`, `conflicts: ["A1", ...]` を返します。バッチの途中で競合しても、それ以前のコマンドだけを反映しません。型は `SpreadsheetWriteConflictPolicy`、結果の集計は `SpreadsheetWriteReport` です。

`write.skippedCount` と `skippedAddresses` は競合した保存先セルの件数・番地です。移動全体をスキップする場合も、競合していないセルまでは数えません。

`write.changedCount` は実際に保存値・数式が変わったセル数です。別シートへの移動では移動元と移動先の両方を数えます。`skippedAddresses` は書き込み先シートのセル番地です。書式や定義だけが変わった場合は0でも `result.changed: true` になります。`write` が付かない操作もあるため、必要に応じて存在を確認してください。

`skip` には操作の形を保つための例外があります。`cells.move` は移動先に1件でも競合があれば移動全体をスキップし、移動元も残します。`tables.insert` のヘッダーが競合する場合は、列定義の一部だけを作れないためエラーになります。入力規則や結合セルなどの検証エラーを、`skip` で無視することはできません。

## 値だけ消す・セル情報も消す

| コマンド | 値・数式 | 書式・罫線 | コメント・入力規則 | 周囲のセル移動 |
| --- | --- | --- | --- | --- |
| `cells.clear` | 消す | 残す | 残す | しない |
| `cells.clear` + `mode: "all"` | 消す | 消す | 消す | しない |
| `cells.delete` | 消す | 消す | 消す | しない |

どのコマンドも `sheetId` と `range` を指定します。`range` は `"A1:C10"`、または0始まり・両端を含む `{ top, left, bottom, right }` です。`cells.clear.mode` の既定は `"values"`。`cells.delete` はセル情報を削除する `all` と同じです。

```ts
// 値・数式だけを消す。罫線や入力規則は残す。
const cleared = session.execute({ type: "cells.clear", sheetId, range: "A1:B10" });
if (!cleared.ok) throw new Error(cleared.message);

// セル情報を消す。行・列や周囲のセル位置は変更しない。
const deleted = session.execute({ type: "cells.delete", sheetId, range: "D1:E10" });
if (!deleted.ok) throw new Error(deleted.message);
```

`all` / `cells.delete` は範囲内のセルレコードを取り除きます。範囲に完全に含まれる結合・テーブル定義も削除し、条件付き書式は対象部分を除きます。行高・列幅、画像・図形・テキストボックス、名前付き範囲の定義は残します。

結合セルは全体を含めて指定してください。テーブルの一部だけを `all` で削除する操作も拒否します。テーブルのヘッダーを値だけで空にすることはできません。テーブル全体の定義と値を外す場合は `tables.delete` の `clear: "values"` を使います。

値だけのクリアは既存の入力規則で検証します。`allowBlank: false` のセルなどが含まれていれば操作全体を拒否します。書式・コメント・入力規則などを消す場合は、対応する機能もONである必要があります。

## 表示中の操作・保存・履歴

```ts
// ref: React.RefObject<SpreadsheetHandle | null>
const api = ref.current;
if (api) {
  const result = await api.executeAsync({ type: "cells.clear", sheetId, range: "A1:B10" });
  if (!result.ok) console.error(result.message);
}
```

同じコマンドを、画面なしの `applySpreadsheetCommands` とセッション、表示中の `SpreadsheetHandle` で使えます。GUIの「ホーム」→「クリア」からも、値のみ・すべてを選べます。セル選択中のDelete / Backspaceは値のみのクリアです。

GUIでは編集許可・Undo/Redo・変更通知の対象になり、保存は `onSave` で行います。セッションでは履歴だけを保持し、外部通信は行いません。一度に扱える範囲は10,000セルまでです。

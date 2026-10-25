# 行・列のキーを探して書き込む

[利用ガイドへ戻る](./README.md)

`cells.setByLookup` は、指定した列を縦に探して同じ行へ、指定した行を横に探して同じ列へ、または両方のキーの交点へ値を書き込みます。例えば「商品Aの状態を出荷済みにする」「11月の列へ実績を入れる」という指定ができます。

検索と書き込みを1コマンドで実行します。XLOOKUPに似た対象の指定方法ですが、実行時点で対象を決めて通常のセル値を書き込む操作です。キーが後から変わっても再検索や再配置は行いません。

## 範囲と座標

`range` は次のいずれかです。いずれも `sheetId` のシート内にある連続範囲を指定します。

| 指定 | 例 |
| --- | --- |
| A1形式 | `"B3:E6"` |
| 0始まり・両端を含む矩形 | `{ top: 2, left: 1, bottom: 5, right: 4 }` |
| 名前付き範囲 | `{ namedRange: "月別実績" }` |

名前は大文字・小文字を区別せず解決します。存在しない名前や、別シートを指す名前は拒否します。テーブル名を自動で名前付き範囲として扱いません。

**`lookup` と `updates` の行・列番号は、範囲の左上を0とする相対位置です。** `B3:E6` なら `column: 0` はB列、`row: 0` は3行目です。ヘッダーやフィルターで非表示の行も範囲に含まれていれば検索します。ヘッダーの自動除外は行いません。

以下の例は、次のデータと名前付き範囲を作ってから実行します。

```ts
import { createWorkbook, createSpreadsheetSession } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
const prepared = session.batch([
  {
    type: "cells.set", sheetId,
    values: {
      B3: "商品", C3: "10月", D3: "11月", E3: "状態",
      B4: "商品A", C4: "100", D4: "200", E4: "確認中",
      B5: "商品B", C5: "300", D5: "400", E5: "確認中",
      B6: "商品C", C6: "500", D6: "600", E6: "確認中",
    },
  },
  { type: "namedRanges.add", sheetId, name: "月別実績", range: "B3:E6" },
]);
if (!prepared.ok) throw new Error(prepared.message);
```

| セル位置 | B列：相対0 | C列：相対1 | D列：相対2 | E列：相対3 |
| --- | --- | --- | --- | --- |
| 3行目：相対0 | 商品 | 10月 | 11月 | 状態 |
| 4行目：相対1 | 商品A | 100 | 200 | 確認中 |
| 5行目：相対2 | 商品B | 300 | 400 | 確認中 |
| 6行目：相対3 | 商品C | 500 | 600 | 確認中 |

## 列を縦に探して、同じ行へ書き込む

`axis: "rows"` は、`column` にある値を上から下へ検索します。`axis` を省略した場合も同じです。`updates` で、見つかった行のどの列へ何を書き込むか指定します。

```ts
const result = session.execute({
  type: "cells.setByLookup", sheetId,
  range: { namedRange: "月別実績" },
  lookup: { axis: "rows", column: 0, value: "商品A" },
  updates: [
    { column: 2, value: "1200" },
    { column: 3, value: "出荷済み" },
  ],
});
if (!result.ok) throw new Error(result.message);
// D4 = "1200"、E4 = "出荷済み"
```

## 行を横に探して、同じ列へ書き込む

`axis: "columns"` は、`row` にある値を左から右へ検索します。`updates` は、見つかった列の中の相対行番号です。

```ts
const result = session.execute({
  type: "cells.setByLookup", sheetId,
  range: "B3:E6",
  lookup: { axis: "columns", row: 0, value: "11月" },
  updates: [
    { row: 1, value: "1200" },
    { row: 2, value: "1500" },
  ],
});
if (!result.ok) throw new Error(result.message);
// D4 = "1200"、D5 = "1500"
```

## 行キーと列キーの交点へ書き込む

`axis: "both"` は、`lookup.row` で行を、`lookup.column` で列を探します。この場合は `updates` を使わず、コマンド直下の `value` を指定します。

```ts
const result = session.execute({
  type: "cells.setByLookup", sheetId,
  range: { namedRange: "月別実績" },
  lookup: {
    axis: "both",
    row: { column: 0, value: "商品A" },
    column: { row: 0, value: "11月" },
  },
  value: "1800",
});
if (!result.ok) throw new Error(result.message);
// D4 = "1800"
```

複数行・複数列が一致した場合、`onMultiple: "all"` はすべての交点へ同じ値を書き込みます。例えば2行と3列なら6セルです。1組ずつ対応させる動作ではありません。

## 一致条件と見つからない場合

| 指定 | 既定 | 動作 |
| --- | --- | --- |
| `lookIn` | `"values"` | 書式適用後の表示文字列で比較。数式は計算結果を比較する |
| `lookIn: "formulas"` | — | セルに保存した入力文字列で比較。数式は `=...` 自体を比較する |
| `matchCase` | `false` | 大文字・小文字を区別する場合は `true` |
| `onMultiple` | `"error"` | 複数一致なら失敗。`"first"` は先頭、`"all"` は全件を選ぶ |
| `onNotFound` | `"error"` | 一致なしなら失敗。`"skip"` はそのコマンドの書き込みを行わない |
| `onConflict` | `"overwrite"` | 書き込み先の異なる非空値を上書き。`"error"` / `"skip"` も指定可能 |

検索値は文字列全体の完全一致です。部分一致・正規表現・前後空白の除去・数値への型変換は行いません。例えば表示が `"1,200"` のセルを `lookIn: "values"` で探す場合は `"1,200"` と指定します。保存入力が `"1200"` なら `lookIn: "formulas"` では `"1200"` と指定します。

未格納セルも空文字 `""` として比較します。空文字を探す場合、範囲に含まれる空セルも一致候補になるため、必要な範囲だけを指定してください。`first` の順番は縦検索では上から、横検索では左からです。`both` は行・列それぞれへ複数一致の方針を適用し、どちらかが見つからなければ書き込み先はありません。

`onNotFound` は検索対象がない場合、`onConflict` は見つかった書き込み先に既存値がある場合の指定です。両者は別々に評価します。[上書き方針](./cell-writing.md#既存の値を上書きするか)も参照してください。

## 結果・履歴・保存

成功時の `results[i].lookup` は `SpreadsheetLookupWriteReport` です。

| フィールド | 内容 |
| --- | --- |
| `range` | 名前などを解決した検索範囲の矩形 |
| `matchedRows` | 方針に従って選ばれた行の絶対0始まり番号。横検索のみなら空配列 |
| `matchedColumns` | 方針に従って選ばれた列の絶対0始まり番号。縦検索のみなら空配列 |
| `addresses` | 検索によって決まった書き込み先のA1番地配列 |

`lookup.addresses` は既存値との競合でスキップした先も含みます。実際に変わった件数や競合でスキップしたセルは、同じreceiptの `write.changedCount` / `write.skippedCount` / `write.skippedAddresses` で確認します。値が同じなら書き込み先に選ばれていても変更件数は増えません。

`onNotFound: "skip"` で書き込みを行わなかった場合は、`matchedRows` / `matchedColumns` / `addresses` がすべて空配列です。`both` の片方の軸だけ一致した場合も、書き込み対象として選ばれた行・列は返しません。

```ts
if (result.ok) {
  const receipt = result.results[0];
  if (receipt.type === "cells.setByLookup") {
    console.log(receipt.lookup);
    // bothの例:
    // { range: { top: 2, left: 1, bottom: 5, right: 4 },
    //   matchedRows: [3], matchedColumns: [3], addresses: ["D4"] }
    console.log(receipt.write);
  }
}
```

画面なしの `session.execute` / `session.batch` / `applySpreadsheetCommands` と、表示中の `ref.current.executeAsync` / `batchAsync` で同じコマンドを使えます。検索・書き込みは1回のUndo単位です。表示中の操作は編集許可や読み取り専用、入力規則など既存の制御を通ります。`features.search` / `replace` / `namedRanges` によってこのコマンドを無効にはしません。数式の書き込みには `features.formulas` が必要です。

検索結果は**そのコマンドが始まる時点**でまとめて確定します。検索キー自身を書き換えても、そのコマンド内で再検索しません。同じバッチの後続コマンドは、先行する書き込み・行列挿入・名前定義を反映した状態で検索します。

書き込み値は `cells.set` と同じ文字列で、数値や真偽値も文字列として渡します。`"=SUM(C4:D4)"` などの数式も設定できます。既存の書式は保持します。結合セル・テーブル・入力規則に反する書き込み、範囲外や重複する更新位置、不明な引数、上限超過は失敗とし、バッチ全体に部分変更を残しません。1コマンドで解決した書き込み先は最大10,000セルです。

検索する行・列や書き込み先が、結合セルの左上以外を含む場合は拒否します。結合の表示値を各セルへ補完したり、更新先を左上へ自動変更したりしません。検索軸と書き込み先は、未結合セルまたは結合の左上セルを使ってください。

SPONとXLSXへ保存するのは結果の通常セル値・数式です。検索条件やreceiptは保存せず、ファイルを開き直したときにも自動再実行しません。公開型 `SpreadsheetLookupRange` / `SpreadsheetLookupSelector` / `SpreadsheetLookupWriteReport` / `SpreadsheetLookupCommand` はUI入口と `/model` から利用できます。

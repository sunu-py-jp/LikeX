# 名前付き範囲

[利用ガイドへ戻る](./README.md)

`A1:C10` のような連続範囲に名前を付け、座標を呼び出し側に書かずに参照できます。定義はブックの `namedRanges` に保存します。セルの値・書式とは別のデータです。

## 画面なしで追加・取得する

```ts
import { createWorkbook, createSpreadsheetSession } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getWorkbook().sheets[0].id;
const result = session.batch([
  { type: "cells.set", sheetId, values: { A1: "商品", B1: "金額", A2: "商品A", B2: "1200" } },
  { type: "namedRanges.add", sheetId, name: "売上明細", range: "A1:B2" },
]);
if (!result.ok) throw new Error(result.message);

const definition = session.getNamedRange("売上明細");
console.log(definition?.address); // "A1:B2"
const cells = session.getRangeByName("売上明細");
console.log(cells?.[1][1]?.value); // "1200"
```

`applySpreadsheetCommands(workbook, commands)` でも同じコマンドを使えます。表示中の下書きには `await ref.current.executeAsync(command)` / `batchAsync(commands)` を使います。GUIでは編集許可・Undo/Redo・変更イベントを通り、永続化は別途 `onSave` で行います。

## コマンドと戻り値

| コマンド | 引数 |
| --- | --- |
| `namedRanges.add` | `sheetId`, `name`, `range` |
| `namedRanges.update` | `sheetId`, `namedRangeId`, `name?`, `range?`。IDは変えず、指定した項目を更新 |
| `namedRanges.clear` | `sheetId`, `namedRangeId`, `mode?: "values" \| "all"`。定義を残して対象セルをクリア |
| `namedRanges.delete` | `sheetId`, `namedRangeId`, `clear?: "none" \| "values" \| "all"`。定義を削除 |

`range` は同じシート内のA1形式、または `{ top, left, bottom, right }` です。数値は0始まりで両端を含みます。追加時はIDを生成し、成功結果の `results[i].namedRangeId` で受け取れます。更新・クリア・削除も同じフィールドに対象IDを返します。

```ts
const definition = session.getNamedRange("売上明細");
if (definition) {
  const updated = session.execute({
    type: "namedRanges.update", sheetId: definition.sheetId,
    namedRangeId: definition.id, name: "今月の売上", range: "A1:B10",
  });
  if (!updated.ok) throw new Error(updated.message);
}
```

名前はブック全体で一意です。大文字・小文字の違いだけでは別名にできません。文字・数字・ピリオド・アンダースコアを使えますが、先頭の数字、空白、セル番地（`A1` など）、予約名は使えません。名前は255文字、定義は `SPREADSHEET_LIMITS.namedRanges` 件までです。テーブル名とも重複できません。

## 定義を消す場合と、セルも消す場合

| 指定 | 定義 | 値・数式 | 書式・罫線・コメント・入力規則 |
| --- | --- | --- | --- |
| `namedRanges.delete`（既定） | 削除 | 残す | 残す |
| `namedRanges.delete` + `clear: "values"` | 削除 | クリア | 残す |
| `namedRanges.delete` + `clear: "all"` | 削除 | クリア | クリア |
| `namedRanges.clear`（既定） | 残す | クリア | 残す |
| `namedRanges.clear` + `mode: "all"` | 残す | クリア | クリア |

いずれも周囲のセルを詰めたり、行・列を削除したりしません。`all` は範囲内の結合・テーブル定義・条件付き書式にも影響します。部分的に交差する結合やテーブルなどの制約は[セルの書き込み・クリア](./cell-writing.md)と共通です。

入力規則が空白を禁止している場合、値だけのクリアは失敗します。構造化テーブルの見出しも空にできないため、テーブル全体の値を消したい場合は先に `tables.delete` でテーブル定義を外してください。失敗した場合、名前の定義だけを先に削除することはありません。

## 取得する情報

| API | 戻り値 |
| --- | --- |
| `getNamedRange(workbook, name)` | 深いreadonlyの `SpreadsheetNamedRangeInfo`、未登録なら `undefined` |
| `getRangeByName(workbook, name)` | `SpreadsheetReadRange`、未登録なら `undefined`。未格納セルは `null` |
| `getNamedRanges(workbook, sheetId?)` | 定義の配列。シートID省略でブック全体、定義がなければ `[]` |

定義の取得結果には、保存フィールドに加えてA1表記の `address` が入ります。

```json
{
  "id": "生成されたID",
  "name": "売上明細",
  "sheetId": "sheet-1",
  "range": { "top": 0, "left": 0, "bottom": 1, "right": 1 },
  "address": "A1:B2"
}
```

セッションや表示中のHandleでは先頭の `workbook` 引数を省略します。`session.sheet(sheetId).getNamedRanges()` のように、対象シートを先に決める[取得API](./data-access.md)も使えます。

## 行・列の挿入と削除

名前付き範囲の途中へ行・列を挿入すると、定義も自動で拡張します。範囲の先頭位置への挿入では全体が移動し、末尾の直後への挿入では変わりません。次の例は、それぞれ `B3:D6` から操作した結果です。

| 操作 | 行での例と結果 | 列での例と結果 |
| --- | --- | --- |
| 途中へ1つ挿入 | 行4の前 → `B3:D7` | C列の前 → `B3:E6` |
| 先頭の前へ1つ挿入 | 行3の前 → `B4:D7` | B列の前 → `C3:E6` |
| 最終行・列の前へ1つ挿入 | 行6の前 → `B3:D7` | D列の前 → `B3:E6` |
| 末尾直後へ1つ挿入 | 行7の前 → `B3:D6` | E列の前 → `B3:D6` |
| 途中を1つ削除 | 行4を削除 → `B3:D5` | C列を削除 → `B3:C6` |
| 対象の行または列をすべて削除 | 行3〜6を削除 → 定義を削除 | B〜D列を削除 → 定義を削除 |

この追従はGUIと `rows.insert` / `columns.insert` / `rows.delete` / `columns.delete` で共通です。コマンドの `index` は0始まりなので、行4の前への挿入は `index: 3`、C列の前への挿入は `index: 2` です。末尾直後の行・列も含めたい場合は、`namedRanges.update` で範囲を変更します。

範囲全体の切り取り移動にも追従し、一部だけを分割する移動は拒否します。シート名を変えても、シートIDによる参照を維持します。

## GUIと対応範囲

「データ」タブの「名前付き範囲」には「追加」と「管理」があります。「追加」は現在の選択範囲を使って登録ダイアログを開きます。「管理」は右側にパネルを開き、ブック全体の名前・シート・範囲を一覧表示します。

一覧の項目を押すと、その範囲を選択します。別シートの項目では対象シートへ移動します。鉛筆ボタンは登録時と同じダイアログを開き、名前や範囲の変更、定義の削除ができます。削除では、対象セルを残すか、値だけを消すか、書式なども含めて消すかを選べます。

`readOnly` でも管理パネルの一覧と範囲の選択を利用できます。追加と鉛筆ボタンは表示しません。`features.sheets: false` でも一覧はブック全体を表示しますが、別シートの項目は選択・編集できません。

数式バー左の名前ボックスへ登録名を入力してEnterを押す方法でも、その範囲を選択できます。管理パネルと同様に、`features.sheets: false` の場合は現在のシート内に限ります。

`features.namedRanges: false` は名前管理と名前ボックスからの参照を無効にします。保存済みの定義は保持します。読み取り用APIは利用できます。

対応するのは、単一シートの連続したセル範囲です。名前を使った数式（`=SUM(売上明細)`）、定数・数式そのものへの命名、シートごとに同名を持つスコープ、離れた複数範囲には対応していません。XLSX出力ではExcelの名前定義として保持します。

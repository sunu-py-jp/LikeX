# セル・範囲・画像の取得

[利用ガイドへ戻る](./README.md)

保存済みのJSONや処理中のブックから、必要なセル・範囲・オブジェクトを取得できます。`@likex/spreadsheet/model` からimportし、Reactや画面の準備なしで使います。

## セルと範囲

```ts
import {
  createWorkbook, applySpreadsheetCommands, getCell, getRange,
  calculateWorkbook,
} from "@likex/spreadsheet/model";

const initial = createWorkbook();
const sheetId = initial.sheets[0].id;
const result = applySpreadsheetCommands(initial, [{
  type: "cells.set", sheetId,
  values: { A1: "商品", B1: "金額", A2: "サービス", B2: "1200", B3: "=SUM(B2:B2)" },
}]);
if (!result.ok) throw new Error(result.message);
const workbook = result.workbook;

const cell = getCell(workbook, sheetId, "B2");
console.log(cell?.value); // "1200"

const rows = getRange(workbook, sheetId, "A1:B2");
console.log(rows.map(row => row.map(cell => cell?.value ?? "")));
// [["商品", "金額"], ["サービス", "1200"]]

const formula = getCell(workbook, sheetId, "B3")?.value;
const calculated = calculateWorkbook(workbook)[sheetId].B3;
console.log(formula, calculated); // "=SUM(B2:B2)", 1200
```

`getCell` は保存されているセル情報を返します。値、書式、入力規則を取得でき、数値や数式も `value` では文字列です。表示文字列や計算結果への自動変換はしません。複数の数式を調べる場合は、一度 `calculateWorkbook` を呼んで結果を使い回します。

`getRange` の範囲は両端を含みます。`"A1:C5"` の代わりに `{ top: 0, left: 0, bottom: 4, right: 2 }` も渡せます。数値座標は0始まり、配列は指定範囲の左上から行・列の順です。未格納セルは `null` になります。

## IDで画像・図形を取得する

```ts
import { getImage, getImageResource, type SpreadsheetWorkbookSnapshot } from "@likex/spreadsheet/model";

export function readImage(workbook: SpreadsheetWorkbookSnapshot, sheetId: string, drawingId: string) {
  const image = getImage(workbook, sheetId, drawingId);
  if (!image) return undefined;

  const resource = getImageResource(workbook, image.resourceId);
  return {
    alt: image.alt,
    anchor: image.anchor,
    width: image.width,
    height: image.height,
    name: resource?.name,
    mimeType: resource?.mimeType,
    dataUrl: resource?.dataUrl,
  };
}
```

`drawingId` はシート上の配置ID、`resourceId` は画像データ本体のIDです。同じ画像データを複数箇所に置く場合も区別できます。どちらも画像挿入コマンドの結果で受け取れます。描画位置から次の行・列を求める場合は[配置位置のヘルパー](./drawing-placement.md)を使います。

## API一覧

| 関数 | 取得する情報 | 対象がない場合 |
| --- | --- | --- |
| `getCell(workbook, sheetId, address)` | セルの `value`・`format`・`validation` | `undefined` |
| `getRange(workbook, sheetId, range)` | セル情報の二次元配列 | 未格納セルは `null` |
| `getSheet(workbook, sheetId)` | セル・寸法・結合・描画など、シート全体 | 例外 |
| `getDrawing(workbook, sheetId, drawingId)` | 画像・図形・テキストボックスのいずれか | `undefined` |
| `getImage(workbook, sheetId, drawingId)` | 画像の配置情報 | `undefined` |
| `getShape(workbook, sheetId, drawingId)` | 図形の配置・色・文字など | `undefined` |
| `getTextBox(workbook, sheetId, drawingId)` | テキストボックスの配置・文字など | `undefined` |
| `getImageResource(workbook, resourceId)` | 画像データ・形式・元の寸法 | `undefined` |
| `getCellComment(workbook, sheetId, address)` | セルに付いたコメント | `undefined` |

`getImage` に図形のIDを渡すなど、種類が一致しない場合も `undefined` です。存在しないシートID、不正な番地、シート外の番地、逆順や上限を超えた範囲は例外になります。外部のJSONは先に `parseWorkbook` / `normalizeWorkbook` で検証してください。

範囲は1回あたり `SPREADSHEET_LIMITS.rangeCells` セルまでです。大きなシート全体が必要な場合は `getSheet`、一部分だけなら `getCell` / `getRange` を使います。取得結果は深くコピーして凍結するため、大きなシートの全取得をセルごとに繰り返す必要はありません。

結合セルも保存データの位置をそのまま読みます。左上以外のセルを指定しても、左上の値へ自動で読み替えません。結合範囲は `getMergedRange`、左上の位置は `mergedCellPosition` で確認できます。

## 表示中の下書きやセッションから取得する

`SpreadsheetHandle` と [画面なしのセッション](./history-session.md) にも同じ名前のメソッドがあります。先頭の `workbook` 引数だけ省略します。

```ts
const cell = api.getCell(sheetId, "A1");
const range = api.getRange(sheetId, "A1:C5");
const image = api.getImage(sheetId, drawingId);
const resource = image ? api.getImageResource(image.resourceId) : undefined;
```

各呼び出し時点の確定済みデータを読みます。取得結果は独立した読み取り専用スナップショットで、後の編集によって変わりません。セル入力欄で編集中の文字列は含めません。値の変更には `execute` / `batch` などのコマンドAPIを使います。

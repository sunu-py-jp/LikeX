# セル・シート・オブジェクトの取得

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

## 一覧を取得する

単一の対象を探す関数に加え、配列を返す取得関数があります。どれも深いreadonlyのスナップショットで、関数や変更用メソッドは含みません。

| 関数 | 配列の要素 |
| --- | --- |
| `getSheets(workbook)` | `SpreadsheetSheet`。タブの順序で取得 |
| `getNamedRanges(workbook, sheetId?)` | `SpreadsheetNamedRangeInfo`。ID・名前・シートID・範囲・A1表記 |
| `getDrawings(workbook, sheetId)` | `SpreadsheetDrawing`。画像・図形・テキストを描画順で取得 |
| `getImages(workbook, sheetId)` | `SpreadsheetImageDrawing`。画像の配置情報。実体は`resourceId`で参照 |
| `getShapes(workbook, sheetId)` | `SpreadsheetShapeDrawing` |
| `getTextBoxes(workbook, sheetId)` | `SpreadsheetTextDrawing` |
| `getTables(workbook, sheetId?)` | `SpreadsheetTableInfo`。テーブル定義にシートID・A1表記を付加 |

`sheetId?` は任意です。省略した名前付き範囲・テーブルの一覧はブック全体を対象にします。該当する定義・オブジェクトがなければ、`undefined`ではなく空配列 `[]` を返します。有効なブックには少なくとも1シートあるため、`getSheets` は1件以上です。不正なシートIDやブックでは例外になります。

```ts
import { createWorkbook, getSheets, getNamedRanges, getImages } from "@likex/spreadsheet/model";

const workbook = createWorkbook();
for (const sheet of getSheets(workbook)) {
  console.log(sheet.id, sheet.name);
  console.log(getNamedRanges(workbook, sheet.id)); // 初期ブックでは []
  console.log(getImages(workbook, sheet.id));      // 初期ブックでは []
}
```

`getSheet` / `getSheets` は保存するシートJSONを返します。これらの結果へ `.getImages()` などのメソッドを追加することはありません。対象シートを先に決めて繰り返し取得したい場合は、次の `sheet(sheetId)` を使います。

## シートを指定して読み続ける

```ts
import { createWorkbook, createSpreadsheetSession } from "@likex/spreadsheet/model";

const session = createSpreadsheetSession(createWorkbook());
const sheetId = session.getSheets()[0].id;
const sheet = session.sheet(sheetId);

console.log(sheet.getInfo().name); // シートJSONの取得
console.log(sheet.getNamedRanges());
console.log(sheet.getImages());
console.log(sheet.getTables());

session.execute({ type: "cells.set", sheetId, values: { B2: "1200" } });
console.log(sheet.getCell("B2")?.value); // "1200"。呼ぶたびに現在のブックを読む
```

`session.sheet(sheetId)` と表示中の `ref.current.sheet(sheetId)` は `SpreadsheetSheetReadApi` を返します。`getInfo`、`getCell`、`getRange`、`getDrawing`、`getImage`、`getShape`、`getTextBox`、`getCellComment`、`getNamedRanges`、`getDrawings`、`getImages`、`getShapes`、`getTextBoxes`、`getTables` を使えます。シートIDを毎回渡す必要はありません。

取得用のオブジェクトを保持していても、各呼び出しは最新の下書き・セッションを読みます。過去に取得した配列やセルの値が後から書き換わることはありません。対象シートが削除された後は例外になります。

固定したブックに対する読み取りには、`getSheetReader(workbook, sheetId)` も使えます。作成時にコピーしたブックを読み続け、外部の編集結果へ自動では切り替わりません。どちらも変更用APIではなく、セル設定などには引き続き `execute` / `executeAsync` を使います。

## API一覧

| 関数 | 戻り値のデータ型（深いreadonly） | 対象がない場合 |
| --- | --- | --- |
| `getCell(workbook, sheetId, address)` | [`SpreadsheetCell`](#getcell) | `undefined` |
| `getRange(workbook, sheetId, range)` | [`SpreadsheetReadRange`](#getrange)。セルまたは`null`の二次元配列 | 未格納セルは `null` |
| `getSheet(workbook, sheetId)` | [`SpreadsheetSheet`](#getsheet) | 例外 |
| `getDrawing(workbook, sheetId, drawingId)` | [`SpreadsheetDrawing`](#getdrawing)。3種類のunion | `undefined` |
| `getImage(workbook, sheetId, drawingId)` | [`SpreadsheetImageDrawing`](#getimage) | `undefined` |
| `getShape(workbook, sheetId, drawingId)` | [`SpreadsheetShapeDrawing`](#getshape) | `undefined` |
| `getTextBox(workbook, sheetId, drawingId)` | [`SpreadsheetTextDrawing`](#gettextbox) | `undefined` |
| `getImageResource(workbook, resourceId)` | [`SpreadsheetImageResource`](#getimageresource) | `undefined` |
| `getCellComment(workbook, sheetId, address)` | [`SpreadsheetComment`](#getcellcomment) | `undefined` |
| `getNamedRange(workbook, name)` | [`SpreadsheetNamedRangeInfo`](./named-ranges.md#取得する情報) | `undefined` |
| `getRangeByName(workbook, name)` | `SpreadsheetReadRange` | 定義がなければ `undefined`、未格納セルは `null` |
| `getTable(workbook, tableId)` / `getTableByName(workbook, name)` | [`SpreadsheetTableInfo`](./tables.md#既存の値と結果) | `undefined` |

`getImage` に図形のIDを渡すなど、種類が一致しない場合も `undefined` です。存在しないシートID、不正な番地、シート外の番地、逆順や上限を超えた範囲は例外になります。外部のJSONは先に `parseWorkbook` / `normalizeWorkbook` で検証してください。

範囲は1回あたり `SPREADSHEET_LIMITS.rangeCells` セルまでです。大きなシート全体が必要な場合は `getSheet`、一部分だけなら `getCell` / `getRange` を使います。取得結果は深くコピーして凍結するため、大きなシートの全取得をセルごとに繰り返す必要はありません。

結合セルも保存データの位置をそのまま読みます。左上以外のセルを指定しても、左上の値へ自動で読み替えません。結合範囲は `getMergedRange`、左上の位置は `mergedCellPosition` で確認できます。

## 戻り値の形式

どの関数も同期処理です。`Promise` や `{ data: ... }` で包まず、以下のオブジェクト・配列を直接返します。表中の `?` は任意のプロパティです。値がないプロパティは省略されることがあり、既定値がすべて入ったオブジェクトにはなりません。

以下のJSONは戻り値の例です。実際のオブジェクトと配列は深く凍結され、TypeScriptでも深いreadonlyになります。公開されている元のモデル型をそのまま書く代わりに、関数から戻り値の型を取得できます。

```ts
import type { getCell, getRange, getImage, SpreadsheetHandle } from "@likex/spreadsheet";

type CellResult = ReturnType<typeof getCell>;   // readonlyセル情報 | undefined
type RangeResult = ReturnType<typeof getRange>; // readonlyの二次元配列
type ImageResult = ReturnType<typeof getImage>; // readonly画像配置 | undefined
type WorkbookResult = ReturnType<SpreadsheetHandle["getWorkbook"]>;
```

画面なしの関数の型は `@likex/spreadsheet/model` からもimportできます。`SpreadsheetHandle` はコンポーネント用の入口からimportします。

### getCell

`SpreadsheetCell` の深いreadonly、または `undefined`。番地やIDは戻り値に付加しません。

```json
{
  "value": "1200",
  "format": { "bold": true, "numberFormat": "number", "decimalPlaces": 0 },
  "validation": { "type": "number", "min": 0 }
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `value` | `string` | 保存された入力値。数値は`"1200"`、数式は`"=SUM(B2:B5)"`など |
| `format?` | `SpreadsheetCellFormat` | [文字・色・罫線・数値などの書式](./formatting.md) |
| `validation?` | `SpreadsheetDataValidation` | [入力規則](./input-validation.md)。`type`は`list` / `number` / `textLength` / `date` / `checkbox` |

未格納セルは `undefined` です。書式や入力規則だけがある空セルは `{ "value": "", "format": ... }` などのオブジェクトを返します。コメントは `getCellComment` で取得します。

### getRange

`SpreadsheetReadRange`。型の構造は `readonly (readonly (readonlyセル情報 | null)[])[]` です。内側のセル情報は `getCell` と同じ構造です。

例えば `getRange(workbook, sheetId, "A1:C2")` の結果は次の形になります。

```json
[
  [{ "value": "商品" }, { "value": "金額" }, null],
  [{ "value": "サービス" }, { "value": "1200" }, { "value": "=B2*2" }]
]
```

この例では `result[0][0]` がA1、`result[1][2]` がC2です。未格納セルも `null` で位置を保持するため、結果は常に指定範囲と同じ行数・列数です。`range`、`sheetId`、番地、結合情報などの追加フィールドはありません。

### getSheet

`SpreadsheetSheet` の深いreadonly。存在しないシートIDは例外になります。

```json
{
  "id": "sheet-1",
  "name": "売上",
  "rowCount": 100,
  "columnCount": 26,
  "cells": { "A1": { "value": "商品" }, "B1": { "value": "金額" } },
  "rowHeights": { "0": 36 },
  "columnWidths": { "0": 160 },
  "comments": { "A1": { "id": "comment-1", "text": "見出しを確認" } }
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `id` / `name` | `string` | シートID・シート名 |
| `rowCount` / `columnCount` | `number` | シート全体の行数・列数 |
| `cells` | `Record<string, SpreadsheetCell>` | `A1`などの番地をキーにした格納済みセル。空白を埋めた配列ではない |
| `rowHeights?` / `columnWidths?` | `Record<number, number>` | 0始まりの行・列をキーにした変更済み寸法（px）。JSONではキーが文字列になる |
| `drawings?` | `SpreadsheetDrawing[]` | 画像・図形・テキストボックスの配置一覧 |
| `tables?` | `SpreadsheetTable[]` | [テーブル](./tables.md)のID・名前・範囲・列定義 |
| `comments?` | `Record<string, SpreadsheetComment>` | 番地をキーにしたコメント |
| `merges?` | `SpreadsheetMergedRange[]` | 結合範囲。各要素は `{ top, left, bottom, right }`、0始まり・両端を含む |
| `conditionalFormats?` | `SpreadsheetConditionalFormatRule[]` | [条件付き書式](./formatting.md)の定義 |

型表では読みやすさのため配列などのreadonly表記を省略していますが、実際の戻り値はネストした内容も変更できません。画像データ本体はシートには入りません。`getImageResource` またはブックの `resources.images` から取得します。

### getDrawing

`SpreadsheetDrawing` の深いreadonly、または `undefined`。成功した場合は、以下の3種類のどれかをそのまま返します。

| `type` | 型・形式 |
| --- | --- |
| `"image"` | [`getImage`](#getimage)と同じ `SpreadsheetImageDrawing` |
| `"shape"` | [`getShape`](#getshape)と同じ `SpreadsheetShapeDrawing` |
| `"text"` | [`getTextBox`](#gettextbox)と同じ `SpreadsheetTextDrawing` |

`getDrawing` 独自のラッパーはありません。`drawing.type` で絞り込むと、画像の `resourceId` など、その種類だけのフィールドを扱えます。すべての種類が次のフィールドを持ちます。

| 共通フィールド | 型 | 内容 |
| --- | --- | --- |
| `id` | `string` | シート上の配置ID（`drawingId`） |
| `type` | `"image"` / `"shape"` / `"text"` | 配置の種類 |
| `anchor` | `{ row: number; column: number; offsetX: number; offsetY: number }` | 行・列は0始まり。offsetはアンカーセル左上からのpx |
| `width` / `height` | `number` | 表示枠の幅・高さ（px） |

### getImage

`SpreadsheetImageDrawing` の深いreadonly、または `undefined`。画像の配置情報であり、画像バイナリやURLを直接は含みません。

```json
{
  "id": "drawing-image-1",
  "type": "image",
  "resourceId": "resource-1",
  "alt": "売上の説明画像",
  "anchor": { "row": 2, "column": 1, "offsetX": 8, "offsetY": 4 },
  "width": 240,
  "height": 120
}
```

共通フィールドに加え、`resourceId: string` と `alt: string` を必ず持ちます。`resourceId` を `getImageResource` に渡すとデータ本体を取得できます。`width` / `height` は配置の寸法で、元画像の寸法とは別です。

### getShape

`SpreadsheetShapeDrawing` の深いreadonly、または `undefined`。

```json
{
  "id": "drawing-shape-1",
  "type": "shape",
  "shape": "rectangle",
  "anchor": { "row": 4, "column": 1, "offsetX": 0, "offsetY": 0 },
  "width": 160,
  "height": 80,
  "fill": "#d9eadf",
  "stroke": "#217346",
  "strokeWidth": 1,
  "text": "承認済み",
  "fontSize": 16,
  "color": "#1f2937",
  "bold": true
}
```

| 共通フィールド以外 | 型 | 内容 |
| --- | --- | --- |
| `shape` | `"rectangle"` / `"ellipse"` / `"line"` / `"arrow"` | 図形の形 |
| `fill` / `stroke` | `string` | 塗りと線の色 |
| `strokeWidth` | `number` | 線幅（px） |
| `text?` | `string` | 図形内の文字 |
| `fontSize?` | `number` | 文字サイズ（px） |
| `color?` | `string` | 文字色 |
| `bold?` | `boolean` | 太字 |

文字関連の任意プロパティが省略されていても、画面側では既定の見た目で描画します。取得時に既定値を補完することはありません。

### getTextBox

`SpreadsheetTextDrawing` の深いreadonly、または `undefined`。`type` は `"textBox"` ではなく `"text"` です。

```json
{
  "id": "drawing-text-1",
  "type": "text",
  "anchor": { "row": 6, "column": 0, "offsetX": 0, "offsetY": 0 },
  "width": 200,
  "height": 80,
  "text": "集計の対象期間を記載",
  "fontSize": 16,
  "color": "#333333",
  "background": "transparent",
  "bold": false
}
```

共通フィールド以外に `text: string`、`fontSize: number`（px）、`color: string`、`background: string`、`bold?: boolean` を持ちます。図形の `fill` / `stroke` はありません。

### getImageResource

`SpreadsheetImageResource` の深いreadonly、または `undefined`。

```json
{
  "name": "sample.png",
  "mimeType": "image/png",
  "dataUrl": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=",
  "width": 1,
  "height": 1
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `name` | `string` | 元画像の名前 |
| `mimeType` | `"image/png"` / `"image/jpeg"` / `"image/webp"` / `"image/gif"` | 画像形式 |
| `dataUrl` | `string` | Base64を含むData URL。Blob、外部ストレージURL、署名付きURLではない |
| `width` / `height` | `number` | 保存された元画像のピクセル寸法。配置枠の寸法ではない |

リソースIDはブック内の辞書のキーで管理されるため、このオブジェクト自体に `id` / `resourceId` は入りません。同じリソースに複数の画像配置が対応することがあります。

### getCellComment

`SpreadsheetComment` の深いreadonly、または `undefined`。

```json
{ "id": "comment-1", "text": "数値を確認してください", "author": "担当者" }
```

フィールドは `id: string`、`text: string`、`author?: string` です。`sheetId`、番地、作成日時は付加しません。取得に使った `sheetId` と `address` を呼び出し側で保持してください。

### getWorkbook

`api.getWorkbook()` / `session.getWorkbook()` の戻り値は `SpreadsheetWorkbookSnapshot`。ブック全体の深いreadonlyで、Promiseではありません。独立した `getWorkbook(workbook)` 関数はありません。

```json
{
  "schemaVersion": 1,
  "sheets": [
    {
      "id": "sheet-1",
      "name": "売上",
      "rowCount": 100,
      "columnCount": 26,
      "cells": { "A1": { "value": "商品" } }
    }
  ]
}
```

| フィールド | 型 | 内容 |
| --- | --- | --- |
| `schemaVersion?` | `1` | 型上は旧データ用に任意。コンポーネント／セッションの正規化済みブックでは`1` |
| `sheets` | `SpreadsheetSheet[]` | 表示順のシート一覧。各要素は[`getSheet`](#getsheet)と同じデータ構造 |
| `namedRanges?` | `SpreadsheetNamedRange[]` | [名前付き範囲](./named-ranges.md)の定義。保存データには派生値の`address`は含まない |
| `resources?` | `{ images?: Record<string, SpreadsheetImageResource> }` | `images`のキーがリソースID、値が[`getImageResource`](#getimageresource)の形式 |

選択範囲・編集中の文字列・Undo履歴・ロック情報は入りません。変更がなければ同じ凍結済みブックを返し、毎回ブック全体をコピーする処理は行いません。各`getCell`などが返す切り出したコピーとは、この点が異なります。

履歴状態は [`getHistoryState()`](./history-session.md)、GUIの編集許可状態は [`getEditState()`](./lifecycle.md)、画像・図形の表示範囲は [`getDrawingBounds()` / `getDrawingPlacement()`](./drawing-placement.md)で取得します。各ページに戻り値の形式を記載しています。

## 表示中の下書きやセッションから取得する

`SpreadsheetHandle` と [画面なしのセッション](./history-session.md) にも同じ名前のメソッドがあります。先頭の `workbook` 引数だけ省略します。

```ts
const cell = api.getCell(sheetId, "A1");
const range = api.getRange(sheetId, "A1:C5");
const image = api.getImage(sheetId, drawingId);
const resource = image ? api.getImageResource(image.resourceId) : undefined;
```

各呼び出し時点の確定済みデータを読みます。取得結果は独立した読み取り専用スナップショットで、後の編集によって変わりません。セル入力欄で編集中の文字列は含めません。値の変更には `execute` / `batch` などのコマンドAPIを使います。

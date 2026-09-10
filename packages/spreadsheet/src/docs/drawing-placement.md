# 配置位置と次の行・列

[利用ガイドへ戻る](./README.md)

画像の下に表を作る場合は、画像挿入の結果にある `placement.nextRow` を使います。右に並べる場合は `placement.nextColumn` を使います。画面の描画やDOMの測定は不要です。

この結果は `applySpreadsheetCommands` と、表示中のコンポーネントの `ref.execute` / `ref.batch` / 非同期版で共通です。すでにある画像の位置を調べる場合は、ブック・シートID・配置IDを渡す `getDrawingPlacement` を使えます。

## 画像の下に表を作る

次は動作確認用の小さなPNGを挿入し、その下に表を作る例です。実際の利用時は `resource` を用意した画像データに置き換えてください。

```ts
import {
  createWorkbook, applySpreadsheetCommands, cellAddress, serializeWorkbook,
} from "@likex/spreadsheet/model";

const workbook = createWorkbook();
const sheetId = workbook.sheets[0].id;
const startColumn = 0;
const resource = {
  name: "sample.png",
  mimeType: "image/png" as const,
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=",
  width: 1,
  height: 1,
};

const inserted = applySpreadsheetCommands(workbook, [{
  type: "images.insert",
  sheetId,
  resource,
  anchor: { row: 0, column: startColumn },
  width: 280, // 高さも比率から280pxになります。
  alt: "売上の説明画像",
}]);
if (!inserted.ok) throw new Error(inserted.message);
const image = inserted.results[0];
if (image.type !== "images.insert") throw new Error("画像挿入の結果が必要です");

const row = image.placement.nextRow; // 10（画面では11行目）
const table = applySpreadsheetCommands(inserted.workbook, [{
  type: "cells.set",
  sheetId,
  values: {
    [cellAddress(row, startColumn)]: "商品",
    [cellAddress(row, startColumn + 1)]: "金額",
    [cellAddress(row + 1, startColumn)]: "サービスA",
    [cellAddress(row + 1, startColumn + 1)]: "1200",
  },
}]);
if (!table.ok) throw new Error(table.message);

const json = serializeWorkbook(table.workbook);
// 全操作が成功したJSONを、呼び出し側で保存します。
```

`nextRow` と `nextColumn` は独立した候補です。両方を開始座標にすると斜め下へ移動します。下に置く場合は元の開始列を維持し、右に置く場合は元の開始行を維持します。

画像の `alt` は省略可能で、既定値はリソースの `name` です。後から `images.update` の `patch: { alt: "説明" }` で変更でき、JSONにも保存されます。配置計算には影響しません。

## コマンドごとの返却内容

位置は成功結果の `results` 内、各 `SpreadsheetCommandReceipt` の `placement` に入ります。行・列は0始まりです。

| コマンド | `placement` |
| --- | --- |
| `images.insert` / `shapes.insert` / `textBoxes.insert` | 配置枠の直下・右隣にあるセルの `nextRow` / `nextColumn` |
| `images.update` / `shapes.update` / `textBoxes.update` | 更新後の配置枠から求めた `nextRow` / `nextColumn` |
| `cells.set` | 指定したセル群の最終行＋1、最終列＋1。空の `values` では省略 |
| `cells.paste` | 貼り付け先の最終行＋1、最終列＋1。空の貼り付けでは省略 |
| `cells.fill` | 展開先範囲の最終行＋1、最終列＋1 |
| `rows.insert` | `nextRow` のみ。`index + count`。`count` の既定値は1 |
| `columns.insert` | `nextColumn` のみ。`index + count` |
| `rows.delete` / `columns.delete` | 省略 |
| `rows.resize` / `columns.resize` / `dimensions.resize` | 省略 |
| `cells.format` / `cells.validation` / `conditionalFormats.set` | 省略 |
| `cells.merge` / `cells.unmerge` / `cells.replace` / `comments.set` | 省略 |
| `drawings.delete` | 省略 |
| `sheets.add` / `sheets.duplicate` / `sheets.rename` / `sheets.move` / `sheets.delete` | 省略。対象は `sheetId` で取得 |

`cells.set` は指定されたセルを基準にします。離れたセル間の空白も含み、同じ値の再設定や空文字による消去でも位置を返します。実際に変更したセルだけを基準にはしません。空の指定では次の位置を決められないため、`placement` を省略します。

コマンドの `type` で結果の型を絞り込めます。例えば `rows.insert` の結果には `placement.nextRow` があり、列の値を前提にせず扱えます。セル設定と貼り付けでは、空の指定に備えて `placement` の有無を確認します。

## IDから位置を取得・再計算する

ヘルパーは `@likex/spreadsheet/model` と `@likex/spreadsheet` の両方からimportできます。サーバーで使う場合は `/model` の入口を使います。

| API | 戻り値 |
| --- | --- |
| `getDrawingBounds(workbook, sheetId, drawingId)` | `SpreadsheetDrawingBounds`。`left` / `top` / `right` / `bottom` / `width` / `height` |
| `getDrawingPlacement(workbook, sheetId, drawingId, options?)` | `SpreadsheetDrawingPlacement`。上記の `bounds` と `nextRow` / `nextColumn` |
| `SpreadsheetDrawingPlacementOptions` | `gap?: number`。下・右に確保する余白（px）。既定値は0 |

`drawingId` はシート上の配置IDです。画像データ本体を指す `resourceId` ではありません。画像・図形・テキストボックスに共通で使えます。読み取り専用のスナップショットも渡せます。

座標は、行番号・列見出しを除いたセル領域の左上（A1の左上）を原点とするpxです。スクロール位置や画面上の拡大率には依存しません。画像については、実際の絵柄や透明部分ではなく表示枠を計測します。

```ts
import { getDrawingBounds, getDrawingPlacement } from "@likex/spreadsheet/model";

// workbookは現在のブック、drawingIdは画像挿入時に受け取ったID。
const bounds = getDrawingBounds(workbook, sheetId, drawingId);
console.log(bounds.bottom); // セル領域の上端から画像下端までのpx

const placement = getDrawingPlacement(workbook, sheetId, drawingId, { gap: 12 });
const tableRow = placement.nextRow;
const columnOnRight = placement.nextColumn;
```

余白を指定しても `bounds` 自体は画像の位置を表します。`nextRow` / `nextColumn` の計算だけに余白を加えます。変更済みの行高・列幅と、画像の `offsetX` / `offsetY` も考慮します。下端がちょうど行の境界に来る場合、その境界から始まる行を返し、余分な空行は挟みません。

ヘルパーはブックを変更しない同期関数です。シート・配置IDが見つからない場合や、負数・非有限値の余白などの不正な入力では例外を投げます。

## 配置位置を使うときの注意

### 空き領域を探す処理ではない

`nextRow` / `nextColumn` は対象の直後を表す候補です。既存のセル値・結合セル・別画像との重なりを避ける処理ではありません。既存データを残す場合は必要な行・列を挿入してから書き込みます。

シート末尾を超えた場合も、内側に丸めず位置を返します。現在の行数・列数の外側は既定の行高・列幅として計算します。値を書き込む前に必要な行・列を追加し、`SPREADSHEET_LIMITS.rows` / `columns` の上限内であることを確認してください。候補位置が上限を超えている場合は、そのまま追加できません。

例えば2行分の表を書き込むために必要な追加行数は、`Math.max(0, nextRow + 2 - sheet.rowCount)` です。追加する場合は `rows.insert` の `index` に現在の `sheet.rowCount` を指定します。ヘルパーが自動で行を追加することはありません。

### 結果は各コマンド実行直後の位置

同じバッチで画像を挿入した後に、その上へ行を挿入すると、画像の最終位置は移動します。先に返した画像挿入の `placement` は、その画像挿入直後の位置を保持します。

最終的なブックの位置が必要な場合は、`getDrawingPlacement(result.workbook, sheetId, drawingId)` で再計算します。行高・列幅や画像サイズを変更した後も同じです。表が画像に追従して自動移動する機能ではありません。

画像を挿入してからその下へ表を置く場合は、最初の例のように「挿入 → 結果を取得 → 表の書き込み」の順に呼び出します。最後の結果だけを保存すれば、中間状態を保存せずに済みます。バッチ内で前の結果を参照する独自の式はありません。

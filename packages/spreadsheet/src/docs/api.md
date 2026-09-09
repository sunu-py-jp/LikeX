# 公開API・保存と機能設定

[利用ガイドへ戻る](./README.md)

`Spreadsheet` はdefault / named exportの両方で利用できます。`SpreadsheetProps`、`SpreadsheetWorkbook`、`SpreadsheetSheet`、`SpreadsheetCell`、`SpreadsheetCellFormat`、`SpreadsheetCellPosition`、`SpreadsheetMergedRange`、`SpreadsheetSelection`、`SpreadsheetSelectionRange`、`SpreadsheetFeatures`、`SpreadsheetSaveHandler`、`SpreadsheetColorMode` を公開しています。

## ブックの形式

```ts
import type { SpreadsheetWorkbook } from "@likex/spreadsheet";

const workbook: SpreadsheetWorkbook = {
  sheets: [{
    id: "sales",
    name: "売上",
    rowCount: 100,
    columnCount: 26,
    cells: {
      A1: { value: "商品" },
      B1: { value: "1200", format: { numberFormat: "currency" } },
      B2: { value: "=SUM(B1,300)", format: { bold: true } },
    },
  }],
};
```

`cells` はA1形式のアドレスをキーにした疎なオブジェクトです。空セルをすべて列挙する必要はありません。値は数値・数式も含めて文字列で指定します。シートには一意な `id` と名前が必要です。`columnWidths` / `rowHeights` は0始まりの位置をキーとするサイズ情報です。どちらも画面に反映されますが、画面上で変更できるのは列幅です。

画像の実体は `resources.images`、配置と図形・テキストはシートの `drawings`、セルの注記は `comments` に保持します。`schemaVersion: 1` を持つJSONへ保存でき、旧形式も読み込めます。[挿入機能とJSON保存](./insertions-and-json.md) に構造・公開型・`serializeWorkbook` / `parseWorkbook` の例をまとめています。

結合セルはシートの `merges` に保持します。[セルの結合・解除](./merged-cells.md) に `SpreadsheetMergedRange`、`mergeCells` / `unmergeCells` の例とデータ保持のルールをまとめています。

`createWorkbook()` は100行×26列のブックを作ります。`normalizeWorkbook(input)` は入力を検証し、コピーしたブックを返します。`setCellValue`、`setCellValues`、`moveCells`、`formatCells`、`resizeColumn`、`insertRows`、`deleteRows`、`insertColumns`、`deleteColumns`、`addSheet`、`renameSheet`、`deleteSheet` は元のブックを書き換えず、結果のブックを返します。アドレス変換は `cellAddress` / `parseCellAddress`、計算は `calculateWorkbook`、数式の参照移動は `translateFormula`、TSVは `parseTsv` / `stringifyTsv` を使えます。引数と戻り値の詳細は同梱の公開型で確認できます。

`workbooksEqual(a, b)` はセルのキー順に依存せず、ブックの内容・書式・寸法を比較します。既定書式や元の値・幅へ戻した場合、保存が必要な変更として扱わないためにも利用しています。ブックとセルは変更用関数から新しい値を作り、受け取った下書きを直接書き換えないでください。

## Props

| Prop | 役割・既定値 |
| --- | --- |
| `ref` | `SpreadsheetHandle`。表示中の下書きへ `execute` / `batch` で操作し、`getWorkbook` で取得。[外部操作API](./external-operations.md) |
| `initialWorkbook` | マウント時の初期ブック。省略時は空の100行×26列。再代入で下書きは置き換わりません。 |
| `onChange` | 下書きの変更通知。永続化は行いません。 |
| `onSave` | 保存処理。省略すると読み取り専用。 |
| `readOnly` | `true` なら `onSave` があっても変更操作を無効化。 |
| `features` | 下記の機能設定。省略した項目は `true`。 |
| `onSelectionChange` | `{ sheetId, anchor, focus, ranges }` の通知。行・列は0始まり。`ranges` は全範囲、`focus` は編集先セル（結合内なら左上）。[複数選択](./selection.md) |
| `colorMode` | `"light"`（既定）・`"dark"`・`"system"`。 |
| `title` | 表示タイトル。省略時は「スプレッドシート」。 |
| `className` / `style` | ルート要素のクラス・CSS。高さは利用先で指定。 |
| `aria-label` | 領域の読み上げ名。省略時は「スプレッドシート」。 |

`initialWorkbook` は最初だけ読み込むため、別のブックへの切り替えや保存先の再読み込みには `key={bookIdOrRevision}` などで再マウントします。未保存の下書きも破棄されるため、切り替え前の確認は親で扱ってください。

セル・行列・画像・図形の操作を外側から呼ぶ場合は `SpreadsheetHandle` を使います。公開型とバッチ、エラー、画像の準備関数 `prepareSpreadsheetImage` は[外部操作API](./external-operations.md)にまとめています。

## 保存

```tsx
<Spreadsheet
  initialWorkbook={workbook}
  onSave={async draft => {
    const response = await fetch("/api/workbooks/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if (!response.ok) throw new Error("保存に失敗しました");
    // サーバーが送信内容をそのまま受理した場合は、戻り値なしで完了できます。
  }}
  style={{ height: 560 }}
/>
```

`onSave` はブック全体を受け取り、`void`・`SpreadsheetWorkbook`・それらのPromiseを返します。ブックを返すと検証後に保存済み状態として採用し、戻り値がなければ送信した下書きを採用します。保存中は変更操作を止め、失敗時は下書きを維持してエラーを表示します。成功時にはundo/redo履歴をリセットします。

認証・認可、API入力の検証、同時更新の競合検知、DB等への永続化は利用側で実装してください。UIの読み取り専用設定はサーバーの権限制御に代わるものではありません。下書き・履歴はメモリ内にあり、ページ再読み込みやアンマウントでは失われます。

## 機能設定

```tsx
<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  features={{ formulas: false, formatting: false, rowColumnOperations: false }}
  style={{ height: 560 }}
/>
```

`formulas`、`clipboard`、`formatting`、`mergeCells`、`rowColumnOperations`、`sheets`、`resize`、`undoRedo` を個別に無効化できます。`formulas: false` は数式入力を止めますが、初期ブックにある数式の計算結果は引き続き表示します。`mergeCells: false` は結合配置の変更を止め、保存済みの結合は表示・保持します。`sheets: false` はシート切り替え・管理の操作を隠します。設定はアプリの操作範囲を制限するものであり、保存先の入力検証は別に必要です。

挿入機能には `images`、`shapes`、`textBoxes`、`comments` があります。既定はすべてONで、OFFにすると該当メニューと表示・編集を隠します。非表示にしたデータも保存スナップショットには残ります。

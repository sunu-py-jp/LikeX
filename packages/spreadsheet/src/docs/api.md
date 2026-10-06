# 公開API・保存と機能設定

[利用ガイドへ戻る](./README.md)

`Spreadsheet` はdefault / named exportの両方で利用できます。`SpreadsheetProps`、`SpreadsheetWorkbook`、`SpreadsheetSheet`、`SpreadsheetCell`、`SpreadsheetCellFormat`、`SpreadsheetCellPosition`、`SpreadsheetMergedRange`、`SpreadsheetSelection`、`SpreadsheetSelectionRange`、`SpreadsheetFeatures`、`SpreadsheetSaveHandler`、`SpreadsheetColorMode`、`SpreadsheetRibbonDisplayMode` を公開しています。

## ブックの形式

```ts
import type { SpreadsheetWorkbook } from "@likex/spreadsheet";

const workbook: SpreadsheetWorkbook = {
  sheets: [{
    id: "sales",
    name: "売上",
    rowCount: 300,
    columnCount: 26,
    cells: {
      A1: { value: "商品" },
      B1: { value: "1200", format: { numberFormat: "currency" } },
      B2: { value: "=SUM(B1,300)", format: { bold: true } },
    },
  }],
};
```

`cells` はA1形式のアドレスをキーにした疎なオブジェクトです。空セルをすべて列挙する必要はありません。値は数値・数式も含めて文字列で指定します。シートには一意な `id` と名前が必要です。`columnWidths` / `rowHeights` は0始まりの位置をキーとするサイズ情報です。列幅・行高とも、画面上のグリップや外部コマンドで変更できます。内容に合わせた自動調整も使えます。[書式・行列サイズ](./formatting.md)に指定値と操作をまとめています。

画像の実体は `resources.images`、配置と図形・テキストはシートの `drawings`、セルの注記は `comments` に保持します。上の例は操作APIに渡す編集用モデルです。`.spon` 保存用モデルは、行ごとの `rows` を持つ `SpreadsheetFile`（`schemaVersion: 1`）です。`serializeWorkbook` / `parseWorkbook` で相互に変換します。[挿入機能とJSON保存](./insertions-and-json.md)と[保存形式](./native-files.md)に構造・公開型・例をまとめています。

結合セルはシートの `merges` に保持します。[セルの結合・解除](./merged-cells.md) に `SpreadsheetMergedRange`、`mergeCells` / `unmergeCells` の例とデータ保持のルールをまとめています。

`setCellBorders(workbook, sheetId, ranges, preset, border?)` は元のブックを変更せず、範囲の格子・外枠・内側・各辺・罫線なしを適用します。`SpreadsheetBorderPreset` と関数をUI入口・`/model` の両方で公開し、JSONコマンド `cells.borders` とGUIも同じ処理を使います。結合セル・隣接する共有辺の扱い、件数上限、色・線種の指定は[範囲の罫線API](./formatting.md)を参照してください。

`createWorkbook()` は300行×26列のブックを作ります。GUIの新規シート、`sheets.add`、`addSheet` も同じ既定サイズです。明示した `rowCount` / `columnCount` は読み込み時に維持するため、保存済みの小さいシートを一律に300行へ広げることはありません。

`normalizeWorkbook(input)` は入力を検証し、コピーしたブックを返します。`setCellValue`、`setCellValues`、`moveCells`、`formatCells`、`resizeColumn`、`insertRows`、`deleteRows`、`insertColumns`、`deleteColumns`、`addSheet`、`renameSheet`、`deleteSheet`、`moveSheet` は元のブックを書き換えず、結果のブックを返します。`moveSheet(workbook, sheetId, index)` の `index` は移動後の0始まりの位置です。アドレス変換は `cellAddress` / `parseCellAddress`、計算は `calculateWorkbook`、数式の参照移動は `translateFormula`、TSVは `parseTsv` / `stringifyTsv` を使えます。引数と戻り値の詳細は同梱の公開型で確認できます。

`expandCellAddresses(sheet, inputs)` は `@likex/spreadsheet` と `@likex/spreadsheet/model` の両方で公開しています。シートの `rowCount` / `columnCount` とセル・範囲の配列を渡すと、大文字・絶対参照記号なしのセル番地へ展開し、入力順と範囲内の行優先順を保ちながら重複を除いた凍結配列を返します。`cells.format` / `cells.validation` / `cells.replace` も同じ処理を使います。

```ts
import { expandCellAddresses, CellAddressExpansionError } from "@likex/spreadsheet/model";

try {
  const addresses = expandCellAddresses({ rowCount: 300, columnCount: 26 }, ["$B$2", "A1:B2"]);
  // ["B2", "A1", "B1", "A2"]
} catch (error) {
  if (error instanceof CellAddressExpansionError) {
    console.error(error.index, error.input, error.message); // 0始まりの入力位置と元の入力
  }
}
```

`A1:B2` のような範囲を1つでも含む場合、配列全体の重複を除いたセル数は `SPREADSHEET_LIMITS.rangeCells`（10,000）以下である必要があります。セル単体だけの配列にはこの追加制限を設けません。入力規則だけは従来の入力配列10,000件上限も維持します。逆順・シート外・異なるシートを含む番地はエラーです。ヘルパー自体は編集を行わず、コマンドでも対象の検証に失敗すればバッチ全体を適用しません。

`workbooksEqual(a, b)` はセルのキー順に依存せず、ブックの内容・書式・寸法を比較します。既定書式や元の値・幅へ戻した場合、保存が必要な変更として扱わないためにも利用しています。ブックとセルは変更用関数から新しい値を作り、受け取った下書きを直接書き換えないでください。

## Props

すべてのPropは省略可能です。コールバック型の引数・戻り値は[保存・編集許可・イベント](./lifecycle.md)、Handleは[外部コマンド](./external-operations.md)で確認できます。

| Prop | 型 | 役割・既定値 |
| --- | --- | --- |
| `ref` | `Ref<SpreadsheetHandle>` | `SpreadsheetHandle`。表示中の下書きへ `execute` / `batch` で操作し、`getWorkbook` で取得。[外部操作API](./external-operations.md) |
| `initialWorkbook` | `SpreadsheetWorkbook` | マウント時の初期ブック。省略時は空の300行×26列。再代入で下書きは置き換わりません。 |
| `initialSheetId` / `initialSheetName` | `string` | マウント時に開くシートのID／名前。完全一致。両指定は同じシートが必要。不正な指定は先頭＋エラー通知。[対象シート](./selection.md#最初に開くシートを指定する) |
| `initialZoom` | `number` | マウント時の表示倍率。既定100％、25〜200へ補正。有限でない数値は100。[表示倍率](./zoom.md) |
| `initialRibbonDisplayMode` | `SpreadsheetRibbonDisplayMode` | マウント時のリボン表示。`expanded`（既定）・`tabs`・`autoHide`・`hidden`。[リボンの表示](./ribbon-display.md) |
| `ribbonDisplayMode` | `SpreadsheetRibbonDisplayMode` | 親が管理するリボン表示。初期値より優先し、表示中の変更にも追従します。 |
| `onRibbonDisplayModeChange` | `(mode: SpreadsheetRibbonDisplayMode) => void` | UI／Handleからの表示変更要求。制御用prop使用時は親が値を反映します。初期表示とprop更新では通知しません。 |
| `onChange` | `(workbook: SpreadsheetWorkbook) => void` | 下書きの変更通知。永続化は行いません。 |
| `onSave` | `SpreadsheetSaveHandler` | 保存処理。省略すると読み取り専用。 |
| `onBeforeSave` | `SpreadsheetBeforeSaveHandler` | 保存前チェック。`false`で中止。 |
| `search` | `SpreadsheetSearchSettings` | 入力／送信時の検索、外部検索の待機時間、独自のJSON条件。 |
| `renderSearch` | `(context: SpreadsheetSearchRenderContext) => ReactNode` | 標準入力・詳細条件を再利用できる検索UIスロット。[検索UIの注入](./editing-tools.md#検索uiと外部検索の注入)。 |
| `onSearchRequest` | `SpreadsheetSearchHandler` | 任意の外部セル検索。スナップショットとキャンセル信号を受け取り、既存セルの検索結果を返す。 |
| `onEditRequest` | `SpreadsheetEditHandler` | 初回の実変更前に編集許可を要求。未指定なら即時許可。 |
| `onRefresh` | `SpreadsheetRefreshHandler` | 最新ブックの再取得。未指定なら更新ボタンは非表示。 |
| `onEvent` | `SpreadsheetEventHandler` | 保存・編集モード・操作等の型付き通知。 |
| `onDirtyChange` | `(dirty: boolean) => void` | 保存済み状態との差の通知。 |
| `onUnsavedChangesChange` | `(hasUnsavedChanges: boolean) => void` | 未確定入力も含む変更状態。親の画面遷移ガード向け。 |
| `warnOnUnsavedChanges` | `boolean` | 未保存時のブラウザ標準離脱確認。既定`true`。 |
| `readOnly` | `boolean` | `true` なら `onSave` があっても変更操作を無効化。 |
| `features` | `SpreadsheetFeatures` | 下記の機能設定。省略した項目は `true`。 |
| `getContextMenuItems` | `SpreadsheetContextMenuProvider` | セル・行列・シート・描画の対象・選択・下書きに応じた追加メニュー。[右クリックメニュー](./context-menu.md) |
| `contextMenuExecutionMode` | `ContextMenuExecutionMode` | `block`（既定）・`confirm`・`reject-if-changed`。メニュー処理中の変更と反映を制御。 |
| `onSelectionChange` | `(selection: SpreadsheetSelection) => void` | `{ sheetId, anchor, focus, ranges }` の通知。行・列は0始まり。各範囲の任意の `kind` は行番号／列名から始めた選択を表す。`focus` はアクティブセル（通常のセル選択では結合の左上）。[複数選択](./selection.md) |
| `colorMode` | `SpreadsheetColorMode` | `"light"`（既定）・`"dark"`・`"system"`。 |
| `primaryColor` | `string` | UIの基本色。`#RGB` / `#RRGGBB`。未指定・不正な値は既定の緑。動的変更可。[見た目の基本色](./formatting.md#画面の基本色) |
| `title` | `string` | 表示タイトル。省略時は「スプレッドシート」。 |
| `exportFileName` | `string` | Excel出力のファイル名。省略時は `title`、未指定なら `spreadsheet.xlsx`。[Excel出力](./excel-export.md) |
| `className` | `string` | ルート要素に追加するCSSクラス。 |
| `style` | `CSSProperties` | ルート要素のインラインCSS。高さは利用先で指定。 |
| `aria-label` | `string` | 領域の読み上げ名。省略時は「スプレッドシート」。 |

`initialWorkbook` は最初だけ読み込みます。同じブックの再取得には `onRefresh`、別ブックへの切り替えには `key={bookId}` などで再マウントします。未保存の下書きも破棄されるため、切り替え前の確認は親で扱ってください。

保存前後の処理、楽観・悲観ロック、Handleからの保存・更新・破棄、イベント一覧は[保存・編集許可・イベント](./lifecycle.md)を参照してください。

セル・行列・画像・図形の操作を外側から呼ぶ場合は `SpreadsheetHandle` を使います。公開型とバッチ、エラー、画像の準備関数 `prepareSpreadsheetImage` は[外部操作API](./external-operations.md)にまとめています。

## 保存

```tsx
import { serializeWorkbook } from "@likex/spreadsheet";

<Spreadsheet
  initialWorkbook={workbook}
  onSave={async draft => {
    const response = await fetch("/api/workbooks/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: serializeWorkbook(draft),
    });
    if (!response.ok) throw new Error("保存に失敗しました");
    // サーバーが送信内容をそのまま受理した場合は、戻り値なしで完了できます。
  }}
  style={{ height: 560 }}
/>
```

`onSave` はブック全体を受け取り、`void`・`SpreadsheetWorkbook`・それらのPromiseを返します。ブックを返すと検証後に保存済み状態として採用し、戻り値がなければ送信した下書きを採用します。保存中は変更操作を止め、失敗時は下書きを維持してエラーを表示します。成功後もUndo／Redoの履歴は保持し、`onSave` が正規化後のブックを返した場合も同様です。未保存状態は、最後に採用した保存済みブックとの差で判定します。[保存後の履歴と編集許可](./lifecycle.md)も参照してください。

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

コピー・切り取り・貼り付け、行列の挿入・削除、シートの追加・改名・削除を独立に指定できます。書式・数式・結合・画像・図形・コメント・保存・更新も制御できます。親設定 `clipboard` / `rowColumnOperations` / `sheets` の一括OFFも従来どおり利用できます。

全設定と組み合わせ、既存データの表示、読み取り専用との違いは[機能のON/OFF](./features.md)を参照してください。

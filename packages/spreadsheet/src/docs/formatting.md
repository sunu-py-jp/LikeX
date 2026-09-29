# 書式・行列サイズ・条件付き書式

[利用ガイドへ戻る](./README.md)

書式はセルの `format`、行列サイズと条件付き書式はシートのデータに保存します。JSON保存、Undo/Redo、外部コマンド、XLSX出力に対応します。保存した入力値（raw）は書式変更では変わりません。

## 画面の基本色

```tsx
<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  primaryColor="#2563eb"
  colorMode="system"
  style={{ height: 560 }}
/>
```

`primaryColor` はタイトルバー、保存・確定ボタン、選択枠、アクティブなタブなどのUIに反映します。`#RGB` / `#RRGGBB` を受け取り、未指定や不正な値では従来の緑になります。タイトルバーやボタンの文字色、明暗モードごとの選択色は自動調整します。

表示中の変更・削除にも対応し、複数のスプレッドシートに別々の色を指定できます。セル・条件付き書式・図形などに保存された色、JSONやExcelの出力内容、未保存状態・Undo履歴は変わりません。`style` で指定したCSSは最後に適用するため、既存の個別カスタマイズも優先されます。

## 画面からの操作

- ホームの「フォント」: フォントとサイズ、太字・斜体・下線、罫線、文字色・背景色。下線の隣にある罫線アイコンから「格子」「外枠」「内側」「上罫線」「下罫線」「左罫線」「右罫線」「罫線なし」を選ぶと、その場で選択範囲へ反映します。「罫線の詳細設定…」は色・太さ・線種を設定する画面を直接開きます。
- 「配置」: 上・上下中央・下、左・中央・右のアイコンで配置を指定します。選択中の設定はボタンの背景と枠で示します。折り返し・セルの結合もここにあります。
- 「表示形式」: 標準・文字列・数値・通貨・パーセント・日付・時刻・日時。「書式…」では罫線の辺・色・太さ・線種、桁区切り、小数桁数、負数のマイナス/括弧/赤色表示を指定できます。
- `Alt+Enter`: セル内で改行。通常の `Enter` は入力確定して次のセルへ移動します。
- 行番号下端と列見出し右端をドラッグ: サイズ変更。グリップの矢印キーでも調整できます。
- グリップのダブルクリック、または「セル」グループの「サイズ調整」: 選択した行/列を内容に合わせて自動調整します。折り返しの後に行の高さを自動調整すると、複数行を表示できます。
- 「スタイル」の「条件付き書式」: 数値の比較、文字列の比較、データバー、2色/3色カラースケール。作成済みルールの削除もできます。

関連する操作を2段にまとめ、グループ名を下に表示しています。狭い表示領域では、左右の矢印から次の見切れているグループまで滑らかに横スクロールできます。矢印はスクロールできる方向にだけ表示し、不要な矢印の余白は取りません。帯の高さやコンポーネント全体の幅を変えず、矢印とメニューを横に並べるため、操作が矢印の下に隠れることもありません。端末でアニメーションを減らす設定が有効な場合は、すぐに移動します。

アイコンには操作名のツールチップがあり、Tabキーでも移動できます。無効にした機能の操作は表示せず、操作がなくなるグループも非表示にします。

罫線メニューは細いグレーの実線を使います。「外枠」「内側」「上罫線」などは、各セル単体ではなく選択した範囲を基準に線を引きます。離れた複数範囲にも一度で適用でき、各範囲を独立した表として扱います。値・数式・背景色は保持し、1回のUndoで戻せます。「罫線なし」は保存される罫線を取り除き、通常のグリッド線は残します。セルを入力中なら確定してから適用し、編集許可待ちに対象のシートや範囲が変わると適用を中止します。

フォントは端末にインストールされているものを使用します。フォントサイズと行列サイズの単位はCSS pxです。自動調整は実際のセルのフォント、条件付き書式を適用した表示値、余白・罫線を使って計測し、内容に応じて現在より狭いサイズにも調整します。保存するサイズは表示倍率に影響されません。複数行に結合したセルは行の自動調整、複数列に結合したセルは列の自動調整から除外します。結合全体のサイズは行/列グリップで指定してください。

## データとAPIの例

`cells.format` と純粋関数 `formatCells` の `addresses` は、`["A1", "$B$2:$D$5"]` のようにセルと範囲を混在できます。大文字の単一セル番地へ展開し、重複は一度だけ処理します。範囲を1つでも含む場合は合計10,000セルまでで、セル単体だけの配列には新しい件数制限を設けません。不正・逆順・シート外の範囲は全体を拒否し、`addresses[index]` をエラーに含めます。

```ts
await spreadsheetRef.current?.executeAsync({
  type: "cells.format",
  sheetId: "sheet-1",
  addresses: ["B2:B3"],
  format: {
    fontFamily: "Noto Sans JP",
    fontSize: 18,
    wrap: true,
    verticalAlign: "middle",
    numberFormat: "number",
    decimalPlaces: 2,
    useGrouping: true,
    negativeFormat: "red-parentheses",
    borders: { bottom: { style: "solid", width: 2, color: "#217346" } },
  },
});

await spreadsheetRef.current?.executeAsync({
  type: "dimensions.resize",
  sheetId: "sheet-1",
  rowHeights: { 1: 64, 2: 64 },
  columnWidths: { 1: 180 },
});
```

`format` は既存の書式に部分適用します。ただし `borders` は辺のマップ全体を置き換えます。`borders: {}` または辺の `style: "none"` で明示罫線を消します（通常のグリッド線は残ります）。辺は `top/right/bottom/left`、線種は `solid/dashed/dotted/double/none`、太さは `1/2/3` です。

`fontSize` は1〜200、`decimalPlaces` は0〜10。行の高さは16〜1000、列の幅は24〜1000です。`rows.resize` による単一行の変更もできます。`dimensions.resize` は複数サイズを1操作として適用するため、一度のUndoで戻せます。XLSXには別途Excelの上限が適用されます（[Excel出力](./excel-export.md)）。

`numberFormat` は `general/text/number/currency/percent/date/time/datetime`。数値は日本語ロケール、通貨はJPYです。日付はISO形式（`2026-09-10`）、時刻は `12:30:00`、日時は `2026-09-10T12:30:00` またはExcelの1900日付方式のシリアル値を表示できます。日時にオフセットがある場合はUTCとして表示します。JSON内のISO文字列は保持し、XLSX出力時だけ対応する日付/時刻シリアルへ変換します。日付の入力規則があるセルは、標準書式でも日付表示になります。

「文字列」（`numberFormat: "text"`）では、`00123` の先頭ゼロや `=1+2` をそのまま表示し、数値・数式として解釈しません。入力値は書き換えず、標準（`general`）へ戻すと通常のルールで再解釈します。たとえば `00123` は数値の `123`、`=1+2` は計算結果の `3` になります。従来の先頭アポストロフィ（`'`）による文字列指定も維持し、指定用の最初の1文字は表示から除外します。XLSXには書式コード `@` と文字列セルで出力するため、先頭ゼロや式の形をした文字列も保持されます。

## 範囲に罫線を付けるAPI

`cells.borders` はホームの罫線メニューと同じ操作です。`ranges` は0始まり・両端を含む矩形の配列、`preset` は `all`（格子）、`outside`（外枠）、`inside`（内側）、`top/bottom/left/right`（範囲の各辺）、`none`（罫線なし）です。離れた範囲はそれぞれ独立して処理します。

```ts
await spreadsheetRef.current?.executeAsync({
  type: "cells.borders",
  sheetId: "sheet-1",
  ranges: [{ top: 1, left: 1, bottom: 5, right: 4 }], // B2:E6
  preset: "outside",
  border: { style: "solid", width: 2, color: "#217346" },
});

// UIなしでも、同じモデル処理を利用できます。
import { setCellBorders } from "@likex/spreadsheet/model";
const bordered = setCellBorders(workbook, "sheet-1",
  [{ top: 1, left: 1, bottom: 5, right: 4 }], "all");
```

`border` の省略値は `solid`・1px・`#808080`。指定しない辺・値・数式・他の書式は保持します。`none` は選択範囲の全罫線を取り除き、`border: { style: "none" }` は指定したプリセットの辺だけを取り除きます。通常のグリッド線は消しません。`cells.format` の `borders` が辺のマップ全体を置き換えるのに対し、この操作は範囲の形に従って必要な辺だけを変更します。

結合セルに部分的にかかる範囲は結合全体まで拡張し、結合内部には新しい線を引きません。共有辺は隣接セルの反対側も同期し、既存の太い線や別の色が残らないようにします。隣が結合セルならその表示辺全体を同期するため、元の選択外のセルも同じ共有辺に沿って変更されることがあります。表示用アンカーと実際の外周セルに罫線を保存するので、SPON・XLSXで保持できます。

範囲は1〜1,000件、結合まで拡張した選択の合計は重複を除いて10,000セルまでです。隣接する結合セルへの伝播にも更新件数上限があり、超過や不正な範囲では一部だけ適用せず全体を拒否します。`features.formatting`、編集許可、Undo/Redoは他の書式コマンドと同じ経路です。公開型 `SpreadsheetBorderPreset` と `setCellBorders` はUI入口・`/model` の両方で利用できます。

## 内容に合わせて自動調整するAPI

`dimensions.autoFit` はGUI・ref・ヘッドレスsession・CLIで使えるJSONコマンドです。`axis` は `row` または `column`、`indices` は空でない0始まりの番号配列です。バッチ途中で指定すると、それまでのセル・数式・書式変更後の内容から計算します。`features.resize`、入力検証、Undo／Redoは `dimensions.resize` と同じ経路です。

```ts
await spreadsheetRef.current?.executeAsync({
  type: "dimensions.autoFit", sheetId: "sheet-1", axis: "column", indices: [0, 1, 2],
});
```

JSONコマンドはDOMや端末のフォントに依存しない推定幅を使います。GUIは同じ計算にブラウザの文字幅・セルCSSを注入します。ブラウザでGUIと同じ測定をしたい場合は、公開ヘルパーから既存の `dimensions.resize` コマンドを作れます。

```ts
import { createSpreadsheetAutoFitCommand, createSpreadsheetTextMeasurer } from "@likex/spreadsheet";

const command = createSpreadsheetAutoFitCommand(api.getWorkbook(),
  { sheetId: "sheet-1", axis: "row", indices: [0, 1] },
  { measureText: createSpreadsheetTextMeasurer(spreadsheetElement.ownerDocument, spreadsheetElement) });
await api.executeAsync(command);
```

`createSpreadsheetAutoFitCommand`、`SpreadsheetAutoFitTarget`、`SpreadsheetAutoFitOptions`、`SpreadsheetTextMeasurer` は `/model` からも利用できます。`measureText` を省略すればJSONコマンドと同じ決定的な推定値です。注入する関数は文字列とセル書式から0以上の有限のCSS px幅を返します。`createSpreadsheetTextMeasurer` はブラウザ用の入口からのみ公開し、DOMをモデルへ持ち込みません。

保存するのは計算済みの `rowHeights`／`columnWidths` です。SPON・XLSXは通常のサイズ変更と同じ往復で保持します。Excel自身に再計算を要求する自動調整フラグは保存しません。推定と実フォントの測定結果は異なるため、画面との一致が必要ならブラウザ測定を注入してください。

## 条件付き書式の例

```ts
import type { SpreadsheetConditionalFormatRule } from "@likex/spreadsheet";

const rules: readonly SpreadsheetConditionalFormatRule[] = [
  {
    id: "negative",
    ranges: [{ top: 1, left: 1, bottom: 20, right: 1 }],
    type: "comparison",
    operator: "lt",
    value: 0,
    format: { color: "#b42318", background: "#fee2e2" },
  },
  {
    id: "progress",
    ranges: [{ top: 1, left: 2, bottom: 20, right: 2 }],
    type: "dataBar",
    color: "#638ec6",
    min: 0,
    max: 100,
  },
  {
    id: "heatmap",
    ranges: [{ top: 1, left: 3, bottom: 20, right: 3 }],
    type: "colorScale",
    colors: ["#f8696b", "#ffeb84", "#63be7b"],
  },
];
await spreadsheetRef.current?.executeAsync({
  type: "conditionalFormats.set", sheetId: "sheet-1", rules,
});
```

行列番号は0始まり、範囲の両端を含みます。`conditionalFormats.set` はそのシートのルール一覧全体を置き換えます。`rules: []` で全解除します。ルールは先頭を優先し、比較/文字列ルールの `stopIfTrue: true` は一致時に以降のルールを止めます。行列の挿入・削除では範囲も移動/拡張/縮小します。

| 種類 | 主な指定 |
| --- | --- |
| `comparison` | `gt/gte/lt/lte/eq/neq/between/notBetween`、`value`、範囲比較の `secondValue`、`format` |
| `text` | `contains/notContains/startsWith/endsWith`、`value`、`format`（大文字小文字を区別せず、文字列をそのまま比較） |
| `dataBar` | `color`、任意の `min/max`。未指定時は範囲の数値から計算 |
| `colorScale` | 2色または3色の `colors`、任意の `min/max`。3色の中央は数値範囲の中間 |

空欄は比較/文字列ルールに一致しません。数値の比較と視覚化には計算結果が数値であるセルを使います。1シート100ルール、1ルール100範囲までです。XLSXにはExcelのネイティブ条件付き書式として出力します。Excel独自の任意数式ルール、アイコンセット、パーセンタイルなどは対象外です。

## 機能を無効にする場合

`features.formatting: false` は書式変更全体、`features.conditionalFormatting: false` は条件付き書式の編集、`features.resize: false` は行列のサイズ変更を無効にします。`readOnly` でも変更できません。既にデータに保存された書式・サイズ・条件付き書式の表示は保持します。

書式ダイアログのキャンセルは保留中の編集許可要求も取り消します。開いている間に外部からブックが変更された場合は、古い座標への適用を止めて開き直しを案内します。

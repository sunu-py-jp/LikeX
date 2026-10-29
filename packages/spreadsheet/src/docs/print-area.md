# 印刷範囲と改ページ表示

[利用ガイドへ戻る](./README.md)

シートごとに1つの矩形を印刷範囲として保存できます。「ページ レイアウト」で選択範囲を設定し、青い外枠をドラッグするかセル番地を入力して調整します。範囲外はグレーに、範囲内にはページ番号と改ページ線を表示します。

これは印刷範囲とページ分割の編集・表示です。ブラウザーの印刷ダイアログやPDF生成を実行する機能ではありません。文字・図形を紙面へ再配置する印刷プレビューとも異なり、普段のセルグリッドの上に境界を重ねます。

## 画面で設定・調整する

1. 印刷したいセル範囲を選び、「ページ レイアウト」の「選択範囲を設定」を押します。
2. 「改ページ表示」で境界を表示します。用紙、向き、拡大縮小率を変更すると自動改ページを再計算します。
3. 青い外枠の上下左右の線を直接ドラッグして範囲を広げたり狭めたりします。四隅・辺の中央の点や移動アイコンは表示しません。線上ではカーソルが変わり、セル境界へ合わせて調整します。シートの外には移動しません。キーボードでも線にフォーカスし、矢印キーで調整できます。
4. セル番地の欄へ `B2:H40` などを入力し、「変更」でも同じ範囲を設定できます。
5. 手動改ページ線をドラッグして分割位置を調整できます。選択行・選択列の前に手動改ページを設定・解除する操作と、手動改ページの全解除もあります。自動改ページは破線で表示し、用紙・倍率の変更で再計算します。

ドラッグ中のEscapeは変更を取り消します。確定した範囲・用紙設定・改ページはUndo／Redoと保存の対象です。範囲の解除は用紙設定を保持し、セルの内容・書式を削除しません。複数の離れた範囲を1つの印刷範囲として設定することはできません。

読み取り専用でも境界の表示・非表示は切り替えられます。設定変更やドラッグはできません。`features.printArea: false` も編集操作を無効にし、保存済みの設定と表示は維持します。表示中のAPIとGUIは、編集許可・処理中・セル編集中の制御を共通で通ります。

## 表示を外から切り替える

```tsx
<Spreadsheet
  ref={ref}
  initialWorkbook={workbook}
  initialPrintAreaView
  onPrintAreaViewChange={visible => console.log(visible)}
  onSave={saveWorkbook}
/>
```

`initialPrintAreaView?: boolean` はマウント時だけ読み、既定は `false` です。表示後は `ref.current?.setPrintAreaView(true)` / `false`、取得は `getPrintAreaView()` を使います。表示切替はブックを編集せず、Undo履歴・未保存判定・SPON／XLSXに含めません。`onPrintAreaViewChange` は表示切替を利用側に通知します。

`setPrintAreaView` は表示状態が変わると `true`、同じ状態への指定やアンマウント後は `false` を返します。

印刷範囲が未設定の場合は、範囲を設定してから境界を表示します。`renderingMode` は従来どおりセルの描画範囲を制御し、印刷範囲を指定しても画面外のセルをすべてDOMへ展開しません。

ページ番号は表示中の範囲だけ描画します。極端に小さいページが多数並ぶ場合は、画面内の番号を最大512個に間引きます。保存設定やページ数は変えません。

## 公開コマンド

モデルAPIの `applySpreadsheetCommands`、セッションのコマンド実行、表示中の `ref.execute` / `ref.batch` から同じコマンドを使えます。座標は0始まりで両端を含みます。

```ts
import { applySpreadsheetCommands } from "@likex/spreadsheet/model";

const result = applySpreadsheetCommands(workbook, [
  {
    type: "print.setArea", sheetId,
    range: { top: 1, left: 1, bottom: 39, right: 7 }, // B2:H40
  },
  {
    type: "print.setLayout", sheetId,
    paperSize: "A4", orientation: "landscape", scale: 90,
    margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
  },
  {
    type: "print.setBreaks", sheetId,
    rows: [20], columns: [], // 21行目の前で改ページ
  },
]);
if (!result.ok) throw new Error(result.message);
// result.workbookの保存先は利用側で決めます。
```

| コマンド | 引数・動作 |
| --- | --- |
| `print.setArea` | `sheetId`, `range: { top, left, bottom, right }`。シート内の矩形に設定・変更します。空セルを生成しません。 |
| `print.clearArea` | `sheetId`。印刷範囲だけを解除します。 |
| `print.setLayout` | `sheetId`, `paperSize?`, `orientation?`, `scale?`, `margins?`。指定した項目を更新します。 |
| `print.setBreaks` | `sheetId`, `rows?`, `columns?`。指定した軸の手動改ページ一覧を置き換えます。`[]` はその軸の全解除です。 |

範囲の外・逆順・不正な設定は失敗し、一括コマンドの途中結果を適用しません。保存済み設定を直接変更せず、コマンドが返すブックを使います。

## 設定とページ計算

保存先は `sheet.printSettings` です。省略された設定は次の既定値を使い、既定値をわざわざ保存する必要はありません。

| フィールド | 内容・既定値 |
| --- | --- |
| `area` | 印刷範囲。未指定は範囲なし。 |
| `paperSize` | `"A4"`（既定）、`"A3"`、`"Letter"`。 |
| `orientation` | `"portrait"`（縦、既定）／`"landscape"`（横）。 |
| `scale` | 10〜400の整数。既定100。画面のズーム倍率とは別です。 |
| `margins` | `top`, `bottom`, `left`, `right` を**インチ**で指定。各辺の既定は0.75。変更するときは4辺すべて指定し、印字可能な幅と高さを残します。 |
| `rowBreaks` / `columnBreaks` | 次のページの先頭となる行・列の0始まり番号。例：`rowBreaks: [20]` はExcelの21行目の直前。シート内で1以上、重複は除き昇順にします。 |

```ts
import { getSheetPrintSettings, getSpreadsheetPrintLayout } from "@likex/spreadsheet/model";

const settings = getSheetPrintSettings(workbook, sheetId); // 未設定ならnull
const sheet = workbook.sheets.find(item => item.id === sheetId)!;
const layout = getSpreadsheetPrintLayout(sheet); // area未設定ならnull
```

`getSheetPrintSettings` は保存設定のコピーを返します。`getSpreadsheetPrintLayout` は用紙・余白・倍率・行高・列幅と手動改ページからページ分割を計算し、`rows` / `columns` の区間と `pageCount` を返します。区間には `start`, `end`, `offset`, `size` があり、巨大な範囲でも全ページや全セルの配列を作りません。ピクセル値は96 CSS px＝1インチとして計算します。非表示行を除外するときは第2引数に `{ hiddenRows: ReadonlySet<number> }` を渡します。

表示中のHandleとセッションでは `getPrintSettings(sheetId)`、シートを固定した `sheet(sheetId)` / `getSheetReader(workbook, sheetId)` では `getPrintSettings()` を使えます。戻り値は深いreadonlyの保存設定で、既定値を補完せず、未設定なら `null` です。`getSpreadsheetPrintLayout` には `getSheet(sheetId)` で取得したreadonlyのシートも渡せます。

自動分割はセル境界に合わせます。1行または1列だけで紙面を超える場合、セルを途中で切り分けることはしません。Excelのプリンタードライバー・フォント・自動縮小などを使ったページ割りと完全一致するものではありません。

行・列全体を挿入／削除すると印刷範囲と手動改ページも追従します。範囲内への挿入は範囲を広げ、範囲全体を削除した場合はその印刷範囲を解除します。通常のセル編集や部分的なセル移動では範囲自体の座標は変わりません。

## SPON・XLSXの対応範囲

`printSettings` はSPON v2へ保存し、既存の設定なしファイルも従来どおり読み込めます。形式名やバージョンだけを書き換える移行は不要です。旧版のライブラリでは新しい属性を保持できないため、設定を扱う利用側は対応版へ更新してください。

XLSXではシート固有の `_xlnm.Print_Area`、`pageSetup`、`pageMargins`、`rowBreaks` / `colBreaks` と相互変換します。対応する単一の矩形、A4／A3／Letter、縦横・倍率・余白・手動改ページを保持します。複数領域、未対応用紙、ページ数に合わせる自動縮小などを完全互換とは扱わず、取り込み時の `warnings` を確認してください。ヘッダー／フッター、印刷タイトル、実際の印刷・PDF生成は対象外です。

CLIで設定だけを取得する場合：

```bash
node "$skill_dir/scripts/document.mjs" inspect --project "$project_dir" \
  --input workbook.spon --sheet-id sales --print-settings
```

`selection.printSettings` に設定（未設定なら `null`）を返し、セル本文は返しません。`--compact-summary` と併用でき、セル取得・検索・ページングの指定とは併用しません。変更は通常の `apply` に上記のコマンド配列を渡します。

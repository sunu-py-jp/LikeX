# 軽量サムネイル

`SpreadsheetThumbnail` はタイトルヘッダーと指定シートの `A1:J20` だけを表示します。対象を省略すると先頭シート、小さいシートは存在する範囲までです。カード一覧やファイルのプレビュー向けで、セル編集、選択、シート切替ボタン、スクロール、ズーム、リボン、数式バー、保存操作はありません。

```tsx
import { SpreadsheetThumbnail } from "@likex/spreadsheet/thumbnail";
import "@likex/spreadsheet/styles.css";

<SpreadsheetThumbnail
  workbook={workbook}
  sheetName="売上"
  title="売上集計"
  style={{ height: 240 }}
  onError={error => console.error(error.message)}
/>;
```

軽量な専用入口 `@likex/spreadsheet/thumbnail` を推奨します。通常の `@likex/spreadsheet` からも同じコンポーネントと `SpreadsheetThumbnailProps` を取得できます。ソースコピー導入では `@/components/spreadsheet/thumbnail` を使います。CSSは既存のSpreadsheetと共通で、ホストで1回読み込んでください。

`workbook` は必須で、`SpreadsheetWorkbook` と読み取り専用の `SpreadsheetWorkbookSnapshot` を受け取ります。SPONの保存JSONは先に `parseWorkbook`、Excelは `importSpreadsheetXlsx` でモデルへ変換します。新しいブックオブジェクトを渡すと表示が更新されます。同じオブジェクトを直接変更せず、公開モデルコマンドの結果などへ差し替えてください。

`sheetId?: string` または `sheetName?: string` で表示対象を指定します。ID・名前とも完全一致で、名前の大文字小文字や前後の空白を補正しません。両方を渡す場合は同じシートを指す必要があります。どちらも省略すると先頭シートです。ブックが同じでもこれらのpropsを変更すると対象が切り替わります。空文字、未知のID・名前、曖昧な名前、IDと名前の不一致はエラー表示と `onError` の対象で、先頭シートへ黙って切り替えません。名前指定したシートを改名した場合はpropsも更新してください。改名に追随させる用途にはIDが適しています。

ほかの任意propsは `title`、`colorMode`、`primaryColor`、`className`、`style`、`aria-label`、`onError(error: Error)` です。既定の高さは280px、最小高さは0で、内容は残りの領域に縦横比を保って収まります。原寸より拡大しません。`title` の既定値は「スプレッドシート」です。`ref` や編集・選択のコールバックはありません。外側は代替説明を持つ `role="img"` で、URL文字列もクリック可能なリンクに変換しません。

通常の `Spreadsheet` を特定シートから開く場合は、マウント時だけ読む `initialSheetId` / `initialSheetName` を使います。表示後の移動は `ref.current.selectSheet({ sheetId, sheetName })`、取り込みと同時の指定は `importExcel(file, { sheetId, sheetName })` / `importNative(file, { sheetId, sheetName })` です。サムネイルの制御propsと通常表示の初期propsは更新規約が異なります。[通常表示の対象シート指定](./selection.md#最初に開くシートを指定する)を参照してください。

## 負荷と表示範囲

編集セッション、履歴、選択、クリップボード、全ブックの数式計算を作りません。入力が変わったときはブック全体の既存検証とコピーを行い、未検証の画像や書式は描画しません。そのため入力検証の費用はブック全体に比例しますが、セルの描画は最大200件、数式の評価開始点は表示範囲だけです。数式が参照する表示範囲外のセルや他シートは必要に応じて計算します。関係のない他シートの数式や画面は処理しません。

セルの表示形式・書式・罫線と、画像・図形・接続線の形状は通常表示と共通の処理を使います。範囲に交差する結合セルと描画オブジェクトは表示領域で切り取り、描画オブジェクトは資料の重なり順で最大100件です。セルや図形の文字はそれぞれ先頭2,000文字までです。チェックボックスは変更できない記号で表します。

縮小一覧では隣の空セルへの文字のはみ出しと `shrinkToFit` による個別の文字サイズ調整を行わず、セル内で切り取ります。コメント、入力規則の操作、選択枠は表示しません。条件付き書式の比較・文字ルールは適用します。データバーとカラースケールは、対象範囲がすべて `A1:J20` 内に収まる場合、または `min` と `max` の両方が明示されている場合に適用します。範囲外の値から自動最小値・最大値を求めるルールは省略し、部分範囲だけで色や長さを再計算しません。

不正な入力はタイトルを残して「サムネイルを表示できません」と表示し、マウント後に任意の `onError` へ通知します。通知側の例外で表示は壊れません。SSRでも描画でき、自動フィットにサイズ監視やDOM計測は不要です。システムのテーマ変更の監視は解除時・アンマウント時に終了します。

表示専用の機能なのでSPON・XLSXの保存構造、編集コマンド、CLIは変更しません。

## 指定範囲の計算値を画面なしで取得する

```ts
import { calculateSpreadsheetRange } from "@likex/spreadsheet/model";

const values = calculateSpreadsheetRange(workbook, workbook.sheets[0].id, "A1:J20");
console.log(values.A1);
```

`calculateSpreadsheetRange(workbook, sheetId, range): SpreadsheetCalculatedRange` はブック全体を検証し、指定範囲とその依存セルだけを既存の数式評価器で計算します。範囲はA1表記か `{ top, left, bottom, right }` の0始まり・終端を含む矩形で、最大10,000セルです。結果は要求した範囲のA1アドレスをキーに持つ読み取り専用のオブジェクトで、値は文字列・数値・boolean、空セルは空文字です。依存先のセルは結果へ含めません。

元ブックを変更せず、結果への書き込みもできません。構造・シートID・範囲が不正なら例外、数式の循環や演算エラーは `#CYCLE!` / `#DIV/0!` 等の既存の値として返します。既存の数式長・参照深さ・評価ステップの上限を維持します。ブック全体の計算には従来どおり `calculateWorkbook` を使ってください。

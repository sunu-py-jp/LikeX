# 検索・置換、形式選択貼り付け、オートフィル

[利用ガイドへ戻る](./README.md)

どの変更もローカル下書きに反映します。既存の編集許可、入力規則、Undo/Redo、変更イベントを経由し、永続化は「保存」から `onSave` に渡します。各機能は既定でONです。

## 検索と置換

ヘッダーの「検索」「置換」、または `Ctrl+F` / `Ctrl+H` から開きます。macOSでは `⌘` も使えます。

- 現在のシート／ブック全体を検索できます。`features.sheets: false` の場合は現在のシートだけです。
- 「表示値」は数式の計算結果と日付・通貨などの表示書式を検索します。「数式・入力値」は `=SUM(A1:A3)` などの入力内容を検索します。
- 大文字・小文字の区別、セル全体との一致を指定できます。検索文字列は通常の文字列として扱い、正規表現ではありません。
- 前／次で循環し、結果をクリックすると該当シートとセルを選択します。結果一覧は先頭200件を表示し、前／次では全件を移動できます。
- 「置換」は選択した一致セル（未選択なら先頭）、「すべて置換」は検索条件に一致する全セルを対象にします。一度の置換操作を一度のUndoで戻せます。

置換の既定対象は「数式・入力値」です。「表示値」で置換すると、数式自体も置換後の表示結果へ変わります。たとえば `="会議A"` の表示値「会議A」を「会議B」に置換した場合、セルは文字列「会議B」になり、元の数式は残りません。文字列の先頭が `=` でも、表示値の置換で新しい数式として実行しません。

読み取り専用では検索だけ使えます。置換する値が入力規則に違反した場合は全体を反映せず、元の下書きを維持します。検索文字列を空にした場合は検索しません。

`features.search: false` で検索と置換を無効にできます。検索を残して置換だけを止める場合は `features.replace: false` を指定します。

```ts
import { findSpreadsheetCells } from "@likex/spreadsheet";

const matches = findSpreadsheetCells(workbook, {
  text: "売上",
  lookIn: "formulas", // "values"（既定）または "formulas"
  matchCase: false,
  wholeCell: false,
}, { sheetId: "sales" }); // sheetId省略でブック全体

// 各一致: { sheetId, address, value: 入力値, matchedText: 検索した文字列 }
```

外部操作APIから置換する例です。`addresses` を省略すると指定シートのすべての一致セルを対象にします。

```ts
const result = await spreadsheetRef.current?.executeAsync({
  type: "cells.replace",
  sheetId: "sales",
  query: { text: "旧商品名", lookIn: "formulas", wholeCell: true },
  replacement: "新商品名",
  addresses: ["A2", "A3"],
});
if (result && !result.ok) console.error(result.message);
```

## 形式を選択して貼り付け

ヘッダーの「形式を選択して貼り付け」から選びます。通常の `Ctrl+V` / `⌘V` は、従来どおり「すべて」の貼り付けです。

コピーは `Ctrl+C` / `⌘C`、切り取りは `Ctrl+X` / `⌘X` です。`features.copy` / `cut` / `paste` で個別に、`features.clipboard` でまとめて無効にできます。`features.pasteSpecial: false` は形式選択だけを無効にし、通常の貼り付けは残します。読み取り専用ではコピーを利用できますが、切り取り・貼り付けはできません。

| 形式 | 反映する内容 |
| --- | --- |
| すべて | 値・数式と、内部コピーに含まれる書式・コメント・結合・入力規則。 |
| 値のみ | 数式の計算結果。貼り付け先の書式・入力規則は維持。 |
| 数式のみ | コピーした入力値・数式。相対参照を移動先に合わせて調整。書式・入力規則は維持。 |
| 書式のみ | コピーしたセルの書式。値・数式・入力規則は維持。 |

数式のみでもコピー元の定数は貼り付けます。`$A$1` のような絶対参照は動かしません。値のみでは、計算結果が文字列の `00123` や `=文字列` であっても、その内容を文字列として保持します。数式機能OFFでも計算結果の値を貼り付けられます。

書式・コメント・結合・入力規則を含めて転送できるのは、このSpreadsheet内でコピーし、ブラウザが内部コピー識別情報を維持している場合です。外部アプリや別のSpreadsheetからの貼り付けは、基本的にクリップボードのテキストを使用します。書式のみで利用できる内部データがない場合は案内を表示します。ブラウザのクリップボード権限によって、ヘッダーからの貼り付けが使えない場合があります。

切り取りした範囲には通常の貼り付けを使います。部分的な形式だけを切り取り移動する操作は行わず、形式選択時には案内を表示してコピー元を維持します。コピー・切り取り・貼り付けは一つの連続範囲を対象とし、一度の貼り付けは10,000セルまでです。

書式機能がOFFなら書式を変更せず、入力規則機能がOFFなら既存の貼り付け先の規則を維持します。チェックボックス設定がOFFの場合は、コピーによってチェックボックス規則を追加・解除しません。値のみ・数式のみは常に貼り付け先の規則に従います。

外部APIの `cells.paste` は、クリップボードの読取権限を要求せず、親から渡したデータを反映します。

```ts
await spreadsheetRef.current?.executeAsync({
  type: "cells.paste",
  sheetId: "sales",
  target: { row: 4, column: 1 }, // B5
  mode: "values",
  payload: {
    values: [["=SUM(A1:A3)", "'00123"]],
    displayedValues: [["1200", "00123"]],
    valueTypes: [["number", "string"]],
    source: { sheetId: "sales", row: 0, column: 1 },
  },
});
```

`payload.values` は文字列の二次元配列です。値のみで型も維持したい場合は、計算結果の `displayedValues` と `valueTypes`（`string` / `number` / `boolean`）も渡します。`formats`、`validations` に同じ行列の書式・入力規則を指定できます。`source` は数式の相対参照を調整する基準です。外部APIのこのデータ形式にはコメント・結合の情報を含めません。

## ドラッグによるオートフィル

連続範囲を選択すると右下に小さなグリップが表示されます。縦または横へドラッグし、プレビュー範囲を確認して離すと反映します。

- 同じ文字や一つの数値はコピーします。`1, 2` などの等差数列は `3, 4` と続けます。
- `項目01` のような末尾の番号も続けます。先頭ゼロ付きの連番は桁数を維持します。
- `YYYY-MM-DD` の有効な日付は、月・年・閏日の境界を含めて日単位で続けます。複数の日付の間隔が一定ならその間隔で続けます。
- 数式は相対参照を調整します。書式・入力規則は、許可されている場合にコピーします。
- `Ctrl` / `⌘` を押しながらドラッグするとコピー、`Alt` を押すと一つの数値からも連番になります。
- グリップにキーボードフォーカスがある場合、矢印キーで一行・一列ずつ伸ばせます。

シートの端へドラッグするとスクロールします。離す前のEscape、ポインターのキャンセル、ウィンドウのフォーカス喪失では反映しません。ドラッグ中や非同期の編集許可待ちにデータが変わった場合も、古い範囲へ書き込まないよう中止します。

離れた複数範囲や結合セルを含む範囲ではグリップを表示しません。拡張後の全範囲は10,000セルまでです。アポストロフィで明示した文字列IDや16桁以上の整数文字列は、数値の精度を落として連番にせずコピーします。

```ts
await spreadsheetRef.current?.executeAsync({
  type: "cells.fill",
  sheetId: "sales",
  source: { top: 0, left: 0, bottom: 1, right: 0 }, // A1:A2
  target: { top: 0, left: 0, bottom: 9, right: 0 }, // A1:A10
  mode: "auto", // "auto" | "copy" | "series"
});
```

`target` はコピー元 `source` を含む長方形にします。縦横を同時に伸ばす指定や、結合セルを含む指定は拒否します。入力規則違反などがあれば、一部のセルだけ変更せず全体を中止します。

`features.autoFill: false` でグリップと `cells.fill` を無効にできます。変更は編集許可・`onChange`・変更イベント・Undo/Redoを通り、保存は別途 `onSave` で行います。

シートの複製・追加・名前変更・並べ替えは、[シートの操作](./sheets.md)にまとめています。

## 機能設定とイベント

```tsx
<Spreadsheet
  onSave={saveWorkbook}
  features={{ search: true, replace: false, pasteSpecial: true,
    autoFill: true, duplicateSheet: false }}
/>
```

`replace` は `search`、`pasteSpecial` は `clipboard` と `paste`、`duplicateSheet` は `sheets` と `createSheet` にも依存します。親スイッチをOFFにした場合は関連UIを消し、外部コマンドも拒否します。

GUIの置換・オートフィル・複製は、通常の `onEvent` の `change` にコマンド名を含めて通知します。形式選択貼り付けは既存の `clipboard` の `paste` 通知と変更通知を使います。外部操作APIは `executeAsync` / `batchAsync` で編集許可を待てます。詳しくは[外部操作](./external-operations.md)と[保存・編集許可](./lifecycle.md)を参照してください。

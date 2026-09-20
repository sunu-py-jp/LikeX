# Spreadsheet形式（.spon）の読み込みと書き出し

[ドキュメント一覧](./README.md)

「ファイル」タブの「Spreadsheet (.spon)」で、ブック全体をJSONファイルとして読み書きできます。拡張子は `.spon`、内容はUTF-8のJSON、出力BlobのMIMEは `application/json` です。Excelとの交換には引き続き `.xlsx` を使います。

## データと互換性

保存形式は `format: "likex.spreadsheet"` と `schemaVersion: 1` を持つ、行単位の `SpreadsheetFile` です。読み込みでもこの形式を必須とし、形式・バージョンの省略、シート直下に `cells` を持つ旧構造、version 2は受け付けません。壊れたJSONや構造・サイズ制限違反もエラーにします。入力ファイルの名前やMIMEだけでは内容を判定しません。

セル・数式・書式・結合・入力規則・条件付き書式・名前付き範囲・テーブル・図形・コメント・埋め込み画像など、現在のブックモデルの内容を保持して保存します。画像はBase64を含む `resources.images` に保持するため、別ファイルの同梱は不要です。画面の倍率、選択位置、Undo履歴、コンポーネントの `title` はブックに保存しません。

`parseWorkbook(json)` と `serializeWorkbook(workbook)` のAPIは同じです。`parseWorkbook` は保存形式を編集用の `SpreadsheetWorkbook`（`schemaVersion: 1`、A1形式の `cells`）へ変換します。`onSave` やセル操作APIもこの編集用モデルを受け取ります。`JSON.parse` だけではこの変換を行わないため、ファイルを開くときは `parseWorkbook` を使ってください。

## 行ごとの保存構造

`rows` は行オブジェクトの配列で、先頭が1行目です。各行の `cells` に、列名をキーとしてセルを置きます。数値・数式も従来どおり文字列で指定します。

```json
{
  "format": "likex.spreadsheet",
  "schemaVersion": 1,
  "sheets": [
    {
      "id": "sales",
      "name": "売上",
      "rowCount": 300,
      "columnCount": 26,
      "rows": [
        { "cells": { "A": { "value": "商品" }, "B": { "value": "数量" } } },
        { "height": 28, "cells": { "A": { "value": "りんご" }, "B": { "value": "10" } } },
        {},
        { "cells": { "A": { "value": "合計" }, "B": { "value": "=SUM(B2:B3)" } } }
      ]
    }
  ]
}
```

上の例は構造を見やすくするため行内を短く表記しています。実際の出力は全体を2スペースでインデントします。

- 途中の空行は `{}` で位置を保ちます。上の例では3行目が空行です。
- 末尾の空行は省略し、シートの表示行数は `rowCount` で保持します。
- 行の高さは `height`（ピクセル）です。高さだけ指定された行も残します。
- 列は `A, B, …, Z, AA, …` の順で書き出します。未使用セルを埋める必要はありません。
- 画像、図形、結合、入力規則などの情報も保持します。列幅はシートの `columnWidths`（0始まりの列番号キー）です。

公開型は `SpreadsheetFile`、`SpreadsheetFileSheet`、`SpreadsheetFileRow` です。行の追加・削除による差分は配列の要素単位で追えます。ただし、JSONを直接編集しただけでは数式・結合・名前付き範囲の参照は自動調整されません。参照を保つ編集には、`parseWorkbook` → `rows.insert` などの[外部コマンド](./external-operations.md) → `serializeWorkbook` を使います。

## 毎回同じ書式で保存する

シートは表示順、セルは行順・列順で書き出し、そのほかの項目も定義した順序に固定します。改行はLF、インデントは2スペースで、BOM・末尾の改行は付けません。セル文字列内の改行やUnicodeは変更しません。保存時刻を追加したりIDを振り直したりしません。

同じ編集データを `serializeWorkbook` で保存し、その文字列をUTF-8にすれば、キーの追加順に左右されず同じバイト列・ハッシュになります。見た目が似ていても、ID・数式・画像・書式・コメントなどのデータが違えば同一とは扱いません。

親の `onSave` でも同じAPIを使ってください。ファイルタブの出力と同じ保存形式になります。

```ts
import { serializeWorkbook, type SpreadsheetWorkbook } from "@likex/spreadsheet/model";

function createSaveFile(workbook: SpreadsheetWorkbook) {
  return new Blob([serializeWorkbook(workbook)], { type: "application/json" });
}
```

保存先Blobをコンポーネントが自動で書き換えることはありません。内容が同じときにBlobへの書き込みを省略する処理は親側の責務です。

## 操作と保存

取り込みはブック全体を置き換える1回のUndo可能な編集です。未保存の変更や入力中の編集があれば、UIで確認してから読み込みます。解析・検証に失敗した場合は、元のブックと入力を維持します。編集許可は通常の `onEditRequest` を通し、`action` は `importNative` です。

取り込み・出力は `onSave` を呼びません。取り込んだ内容を永続化する場合は、通常の「保存」を実行します。出力は現在の下書きのスナップショットを生成し、未保存状態やUndo履歴を変更しません。出力名は `exportFileName` → `title` → `spreadsheet` の順で決め、既存の `.xlsx`・`.spon`・`.json` を取り除いて `.spon` を付けます。

`features.importNative` と `features.exportNative` は既定で有効です。読み取り専用では取り込めませんが、出力できます。Excelとネイティブの両方の入出力を無効にすると「ファイル」タブを非表示にできます。

```tsx
<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  features={{ importNative: true, exportNative: true }}
  exportFileName="売上.spon"
/>
```

## 表示中のブックをAPIから操作する

```ts
import type {
  SpreadsheetHandle, SpreadsheetImportNativeOptions,
  SpreadsheetNativeExportOptions, SpreadsheetNativeImportResult,
} from "@likex/spreadsheet";

async function replaceFromFile(handle: SpreadsheetHandle, file: Blob) {
  const options: SpreadsheetImportNativeOptions = {
    discardChanges: true, // 利用者が変更の破棄に同意した場合だけ指定
    signal: new AbortController().signal,
  };
  const result: SpreadsheetNativeImportResult = await handle.importNative(file, options);
  // result.workbook は適用したブック、result.warnings は空配列
  return result.workbook;
}

async function generateFile(handle: SpreadsheetHandle) {
  const options: SpreadsheetNativeExportOptions = { signal: new AbortController().signal };
  return handle.exportNative(options); // application/json のBlob。保存・ダウンロードは行わない
}
```

`importNative` はBlobを受け取り、現在の保存形式を内容検証して読み込みます。ファイル選択では `.json` も選べますが、内容は同じSPON形式が必要です。未保存または入力中の編集がある場合、APIでは `discardChanges: true` が必要です。`exportNative` は未確定入力があると拒否します。UIから出力する場合は、セル入力を確定してから生成します。

Excelと同じ処理ロック・キャンセル・編集許可・状態の再確認を使います。取り込み中に新しい編集が発生した場合、古い読み込み結果を適用せずキャンセルします。`onEvent` の `import` / `export` は `format: "spon"`、状態は `start` / `success` / `error` / `cancelled` です。出力の `success` はBlob生成の完了を示し、ブラウザーでのディスク保存完了を意味しません。

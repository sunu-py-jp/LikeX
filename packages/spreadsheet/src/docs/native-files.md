# Spreadsheet形式（.spon）の読み込みと書き出し

[ドキュメント一覧](./README.md)

「ファイル」タブの「Spreadsheet (.spon)」で、ブック全体をJSONファイルとして読み書きできます。拡張子は `.spon`、内容はUTF-8のJSON、出力BlobのMIMEは `application/json` です。Excelとの交換には引き続き `.xlsx` を使います。

## データと互換性

出力は `format: "likex.spreadsheet"` と `schemaVersion: 1` を持ちます。`format` や `schemaVersion` のない従来のJSONも読み込めます。指定された `format` が異なる場合、未対応のバージョン、壊れたJSON、構造・サイズ制限違反はエラーにします。入力ファイルの名前やMIMEだけでは内容を判定しません。

セル・数式・書式・結合・入力規則・条件付き書式・名前付き範囲・テーブル・図形・コメント・埋め込み画像を、現在のブックモデルのまま保存します。画像はBase64を含む `resources.images` に保持するため、別ファイルの同梱は不要です。画面の倍率、選択位置、Undo履歴、コンポーネントの `title` はブックに保存しません。

`parseWorkbook(json)` と `serializeWorkbook(workbook)` のAPIは同じです。正規化・シリアライズした出力には常に形式識別子を付けます。入力互換のためTypeScript型の `format` と `schemaVersion` は任意です。読み込みで新しい形式へ正規化されますが、保存先の旧ファイルを自動で変更することはありません。

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

`importNative` はBlobを受け取り、`.spon` と旧 `.json` を同じ内容検証で読み込みます。未保存または入力中の編集がある場合、APIでは `discardChanges: true` が必要です。`exportNative` は未確定入力があると拒否します。UIから出力する場合は、セル入力を確定してから生成します。

Excelと同じ処理ロック・キャンセル・編集許可・状態の再確認を使います。取り込み中に新しい編集が発生した場合、古い読み込み結果を適用せずキャンセルします。`onEvent` の `import` / `export` は `format: "spon"`、状態は `start` / `success` / `error` / `cancelled` です。出力の `success` はBlob生成の完了を示し、ブラウザーでのディスク保存完了を意味しません。

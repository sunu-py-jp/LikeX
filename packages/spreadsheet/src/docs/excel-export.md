# Excelへのエクスポート

[利用ガイドへ戻る](./README.md)

ヘッダーの「Excel出力」から、現在のブック全体を `.xlsx` としてダウンロードできます。未保存の変更も含めます。出力しても保存済みにはならず、`onSave`・`onBeforeSave` は呼びません。保存・再編集の基本形式は引き続きJSONです。Excelファイルのインポートは提供していません。

## コンポーネントで使う

```tsx
<Spreadsheet
  initialWorkbook={workbook}
  onSave={saveWorkbook}
  exportFileName="売上計画.xlsx"
  onEvent={event => {
    if (event.type === "export") {
      console.log(event.status, event.requestId);
    }
  }}
/>

// ボタンと表示中コンポーネントのexportExcelを両方無効にします。
<Spreadsheet initialWorkbook={workbook} features={{ exportExcel: false }} />
```

`exportExcel` は既定でONです。読み取り専用でも出力でき、出力処理自体は編集権限の取得を行いません。GUIで未確定のセルを確定する場合は、通常の編集許可処理を通ります。ファイル名は `exportFileName` → `title` → `spreadsheet.xlsx` の順で決まり、ファイル名に使えない文字を置き換えます。

GUIではセル入力を確定してから出力します。未確定のコメントやシート名などが残っている場合、入力を確定するよう知らせます。出力中は進行表示とキャンセルボタンが出ます。処理開始時点のブックを使うため、その後の編集が途中から混ざることはありません。

## 利用側からBlobを取得する

```ts
import {
  exportSpreadsheetXlsx,
  type SpreadsheetHandle,
  type SpreadsheetExcelExportOptions,
} from "@likex/spreadsheet";

const abort = new AbortController();
const options = { signal: abort.signal } satisfies SpreadsheetExcelExportOptions;

// 任意のブックを変換。コンポーネントや保存先への依存はありません。
const blob = await exportSpreadsheetXlsx(workbook, options);

// ref: React.RefObject<SpreadsheetHandle | null>
// 表示中の確定済み下書きを変換。入力中ならPromiseがrejectします。
const currentBlob = await ref.current!.exportExcel(options);
```

戻り値はExcelのMIMEを持つ `Blob` です。これらのAPIはダウンロード・アップロード・保存を行いません。利用側がダウンロードやサーバー送信に使えます。失敗はPromiseのreject、キャンセルは `AbortSignal` で扱います。`features` はコンポーネントに適用されるため、独立関数には影響しません。

Handle／GUIの出力は `onEvent` に `type: "export", format: "xlsx"` を通知します。同じ処理の `requestId` は共通です。

| `status` | 意味 |
| --- | --- |
| `start` | 変換開始。`workbook` に対象の不変スナップショット。 |
| `success` | ファイル生成完了。`size` はBlobのバイト数。ブラウザによるディスク保存完了の通知ではありません。 |
| `error` | 変換失敗。`message` に理由。 |
| `cancelled` | 開始済みの処理をキャンセル。 |

## 出力する内容

| 内容 | Excelでの表現 |
| --- | --- |
| 複数シート | 名前と順番を維持。 |
| セル | 文字列・数値・真偽値・対応数式と計算結果。Excelで開いた際に再計算。 |
| 書式 | 太字・斜体・下線・文字色・背景色・配置・数値／円通貨／パーセント。 |
| サイズ・結合 | 列幅・行高・結合範囲。ピクセルからExcelの単位へ換算。 |
| 画像 | ファイルに内包。縦横比を維持し、表示枠の中央に収める配置を反映。共有画像の実体は1つ。 |
| 図形・テキストボックス | 編集可能なExcelの描画オブジェクト。図形内の文字・改行・文字書式と重なり順を維持。 |
| コメント | Excelの「メモ」。スレッド形式のコメントではありません。 |

先頭ゼロを持つ値や15桁を超える数字列は、Excelによる桁落ちを避けるため文字列として出力します。先頭の `'` で明示した文字列も文字列のまま扱います。非表示に設定した画像・コメント等も、ブックに保持されているデータとして出力します。画面のダークモードや親のCSSは出力のテーマにはなりません。

## 互換性と実行環境

- 画像・数式・文字組みを含めたExcel全機能との完全互換を意味しません。Excelのフォントや列幅の単位により、画面と配置・折り返しが多少変わることがあります。
- 通常のPNG／JPEGはそのまま内包します。WebP・GIF・向き情報付きJPEGはブラウザのCanvasでPNGへ変換します。アニメーションは静止画像になります。変換が必要な画像をDOMのない環境で渡した場合は、画像を省略せずエラーにします。
- 画像変換後にも1枚5 MiB、合計20 MiBの上限を適用します。画像取得の外部通信は行いません。
- Excelの上限を超えるセル（32,767文字／253改行）、大きすぎる行高や書式数、不正なXML文字は明示的にエラーになります。黙って切り詰めません。
- 色はHEX・RGB・HSL・OKLab／OKLCH・一般的な色名からRGBへ変換します。CSS変数など解決できない色は既定色へ戻します。セルの半透明色は白地に合成し、図形では透明度を保持します。
- 数式はこのコンポーネントが対応する構文・関数とブック内部の参照を出力します。未対応関数や外部ブック参照はエラーにし、Excelで新たな外部アクセスが発生する式へ変換しません。
- JSONのIDや編集履歴・ロック情報はExcel独自の管理情報へ変換しません。アプリケーションの保存・復元にはJSONを使ってください。

出力はSpreadsheetML／DrawingMLの必要な部分を生成し、CoreのZIP処理で組み立てます。追加の実行時パッケージは不要です。形式の参考: [SpreadsheetML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)、[DrawingMLのシート上の描画](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spreadsheet.worksheetdrawing)。

# Excelへのエクスポート

[利用ガイドへ戻る](./README.md)

「ファイル」タブの「Excel出力」から、現在のブック全体を `.xlsx` としてダウンロードできます。未保存の変更も含めます。出力しても保存済みにはならず、`onSave`・`onBeforeSave` は呼びません。保存・再編集の基本形式は引き続きJSONです。`.xlsx` の[取り込み](./excel-import.md)にも対応します。

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
| 書式 | フォント・太字・斜体・下線・色・罫線・折り返し・縮小して全体を表示・横8種類／縦5種類の配置・インデント・数値／円通貨／パーセント／日付／時刻。`centerContinuous` は空白セルにも出力し、「選択範囲内で中央」を結合に置き換えず保持します。`wrap` / `shrinkToFit` のON/OFFを保持し、標準・左・中央・右配置でどちらもOFFならExcelの標準のはみ出し表示になります。 |
| 範囲書式 | `formatRanges` と個別セルの例外から通常書式を解決。全行・全列の共通書式はExcelの行・列属性、有限矩形は必要なセル書式へ戻して出力します。 |
| 条件付き書式 | 比較・文字条件・データバー・2色／3色スケールをExcelの規則として保持。 |
| 入力規則 | 数値・整数・日付・文字数・リスト。候補は非表示の補助シートと名前付き範囲に保存。 |
| チェックボックス | TRUE/FALSE値とリスト入力規則。Excelのチェックボックスの見た目への変換は行いません。 |
| サイズ・結合 | 列幅・行高・結合範囲。ピクセルからExcelの単位へ換算。 |
| 画像 | ファイルに内包。縦横比を維持し、表示枠の中央に収める配置を反映。共有画像の実体は1つ。 |
| 図形・テキストボックス | 編集可能なExcelの描画オブジェクト。文字・改行・フォント・装飾・余白・折り返し・配置・はみ出し・自動調整・行間と重なり順を維持。 |
| コメント | Excelの「メモ」。スレッド形式のコメントではありません。 |

先頭ゼロを持つ値や15桁を超える数字列は、Excelによる桁落ちを避けるため文字列として出力します。先頭の `'` で明示した文字列も文字列のまま扱います。非表示に設定した画像・コメント等も、ブックに保持されているデータとして出力します。画面のダークモードや親のCSSは出力のテーマにはなりません。

範囲書式の有限矩形は行ごとにXMLへ出力し、書式だけのセルをブックモデルに全件生成しません。ただし広い矩形ほどXLSXのXML量と変換時間は増えます。全行・全列の指定には行・列の書式属性を使い、個別セルに `format: { numberFormat: "general" }` などの完全な上書き書式があれば、その書式を出力します。空の `format: {}` は範囲書式を継承します。対応するモデルの10,000行×1,000列の範囲を出力し、SPONとXLSXでファイルサイズが同じ割合に縮むことは保証しません。

行高は `CSS px × 0.75` でptへ換算します。列幅は保存済みのCSS pxを、出力ブックの標準フォントであるCalibri 11pt・96dpi相当の最大数字幅7pxを基準としてOOXMLの保存幅へ変換します。元ファイルの標準フォントや取り込み時の端末倍率は出力設定として保持しません。整数pxの幅は従来の7px基準の再取り込みで維持しますが、小数の列幅は量子化により1px未満の差が生じる場合があります。実際の表示にはExcelやブラウザーのフォント計測・端末倍率の差も残るため、完全に同じ配置になる保証はありません。[列幅の取り込み](./excel-import.md#読み込む内容と制約)も参照してください。出力時に内容から行高・列幅を自動調整することはありません。

[対応関数](./functions.md)の条件付き集計・検索・文字列・日付・`ROW` / `COLUMN` なども、数式と計算結果を出力します。`XLOOKUP` などは、それぞれの関数に対応したExcelのバージョンで開いてください。[16種類の図形](./insertions-and-json.md#図形の種類)は、角丸・多角形・ブロック矢印も含めて編集可能な図形として出力します。図形・画像・テキストボックスの回転角度も保持し、文字もその角度に合わせます。

日付・時刻の表示形式を指定したISO文字列は、Excelの日付シリアル値と表示書式へ変換します。元のJSONでは文字列のままです。入力規則の補助シート名は既存名との重複を避けます。候補にカンマや引用符を含めても分割せず、`=` で始まる候補も数式にはしません。

角丸長方形の `cornerRadiusRatio` は `roundRect` の調整値 `adj` として0も含めて出力します。省略時は従来の丸みを使用します。接続線の対象はカスタム形状の外形・接続点にも丸みを反映し、LikeXへ戻すための比率も保持します。Officeの値は10万分の1刻みへ丸めます。

## 図形とテキストボックスの文字

共通型 `SpreadsheetDrawingTextStyle` の `fontFamily`・`italic`・`underline`、`textInsets`、`textWrap`、`textOverflow` / `textVerticalOverflow`、`textAlign` / `textVerticalAlign`、`textAutoFit`、`textFontScale`、`textLineHeight` をDrawingMLへ出力します。公開の `shapes.insert` / `textBoxes.insert` と各更新コマンドの `patch` で指定でき、SPON・XLSXの両方で保持します。[属性とコマンドの例](./insertions-and-json.md)を参照してください。

`textInsets` の省略時は、表示・編集と同じ各0pxの余白を明示して出力します。折り返しあり、はみ出しは切り取り、行間は1.4倍が既定値です。配置は図形が中央、テキストボックスが左上です。明示された余白やExcelから取り込んだ余白（Office側の省略時の余白を含む）は保持します。既存SPONで `textInsets` を省略していた図形も0pxとなるため、以前の見た目を維持したい場合は各辺に8pxを指定してください。

`textAutoFit: "shrink"` は保存済みの `textFontScale` と縮小指定を出力します。ブラウザーでの実測による追加の縮小は表示時の計算で、保存モデルや出力値を上書きしません。`"resize"` はExcelへ自動拡大指定を書き戻しますが、LikeXの表示では文字領域だけを拡張し、図形の外形を保存サイズのまま保つ近似です。この近似はXLSX取り込み時に警告します。

文字ごとに異なる書式や段落ごとに異なる配置は、取り込み時に先頭の書式・配置へ統一して警告します。出力するのはモデルに残った単一書式で、元の混在書式や省略した段落余白などは復元しません。フォントは名前を保存し、フォントファイルは埋め込みません。端末にそのフォントがない場合は代替フォントによる文字幅の差が残ります。

## 互換性と実行環境

- 画像・数式・文字組みを含めたExcel全機能との完全互換を意味しません。Excelのフォントや列幅の単位により、画面と配置・折り返しが多少変わることがあります。
- 通常のPNG／JPEGはそのまま内包します。WebP・GIF・向き情報付きJPEGは既定ではブラウザのCanvasでPNGへ変換します。アニメーションは静止画像になります。Node.jsでは下記の `rasterizeImage` を指定します。変換が必要なのに実行環境や変換関数がない場合は、対象画像の名前・リソースIDを含むエラーにします。
- 画像変換後にも1枚5 MiB、合計20 MiBの上限を適用します。画像取得の外部通信は行いません。
- Excelの上限を超えるセル（32,767文字／253改行）、大きすぎる行高や書式数、不正なXML文字は明示的にエラーになります。黙って切り詰めません。
- 色はHEX・RGB・HSL・OKLab／OKLCH・一般的な色名からRGBへ変換します。CSS変数など解決できない色は既定色へ戻します。セルの半透明色は白地に合成し、図形では透明度を保持します。
- 数式はこのコンポーネントが対応する構文・関数とブック内部の参照を出力します。未対応関数や外部ブック参照はエラーにし、Excelで新たな外部アクセスが発生する式へ変換しません。
- JSONのIDや編集履歴・ロック情報はExcel独自の管理情報へ変換しません。アプリケーションの保存・復元にはJSONを使ってください。

出力はSpreadsheetML／DrawingMLの必要な部分を生成し、CoreのZIP処理で組み立てます。追加の実行時パッケージは不要です。形式の参考: [SpreadsheetML](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)、[DrawingMLのシート上の描画](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.spreadsheet.worksheetdrawing)。

## Node.js・画面なしでの出力

`@likex/spreadsheet/model` から読み込み・書き出しの両方を利用できます。Reactやコンポーネントの準備は不要です。Node.js 22.13以降で、通常のPNG／JPEGを含むブックは追加設定なく変換できます。

```ts
import { readFile, writeFile } from "node:fs/promises";
import { parseWorkbook, exportSpreadsheetXlsx } from "@likex/spreadsheet/model";

const workbook = parseWorkbook(await readFile("売上.spon", "utf8"));
const file = await exportSpreadsheetXlsx(workbook);
await writeFile("売上.xlsx", new Uint8Array(await file.arrayBuffer()));
```

`/model` の戻り値も実体は `Blob` です。DOMの型宣言を必要としないよう、型上はCoreの `OfficePackageBlob`（`size`, `type`, `arrayBuffer()`, `text()`）を公開しています。出力オプションの型は `SpreadsheetXlsxExportOptions` です。UI入口の `SpreadsheetExcelExportOptions` と同じ意味で、キャンセル通知も `AbortSignal` を渡せます。

WebP・GIF・回転情報付きJPEGを扱う場合は、利用側の画像変換処理を指定します。下記の `convertToPng` は利用側が用意する関数です。ブラウザーのrefにも同じ関数を渡せます。

```ts
import {
  exportSpreadsheetXlsx,
  type SpreadsheetImageRasterizer,
} from "@likex/spreadsheet/model";

async function exportWithConverter(convertToPng: SpreadsheetImageRasterizer) {
  return exportSpreadsheetXlsx(workbook, { rasterizeImage: convertToPng });
}
```

| 変換関数への引数 | 内容 |
| --- | --- |
| `resourceId`, `name` | 変換対象を識別するリソースIDと画像名。 |
| `source` | 元の画像Blob。`type` で形式、`arrayBuffer()` でバイト列を取得。 |
| `width`, `height` | EXIFの向きを反映した出力幅・高さ。縦横を入れ替える場合もこの寸法に合わせる。 |
| `signal` | キャンセル通知。利用側の変換処理にも伝える。 |

戻り値は指定寸法のPNG Blob、またはそのPromiseです。透過とアニメーションの先頭フレームを維持してください。ライブラリはMIME、PNGのヘッダー、寸法、1枚5 MiB・合計20 MiBのサイズ上限を検証します。通常のPNG／JPEGでは変換関数を呼びません。同じリソースを複数シートで使っていても変換は1回です。

キャンセル時は変換関数の完了を待たずに出力を中止し、遅れて返った結果を採用しません。変換関数自身の処理を停止する責任は利用側にあります。画像変換ライブラリの追加や外部サービスへの通信はLikeXでは行いません。

## 接続線の出力

端点形式の線は標準DrawingMLの `xdr:cxnSp` と `stCxn` / `endCxn` で出力し、水平・垂直・逆向きの端点と両端の矢印を保持します。接続先には元の輪郭と8接続点を持つ標準 `custGeom` を使います。LikeXに再取り込みすると元の図形種別・文字・回転・反転を復元します。

Excelの接続線は文字を直接持てないため、線の文字は独立した編集可能なテキストボックスとして出力します。Excelでは線を動かしても文字が追従せず、再取り込みでも独立したテキストボックスになります。SPONでは文字と線の関係を保持します。この変換はGUIに表示し、公開出力APIでは `onWarning` で取得できます。

```ts
await exportSpreadsheetXlsx(workbook, {
  onWarning: warning => console.info(warning.sheetId, warning.drawingId, warning.message),
});
```

`SpreadsheetXlsxExportWarning` は `{ code: "adjusted", sheetId, drawingId, message }`。線ラベルを含む描画数・出力サイズの上限を超える場合は、内容を欠落させず出力を中止します。

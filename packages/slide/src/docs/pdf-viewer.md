# PowerPoint風UIでPDFを閲覧する

`LikeSlidePdfViewer` は、LikeSlideと同じ外観のタイトルバー・左ページ一覧・中央ページ・ズーム操作を持つPDF閲覧コンポーネントです。`@likex/slide` の名前付きexportから利用します。既存の `LikeSlide` は引き続きSLON/PPTXの編集を担当します。

PDFは画像スライドへ変換して保存せず、ページをCanvasへ描画します。原本のページ順・ページごとの縦横比を保ち、拡大時には描き直します。文字・図形の編集、テキストの範囲選択・検索、リンク操作、注釈編集、SLON/PPTXへの変換は提供しません。PDF内のJavaScript・添付ファイル・リンク先を実行・開く機能もありません。

## PDF.jsで表示する

PDFの描画エンジンは利用側から注入します。PDF.js用の `createSlidePdfLoader` を同梱し、Playgroundでは `pdfjs-dist@6.4.299` と組み合わせて検証しています。通常のスライド編集だけを使うアプリにはPDF.jsは不要です。

```bash
npm install pdfjs-dist@6.4.299
```

以下はViteを使うアプリの例です。PDFは利用側で取得した `File` / `Blob` / `ArrayBuffer` / `Uint8Array` を渡します。認証付きURLやストレージからの取得・保存は利用側が担当し、ライブラリはPDFのURLを直接fetchしません。

```tsx
import { useMemo, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { LikeSlidePdfViewer, createSlidePdfLoader } from "@likex/slide";
import "@likex/slide/styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export function PdfPreview({ file }: { file: File }) {
  const [pageNumber, setPageNumber] = useState(1);
  const loadPdf = useMemo(() => createSlidePdfLoader(pdfjs, file, {
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
  }), [file]);
  return <LikeSlidePdfViewer loadPdf={loadPdf} title={file.name}
    pageNumber={pageNumber}
    onPageChange={({ pageNumber }) => setPageNumber(pageNumber)}
    colorMode="system" style={{ height: 720 }} />;
}
```

`node_modules/pdfjs-dist` の `cmaps`・`standard_fonts`・`wasm` フォルダを、例では `/pdfjs/` の下へファイル名を保って配信します。各フォルダ内のライセンス・通知も残してください。Workerは同じバージョンのファイルを使います。Vite以外ではホストの資材配信方法で `workerSrc` を設定します。CDNの利用は必須ではありません。Playgroundの `/slide/pdf` はすべてローカル配信です。

PDF.jsはブラウザーで読み込むため、SSRするホストではPDF.jsをClient側で動的に読み込むか、PDFビュー自体をクライアント専用にしてください。LikeSlide本体のimportはPDF.jsを読み込みません。ライブラリはグローバルなWorker設定を変更しません。

## 表示の操作と通知

| props | 内容 |
| --- | --- |
| `loadPdf` | PDFを読み込む `SlidePdfLoader`。`useMemo` / `useCallback` で同じ資料では参照を保つ |
| `initialPageNumber` | 最初のページ番号。1始まり |
| `pageNumber` / `onPageChange` | 表示ページの外部制御。通知は `{ pageNumber, pageCount }` |
| `initialSelectedPageNumbers` | 資料を開いたときの選択ページ。省略時は表示ページ1枚、`[]` は未選択 |
| `selectedPageNumbers` / `onSelectionChange` | 複数選択の外部制御。通知は `{ pageNumbers, pageNumber, pageCount }` |
| `initialZoom` / `onZoomChange` | 初期の倍率と倍率変更通知。100%は画面に収まるサイズ |
| `onLoad` | 読み込み後に `{ pageCount }` を通知 |
| `onError` | 読み込み・描画エラーを通知 |
| `toolbarVisible` | 閲覧操作のツールバーの表示 |
| `title`, `colorMode`, `primaryColor`, `className`, `style` | LikeSlideと同じ外観設定 |
| `ref` | `SlidePdfViewerHandle` による表示操作 |

refの `getPageNumber()` / `goToPage(pageNumber)`、`getZoom()` / `setZoom(zoom)` / `fitToPage()` は画面操作と同じ経路です。ページ数の取得前の `getPageNumber()` は0です。倍率は25〜400%。`pageNumber` を制御する場合、`onPageChange` はホストへの変更要求であり、表示は新しいpropsに従います。

キーボードのPageUp/PageDown・Home/Endで移動し、Ctrl＋ホイールで拡大縮小できます。縦長・横長のページが混在してもページごとにフィットします。ページ変更はPDF原本・編集履歴・未保存状態へ影響しません。

## 複数ページを選択してまとめて取得する

左一覧の通常クリックで1枚を選択し、Ctrl / Cmd＋クリックで追加・解除、Shift＋クリックで連続範囲、Ctrl / Cmd＋Shift＋クリックで範囲を追加します。表示している1枚と選択集合は独立しています。選択中のページを解除しても中央の表示は残せます。

```tsx
const viewerRef = useRef<SlidePdfViewerHandle>(null);

<LikeSlidePdfViewer ref={viewerRef} loadPdf={loadPdf}
  onLoad={() => {
    // 初期選択を取得する場合。読み込み前は []。
    console.log(viewerRef.current?.getSelectedPageNumbers());
  }}
  onSelectionChange={({ pageNumbers, pageNumber, pageCount }) => {
    // 例: { pageNumbers: [1, 3, 4], pageNumber: 4, pageCount: 10 }
    console.log({ pageNumbers, pageNumber, pageCount });
  }} />;

const selectedPages = viewerRef.current?.getSelectedPageNumbers(); // [1, 3, 4]
const displayedPage = viewerRef.current?.getPageNumber(); // 4
viewerRef.current?.selectPages([1, 3, 4]); // 選択だけ変更。表示ページは維持。
viewerRef.current?.selectPages([]); // 選択解除
```

`useRef` はReact、`SlidePdfViewerHandle` は `@likex/slide` からimportします。番号は1始まりで、返却する配列は重複のない資料順のコピーです。ページ本文のデータやPDFを返すAPIではありません。`selectPages` は変更要求を受け付けた場合に `true`、未読み込み・無効な番号・変更なし・変更がロックされている場合に `false` を返します。配列に無効な番号が1件でもあれば選択全体を適用しません。

`selectedPageNumbers` を指定すると選択を外部制御します。`onSelectionChange` はUI／APIからの変更要求であり、新しいpropsを渡すまで選択表示は変わりません。コールバックなしでは選択の変更要求を受け付けません。ページ表示の外部制御とは別々に設定でき、選択を固定しても表示ページは移動できます。外部props・初期表示・資料切替では選択通知を再発火せず、初期状態は `onLoad` で取得できます。

`initialSelectedPageNumbers` は資料ごとの初期値として扱い、同じPDFでのprops更新では再適用しません。無効な初期／制御配列は空選択になります。PDFを切り替えると、読み込み中は空選択となり、新しいPDFの初期選択に戻ります。通常のページ移動は選択をその1枚に戻します。選択だけを変えてもページの一括読み込み・描画・PDF原本の変更は発生しません。

通常の `LikeSlide` でも `getPageNumber()` / `getSelectedPageNumbers()` を使えます。選択したスライドの内容をまとめて取得する場合は `getSelectedSlides()` を使います。通常スライドの選択通知は、既存の `onSelectionChange` が `{ slideId, elementIds, slideIds? }` を返します。

## 外部レンダラーとライフサイクル

`SlidePdfLoader` は `{ signal }` を受け取り、`SlidePdfDocument` を返します。ドキュメントは `pageCount`、`getPage(pageNumber, { signal })`、`destroy()` を提供します。ページは寸法 `width` / `height` と `render({ canvas, scale, signal })` を提供します。自社のPDF描画エンジンも、この契約で接続できます。型はすべてUIの公開入口から取得できます。

Viewerは読み込んだドキュメントを所有し、資料の切替・アンマウント時に中断・破棄します。独自Loaderも呼び出しごとに独立したドキュメントを返し、異なるViewer間で破棄対象を共有しないでください。古い非同期結果は表示せず、中央とサムネイルの描画をキャンセルします。サムネイルは一覧の表示範囲の周辺だけ描画します。

同梱アダプターは入力サイズ・ページ数・描画サイズを検証します。暗号化やパスワード付きPDFは対象外です。PDFが要求する日本語CMap・フォント・画像デコーダー等は上記の補助資材から読み込みます。未埋め込みフォントやPDF.jsが未対応のPDF表現は、作成元アプリと描画結果が異なる場合があります。

## ソースコピー

通常どおりSlideとCoreの `src/` 全体をコピーし、`slide/core.ts` を変更します。PDFを表示するホストにだけ `pdfjs-dist` を追加し、Workerと補助資材を設定してください。PDF.jsのApache-2.0ライセンスと付属通知をホストの配布物にも含めます。`/model` や操作CLIはPDFを開かず、既存のSLON/PPTXモデルを扱います。

# PowerPoint風UIでPDFを閲覧する

`LikeSlidePdfViewer` は、LikeSlideと同じ外観のタイトルバー・左ページ一覧・中央ページ・ズーム操作を持つPDF閲覧コンポーネントです。`@likex/slide` の名前付きexportから利用します。既存の `LikeSlide` は引き続きSLON/PPTXの編集を担当します。

PDFは画像スライドへ変換して保存せず、ページをCanvasへ描画します。原本のページ順・ページごとの縦横比を保ち、拡大時には描き直します。文字検索は検索パネルの結果一覧から一致ページへ移動できます。文字・図形の編集、テキストの範囲選択、リンク操作、注釈編集、SLON/PPTXへの変換は提供しません。PDF内のJavaScript・添付ファイル・リンク先を実行・開く機能もありません。

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

### 指定した1ページだけの専用サムネイル

一覧カードなどには `LikeSlidePdfThumbnail` を使えます。タイトルバーを残して指定した1ページだけを表示し、ページ一覧・選択・ズーム・編集操作を持ちません。同じ `loadPdf` 契約を使うため、PDF.jsと独自レンダラーのどちらでも利用できます。

```tsx
import { LikeSlidePdfThumbnail } from "@likex/slide/thumbnail";
import "@likex/slide/styles.css";

<LikeSlidePdfThumbnail loadPdf={loadPdf} title="資料.pdf" pageNumber={3}
  colorMode="system" style={{ width: 360, height: 280 }}
  onError={error => console.error(error.message)} />;
```

公開型は `SlidePdfThumbnailProps` です。サムネイル用の公開入口 `@likex/slide/thumbnail` からコンポーネント・型・`createSlidePdfLoader` を利用できます。`loadPdf` が必須で、`pageNumber`・`title`・`colorMode`・`primaryColor`・`className`・`style`・`aria-label`・`onError` を指定できます。`pageNumber` は1始まりで、省略時は1です。不正な番号やページ数を超える指定は表示位置を丸めず、プレースホルダーと `onError` で通知します。後から有効な番号へ変更すると、そのページの表示に戻ります。

表示操作用refや選択通知はありません。既定の高さは280px、最小高さは0で、表示領域の変更に合わせて縦横比を保って自動で縮小します。原寸のscale 1を超える拡大はせず、描画はサムネイル用の最大約20万画素に制限します。領域のサイズ変更は描画済みCanvasの表示サイズだけを変え、PDFを再描画しません。

サムネイルは指定したページだけを取得・描画し、ページ一覧を作りません。同じ `loadPdf` のまま `pageNumber` を変える場合は、文書を読み直さず同じセッションを使います。変更前のページ取得・描画を中断し、古い結果やエラーを新しいページへ反映しません。PDFの切替・アンマウント時には読み込みと描画を中断し、ドキュメントを破棄します。`loadPdf` の参照は同じ資料では保ってください。複数のViewerやサムネイルへ同じLoaderを渡す場合も、呼び出しごとに独立したドキュメントを返す必要があります。

### ページ一覧付きViewerの操作

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
| `toolbarVisible` | 閲覧操作のツールバーの表示。非表示でも検索API・ショートカットは利用可能 |
| `initialSearchOpen` / `initialSearchQuery` | 初回マウント時の検索パネル表示と文字列 |
| `features.search` | `false` で検索UI・ショートカット・検索開閉APIを無効化 |
| `title`, `colorMode`, `primaryColor`, `className`, `style` | LikeSlideと同じ外観設定 |
| `ref` | `SlidePdfViewerHandle` による表示操作 |

refの `getPageNumber()` / `goToPage(pageNumber)`、`getZoom()` / `setZoom(zoom)` / `fitToPage()` は画面操作と同じ経路です。ページ数の取得前の `getPageNumber()` は0です。倍率は25〜400%。`pageNumber` を制御する場合、`onPageChange` はホストへの変更要求であり、表示は新しいpropsに従います。

通常のファイル閲覧を特定ページから開くには、`<LikeSlidePdfViewer loadPdf={loadPdf} initialPageNumber={3} />` と指定します。表示後も利用側からページを切り替える場合は、冒頭の例の `pageNumber` と `onPageChange` を使います。`initialPageNumber` の更新だけでは同じPDFの表示ページは変わりません。

キーボードのPageUp/PageDown・Home/Endで移動し、Ctrl＋ホイールで拡大縮小できます。左ページ一覧内にフォーカスがあるときは↑／↓で前／次のページを1枚選択して表示し、一覧のスクロールと移動先サムネイルのフォーカスも追従します。Shift＋↑／↓では範囲選択を拡張します。入力欄では矢印を奪わず、ページや選択を外部制御している場合は既存のコールバック契約に従います。縦長・横長のページが混在してもページごとにフィットします。小数ピクセルの表示領域でも収まる寸法で計算し、同じページのサイズ変更中は直前の描画を保持します。ページ変更はPDF原本・編集履歴・未保存状態へ影響しません。

## 検索パネルを開いて表示する

```tsx
import { useRef } from "react";
import { LikeSlidePdfViewer, type SlidePdfViewerHandle } from "@likex/slide";

const viewerRef = useRef<SlidePdfViewerHandle>(null);

<LikeSlidePdfViewer ref={viewerRef} loadPdf={loadPdf}
  initialSearchOpen initialSearchQuery="売上" />;

// 表示後に利用側のボタンなどから呼び出せます。PDF読み込み中でも受け付けます。
viewerRef.current?.openSearch("利益");
viewerRef.current?.closeSearch();
viewerRef.current?.openSearch();   // 前回の文字列を保持
viewerRef.current?.openSearch(""); // 文字列をクリアして開く
```

`initialSearchOpen` と `initialSearchQuery` はマウント時に1度だけ読みます。省略時は閉じた状態・空文字列です。初期文字列の不正な値や4,096文字超過は空文字列にします。表示後の初期props更新では変更しないため、後から開く場合は `openSearch` を使います。`openSearch(query?: string): boolean` は操作の受付で `true`、検索機能無効・アンマウント後・不正な文字列では `false` です。検索完了を表す戻り値ではありません。

ツールバーの検索ボタン、またはViewer内の **Ctrl+F / Cmd+F** でも開けます。`toolbarVisible={false}` でもショートカットとrefの操作は利用できます。Escまたは閉じるボタンでViewerへフォーカスを戻します。`features={{ search: false }}` は開いているパネルを閉じ、進行中の検索も中止します。有効化し直しただけでは再表示せず、文字列は次の `openSearch()` 用に保持します。

文字列を1語のリテラルとして検索し、大文字・小文字を区別する条件を選べます。検索は1ページずつ非同期で行い、完了後に一致箇所を強調した抜粋と件数を表示し、最初の一致ページを開きます。「前へ／次へ」、入力欄でのEnter／Shift+Enter、結果クリックで一致ページへ移動します。表示ページを外部制御している場合は `onPageChange` へ移動を要求し、コールバックがなければ移動を受け付けません。結果の多い場合は100件ずつ表示し、前後の操作では全取得結果を巡回します。

同梱の `createSlidePdfLoader` は表示済みPDFから文字情報も取得するため、検索専用のローダー注入やPDFの二重読み込みは不要です。検索語・大小文字条件の変更、パネルの閉鎖、PDF切替、アンマウントで検索を中止し、古い結果で表示やページを移動しません。検索を閉じてもPDFの表示は継続します。

検索対象はPDFに含まれる文字情報です。画像だけのPDFのOCRや、Canvas本文上の一致文字の強調は行いません。検索パネル内の抜粋を強調し、該当ページを表示します。検索は最大2,000ページ、結果は最大1,000一致ページで、それ以降がある場合は省略を通知します。文字数・一致位置は下記の検索APIと共通の上限です。文字取得や解析のエラーは検索パネル内に表示し、閲覧文書を破棄しません。

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

`SlidePdfLoader` は `{ signal }` を受け取り、`SlidePdfDocument` を返します。ドキュメントは `pageCount`、`getPage(pageNumber, { signal })`、`destroy()` を提供します。検索にも対応させる場合は任意の `getPageText(pageNumber, { signal })` を追加し、抽出した文字列を返してください。描画だけを提供する既存ローダーもそのまま使用できますが、検索パネルでは文字検索に未対応であることを表示します。ページは寸法 `width` / `height` と `render({ canvas, scale, signal })` を提供します。自社のPDF描画エンジンも、この契約で接続できます。型はすべてUIの公開入口から取得できます。

Viewerは読み込んだドキュメントを所有し、資料の切替・アンマウント時に中断・破棄します。独自Loaderも呼び出しごとに独立したドキュメントを返し、異なるViewer間で破棄対象を共有しないでください。古い非同期結果は表示せず、中央とサムネイルの描画をキャンセルします。サムネイルは一覧の表示範囲の周辺だけ描画します。

同梱アダプターは入力サイズ・ページ数・描画サイズを検証します。暗号化やパスワード付きPDFは対象外です。PDFが要求する日本語CMap・フォント・画像デコーダー等は上記の補助資材から読み込みます。未埋め込みフォントやPDF.jsが未対応のPDF表現は、作成元アプリと描画結果が異なる場合があります。

## 画面を起動せずPDFの本文を検索する

`@likex/slide/pdf` はReact・DOM・Canvasを起動しない文字検索の入口です。Node.jsでも使え、公開型はDOM型定義を必要としません。PDF.jsは上記と同じくホストから渡します。画面なしの利用には文字用の `PdfTextLoader` を使います。Viewerの表示用 `SlidePdfLoader` は任意の文字取得にも対応しますが、この検索APIへ表示中の文書を直接渡して破棄対象を共有しないでください。

```ts
import { createPdfTextLoader, searchPdf } from "@likex/slide/pdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// Worker・CMap・標準フォントなどの設定と、PDF bytesの取得はホストで行う。
const loadText = createPdfTextLoader(pdfjs, bytes, {
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
});
const result = await searchPdf(loadText, {
  keywords: ["売上", "2026"], operator: "and", matchCase: false,
}, { signal: controller.signal, limit: 1000 });

for (const hit of result.matches) {
  console.log(hit.pageNumber, hit.text, hit.matches);
  // 表示中のPDFで開く場合: viewerRef.current?.goToPage(hit.pageNumber)
}
```

`bytes` は `Uint8Array` / `ArrayBuffer`、または `size` と `arrayBuffer()` を持つファイルです。ブラウザーの `Blob` も渡せます。URL文字列を受け取ってPDF本体を取得する処理はありません。Node.jsでは `readFile()` の結果を渡し、必要な補助資材はPDF.jsが読めるローカルパスなどで設定します。

戻り値は `{ matches, truncated }`、各ページの結果は `{ pageNumber, text, matches }` です。`pageNumber` は1始まりで、資料順に返します。ページ内の `matches` は `{ keyword, from, to }` の配列で、位置は返却した `text` に対するUTF-16の半開区間です。`text.slice(from, to)` で一致文字列を取り出せます。ANDは同じページ内に全キーワード、ORは1個以上があるページを返します。複数ページの内容を合わせてANDを満たすことはありません。

キーワードはリテラル文字列です。既定は `operator: "and"`、`matchCase: false`。最大64語・各1〜4,096文字・合計16,384文字で、空配列は読み込みなしの0件、空文字はエラーです。正規表現の指定はありません。検索条件・上限は開始時に取り込み、待機中の引数の書き換えは反映しません。

同梱アダプターはPDF.jsの [`getTextContent`](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html#getTextContent) を使います。抽出順に各文字断片の `str` をそのまま連結し、`hasEOL` がある断片の後ろにLFを追加します。別断片へ分割された単語も連結後に検索できます。座標からの読書順・段組みの復元、行末のハイフン補正、改行の空白への置換はしません。検索位置はPDF座標ではありません。OCRはなく、画像だけのPDFは検索可能な文字層がなければ一致しません。注釈・リンク先・添付ファイル・メタデータは対象外です。

`limit` は一致するページ数の上限で、既定1,000、1〜10,000です。上限を超える一致ページを実際に見つけたときだけ `truncated: true` で停止します。ファイルは100 MiB・2,000ページまで。文字情報は1ページ100万文字・10万項目、走査合計2,000万文字、一致位置は1ページ1万件・検索全体10万件までで、予算超過は部分結果を返さずエラーになります。文字数はUTF-16単位です。1ページずつ走査し、一致ページの文字と位置を結果として保持します。文字サイズの検証は抽出後に行うため、PDF.js自体が解析中に使うメモリ全体を保証する上限ではありません。

`PdfTextLoader` は呼び出しごとに独立した `PdfTextDocument` を返し、`pageCount`、`getPageText(pageNumber, { signal })`、`destroy()` を提供します。検索APIがその文書を所有し、正常終了・エラー・中断時に破棄します。Viewerの文書と共有しないでください。中断時は遅れて返る結果を採用せず、遅れて届く文書も破棄します。文字取得に対応しないローダーはエラーです。サーバーで索引を保存したり別の抽出器へ置き換えたりする場合も、この文字専用契約を使えます。

## ソースコピー

通常どおりSlideとCoreの `src/` 全体をコピーし、`slide/core.ts` を変更します。PDFを表示・検索するホストにだけ `pdfjs-dist` を追加し、Workerと補助資材を設定してください。文字検索の入口は `components/slide/pdf-entry` です。PDF.jsのApache-2.0ライセンスと付属通知をホストの配布物にも含めます。`/model` や操作CLIはPDFを開かず、既存のSLON/PPTXモデルを扱います。

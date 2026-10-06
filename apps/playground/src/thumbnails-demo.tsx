import { useMemo, useState } from "react";
import { SpreadsheetThumbnail } from "@likex/spreadsheet/thumbnail";
import { LikeDocumentThumbnail } from "@likex/document/thumbnail";
import { LikeSlideThumbnail, LikeSlidePdfThumbnail, createSlidePdfLoader } from "@likex/slide/thumbnail";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import "../../../packages/spreadsheet/src/styles.css";
import "../../../packages/document/src/styles.css";
import "../../../packages/slide/src/styles.css";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { createDemoDocument } from "./demo/document-model";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { createSlidePdfSample } from "./demo/slide-pdf-sample";
import "./thumbnails-demo.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export default function ThumbnailsDemo() {
  const [workbook] = useState(createDemoWorkbook), [document] = useState(createDemoDocument), [deck] = useState(createDemoSlideDeck);
  const [dark, setDark] = useState(false);
  const loadPdf = useMemo(() => createSlidePdfLoader(pdfjs, createSlidePdfSample(), {
    cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  }), []);
  const colorMode = dark ? "dark" : "light";
  return <main className="thumbnail-demo">
    <header className="thumbnail-demo-heading"><div><p>LikeX Playground</p><h1>資料のサムネイル</h1>
      <p>タイトルと先頭の内容だけを、シンプルに表示します。</p></div>
      <label><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)} /> ダーク表示</label>
    </header>
    <div className="thumbnail-demo-grid">
      <section><h2>スプレッドシート</h2><SpreadsheetThumbnail workbook={workbook} title="売上・業務サンプル" colorMode={colorMode} />
        <a href="/spreadsheet">スプレッドシートを開く</a></section>
      <section><h2>Word</h2><LikeDocumentThumbnail document={document} colorMode={colorMode} />
        <a href="/document">文書を開く</a></section>
      <section><h2>スライド</h2><LikeSlideThumbnail deck={deck} colorMode={colorMode} />
        <a href="/slide">スライドを開く</a></section>
      <section><h2>PDF</h2><LikeSlidePdfThumbnail loadPdf={loadPdf} title="Northstar — PDF資料" colorMode={colorMode} />
        <a href="/slide/pdf">PDFを開く</a></section>
    </div>
  </main>;
}

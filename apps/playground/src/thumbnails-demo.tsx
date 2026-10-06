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
  const [sheetIndex, setSheetIndex] = useState(0), [sheetKey, setSheetKey] = useState("name");
  const [slidePage, setSlidePage] = useState(1), [documentPage, setDocumentPage] = useState(1), [pdfPage, setPdfPage] = useState(1);
  const sheet = workbook.sheets[sheetIndex];
  const sheetTarget = sheetKey === "name" ? { sheetName: sheet.name } : { sheetId: sheet.id };
  const loadPdf = useMemo(() => createSlidePdfLoader(pdfjs, createSlidePdfSample(), {
    cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  }), []);
  const colorMode = dark ? "dark" : "light";
  return <main className="thumbnail-demo">
    <header className="thumbnail-demo-heading"><div><p>LikeX Playground</p><h1>資料のサムネイル</h1>
      <p>表示するシートやページを選び、その位置から通常画面も開けます。</p></div>
      <label><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)} /> ダーク表示</label>
    </header>
    <div className="thumbnail-demo-grid">
      <section><h2>スプレッドシート</h2><div className="thumbnail-demo-target">
        <label>シート <select aria-label="表示するシート" value={sheetIndex} onChange={event => setSheetIndex(Number(event.target.value))}>{workbook.sheets.map((sheet, index) => <option key={sheet.id} value={index}>{sheet.name}</option>)}</select></label>
        <label>指定方法 <select value={sheetKey} onChange={event => setSheetKey(event.target.value)}><option value="name">シート名</option><option value="id">シートID</option></select></label>
      </div><SpreadsheetThumbnail workbook={workbook} {...sheetTarget} title="売上・業務サンプル" colorMode={colorMode} />
        <a href={`/spreadsheet?${new URLSearchParams([[sheetKey === "name" ? "sheetName" : "sheetId", sheetKey === "name" ? sheet.name : sheet.id]]).toString()}`}>このシートから開く</a></section>
      <section><h2>Word</h2><div className="thumbnail-demo-target"><label>ページ <select aria-label="Wordの表示ページ" value={documentPage} onChange={event => setDocumentPage(Number(event.target.value))}>
        <option value={1}>1. 提案概要</option><option value={2}>2. 運用と評価</option></select></label><span>明示した改ページで区切ります</span></div>
        <LikeDocumentThumbnail document={document} pageNumber={documentPage} colorMode={colorMode} />
        <a href={`/document?page=${documentPage}`}>このページから文書を開く</a></section>
      <section><h2>スライド</h2><div className="thumbnail-demo-target"><label>ページ <select aria-label="スライドの表示ページ" value={slidePage} onChange={event => setSlidePage(Number(event.target.value))}>
        {deck.slides.map((slide, index) => <option key={slide.id} value={index + 1}>{index + 1}. {slide.name}</option>)}</select></label></div>
        <LikeSlideThumbnail deck={deck} pageNumber={slidePage} colorMode={colorMode} />
        <a href={`/slide?page=${slidePage}`}>このページからスライドを開く</a></section>
      <section><h2>PDF</h2><div className="thumbnail-demo-target"><label>ページ <select aria-label="PDFの表示ページ" value={pdfPage} onChange={event => setPdfPage(Number(event.target.value))}>
        {[1, 2, 3].map(page => <option key={page} value={page}>{page}ページ目</option>)}</select></label></div>
        <LikeSlidePdfThumbnail loadPdf={loadPdf} pageNumber={pdfPage} title="Northstar — PDF資料" colorMode={colorMode} />
        <a href={`/slide/pdf?page=${pdfPage}`}>このページからPDFを開く</a></section>
    </div>
  </main>;
}

import { useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { LikeSlidePdfViewer, createSlidePdfLoader, SLIDE_PDF_LIMITS, type SlidePdfLoader, type SlidePdfViewerHandle } from "@likex/slide";
import "../../../packages/slide/src/styles.css";
import { createSlidePdfSample } from "./demo/slide-pdf-sample";
import { getDemoComponentTheme } from "./demo/component-theme";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export default function SlidePdfDemo() {
  const [source, setSource] = useState<{ title: string; data: Uint8Array | File }>(() => ({ title: "Northstar — PDF資料", data: createSlidePdfSample() }));
  const [theme] = useState(() => getDemoComponentTheme("system"));
  const [initialPageNumber] = useState(() => { const page = new URLSearchParams(window.location.search).get("page"); return page === null ? undefined : Number(page); });
  const [fileError, setFileError] = useState("");
  const viewer = useRef<SlidePdfViewerHandle>(null);
  const [selection, setSelection] = useState<{ loader: SlidePdfLoader; pageNumber: number; pageNumbers: number[] } | null>(null);
  const loader = useMemo(() => createSlidePdfLoader(pdfjs, source.data, {
    cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  }), [source]);
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "10px 18px", background: "#f6f7f9", color: "#243042", fontSize: 13 }}>
      <label>PDFを開く <input type="file" accept="application/pdf,.pdf" aria-label="表示するPDF" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (!file.size || file.size > SLIDE_PDF_LIMITS.fileBytes) { setFileError("空でない100 MiB以下のPDFを選択してください。"); return; }
        setFileError(""); setSource({ title: file.name, data: file });
      }} /></label>
      <button type="button" onClick={() => { setFileError(""); setSource({ title: "Northstar — PDF資料", data: createSlidePdfSample() }); }}>サンプルに戻す</button>
      <span>ファイルはこのブラウザー内で表示します。</span>
      {fileError && <span role="alert">{fileError}</span>}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "6px 18px", background: "#f6f7f9", color: "#243042", fontSize: 12 }}>
      <output aria-label="ページの選択状況">{selection?.loader === loader
        ? `表示中: ${selection.pageNumber}ページ ／ 選択中: ${selection.pageNumbers.length ? selection.pageNumbers.join(", ") + "ページ" : "なし"}`
        : "読み込み中"}</output>
      <span>Ctrl／⌘＋クリックで追加・解除、Shift＋クリックで範囲選択</span>
    </div>
    <LikeSlidePdfViewer ref={viewer} loadPdf={loader} initialPageNumber={initialPageNumber} title={source.title} {...theme} style={{ flex: 1, minHeight: 0 }}
      onLoad={() => setSelection({ loader, pageNumber: viewer.current?.getPageNumber() ?? 0, pageNumbers: viewer.current?.getSelectedPageNumbers() ?? [] })}
      onPageChange={({ pageNumber }) => setSelection(previous => ({ loader, pageNumber, pageNumbers: previous?.loader === loader ? previous.pageNumbers : [] }))}
      onSelectionChange={({ pageNumber, pageNumbers }) => setSelection({ loader, pageNumber, pageNumbers })} />
  </main>;
}

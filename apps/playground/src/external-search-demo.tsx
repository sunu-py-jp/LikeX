import { useMemo, useRef, useState } from "react";
import Spreadsheet, { type SpreadsheetHandle, type SpreadsheetProps } from "@likex/spreadsheet";
import LikeSlide, { LikeSlidePdfViewer, createSlidePdfLoader, type SlideHandle, type SlideProps, type SlidePdfViewerHandle, type SlidePdfViewerProps } from "@likex/slide";
import LikeDocument, { type DocumentHandle, type DocumentProps } from "@likex/document";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { createDemoDocument } from "./demo/document-model";
import { createSlidePdfSample } from "./demo/slide-pdf-sample";
import "../../../packages/spreadsheet/src/styles.css";
import "../../../packages/slide/src/styles.css";
import "../../../packages/document/src/styles.css";
import "./external-search-demo.css";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type Viewer = "spreadsheet" | "slide" | "document" | "pdf";
const viewers: { id: Viewer; label: string }[] = [
  { id: "spreadsheet", label: "Spreadsheet" }, { id: "slide", label: "Slide" },
  { id: "document", label: "Word" }, { id: "pdf", label: "PDF" },
];
const sheetResults: SpreadsheetProps["externalSearch"] = {
  title: "外部検索結果", initialResultId: "sales",
  results: [
    { id: "sales", title: "開発案件の売上と粗利", snippet: "サイト制作・アプリ開発の見込みと、原価を差し引いた収益を確認できます。", target: { sheetId: "sales-plan", range: "A4:I5" } },
    { id: "expense", title: "継続して発生するクラウド費用", snippet: "半年分のクラウド利用料を、月数と単価から算出しています。", target: { sheetId: "expenses", range: "A4:C4" } },
    { id: "profit", title: "目標達成率と営業利益", snippet: "売上目標への到達状況と、共通経費を控除した利益の関連箇所です。", target: { sheetId: "sales-plan", range: "A14:E16" } },
  ],
};
const slideResults: SlideProps["externalSearch"] = {
  title: "外部検索結果", initialResultId: "pilot",
  results: [
    { id: "pilot", title: "小さく試して段階的に導入する", snippet: "要件整理から試作・検証、運用への移行までの進め方です。", target: { slideId: "milestones" } },
    { id: "decision", title: "導入前に合意しておくこと", snippet: "利用シーン、確認メンバー、試作の完了日と判断基準を決めます。", target: { slideId: "decisions" } },
  ],
};
const pdfResults: SlidePdfViewerProps["externalSearch"] = {
  title: "外部検索結果", initialResultId: "workflow",
  results: [
    { id: "workflow", title: "情報を集め、つなぎ、行動する", snippet: "Collect / Connect / Act の3段階で、チームの判断につなげる仕組みです。", target: { pageNumber: 2 } },
    { id: "expand", title: "試験導入から効果測定へ", snippet: "現状を理解し、対象を絞って試し、成果を測定して展開します。", target: { pageNumber: 3 } },
  ],
};
const viewStyle = { height: "100%", width: "100%", minHeight: 0 };

function DemoActions({ open, local }: { open: () => void; local: () => void }) {
  return <div className="external-demo-actions"><span>検索結果から移動した後も、資料全体を自由に閲覧できます。</span>
    <button type="button" onClick={open}>外部検索結果を開く</button><button type="button" onClick={local}>文書内を検索</button></div>;
}

function SheetExample() {
  const [workbook] = useState(createDemoWorkbook), ref = useRef<SpreadsheetHandle>(null);
  return <><DemoActions open={() => ref.current?.openExternalSearch()} local={() => ref.current?.openSearch("")} />
    <div className="external-demo-view"><Spreadsheet ref={ref} title="2026年 下期事業計画" initialWorkbook={workbook} initialSheetId="sales-plan"
      initialSearchOpen externalSearch={sheetResults} initialRibbonDisplayMode="tabs" initialZoom={90} colorMode="light" onSave={value => value} style={viewStyle} /></div></>;
}
function SlideExample() {
  const [deck] = useState(createDemoSlideDeck), ref = useRef<SlideHandle>(null);
  return <><DemoActions open={() => ref.current?.openExternalSearch()} local={() => ref.current?.openSearch("")} />
    <div className="external-demo-view"><LikeSlide ref={ref} initialDeck={deck} initialSearchOpen externalSearch={slideResults}
      initialRibbonDisplayMode="tabs" colorMode="light" onSave={value => value} style={viewStyle} /></div></>;
}
function WordExample() {
  const [document] = useState(createDemoDocument), ref = useRef<DocumentHandle>(null);
  const results = useMemo<DocumentProps["externalSearch"]>(() => {
    const headingId = (text: string) => document.content.content.find(node => node.type === "heading" && node.content?.some(part => part.type === "text" && part.text === text))?.attrs?.id ?? "missing";
    return { title: "外部検索結果", initialResultId: "operations", results: [
      { id: "operations", title: "継続できる運用と評価", locationLabel: "見出し：運用と評価", snippet: "小さく始め、使いながら改善する運用方針と、週次・月次の評価指標です。", target: { blockId: headingId("運用と評価") } },
      { id: "schedule", title: "試験導入までの進め方", locationLabel: "見出し：3. 進め方とスケジュール", snippet: "ヒアリング、試験導入、振り返りの時期と実施内容を整理しています。", target: { blockId: headingId("3. 進め方とスケジュール") } },
    ] };
  }, [document]);
  return <><DemoActions open={() => ref.current?.openExternalSearch()} local={() => ref.current?.openSearch("")} />
    <div className="external-demo-view"><LikeDocument ref={ref} initialDocument={document} initialSearchOpen externalSearch={results}
      initialRibbonDisplayMode="tabs" colorMode="light" onSave={value => value} style={viewStyle} /></div></>;
}
function PdfExample() {
  const ref = useRef<SlidePdfViewerHandle>(null);
  const loadPdf = useMemo(() => createSlidePdfLoader(pdfjs, createSlidePdfSample(), {
    cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/",
  }), []);
  return <><DemoActions open={() => ref.current?.openExternalSearch()} local={() => ref.current?.openSearch("")} />
    <div className="external-demo-view"><LikeSlidePdfViewer ref={ref} title="Northstar — Product strategy" loadPdf={loadPdf}
      initialSearchOpen externalSearch={pdfResults} colorMode="light" style={viewStyle} /></div></>;
}

export default function ExternalSearchDemo() {
  const raw = new URLSearchParams(window.location.search).get("view"), view = viewers.find(item => item.id === raw)?.id ?? "spreadsheet";
  return <main className="external-demo"><header className="external-demo-header"><strong>外部検索結果</strong>
    <nav aria-label="検索結果のデモ"><span>表示する資料</span>{viewers.map(item => <a key={item.id} href={`/external-search?view=${item.id}`} aria-current={view === item.id ? "page" : undefined}>{item.label}</a>)}</nav></header>
    {view === "spreadsheet" ? <SheetExample /> : view === "slide" ? <SlideExample /> : view === "document" ? <WordExample /> : <PdfExample />}
  </main>;
}

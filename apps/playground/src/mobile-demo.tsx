import { useCallback, useRef, useState } from "react";
import Explorer, { type ExplorerEntry, type ExplorerSavePayload } from "@likex/explorer";
import Spreadsheet from "@likex/spreadsheet";
import LikeSlide from "@likex/slide";
import LikeDocument, { type ResponsiveLayout } from "@likex/document";
import { seedEntries } from "./demo/seed";
import { createDemoWorkbook } from "./demo/spreadsheet-workbook";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { createDemoDocument } from "./demo/document-model";
import "../../../packages/explorer/src/styles.css";
import "../../../packages/spreadsheet/src/styles.css";
import "../../../packages/slide/src/styles.css";
import "../../../packages/document/src/styles.css";
import "./mobile-demo.css";

const views = { explorer: "Explorer", spreadsheet: "Spreadsheet", slide: "LikeSlide", document: "LikeDocument" } as const;
type View = keyof typeof views;
const widths = [320, 390, 600, 900] as const;

function initialSettings() {
  const query = new URLSearchParams(window.location.search), view = query.get("view"), layout = query.get("layout"), width = Number(query.get("width"));
  return { view: (view && Object.hasOwn(views, view) ? view : "explorer") as View,
    layout: (layout === "mobile" || layout === "desktop" ? layout : "auto") as ResponsiveLayout,
    width: widths.find(value => value === width) ?? 390, readOnly: query.get("readOnly") === "true" };
}

function createExplorerSample() {
  const files = new Map<string, Blob>();
  const entries = seedEntries.map(({ content, ...entry }): ExplorerEntry => {
    if (entry.kind === "folder") return { ...entry, source: null };
    const blob = new Blob([content ?? ""], { type: entry.mime });
    files.set(entry.id, blob);
    return { ...entry, size: blob.size, source: { kind: "existing", id: entry.id } };
  });
  return { entries, files };
}

export default function MobileDemo() {
  const [initial] = useState(initialSettings);
  const [view, setView] = useState(initial.view), [width, setWidth] = useState<number>(initial.width);
  const [layout, setLayout] = useState<ResponsiveLayout>(initial.layout), [readOnly, setReadOnly] = useState(initial.readOnly);
  const [workbook, setWorkbook] = useState(createDemoWorkbook), [deck, setDeck] = useState(createDemoSlideDeck), [document, setDocument] = useState(createDemoDocument);
  const [explorer] = useState(createExplorerSample), savedExplorer = useRef(explorer);
  const [entries, setEntries] = useState(explorer.entries);
  const [saved, setSaved] = useState("");
  const saveExplorer = useCallback((payload: ExplorerSavePayload) => {
    const files = new Map<string, Blob>();
    const entries = payload.entries.map((entry): ExplorerEntry => {
      if (entry.kind === "folder") return { ...entry, source: null };
      const source = entry.source;
      if (!source) throw new Error("ファイル本体が見つかりません");
      const id = source.kind === "local" ? entry.id : source.id;
      const blob = source.kind === "local" ? source.file : savedExplorer.current.files.get(id);
      if (!blob) throw new Error("ファイル本体が見つかりません");
      files.set(id, blob);
      return { ...entry, source: { kind: "existing", id } };
    });
    savedExplorer.current = { entries, files };
    setEntries(entries);
    setSaved("Explorerを保存しました");
    return entries;
  }, []);
  const readFile = useCallback(async (id: string) => {
    const file = savedExplorer.current.files.get(id);
    if (!file) throw new Error("ファイル本体が見つかりません");
    return file;
  }, []);
  const common = { layout, readOnly, colorMode: "light" as const, style: { width: "100%", height: "100%" } };
  return <main className="mobile-demo">
    <header className="mobile-demo-header"><div><p>LikeX Playground</p><h1>スマホ表示</h1></div><a href={`/${view}`}>通常のデモを開く</a></header>
    <section className="mobile-demo-settings" aria-label="表示設定">
      <label>ビュー<select value={view} onChange={event => { setView(event.target.value as View); setSaved(""); }}>{Object.entries(views).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>表示幅<select value={width} onChange={event => setWidth(Number(event.target.value))}>{widths.map(value => <option key={value} value={value}>{value}px</option>)}</select></label>
      <label>レイアウト<select value={layout} onChange={event => setLayout(event.target.value as ResponsiveLayout)}><option value="auto">auto（幅で切替）</option><option value="mobile">mobile</option><option value="desktop">desktop</option></select></label>
      <label className="mobile-demo-check"><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} />読み取り専用</label>
    </section>
    <p className="mobile-demo-description">autoはビューの幅720px未満でスマホ表示になります。保存先は画面内メモリです。ビューを切り替える前に保存すると内容を保持します。</p>
    <p className="mobile-demo-save" role="status">{saved || `${views[view]} · ${width} × 650px · ${layout}${readOnly ? " · 読み取り専用" : ""}`}</p>
    <div className="mobile-demo-stage"><div className="mobile-demo-frame" style={{ width }}>
      {view === "explorer" && <Explorer {...common} initialEntries={entries} readFile={readFile} onSave={saveExplorer} selection={{ checkboxes: true }} aria-label="スマホ表示のExplorer" />}
      {view === "spreadsheet" && <Spreadsheet {...common} initialWorkbook={workbook} onSave={value => { setWorkbook(value); setSaved("Spreadsheetを保存しました"); return value; }} aria-label="スマホ表示のSpreadsheet" />}
      {view === "slide" && <LikeSlide {...common} initialDeck={deck} onSave={value => { setDeck(value); setSaved("LikeSlideを保存しました"); return value; }} aria-label="スマホ表示のLikeSlide" />}
      {view === "document" && <LikeDocument {...common} initialDocument={document} onSave={value => { setDocument(value); setSaved("LikeDocumentを保存しました"); return value; }} aria-label="スマホ表示のLikeDocument" />}
    </div></div>
  </main>;
}

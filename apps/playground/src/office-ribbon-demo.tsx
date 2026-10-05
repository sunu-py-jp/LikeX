import { useState, type ReactNode } from "react";
import LikeSlide, { type SlideRibbonDisplayMode } from "@likex/slide";
import LikeDocument from "@likex/document";
import "../../../packages/slide/src/styles.css";
import "../../../packages/document/src/styles.css";
import "./demo/spreadsheet-ribbon-demo.css";
import { createDemoSlideDeck } from "./demo/slide-deck";
import { createDemoDocument } from "./demo/document-model";

const modes: ReadonlyArray<{ value: SlideRibbonDisplayMode; label: string; description: string }> = [
  { value: "expanded", label: "常に表示", description: "タブと操作ボタンを常に表示します。" },
  { value: "tabs", label: "タブのみ表示", description: "タブを押すと操作ボタンを一時表示します。本文やスライドを押すと閉じます。" },
  { value: "autoHide", label: "自動非表示", description: "上部の再表示ボタンからリボンを一時的に開きます。" },
  { value: "hidden", label: "完全に非表示", description: "タブも再表示ボタンも隠します。この画面上部の設定から元に戻せます。" },
];
function initialMode(): SlideRibbonDisplayMode {
  const requested = new URLSearchParams(window.location.search).get("ribbon");
  return modes.find(mode => mode.value === requested)?.value ?? "expanded";
}
function RibbonDemo({ kind, children }: { kind: "slide" | "document";
  children(mode: SlideRibbonDisplayMode, setMode: (mode: SlideRibbonDisplayMode) => void): ReactNode }) {
  const [mode, setMode] = useState(initialMode);
  return <main className="ribbon-demo">
    <header className="ribbon-demo-header">
      <div><p className="ribbon-demo-eyebrow">{kind === "slide" ? "LikeSlide" : "LikeDocument"}</p><h1>リボンの表示</h1></div>
      <nav aria-label="リボンのデモ"><a href={`/${kind}`}>標準デモ</a><a href={`/${kind}/ribbon?ribbon=hidden`}>完全非表示で開く</a></nav>
    </header>
    <section className="ribbon-demo-controls" aria-label="アプリ側の表示設定">
      <label>リボンの表示方法<select value={mode} onChange={event => {
        const selected = modes.find(item => item.value === event.target.value);
        if (selected) setMode(selected.value);
      }}>{modes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <p role="status">{modes.find(item => item.value === mode)?.description}</p>
      {mode !== "hidden" && <span className="ribbon-demo-shortcut">折りたたみ切替：Ctrl + F1</span>}
    </section>
    <div className="ribbon-demo-sheet">{children(mode, setMode)}</div>
  </main>;
}
export function SlideRibbonDemo() {
  const [deck] = useState(createDemoSlideDeck);
  return <RibbonDemo kind="slide">{(mode, setMode) =>
    <LikeSlide initialDeck={deck} colorMode="light" onSave={value => value}
      ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode}
      style={{ height: "100%", width: "100%" }} aria-label="リボン表示のサンプルスライド" />
  }</RibbonDemo>;
}
export function DocumentRibbonDemo() {
  const [document] = useState(createDemoDocument);
  return <RibbonDemo kind="document">{(mode, setMode) =>
    <LikeDocument initialDocument={document} colorMode="light" onSave={value => value}
      ribbonDisplayMode={mode} onRibbonDisplayModeChange={setMode}
      style={{ height: "100%", width: "100%" }} aria-label="リボン表示のサンプル文書" />
  }</RibbonDemo>;
}

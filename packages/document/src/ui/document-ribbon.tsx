"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronLeft, ChevronRight, Clipboard, Copy, Download, FileJson, ImagePlus, Italic, Link, List, ListOrdered, PanelLeft, Scissors, Table2, Type, Underline, Upload, WrapText } from "lucide-react";
import { toggleMark } from "prosemirror-commands";
import type { DocumentEditor } from "../state/use-document-editor";
import type { DocumentSurfaceHandle } from "./document-surface";
import type { DocumentAlignment, DocumentMarkName, DocumentTextStyle } from "../model/types";

function Group({ title, children }: { title: string; children: ReactNode }) { return <section className="lxd-ribbon-group" aria-label={title}><div className="lxd-ribbon-controls">{children}</div><div className="lxd-group-label">{title}</div></section>; }
function Action({ label, icon, onClick, disabled, big, active }: { label: string; icon: ReactNode; onClick(): void; disabled?: boolean; big?: boolean; active?: boolean }) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} className={`lxd-ribbon-action${big ? " is-big" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}
export function DocumentRibbon({ editor, surface, onImport, onExport, onImage, onTable, onLink, outline, onOutline }: {
  editor: DocumentEditor; surface: RefObject<DocumentSurfaceHandle | null>; onImport(format: "docx" | "dcon"): void; onExport(format: "docx" | "dcon"): void;
  onImage(): void; onTable(): void; onLink(): void; outline: boolean; onOutline(): void;
}) {
  const [tab, setTab] = useState("home"), scroll = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const { features, selection } = editor;
  const disabled = !editor.editable;
  const state = surface.current?.getState();
  const marks = state?.storedMarks ?? state?.selection.$from.marks() ?? [];
  const style = marks.find(mark => mark.type.name === "text_style")?.attrs ?? {};
  function track() { const node = scroll.current; if (node) setArrows({ left: node.scrollLeft > 1, right: node.scrollLeft + node.clientWidth < node.scrollWidth - 1 }); }
  useEffect(() => { const node = scroll.current; if (!node) return; const observer = new ResizeObserver(track); observer.observe(node); for (const child of node.children) observer.observe(child); track(); return () => observer.disconnect(); }, [tab, features]);
  const stepScroll = (direction: 1 | -1) => {
    const node = scroll.current; if (!node) return;
    const groups = [...node.children] as HTMLElement[];
    const edge = direction === 1 ? node.scrollLeft + node.clientWidth : node.scrollLeft;
    const group = direction === 1 ? groups.find(item => item.offsetLeft + item.offsetWidth - node.offsetLeft > edge + 1) : [...groups].reverse().find(item => item.offsetLeft - node.offsetLeft < edge - 1);
    const left = group ? direction === 1 ? group.offsetLeft - node.offsetLeft + group.offsetWidth - node.clientWidth : group.offsetLeft - node.offsetLeft : direction === 1 ? node.scrollWidth : 0;
    node.scrollTo({ left, behavior: "smooth" });
  };
  function mark(name: DocumentMarkName, attrs?: DocumentTextStyle) {
    const current = surface.current?.getState(); if (!current) return;
    if (current.selection.empty) {
      toggleMark(current.schema.marks[name], attrs)(current, transaction => surface.current?.dispatch(transaction));
    } else {
      const enabled = attrs ? true : !current.doc.rangeHasMark(selection.from, selection.to, current.schema.marks[name]);
      void editor.execute({ type: "mark.set", ...selection, mark: name, attrs, enabled });
    }
    surface.current?.focus();
  }
  function textStyle(patch: DocumentTextStyle) {
    const current = surface.current?.getState(); if (!current) return;
    if (current.selection.empty) surface.current?.dispatch(current.tr.addStoredMark(current.schema.marks.text_style.create({ ...style, ...patch })));
    else void editor.execute({ type: "mark.set", ...selection, mark: "text_style", attrs: { ...style, ...patch } });
    surface.current?.focus();
  }
  async function clipboard(mode: "copy" | "cut" | "paste") {
    const current = surface.current?.getState(); if (!current) return;
    try {
      const clipboard = window.navigator.clipboard;
      if (mode === "paste") { const text = await clipboard.readText(); if (surface.current?.getState()?.doc !== current.doc) throw new Error("文書が変更されました。貼り付けをやり直してください。"); await editor.execute({ type: "text.insert", ...selection, text }); }
      else { await clipboard.writeText(current.doc.textBetween(selection.from, selection.to, "\n")); if (mode === "cut" && surface.current?.getState()?.doc === current.doc) await editor.execute({ type: "text.delete", ...selection }); }
    } catch { editor.setNotice({ kind: "info", text: "本文内で Ctrl/Cmd+C・X・V を使ってコピー・切り取り・貼り付けしてください。" }); }
    surface.current?.focus();
  }
  const tabs = [{ id: "file", label: "ファイル" }, { id: "home", label: "ホーム" }, { id: "insert", label: "挿入" }, { id: "layout", label: "レイアウト" }, { id: "view", label: "表示" }];
  return <div className="lxd-ribbon" onMouseDown={event => { if ((event.target as Element).closest("button")) event.preventDefault(); }}>
    <div className="lxd-ribbon-tabs" role="tablist" aria-label="リボン">{tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    <div className="lxd-ribbon-strip">{arrows.left && <button type="button" className="lxd-scroll-arrow" aria-label="左のグループを表示" onClick={() => stepScroll(-1)}><ChevronLeft size={16} /></button>}
      <div ref={scroll} className="lxd-ribbon-scroll" onScroll={track}>
        {tab === "file" && <>
          {features.import && !editor.readOnly && <Group title="開く"><Action label="DCONを開く" icon={<FileJson size={23} />} big disabled={disabled} onClick={() => onImport("dcon")} /><Action label="Wordを開く" icon={<Upload size={23} />} big disabled={disabled} onClick={() => onImport("docx")} /></Group>}
          {features.export && <Group title="書き出し"><Action label="DCON" icon={<FileJson size={23} />} big disabled={!!editor.busy} onClick={() => onExport("dcon")} /><Action label="Word (.docx)" icon={<Download size={23} />} big disabled={!!editor.busy} onClick={() => onExport("docx")} /></Group>}
          <Group title="ファイル形式"><span className="lxd-ribbon-hint">標準形式は .dcon<br />Word文書は .docx</span></Group>
        </>}
        {tab === "home" && <>
          <Group title="クリップボード"><Action label="貼り付け" icon={<Clipboard size={24} />} big disabled={disabled || !features.text} onClick={() => void clipboard("paste")} /><div className="lxd-stack"><Action label="切り取り" icon={<Scissors size={15} />} disabled={disabled || !features.text || selection.from === selection.to} onClick={() => void clipboard("cut")} /><Action label="コピー" icon={<Copy size={15} />} disabled={selection.from === selection.to} onClick={() => void clipboard("copy")} /></div></Group>
          {features.formatting && <Group title="フォント"><div className="lxd-stack"><div className="lxd-row"><select aria-label="フォント" value={style.fontFamily ?? "Arial"} disabled={disabled} onChange={event => textStyle({ fontFamily: event.target.value })}>{["Arial", "Calibri", "Times New Roman", "Yu Gothic", "Meiryo"].map(font => <option key={font}>{font}</option>)}</select><select aria-label="フォントサイズ" className="lxd-font-size" value={style.fontSize ?? 11} disabled={disabled} onChange={event => textStyle({ fontSize: Number(event.target.value) })}>{[8,9,10,11,12,14,16,18,20,24,28,32,36,48,72].map(size => <option key={size}>{size}</option>)}</select></div>
            <div className="lxd-row">{([{ name: "strong", label: "太字", icon: <Bold size={17} /> }, { name: "em", label: "斜体", icon: <Italic size={17} /> }, { name: "underline", label: "下線", icon: <Underline size={17} /> }] as const).map(item => <button key={item.name} type="button" className="lxd-icon-button" title={item.label} aria-label={item.label} aria-pressed={marks.some(mark => mark.type.name === item.name)} disabled={disabled} onClick={() => mark(item.name)}>{item.icon}</button>)}
              <label className="lxd-color" title="文字色"><Type size={15} /><input type="color" aria-label="文字色" disabled={disabled} value={style.color ?? "#222222"} onChange={event => textStyle({ color: event.target.value })} /></label><label className="lxd-color" title="蛍光ペン"><span>ab</span><input type="color" aria-label="蛍光ペンの色" disabled={disabled} value={style.backgroundColor ?? "#fff2a8"} onChange={event => textStyle({ backgroundColor: event.target.value })} /></label>
            </div></div></Group>}
          {(features.formatting || features.lists) && <Group title="段落"><div className="lxd-stack">{features.lists && <div className="lxd-row"><Action label="箇条書き" icon={<List size={17} />} disabled={disabled} onClick={() => { void editor.execute({ type: "list.set", ...selection, kind: "bullet" }); surface.current?.focus(); }} /><Action label="段落番号" icon={<ListOrdered size={17} />} disabled={disabled} onClick={() => { void editor.execute({ type: "list.set", ...selection, kind: "ordered" }); surface.current?.focus(); }} /></div>}
            {features.formatting && <div className="lxd-row">{[{ value: "left", label: "左揃え", icon: <AlignLeft size={17} /> }, { value: "center", label: "中央揃え", icon: <AlignCenter size={17} /> }, { value: "right", label: "右揃え", icon: <AlignRight size={17} /> }, { value: "justify", label: "両端揃え", icon: <AlignJustify size={17} /> }].map(item => <button type="button" key={item.value} className="lxd-icon-button" title={item.label} aria-label={item.label} disabled={disabled} onClick={() => { void editor.execute({ type: "paragraph.set", ...selection, align: item.value as DocumentAlignment }); surface.current?.focus(); }}>{item.icon}</button>)}</div>}
          </div></Group>}
          {features.formatting && <Group title="スタイル">{[{ level: 0, label: "標準" }, { level: 1, label: "見出し 1" }, { level: 2, label: "見出し 2" }].map(item => <button key={item.level} className={`lxd-style-card lxd-style-${item.level}`} type="button" disabled={disabled} onClick={() => { void editor.execute({ type: "paragraph.set", ...selection, nodeType: item.level ? "heading" : "paragraph", level: item.level || 1 }); surface.current?.focus(); }}><span>Aa</span>{item.label}</button>)}</Group>}
        </>}
        {tab === "insert" && <>
          {features.pageLayout && <Group title="ページ"><Action label="改ページ" icon={<WrapText size={24} />} big disabled={disabled} onClick={() => void editor.execute({ type: "pageBreak.insert", at: selection.to })} /></Group>}
          {features.tables && <Group title="表"><Action label="表を挿入" icon={<Table2 size={24} />} big disabled={disabled} onClick={onTable} /></Group>}
          {features.images && <Group title="画像"><Action label="画像を挿入" icon={<ImagePlus size={24} />} big disabled={disabled} onClick={onImage} /></Group>}
          {features.formatting && <Group title="リンク"><Action label="リンク" icon={<Link size={24} />} big disabled={disabled || selection.from === selection.to} onClick={onLink} /></Group>}
        </>}
        {tab === "layout" && features.pageLayout && <>
          <Group title="ページ設定"><div className="lxd-stack"><label className="lxd-row">用紙 <select aria-label="用紙サイズ" disabled={disabled} value={Math.round(Math.min(editor.document.page.width, editor.document.page.height)) === 210 ? "a4" : "letter"} onChange={event => void editor.execute({ type: "document.update", page: event.target.value === "a4" ? { width: 210, height: 297 } : { width: 215.9, height: 279.4 } })}><option value="a4">A4</option><option value="letter">レター</option></select></label>
            <label className="lxd-row">向き <select aria-label="用紙の向き" disabled={disabled} value={editor.document.page.width > editor.document.page.height ? "landscape" : "portrait"} onChange={event => { const values = [editor.document.page.width, editor.document.page.height].sort((a,b) => a-b); void editor.execute({ type: "document.update", page: { width: values[event.target.value === "portrait" ? 0 : 1], height: values[event.target.value === "portrait" ? 1 : 0] } }); }}><option value="portrait">縦</option><option value="landscape">横</option></select></label></div></Group>
          <Group title="余白"><select aria-label="余白" disabled={disabled} value={editor.document.page.margins.top} onChange={event => { const n = Number(event.target.value); void editor.execute({ type: "document.update", page: { margins: { top:n, right:n, bottom:n, left:n } } }); }}><option value={20}>標準 · 20 mm</option><option value={12.7}>狭い · 12.7 mm</option><option value={25.4}>広い · 25.4 mm</option></select></Group>
        </>}
        {tab === "view" && <Group title="表示"><Action label="ナビゲーション" icon={<PanelLeft size={24} />} big active={outline} onClick={onOutline} /><span className="lxd-ribbon-hint">見出しをクリックして移動できます。</span></Group>}
      </div>{arrows.right && <button type="button" className="lxd-scroll-arrow" aria-label="右のグループを表示" onClick={() => stepScroll(1)}><ChevronRight size={16} /></button>}</div>
  </div>;
}

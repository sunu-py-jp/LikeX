"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check, CircleAlert, FileText, Loader2, Minus, Plus, Redo2, Save, Undo2, X } from "lucide-react";
import { toggleMark } from "prosemirror-commands";
import type { DocumentProps } from "./props";
import { getBlocks, getDocumentText, inspectDocumentImage, DOCUMENT_LIMITS } from "./model/index";
import { useDocumentEditor } from "./state/use-document-editor";
import { useDocumentTheme } from "./state/use-document-theme";
import { DocumentSurface, type DocumentSurfaceHandle } from "./ui/document-surface";
import { DocumentRibbon } from "./ui/document-ribbon";
import { DocumentDialog } from "./ui/document-dialog";
import { useDocumentContextMenu } from "./ui/use-document-context-menu";

/** Word-like document editing using the same commands as the headless model. */
export default function LikeDocument(props: DocumentProps) {
  const editor = useDocumentEditor(props), surface = useRef<DocumentSurfaceHandle>(null), root = useRef<HTMLDivElement | null>(null);
  const contextMenu = useDocumentContextMenu(editor, surface);
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { root.current = node; setOwnerDocument(node?.ownerDocument ?? null); }, []);
  const theme = useDocumentTheme(props.colorMode ?? "light", ownerDocument, props.primaryColor);
  const [, setViewRevision] = useState(0);
  const viewChanged = useCallback(() => setViewRevision(value => value + 1), []);
  const [zoom, setZoom] = useState(100), [outline, setOutline] = useState(true), [dialog, setDialog] = useState<"table" | "link" | null>(null);
  const nativeInput = useRef<HTMLInputElement>(null), docxInput = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null);
  const headings = useMemo(() => getBlocks(editor.document).filter(block => block.node.type === "heading"), [editor.document]);
  const textLength = useMemo(() => getDocumentText(editor.document).replace(/\s/g, "").length, [editor.document]);
  const page = editor.document.page;
  useEffect(() => {
    const win = ownerDocument?.defaultView;
    if (!win || !editor.dirty || props.warnOnUnsavedChanges === false) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    win.addEventListener("beforeunload", guard); return () => win.removeEventListener("beforeunload", guard);
  }, [editor.dirty, props.warnOnUnsavedChanges, ownerDocument]);
  useEffect(() => {
    const node = root.current; if (!node) return;
    const wheel = (event: WheelEvent) => { if (event.ctrlKey && (event.target as Element).closest(".lxd-document-viewport")) { event.preventDefault(); setZoom(value => Math.max(50, Math.min(200, value + (event.deltaY < 0 ? 5 : -5)))); } };
    node.addEventListener("wheel", wheel, { passive: false }); return () => node.removeEventListener("wheel", wheel);
  }, []);
  function openFile(format: "docx" | "dcon") {
    if (editor.dirty && !ownerDocument?.defaultView?.confirm("現在の文書を読み込むファイルで置き換えますか？元に戻す操作で復元できます。")) return;
    (format === "docx" ? docxInput : nativeInput).current?.click();
  }
  async function download(format: "docx" | "dcon") {
    try {
      const blob = await editor.exportFile(format); if (!ownerDocument || !root.current?.isConnected) return;
      const url = URL.createObjectURL(blob), anchor = ownerDocument.createElement("a");
      anchor.href = url; anchor.download = `${(props.exportFileName ?? editor.document.title).replace(/\.(dcon|json|docx)$/i, "").replace(/[\\/:*?"<>|]/g, "_") || "Document"}.${format}`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { editor.error(cause); }
  }
  async function insertImage(file: File) {
    const before = editor.session.getSnapshot().document, selection = { ...editor.selection };
    try {
      if (file.size > DOCUMENT_LIMITS.imageBytes) throw new Error("画像は8 MB以下で指定してください。");
      const src = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("画像を読み込めませんでした。")); reader.readAsDataURL(file); });
      const dimensions = inspectDocumentImage(src);
      if (!root.current?.isConnected || editor.session.getSnapshot().document !== before) throw new Error("文書が変更されました。画像を選び直してください。");
      const width = Math.min(dimensions.width, (page.width - page.margins.left - page.margins.right) * 96 / 25.4);
      await editor.execute({ type: "image.insert", at: selection.to, src, alt: file.name, width, height: dimensions.height * width / dimensions.width });
    } catch (cause) { editor.error(cause); }
  }
  return <div ref={attach} data-likex-document="" className={`lxd-root ${props.className ?? ""}`} style={{ ...theme, ...props.style }} role="region" aria-label={props["aria-label"] ?? "文書エディター"} onKeyDownCapture={event => {
    const target = event.target as HTMLElement;
    if (event.nativeEvent.isComposing || target.closest(".lxd-dialog")) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (!mod) return;
    if (target.closest("input:not([type=color]):not([type=range]):not([type=checkbox]),textarea") && key !== "s") return;
    if (key === "s") { event.preventDefault(); event.stopPropagation(); void editor.save(); }
    else if (key === "z" || key === "y") { event.preventDefault(); event.stopPropagation(); void editor.history(key === "y" || event.shiftKey ? "redo" : "undo"); }
    else if (["b", "i", "u"].includes(key) && editor.editable && editor.features.formatting) {
      const state = surface.current?.getState(); if (!state) return;
      event.preventDefault(); event.stopPropagation(); const mark = key === "b" ? "strong" : key === "i" ? "em" : "underline";
      toggleMark(state.schema.marks[mark])(state, transaction => surface.current?.dispatch(transaction));
    }
  }}>
    <header className="lxd-titlebar"><FileText className="lxd-document-mark" size={23} /><span className="lxd-document-title">{props.title ?? editor.document.title}</span>
      {!editor.readOnly && editor.features.history && <div className="lxd-quick-actions"><button type="button" title="元に戻す (Ctrl/Cmd+Z)" aria-label="元に戻す" disabled={!editor.canUndo || !editor.editable} onClick={() => void editor.history("undo")}><Undo2 size={17} /></button><button type="button" title="やり直す (Ctrl/Cmd+Shift+Z)" aria-label="やり直す" disabled={!editor.canRedo || !editor.editable} onClick={() => void editor.history("redo")}><Redo2 size={17} /></button></div>}
      <div className="lxd-titlebar-end">{!editor.readOnly && <button type="button" className="lxd-save" disabled={!editor.dirty || !!editor.busy} onClick={() => void editor.save()}>{editor.busy === "save" ? <Loader2 className="lxd-spin" size={15} /> : <Save size={15} />}保存</button>}<span>LikeX</span></div>
    </header>
    <DocumentRibbon editor={editor} surface={surface} onImport={openFile} onExport={format => void download(format)} onImage={() => imageInput.current?.click()} onTable={() => setDialog("table")} onLink={() => setDialog("link")} outline={outline} onOutline={() => setOutline(value => !value)} />
    <div className="lxd-workspace">
      {outline && <aside className="lxd-navigation" aria-label="見出しナビゲーション"><h2>ナビゲーション</h2><div className="lxd-navigation-label">見出し</div>{headings.length ? headings.map(block => <button type="button" key={block.id} style={{ paddingLeft: 14 + ((block.node.type === "heading" ? block.node.attrs?.level ?? 1 : 1) - 1) * 12 }} onClick={() => {
        editor.select({ from: block.contentFrom, to: block.contentFrom }); surface.current?.focus();
        root.current?.querySelector<HTMLElement>(`[data-document-id="${CSS.escape(block.id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      }}>{block.node.type === "heading" ? block.node.content?.map(node => node.type === "text" ? node.text : "").join("") : ""}</button>) : <p>見出しを設定すると、ここに表示されます。</p>}</aside>}
      <div className="lxd-document-viewport" tabIndex={0} aria-label="文書の表示領域" {...contextMenu}><div className="lxd-page-frame" style={{ zoom: zoom / 100, "--lxd-page-width": `${page.width}mm`, "--lxd-page-height": `${page.height}mm`, "--lxd-margin-top": `${page.margins.top}mm`, "--lxd-margin-right": `${page.margins.right}mm`, "--lxd-margin-bottom": `${page.margins.bottom}mm`, "--lxd-margin-left": `${page.margins.left}mm` } as CSSProperties}>
        <div className="lxd-ruler" aria-hidden="true"><span>0</span><span>2</span><span>4</span><span>6</span><span>8</span><span>10</span><span>12</span><span>14</span><span>16</span></div>
        <DocumentSurface editor={editor} surfaceRef={surface} onViewChange={viewChanged} />
      </div></div>
    </div>
    <footer className="lxd-statusbar"><span>{textLength.toLocaleString()} 文字</span>{editor.readOnly && <span>読み取り専用</span>}
      <div className="lxd-status-message" role="status" aria-live="polite">{editor.busy ? <><Loader2 size={14} className="lxd-spin" /><span>{({ save: "保存しています…", import: "読み込んでいます…", export: "書き出しています…", permission: "編集の許可を確認しています…" })[editor.busy]}</span></> : editor.notice && <>{editor.notice.kind === "error" ? <CircleAlert size={14} /> : editor.notice.kind === "success" ? <Check size={14} /> : null}<span title={editor.notice.text}>{editor.notice.text}</span><button type="button" aria-label="メッセージを閉じる" onClick={() => editor.setNotice(null)}><X size={13} /></button></>}</div>
      <div className="lxd-zoom"><button type="button" aria-label="縮小" onClick={() => setZoom(value => Math.max(50,value - 10))}><Minus size={14} /></button><input aria-label="ズーム" type="range" min={50} max={200} step={5} value={zoom} onChange={event => setZoom(Number(event.target.value))} /><button type="button" aria-label="拡大" onClick={() => setZoom(value => Math.min(200,value + 10))}><Plus size={14} /></button><button type="button" aria-label="100%に戻す" onClick={() => setZoom(100)}>{zoom}%</button></div>
    </footer>
    <input ref={nativeInput} hidden type="file" accept=".dcon,application/json" aria-label="DCONファイルを選択" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void editor.importFile(file, "dcon"); }} />
    <input ref={docxInput} hidden type="file" accept=".docx" aria-label="Wordファイルを選択" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void editor.importFile(file, "docx"); }} />
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" aria-label="挿入する画像を選択" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void insertImage(file); }} />
    {dialog && <DocumentDialog title={dialog === "table" ? "表の挿入" : "リンクの挿入"} onClose={() => setDialog(null)} onSubmit={data => {
      if (dialog === "table") void editor.execute({ type: "table.insert", at: editor.selection.to, rows: Number(data.get("rows")), columns: Number(data.get("columns")), header: data.get("header") === "on" });
      else void editor.execute({ type: "mark.set", ...editor.selection, mark: "link", attrs: { href: String(data.get("url")) } });
      setDialog(null); surface.current?.focus();
    }}>{dialog === "table" ? <><label>列数<input name="columns" type="number" min={1} max={20} defaultValue={3} required /></label><label>行数<input name="rows" type="number" min={1} max={100} defaultValue={3} required /></label><label className="lxd-checkbox"><input type="checkbox" name="header" defaultChecked />先頭行をヘッダーにする</label></> : <label>URL<input type="url" name="url" placeholder="https://example.com" required /></label>}</DocumentDialog>}
  </div>;
}

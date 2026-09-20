"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, CircleAlert, Loader2, Maximize, Minus, MonitorPlay, Plus, Redo2, Save, Undo2, X } from "lucide-react";
import type { SlideProps } from "./props";
import { createSlideElement, SLIDE_LIMITS } from "./model/index";
import { useSlideEditor } from "./state/use-slide-editor";
import { useSlideTheme } from "./state/use-slide-theme";
import { useSlideInputTracking } from "./state/use-slide-input-tracking";
import { SlideCanvas } from "./ui/slide-canvas";
import { SlideFilmstrip } from "./ui/slide-filmstrip";
import { SlideProperties } from "./ui/slide-properties";
import { SlidePresentation } from "./ui/slide-presentation";
import { SlideRibbon } from "./ui/slide-ribbon";

async function imageData(file: File, ownerDocument: Document) {
  if (file.size > SLIDE_LIMITS.imageBytes) throw new Error("画像は10 MB以下で指定してください。");
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" } as Record<string, string>)[extension ?? ""];
  if (!mime) throw new Error("PNG、JPEG、GIF、WebP画像を選択してください。");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    reader.readAsDataURL(file.slice(0, file.size, mime));
  });
  // The model checks signature, byte size and pixel limits before browser decoding.
  createSlideElement({ type: "image", src });
  return new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const image = ownerDocument.createElement("img");
    image.onload = () => resolve({ src, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("画像を読み込めませんでした。")); image.src = src;
  });
}

/** PowerPoint-style UI backed exclusively by the public headless command model. */
export default function LikeSlide(props: SlideProps) {
  const editor = useSlideEditor(props);
  const root = useRef<HTMLDivElement | null>(null);
  const [ownerDocument, setOwnerDocument] = useState<Document | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { root.current = node; setOwnerDocument(node?.ownerDocument ?? null); }, []);
  const theme = useSlideTheme(props.colorMode, ownerDocument, props.primaryColor);
  const [zoom, setZoom] = useState(100);
  const [propertiesOpen, setPropertiesOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  const [presenting, setPresenting] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null), pptxInput = useRef<HTMLInputElement>(null), nativeInput = useRef<HTMLInputElement>(null);
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId);
  const slideIndex = editor.deck.slides.findIndex(item => item.id === editor.selection.slideId);
  const adjustZoom = (value: number) => setZoom(Math.max(25, Math.min(200, Math.round(value))));
  const inputTracking = useSlideInputTracking(root, editor);

  useEffect(() => {
    const view = ownerDocument?.defaultView;
    if (!view || !editor.dirty || props.warnOnUnsavedChanges === false) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    view.addEventListener("beforeunload", prevent); return () => view.removeEventListener("beforeunload", prevent);
  }, [editor.dirty, ownerDocument, props.warnOnUnsavedChanges]);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => { if (!event.ctrlKey || !(event.target as Element)?.closest?.(".lxp-canvas-viewport")) return; event.preventDefault(); setZoom(value => Math.max(25, Math.min(200, value + (event.deltaY > 0 ? -5 : 5)))); };
    node.addEventListener("wheel", wheel, { passive: false }); return () => node.removeEventListener("wheel", wheel);
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    const editing = target.closest("input:not([type=color]):not([type=range]):not([type=checkbox]),textarea,[contenteditable=true]");
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "s") { event.preventDefault(); void editor.save(); return; }
    if (editing) return;
    const key = event.key.toLowerCase();
    if (modifier && key === "z") { event.preventDefault(); void editor.history(event.shiftKey ? "redo" : "undo"); }
    else if (modifier && key === "y") { event.preventDefault(); void editor.history("redo"); }
    else if (modifier && key === "c") { event.preventDefault(); editor.copyElements(); }
    else if (modifier && key === "v") { event.preventDefault(); void editor.pasteElements(); }
    else if (modifier && key === "x" && slide && editor.editable) { event.preventDefault(); editor.copyElements(); void editor.execute({ type: "element.delete", slideId: slide.id, elementIds: editor.selection.elementIds }); }
    else if (modifier && key === "a" && slide) { event.preventDefault(); editor.select({ slideId: slide.id, elementIds: slide.elements.map(element => element.id) }); }
    else if (modifier && key === "d" && slide) { event.preventDefault(); if (editor.selection.elementIds.length) void editor.execute({ type: "element.duplicate", slideId: slide.id, elementIds: editor.selection.elementIds }); else void editor.execute({ type: "slide.duplicate", slideId: slide.id }); }
    else if ((key === "delete" || key === "backspace") && slide && editor.selection.elementIds.length) { event.preventDefault(); void editor.execute({ type: "element.delete", slideId: slide.id, elementIds: editor.selection.elementIds }); }
    else if (key === "escape" && slide) editor.select({ slideId: slide.id, elementIds: [] });
    else if (key === "f5" && editor.features.presentation) { event.preventDefault(); setPresenting(true); }
    else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) && slide && editor.selection.elementIds.length && editor.editable && editor.features.formatting) {
      event.preventDefault(); const step = event.shiftKey ? 10 : 1;
      void editor.execute(slide.elements.filter(element => editor.selection.elementIds.includes(element.id) && !element.locked).map(element => ({ type: "element.update", slideId: slide.id, elementId: element.id,
        patch: { x: element.x + (key === "arrowright" ? step : key === "arrowleft" ? -step : 0), y: element.y + (key === "arrowdown" ? step : key === "arrowup" ? -step : 0) } })));
    }
  };
  const importFile = (format: "pptx" | "slon") => {
    if (editor.dirty && !ownerDocument?.defaultView?.confirm("現在のスライドを読み込むファイルで置き換えますか？変更は元に戻す操作で復元できます。")) return;
    (format === "pptx" ? pptxInput : nativeInput).current?.click();
  };
  return <div ref={attach} data-likex-slide="" className={`lxp-root ${props.className ?? ""}`} style={{ ...theme, ...props.style }} role="region" aria-label={props["aria-label"] ?? "スライド エディター"} tabIndex={-1} onKeyDown={keyDown} {...inputTracking}>
    <header className="lxp-titlebar"><div className="lxp-document-mark" aria-hidden="true">P</div><span className="lxp-document-title">{props.title ?? editor.deck.title}</span>
      <div className="lxp-quick-actions">
        {editor.features.history && !editor.readOnly && <><button type="button" title="元に戻す (Ctrl+Z)" aria-label="元に戻す" disabled={!editor.canUndo || !editor.editable} onClick={() => void editor.history("undo")}><Undo2 size={17} /></button>
          <button type="button" title="やり直す (Ctrl+Y)" aria-label="やり直す" disabled={!editor.canRedo || !editor.editable} onClick={() => void editor.history("redo")}><Redo2 size={17} /></button></>}
      </div>
      <div className="lxp-titlebar-end">
        {editor.features.presentation && <button type="button" className="lxp-title-action" disabled={!slide} onClick={() => setPresenting(true)}><MonitorPlay size={16} /><span>スライドショー</span></button>}
        {!editor.readOnly && <button type="button" className="lxp-save" disabled={!!editor.busy} onClick={() => void editor.save()}>{editor.busy === "save" ? <Loader2 size={15} className="lxp-spin" /> : <Save size={15} />}保存</button>}
      </div>
      <span className="lxp-title-context">LikeX</span>
    </header>
    <SlideRibbon editor={editor} onImage={() => imageInput.current?.click()} onImport={importFile} onPresent={() => setPresenting(true)} propertiesOpen={propertiesOpen} notesOpen={notesOpen}
      onProperties={() => setPropertiesOpen(value => !value)} onNotes={() => setNotesOpen(value => !value)} onFit={() => setZoom(100)} ownerDocument={ownerDocument} />
    <div className="lxp-workspace"><SlideFilmstrip editor={editor} /><div className="lxp-slide-workspace"><SlideCanvas key={slide?.id} deck={editor.deck} slide={slide} editor={editor} zoom={zoom} />
      {editor.features.notes && notesOpen && <div className="lxp-notes"><label htmlFor={`${editor.deck.id}-notes`}>ノート</label><textarea key={`${slide?.id}:${slide?.notes}`} id={`${editor.deck.id}-notes`} aria-label="発表者ノート" defaultValue={slide?.notes ?? ""} placeholder="クリックしてノートを入力" disabled={!editor.editable || !slide}
        onBlur={event => {
          const notes = event.target.value;
          if (slide && notes !== slide.notes) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { notes } });
          // An edit can be rejected asynchronously without changing the model/key.
          event.target.value = slide?.notes ?? "";
        }} /></div>}
    </div>{propertiesOpen && <SlideProperties editor={editor} onClose={() => setPropertiesOpen(false)} />}</div>
    <footer className="lxp-statusbar"><span>スライド {Math.max(0, slideIndex + 1)} / {editor.deck.slides.length}</span>
      {editor.readOnly && <span className="lxp-readonly-label">読み取り専用</span>}
      <div className="lxp-status-message" role="status" aria-live="polite">{editor.busy || editor.requesting ? <><Loader2 size={13} className="lxp-spin" />{editor.requesting ? "編集の許可を確認しています…" : editor.busy === "save" ? "保存しています…" : editor.busy === "import" ? "読み込んでいます…" : "書き出しています…"}</>
        : editor.notice ? <><span className={editor.notice.kind === "error" ? "lxp-error" : ""}>{editor.notice.kind === "success" ? <Check size={13} /> : editor.notice.kind === "error" ? <CircleAlert size={13} /> : null}</span><span className="lxp-status-text" title={editor.notice.text}>{editor.notice.text}</span><button type="button" aria-label="メッセージを閉じる" onClick={() => editor.setNotice(null)}><X size={12} /></button></> : editor.selection.elementIds.length ? `${editor.selection.elementIds.length} 個のオブジェクトを選択` : null}</div>
      <div className="lxp-zoom"><button type="button" aria-label="縮小" onClick={() => adjustZoom(zoom - 10)}><Minus size={14} /></button><input type="range" min={25} max={200} step={5} aria-label="ズーム" value={zoom} onChange={event => adjustZoom(Number(event.target.value))} /><button type="button" aria-label="拡大" onClick={() => adjustZoom(zoom + 10)}><Plus size={14} /></button><span>{zoom}%</span><button type="button" aria-label="画面に合わせる" onClick={() => setZoom(100)}><Maximize size={14} /></button></div>
    </footer>
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="挿入する画像" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file || !slide || !ownerDocument) return;
      const slideId = slide.id, deckWidth = editor.deck.width, deckHeight = editor.deck.height;
      void editor.prepareCommands(async () => { const image = await imageData(file, ownerDocument); const scale = Math.min(1, deckWidth * .7 / image.width, deckHeight * .7 / image.height); const width = image.width * scale, height = image.height * scale;
        return { type: "element.add", slideId, element: { type: "image", name: file.name, src: image.src, alt: file.name, x: (deckWidth - width) / 2, y: (deckHeight - height) / 2, width, height } }; });
    }} />
    <input ref={pptxInput} hidden type="file" accept=".pptx" aria-label="読み込むPowerPointファイル" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void editor.importPptx(file); }} />
    <input ref={nativeInput} hidden type="file" accept=".slon,.json,application/json" aria-label="読み込むLikeSlideファイル" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      // UTF-8 can use three bytes per JavaScript string code unit. The parser
      // separately enforces jsonLength after decoding, including ASCII files.
      if (file.size > SLIDE_LIMITS.jsonLength * 3) editor.reportError(new Error("LikeSlideファイルが大きすぎます。"));
      else void file.text().then(editor.importJson).catch(editor.reportError);
    }} />
    {presenting && editor.features.presentation && ownerDocument && <SlidePresentation deck={editor.deck} initialSlideId={editor.selection.slideId} ownerDocument={ownerDocument} theme={{ ...theme, ...props.style }} onClose={() => setPresenting(false)} />}
  </div>;
}

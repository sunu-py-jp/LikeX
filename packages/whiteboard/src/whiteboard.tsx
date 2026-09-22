"use client";
import { useEffect, useLayoutEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { ArrowDownToLine, ArrowUpToLine, Circle, Download, Hand, ImagePlus, Loader2, Maximize, Minus, MousePointer2, Plus, Redo2, Save, Square, StickyNote, Trash2, Type, Undo2, Upload } from "lucide-react";
import { createPrimaryColorPalette, inspectEmbeddedImage } from "./core";
import { openContextMenu, type ContextMenuAction } from "./browser";
import { WHITEBOARD_LIMITS, createWhiteboardElement, exportWhiteboardSvg, getWhiteboardBounds, parseWhiteboard, serializeWhiteboard, type WhiteboardCommand, type WhiteboardElement, type WhiteboardModel } from "./model/index";
import { useWhiteboard } from "./state/use-whiteboard";
import type { WhiteboardProps } from "./props";
import { startDragEdgeMotion } from "./ui/drag-scroll";
import { WhiteboardElementView } from "./ui/whiteboard-element";

type Drag = { kind: "pan" | "move" | "resize"; clientX: number; clientY: number; ids: string[]; id?: string; corner?: string; model: WhiteboardModel; pan: { x: number; y: number }; dx: number; dy: number; lastX: number; lastY: number; offsetX: number; offsetY: number; scale: number; pointerId: number; stop(): void };
export default function LikeWhiteboard({ ref: externalRef, ...props }: WhiteboardProps) {
  const editor = useWhiteboard(props), { controller, model, features } = editor;
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), input = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null), label = useRef<HTMLTextAreaElement>(null);
  const [selectionIds, setSelected] = useState<string[]>([]), [tool, setTool] = useState<"select" | "pan">("select");
  const [pan, setPan] = useState({ x: 0, y: 0 }), [zoom, setZoom] = useState(1), [viewport, setViewport] = useState({ width: 1000, height: 620 }), [drag, setDrag] = useState<Drag | null>(null), [systemDark, setSystemDark] = useState(false);
  const dragRef = useRef<Drag | null>(null), gridId = `lxw-grid-${useId().replace(/:/g, "")}`;
  const dark = props.colorMode === "dark" || props.colorMode === "system" && systemDark, palette = createPrimaryColorPalette(props.primaryColor ?? "#806a46", dark ? "dark" : "light") ?? createPrimaryColorPalette("#496a8f", dark ? "dark" : "light")!;
  const canvasAccent = createPrimaryColorPalette(props.primaryColor ?? "#496a8f", "light")?.accent ?? "#496a8f";
  const availableIds = new Set(model.elements.map(item => item.id)), selected = selectionIds.filter(id => availableIds.has(id));
  const selectedElement = model.elements.find(element => selected.includes(element.id));
  const select = (ids: readonly string[]) => { const all = new Set(controller.getModel().elements.map(item => item.id)); const next = [...new Set(ids)].filter(id => all.has(id)); setSelected(next); try { props.onSelectionChange?.(next); } catch { /* Observer. */ } };
  const fail = (cause: unknown) => controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "操作できませんでした。" });
  const importJson = (value: string | Blob) => controller.prepare(async () => { if (typeof value !== "string" && value.size > WHITEBOARD_LIMITS.jsonLength * 3) throw new Error("ファイルのサイズが上限を超えています。"); return { type: "whiteboard.replace" as const, model: parseWhiteboard(typeof value === "string" ? value : await value.text()) }; }, { feature: "import" });
  const exportJson = () => { if (!controller.getSnapshot().features.export) throw new Error("書き出しは無効です。"); return serializeWhiteboard(controller.getModel()); };
  const exportSvg = () => { if (!controller.getSnapshot().features.export) throw new Error("書き出しは無効です。"); return exportWhiteboardSvg(controller.getModel()); };
  useImperativeHandle(externalRef, () => ({ getModel: controller.getModel, execute: controller.execute, select, getSelection: () => selected, undo: controller.undo, redo: controller.redo, save: controller.save, discard: controller.discard, importJson, exportJson, exportSvg }));
  useEffect(() => { const el = svg.current; if (!el) return; const observer = new ResizeObserver(() => { const bounds = el.getBoundingClientRect(); setViewport({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { const media = root.current?.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)"); if (!media) return; const changed = () => setSystemDark(media.matches); changed(); media.addEventListener("change", changed); return () => media.removeEventListener("change", changed); }, []);
  useEffect(() => { const win = root.current?.ownerDocument.defaultView; if (!win || !editor.dirty || props.warnOnUnsavedChanges === false) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; win.addEventListener("beforeunload", guard); return () => win.removeEventListener("beforeunload", guard); }, [editor.dirty, props.warnOnUnsavedChanges]);
  const [inspectorFocus, setInspectorFocus] = useState<{ id: string } | null>(null);
  useEffect(() => { if (inspectorFocus && selectedElement?.id === inspectorFocus.id) label.current?.focus(); }, [inspectorFocus, selectedElement?.id]);
  const closeMenu = useRef<(() => void) | undefined>(undefined), contextPolicy = JSON.stringify(features);
  useLayoutEffect(() => { closeMenu.current?.(); return () => closeMenu.current?.(); }, [model, editor.editable, contextPolicy]);
  const focusLabel = (id: string) => { select([id]); setInspectorFocus({ id }); };
  const imagePlacement = useRef<{ model: WhiteboardModel; point?: { x: number; y: number } } | null>(null);
  function fitCanvas() { const bounds = getWhiteboardBounds(controller.getModel()); setZoom(Math.min(2, Math.max(.1, Math.min(viewport.width / bounds.width, viewport.height / bounds.height)))); setPan({ x: bounds.x, y: bounds.y }); }
  function contextMenu(event: MouseEvent<Element>, element?: WhiteboardElement) {
    if (event.shiftKey) return;
    if ((event.target as Element).closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (!element && (event.target as Element).closest?.("[data-element-id]")) return;
    const anchor = root.current; if (!anchor) return;
    cancelDrag();
    const snapshot = controller.getSnapshot(), expected = snapshot.model, flags = snapshot.features;
    const ids = element ? selected.includes(element.id) ? [...selected] : [element.id] : [];
    if (element) select(ids); else select([]);
    const items: ContextMenuAction[] = [], disabled = !snapshot.editable;
    const run = (action: () => unknown) => () => controller.getModel() === expected ? action() : undefined;
    const command = (value: WhiteboardCommand | WhiteboardCommand[]) => run(() => controller.execute(value));
    if (element && flags.elements) {
      items.push({ id: "edit", label: element.kind === "image" ? "代替テキストを編集" : "テキストを編集", disabled, onSelect: run(() => { if (controller.getSnapshot().editable && controller.getSnapshot().features.elements) focusLabel(element.id); }) });
      if (flags.images || !expected.elements.some(item => ids.includes(item.id) && item.kind === "image")) items.push({ id: "duplicate", label: "複製", disabled, onSelect: run(async () => {
        const copies = expected.elements.filter(item => ids.includes(item.id)).map(item => createWhiteboardElement({ ...item, id: undefined, x: item.x + 24, y: item.y + 24 }));
        const result = await controller.execute(copies.map(copy => ({ type: "element.add" as const, element: copy })));
        if (result) select(copies.map(copy => copy.id));
      }) });
      items.push({ id: "front", label: "最前面へ", disabled, separatorBefore: true, onSelect: command({ type: "elements.order", ids, position: "front" }) }, { id: "back", label: "最背面へ", disabled, onSelect: command({ type: "elements.order", ids, position: "back" }) });
      if (flags.move && ids.length > 1) items.push({ id: "align-left", label: "左揃え", disabled, onSelect: command({ type: "elements.align", ids, alignment: "left" }) });
      items.push({ id: "delete", label: "削除", disabled, danger: true, separatorBefore: true, shortcut: "Delete", onSelect: command({ type: "element.remove", ids }) });
    }
    if (!element) {
      const bounds = svg.current?.getBoundingClientRect(), point = event.clientX || event.clientY ? { x: pan.x + (event.clientX - (bounds?.left ?? 0)) / zoom, y: pan.y + (event.clientY - (bounds?.top ?? 0)) / zoom } : undefined;
      if (flags.elements) {
        for (const [kind, text] of [["sticky", "付箋を追加"], ["text", "テキストを追加"], ["rectangle", "四角を追加"], ["ellipse", "楕円を追加"]] as const) items.push({ id: `add-${kind}`, label: text, disabled, onSelect: run(() => add(kind, point)) });
        if (flags.images) items.push({ id: "add-image", label: "画像を追加", disabled, onSelect: run(() => { if (!controller.getSnapshot().editable || !controller.getSnapshot().features.images || !controller.getSnapshot().features.elements) return; imagePlacement.current = { model: expected, point }; imageInput.current?.click(); }) });
      }
      if (flags.history) items.push({ id: "undo", label: "元に戻す", disabled: disabled || !snapshot.canUndo, separatorBefore: true, onSelect: run(controller.undo) }, { id: "redo", label: "やり直す", disabled: disabled || !snapshot.canRedo, onSelect: run(controller.redo) });
      items.push({ id: "select-all", label: "すべて選択", disabled: !expected.elements.length, separatorBefore: true, onSelect: run(() => select(expected.elements.map(item => item.id))) }, { id: "fit", label: "全体を表示", onSelect: fitCanvas });
    }
    if (!items.length) return;
    event.preventDefault(); event.stopPropagation();
    closeMenu.current = openContextMenu({ anchor, x: event.clientX, y: event.clientY, items, onError: fail, onClose: () => { closeMenu.current = undefined; } });
  }
  function begin(event: PointerEvent<SVGElement>, element?: WhiteboardElement, corner?: string) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation(); root.current?.focus();
    let ids = selected;
    if (element && tool !== "pan") { ids = event.shiftKey ? selected.includes(element.id) ? selected.filter(id => id !== element.id) : [...selected, element.id] : selected.includes(element.id) ? selected : [element.id]; select(ids); }
    else if (tool !== "pan" && !event.shiftKey) select([]);
    const kind = !element || tool === "pan" || event.button === 1 ? "pan" : corner ? "resize" : "move";
    if (kind !== "pan" && (!ids.length || !editor.editable || !features.elements || !features[kind])) return;
    const next: Drag = { kind, clientX: event.clientX, clientY: event.clientY, ids, id: element?.id, corner, model: controller.getModel(), pan, dx: 0, dy: 0, lastX: event.clientX, lastY: event.clientY, offsetX: 0, offsetY: 0, scale: zoom, pointerId: event.pointerId, stop() {} };
    dragRef.current?.stop(); dragRef.current = next;
    const canvas = svg.current, win = canvas?.ownerDocument.defaultView;
    if (!canvas || !win) { setDrag(next); return; }
    const cancel = () => { if (dragRef.current === next || dragRef.current?.pointerId === next.pointerId) cancelDrag(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    const end = (event: globalThis.PointerEvent) => { if (event.pointerId === next.pointerId) finish(event); };
    const lose = (event: globalThis.PointerEvent) => { if (event.pointerId === next.pointerId) cancel(); };
    const valid = () => { const current = dragRef.current, state = controller.getSnapshot(); if (current && (state.model !== current.model || current.kind !== "pan" && (!state.editable || !state.features.elements || !state.features[current.kind]))) cancel(); };
    const unsubscribe = controller.subscribe(valid);
    const stopMotion = startDragEdgeMotion(canvas, () => { const current = dragRef.current; return current && current.kind !== "pan" && Math.abs(current.dx) + Math.abs(current.dy) > 3 / current.scale ? { x: current.lastX, y: current.lastY } : null; }, (dx, dy) => {
      const current = dragRef.current; if (!current || current.kind === "pan") return; valid(); if (!dragRef.current) return;
      const offsetX = Math.max(-99000, Math.min(99000, current.pan.x + current.offsetX + dx / current.scale)) - current.pan.x, offsetY = Math.max(-99000, Math.min(99000, current.pan.y + current.offsetY + dy / current.scale)) - current.pan.y;
      const moved = { ...current, offsetX, offsetY, dx: (current.lastX - current.clientX) / current.scale + offsetX, dy: (current.lastY - current.clientY) / current.scale + offsetY };
      dragRef.current = moved; setDrag(moved); setPan({ x: current.pan.x + offsetX, y: current.pan.y + offsetY });
    });
    next.stop = () => { stopMotion(); unsubscribe(); win.removeEventListener("pointerup", end); win.removeEventListener("pointercancel", lose); win.removeEventListener("keydown", key, true); win.removeEventListener("blur", cancel); canvas.removeEventListener("lostpointercapture", lose); if (canvas.hasPointerCapture?.(next.pointerId)) canvas.releasePointerCapture(next.pointerId); };
    win.addEventListener("pointerup", end); win.addEventListener("pointercancel", lose); win.addEventListener("keydown", key, true); win.addEventListener("blur", cancel); canvas.addEventListener("lostpointercapture", lose); canvas.setPointerCapture?.(event.pointerId); setDrag(next);

  }
  function preview(element: WhiteboardElement, current = drag): WhiteboardElement {
    if (!current || !current.ids.includes(element.id) || current.kind === "pan") return element;
    if (current.kind === "move") return { ...element, x: element.x + current.dx, y: element.y + current.dy };
    if (current.id !== element.id) return element;
    const west = current.corner?.includes("w"), north = current.corner?.includes("n");
    let width = Math.max(20, element.width + (west ? -current.dx : current.dx)), height = Math.max(20, element.height + (north ? -current.dy : current.dy));
    if (element.kind === "image") { const ratio = element.width / element.height; if (Math.abs(current.dx) >= Math.abs(current.dy)) height = width / ratio; else width = height * ratio; }
    return { ...element, width, height, x: west ? element.x + element.width - width : element.x, y: north ? element.y + element.height - height : element.y };
  }
  function cancelDrag() { const current = dragRef.current; dragRef.current = null; current?.stop(); setDrag(null); }
  useEffect(() => () => { const current = dragRef.current; dragRef.current = null; current?.stop(); }, []);
  function finish(event?: Pick<globalThis.PointerEvent, "pointerId" | "clientX" | "clientY">) {
    let current = dragRef.current;
    if (current && event && event.pointerId !== current.pointerId) return;
    if (current && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      current = { ...current, lastX: event.clientX, lastY: event.clientY,
        dx: (event.clientX - current.clientX) / current.scale + current.offsetX,
        dy: (event.clientY - current.clientY) / current.scale + current.offsetY };
      if (current.kind === "pan") setPan({ x: current.pan.x - current.dx, y: current.pan.y - current.dy });
    }
    dragRef.current = null; current?.stop();
    if (current && current.model === controller.getModel() && (current.dx || current.dy)) {
      if (current.kind === "move") void controller.execute({ type: "elements.move", ids: current.ids, dx: current.dx, dy: current.dy });
      else if (current.kind === "resize") { const element = model.elements.find(element => element.id === current.id); if (element) { const next = preview(element,current); void controller.execute({ type: "element.update", id: element.id, patch: { x: next.x, y: next.y, width: next.width, height: next.height } }); } }
    }
    setDrag(null);
  }
  function remove() { const ids = selected.filter(id => model.elements.some(element => element.id === id)); if (ids.length) void controller.execute({ type: "element.remove", ids }); }
  function add(kind: Exclude<WhiteboardElement["kind"],"image">, point?: { x: number; y: number }) { const element = createWhiteboardElement({ kind, x: point?.x ?? pan.x + viewport.width / zoom / 2 - 110, y: point?.y ?? pan.y + viewport.height / zoom / 2 - 90 }); return controller.execute({ type: "element.add", element }).then(result => { if (result) select([element.id]); }); }
  async function insertImage(file: File) {
    const placement = imagePlacement.current; imagePlacement.current = null;
    if (placement && placement.model !== controller.getModel()) return;
    const x = placement?.point?.x ?? pan.x + 80, y = placement?.point?.y ?? pan.y + 80;
    await controller.prepare(async (_model, { signal }) => {
      if (file.size > WHITEBOARD_LIMITS.imageBytes) throw new Error("画像は8 MiB以下のPNGまたはJPEGを選択してください。");
      const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
      let binary = ""; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      const mime = file.type || (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg"), src = `data:${mime};base64,${btoa(binary)}`;
      inspectEmbeddedImage(src);
      return { type: "element.add", element: { kind: "image", src, alt: file.name, x, y } };
    }, { feature: "images" });
  }
  function download(format: "json" | "svg") { try { const blob = new Blob([format === "json" ? exportJson() : exportSvg()], { type: format === "json" ? "application/json" : "image/svg+xml" }), url = URL.createObjectURL(blob), anchor = root.current!.ownerDocument.createElement("a"); anchor.href = url; anchor.download = `${model.title.replace(/[\\/:*?"<>|]/g, "_") || "Whiteboard"}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (cause) { fail(cause); } }
  return <div ref={root} tabIndex={0} data-likex-whiteboard="" className={`lxw-root ${dark ? "lxw-dark" : ""} ${props.className ?? ""}`} style={{ "--lxw-primary": palette?.primary, "--lxw-on-primary": palette?.onPrimary, "--lxw-accent": palette.accent, ...props.style } as CSSProperties} aria-label={props["aria-label"] ?? "ホワイトボードエディター"} onContextMenu={event => { if (event.target === event.currentTarget) contextMenu(event, selectedElement); }} onKeyDown={event => { if ((event.target as HTMLElement).closest("input,textarea,select")) return; const mod = event.ctrlKey || event.metaKey; if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void controller.save(); } else if (mod && ["z", "y"].includes(event.key.toLowerCase())) { event.preventDefault(); void (event.shiftKey || event.key.toLowerCase() === "y" ? controller.redo() : controller.undo()); } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); } else if (event.key === "Escape") { cancelDrag(); setTool("select"); select([]); } }}>
    <header className="lxw-header"><StickyNote size={22} /><strong>{props.title ?? model.title}</strong><span className="lxw-spacer" />{features.history && <><button type="button" aria-label="元に戻す" title="元に戻す" disabled={!editor.canUndo || !editor.editable} onClick={() => void controller.undo()}><Undo2 size={18} /></button><button type="button" aria-label="やり直す" title="やり直す" disabled={!editor.canRedo || !editor.editable} onClick={() => void controller.redo()}><Redo2 size={18} /></button></>}{!editor.readOnly && <button type="button" disabled={!editor.dirty || !!editor.busy} onClick={() => void controller.save()}><Save size={16} />保存</button>}</header>
    <div className="lxw-toolbar"><div className="lxw-tool-group"><button type="button" aria-label="選択" aria-pressed={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={17} /></button><button type="button" aria-label="キャンバスを移動" aria-pressed={tool === "pan"} onClick={() => setTool("pan")}><Hand size={17} /></button></div>{features.elements && <div className="lxw-tool-group"><button type="button" disabled={!editor.editable} onClick={() => add("sticky")}><StickyNote size={17} />付箋</button><button type="button" disabled={!editor.editable} onClick={() => add("text")}><Type size={17} />テキスト</button><button type="button" disabled={!editor.editable} onClick={() => add("rectangle")}><Square size={17} />四角</button><button type="button" disabled={!editor.editable} onClick={() => add("ellipse")}><Circle size={17} />楕円</button></div>}{features.images && <button type="button" disabled={!editor.editable || !features.elements} onClick={() => { imagePlacement.current = { model: controller.getModel() }; imageInput.current?.click(); }}><ImagePlus size={18} />画像</button>}{features.elements && features.move && <button type="button" disabled={!editor.editable || selected.length < 2} onClick={() => void controller.execute({ type: "elements.align", ids: selected, alignment: "left" })}>左揃え</button>}{features.elements && <><button type="button" aria-label="最前面へ" disabled={!editor.editable || !selected.length} onClick={() => void controller.execute({ type: "elements.order", ids: selected, position: "front" })}><ArrowUpToLine size={17} /></button><button type="button" aria-label="最背面へ" disabled={!editor.editable || !selected.length} onClick={() => void controller.execute({ type: "elements.order", ids: selected, position: "back" })}><ArrowDownToLine size={17} /></button><button type="button" aria-label="選択を削除" disabled={!editor.editable || !selected.length} onClick={remove}><Trash2 size={17} /></button></>}<span className="lxw-spacer" />{features.import && <button type="button" disabled={!editor.editable} onClick={() => input.current?.click()}><Upload size={16} />開く</button>}{features.export && <><button type="button" onClick={() => download("json")}><Download size={16} />JSON</button><button type="button" onClick={() => download("svg")}>SVG</button></>}</div>
    <div className="lxw-workspace"><svg ref={svg} className="lxw-canvas" role="img" aria-label="ホワイトボードのキャンバス" viewBox={`${pan.x} ${pan.y} ${viewport.width / zoom} ${viewport.height / zoom}`} onContextMenu={event => contextMenu(event)} onPointerDown={event => begin(event)} onPointerMove={event => { const current = dragRef.current; if (!current) return; if (event.pointerId !== current.pointerId) return; const dx = (event.clientX - current.clientX) / current.scale + current.offsetX, dy = (event.clientY - current.clientY) / current.scale + current.offsetY; const next = { ...current, lastX: event.clientX, lastY: event.clientY, dx, dy }; dragRef.current = next; if (current.kind === "pan") setPan({ x: current.pan.x - dx, y: current.pan.y - dy }); else setDrag(next); }} onPointerUp={finish} onPointerCancel={cancelDrag}>
      <defs><pattern id={gridId} width={24} height={24} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={.8} fill="#d9d8d3" /></pattern></defs><rect x={pan.x} y={pan.y} width={viewport.width / zoom} height={viewport.height / zoom} fill={`url(#${gridId})`} />
      {model.elements.map(item => <WhiteboardElementView key={item.id} element={preview(item)} moving={drag?.kind === "move" && drag.ids.includes(item.id) && !!(drag.dx || drag.dy)} selected={selected.includes(item.id)} primary={canvasAccent} resizable={editor.editable && features.elements && features.resize} zoom={zoom} onBegin={begin} onEdit={() => focusLabel(item.id)} onContextMenu={event => contextMenu(event, item)} />)}
    </svg><aside className="lxw-inspector"><h2>{selectedElement ? selectedElement.kind === "image" ? "画像" : "オブジェクト" : "プロパティ"}</h2>{selectedElement ? <><label>{selectedElement.kind === "image" ? "代替テキスト" : "テキスト"}<textarea ref={label} value={selectedElement.kind === "image" ? selectedElement.alt : selectedElement.text} disabled={!editor.editable || !features.elements} onChange={event => void controller.execute({ type: "element.update", id: selectedElement.id, patch: selectedElement.kind === "image" ? { alt: event.target.value } : { text: event.target.value } }, { historyGroup: `text:${selectedElement.id}` })} /></label>{features.resize && <div className="lxw-field-row">{(["width","height"] as const).map(key => <label key={key}>{key === "width" ? "幅" : "高さ"}<input type="number" value={Math.round(selectedElement[key])} min={20} max={5000} disabled={!editor.editable || !features.resize} onChange={event => { const value = Number(event.target.value), patch = selectedElement.kind === "image" ? key === "width" ? { width: value, height: value * selectedElement.height / selectedElement.width } : { height: value, width: value * selectedElement.width / selectedElement.height } : { [key]: value }; void controller.execute({ type: "element.update", id: selectedElement.id, patch }); }} /></label>)}</div>}{selectedElement.kind !== "image" && features.formatting && <><label>文字サイズ<input type="number" value={selectedElement.fontSize} min={8} max={120} disabled={!editor.editable} onChange={event => void controller.execute({ type: "element.update", id: selectedElement.id, patch: { fontSize: Number(event.target.value) } })} /></label>{([['fill','塗りつぶし'],['stroke','線'],['textColor','文字色']] as const).map(([key,name]) => <label className="lxw-color" key={key}>{name}<input type="color" value={selectedElement[key]} disabled={!editor.editable} onChange={event => void controller.execute({ type: "element.update", id: selectedElement.id, patch: { [key]: event.target.value } })} /></label>)}</>}</> : <p>付箋や画像を自由に並べられます。Shiftを押しながらクリックすると複数選択できます。空白をドラッグするとキャンバスを移動できます。</p>}</aside></div>
    <footer className="lxw-status"><span>{model.elements.length} オブジェクト</span><span role="status" className="lxw-notice">{editor.busy ? <><Loader2 size={14} className="lxw-spin" />処理中…</> : editor.notice?.text}</span><button type="button" aria-label="全体を表示" onClick={fitCanvas}><Maximize size={15} /></button><button type="button" aria-label="縮小" onClick={() => setZoom(value => Math.max(.1,value-.1))}><Minus size={15} /></button><button type="button" onClick={() => setZoom(1)}>{Math.round(zoom*100)}%</button><button type="button" aria-label="拡大" onClick={() => setZoom(value => Math.min(3,value+.1))}><Plus size={15} /></button></footer>
    <input ref={input} type="file" hidden accept=".json,application/json" aria-label="ホワイトボードJSONを開く" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importJson(file); }} /><input ref={imageInput} type="file" hidden accept="image/png,image/jpeg" aria-label="画像を選択" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void insertImage(file); }} />
  </div>;
}

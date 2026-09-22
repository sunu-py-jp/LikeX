"use client";
import { useEffect, useLayoutEffect, useId, useImperativeHandle, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { ArrowRight, Circle, Diamond, Download, GitBranch, Hand, Loader2, Maximize, Minus, MousePointer2, Plus, Redo2, Save, Square, Trash2, Undo2, Upload } from "lucide-react";
import { createPrimaryColorPalette } from "./core";
import { openContextMenu, type ContextMenuAction } from "./browser";
import { DIAGRAM_LIMITS, createDiagramEdge, createDiagramNode, exportDiagramSvg, getDiagramBounds, getDiagramEdgeGeometry, parseDiagram, serializeDiagram, type DiagramCommand, type DiagramEdge, type DiagramModel, type DiagramNode, type DiagramShape } from "./model/index";
import { useDiagram } from "./state/use-diagram";
import type { DiagramProps } from "./props";
import { startDragEdgeMotion } from "./ui/drag-scroll";
import { DiagramNodeView } from "./ui/diagram-node";

type Drag = { kind: "pan" | "move" | "resize"; clientX: number; clientY: number; ids: string[]; id?: string; corner?: string; model: DiagramModel; pan: { x: number; y: number }; dx: number; dy: number; lastX: number; lastY: number; offsetX: number; offsetY: number; scale: number; pointerId: number; stop(): void };
export default function LikeDiagram({ ref: externalRef, ...props }: DiagramProps) {
  const editor = useDiagram(props), { controller, model, features } = editor;
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), input = useRef<HTMLInputElement>(null), label = useRef<HTMLTextAreaElement>(null);
  const [selectionIds, setSelected] = useState<string[]>([]), [tool, setTool] = useState<"select" | "pan" | "connect">("select"), [source, setSource] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 }), [zoom, setZoom] = useState(1), [viewport, setViewport] = useState({ width: 1000, height: 620 }), [drag, setDrag] = useState<Drag | null>(null), [systemDark, setSystemDark] = useState(false);
  const dragRef = useRef<Drag | null>(null), arrowId = `lxg-arrow-${useId().replace(/:/g, "")}`, gridId = `${arrowId}-grid`;
  const dark = props.colorMode === "dark" || props.colorMode === "system" && systemDark, palette = createPrimaryColorPalette(props.primaryColor ?? "#496a8f", dark ? "dark" : "light") ?? createPrimaryColorPalette("#496a8f", dark ? "dark" : "light")!;
  const canvasAccent = createPrimaryColorPalette(props.primaryColor ?? "#496a8f", "light")?.accent ?? "#496a8f";
  const availableIds = new Set([...model.nodes, ...model.edges].map(item => item.id)), selected = selectionIds.filter(id => availableIds.has(id));
  const selectedNode = model.nodes.find(node => selected.includes(node.id)), selectedEdge = model.edges.find(edge => selected.includes(edge.id));
  const select = (ids: readonly string[]) => { const all = new Set([...controller.getModel().nodes, ...controller.getModel().edges].map(item => item.id)); const next = [...new Set(ids)].filter(id => all.has(id)); setSelected(next); try { props.onSelectionChange?.(next); } catch { /* Observer. */ } };
  const fail = (cause: unknown) => controller.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "操作できませんでした。" });
  const importJson = (value: string | Blob) => controller.prepare(async () => { if (typeof value !== "string" && value.size > DIAGRAM_LIMITS.jsonLength * 3) throw new Error("ファイルのサイズが上限を超えています。"); return { type: "diagram.replace" as const, model: parseDiagram(typeof value === "string" ? value : await value.text()) }; }, { feature: "import" });
  const exportJson = () => { if (!controller.getSnapshot().features.export) throw new Error("書き出しは無効です。"); return serializeDiagram(controller.getModel()); };
  const exportSvg = () => { if (!controller.getSnapshot().features.export) throw new Error("書き出しは無効です。"); return exportDiagramSvg(controller.getModel()); };
  useImperativeHandle(externalRef, () => ({ getModel: controller.getModel, execute: controller.execute, select, getSelection: () => selected, undo: controller.undo, redo: controller.redo, save: controller.save, discard: controller.discard, importJson, exportJson, exportSvg }));
  useEffect(() => { const el = svg.current; if (!el) return; const observer = new ResizeObserver(() => { const bounds = el.getBoundingClientRect(); setViewport({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) }); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { const media = root.current?.ownerDocument.defaultView?.matchMedia?.("(prefers-color-scheme: dark)"); if (!media) return; const changed = () => setSystemDark(media.matches); changed(); media.addEventListener("change", changed); return () => media.removeEventListener("change", changed); }, []);
  useEffect(() => { const win = root.current?.ownerDocument.defaultView; if (!win || !editor.dirty || props.warnOnUnsavedChanges === false) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; win.addEventListener("beforeunload", guard); return () => win.removeEventListener("beforeunload", guard); }, [editor.dirty, props.warnOnUnsavedChanges]);
  const [inspectorFocus, setInspectorFocus] = useState<{ id: string } | null>(null);
  useEffect(() => { if (inspectorFocus && (selectedNode?.id === inspectorFocus.id || selectedEdge?.id === inspectorFocus.id)) label.current?.focus(); }, [inspectorFocus, selectedNode?.id, selectedEdge?.id]);
  const closeMenu = useRef<(() => void) | undefined>(undefined), contextPolicy = JSON.stringify(features);
  useLayoutEffect(() => { closeMenu.current?.(); return () => closeMenu.current?.(); }, [model, editor.editable, contextPolicy]);
  const focusLabel = (id: string) => { select([id]); setInspectorFocus({ id }); };
  function fitCanvas() { const bounds = getDiagramBounds(controller.getModel()); setZoom(Math.min(2, Math.max(.1, Math.min(viewport.width / bounds.width, viewport.height / bounds.height)))); setPan({ x: bounds.x, y: bounds.y }); }
  function contextMenu(event: MouseEvent<Element>, target?: DiagramNode | DiagramEdge) {
    if (event.shiftKey) return;
    if ((event.target as Element).closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (!target && (event.target as Element).closest?.('[data-node-id],[data-edge-id]')) return;
    const anchor = root.current; if (!anchor) return;
    cancelDrag(); setSource(null); setTool("select");
    const snapshot = controller.getSnapshot(), expected = snapshot.model, flags = snapshot.features;
    const ids = target ? selected.includes(target.id) ? [...selected] : [target.id] : [];
    if (target) select(ids); else select([]);
    const nodes = expected.nodes.filter(node => ids.includes(node.id)), edges = expected.edges.filter(edge => ids.includes(edge.id));
    const items: ContextMenuAction[] = [], disabled = !snapshot.editable;
    const run = (action: () => unknown) => () => controller.getModel() === expected ? action() : undefined;
    const command = (value: DiagramCommand | DiagramCommand[]) => run(() => controller.execute(value));
    const node = target && "shape" in target ? target : undefined;
    if (target && flags[node ? "nodes" : "edges"]) {
      items.push({ id: "edit", label: node ? "テキストを編集" : "ラベルを編集", disabled, onSelect: run(() => { if (controller.getSnapshot().editable && controller.getSnapshot().features[node ? "nodes" : "edges"]) focusLabel(target.id); }) });
      const copyEdges = expected.edges.filter(edge => ids.includes(edge.id) || nodes.some(node => node.id === edge.sourceId) && nodes.some(node => node.id === edge.targetId));
      if ((!nodes.length || flags.nodes) && (!copyEdges.length || flags.edges)) items.push({ id: "duplicate", label: "複製", disabled, onSelect: run(async () => {
        const copies = nodes.map(node => createDiagramNode({ ...node, id: undefined, x: node.x + 24, y: node.y + 24 }));
        const mapping = new Map(nodes.map((node, index) => [node.id, copies[index].id]));
        const links = copyEdges.map(edge => createDiagramEdge({ ...edge, id: undefined, sourceId: mapping.get(edge.sourceId) ?? edge.sourceId, targetId: mapping.get(edge.targetId) ?? edge.targetId }));
        const result = await controller.execute([...copies.map(node => ({ type: "node.add" as const, node })), ...links.map(edge => ({ type: "edge.add" as const, edge }))]);
        if (result) select([...copies, ...links].map(item => item.id));
      }) });
      if ((!nodes.length || flags.nodes) && (!edges.length || flags.edges)) {
        const order = (position: "front" | "back"): DiagramCommand[] => [...(nodes.length ? [{ type: "nodes.order" as const, ids: nodes.map(node => node.id), position }] : []), ...(edges.length ? [{ type: "edges.order" as const, ids: edges.map(edge => edge.id), position }] : [])];
        items.push({ id: "front", label: "最前面へ", disabled, separatorBefore: true, onSelect: command(order("front")) }, { id: "back", label: "最背面へ", disabled, onSelect: command(order("back")) });
      }
      if (flags.nodes && flags.move && nodes.length > 1) items.push({ id: "align-left", label: "左揃え", disabled, onSelect: command({ type: "nodes.align", ids: nodes.map(node => node.id), alignment: "left" }) });
      if (node && flags.edges) items.push({ id: "connect", label: "ここから接続", disabled, onSelect: run(() => { if (!controller.getSnapshot().editable || !controller.getSnapshot().features.edges) return; select([node.id]); setTool("connect"); setSource(node.id); }) });
      if (flags.edges && (!nodes.length || flags.nodes)) items.push({ id: "delete", label: "削除", disabled, danger: true, separatorBefore: true, shortcut: "Delete", onSelect: run(() => remove(ids)) });
    }
    if (!target) {
      const bounds = svg.current?.getBoundingClientRect(), point = event.clientX || event.clientY ? { x: pan.x + (event.clientX - (bounds?.left ?? 0)) / zoom, y: pan.y + (event.clientY - (bounds?.top ?? 0)) / zoom } : undefined;
      if (flags.nodes) for (const [shape, text] of [["rectangle", "処理を追加"], ["diamond", "条件を追加"], ["ellipse", "開始・終了を追加"]] as const) items.push({ id: `add-${shape}`, label: text, disabled, onSelect: run(() => add(shape, point)) });
      if (flags.history) items.push({ id: "undo", label: "元に戻す", disabled: disabled || !snapshot.canUndo, separatorBefore: true, onSelect: run(controller.undo) }, { id: "redo", label: "やり直す", disabled: disabled || !snapshot.canRedo, onSelect: run(controller.redo) });
      items.push({ id: "select-all", label: "すべて選択", disabled: !expected.nodes.length && !expected.edges.length, separatorBefore: true, onSelect: run(() => select([...expected.nodes, ...expected.edges].map(item => item.id))) }, { id: "fit", label: "全体を表示", onSelect: fitCanvas });
    }
    if (!items.length) return;
    event.preventDefault(); event.stopPropagation();
    closeMenu.current = openContextMenu({ anchor, x: event.clientX, y: event.clientY, items, onError: fail, onClose: () => { closeMenu.current = undefined; } });
  }
  function begin(event: PointerEvent<SVGElement>, node?: DiagramNode, corner?: string) {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); event.stopPropagation(); root.current?.focus();
    if (tool === "connect" && node && editor.editable && features.edges) { if (!source) setSource(node.id); else if (source !== node.id) { void controller.execute({ type: "edge.add", edge: { sourceId: source, targetId: node.id } }); setSource(null); } return; }
    let ids = selected;
    if (node && tool !== "pan") { ids = event.shiftKey ? selected.includes(node.id) ? selected.filter(id => id !== node.id) : [...selected, node.id] : selected.includes(node.id) ? selected : [node.id]; select(ids); }
    else if (tool !== "pan" && !event.shiftKey) select([]);
    const kind = !node || tool === "pan" || event.button === 1 ? "pan" : corner ? "resize" : "move";
    if (kind !== "pan" && (!ids.length || !editor.editable || !features.nodes || !features[kind])) return;
    const next: Drag = { kind, clientX: event.clientX, clientY: event.clientY, ids: ids.filter(id => model.nodes.some(node => node.id === id)), id: node?.id, corner, model: controller.getModel(), pan, dx: 0, dy: 0, lastX: event.clientX, lastY: event.clientY, offsetX: 0, offsetY: 0, scale: zoom, pointerId: event.pointerId, stop() {} };
    dragRef.current?.stop(); dragRef.current = next;
    const canvas = svg.current, win = canvas?.ownerDocument.defaultView;
    if (!canvas || !win) { setDrag(next); return; }
    const cancel = () => { if (dragRef.current === next || dragRef.current?.pointerId === next.pointerId) cancelDrag(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
    const end = (event: globalThis.PointerEvent) => { if (event.pointerId === next.pointerId) finish(event); };
    const lose = (event: globalThis.PointerEvent) => { if (event.pointerId === next.pointerId) cancel(); };
    const valid = () => { const current = dragRef.current, state = controller.getSnapshot(); if (current && (state.model !== current.model || current.kind !== "pan" && (!state.editable || !state.features.nodes || !state.features[current.kind]))) cancel(); };
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
  function preview(node: DiagramNode, current = drag): DiagramNode {
    const drag = current;
    if (!drag || !drag.ids.includes(node.id) || drag.kind === "pan") return node;
    if (drag.kind === "move") return { ...node, x: node.x + drag.dx, y: node.y + drag.dy };
    if (drag.id !== node.id) return node;
    const west = drag.corner?.includes("w"), north = drag.corner?.includes("n"), width = Math.max(30, node.width + (west ? -drag.dx : drag.dx)), height = Math.max(30, node.height + (north ? -drag.dy : drag.dy));
    return { ...node, width, height, x: west ? node.x + node.width - width : node.x, y: north ? node.y + node.height - height : node.y };
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
      if (current.kind === "move") void controller.execute({ type: "nodes.move", ids: current.ids, dx: current.dx, dy: current.dy });
      else if (current.kind === "resize") { const node = model.nodes.find(node => node.id === current.id); if (node) { const next = preview(node,current); void controller.execute({ type: "node.update", id: node.id, patch: { x: next.x, y: next.y, width: next.width, height: next.height } }); } }
    }
    setDrag(null);
  }
  function remove(ids = selected) { const current = controller.getModel(), nodes = ids.filter(id => current.nodes.some(node => node.id === id)), edges = ids.filter(id => current.edges.some(edge => edge.id === id) && !current.edges.some(edge => edge.id === id && (nodes.includes(edge.sourceId) || nodes.includes(edge.targetId)))); return controller.execute([...(edges.length ? [{ type: "edge.remove" as const, ids: edges }] : []), ...(nodes.length ? [{ type: "node.remove" as const, ids: nodes }] : [])]); }
  function add(shape: DiagramShape, point?: { x: number; y: number }) { const node = createDiagramNode({ shape, x: point?.x ?? pan.x + viewport.width / zoom / 2 - 90, y: point?.y ?? pan.y + viewport.height / zoom / 2 - 45, text: shape === "diamond" ? "条件" : shape === "ellipse" ? "開始 / 終了" : "処理" }); return controller.execute({ type: "node.add", node }).then(result => { if (result) select([node.id]); }); }
  function download(format: "json" | "svg") { try { const blob = new Blob([format === "json" ? exportJson() : exportSvg()], { type: format === "json" ? "application/json" : "image/svg+xml" }), url = URL.createObjectURL(blob), anchor = root.current!.ownerDocument.createElement("a"); anchor.href = url; anchor.download = `${model.title.replace(/[\\/:*?"<>|]/g, "_") || "Diagram"}.${format}`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (cause) { fail(cause); } }
  const nodes = model.nodes.map(node => preview(node)), nodeMap = new Map(nodes.map(node => [node.id, node]));
  return <div ref={root} tabIndex={0} data-likex-diagram="" className={`lxg-root ${dark ? "lxg-dark" : ""} ${props.className ?? ""}`} style={{ "--lxg-primary": palette?.primary, "--lxg-on-primary": palette?.onPrimary, "--lxg-accent": palette.accent, ...props.style } as CSSProperties} aria-label={props["aria-label"] ?? "ダイアグラムエディター"} onContextMenu={event => { if (event.target === event.currentTarget) contextMenu(event, selectedNode ?? selectedEdge); }} onKeyDown={event => { if ((event.target as HTMLElement).closest("input,textarea,select")) return; const mod = event.ctrlKey || event.metaKey; if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void controller.save(); } else if (mod && ["z", "y"].includes(event.key.toLowerCase())) { event.preventDefault(); void (event.shiftKey || event.key.toLowerCase() === "y" ? controller.redo() : controller.undo()); } else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); } else if (event.key === "Escape") { cancelDrag(); setSource(null); setTool("select"); select([]); } }}>
    <header className="lxg-header"><GitBranch size={22} /><strong>{props.title ?? model.title}</strong><span className="lxg-spacer" />{features.history && <><button type="button" aria-label="元に戻す" title="元に戻す" disabled={!editor.canUndo || !editor.editable} onClick={() => void controller.undo()}><Undo2 size={18} /></button><button type="button" aria-label="やり直す" title="やり直す" disabled={!editor.canRedo || !editor.editable} onClick={() => void controller.redo()}><Redo2 size={18} /></button></>}{!editor.readOnly && <button type="button" disabled={!editor.dirty || !!editor.busy} onClick={() => void controller.save()}><Save size={16} />保存</button>}</header>
    <div className="lxg-toolbar"><div className="lxg-tool-group"><button type="button" aria-label="選択" aria-pressed={tool === "select"} onClick={() => { setTool("select"); setSource(null); }}><MousePointer2 size={17} /></button><button type="button" aria-label="キャンバスを移動" aria-pressed={tool === "pan"} onClick={() => { setTool("pan"); setSource(null); }}><Hand size={17} /></button></div>{features.nodes && <div className="lxg-tool-group"><button type="button" disabled={!editor.editable} onClick={() => add("rectangle")}><Square size={17} />処理</button><button type="button" disabled={!editor.editable} onClick={() => add("diamond")}><Diamond size={17} />条件</button><button type="button" disabled={!editor.editable} onClick={() => add("ellipse")}><Circle size={17} />開始・終了</button></div>}{features.edges && <button type="button" aria-pressed={tool === "connect"} disabled={!editor.editable} onClick={() => { setTool("connect"); setSource(null); }}><ArrowRight size={18} />接続</button>}{features.nodes && features.move && <button type="button" disabled={!editor.editable || selected.length < 2} onClick={() => void controller.execute({ type: "nodes.align", ids: selected.filter(id => model.nodes.some(node => node.id === id)), alignment: "left" })}>左揃え</button>}{features.edges && <button type="button" aria-label="選択を削除" disabled={!editor.editable || !selected.length} onClick={() => void remove()}><Trash2 size={17} /></button>}<span className="lxg-spacer" />{features.import && <button type="button" disabled={!editor.editable} onClick={() => input.current?.click()}><Upload size={16} />開く</button>}{features.export && <><button type="button" onClick={() => download("json")}><Download size={16} />JSON</button><button type="button" onClick={() => download("svg")}>SVG</button></>}</div>
    <div className="lxg-workspace"><svg ref={svg} className="lxg-canvas" role="img" aria-label="ダイアグラムのキャンバス" viewBox={`${pan.x} ${pan.y} ${viewport.width / zoom} ${viewport.height / zoom}`} onContextMenu={event => contextMenu(event)} onPointerDown={event => begin(event)} onPointerMove={event => { const current = dragRef.current; if (!current) return; if (event.pointerId !== current.pointerId) return; const dx = (event.clientX - current.clientX) / current.scale + current.offsetX, dy = (event.clientY - current.clientY) / current.scale + current.offsetY; const next = { ...current, lastX: event.clientX, lastY: event.clientY, dx, dy }; dragRef.current = next; if (current.kind === "pan") setPan({ x: current.pan.x - dx, y: current.pan.y - dy }); else setDrag(next); }} onPointerUp={finish} onPointerCancel={cancelDrag}>
      <defs><pattern id={gridId} width={24} height={24} patternUnits="userSpaceOnUse"><circle cx={1} cy={1} r={.8} fill="#d5dce5" /></pattern><marker id={arrowId} markerWidth={10} markerHeight={8} refX={9} refY={4} orient="auto"><path d="M0 0 L10 4 L0 8Z" fill="context-stroke" /></marker></defs><rect x={pan.x} y={pan.y} width={viewport.width / zoom} height={viewport.height / zoom} fill={`url(#${gridId})`} />
      {model.edges.map(edge => { const geometry = getDiagramEdgeGeometry(nodeMap.get(edge.sourceId)!, nodeMap.get(edge.targetId)!); return <g key={edge.id} data-edge-id={edge.id} onContextMenu={event => contextMenu(event, edge)} onDoubleClick={() => focusLabel(edge.id)} onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); root.current?.focus(); select(event.shiftKey ? [...selected, edge.id] : [edge.id]); }}><path d={`M${geometry.start.x} ${geometry.start.y} L${geometry.end.x} ${geometry.end.y}`} stroke="transparent" strokeWidth={16} /><path d={`M${geometry.start.x} ${geometry.start.y} L${geometry.end.x} ${geometry.end.y}`} stroke={edge.color} strokeWidth={selected.includes(edge.id) ? 4 : 2} markerEnd={`url(#${arrowId})`} /><text x={geometry.label.x} y={geometry.label.y} textAnchor="middle" fontSize={13} fill={edge.color}>{edge.label}</text></g>; })}
      {nodes.map(node => <DiagramNodeView key={node.id} node={node} moving={drag?.kind === "move" && drag.ids.includes(node.id) && !!(drag.dx || drag.dy)} selected={selected.includes(node.id)} connecting={source === node.id} primary={canvasAccent} resizable={editor.editable && features.nodes && features.resize} zoom={zoom} onBegin={begin} onEdit={() => focusLabel(node.id)} onContextMenu={event => contextMenu(event, node)} />)}
    </svg><aside className="lxg-inspector"><h2>{selectedNode ? "ノード" : selectedEdge ? "接続線" : "プロパティ"}</h2>{selectedNode ? <><label>テキスト<textarea ref={label} value={selectedNode.text} disabled={!editor.editable || !features.nodes} onChange={event => void controller.execute({ type: "node.update", id: selectedNode.id, patch: { text: event.target.value } }, { historyGroup: `text:${selectedNode.id}` })} /></label>{features.resize && <div className="lxg-field-row">{(["width","height"] as const).map(key => <label key={key}>{key === "width" ? "幅" : "高さ"}<input type="number" value={selectedNode[key]} min={30} max={5000} disabled={!editor.editable || !features.resize} onChange={event => void controller.execute({ type: "node.update", id: selectedNode.id, patch: { [key]: Number(event.target.value) } })} /></label>)}</div>}{features.formatting && ([['fill','塗りつぶし'],['stroke','線'],['textColor','文字色']] as const).map(([key,name]) => <label className="lxg-color" key={key}>{name}<input type="color" value={selectedNode[key]} disabled={!editor.editable} onChange={event => void controller.execute({ type: "node.update", id: selectedNode.id, patch: { [key]: event.target.value } })} /></label>)}</> : selectedEdge ? <><label>ラベル<textarea ref={label} value={selectedEdge.label} disabled={!editor.editable || !features.edges} onChange={event => void controller.execute({ type: "edge.update", id: selectedEdge.id, patch: { label: event.target.value } }, { historyGroup: `edge:${selectedEdge.id}` })} /></label>{features.formatting && <label className="lxg-color">線の色<input type="color" value={selectedEdge.color} disabled={!editor.editable} onChange={event => void controller.execute({ type: "edge.update", id: selectedEdge.id, patch: { color: event.target.value } })} /></label>}</> : <p>図形を選ぶと、内容や色を編集できます。Shiftを押しながらクリックすると複数選択できます。</p>}</aside></div>
    <footer className="lxg-status"><span>{model.nodes.length} ノード · {model.edges.length} 接続</span><span role="status" className="lxg-notice">{editor.busy ? <><Loader2 size={14} className="lxg-spin" />処理中…</> : source ? "接続先のノードをクリックしてください" : editor.notice?.text}</span><button type="button" aria-label="全体を表示" onClick={fitCanvas}><Maximize size={15} /></button><button type="button" aria-label="縮小" onClick={() => setZoom(value => Math.max(.1,value-.1))}><Minus size={15} /></button><button type="button" onClick={() => setZoom(1)}>{Math.round(zoom*100)}%</button><button type="button" aria-label="拡大" onClick={() => setZoom(value => Math.min(3,value+.1))}><Plus size={15} /></button></footer>
    <input ref={input} type="file" hidden accept=".json,application/json" aria-label="ダイアグラムJSONを開く" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importJson(file); }} />
  </div>;
}

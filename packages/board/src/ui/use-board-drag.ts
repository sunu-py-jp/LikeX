import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { getDragInsertionIndex, getDragScrollDelta } from "../core";
import type { BoardCommand, BoardModel } from "../model";

type Source = { kind: "card" | "column"; id: string; title: string };
type Target = { kind: "column"; index: number; anchorId: string; edge: "before" | "after" }
  | { kind: "card"; columnId: string; index: number; anchorId: string | null; edge: "before" | "after" };
type Options = { board: BoardModel; editable: boolean; cards: boolean; columns: boolean; move: boolean; execute(command: BoardCommand): Promise<unknown> };
const rectItems = (nodes: HTMLElement[], axis: "x" | "y") => nodes.map(node => { const rect = node.getBoundingClientRect(); return axis === "x" ? { start: rect.left, end: rect.right } : { start: rect.top, end: rect.bottom }; });

/** Native drag state is local to this board; the model changes only after a valid drop. */
export function useBoardDrag(options: Options) {
  const viewportRef = useRef<HTMLElement>(null);
  const latest = useRef(options), session = useRef<{ source: Source; board: BoardModel; stop(): void; drop(point: { x: number; y: number }): void } | null>(null);
  const [target, setTarget] = useState<Target | null>(null), [draggedId, setDraggedId] = useState<string | null>(null);
  const cancel = useCallback(() => session.current?.stop(), []);
  useLayoutEffect(() => {
    latest.current = options;
    const active = session.current;
    if (active && (active.board !== options.board || !options.editable || !options.move || !(active.source.kind === "card" ? options.cards : options.columns))) active.stop();
  }, [options]);
  useEffect(() => cancel, [cancel]);

  function start(event: DragEvent<HTMLElement>, source: Source) {
    const current = latest.current, viewport = viewportRef.current;
    if (!viewport || !current.editable || !current.move || !(source.kind === "card" ? current.cards : current.columns)) { event.preventDefault(); return; }
    event.stopPropagation(); cancel();
    const owner = viewport.ownerDocument, win = owner.defaultView;
    if (!win) { event.preventDefault(); return; }
    const preview = owner.createElement("div"), color = win.getComputedStyle(viewport);
    preview.textContent = source.title;
    const sourceBounds = event.currentTarget?.getBoundingClientRect?.() ?? viewport.getBoundingClientRect();
    Object.assign(preview.style, { position: "fixed", left: `${Math.max(0, Math.min(sourceBounds.left, win.innerWidth - 176))}px`, top: `${Math.max(0, Math.min(sourceBounds.top, win.innerHeight - 64))}px`, width: "176px", maxHeight: "64px", overflow: "hidden", padding: "10px 13px", borderRadius: "6px", border: `1px solid ${color.getPropertyValue("--lxb-accent") || "#2563eb"}`, background: color.getPropertyValue("--lxb-surface") || "white", color: color.color, font: "13px/1.5 sans-serif", boxShadow: "0 5px 18px #0003", opacity: ".78", pointerEvents: "none" });
    owner.body.append(preview);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-likex-board", source.id);
    try { event.dataTransfer.setDragImage?.(preview, 18, 14); } catch { /* Browsers without custom drag images retain their native preview. */ }
    const previewTimer = win.setTimeout(() => preview.remove(), 0);
    let pointer = { x: event.clientX, y: event.clientY }, frame = 0, previousTime = 0, destination: Target | null = null, stopped = false;
    const select = (next: Target | null) => { if (JSON.stringify(next) !== JSON.stringify(destination)) { destination = next; setTarget(next); } };
    function locate() {
      const bounds = viewport!.getBoundingClientRect();
      if (pointer.x < bounds.left || pointer.x > bounds.right || pointer.y < bounds.top || pointer.y > bounds.bottom) { select(null); return; }
      const columns = [...viewport!.querySelectorAll<HTMLElement>("[data-lxb-column]")];
      if (source.kind === "column") {
        const peers = columns.filter(node => node.dataset.lxbColumn !== source.id), index = getDragInsertionIndex(pointer.x, rectItems(peers, "x")), anchor = peers[index] ?? peers.at(-1);
        select(anchor ? { kind: "column", index, anchorId: anchor.dataset.lxbColumn!, edge: index < peers.length ? "before" : "after" } : null); return;
      }
      const column = columns.find(node => { const rect = node.getBoundingClientRect(); return pointer.x >= rect.left && pointer.x <= rect.right; });
      if (!column) { select(null); return; }
      const columnId = column.dataset.lxbColumn!, cards = current.board.columns.find(item => item.id === columnId)!.cards.filter(card => card.id !== source.id);
      const peers = [...column.querySelectorAll<HTMLElement>("[data-lxb-card]")].filter(node => node.dataset.lxbCard !== source.id);
      const boundary = getDragInsertionIndex(pointer.y, rectItems(peers, "y")), anchor = peers[boundary] ?? peers.at(-1), edge = boundary < peers.length ? "before" : "after";
      const anchorId = anchor?.dataset.lxbCard ?? null, index = anchorId ? cards.findIndex(card => card.id === anchorId) + (edge === "after" ? 1 : 0) : cards.length;
      select({ kind: "card", columnId, index, anchorId, edge });
    }
    function track(event: globalThis.DragEvent) { pointer = { x: event.clientX, y: event.clientY }; locate(); if (destination) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; } }
    function tick(time: number) {
      if (stopped) return;
      const elapsed = previousTime ? time - previousTime : 16; previousTime = time;
      const bounds = viewport!.getBoundingClientRect(), delta = getDragScrollDelta(pointer, bounds, elapsed, { axes: "x" });
      viewport!.scrollLeft += delta.x;
      if (source.kind === "card") {
        const lists = [...viewport!.querySelectorAll<HTMLElement>(".lxb-card-list")];
        const list = lists.find(node => { const rect = node.getBoundingClientRect(); return pointer.x >= rect.left && pointer.x <= rect.right; });
        if (list) { const rect = list.getBoundingClientRect(); const scroll = getDragScrollDelta(pointer, { ...rect, left: rect.left, right: rect.right, top: Math.max(rect.top, bounds.top), bottom: Math.min(rect.bottom, bounds.bottom) }, elapsed, { axes: "y" }); list.scrollTop += scroll.y; }
      }
      locate(); frame = win!.requestAnimationFrame(tick);
    }
    function stop() { if (stopped) return; stopped = true; win!.cancelAnimationFrame(frame); win!.clearTimeout(previewTimer); owner.removeEventListener("dragover", track); owner.removeEventListener("dragend", stop); owner.removeEventListener("drop", stop); owner.removeEventListener("keydown", escape); win!.removeEventListener("blur", stop); preview.remove(); session.current = null; setTarget(null); setDraggedId(null); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") stop(); }
    session.current = { source, board: current.board, stop, drop(point) {
      const policy = latest.current;
      if (policy.board !== current.board || !policy.editable || !policy.move || !(source.kind === "card" ? policy.cards : policy.columns)) { stop(); return; }
      pointer = point; locate();
      const next = destination; stop();
      if (!next) return;
      void policy.execute(next.kind === "card" ? { type: "card.move", cardId: source.id, columnId: next.columnId, index: next.index } : { type: "column.move", columnId: source.id, index: next.index });
    } };
    owner.addEventListener("dragover", track); owner.addEventListener("dragend", stop); owner.addEventListener("drop", stop); owner.addEventListener("keydown", escape); win.addEventListener("blur", stop);
    setDraggedId(source.id); frame = win.requestAnimationFrame(tick);
  }
  function drop(event: DragEvent) { if (!session.current) return; event.preventDefault(); event.stopPropagation(); session.current.drop({ x: event.clientX, y: event.clientY }); }
  return { viewportRef, start, drop, target, draggedId };
}

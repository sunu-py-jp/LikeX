"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import type { ContextMenuAction } from "../browser";
import type { Slide, SlideCommand, SlideDeck, SlideElement } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { startDragEdgeMotion } from "./drag-scroll";
import { elementStyle, SlideElementContent } from "./slide-artwork";
import { useSlideContextMenu } from "./use-slide-context-menu";

type Geometry = Pick<SlideElement, "x" | "y" | "width" | "height" | "rotation">;
type Corner = "nw" | "ne" | "sw" | "se";
type Gesture = { kind: "move" | "resize" | "rotate"; corner?: Corner; startX: number; startY: number; pointerId: number;
  captureTarget: HTMLElement; elements: SlideElement[]; updates: Map<string, Geometry>; centerX: number; centerY: number; startAngle: number; deck: SlideDeck; slideId: string; scale: number; scrollX: number; scrollY: number; lastX: number; lastY: number; shiftKey: boolean; altKey: boolean; stop(): void };

function resized(element: SlideElement, dx: number, dy: number, corner: Corner, preserveRatio: boolean): Geometry {
  const angle = element.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  const signX = corner.endsWith("e") ? 1 : -1, signY = corner.startsWith("s") ? 1 : -1;
  let width = Math.max(12, element.width + localX * signX), height = Math.max(12, element.height + localY * signY);
  if (preserveRatio) {
    const ratio = element.width / element.height;
    if (Math.abs(width - element.width) > Math.abs(height - element.height) * ratio) height = width / ratio;
    else width = height * ratio;
  }
  const shiftX = (width - element.width) * signX / 2, shiftY = (height - element.height) * signY / 2;
  return { x: element.x + element.width / 2 + shiftX * cos - shiftY * sin - width / 2,
    y: element.y + element.height / 2 + shiftX * sin + shiftY * cos - height / 2, width, height, rotation: element.rotation };
}

export function SlideCanvas({ deck, slide, editor, zoom, onImage }: { deck: SlideDeck; slide: Slide | undefined; editor: SlideEditor; zoom: number; onImage?(target: { deck: SlideDeck; slideId: string }): void }) {
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [preview, setPreview] = useState<Map<string, Geometry>>(new Map());
  const [moving, setMoving] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ deck, slideId: slide?.id, editable: editor.editable, formatting: editor.features.formatting });
  useLayoutEffect(() => { latest.current = { deck, slideId: slide?.id, editable: editor.editable, formatting: editor.features.formatting }; });
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [wasEditable, setWasEditable] = useState(editor.editable);
  if (wasEditable !== editor.editable) {
    setWasEditable(editor.editable);
    if (!editor.editable) { setPreview(new Map()); setEditing(null); }
  }
  const selected = new Set(editor.selection.elementIds);
  const openMenu = useSlideContextMenu(editor);
  const scale = Math.max(.05, Math.min((size.width - 80) / deck.width, (size.height - 64) / deck.height)) * zoom / 100;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth || 900, height: node.clientHeight || 600 });
    const observer = new ResizeObserver(update); observer.observe(node); update();
    return () => observer.disconnect();
  }, []);
  function cancelGesture() { const current = gesture.current; gesture.current = null; current?.stop(); setPreview(new Map()); }
  useLayoutEffect(() => { const current = gesture.current; if (current && (current.deck !== deck || current.slideId !== slide?.id || !editor.editable || !editor.features.formatting)) cancelGesture(); }, [deck, slide?.id, editor.editable, editor.features.formatting]);
  useEffect(() => () => { const current = gesture.current; gesture.current = null; current?.stop(); }, []);

  const begin = (event: PointerEvent<HTMLElement>, element: SlideElement, kind: Gesture["kind"], corner?: Corner) => {
    if (event.button !== 0 || !slide || editing) return;
    event.stopPropagation(); event.preventDefault();
    viewport.current?.focus();
    const ids = event.shiftKey && kind === "move" ? (selected.has(element.id) ? editor.selection.elementIds.filter(id => id !== element.id) : [...editor.selection.elementIds, element.id])
      : selected.has(element.id) ? editor.selection.elementIds : [element.id];
    editor.select({ slideId: slide.id, elementIds: ids });
    if (!ids.includes(element.id) || !editor.editable || !editor.features.formatting || element.locked) return;
    const rect = surface.current!.getBoundingClientRect();
    const centerX = rect.left + (element.x + element.width / 2) * scale, centerY = rect.top + (element.y + element.height / 2) * scale;
    gesture.current = { kind, corner, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, captureTarget: event.currentTarget,
      elements: kind === "move" ? slide.elements.filter(item => ids.includes(item.id) && !item.locked) : [element],
      updates: new Map(), centerX, centerY, startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX), deck, slideId: slide.id, scale, scrollX: viewport.current?.scrollLeft ?? 0, scrollY: viewport.current?.scrollTop ?? 0, lastX: event.clientX, lastY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey, stop() {} };
    const target = viewport.current, win = target?.ownerDocument.defaultView, current = gesture.current;
    if (target && win) {
      const cancel = () => cancelGesture(), key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancel(); } };
      const end = (event: globalThis.PointerEvent) => finish(event), lost = (event: globalThis.PointerEvent) => { if (event.pointerId === current.pointerId) cancel(); };
      const stopMotion = startDragEdgeMotion(target, () => gesture.current?.updates.size && gesture.current.kind !== "rotate" ? { x: gesture.current.lastX, y: gesture.current.lastY } : null, (dx, dy) => { if (!gesture.current) return; target.scrollLeft += dx; target.scrollTop += dy; updateGesture(gesture.current); });
      current.stop = () => { stopMotion(); win.removeEventListener("pointerup", end); win.removeEventListener("pointercancel", lost); win.removeEventListener("keydown", key, true); win.removeEventListener("blur", cancel); current.captureTarget.removeEventListener("lostpointercapture", lost); if (current.captureTarget.hasPointerCapture?.(current.pointerId)) current.captureTarget.releasePointerCapture(current.pointerId); };
      win.addEventListener("pointerup", end); win.addEventListener("pointercancel", lost); win.addEventListener("keydown", key, true); win.addEventListener("blur", cancel); current.captureTarget.addEventListener("lostpointercapture", lost);
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  function updateGesture(current: Gesture) {
    if (latest.current.deck !== current.deck || latest.current.slideId !== current.slideId || !latest.current.editable || !latest.current.formatting) { cancelGesture(); return; }
    const scrollX = (viewport.current?.scrollLeft ?? 0) - current.scrollX, scrollY = (viewport.current?.scrollTop ?? 0) - current.scrollY;
    const dx = (current.lastX - current.startX + scrollX) / current.scale, dy = (current.lastY - current.startY + scrollY) / current.scale;
    if (Math.abs(dx) + Math.abs(dy) < 1 && !current.updates.size) return;
    const next = new Map<string, Geometry>();
    for (const element of current.elements) {
      if (current.kind === "move") next.set(element.id, { ...element, x: element.x + dx, y: element.y + dy });
      else if (current.kind === "resize") next.set(element.id, resized(element, dx, dy, current.corner!, (element.type === "image" && !current.altKey) || current.shiftKey));
      else {
        let rotation = element.rotation + (Math.atan2(current.lastY - current.centerY + scrollY, current.lastX - current.centerX + scrollX) - current.startAngle) * 180 / Math.PI;
        if (current.shiftKey) rotation = Math.round(rotation / 15) * 15;
        next.set(element.id, { ...element, rotation });
      }
    }
    current.updates = next; setMoving(current.kind === "move"); setPreview(next);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current; if (!current || current.pointerId !== event.pointerId) return;
    current.lastX = event.clientX; current.lastY = event.clientY; current.shiftKey = event.shiftKey; current.altKey = event.altKey; updateGesture(current);
  };
  const finish = (event: Pick<globalThis.PointerEvent, "pointerId"> & Partial<Pick<globalThis.PointerEvent, "clientX" | "clientY" | "shiftKey" | "altKey">>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!cancel && typeof event.clientX === "number" && typeof event.clientY === "number") {
      current.lastX = event.clientX; current.lastY = event.clientY;
      current.shiftKey = event.shiftKey ?? current.shiftKey; current.altKey = event.altKey ?? current.altKey;
      updateGesture(current);
      if (gesture.current !== current) return;
    }
    gesture.current = null; current.stop(); setPreview(new Map());
    if (!cancel && latest.current.deck === current.deck && latest.current.slideId === current.slideId && latest.current.editable && latest.current.formatting && current.updates.size) {
      void editor.execute([...current.updates].map(([elementId, geometry]): SlideCommand => ({
        type: "element.update", slideId: current.slideId, elementId,
        patch: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation },
      })), current.deck);
    }
  };
  const commitText = () => {
    if (!editing || !slide) return;
    const current = editing; setEditing(null);
    void editor.execute({ type: "element.update", slideId: slide.id, elementId: current.id, patch: { text: current.text } });
  };
  const elementMenu = (event: MouseEvent<HTMLElement>, element: SlideElement) => {
    if (!slide || editing) return;
    const ids = selected.has(element.id) ? [...editor.selection.elementIds] : [element.id];
    const targets = slide.elements.filter(item => ids.includes(item.id));
    const locked = targets.some(item => item.locked);
    const disabled = !editor.editable || locked;
    const execute = (command: SlideCommand | readonly SlideCommand[]) => editor.execute(command, deck);
    const copyTargets = () => { editor.select({ slideId: slide.id, elementIds: ids }); editor.copyElements(); };
    const items: ContextMenuAction[] = [{ id: "copy", label: "コピー", shortcut: "Ctrl+C", onSelect: copyTargets }];
    if (!editor.readOnly) {
      if (editor.features.text && element.type !== "image" && ids.length === 1) items.unshift({
        id: "edit-text", label: "テキストを編集", disabled, onSelect: () => setEditing({ id: element.id, text: element.text }),
      });
      items.push({ id: "cut", label: "切り取り", shortcut: "Ctrl+X", disabled, onSelect: () => {
        copyTargets(); return execute({ type: "element.delete", slideId: slide.id, elementIds: ids });
      } });
      if (targets.every(item => editor.features[item.type === "shape" ? "shapes" : item.type === "image" ? "images" : "text"])) items.push({
        id: "duplicate", label: "複製", shortcut: "Ctrl+D", disabled,
        onSelect: () => execute({ type: "element.duplicate", slideId: slide.id, elementIds: ids }),
      });
      if (editor.features.formatting) {
        items.push({ id: "front", label: "最前面へ", separatorBefore: true, disabled,
          onSelect: () => execute({ type: "element.order", slideId: slide.id, elementIds: ids, direction: "front" }) },
        { id: "back", label: "最背面へ", disabled,
          onSelect: () => execute({ type: "element.order", slideId: slide.id, elementIds: ids, direction: "back" }) },
        { id: "lock", label: targets.every(item => item.locked) ? "ロックを解除" : "ロック", disabled: !editor.editable,
          onSelect: () => execute(targets.map(item => ({ type: "element.update", slideId: slide.id, elementId: item.id,
            patch: { locked: !targets.every(target => target.locked) } }))) });
      }
      items.push({ id: "delete", label: "削除", shortcut: "Delete", danger: true, separatorBefore: true, disabled,
        onSelect: () => execute({ type: "element.delete", slideId: slide.id, elementIds: ids }) });
    }
    if (openMenu(event, items)) { cancelGesture(); editor.select({ slideId: slide.id, elementIds: ids }); }
  };
  const canvasMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (editing || (event.target as HTMLElement).closest?.("[data-slide-element],input,textarea,[contenteditable=true]")) return;
    const items: ContextMenuAction[] = [];
    const disabled = !editor.editable;
    if (!editor.readOnly) {
      if (slide) {
        const bounds = surface.current?.getBoundingClientRect();
        const x = bounds ? Math.max(0, Math.min(deck.width - 40, (event.clientX - bounds.left) / scale)) : deck.width * .2;
        const y = bounds ? Math.max(0, Math.min(deck.height - 40, (event.clientY - bounds.top) / scale)) : deck.height * .3;
        if (editor.canPasteElements()) items.push({ id: "paste", label: "貼り付け", shortcut: "Ctrl+V", disabled,
          onSelect: () => editor.pasteElements(slide.id, deck) });
        if (editor.features.text) items.push({ id: "add-text", label: "テキスト ボックスを追加", disabled,
          onSelect: () => editor.execute({ type: "element.add", slideId: slide.id, element: {
            type: "text", name: "テキスト ボックス", text: "テキストを入力", x, y, width: Math.min(480, deck.width - x), height: 100, fontSize: 32,
          } }, deck) });
        if (editor.features.shapes) items.push({ id: "add-shape", label: "四角形を追加", disabled,
          onSelect: () => editor.execute({ type: "element.add", slideId: slide.id, element: {
            type: "shape", shape: "rect", name: "四角形", x, y, width: 280, height: 160, fill: "#f5b39c", stroke: "#bd5030", strokeWidth: 2,
          } }, deck) });
        if (editor.features.images && onImage) items.push({ id: "add-image", label: "画像を追加", disabled, onSelect: () => onImage({ deck, slideId: slide.id }) });
      }
      if (editor.features.addSlides) items.push({ id: "add-slide", label: "新しいスライド", separatorBefore: items.length > 0, disabled,
        onSelect: () => editor.execute({ type: "slide.add", afterId: slide?.id }, deck) });
    }
    if (openMenu(event, items)) { cancelGesture(); if (slide) editor.select({ slideId: slide.id, elementIds: [] }); }
  };
  return <div ref={viewport} className="lxp-canvas-viewport" tabIndex={0} aria-label="スライド編集キャンバス"
    onContextMenu={canvasMenu}
    onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget && slide) editor.select({ slideId: slide.id, elementIds: [] }); }}>
    {slide ? <div className="lxp-canvas-center" style={{ minWidth: deck.width * scale + 80, minHeight: deck.height * scale + 64 }}>
      <div className="lxp-canvas-frame" style={{ width: deck.width * scale, height: deck.height * scale }}>
        <div ref={surface} className="lxp-canvas-surface" style={{ width: deck.width, height: deck.height, background: slide.background, transform: `scale(${scale})` }}
          onPointerDown={event => { if (event.button === 0 && event.target === event.currentTarget) { editor.select({ slideId: slide.id, elementIds: [] }); viewport.current?.focus(); } }}
          onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
          {slide.elements.map(original => {
            const element = { ...original, ...preview.get(original.id) } as SlideElement;
            const isSelected = selected.has(element.id);
            return <div key={element.id} className={`lxp-element lxp-canvas-element${isSelected ? " lxp-element-selected" : ""}`}
              data-slide-element={element.id} role="button" tabIndex={-1} aria-label={element.name || `${element.type} オブジェクト`} aria-pressed={isSelected}
              style={{ ...elementStyle(element), ...(moving && preview.has(element.id) ? { opacity: element.opacity * .62 } : {}) }} onPointerDown={event => begin(event, original, "move")}
              onContextMenu={event => elementMenu(event, original)}
              onDoubleClick={() => { if (editor.editable && editor.features.text && element.type !== "image" && !element.locked) setEditing({ id: element.id, text: element.text }); }}>
              <SlideElementContent element={element} />
              {isSelected && editor.editable && editor.features.formatting && !element.locked && <>
                {(["nw", "ne", "sw", "se"] as const).map(corner => <button key={corner} type="button" className={`lxp-resize-handle lxp-resize-${corner}`}
                  aria-label={`${element.name}の${{ nw: "左上", ne: "右上", sw: "左下", se: "右下" }[corner]}を変形`}
                  style={{ width: 8 / scale, height: 8 / scale }} onPointerDown={event => begin(event, original, "resize", corner)} />)}
                <button type="button" className="lxp-rotate-handle" aria-label={`${element.name}を回転`}
                  style={{ width: 20 / scale, height: 20 / scale, top: -30 / scale }} onPointerDown={event => begin(event, original, "rotate")}><RotateCw style={{ width: 13 / scale, height: 13 / scale }} /></button>
              </>}
            </div>;
          })}
          {editing && (() => {
            const element = slide.elements.find(item => item.id === editing.id);
            if (!element || element.type === "image") return null;
            return <textarea autoFocus className="lxp-canvas-text-editor" aria-label="オブジェクトのテキスト" value={editing.text}
              style={{ ...elementStyle(element), fontSize: element.fontSize, color: element.type === "text" ? element.color : element.textColor,
                background: element.fill === "transparent" ? slide.background : element.fill,
                fontFamily: element.type === "text" ? element.fontFamily : "inherit" }}
              onChange={event => setEditing({ id: element.id, text: event.target.value })} onBlur={commitText}
              onKeyDown={event => {
                if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) return;
                event.stopPropagation();
                if (event.key === "Escape") { event.preventDefault(); setEditing(null); }
                else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commitText(); }
              }} />;
          })()}
        </div>
      </div>
    </div> : <div className="lxp-empty-slide">左上の「新しいスライド」から始めましょう。</div>}
  </div>;
}

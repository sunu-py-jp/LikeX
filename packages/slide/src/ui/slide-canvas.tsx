"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { resolveSlideAppearance } from "../model/index";
import { findNearestConnectorPort, getConnectorPortPoints } from "../core";
import { getSlideConnectorOutline, getSlideLineEndpoints, getSlideLineRoute, isSlideLine, resolveSlideLines, slideLineGeometry, translateSlideLine } from "../model/lines";
import type { ContextMenuAction } from "../browser";
import type { Slide, SlideCommand, SlideDeck, SlideElement, SlideLineGeometry } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { startDragEdgeMotion } from "./drag-scroll";
import { elementStyle, SlideElementContent } from "./slide-artwork";
import { SlideCanvasElement } from "./slide-canvas-element";
import { useSlideContextMenu } from "./use-slide-context-menu";

type Geometry = Pick<SlideElement, "x" | "y" | "width" | "height" | "rotation"> & { line?: SlideLineGeometry };
type Corner = "nw" | "ne" | "sw" | "se";
type Gesture = { kind: "move" | "resize" | "rotate" | "start" | "end"; corner?: Corner; startX: number; startY: number; pointerId: number;
  captureTarget: HTMLElement; elements: SlideElement[]; updates: Map<string, Geometry>; centerX: number; centerY: number; startAngle: number; deck: SlideDeck; slideId: string; scale: number; scrollX: number; scrollY: number; lastX: number; lastY: number; shiftKey: boolean; altKey: boolean; stop(): void };
type MarqueeBox = { x: number; y: number; width: number; height: number };
type Marquee = { deck: SlideDeck; slide: Slide; scale: number; pointerId: number; startX: number; startY: number;
  originX: number; originY: number; scrollX: number; scrollY: number; lastX: number; lastY: number;
  originalIds: string[]; toggle: boolean; dragged: boolean; editable: boolean; formatting: boolean; stop(): void };

function containedByMarquee(element: SlideElement, box: MarqueeBox, elements: readonly SlideElement[]): boolean {
  if (isSlideLine(element)) {
    const { points } = getSlideLineRoute(element, elements);
    return points.every(point => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height);
  }
  const angle = element.rotation * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const halfWidth = (element.width * cos + element.height * sin) / 2;
  const halfHeight = (element.width * sin + element.height * cos) / 2;
  const centerX = element.x + element.width / 2, centerY = element.y + element.height / 2;
  const epsilon = 1e-7;
  return centerX - halfWidth >= box.x - epsilon && centerY - halfHeight >= box.y - epsilon
    && centerX + halfWidth <= box.x + box.width + epsilon && centerY + halfHeight <= box.y + box.height + epsilon;
}

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

export function SlideCanvas({ deck, slide, editor, zoom, onImage, onProperties }: { deck: SlideDeck; slide: Slide | undefined; editor: SlideEditor; zoom: number; onImage?(target: { deck: SlideDeck; slideId: string }): void; onProperties?(): void }) {
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [preview, setPreview] = useState<Map<string, Geometry>>(new Map());
  const [connecting, setConnecting] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const marquee = useRef<Marquee | null>(null);
  const [marqueePreview, setMarqueePreview] = useState<{ box: MarqueeBox; elementIds: string[] } | null>(null);
  const latest = useRef({ deck, slideId: slide?.id, editable: editor.editable, formatting: editor.features.formatting });
  useLayoutEffect(() => { latest.current = { deck, slideId: slide?.id, editable: editor.editable, formatting: editor.features.formatting }; });
  useLayoutEffect(() => () => { latest.current = { ...latest.current, slideId: undefined }; }, []);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [wasEditable, setWasEditable] = useState(editor.editable);
  if (wasEditable !== editor.editable) {
    setWasEditable(editor.editable);
    if (!editor.editable) { setPreview(new Map()); setEditing(null); }
  }
  const selected = new Set(marqueePreview?.elementIds ?? editor.selection.elementIds);
  const openMenu = useSlideContextMenu(editor);
  const scale = Math.max(.05, Math.min((size.width - 80) / deck.width, (size.height - 64) / deck.height)) * zoom / 100;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth || 900, height: node.clientHeight || 600 });
    const observer = new ResizeObserver(update); observer.observe(node); update();
    return () => observer.disconnect();
  }, []);
  function cancelGesture() { const current = gesture.current; gesture.current = null; current?.stop(); setPreview(new Map()); setConnecting(null); }
  function cancelMarquee() { const current = marquee.current; marquee.current = null; current?.stop(); setMarqueePreview(null); }
  useLayoutEffect(() => { const current = gesture.current; if (current && (current.deck !== deck || current.slideId !== slide?.id || !editor.editable || !editor.features.formatting)) cancelGesture(); }, [deck, slide?.id, editor.editable, editor.features.formatting]);
  useLayoutEffect(() => {
    const current = marquee.current;
    if (current && (current.deck !== deck || current.slide.id !== slide?.id || current.scale !== scale
      || current.editable !== editor.editable || current.formatting !== editor.features.formatting)) cancelMarquee();
  }, [deck, slide?.id, scale, editor.editable, editor.features.formatting]);
  useEffect(() => () => {
    const current = gesture.current; gesture.current = null; current?.stop();
    const selection = marquee.current; marquee.current = null; selection?.stop();
  }, []);

  function updateMarquee(current: Marquee) {
    if (latest.current.deck !== current.deck || latest.current.slideId !== current.slide.id
      || latest.current.editable !== current.editable || latest.current.formatting !== current.formatting) { cancelMarquee(); return null; }
    const scrollX = (viewport.current?.scrollLeft ?? 0) - current.scrollX, scrollY = (viewport.current?.scrollTop ?? 0) - current.scrollY;
    const dx = current.lastX - current.startX + scrollX, dy = current.lastY - current.startY + scrollY;
    if (!current.dragged && Math.hypot(dx, dy) < 3) return null;
    current.dragged = true;
    const x = current.originX + dx / current.scale, y = current.originY + dy / current.scale;
    const box = { x: Math.min(current.originX, x), y: Math.min(current.originY, y), width: Math.abs(x - current.originX), height: Math.abs(y - current.originY) };
    const containedIds = current.slide.elements.filter(element => containedByMarquee(element, box, current.slide.elements)).map(element => element.id);
    const original = new Set(current.originalIds), contained = new Set(containedIds);
    const elementIds = current.toggle
      ? [...current.originalIds.filter(id => !contained.has(id)), ...containedIds.filter(id => !original.has(id))]
      : containedIds;
    const next = { box, elementIds }; setMarqueePreview(next); return next;
  }
  function beginMarquee(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !slide || editing || gesture.current || marquee.current
      || (event.target as HTMLElement).closest?.("[data-slide-element],button,input,textarea,select,[contenteditable=true]")) return;
    const target = viewport.current, rect = surface.current?.getBoundingClientRect(), win = target?.ownerDocument.defaultView;
    if (!target || !rect || !win) return;
    event.preventDefault(); event.stopPropagation(); target.focus();
    const current: Marquee = { deck, slide, scale, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      originX: (event.clientX - rect.left) / scale, originY: (event.clientY - rect.top) / scale,
      scrollX: target.scrollLeft, scrollY: target.scrollTop, lastX: event.clientX, lastY: event.clientY,
      originalIds: [...editor.selection.elementIds], toggle: event.shiftKey || event.ctrlKey || event.metaKey, dragged: false,
      editable: editor.editable, formatting: editor.features.formatting, stop() {} };
    marquee.current = current;
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== current.pointerId || marquee.current !== current) return;
      current.lastX = event.clientX; current.lastY = event.clientY; updateMarquee(current);
    };
    const finish = (event: globalThis.PointerEvent) => {
      if (event.pointerId !== current.pointerId || marquee.current !== current) return;
      current.lastX = event.clientX; current.lastY = event.clientY;
      const result = updateMarquee(current);
      if (marquee.current !== current) return;
      marquee.current = null; current.stop(); setMarqueePreview(null);
      editor.select({ slideId: current.slide.id, elementIds: result?.elementIds ?? (current.toggle ? current.originalIds : []) });
    };
    const cancel = () => cancelMarquee();
    const lost = (event: globalThis.PointerEvent) => { if (event.pointerId === current.pointerId) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const stopMotion = startDragEdgeMotion(target, () => marquee.current === current && current.dragged ? { x: current.lastX, y: current.lastY } : null,
      (dx, dy) => { target.scrollLeft += dx; target.scrollTop += dy; updateMarquee(current); });
    current.stop = () => {
      stopMotion(); win.removeEventListener("pointermove", move); win.removeEventListener("pointerup", finish);
      win.removeEventListener("pointercancel", lost); win.removeEventListener("keydown", key, true); win.removeEventListener("blur", cancel);
      target.removeEventListener("lostpointercapture", lost);
      if (target.hasPointerCapture?.(current.pointerId)) target.releasePointerCapture(current.pointerId);
    };
    win.addEventListener("pointermove", move); win.addEventListener("pointerup", finish); win.addEventListener("pointercancel", lost);
    win.addEventListener("keydown", key, true); win.addEventListener("blur", cancel); target.addEventListener("lostpointercapture", lost);
    target.setPointerCapture?.(event.pointerId);
  }

  const begin = (event: PointerEvent<HTMLElement>, element: SlideElement, kind: Gesture["kind"], corner?: Corner) => {
    if (event.button !== 0 || !slide || editing || marquee.current) return;
    event.stopPropagation(); event.preventDefault();
    viewport.current?.focus();
    const ids = (event.shiftKey || event.ctrlKey || event.metaKey) && kind === "move" ? (selected.has(element.id) ? editor.selection.elementIds.filter(id => id !== element.id) : [...editor.selection.elementIds, element.id])
      : selected.has(element.id) ? editor.selection.elementIds : [element.id];
    editor.select({ slideId: slide.id, elementIds: ids });
    if (!ids.includes(element.id) || !editor.editable || !editor.features.formatting || element.locked) return;
    setConnecting(null);
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
      if (isSlideLine(element) && (current.kind === "start" || current.kind === "end")) {
        const previous = getSlideLineEndpoints(element), point = { x: previous[current.kind].x + dx, y: previous[current.kind].y + dy };
        const targets = slide!.elements.filter(item => !isSlideLine(item)).map(item => ({ id: item.id, box: item, outline: getSlideConnectorOutline(item) }));
        const nearby = findNearestConnectorPort(point, targets, 32 / current.scale);
        setConnecting(nearby?.binding.targetId ?? null);
        const snap = findNearestConnectorPort(point, targets, 12 / current.scale);
        const line = { ...previous, [current.kind]: snap ? { ...snap.point, binding: snap.binding } : point };
        next.set(element.id, { ...slideLineGeometry(line), line });
      } else if (current.kind === "move") {
        const geometry = { ...element, x: element.x + dx, y: element.y + dy };
        if (isSlideLine(element)) {
          const line = translateSlideLine(element, dx, dy, new Set(current.elements.map(item => item.id)));
          next.set(element.id, { ...slideLineGeometry(line), line });
        } else next.set(element.id, geometry);
      }
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
    gesture.current = null; current.stop(); setPreview(new Map()); setConnecting(null);
    if (!cancel && latest.current.deck === current.deck && latest.current.slideId === current.slideId && latest.current.editable && latest.current.formatting && current.updates.size) {
      void editor.execute([...current.updates].map(([elementId, geometry]): SlideCommand => geometry.line ? ({ type: "line.update", slideId: current.slideId, elementId, start: geometry.line.start, end: geometry.line.end }) : ({
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
    if (onProperties) items.push({ id: "format", label: "書式設定", separatorBefore: true, onSelect: () => {
      if (latest.current.deck !== deck || latest.current.slideId !== slide.id) return;
      editor.select({ slideId: slide.id, elementIds: ids });
      onProperties();
    } });
    if (openMenu(event, items)) { cancelGesture(); cancelMarquee(); editor.select({ slideId: slide.id, elementIds: ids }); }
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
        onSelect: () => editor.execute({ type: "slide.add", afterId: slide?.id, ...(editor.features.masters && slide?.layoutId ? { layoutId: slide.layoutId } : {}) }, deck) });
    }
    if (openMenu(event, items)) { cancelGesture(); cancelMarquee(); if (slide) editor.select({ slideId: slide.id, elementIds: [] }); }
  };
  const appearance = slide ? resolveSlideAppearance(deck, slide) : undefined;
  const searchElementId = editor.features.search && editor.search.open && editor.searchMatch?.slideId === slide?.id ? editor.searchMatch?.elementId : undefined;
  const renderedElements = slide ? resolveSlideLines(slide.elements.map(element => ({ ...element, ...preview.get(element.id) } as SlideElement))) : [];
  return <div ref={viewport} className="lxp-canvas-viewport" tabIndex={0} aria-label="スライド編集キャンバス" data-slide-selection-scope="elements"
    onContextMenu={canvasMenu}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) cancelMarquee(); }}
    onPointerDown={beginMarquee}>
    {slide ? <div className="lxp-canvas-center" style={{ minWidth: deck.width * scale + 80, minHeight: deck.height * scale + 64 }}>
      <div className="lxp-canvas-frame" style={{ width: deck.width * scale, height: deck.height * scale }}>
        <div ref={surface} className="lxp-canvas-surface" style={{ width: deck.width, height: deck.height, background: appearance?.background, transform: `scale(${scale})` }}
          onPointerDown={beginMarquee}
          onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
          {appearance?.inheritedElements.map((element, index) => <div key={`inherited:${index}:${element.id}`} aria-hidden="true" className="lxp-element lxp-inherited-element" style={elementStyle(element)}><SlideElementContent element={element} elements={appearance.inheritedElements} /></div>)}
          {renderedElements.map(element => <SlideCanvasElement key={element.id} element={element} elements={renderedElements}
            original={slide.elements.find(item => item.id === element.id)!} selected={selected.has(element.id)}
            editable={editor.editable} formatting={editor.features.formatting} textEnabled={editor.features.text}
            moving={moving && preview.has(element.id)} scale={scale} onBegin={begin} onMenu={elementMenu} onEdit={setEditing} />)}
          {searchElementId && [...appearance?.inheritedElements ?? [], ...renderedElements].filter(element => element.id === searchElementId).map(element =>
            <div key={`search:${element.id}`} className="lxp-search-highlight" data-slide-search-highlight={element.id} aria-hidden="true"
              style={{ ...elementStyle(element), opacity: 1, borderWidth: 3 / scale }} />)}
          {connecting && renderedElements.filter(element => element.id === connecting).flatMap(element => getConnectorPortPoints(element, getSlideConnectorOutline(element)).map(({ port, point }) => <div key={`${element.id}:${port}`} className="lxp-connection-port" data-connection-target={element.id} data-connection-port={port} style={{ left: point.x, top: point.y, width: 7 / scale, height: 7 / scale }} />))}
          {marqueePreview && <div className="lxp-canvas-marquee" aria-hidden="true" style={{ left: marqueePreview.box.x, top: marqueePreview.box.y,
            width: marqueePreview.box.width, height: marqueePreview.box.height, borderWidth: 1 / scale }} />}
          {editing && (() => {
            const element = slide.elements.find(item => item.id === editing.id);
            if (!element || element.type === "image") return null;
            return <textarea autoFocus className="lxp-canvas-text-editor" aria-label="オブジェクトのテキスト" value={editing.text}
              style={{ ...elementStyle(element), fontSize: element.fontSize, color: element.type === "text" ? element.color : element.textColor,
                background: element.fill === "transparent" ? appearance?.background : element.fill,
                fontFamily: element.type === "text" ? element.fontFamily : "inherit" }}
              onChange={event => setEditing({ id: element.id, text: event.target.value })} onBlur={commitText}
              onKeyDown={event => {
                if (["s", "f"].includes(event.key.toLowerCase()) && (event.ctrlKey || event.metaKey)) return;
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

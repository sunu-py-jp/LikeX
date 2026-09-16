"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { RotateCw } from "lucide-react";
import type { Slide, SlideCommand, SlideDeck, SlideElement } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { elementStyle, SlideElementContent } from "./slide-artwork";

type Geometry = Pick<SlideElement, "x" | "y" | "width" | "height" | "rotation">;
type Corner = "nw" | "ne" | "sw" | "se";
type Gesture = { kind: "move" | "resize" | "rotate"; corner?: Corner; startX: number; startY: number; pointerId: number;
  captureTarget: HTMLElement; elements: SlideElement[]; updates: Map<string, Geometry>; centerX: number; centerY: number; startAngle: number };

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

export function SlideCanvas({ deck, slide, editor, zoom }: { deck: SlideDeck; slide: Slide | undefined; editor: SlideEditor; zoom: number }) {
  const viewport = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const [preview, setPreview] = useState<Map<string, Geometry>>(new Map());
  const gesture = useRef<Gesture | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [wasEditable, setWasEditable] = useState(editor.editable);
  if (wasEditable !== editor.editable) {
    setWasEditable(editor.editable);
    if (!editor.editable) { setPreview(new Map()); setEditing(null); }
  }
  const selected = new Set(editor.selection.elementIds);
  const scale = Math.max(.05, Math.min((size.width - 80) / deck.width, (size.height - 64) / deck.height)) * zoom / 100;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setSize({ width: node.clientWidth || 900, height: node.clientHeight || 600 });
    const observer = new ResizeObserver(update); observer.observe(node); update();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!editor.editable) gesture.current = null;
  }, [editor.editable]);

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
      updates: new Map(), centerX, centerY, startAngle: Math.atan2(event.clientY - centerY, event.clientX - centerX) };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = (event.clientX - current.startX) / scale, dy = (event.clientY - current.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) < 1 && !current.updates.size) return;
    const next = new Map<string, Geometry>();
    for (const element of current.elements) {
      if (current.kind === "move") next.set(element.id, { ...element, x: element.x + dx, y: element.y + dy });
      else if (current.kind === "resize") next.set(element.id, resized(element, dx, dy, current.corner!, (element.type === "image" && !event.altKey) || event.shiftKey));
      else {
        let rotation = element.rotation + (Math.atan2(event.clientY - current.centerY, event.clientX - current.centerX) - current.startAngle) * 180 / Math.PI;
        if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
        next.set(element.id, { ...element, rotation });
      }
    }
    current.updates = next; setPreview(next);
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null; setPreview(new Map());
    if (current.captureTarget.hasPointerCapture(event.pointerId)) current.captureTarget.releasePointerCapture(event.pointerId);
    if (!cancel && slide && current.updates.size) {
      void editor.execute([...current.updates].map(([elementId, geometry]): SlideCommand => ({
        type: "element.update", slideId: slide.id, elementId,
        patch: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation },
      })));
    }
  };
  const commitText = () => {
    if (!editing || !slide) return;
    const current = editing; setEditing(null);
    void editor.execute({ type: "element.update", slideId: slide.id, elementId: current.id, patch: { text: current.text } });
  };
  return <div ref={viewport} className="lxp-canvas-viewport" tabIndex={0} aria-label="スライド編集キャンバス"
    onPointerDown={event => { if (event.target === event.currentTarget && slide) editor.select({ slideId: slide.id, elementIds: [] }); }}>
    {slide ? <div className="lxp-canvas-center" style={{ minWidth: deck.width * scale + 80, minHeight: deck.height * scale + 64 }}>
      <div className="lxp-canvas-frame" style={{ width: deck.width * scale, height: deck.height * scale }}>
        <div ref={surface} className="lxp-canvas-surface" style={{ width: deck.width, height: deck.height, background: slide.background, transform: `scale(${scale})` }}
          onPointerDown={event => { if (event.target === event.currentTarget) { editor.select({ slideId: slide.id, elementIds: [] }); viewport.current?.focus(); } }}
          onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}>
          {slide.elements.map(original => {
            const element = { ...original, ...preview.get(original.id) } as SlideElement;
            const isSelected = selected.has(element.id);
            return <div key={element.id} className={`lxp-element lxp-canvas-element${isSelected ? " lxp-element-selected" : ""}`}
              data-slide-element={element.id} role="button" tabIndex={-1} aria-label={element.name || `${element.type} オブジェクト`} aria-pressed={isSelected}
              style={elementStyle(element)} onPointerDown={event => begin(event, original, "move")}
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

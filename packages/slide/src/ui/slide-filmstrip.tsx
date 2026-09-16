"use client";

import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideArtwork } from "./slide-artwork";

export function SlideFilmstrip({ editor }: { editor: SlideEditor }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const { deck } = editor;
  return <aside className="lxp-filmstrip" aria-label="スライド一覧">
    <div className="lxp-filmstrip-heading"><span>スライド</span><span>{deck.slides.length}</span></div>
    <ol className="lxp-slide-list">
      {deck.slides.map((slide, index) => <li key={slide.id} className={`lxp-slide-item${editor.selection.slideId === slide.id ? " is-selected" : ""}${dropId === slide.id ? " is-drop-target" : ""}`}
        draggable={editor.editable && editor.features.reorderSlides}
        onDragStart={event => { if (!editor.editable || !editor.features.reorderSlides) { event.preventDefault(); return; } setDragId(slide.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-likex-slide", slide.id); }}
        onDragEnd={() => { setDragId(null); setDropId(null); }}
        onDragOver={event => { if (dragId && dragId !== slide.id && editor.editable && editor.features.reorderSlides) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropId(slide.id); } }}
        onDragLeave={() => setDropId(null)} onDrop={event => { event.preventDefault(); setDropId(null); if (dragId && editor.editable && editor.features.reorderSlides) void editor.execute({ type: "slide.move", slideId: dragId, index }); setDragId(null); }}>
        <span className="lxp-slide-number">{index + 1}</span>
        <div className="lxp-slide-item-main">
          <button type="button" className="lxp-slide-thumbnail" aria-label={`スライド ${index + 1}: ${slide.name}`} aria-current={editor.selection.slideId === slide.id ? "true" : undefined}
            style={{ aspectRatio: `${deck.width}/${deck.height}` }} onClick={() => editor.select({ slideId: slide.id, elementIds: [] })}>
            <SlideArtwork deck={deck} slide={slide} scale={164 / deck.width} />
          </button>
          <div className="lxp-slide-caption"><span title={slide.name}>{slide.name}</span>
            {editor.features.addSlides && !editor.readOnly && <button type="button" aria-label={`${slide.name}を複製`} title="スライドを複製" disabled={!editor.editable}
              onClick={() => void editor.execute({ type: "slide.duplicate", slideId: slide.id })}><Copy size={12} /></button>}
            {editor.features.deleteSlides && !editor.readOnly && <button type="button" aria-label={`${slide.name}を削除`} title="スライドを削除" disabled={!editor.editable}
              onClick={() => void editor.execute({ type: "slide.delete", slideId: slide.id })}><Trash2 size={12} /></button>}
          </div>
        </div>
      </li>)}
    </ol>
    {editor.features.addSlides && !editor.readOnly && <button type="button" className="lxp-new-slide" disabled={!editor.editable}
      onClick={() => void editor.execute({ type: "slide.add", afterId: editor.selection.slideId || undefined })}><Plus size={16} />新しいスライド</button>}
  </aside>;
}

"use client";

import { useState, type ReactNode } from "react";
import { Lock, Unlock, X } from "lucide-react";
import type { SlideCommand, SlideElement, SlideElementPatch } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideAnimations } from "./slide-animations";

function NumericField({ label, value, min, max, onCommit, disabled }: { label: string; value: number; min?: number; max?: number; disabled: boolean; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim()) { const parsed = Number(draft); if (Number.isFinite(parsed)) onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))); } setDraft(null); };
  return <label className="lxp-field"><span>{label}</span><input type="number" value={draft ?? Number(value.toFixed(1))} min={min} max={max} disabled={disabled}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") setDraft(null); }} /></label>;
}

export function ColorField({ label, value, onChange, disabled, transparent = false }: { label: string; value: string; onChange(value: string): void; disabled: boolean; transparent?: boolean }) {
  return <div className="lxp-color-field"><label><span>{label}</span><input type="color" value={/^#[\da-f]{6}$/i.test(value) ? value : "#ffffff"}
    aria-label={label} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>
    {transparent && <label className="lxp-checkbox-label"><input type="checkbox" checked={value === "transparent"} disabled={disabled} onChange={event => onChange(event.target.checked ? "transparent" : "#ffffff")} />塗りつぶしなし</label>}
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="lxp-property-section"><h3>{title}</h3>{children}</section>;
}

function TextValue({ value, label, disabled, onCommit }: { value: string; label: string; disabled: boolean; onCommit(value: string): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label className="lxp-field lxp-text-field"><span>{label}</span><textarea value={draft ?? value} disabled={disabled} rows={3}
    onChange={event => setDraft(event.target.value)} onBlur={() => { if (draft !== null && draft !== value) onCommit(draft); setDraft(null); }} /></label>;
}

export function SlideProperties({ editor, onClose }: { editor: SlideEditor; onClose(): void }) {
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId);
  const elements = slide?.elements.filter(item => editor.selection.elementIds.includes(item.id)) ?? [];
  const first = elements[0];
  const disabled = !editor.editable;
  const update = (patch: SlideElementPatch, targets: SlideElement[] = elements) => {
    if (slide) void editor.execute(targets.map((element): SlideCommand => ({ type: "element.update", slideId: slide.id, elementId: element.id, patch })));
  };
  return <aside className="lxp-properties" aria-label="書式設定">
    <div className="lxp-properties-heading"><h2>{first ? "オブジェクトの書式" : "スライドの書式"}</h2><button type="button" aria-label="書式設定を閉じる" onClick={onClose}><X size={16} /></button></div>
    <div className="lxp-properties-body">
      {!slide ? <p className="lxp-muted">スライドを選択してください。</p> : !first ? <>
        <Section title="スライド"><label className="lxp-field"><span>名前</span><input key={`${slide.id}:${slide.name}`} defaultValue={slide.name} disabled={disabled}
          onBlur={event => {
            const name = event.target.value;
            if (name.trim() && name !== slide.name) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { name } });
            event.target.value = slide.name;
          }} /></label>
          {editor.features.formatting && <ColorField label="背景の色" value={slide.background} disabled={disabled} onChange={background => void editor.execute({ type: "slide.update", slideId: slide.id, patch: { background } })} />}
        </Section>
        <Section title="ページサイズ"><p className="lxp-muted">{Number(editor.deck.width.toFixed(1))} × {Number(editor.deck.height.toFixed(1))} px</p>
          {editor.features.formatting && <div className="lxp-preset-buttons">
            <button type="button" disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 1280, height: 720 })}>ワイド 16:9</button>
            <button type="button" disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 960, height: 720 })}>標準 4:3</button>
          </div>}
        </Section>
      </> : <>
        <p className="lxp-properties-selection">{elements.length > 1 ? `${elements.length} 個のオブジェクトを選択` : first.name}</p>
        {editor.features.formatting && <Section title="サイズと位置">
          <div className="lxp-property-grid">
            {(["x", "y", "width", "height", "rotation"] as const).map(key => <NumericField key={`${first.id}:${key}`} label={{ x: "横位置", y: "縦位置", width: "幅", height: "高さ", rotation: "回転 (°)" }[key]}
              value={first[key]} min={key === "width" || key === "height" ? 1 : undefined} disabled={disabled || first.locked} onCommit={value => update({ [key]: value })} />)}
          </div>
          <label className="lxp-field"><span>不透明度</span><input type="range" min={0} max={100} value={Math.round(first.opacity * 100)} disabled={disabled} aria-label="不透明度"
            onChange={event => update({ opacity: Number(event.target.value) / 100 })} /></label>
          <button type="button" className="lxp-property-button" disabled={disabled} aria-pressed={first.locked} onClick={() => update({ locked: !first.locked })}>
            {first.locked ? <Lock size={14} /> : <Unlock size={14} />}{first.locked ? "ロックを解除" : "位置をロック"}</button>
        </Section>}
        {first.type !== "image" && <>
          {editor.features.text && <Section title="テキスト"><TextValue key={first.id} label="内容" value={first.text} disabled={disabled || first.locked}
            onCommit={text => update({ text }, elements.filter(item => item.type !== "image"))} /></Section>}
          {editor.features.formatting && <Section title="文字と塗りつぶし">
            <NumericField label="文字サイズ" value={first.fontSize} min={1} max={400} disabled={disabled} onCommit={fontSize => update({ fontSize }, elements.filter(item => item.type !== "image"))} />
            <ColorField label="文字の色" value={first.type === "text" ? first.color : first.textColor} disabled={disabled}
              onChange={color => { if (slide) void editor.execute(elements.filter(item => item.type !== "image").map((element): SlideCommand => ({ type: "element.update", slideId: slide.id, elementId: element.id, patch: element.type === "text" ? { color } : { textColor: color } }))); }} />
            <ColorField label="塗りつぶし" value={first.fill} disabled={disabled} transparent onChange={fill => update({ fill }, elements.filter(item => item.type !== "image"))} />
            {first.type === "shape" && <><ColorField label="枠線の色" value={first.stroke} disabled={disabled} transparent onChange={stroke => update({ stroke }, elements.filter(item => item.type === "shape"))} />
              <NumericField label="枠線の太さ" value={first.strokeWidth} min={0} max={32} disabled={disabled} onCommit={strokeWidth => update({ strokeWidth }, elements.filter(item => item.type === "shape"))} /></>}
          </Section>}
        </>}
        {first.type === "image" && <Section title="画像"><TextValue key={first.id} label="代替テキスト" value={first.alt} disabled={disabled} onCommit={alt => update({ alt }, elements.filter(item => item.type === "image"))} />
          <p className="lxp-muted">角をドラッグすると縦横比を保ってサイズを変更できます。</p></Section>}
      </>}
      <SlideAnimations editor={editor} />
    </div>
  </aside>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { SlideAnimationNode, SlideAnimationProperties, SlideAnimationStep, SlideDeck, SlideElement } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";

type Tween = Extract<SlideAnimationNode, { type: "tween" }>;
type Property = keyof SlideAnimationProperties;
const numeric: Property[] = ["x", "y", "width", "height", "rotation", "opacity", "fontSize", "strokeWidth"];
const labels: Record<Property, string> = { x: "横位置", y: "縦位置", width: "幅", height: "高さ", rotation: "回転", opacity: "不透明度", fontSize: "文字サイズ", strokeWidth: "枠線の太さ", fill: "塗りつぶし", stroke: "枠線の色", color: "文字色", textColor: "図形の文字色" };
const easingNames = { linear: "一定", "ease-in": "ゆっくり開始", "ease-out": "ゆっくり終了", "ease-in-out": "滑らか", spring: "ばね", bounce: "バウンド" };
const elementLabel = (element: SlideElement) => element.name || `${element.type} (${element.id})`;
const moved = (value: number) => value >= 100_000 ? value - 80 : Math.min(100_000, value + 80);
const tween = (element: SlideElement): Tween => ({ type: "tween", elementId: element.id, durationMs: 600, easing: "ease-out", to: { x: moved(element.x) } });

export function createMoveAnimation(elements: readonly SlideElement[]): SlideAnimationStep {
  return { id: crypto.randomUUID(), name: "移動", trigger: { type: "click" },
    animation: elements.length === 1 ? tween(elements[0]) : { type: "parallel", children: elements.map(tween) } };
}

function allowedProperties(element: SlideElement): Property[] {
  return ["x", "y", "width", "height", "rotation", "opacity", ...(element.type === "image" ? [] : ["fontSize", "fill", element.type === "text" ? "color" : "textColor"]), ...(element.type === "shape" ? ["strokeWidth", "stroke"] : [])] as Property[];
}
function lockedNode(node: SlideAnimationNode, elements: readonly SlideElement[]): boolean {
  return node.type === "tween" ? !!elements.find(element => element.id === node.elementId)?.locked : node.children.some(child => lockedNode(child, elements));
}
function lockedStep(step: SlideAnimationStep, elements: readonly SlideElement[]): boolean {
  const clickTarget = step.trigger?.type === "click" ? step.trigger.elementId : undefined;
  return lockedNode(step.animation, elements) || !!elements.find(element => element.id === clickTarget)?.locked;
}
function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const next = [...items], target = index + direction;
  if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]];
  return next;
}
function additionalTween(node: SlideAnimationNode, elements: readonly SlideElement[]): Tween | undefined {
  if (node.type !== "parallel") { const target = elements.find(element => !element.locked); return target ? tween(target) : undefined; }
  const used = new Map<string, Set<string>>();
  const visit = (item: SlideAnimationNode) => {
    if (item.type !== "tween") { item.children.forEach(visit); return; }
    const keys = used.get(item.elementId) ?? new Set<string>();
    for (const key of [...Object.keys(item.to), ...Object.keys(item.from ?? {})]) keys.add(key);
    used.set(item.elementId, keys);
  };
  visit(node);
  for (const target of elements.filter(element => !element.locked)) {
    const key = allowedProperties(target).find(key => !used.get(target.id)?.has(key));
    if (key) return key === "x" ? tween(target) : { type: "tween", elementId: target.id, durationMs: 600, to: { [key]: key === "y" ? moved(target.y) : Reflect.get(target, key) } };
  }
}

/** Buffered text/number edits remember the model they started from, including blur after selection changes. */
function ValueField({ label, value, revision, disabled, onCommit, type = "number", min, max, step }: {
  label: string; value: string | number; revision: SlideDeck; disabled: boolean; type?: "number" | "text";
  min?: number; max?: number; step?: number; onCommit(value: string, revision: SlideDeck): void;
}) {
  const [draft, setDraft] = useState<{ value: string; revision: SlideDeck } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const commit = () => {
    if (!mounted.current) return;
    if (draft && !disabled && draft.value !== String(value) && (type === "text" || draft.value.trim() && Number.isFinite(Number(draft.value)))) onCommit(draft.value, draft.revision);
    setDraft(null);
  };
  return <label className="lxp-field"><span>{label}</span><input aria-label={label} type={type} min={min} max={max} step={step}
    value={draft?.value ?? value} disabled={disabled} onChange={event => setDraft(previous => ({ value: event.target.value, revision: previous?.revision ?? revision }))}
    onBlur={commit} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(null); }
    }} /></label>;
}

function Properties({ label, value, element, revision, disabled, required, onChange }: {
  label: string; value: SlideAnimationProperties; element: SlideElement; revision: SlideDeck; disabled: boolean; required?: boolean;
  onChange(value: SlideAnimationProperties, revision?: SlideDeck): void;
}) {
  const allowed = allowedProperties(element), keys = Object.keys(value) as Property[], remaining = allowed.filter(key => value[key] === undefined);
  const [chosen, setChosen] = useState<Property>("opacity");
  const property = remaining.includes(chosen) ? chosen : remaining[0];
  return <fieldset className="lxp-animation-properties"><legend>{label}</legend>
    {keys.map(key => <div className="lxp-animation-property" key={key}>
      {numeric.includes(key) ? <ValueField label={`${label} ${labels[key]}`} value={Number(value[key])} revision={revision} disabled={disabled}
        min={key === "opacity" || key === "strokeWidth" ? 0 : key === "width" || key === "height" || key === "fontSize" ? 1 : undefined}
        max={key === "opacity" ? 1 : undefined} step={key === "opacity" ? .05 : 1}
        onCommit={(next, baseline) => onChange({ ...value, [key]: Number(next) }, baseline)} />
        : <label className="lxp-field"><span>{labels[key]}</span><input aria-label={`${label} ${labels[key]}`} type="color" disabled={disabled}
          value={value[key] === "transparent" ? "#ffffff" : String(value[key]).slice(0, 7)} onChange={event => onChange({ ...value, [key]: event.target.value })} /></label>}
      {!numeric.includes(key) && /^#[\da-f]{8}$/i.test(String(value[key])) && <p className="lxp-muted">色を選び直すと、色は不透明になります。</p>}
      {!numeric.includes(key) && <label className="lxp-checkbox-label"><input type="checkbox" aria-label={`${label} ${labels[key]} 透明`} disabled={disabled}
        checked={value[key] === "transparent"} onChange={event => onChange({ ...value, [key]: event.target.checked ? "transparent" : "#ffffff" })} />透明</label>}
      <button type="button" className="lxp-animation-remove" aria-label={`${label} ${labels[key]}を除く`} disabled={disabled || required && keys.length <= 1}
        onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}>除く</button>
    </div>)}
    {remaining.length > 0 && <div className="lxp-animation-add-row"><select aria-label={`${label} 追加するプロパティ`} value={property} disabled={disabled} onChange={event => setChosen(event.target.value as Property)}>
      {remaining.map(key => <option key={key} value={key}>{labels[key]}</option>)}
    </select><button type="button" disabled={disabled} onClick={() => { if (property) onChange({ ...value, [property]: Reflect.get(element, property) }); }}>追加</button></div>}
  </fieldset>;
}

function NodeEditor({ node, elements, revision, disabled, onChange, level = 0 }: {
  node: SlideAnimationNode; elements: readonly SlideElement[]; revision: SlideDeck; disabled: boolean; level?: number;
  onChange(node: SlideAnimationNode, revision?: SlideDeck): void;
}) {
  const element = node.type === "tween" ? elements.find(item => item.id === node.elementId) : undefined;
  const first = elements.find(item => !item.locked);
  const addition = node.type === "tween" ? undefined : additionalTween(node, elements);
  return <div className="lxp-animation-node" data-animation-node={node.type}>
    <label className="lxp-field"><span>構成</span><select aria-label={`構成 ${level + 1}`} value={node.type} disabled={disabled} onChange={event => {
      const type = event.target.value as SlideAnimationNode["type"];
      if (type === "tween") { if (first) onChange(node.type === "tween" ? node : firstTween(node) ?? tween(first)); }
      else onChange({ type, children: node.type === "tween" ? [node] : node.children });
    }}><option value="tween">1つの動き</option><option value="sequence">順番に再生</option><option value="parallel">同時に再生</option></select></label>
    {node.type !== "tween" ? <>
      {node.children.map((child, index) => <div className="lxp-animation-child" key={index}><div className="lxp-animation-child-heading"><span>動き {index + 1}</span><div className="lxp-animation-order">
        <button type="button" disabled={disabled || index === 0} aria-label={`動き ${index + 1} を上へ`} onClick={() => onChange({ ...node, children: moveItem(node.children, index, -1) })}>↑</button>
        <button type="button" disabled={disabled || index === node.children.length - 1} aria-label={`動き ${index + 1} を下へ`} onClick={() => onChange({ ...node, children: moveItem(node.children, index, 1) })}>↓</button>
        <button type="button" disabled={disabled || node.children.length <= 1} aria-label={`動き ${index + 1} を削除`} onClick={() => onChange({ ...node, children: node.children.filter((_, i) => i !== index) })}>削除</button></div></div>
        <NodeEditor node={child} elements={elements} revision={revision} disabled={disabled} level={level + 1} onChange={(next, baseline) => onChange({ ...node, children: node.children.map((item, i) => i === index ? next : item) }, baseline)} /></div>)}
      <button type="button" className="lxp-property-button" disabled={disabled || !addition} onClick={() => { if (addition) onChange({ ...node, children: [...node.children, addition] }); }}>動きを追加</button>
    </> : <>
      <label className="lxp-field"><span>対象</span><select aria-label="動きの対象" value={node.elementId} disabled={disabled} onChange={event => {
        const nextElement = elements.find(item => item.id === event.target.value);
        if (!nextElement || nextElement.locked) return;
        const allowed = allowedProperties(nextElement);
        const retain = (properties: SlideAnimationProperties) => Object.fromEntries(Object.entries(properties).filter(([key]) => allowed.includes(key as Property)));
        const to = retain(node.to), from = node.from ? retain(node.from) : undefined;
        onChange({ ...node, elementId: nextElement.id, to: Object.keys(to).length ? to : { opacity: nextElement.opacity }, ...(from && Object.keys(from).length ? { from } : { from: undefined }) });
      }}>{elements.map(item => <option key={item.id} value={item.id} disabled={item.locked}>{elementLabel(item)}{item.locked ? "（ロック）" : ""}</option>)}</select></label>
      <ValueField label="所要時間 (ms)" value={node.durationMs} revision={revision} disabled={disabled} min={1} step={50} onCommit={(value, baseline) => onChange({ ...node, durationMs: Number(value) }, baseline)} />
      <ValueField label="開始までの待ち時間 (ms)" value={node.delayMs ?? 0} revision={revision} disabled={disabled} min={0} step={50} onCommit={(value, baseline) => onChange({ ...node, delayMs: Number(value) }, baseline)} />
      <label className="lxp-field"><span>速度の変化</span><select aria-label="速度の変化" value={node.easing ?? "linear"} disabled={disabled} onChange={event => onChange({ ...node, easing: event.target.value as Tween["easing"] })}>
        {Object.entries(easingNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <ValueField label="繰り返し回数" value={node.repeat ?? 1} revision={revision} disabled={disabled} min={1} max={100} step={1} onCommit={(value, baseline) => onChange({ ...node, repeat: Number(value) }, baseline)} />
      <label className="lxp-checkbox-label"><input type="checkbox" aria-label="往復して再生" checked={node.yoyo ?? false} disabled={disabled} onChange={event => onChange({ ...node, yoyo: event.target.checked })} />往復して再生</label>
      {element && <>
        <Properties label="終了値" value={node.to} element={element} revision={revision} disabled={disabled} required onChange={(to, baseline) => onChange({ ...node, to }, baseline)} />
        <label className="lxp-checkbox-label"><input type="checkbox" aria-label="開始値を指定" checked={!!node.from} disabled={disabled} onChange={event => {
          const { from: _from, ...rest } = node; void _from;
          onChange(event.target.checked ? { ...rest, from: Object.fromEntries(Object.keys(node.to).map(key => [key, Reflect.get(element, key)])) } : rest);
        }} />開始値を指定</label>
        {node.from && <Properties label="開始値" value={node.from} element={element} revision={revision} disabled={disabled} required onChange={(from, baseline) => onChange({ ...node, from }, baseline)} />}
      </>}
    </>}
  </div>;
}
function firstTween(node: SlideAnimationNode): Tween | undefined {
  if (node.type === "tween") return node;
  for (const child of node.children) { const result = firstTween(child); if (result) return result; }
}

function AnimationPanel({ editor }: { editor: SlideEditor }) {
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId)!;
  const animations = slide.animations ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState(editor.selection.elementIds[0] ?? slide.elements.find(item => !item.locked)?.id ?? "");
  const selected = animations.find(item => item.id === selectedId) ?? animations[0];
  const target = slide.elements.find(item => item.id === targetId) ?? slide.elements.find(item => !item.locked);
  const locked = !!selected && lockedStep(selected, slide.elements);
  const selectedIndex = animations.findIndex(item => item.id === selected?.id);
  const disabled = !editor.editable || locked;
  const update = (next: SlideAnimationStep, baseline = editor.deck) => {
    if (!selected || disabled) return;
    void editor.execute({ type: "animation.set", slideId: slide.id, animations: animations.map(item => item.id === selected.id ? next : item) }, baseline);
  };
  return <>
    <p className="lxp-muted">動きをステップ順に再生します。各ステップを順番・同時のグループにまとめられます。</p>
    <p className="lxp-muted">開始値は動きの開始時に適用します。クリック待機中は元の表示を保ちます。透明な状態から始めたい場合は、開始値に不透明度0を指定してください。</p>
    <label className="lxp-field"><span>追加する対象</span><select aria-label="アニメーションを追加する対象" value={target?.id ?? ""} disabled={!editor.editable} onChange={event => setTargetId(event.target.value)}>
      {!slide.elements.length && <option value="">オブジェクトなし</option>}
      {slide.elements.map(item => <option key={item.id} value={item.id} disabled={item.locked}>{elementLabel(item)}{item.locked ? "（ロック）" : ""}</option>)}
    </select></label>
    {!editor.readOnly && <button type="button" className="lxp-property-button" disabled={!editor.editable || !target || target.locked} onClick={() => {
      if (!target || target.locked) return;
      const next = createMoveAnimation([target]);
      void editor.execute({ type: "animation.set", slideId: slide.id, animations: [...animations, next] }, editor.deck).then(result => { if (result?.changed) setSelectedId(next.id); });
    }}>ステップを追加</button>}
    {animations.length ? <>
      <label className="lxp-field lxp-animation-step-picker"><span>ステップ</span><select aria-label="編集するアニメーション" value={selected?.id} onChange={event => setSelectedId(event.target.value)}>
        {animations.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.name || "アニメーション"}</option>)}
      </select></label>
      {selected && <div className="lxp-animation-step" key={selected.id}>
        {locked && <p className="lxp-muted">対象のロックを解除すると編集できます。</p>}
        {!editor.readOnly && <div className="lxp-animation-step-order">
          <button type="button" disabled={disabled || selectedIndex <= 0 || lockedStep(animations[selectedIndex - 1] ?? selected, slide.elements)}
            onClick={() => void editor.execute({ type: "animation.set", slideId: slide.id, animations: moveItem(animations, selectedIndex, -1) }, editor.deck)}>ステップを上へ</button>
          <button type="button" disabled={disabled || selectedIndex >= animations.length - 1 || lockedStep(animations[selectedIndex + 1] ?? selected, slide.elements)}
            onClick={() => void editor.execute({ type: "animation.set", slideId: slide.id, animations: moveItem(animations, selectedIndex, 1) }, editor.deck)}>ステップを下へ</button>
        </div>}
        <ValueField label="ステップ名" type="text" value={selected.name ?? ""} revision={editor.deck} disabled={disabled} onCommit={(name, baseline) => update({ ...selected, name }, baseline)} />
        <label className="lxp-field"><span>再生開始</span><select aria-label="再生開始" disabled={disabled} value={selected.trigger?.type ?? "immediate"} onChange={event => {
          const type = event.target.value;
          update({ ...selected, trigger: type === "after-delay" ? { type, delayMs: 500 } : type === "click" ? { type } : { type: "immediate" } });
        }}><option value="immediate">すぐに開始</option><option value="after-delay">時間をおいて開始</option><option value="click">クリックで開始</option></select></label>
        {selected.trigger?.type === "after-delay" && <ValueField label="ステップの待ち時間 (ms)" value={selected.trigger.delayMs} revision={editor.deck} disabled={disabled} min={0} step={50}
          onCommit={(value, baseline) => update({ ...selected, trigger: { type: "after-delay", delayMs: Number(value) } }, baseline)} />}
        {selected.trigger?.type === "click" && <label className="lxp-field"><span>クリック対象</span><select aria-label="クリック対象" value={selected.trigger.elementId ?? ""} disabled={disabled}
          onChange={event => update({ ...selected, trigger: { type: "click", ...(event.target.value ? { elementId: event.target.value } : {}) } })}>
          <option value="">スライド全体</option>{slide.elements.map(item => <option key={item.id} value={item.id} disabled={item.locked}>{elementLabel(item)}{item.locked ? "（ロック）" : ""}</option>)}
        </select></label>}
        <NodeEditor node={selected.animation} elements={slide.elements} revision={editor.deck} disabled={disabled} onChange={(animation, baseline) => update({ ...selected, animation }, baseline)} />
        {!editor.readOnly && <button type="button" className="lxp-property-button lxp-animation-delete" disabled={disabled} onClick={() => void editor.execute({ type: "animation.remove", slideId: slide.id, animationId: selected.id }, editor.deck)}>ステップを削除</button>}
      </div>}
    </> : <p className="lxp-muted">このスライドにアニメーションはありません。</p>}
  </>;
}

export function SlideAnimations({ editor }: { editor: SlideEditor }) {
  if (!editor.features.animations || !editor.deck.slides.some(slide => slide.id === editor.selection.slideId)) return null;
  return <section className="lxp-property-section lxp-animations" data-slide-animations="" aria-label="アニメーション設定"><h3>アニメーション</h3>
    <AnimationPanel key={editor.selection.slideId} editor={editor} />
  </section>;
}

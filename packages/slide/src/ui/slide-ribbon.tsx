"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, Bold, BringToFront,
  ClipboardPaste, Copy, FileJson, Image as ImageIcon, Italic, Minus, MonitorPlay, PanelBottom,
  PanelRight, Plus, RectangleHorizontal, RotateCcw, Save, Scissors, SendToBack, Trash2, Type, Upload,
  AlignVerticalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd,
} from "lucide-react";
import { SLIDE_SHAPES, resolveSlideAppearance } from "../model/index";
import { SlideMasterControls } from "./slide-master-controls";
import type { SlideCommand, SlideElementPatch, SlideShapeKind } from "../model/types";
import type { SlideRibbonDisplayMode } from "../props";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideScrollStrip } from "./slide-scroll-strip";
import { createMoveAnimation } from "./slide-animations";
import { getOfficeShapeGeometry } from "../model/core-office-shapes";

export type RibbonTab = "home" | "file" | "insert" | "design" | "animations" | "view";
function Group({ name, children }: { name: string; children: ReactNode }) {
  return <section className="lxp-ribbon-group" role="group" aria-label={name}><div className="lxp-ribbon-group-controls">{children}</div><div className="lxp-ribbon-group-label">{name}</div></section>;
}
function Action({ label, icon, onClick, disabled, big = false, active = false }: { label: string; icon: ReactNode; onClick(): void; disabled?: boolean; big?: boolean; active?: boolean }) {
  return <button type="button" className={`lxp-ribbon-action${big ? " is-big" : ""}${active ? " is-active" : ""}`} aria-label={label} title={label} disabled={disabled} onClick={onClick} aria-pressed={active || undefined}>{icon}<span>{label}</span></button>;
}
function IconAction({ label, children, onClick, disabled, active }: { label: string; children: ReactNode; onClick(): void; disabled?: boolean; active?: boolean }) {
  return <button type="button" className="lxp-ribbon-icon" aria-label={label} title={label} disabled={disabled} aria-pressed={active} onClick={onClick}>{children}</button>;
}
const shapes = SLIDE_SHAPES.map(item => ({ ...item,
  icon: <svg width="22" height="19" viewBox="-1 -1 26 22" aria-hidden="true">{getOfficeShapeGeometry(item.preset, 24, 20).paths.map((path, index) =>
    <path key={index} d={path.d} fill={path.fill === false ? "none" : "currentColor"} fillOpacity={.16} stroke={path.stroke === false ? "none" : "currentColor"} strokeWidth={1.5} strokeLinejoin="round" />)}</svg>,
}));
const commonShapeKinds = ["rect", "roundRect", "ellipse", "triangle", "diamond", "arrow", "leftArrow"];
function ShapeGallery({ disabled, onInsert }: { disabled: boolean; onInsert(shape: SlideShapeKind): void }) {
  return <div className="lxp-ribbon-stack"><div className="lxp-shape-gallery">{shapes.filter(item => commonShapeKinds.includes(item.shape)).map(item =>
    <IconAction key={item.shape} label={item.label} disabled={disabled} onClick={() => onInsert(item.shape)}>{item.icon}</IconAction>)}</div>
    <select aria-label="図形を挿入" value="" disabled={disabled} onChange={event => { if (event.target.value) onInsert(event.target.value as SlideShapeKind); }}>
      <option value="" disabled>その他の図形…</option>
      {[...new Set(shapes.map(item => item.category))].map(category => <optgroup key={category} label={{ basic: "基本図形", arrows: "ブロック矢印", flowchart: "フローチャート" }[category]}>
        {shapes.filter(item => item.category === category).map(item => <option key={item.shape} value={item.shape}>{item.label}</option>)}
      </optgroup>)}
    </select>
  </div>;
}

export function SlideRibbon({ editor, onImage, onImport, onImportMasters, onPresent, propertiesOpen, notesOpen, onProperties, onNotes, onFit, ownerDocument }: {
  editor: SlideEditor; onImage(): void; onImport(format: "pptx" | "slon"): void; onImportMasters?(): void; onPresent(): void;
  propertiesOpen: boolean; notesOpen: boolean; onProperties(): void; onNotes(): void; onFit(): void; ownerDocument: Document | null;
}) {
  const [tab, setTab] = useState<RibbonTab>("home");
  const root = useRef<HTMLDivElement>(null), reveal = useRef<HTMLButtonElement>(null);
  const refs = useRef<Partial<Record<RibbonTab, HTMLButtonElement | null>>>({});
  const focusAfterRender = useRef<"tab" | "reveal" | null>(null);
  const id = useId();
  const mode = editor.ribbonDisplayMode;
  const [disclosure, setDisclosure] = useState({ mode, open: false });
  // Mode changes hide rather than unmount the ribbon and its current controls.
  if (disclosure.mode !== mode) setDisclosure({ mode, open: false });
  const temporary = (mode === "tabs" || mode === "autoHide") && disclosure.mode === mode && disclosure.open;
  const headerVisible = mode !== "hidden" && (mode !== "autoHide" || temporary);
  const panelVisible = mode === "expanded" || (mode !== "hidden" && temporary);
  useEffect(() => {
    if (!temporary) return;
    const element = root.current, document = element?.ownerDocument;
    if (!element || !document) return;
    const outside = (event: Event) => {
      if (event.target && !element.contains(event.target as Node)) setDisclosure({ mode, open: false });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); };
  }, [mode, temporary]);
  const activeTab = tab === "animations" && !editor.features.animations ? "home" : tab;
  useLayoutEffect(() => {
    if (focusAfterRender.current) {
      const target = focusAfterRender.current; focusAfterRender.current = null;
      (target === "reveal" ? reveal.current : refs.current[activeTab])?.focus({ preventScroll: true });
      return;
    }
    const element = root.current, focused = element?.ownerDocument.activeElement;
    if (element && focused && element.contains(focused) && focused.closest?.("[hidden]")) {
      if (mode === "hidden") element.closest<HTMLElement>("[data-likex-slide]")?.focus({ preventScroll: true });
      else if (mode === "autoHide" && !temporary) reveal.current?.focus({ preventScroll: true });
      else refs.current[activeTab]?.focus({ preventScroll: true });
    }
  });
  const changeTab = (next: RibbonTab) => { setTab(next); setDisclosure({ mode, open: true }); refs.current[next]?.focus(); };
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId);
  const background = slide ? resolveSlideAppearance(editor.deck, slide).background : "#ffffff";
  const selected = slide?.elements.filter(element => editor.selection.elementIds.includes(element.id)) ?? [];
  const text = selected.find(element => element.type === "text");
  const hasSelection = selected.length > 0;
  const disabled = !editor.editable;
  const update = (patch: SlideElementPatch, textOnly = false) => {
    if (slide) void editor.execute(selected.filter(item => !textOnly || item.type === "text").map((element): SlideCommand => ({ type: "element.update", slideId: slide.id, elementId: element.id, patch })));
  };
  const addText = () => { if (slide) void editor.execute({ type: "element.add", slideId: slide.id, element: { type: "text", name: "テキスト ボックス", text: "テキストを入力", x: editor.deck.width * .2, y: editor.deck.height * .35, width: editor.deck.width * .6, height: 100, fontSize: 32 } }); };
  const addShape = (shape: SlideShapeKind) => { if (slide) void editor.execute(shape === "line" ? { type: "line.add", slideId: slide.id, name: "線", start: { x: editor.deck.width * .35, y: editor.deck.height * .3 }, end: { x: editor.deck.width * .35 + 280, y: editor.deck.height * .3 }, stroke: "#bd5030", strokeWidth: 2 } : { type: "element.add", slideId: slide.id,
    element: { type: "shape", shape, name: shapes.find(item => item.shape === shape)?.label ?? "図形", x: editor.deck.width * .35, y: editor.deck.height * .3, width: 280, height: 160, fill: "#f5b39c", stroke: "#bd5030", strokeWidth: 2 } }); };
  const lineMenu = editor.features.shapes && !editor.readOnly && <Group name="線"><div className="lxp-ribbon-stack">
    <select aria-label="線を挿入" value="" disabled={disabled || !slide} onChange={event => {
      const preset = event.target.value;
      if (slide && preset) void editor.execute({ type: "line.add", slideId: slide.id, name: { plain: "直線", right: "右向き矢印線", left: "左向き矢印線", both: "双方向矢印線", elbow: "折れ線", elbowRight: "矢印付き折れ線", elbowLeft: "始点矢印付き折れ線", elbowBoth: "双方向矢印付き折れ線" }[preset],
        start: { x: editor.deck.width * .35, y: editor.deck.height * .3 }, end: { x: editor.deck.width * .35 + 280, y: editor.deck.height * .3 + (preset.startsWith("elbow") ? 160 : 0) },
        stroke: "#bd5030", strokeWidth: 2, routing: preset.startsWith("elbow") ? "elbow" : "straight", startArrow: ["left", "both", "elbowLeft", "elbowBoth"].includes(preset) ? "triangle" : "none", endArrow: ["right", "both", "elbowRight", "elbowBoth"].includes(preset) ? "triangle" : "none" });
    }}><option value="" disabled>線を挿入</option><option value="plain">直線</option><option value="right">右向き矢印線</option><option value="left">左向き矢印線</option><option value="both">双方向矢印線</option><option value="elbow">折れ線</option><option value="elbowRight">矢印付き折れ線</option><option value="elbowLeft">始点矢印付き折れ線</option><option value="elbowBoth">双方向矢印付き折れ線</option></select>
    {editor.features.formatting && <Action label="線の矢印設定" icon={<Minus size={18} />} disabled={!selected.some(element => element.type === "shape" && element.shape === "line")} onClick={() => { if (!propertiesOpen) onProperties(); }} />}
  </div></Group>;
  const remove = () => { if (slide && hasSelection) void editor.execute({ type: "element.delete", slideId: slide.id, elementIds: editor.selection.elementIds }); };
  const tabs: { id: RibbonTab; label: string }[] = [{ id: "file", label: "ファイル" }, { id: "home", label: "ホーム" }, { id: "insert", label: "挿入" }, { id: "design", label: "デザイン" }, ...(editor.features.animations ? [{ id: "animations" as const, label: "アニメーション" }] : []), { id: "view", label: "表示" }];
  const showAnimationSettings = () => {
    if (!propertiesOpen) onProperties();
    ownerDocument?.defaultView?.requestAnimationFrame(() => root.current?.closest("[data-likex-slide]")?.querySelector<HTMLElement>("[data-slide-animations]")?.scrollIntoView({ block: "nearest" }));
  };
  return <div className="lxp-ribbon" ref={root} data-display-mode={mode} hidden={mode === "hidden"}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape" && temporary) {
        event.preventDefault(); event.stopPropagation();
        focusAfterRender.current = mode === "autoHide" ? "reveal" : "tab";
        setDisclosure({ mode, open: false });
      }
    }}>
    <button ref={reveal} type="button" className="lxp-ribbon-reveal" aria-label="リボンを表示" title="リボンを表示"
      hidden={mode !== "autoHide" || temporary} aria-expanded={temporary} aria-controls={`${id}-surface`}
      onClick={() => { focusAfterRender.current = "tab"; setDisclosure({ mode, open: true }); }}><span aria-hidden="true">···</span></button>
    <div className="lxp-ribbon-surface" id={`${id}-surface`} hidden={!headerVisible}>
    <div className="lxp-ribbon-header">
    <div className="lxp-ribbon-tabs" role="tablist" aria-label="リボンのタブ" onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const current = tabs.findIndex(item => item.id === activeTab);
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
        changeTab(tabs[index].id);
      }
    }}>
      {tabs.map(item => <button type="button" key={item.id} role="tab" aria-selected={activeTab === item.id} className={activeTab === item.id ? "is-active" : ""}
        ref={element => { refs.current[item.id] = element; }} id={`${id}-${item.id}`} aria-controls={`${id}-panel`} tabIndex={activeTab === item.id ? 0 : -1}
        onClick={() => { setTab(item.id); setDisclosure({ mode, open: activeTab === item.id ? !temporary : true }); }}
        onDoubleClick={() => editor.setRibbonDisplayMode(mode === "expanded" ? "tabs" : "expanded")}>{item.label}</button>)}
    </div>
    <label className="lxp-ribbon-display" title="リボンの表示">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 4h18v16H3zM3 9h18M7 6.5h3m3 0h4M7 13h3m3 0h4" /></svg><span aria-hidden="true">▾</span>
      <select aria-label="リボンの表示" value={mode === "hidden" ? "expanded" : mode} disabled={editor.ribbonDisplayModeLocked}
        onChange={event => editor.setRibbonDisplayMode(event.currentTarget.value as SlideRibbonDisplayMode)}>
        <option value="expanded">常にリボンを表示</option><option value="tabs">タブのみ表示</option><option value="autoHide">リボンを自動非表示</option>
      </select>
    </label>
    </div>
    <div className="lxp-ribbon-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${activeTab}`} hidden={!panelVisible}>
    <SlideScrollStrip>
      {activeTab === "file" && <>
        {!editor.readOnly && <Group name="保存"><Action label="保存" icon={<Save size={22} />} big disabled={!!editor.busy} onClick={() => void editor.save()} /></Group>}
        {editor.features.import && !editor.readOnly && <Group name="開く"><Action label="PowerPoint" icon={<Upload size={22} />} big disabled={disabled} onClick={() => onImport("pptx")} /><Action label="LikeSlide" icon={<FileJson size={22} />} big disabled={disabled} onClick={() => onImport("slon")} /></Group>}
        {editor.features.export && <Group name="エクスポート"><Action label="PowerPoint (.pptx)" icon={<ArrowDownToLine size={22} />} big disabled={!!editor.busy} onClick={() => { if (ownerDocument) void editor.download("pptx", ownerDocument); }} /><Action label="LikeSlide (.slon)" icon={<FileJson size={22} />} big disabled={!!editor.busy} onClick={() => { if (ownerDocument) void editor.download("slon", ownerDocument); }} /></Group>}
        {!editor.readOnly && <Group name="変更"><Action label="変更を破棄" icon={<RotateCcw size={20} />} big disabled={disabled || !editor.dirty} onClick={() => { if (ownerDocument?.defaultView?.confirm("未保存の変更を破棄しますか？")) editor.discard(); }} /></Group>}
      </>}
      {activeTab === "home" && <>
        <Group name="クリップボード">
          {!editor.readOnly && <Action label="貼り付け" icon={<ClipboardPaste size={25} />} big disabled={disabled || !slide} onClick={() => void editor.pasteElements()} />}
          <div className="lxp-ribbon-stack"><Action label="コピー" icon={<Copy size={15} />} disabled={!hasSelection} onClick={editor.copyElements} />
            {!editor.readOnly && <Action label="切り取り" icon={<Scissors size={15} />} disabled={disabled || !hasSelection} onClick={() => { editor.copyElements(); remove(); }} />}</div>
        </Group>
        {editor.features.addSlides && !editor.readOnly && <Group name="スライド"><Action label="新しいスライド" icon={<Plus size={25} />} big disabled={disabled} onClick={() => void editor.execute({ type: "slide.add", afterId: slide?.id, ...(editor.features.masters && slide?.layoutId ? { layoutId: slide.layoutId } : {}) })} />
          <Action label="複製" icon={<Copy size={18} />} disabled={disabled || !slide} onClick={() => { if (slide) void editor.execute({ type: "slide.duplicate", slideId: slide.id }); }} /></Group>}
        {editor.features.formatting && <>
          <Group name="フォント"><div className="lxp-ribbon-stack">
            <div className="lxp-ribbon-row"><select aria-label="フォント" value={text?.fontFamily ?? "Arial"} disabled={disabled || !text} onChange={event => update({ fontFamily: event.target.value }, true)}>
              {[...new Set(["Arial", "Calibri", "Aptos", "Yu Gothic", "Meiryo", "Georgia", "Times New Roman", text?.fontFamily ?? "Arial"])].map(font => <option key={font}>{font}</option>)}</select>
              <select aria-label="文字サイズ" className="lxp-font-size" value={text?.fontSize ?? 28} disabled={disabled || !text} onChange={event => update({ fontSize: Number(event.target.value) }, true)}>
                {[...new Set([12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, text?.fontSize ?? 28])].sort((a, b) => a - b).map(size => <option key={size}>{size}</option>)}</select>
            </div>
            <div className="lxp-ribbon-row"><IconAction label="太字" active={text?.bold ?? false} disabled={disabled || !text} onClick={() => update({ bold: !text?.bold }, true)}><Bold size={16} /></IconAction>
              <IconAction label="斜体" active={text?.italic ?? false} disabled={disabled || !text} onClick={() => update({ italic: !text?.italic }, true)}><Italic size={16} /></IconAction>
              <label className="lxp-ribbon-color" title="文字の色"><Type size={15} /><input type="color" aria-label="文字の色" value={text?.color ?? "#252525"} disabled={disabled || !text} onChange={event => update({ color: event.target.value }, true)} /></label>
            </div>
          </div></Group>
          <Group name="段落"><div className="lxp-ribbon-stack"><div className="lxp-ribbon-row">
            {([{ value: "left", label: "左揃え", Icon: AlignLeft }, { value: "center", label: "中央揃え", Icon: AlignCenter }, { value: "right", label: "右揃え", Icon: AlignRight }] as const).map(({ value, label, Icon }) => <IconAction key={value} label={label} active={text?.align === value} disabled={disabled || !text} onClick={() => update({ align: value }, true)}><Icon size={17} /></IconAction>)}
          </div><div className="lxp-ribbon-row">
            {([{ value: "top", label: "上揃え", Icon: AlignVerticalJustifyStart }, { value: "middle", label: "上下中央", Icon: AlignVerticalJustifyCenter }, { value: "bottom", label: "下揃え", Icon: AlignVerticalJustifyEnd }] as const).map(({ value, label, Icon }) => <IconAction key={value} label={label} active={text?.verticalAlign === value} disabled={disabled || !text} onClick={() => update({ verticalAlign: value }, true)}><Icon size={17} /></IconAction>)}
          </div></div></Group>
        </>}
        {editor.features.shapes && !editor.readOnly && <Group name="図形"><ShapeGallery disabled={disabled || !slide} onInsert={addShape} /></Group>}
        {lineMenu}
        {editor.features.formatting && <Group name="配置"><div className="lxp-ribbon-stack"><Action label="最前面へ" icon={<BringToFront size={16} />} disabled={disabled || !hasSelection} onClick={() => { if (slide) void editor.execute({ type: "element.order", slideId: slide.id, elementIds: editor.selection.elementIds, direction: "front" }); }} />
          <Action label="最背面へ" icon={<SendToBack size={16} />} disabled={disabled || !hasSelection} onClick={() => { if (slide) void editor.execute({ type: "element.order", slideId: slide.id, elementIds: editor.selection.elementIds, direction: "back" }); }} /></div></Group>}
        {!editor.readOnly && <Group name="編集"><Action label="削除" icon={<Trash2 size={22} />} big disabled={disabled || !hasSelection} onClick={remove} /></Group>}
      </>}
      {activeTab === "insert" && <>
        {editor.features.text && !editor.readOnly && <Group name="テキスト"><Action label="テキスト ボックス" icon={<Type size={25} />} big disabled={disabled || !slide} onClick={addText} /></Group>}
        {editor.features.images && !editor.readOnly && <Group name="画像"><Action label="画像" icon={<ImageIcon size={25} />} big disabled={disabled || !slide} onClick={onImage} /></Group>}
        {editor.features.shapes && !editor.readOnly && <Group name="図形"><ShapeGallery disabled={disabled || !slide} onInsert={addShape} /></Group>}
        {lineMenu}
      </>}
      {activeTab === "design" && editor.features.masters && <Group name="マスターとレイアウト"><SlideMasterControls editor={editor} onImport={() => onImportMasters?.()} /></Group>}
      {activeTab === "design" && editor.features.formatting && <>
        <Group name="背景"><div className="lxp-background-gallery">{["#ffffff", "#fff6ef", "#f0f5fa", "#142c45", "#263528", "#ca542f"].map(color => <button type="button" key={color} disabled={disabled || !slide}
          style={{ background: color }} aria-label={`背景色 ${color}`} title={`背景色 ${color}`} aria-pressed={background === color}
          onClick={() => { if (slide) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { background: color } }); }} />)}</div>
          <label className="lxp-ribbon-color" title="背景色を選ぶ"><input type="color" aria-label="背景色を選ぶ" value={background} disabled={disabled || !slide}
            onChange={event => { if (slide) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { background: event.target.value } }); }} /></label>
        </Group>
        <Group name="ページ設定"><Action label="ワイド 16:9" icon={<RectangleHorizontal size={24} />} big disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 1280, height: 720 })} />
          <Action label="標準 4:3" icon={<RectangleHorizontal size={24} />} big disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 960, height: 720 })} /></Group>
      </>}
      {activeTab === "animations" && editor.features.animations && <>
        {!editor.readOnly && <Group name="アニメーション"><Action label="移動を追加" icon={<Plus size={25} />} big disabled={disabled || !slide || !selected.length || selected.some(element => element.locked)} onClick={() => {
          if (!slide || !selected.length || selected.some(element => element.locked)) return;
          void editor.execute({ type: "animation.set", slideId: slide.id, animations: [...(slide.animations ?? []), createMoveAnimation(selected)] }, editor.deck);
        }} /></Group>}
        <Group name="設定"><Action label="アニメーションの詳細設定" icon={<PanelRight size={24} />} big disabled={!slide} onClick={showAnimationSettings} /></Group>
        {editor.features.presentation && <Group name="確認"><Action label="アニメーションを再生" icon={<MonitorPlay size={25} />} big disabled={!slide} onClick={onPresent} /></Group>}
      </>}
      {activeTab === "view" && <>
        {editor.features.presentation && <Group name="スライドショー"><Action label="現在のスライドから" icon={<MonitorPlay size={25} />} big disabled={!slide} onClick={onPresent} /></Group>}
        <Group name="表示"><Action label="書式設定" icon={<PanelRight size={24} />} big active={propertiesOpen} onClick={onProperties} />
          {editor.features.notes && <Action label="ノート" icon={<PanelBottom size={24} />} big active={notesOpen} onClick={onNotes} />}
          <Action label="画面に合わせる" icon={<RectangleHorizontal size={24} />} big onClick={onFit} /></Group>
      </>}
    </SlideScrollStrip>
    </div>
    </div>
  </div>;
}

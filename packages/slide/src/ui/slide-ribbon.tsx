"use client";

import { useState, type ReactNode } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowRight, Bold, BringToFront, Circle,
  ClipboardPaste, Copy, Diamond, FileJson, Image as ImageIcon, Italic, Minus, MonitorPlay, PanelBottom,
  PanelRight, Plus, RectangleHorizontal, RotateCcw, Save, Scissors, SendToBack, Trash2, Triangle, Type, Upload,
  AlignVerticalJustifyCenter, AlignVerticalJustifyStart, AlignVerticalJustifyEnd,
} from "lucide-react";
import type { SlideCommand, SlideElementPatch, SlideShapeKind } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideScrollStrip } from "./slide-scroll-strip";

export type RibbonTab = "home" | "file" | "insert" | "design" | "view";
function Group({ name, children }: { name: string; children: ReactNode }) {
  return <section className="lxp-ribbon-group" role="group" aria-label={name}><div className="lxp-ribbon-group-controls">{children}</div><div className="lxp-ribbon-group-label">{name}</div></section>;
}
function Action({ label, icon, onClick, disabled, big = false, active = false }: { label: string; icon: ReactNode; onClick(): void; disabled?: boolean; big?: boolean; active?: boolean }) {
  return <button type="button" className={`lxp-ribbon-action${big ? " is-big" : ""}${active ? " is-active" : ""}`} aria-label={label} title={label} disabled={disabled} onClick={onClick} aria-pressed={active || undefined}>{icon}<span>{label}</span></button>;
}
function IconAction({ label, children, onClick, disabled, active }: { label: string; children: ReactNode; onClick(): void; disabled?: boolean; active?: boolean }) {
  return <button type="button" className="lxp-ribbon-icon" aria-label={label} title={label} disabled={disabled} aria-pressed={active} onClick={onClick}>{children}</button>;
}
const shapes: { shape: SlideShapeKind; label: string; icon: ReactNode }[] = [
  { shape: "rect", label: "四角形", icon: <RectangleHorizontal size={19} /> },
  { shape: "roundRect", label: "角丸四角形", icon: <RectangleHorizontal size={19} strokeWidth={3} /> },
  { shape: "ellipse", label: "楕円", icon: <Circle size={19} /> },
  { shape: "triangle", label: "三角形", icon: <Triangle size={19} /> },
  { shape: "diamond", label: "ひし形", icon: <Diamond size={19} /> },
  { shape: "arrow", label: "矢印", icon: <ArrowRight size={19} /> },
  { shape: "line", label: "線", icon: <Minus size={19} /> },
];

export function SlideRibbon({ editor, onImage, onImport, onPresent, propertiesOpen, notesOpen, onProperties, onNotes, onFit, ownerDocument }: {
  editor: SlideEditor; onImage(): void; onImport(format: "pptx" | "json"): void; onPresent(): void;
  propertiesOpen: boolean; notesOpen: boolean; onProperties(): void; onNotes(): void; onFit(): void; ownerDocument: Document | null;
}) {
  const [tab, setTab] = useState<RibbonTab>("home");
  const slide = editor.deck.slides.find(item => item.id === editor.selection.slideId);
  const selected = slide?.elements.filter(element => editor.selection.elementIds.includes(element.id)) ?? [];
  const text = selected.find(element => element.type === "text");
  const hasSelection = selected.length > 0;
  const disabled = !editor.editable;
  const update = (patch: SlideElementPatch, textOnly = false) => {
    if (slide) void editor.execute(selected.filter(item => !textOnly || item.type === "text").map((element): SlideCommand => ({ type: "element.update", slideId: slide.id, elementId: element.id, patch })));
  };
  const addText = () => { if (slide) void editor.execute({ type: "element.add", slideId: slide.id, element: { type: "text", name: "テキスト ボックス", text: "テキストを入力", x: editor.deck.width * .2, y: editor.deck.height * .35, width: editor.deck.width * .6, height: 100, fontSize: 32 } }); };
  const addShape = (shape: SlideShapeKind) => { if (slide) void editor.execute({ type: "element.add", slideId: slide.id,
    element: { type: "shape", shape, name: shapes.find(item => item.shape === shape)?.label ?? "図形", x: editor.deck.width * .35, y: editor.deck.height * .3, width: 280, height: shape === "line" ? 6 : 160, fill: "#f5b39c", stroke: "#bd5030", strokeWidth: 2 } }); };
  const remove = () => { if (slide && hasSelection) void editor.execute({ type: "element.delete", slideId: slide.id, elementIds: editor.selection.elementIds }); };
  const tabs: { id: RibbonTab; label: string }[] = [{ id: "file", label: "ファイル" }, { id: "home", label: "ホーム" }, { id: "insert", label: "挿入" }, { id: "design", label: "デザイン" }, { id: "view", label: "表示" }];
  return <div className="lxp-ribbon">
    <div className="lxp-ribbon-tabs" role="tablist" aria-label="リボンのタブ">
      {tabs.map(item => <button type="button" key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""}
        onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <SlideScrollStrip>
      {tab === "file" && <>
        {!editor.readOnly && <Group name="保存"><Action label="保存" icon={<Save size={22} />} big disabled={!!editor.busy} onClick={() => void editor.save()} /></Group>}
        {editor.features.import && !editor.readOnly && <Group name="開く"><Action label="PowerPoint" icon={<Upload size={22} />} big disabled={disabled} onClick={() => onImport("pptx")} /><Action label="JSON" icon={<FileJson size={22} />} big disabled={disabled} onClick={() => onImport("json")} /></Group>}
        {editor.features.export && <Group name="エクスポート"><Action label="PowerPoint (.pptx)" icon={<ArrowDownToLine size={22} />} big disabled={!!editor.busy} onClick={() => { if (ownerDocument) void editor.download("pptx", ownerDocument); }} /><Action label="JSON (.json)" icon={<FileJson size={22} />} big disabled={!!editor.busy} onClick={() => { if (ownerDocument) void editor.download("json", ownerDocument); }} /></Group>}
        {!editor.readOnly && <Group name="変更"><Action label="変更を破棄" icon={<RotateCcw size={20} />} big disabled={disabled || !editor.dirty} onClick={() => { if (ownerDocument?.defaultView?.confirm("未保存の変更を破棄しますか？")) editor.discard(); }} /></Group>}
      </>}
      {tab === "home" && <>
        <Group name="クリップボード">
          {!editor.readOnly && <Action label="貼り付け" icon={<ClipboardPaste size={25} />} big disabled={disabled || !slide} onClick={() => void editor.pasteElements()} />}
          <div className="lxp-ribbon-stack"><Action label="コピー" icon={<Copy size={15} />} disabled={!hasSelection} onClick={editor.copyElements} />
            {!editor.readOnly && <Action label="切り取り" icon={<Scissors size={15} />} disabled={disabled || !hasSelection} onClick={() => { editor.copyElements(); remove(); }} />}</div>
        </Group>
        {editor.features.addSlides && !editor.readOnly && <Group name="スライド"><Action label="新しいスライド" icon={<Plus size={25} />} big disabled={disabled} onClick={() => void editor.execute({ type: "slide.add", afterId: slide?.id })} />
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
        {editor.features.shapes && !editor.readOnly && <Group name="図形"><div className="lxp-shape-gallery">{shapes.slice(0, 6).map(item => <IconAction key={item.shape} label={item.label} disabled={disabled || !slide} onClick={() => addShape(item.shape)}>{item.icon}</IconAction>)}</div></Group>}
        {editor.features.formatting && <Group name="配置"><div className="lxp-ribbon-stack"><Action label="最前面へ" icon={<BringToFront size={16} />} disabled={disabled || !hasSelection} onClick={() => { if (slide) void editor.execute({ type: "element.order", slideId: slide.id, elementIds: editor.selection.elementIds, direction: "front" }); }} />
          <Action label="最背面へ" icon={<SendToBack size={16} />} disabled={disabled || !hasSelection} onClick={() => { if (slide) void editor.execute({ type: "element.order", slideId: slide.id, elementIds: editor.selection.elementIds, direction: "back" }); }} /></div></Group>}
        {!editor.readOnly && <Group name="編集"><Action label="削除" icon={<Trash2 size={22} />} big disabled={disabled || !hasSelection} onClick={remove} /></Group>}
      </>}
      {tab === "insert" && <>
        {editor.features.text && !editor.readOnly && <Group name="テキスト"><Action label="テキスト ボックス" icon={<Type size={25} />} big disabled={disabled || !slide} onClick={addText} /></Group>}
        {editor.features.images && !editor.readOnly && <Group name="画像"><Action label="画像" icon={<ImageIcon size={25} />} big disabled={disabled || !slide} onClick={onImage} /></Group>}
        {editor.features.shapes && !editor.readOnly && <Group name="図形">{shapes.map(item => <Action key={item.shape} label={item.label} icon={item.icon} big disabled={disabled || !slide} onClick={() => addShape(item.shape)} />)}</Group>}
      </>}
      {tab === "design" && editor.features.formatting && <>
        <Group name="背景"><div className="lxp-background-gallery">{["#ffffff", "#fff6ef", "#f0f5fa", "#142c45", "#263528", "#ca542f"].map(background => <button type="button" key={background} disabled={disabled || !slide}
          style={{ background }} aria-label={`背景色 ${background}`} title={`背景色 ${background}`} aria-pressed={slide?.background === background}
          onClick={() => { if (slide) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { background } }); }} />)}</div>
          <label className="lxp-ribbon-color" title="背景色を選ぶ"><input type="color" aria-label="背景色を選ぶ" value={slide?.background ?? "#ffffff"} disabled={disabled || !slide}
            onChange={event => { if (slide) void editor.execute({ type: "slide.update", slideId: slide.id, patch: { background: event.target.value } }); }} /></label>
        </Group>
        <Group name="ページ設定"><Action label="ワイド 16:9" icon={<RectangleHorizontal size={24} />} big disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 1280, height: 720 })} />
          <Action label="標準 4:3" icon={<RectangleHorizontal size={24} />} big disabled={disabled} onClick={() => void editor.execute({ type: "deck.resize", width: 960, height: 720 })} /></Group>
      </>}
      {tab === "view" && <>
        {editor.features.presentation && <Group name="スライドショー"><Action label="現在のスライドから" icon={<MonitorPlay size={25} />} big disabled={!slide} onClick={onPresent} /></Group>}
        <Group name="表示"><Action label="書式設定" icon={<PanelRight size={24} />} big active={propertiesOpen} onClick={onProperties} />
          {editor.features.notes && <Action label="ノート" icon={<PanelBottom size={24} />} big active={notesOpen} onClick={onNotes} />}
          <Action label="画面に合わせる" icon={<RectangleHorizontal size={24} />} big onClick={onFit} /></Group>
      </>}
    </SlideScrollStrip>
  </div>;
}

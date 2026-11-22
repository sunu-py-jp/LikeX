"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, CopyPlus, LayoutTemplate, X } from "lucide-react";
import { getSlideLayouts, getSlideMasters } from "../model/index";
import type { SlideDeck, SlideLayout, SlideMaster } from "../model/types";
import type { SlideEditor } from "../state/use-slide-editor";
import { SlideArtwork } from "./slide-artwork";

type Mode = "apply" | "add";
type GalleryContext = { deck: SlideDeck; selection: string; mode: Mode; popover: boolean };

function LayoutPreview({ deck, layout, master }: { deck: SlideDeck; layout: SlideLayout; master: SlideMaster }) {
  const scale = Math.min(132 / deck.width, 82 / deck.height);
  return <span className="lxp-layout-thumbnail" aria-hidden="true">
    <span className="lxp-layout-paper" style={{ width: deck.width * scale, height: deck.height * scale }}>
      <SlideArtwork deck={deck} scale={scale} slide={{ id: `preview-${layout.id}`, name: layout.name, background: master.background,
        notes: "", layoutId: layout.id, inheritBackground: true,
        elements: layout.placeholders.map(slot => ({ ...slot.element, layoutPlaceholderId: slot.id })) }} />
      {layout.placeholders.map(slot => <span key={slot.id} className="lxp-layout-placeholder" style={{
        left: slot.element.x * scale, top: slot.element.y * scale, width: slot.element.width * scale, height: slot.element.height * scale,
        transform: `rotate(${slot.element.rotation}deg)`,
      }}>{slot.element.type === "text" && !slot.element.text && <span>{/title|ctrTitle/i.test(slot.kind) ? "タイトル" : "テキスト"}</span>}</span>)}
    </span>
  </span>;
}

/** A catalog selection is immediate, like the Home > Layout gallery in PowerPoint. */
export function SlideLayoutGallery({ editor, mode, label, compact = false, visible = true }: {
  editor: SlideEditor; mode: Mode; label?: string; compact?: boolean; visible?: boolean;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const [context, setContext] = useState<GalleryContext | null>(null);
  const selection = JSON.stringify(editor.selection), layouts = getSlideLayouts(editor.deck), masters = getSlideMasters(editor.deck);
  const disabled = !visible || !editor.editable || !editor.features.masters || !layouts.length
    || (mode === "apply" ? !editor.features.formatting || !editor.selection.slideId : !editor.features.addSlides);
  const open = context !== null && context.deck === editor.deck && context.selection === selection && context.mode === mode && !disabled;
  if (context && !open) setContext(null);
  const current = useRef({ editor, selection, disabled, mode, context: open ? context : null });
  useLayoutEffect(() => { current.current = { editor, selection, disabled, mode, context: open ? context : null }; });
  const restoreFocus = () => {
    const element = trigger.current;
    if (element?.isConnected && !element.disabled && !element.closest("[hidden]")) element.focus({ preventScroll: true });
  };
  const close = (restore = false) => { current.current.context = null; setContext(null); if (restore) restoreFocus(); };
  const choose = (layoutId: string) => {
    const latest = current.current;
    if (!context || latest.context !== context || latest.disabled || context.mode !== latest.mode || context.deck !== latest.editor.deck || context.selection !== latest.selection
      || !latest.editor.deck.layouts?.some(layout => layout.id === layoutId)) return;
    close(true);
    if (mode === "apply") void latest.editor.applyLayout(layoutId);
    else {
      const slideId = latest.editor.selection.slideId;
      void latest.editor.prepareCommands(async () => ({ type: "slide.add", afterId: slideId || undefined, layoutId }), { deck: context.deck, slideId });
    }
  };
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current, button = trigger.current, view = button?.ownerDocument.defaultView;
    if (!element || !button || !view) return;
    const position = () => {
      const anchor = button.getBoundingClientRect(), viewport = view.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? view.innerWidth, height = viewport?.height ?? view.innerHeight;
      const panelWidth = Math.min(480, width - 16), below = top + height - anchor.bottom - 12, above = anchor.top - top - 12;
      const upward = below < Math.min(300, height / 2) && above > below;
      element.style.width = `${Math.max(160, panelWidth)}px`;
      element.style.maxHeight = `${Math.max(100, Math.min(520, upward ? above : below))}px`;
      element.style.left = `${Math.max(left + 8, Math.min(anchor.left, left + width - panelWidth - 8))}px`;
      element.style.top = `${Math.max(top + 8, upward ? anchor.top - element.getBoundingClientRect().height - 4 : anchor.bottom + 4)}px`;
    };
    if (context?.popover && typeof element.showPopover === "function") element.showPopover();
    else if ("showModal" in element && typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    position();
    (element.querySelector<HTMLButtonElement>('[data-slide-layout-id][aria-pressed="true"]')
      ?? element.querySelector<HTMLButtonElement>("[data-slide-layout-id]"))?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (event.target && !element.contains(event.target as Node) && !button.contains(event.target as Node)) { current.current.context = null; setContext(null); }
    };
    const scroll = (event: Event) => { if (event.target && !element.contains(event.target as Node)) { current.current.context = null; setContext(null); } };
    const document = button.ownerDocument;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", scroll, true);
    view.addEventListener("resize", position);
    view.visualViewport?.addEventListener("resize", position);
    view.visualViewport?.addEventListener("scroll", position);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", scroll, true);
      view.removeEventListener("resize", position);
      view.visualViewport?.removeEventListener("resize", position);
      view.visualViewport?.removeEventListener("scroll", position);
      if (context?.popover && typeof element.hidePopover === "function" && element.matches(":popover-open")) element.hidePopover();
      else if ("close" in element && typeof element.close === "function") element.close();
    };
  }, [open, context]);
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("[data-slide-layout-id]") ?? []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault(); event.stopPropagation();
    let next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : index + (event.key === "ArrowLeft" ? -1 : 1);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const rect = buttons[index].getBoundingClientRect(), direction = event.key === "ArrowUp" ? -1 : 1;
      const candidates = buttons.map((button, at) => ({ at, rect: button.getBoundingClientRect() }))
        .filter(item => (item.rect.top - rect.top) * direction > 2)
        .sort((a, b) => Math.abs(a.rect.top - rect.top) - Math.abs(b.rect.top - rect.top) || Math.abs(a.rect.left - rect.left) - Math.abs(b.rect.left - rect.left));
      next = candidates[0]?.at ?? index;
    }
    buttons[Math.min(buttons.length - 1, Math.max(0, next))]?.focus();
  };
  const pageIds = editor.selection.slideIds ?? [editor.selection.slideId];
  const selected = editor.deck.slides.filter(slide => pageIds.includes(slide.id));
  const title = mode === "apply" ? "レイアウトを選択" : "新しいスライドのレイアウトを選択";
  const content = open && <>
    <div className="lxp-layout-gallery-heading"><span>{mode === "apply" ? "レイアウト" : "新しいスライド"}</span><button type="button" aria-label="レイアウト一覧を閉じる" onClick={() => close(true)}><X size={16} /></button></div>
    <div className="lxp-layout-gallery-body">
      {masters.map(master => <section key={master.id} className="lxp-layout-gallery-group" aria-label={master.name}>
        <h3>{master.name}</h3>
        <div className="lxp-layout-gallery-grid">{layouts.filter(layout => layout.masterId === master.id).map(layout => {
          const active = selected.length > 0 && selected.every(slide => slide.layoutId === layout.id);
          return <button type="button" key={layout.id} className="lxp-layout-card" aria-label={`${master.name} / ${layout.name}`} title={layout.name}
            data-slide-layout-id={layout.id} aria-pressed={active} onClick={() => choose(layout.id)}>
            <LayoutPreview deck={editor.deck} layout={layout} master={master} />
            <span className="lxp-layout-card-caption">{active && <Check size={13} aria-hidden="true" />}<span>{layout.name}</span></span>
          </button>;
        })}</div>
        {!layouts.some(layout => layout.masterId === master.id) && <p className="lxp-layout-group-empty">レイアウトがありません</p>}
      </section>)}
    </div>
  </>;
  return <>
    <button ref={trigger} type="button" className={`lxp-ribbon-action lxp-layout-trigger${compact ? " is-compact" : ""}`} aria-label={label ?? (mode === "apply" ? "レイアウト" : "新しいスライドのレイアウト")}
      title={label ?? (mode === "apply" ? "レイアウト" : "新しいスライドのレイアウト")} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => open ? close() : !current.current.disabled && setContext({ deck: editor.deck, selection, mode,
        popover: !trigger.current || typeof trigger.current.ownerDocument.createElement("div").showPopover === "function" })}>
      {!compact && <>{mode === "apply" ? <LayoutTemplate size={16} /> : <CopyPlus size={16} />}<span>{mode === "apply" ? "レイアウト" : "新しいスライド"}</span></>}<ChevronDown size={12} />
    </button>
    {open && (context.popover ? <div ref={element => { panel.current = element; }} id={id} className="lxp-layout-gallery" popover="auto" role="dialog" aria-label={title}
      onKeyDown={navigate} onToggle={event => { if (event.newState === "closed" && current.current.context === context) close(); }}>{content}</div>
      : <dialog ref={element => { panel.current = element; }} id={id} className="lxp-layout-gallery" role="dialog" aria-label={title} onKeyDown={navigate}
        onCancel={event => { event.preventDefault(); close(true); }} onClose={() => { if (current.current.context === context) close(); }}
        onPointerDown={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close(true); } }}>{content}</dialog>)}
  </>;
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SlideDeck } from "../model/types";
import { useSlidePlayback } from "../state/use-slide-playback";
import { SlideArtwork } from "./slide-artwork";

export function SlidePresentation({ deck, initialSlideId, ownerDocument, theme, onClose, animationsEnabled = true }: {
  deck: SlideDeck; initialSlideId: string; ownerDocument: Document; theme: CSSProperties; onClose(): void; animationsEnabled?: boolean;
}) {
  const [navigation, setNavigation] = useState(() => ({ deck, slideId: initialSlideId, index: Math.max(0, deck.slides.findIndex(slide => slide.id === initialSlideId)), final: false, visit: 0 }));
  if (navigation.deck !== deck) {
    const found = deck.slides.findIndex(slide => slide.id === navigation.slideId);
    const index = found < 0 ? Math.min(navigation.index, deck.slides.length - 1) : found;
    setNavigation({ deck, slideId: deck.slides[index]?.id ?? "", index, final: false, visit: navigation.visit + 1 });
  }
  const index = Math.max(0, deck.slides.findIndex(slide => slide.id === navigation.slideId));
  const [size, setSize] = useState({ width: ownerDocument.defaultView?.innerWidth ?? 1280, height: ownerDocument.defaultView?.innerHeight ?? 720 });
  const container = useRef<HTMLDivElement>(null);
  const source = deck.slides[index];
  const playback = useSlidePlayback(source, ownerDocument, animationsEnabled, navigation.final, navigation.visit);
  const scale = Math.min(size.width / deck.width, size.height / deck.height);
  useEffect(() => {
    const previous = ownerDocument.activeElement as HTMLElement | null;
    container.current?.focus();
    return () => { if (previous?.isConnected !== false) previous?.focus?.(); };
  }, [ownerDocument]);
  useLayoutEffect(() => {
    const node = container.current; if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const go = (index: number, final = false) => {
    const target = Math.max(0, Math.min(deck.slides.length - 1, index));
    setNavigation(previous => ({ deck, slideId: deck.slides[target]?.id ?? "", index: target, final, visit: previous.visit + 1 }));
  };
  const next = (elementId?: string) => { if (!playback.advance(elementId) && index < deck.slides.length - 1) go(index + 1); };
  const target = playback.waitingTargetId === undefined ? undefined : source.elements.find(element => element.id === playback.waitingTargetId);
  const step = source.animations?.find(step => step.id === playback.stepId);
  return createPortal(<div ref={container} data-likex-slide="" className="lxp-presentation" style={theme} role="dialog" aria-modal="true" aria-label="スライドショー" tabIndex={-1}
    onKeyDown={event => {
      // Portals keep React ancestry; presentation keys must never edit the deck.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      else if ((event.key === " " || event.key === "Enter") && (event.target as HTMLElement).closest?.("button")) return;
      else if (["ArrowRight", "ArrowDown", " ", "Enter", "PageDown"].includes(event.key)) { event.preventDefault(); if (!event.repeat) next(); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); if (!event.repeat && index > 0) go(index - 1, true); }
      else if (event.key === "Home") { event.preventDefault(); if (!event.repeat) go(0); }
      else if (event.key === "End") { event.preventDefault(); if (!event.repeat) go(deck.slides.length - 1, true); }
      else if (event.key === "Tab") {
        const buttons = Array.from(container.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        event.preventDefault();
        const current = buttons.indexOf(ownerDocument.activeElement as HTMLButtonElement);
        const nextIndex = current < 0 ? event.shiftKey ? buttons.length - 1 : 0 : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }
    }}>
    <div className="lxp-presentation-slide" style={{ width: deck.width * scale, height: deck.height * scale }} onClick={event => {
      event.stopPropagation();
      const element = (event.target as HTMLElement).closest?.<HTMLElement>("[data-slide-element-id]");
      next(element?.dataset.slideElementId);
    }}><SlideArtwork deck={deck} slide={playback.slide} scale={scale} /></div>
    <button type="button" className="lxp-presentation-close" aria-label="スライドショーを終了" title="終了 (Esc)" onClick={onClose}><X size={22} /></button>
    <div className="lxp-presentation-controls"><button type="button" aria-label="前のスライド" disabled={index === 0} onClick={() => go(index - 1, true)}><ChevronLeft size={20} /></button>
      <span>{index + 1} / {deck.slides.length}</span>
      {!playback.finished && <span role="status" aria-live="polite" style={{ maxWidth: 220 }}>{playback.waitingForClick ? target ? `${target.name}をクリック` : "クリックで再生" : step?.name ?? "アニメーション再生中"}</span>}
      {target && <button type="button" style={{ width: "auto", padding: "0 8px" }} aria-label={`${target.name}のクリック操作を実行`} onClick={() => { container.current?.focus({ preventScroll: true }); next(target.id); }}>実行</button>}
      <button type="button" aria-label={playback.finished ? "次のスライド" : "次のアニメーション"} disabled={!!target || (playback.finished && index >= deck.slides.length - 1)} onClick={() => next()}><ChevronRight size={20} /></button></div>
  </div>, ownerDocument.body);
}

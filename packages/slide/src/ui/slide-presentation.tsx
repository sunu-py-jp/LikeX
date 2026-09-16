"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { SlideDeck } from "../model/types";
import { SlideArtwork } from "./slide-artwork";

export function SlidePresentation({ deck, initialSlideId, ownerDocument, theme, onClose }: {
  deck: SlideDeck; initialSlideId: string; ownerDocument: Document; theme: CSSProperties; onClose(): void;
}) {
  const [index, setIndex] = useState(Math.max(0, deck.slides.findIndex(slide => slide.id === initialSlideId)));
  const [size, setSize] = useState({ width: ownerDocument.defaultView?.innerWidth ?? 1280, height: ownerDocument.defaultView?.innerHeight ?? 720 });
  const container = useRef<HTMLDivElement>(null);
  const slide = deck.slides[Math.min(index, deck.slides.length - 1)];
  const scale = Math.min(size.width / deck.width, size.height / deck.height);
  useEffect(() => {
    const previous = ownerDocument.activeElement as HTMLElement | null;
    container.current?.focus();
    return () => previous?.focus?.();
  }, [ownerDocument]);
  useLayoutEffect(() => {
    const node = container.current; if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node); return () => observer.disconnect();
  }, []);
  const move = (direction: number) => setIndex(value => Math.max(0, Math.min(deck.slides.length - 1, value + direction)));
  return createPortal(<div ref={container} data-likex-slide="" className="lxp-presentation" style={theme} role="dialog" aria-modal="true" aria-label="スライドショー" tabIndex={-1}
    onKeyDown={event => {
      // Portals keep React ancestry; presentation keys must never edit the deck.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(event.key)) { event.preventDefault(); move(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) { event.preventDefault(); move(-1); }
      else if (event.key === "Home") { event.preventDefault(); setIndex(0); }
      else if (event.key === "End") { event.preventDefault(); setIndex(deck.slides.length - 1); }
      else if (event.key === "Tab") {
        const buttons = Array.from(container.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        event.preventDefault();
        const current = buttons.indexOf(ownerDocument.activeElement as HTMLButtonElement);
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
    {slide && <div className="lxp-presentation-slide" style={{ width: deck.width * scale, height: deck.height * scale }} onClick={() => move(1)}><SlideArtwork deck={deck} slide={slide} scale={scale} /></div>}
    <button type="button" className="lxp-presentation-close" aria-label="スライドショーを終了" title="終了 (Esc)" onClick={onClose}><X size={22} /></button>
    <div className="lxp-presentation-controls"><button type="button" aria-label="前のスライド" disabled={index === 0} onClick={() => move(-1)}><ChevronLeft size={20} /></button>
      <span>{index + 1} / {deck.slides.length}</span><button type="button" aria-label="次のスライド" disabled={index >= deck.slides.length - 1} onClick={() => move(1)}><ChevronRight size={20} /></button></div>
  </div>, ownerDocument.body);
}

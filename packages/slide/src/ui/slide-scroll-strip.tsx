"use client";

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Arrows occupy space only while needed and never cover ribbon controls. */
export function SlideScrollStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const node = ref.current, wrapper = rail.current;
    if (!node || !wrapper) return;
    const fits = node.scrollWidth <= wrapper.clientWidth + 1;
    const next = { left: !fits && node.scrollLeft > 1, right: !fits && node.scrollLeft + node.clientWidth < node.scrollWidth - 1 };
    setArrows(old => old.left === next.left && old.right === next.right ? old : next);
  }, []);
  useLayoutEffect(() => {
    const node = ref.current;
    const view = node?.ownerDocument.defaultView;
    if (!node || !view) return;
    const observer = new ResizeObserver(update);
    observer.observe(node); if (rail.current) observer.observe(rail.current);
    Array.from(node.children).forEach(item => observer.observe(item));
    update();
    return () => observer.disconnect();
  }, [children, update]);
  useLayoutEffect(update, [arrows.left, arrows.right, update]);
  const move = (direction: -1 | 1) => {
    const node = ref.current; if (!node) return;
    const items = Array.from(node.children) as HTMLElement[];
    const start = node.getBoundingClientRect().left;
    const boundaries = items.map(item => item.getBoundingClientRect().left - start + node.scrollLeft);
    const target = direction === 1 ? boundaries.find(left => left > node.scrollLeft + 1) ?? node.scrollWidth :
      boundaries.reverse().find(left => left < node.scrollLeft - 1) ?? 0;
    node.scrollTo({ left: target, behavior: node.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  return <div className="lxp-ribbon-strip" ref={rail}>
    {arrows.left && <button className="lxp-scroll-arrow" type="button" aria-label="前のリボングループ" onClick={() => move(-1)}><ChevronLeft size={16} /></button>}
    <div className="lxp-ribbon-scroll" ref={ref} onScroll={update}>{children}</div>
    {arrows.right && <button className="lxp-scroll-arrow" type="button" aria-label="次のリボングループ" onClick={() => move(1)}><ChevronRight size={16} /></button>}
  </div>;
}

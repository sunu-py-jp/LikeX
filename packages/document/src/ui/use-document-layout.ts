"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { observeResponsiveLayout, type ResponsiveLayout } from "../core";

/** Keep the paper's millimetre dimensions intact; only its on-screen magnification changes. */
export function documentFitZoom(viewportWidth: number, pageWidthMm: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(pageWidthMm) || pageWidthMm <= 0) return 100;
  return Math.max(1, Math.min(100, Math.floor(Math.max(1, viewportWidth - 16) / (pageWidthMm * 96 / 25.4) * 100)));
}

export function useDocumentLayout(root: RefObject<HTMLElement | null>, viewport: RefObject<HTMLElement | null>,
  ownerDocument: Document | null, layout: ResponsiveLayout, pageWidthMm: number) {
  const [resolved, setResolved] = useState<"desktop" | "mobile">(layout === "mobile" ? "mobile" : "desktop");
  const [fitZoom, setFitZoom] = useState(100);
  useLayoutEffect(() => {
    const element = root.current;
    if (element) return observeResponsiveLayout(element, layout, setResolved);
  }, [root, ownerDocument, layout]);
  useLayoutEffect(() => {
    const element = viewport.current, view = element?.ownerDocument?.defaultView;
    if (!element || resolved !== "mobile") return;
    const resize = () => setFitZoom(documentFitZoom(element.clientWidth, pageWidthMm));
    resize();
    const observer = view?.ResizeObserver && new view.ResizeObserver(resize);
    observer?.observe(element);
    view?.addEventListener("resize", resize);
    return () => { observer?.disconnect(); view?.removeEventListener("resize", resize); };
  }, [viewport, ownerDocument, resolved, pageWidthMm]);
  return { layout: resolved, mobile: resolved === "mobile", fitZoom };
}

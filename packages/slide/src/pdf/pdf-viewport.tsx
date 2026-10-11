"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { PdfPageCanvas, usePdfPage } from "./pdf-page-canvas";
import type { PdfSession } from "./use-pdf-document";

export function PdfViewport({ session, pageNumber, zoom, onError }: {
  session: PdfSession; pageNumber: number; zoom: number; onError(error: Error): void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const result = usePdfPage(session, pageNumber, onError), page = result?.page;
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = (entry?: ResizeObserverEntry) => setSize(previous => {
      // clientHeight/clientWidth round fractional layout up and exclude scrollbars.
      // Feeding them back into the page's minimum size can alternate both scrollbars
      // forever. Measure the stable outer box and round down before fitting.
      const box = entry?.borderBoxSize?.[0], css = node.ownerDocument.defaultView?.getComputedStyle?.(node);
      const pixels = (value?: string) => { const number = Number.parseFloat(value ?? ""); return Number.isFinite(number) ? number : undefined; };
      const borderWidth = (pixels(css?.borderLeftWidth) ?? 0) + (pixels(css?.borderRightWidth) ?? 0);
      const borderHeight = (pixels(css?.borderTopWidth) ?? 0) + (pixels(css?.borderBottomWidth) ?? 0);
      const cssWidth = pixels(css?.width), cssHeight = pixels(css?.height);
      // Computed layout pixels avoid applying an ancestor's CSS transform twice,
      // unlike getBoundingClientRect's visual pixels.
      const width = box ? box.inlineSize - borderWidth : cssWidth === undefined ? node.offsetWidth ?? node.clientWidth : cssWidth - (css?.boxSizing === "border-box" ? borderWidth : 0);
      const height = box ? box.blockSize - borderHeight : cssHeight === undefined ? node.offsetHeight ?? node.clientHeight : cssHeight - (css?.boxSizing === "border-box" ? borderHeight : 0);
      const next = { width: Math.floor(width) || 900, height: Math.floor(height) || 600 };
      return next.width === previous.width && next.height === previous.height ? previous : next;
    });
    update();
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(entries => update(entries.find(entry => entry.target === node))) : undefined;
    observer?.observe(node, { box: "border-box" });
    const window = node.ownerDocument.defaultView, resize = () => update();
    window?.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window?.removeEventListener("resize", resize); };
  }, []);
  useLayoutEffect(() => { if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; } }, [pageNumber, session]);
  const scale = page ? Math.min(Math.max(1, size.width - 48) / page.width, Math.max(1, size.height - 48) / page.height) * zoom / 100 : 1;
  const width = page ? page.width * scale : 0, height = page ? page.height * scale : 0;
  return <div ref={viewport} className="lxp-canvas-viewport lxp-pdf-viewport" tabIndex={0} aria-label={`PDFページ ${pageNumber}`}>
    {page ? <div className="lxp-pdf-page-center" style={{ minWidth: width + 48, minHeight: height + 48 }}>
      <div className="lxp-canvas-frame lxp-pdf-page-frame" style={{ width, height }}>
        <PdfPageCanvas page={page} width={width} height={height} label={`PDFページ ${pageNumber}`} onError={onError} />
      </div>
    </div> : <div className="lxp-pdf-placeholder" role={result?.error ? "alert" : "status"}>
      {result?.error ? result.error.message : <><Loader2 size={22} className="lxp-spin" /><span>ページを読み込んでいます…</span></>}
    </div>}
  </div>;
}

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
    const update = () => setSize(previous => {
      const next = { width: node.clientWidth || 900, height: node.clientHeight || 600 };
      return next.width === previous.width && next.height === previous.height ? previous : next;
    });
    update();
    const Observer = node.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(update) : undefined; observer?.observe(node);
    const window = node.ownerDocument.defaultView;
    window?.addEventListener("resize", update);
    return () => { observer?.disconnect(); window?.removeEventListener("resize", update); };
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

"use client";

import { useEffect, useRef, useState } from "react";
import type { SlidePdfPage } from "./types";
import { pdfError, type PdfSession } from "./use-pdf-document";

const MAIN_BITMAP_PIXELS = 8_000_000, THUMBNAIL_BITMAP_PIXELS = 200_000, BITMAP_EDGE = 8192;

export function PdfPageCanvas({ page, width, height, label, thumbnail = false, onError }: {
  page: SlidePdfPage; width: number; height: number; label: string; thumbnail?: boolean; onError(error: Error): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [finished, setFinished] = useState<{ page: SlidePdfPage; width: number; height: number } | null>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const controller = new AbortController();
    const scratch = target.ownerDocument.createElement("canvas");
    const ratio = Math.max(1, Math.min(2, target.ownerDocument.defaultView?.devicePixelRatio ?? 1));
    const scale = Math.min(width / page.width * ratio,
      Math.sqrt((thumbnail ? THUMBNAIL_BITMAP_PIXELS : MAIN_BITMAP_PIXELS) / (page.width * page.height)),
      BITMAP_EDGE / page.width, BITMAP_EDGE / page.height);
    scratch.width = Math.max(1, Math.floor(page.width * scale)); scratch.height = Math.max(1, Math.floor(page.height * scale));
    void (async () => {
      try {
        await page.render({ canvas: scratch, scale, signal: controller.signal });
        if (controller.signal.aborted) return;
        const context = target.getContext("2d");
        if (!context) throw new Error("PDFを描画するCanvasを利用できません。");
        target.width = scratch.width; target.height = scratch.height;
        context.drawImage(scratch, 0, 0);
        setFinished({ page, width, height });
      } catch (error) { if (!controller.signal.aborted) onError(pdfError(error)); }
      finally { scratch.width = 0; scratch.height = 0; }
    })();
    return () => { controller.abort(); target.width = 0; target.height = 0; scratch.width = 0; scratch.height = 0; };
  }, [page, width, height, thumbnail, onError]);
  const ready = finished?.page === page && finished.width === width && finished.height === height;
  return <canvas ref={canvas} className="lxp-pdf-canvas" role="img" aria-label={label} aria-busy={!ready}
    style={{ width, height, visibility: ready ? "visible" : "hidden" }}>{label}</canvas>;
}

export function usePdfPage(session: PdfSession, pageNumber: number, onError: (error: Error) => void) {
  const [result, setResult] = useState<{ session: PdfSession; pageNumber: number; page?: SlidePdfPage; error?: Error } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void session.getPage(pageNumber, controller.signal).then(page => {
      if (!controller.signal.aborted) setResult({ session, pageNumber, page });
    }, error => {
      if (controller.signal.aborted) return;
      const failure = pdfError(error); setResult({ session, pageNumber, error: failure }); onError(failure);
    });
    return () => controller.abort();
  }, [session, pageNumber, onError]);
  return result?.session === session && result.pageNumber === pageNumber ? result : null;
}

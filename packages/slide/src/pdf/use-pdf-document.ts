"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlidePdfDocument, SlidePdfLoader, SlidePdfPage } from "./types";

export const PDF_PAGE_CACHE_SIZE = 12;
export const PDF_VIEWER_PAGE_LIMIT = 10_000;
export type PdfSession = { pageCount: number; getPage(pageNumber: number, signal: AbortSignal): Promise<SlidePdfPage> };
type Result = { loader: SlidePdfLoader; session?: PdfSession; error?: Error };
export const pdfError = (error: unknown) => error instanceof Error ? error : new Error(String(error));
export function notifyPdfObserver<T>(observer: ((value: T) => void) | undefined, value: T) {
  try { void Promise.resolve(observer?.(value)).catch(() => {}); } catch { /* Observer failures do not change the viewer's resource lifecycle. */ }
}

export function usePdfDocument(loadPdf: SlidePdfLoader, onLoad?: (event: { pageCount: number }) => void, onError?: (error: Error) => void) {
  const [result, setResult] = useState<Result | null>(null);
  const callbacks = useRef({ onLoad, onError });
  useLayoutEffect(() => { callbacks.current = { onLoad, onError }; });
  useEffect(() => {
    const controller = new AbortController(), cache = new Map<number, SlidePdfPage>();
    let document: SlidePdfDocument | undefined, destroyed = false;
    const destroy = (value: SlidePdfDocument) => { void Promise.resolve().then(() => value.destroy()).catch(() => {}); };
    void (async () => {
      try {
        const loaded = await loadPdf({ signal: controller.signal });
        if (controller.signal.aborted) { if (loaded && typeof loaded.destroy === "function") destroy(loaded); return; }
        document = loaded;
        if (!loaded || !Number.isSafeInteger(loaded.pageCount) || loaded.pageCount < 1 || loaded.pageCount > PDF_VIEWER_PAGE_LIMIT ||
          typeof loaded.getPage !== "function" || typeof loaded.destroy !== "function") throw new Error("PDFのページ情報が正しくないか、10,000ページの上限を超えています。");
        const session: PdfSession = { pageCount: loaded.pageCount, async getPage(pageNumber, signal) {
          signal.throwIfAborted(); controller.signal.throwIfAborted();
          const cached = cache.get(pageNumber);
          if (cached) { cache.delete(pageNumber); cache.set(pageNumber, cached); return cached; }
          const page = await loaded.getPage(pageNumber, { signal });
          signal.throwIfAborted(); controller.signal.throwIfAborted();
          if (!page || ![page.width, page.height].every(value => Number.isFinite(value) && value > 0 && value <= 10_000_000) || typeof page.render !== "function")
            throw new Error("PDFページの寸法または描画機能が正しくありません。");
          cache.set(pageNumber, page);
          while (cache.size > PDF_PAGE_CACHE_SIZE) cache.delete(cache.keys().next().value!);
          return page;
        } };
        setResult({ loader: loadPdf, session });
        notifyPdfObserver(callbacks.current.onLoad, { pageCount: loaded.pageCount });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (document && typeof document.destroy === "function") { destroy(document); destroyed = true; }
        const failure = pdfError(error);
        setResult({ loader: loadPdf, error: failure });
        notifyPdfObserver(callbacks.current.onError, failure);
      }
    })();
    return () => { controller.abort(); cache.clear(); if (document && !destroyed && typeof document.destroy === "function") destroy(document); };
  }, [loadPdf]);
  return result?.loader === loadPdf ? result : null;
}

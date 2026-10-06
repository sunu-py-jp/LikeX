import type { SlidePdfInput, SlidePdfJsModule, SlidePdfLoader, SlidePdfLoaderOptions, SlidePdfPage, SlidePdfRenderOptions } from "./types";
import { aborted, check, cleanupPage, createPdfSource, promiseLike, SLIDE_PDF_LIMITS, wait } from "./pdfjs-source";
export { SLIDE_PDF_LIMITS } from "./pdfjs-source";

type Viewport = { width: number; height: number };
type RenderTask = { promise: PromiseLike<unknown>; cancel(): void };
type PdfPage = {
  getViewport(options: { scale: number }): Viewport;
  render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: Viewport; annotationMode: number }): RenderTask;
  cleanup?(): unknown;
};
const canvasOwners = new WeakMap<HTMLCanvasElement, () => void>();

function validViewport(viewport: Viewport, rendered: boolean): void {
  const width = rendered ? Math.ceil(viewport.width) : viewport.width;
  const height = rendered ? Math.ceil(viewport.height) : viewport.height;
  const maximum = rendered ? SLIDE_PDF_LIMITS.renderDimension : SLIDE_PDF_LIMITS.pageDimension;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > maximum || height > maximum ||
    rendered && width * height > SLIDE_PDF_LIMITS.renderPixels) throw new Error("PDFページの寸法または描画画素数が上限を超えています");
}

/**
 * Host-injected PDF.js adapter. Configure its GlobalWorkerOptions in the host.
 * Only supplied file bytes are loaded. No annotation/link layer, actions or scripting manager is created.
 */
export function createSlidePdfLoader(pdfjs: SlidePdfJsModule, data: SlidePdfInput, options: SlidePdfLoaderOptions = {}): SlidePdfLoader {
  const loadSource = createPdfSource(pdfjs, data, options);
  return async context => {
    const source = await loadSource(context), document = source.document;
    const pageStates = new WeakMap<PdfPage, { renders: number }>();
    return Object.freeze({
      pageCount: document.numPages,
      destroy: source.destroy,
      async getPage(pageNumber: number, { signal: pageSignal }: { signal?: AbortSignal } = {}): Promise<SlidePdfPage> {
        check(source.signal, pageSignal);
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document!.numPages) throw new Error("PDFページ番号が範囲外です");
        const page = await wait(() => document.getPage(pageNumber) as PromiseLike<PdfPage>, [source.signal, pageSignal], undefined, cleanupPage);
        if (!page || typeof page.getViewport !== "function" || typeof page.render !== "function") throw new Error("PDFページを取得できません");
        let base: Viewport;
        try { check(source.signal, pageSignal); base = page.getViewport({ scale: 1 }); validViewport(base, false); }
        catch (error) { cleanupPage(page); throw error; }
        let state = pageStates.get(page);
        if (!state) { state = { renders: 0 }; pageStates.set(page, state); }
        const pageState = state;
        return Object.freeze({ width: base.width, height: base.height,
          async render({ canvas, scale, signal: renderSignal }: SlidePdfRenderOptions) {
            check(source.signal, renderSignal);
            if (!Number.isFinite(scale) || scale <= 0) throw new Error("PDFの描画倍率は正の有限数を指定してください");
            const viewport = page.getViewport({ scale }); validViewport(viewport, true);
            if (!canvas || typeof canvas.getContext !== "function" || !canvas.ownerDocument) throw new Error("描画先のCanvasを指定してください");
            const target = canvas.getContext("2d");
            if (!target) throw new Error("PDFの描画先に2D Canvasを利用できません");
            // Render privately; a cancelled or superseded task must never paint onto a newer page.
            const staging = canvas.ownerDocument.createElement("canvas");
            staging.width = Math.ceil(viewport.width); staging.height = Math.ceil(viewport.height);
            const context = staging.getContext("2d");
            if (!context) { staging.width = staging.height = 0; throw new Error("PDFの描画に2D Canvasを利用できません"); }
            const current = new AbortController(), cancel = () => current.abort(aborted());
            canvasOwners.get(canvas)?.(); canvasOwners.set(canvas, cancel);
            let renderTask: RenderTask | undefined;
            const cancelTask = () => { renderTask?.cancel(); };
            const released = () => { pageState.renders--; if (!pageState.renders) cleanupPage(page); };
            try {
              await wait(() => {
                pageState.renders++;
                try {
                  renderTask = page.render({ canvas: staging, canvasContext: context, viewport, annotationMode: 0 });
                  if (!renderTask || !promiseLike(renderTask.promise) || typeof renderTask.cancel !== "function") throw new Error("PDFの描画タスクが正しくありません");
                } catch (error) { released(); throw error; }
                void Promise.resolve(renderTask.promise).then(released, released);
                if (source.signal.aborted || renderSignal?.aborted || current.signal.aborted) cancelTask();
                return renderTask.promise;
              }, [source.signal, renderSignal, current.signal], cancelTask);
              check(source.signal, renderSignal, current.signal);
              if (canvasOwners.get(canvas) !== cancel) throw aborted();
              canvas.width = staging.width; canvas.height = staging.height;
              target.drawImage(staging, 0, 0);
            } finally {
              if (canvasOwners.get(canvas) === cancel) canvasOwners.delete(canvas);
              staging.width = staging.height = 0;
            }
          },
        });
      },
    });
  };
}

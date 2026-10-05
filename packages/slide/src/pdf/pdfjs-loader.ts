import type { SlidePdfDocument, SlidePdfInput, SlidePdfJsModule, SlidePdfLoader, SlidePdfLoaderOptions, SlidePdfPage, SlidePdfRenderOptions } from "./types";

export const SLIDE_PDF_LIMITS = Object.freeze({ fileBytes: 100 * 1024 * 1024, pages: 2_000,
  pageDimension: 100_000, renderDimension: 16_384, renderPixels: 40_000_000 });

type Viewport = { width: number; height: number };
type RenderTask = { promise: PromiseLike<unknown>; cancel(): void };
type PdfPage = {
  getViewport(options: { scale: number }): Viewport;
  render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: Viewport; annotationMode: number }): RenderTask;
  cleanup?(): unknown;
};
type PdfDocument = { numPages: number; getPage(pageNumber: number): PromiseLike<PdfPage>; destroy?(): PromiseLike<unknown> };
type LoadingTask = { promise: PromiseLike<PdfDocument>; destroy(): PromiseLike<unknown> };
const canvasOwners = new WeakMap<HTMLCanvasElement, () => void>();
const aborted = () => Object.assign(new Error("PDFの処理を中止しました"), { name: "AbortError" });
const reason = (signal: AbortSignal) => signal.reason === undefined ? aborted() : signal.reason;
const check = (...signals: (AbortSignal | undefined)[]) => {
  for (const signal of signals) if (signal?.aborted) throw reason(signal);
};
const promiseLike = (value: unknown): value is PromiseLike<unknown> => !!value && typeof (value as PromiseLike<unknown>).then === "function";
const cleanupPage = (page: PdfPage) => { try { page.cleanup?.(); } catch { /* Document destruction remains the final cleanup boundary. */ } };

/** Reject promptly while still observing work which cannot be interrupted or settles late. */
function wait<T>(start: () => PromiseLike<T> | T, signals: readonly (AbortSignal | undefined)[],
  cancel?: () => void, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const active = [...new Set(signals.filter((signal): signal is AbortSignal => !!signal))];
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      for (const signal of active) signal.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      const signal = active.find(signal => signal.aborted);
      if (!signal || settled) return;
      try { cancel?.(); } catch { /* Keep the host's cancellation reason. */ }
      finish(() => reject(reason(signal)));
    };
    for (const signal of active) signal.addEventListener("abort", onAbort, { once: true });
    onAbort();
    if (settled) return;
    try {
      Promise.resolve(start()).then(value => {
        if (settled) { try { late?.(value); } catch { /* Late results are never published. */ } return; }
        finish(() => resolve(value));
      }, error => finish(() => reject(error)));
    } catch (error) { finish(() => reject(error)); }
  });
}

function optionsSnapshot(options: SlidePdfLoaderOptions): SlidePdfLoaderOptions {
  const keys = ["cMapUrl", "cMapPacked", "standardFontDataUrl", "wasmUrl"];
  if (!options || typeof options !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(key => typeof key !== "string" || !keys.includes(key) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value"))) throw new Error("PDF読み込みの設定が正しくありません");
  for (const key of ["cMapUrl", "standardFontDataUrl", "wasmUrl"] as const)
    if (options[key] !== undefined && (typeof options[key] !== "string" || !options[key] || options[key].length > 4096))
      throw new Error("PDFの補助データURLが正しくありません");
  if (options.cMapPacked !== undefined && typeof options.cMapPacked !== "boolean") throw new Error("cMapPackedはtrueまたはfalseで指定してください");
  return { ...options };
}

function inputSnapshot(input: SlidePdfInput): Uint8Array | Blob {
  const size = input instanceof Uint8Array || input instanceof ArrayBuffer ? input.byteLength
    : typeof Blob !== "undefined" && input instanceof Blob ? input.size : NaN;
  if (!Number.isSafeInteger(size) || size < 1 || size > SLIDE_PDF_LIMITS.fileBytes)
    throw new Error("PDFは空でない100 MiB以下のBlob・Uint8Array・ArrayBufferを指定してください");
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  return input as Blob;
}

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
  if (!pdfjs || typeof pdfjs.getDocument !== "function") throw new Error("PDF.jsのgetDocumentを指定してください");
  const source = inputSnapshot(data), settings = optionsSnapshot(options);
  return async ({ signal }): Promise<SlidePdfDocument> => {
    if (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" ||
      typeof signal.removeEventListener !== "function") throw new Error("PDF読み込みのAbortSignalを指定してください");
    check(signal);
    const sourceBytes = source instanceof Uint8Array ? source : new Uint8Array(await wait(() => source.arrayBuffer(), [signal]));
    check(signal);
    if (!sourceBytes.byteLength || sourceBytes.byteLength > SLIDE_PDF_LIMITS.fileBytes) throw new Error("PDFのファイルサイズが上限を超えています");
    // Each PDF.js loading task can transfer its data to a worker; retain the factory snapshot for retries.
    const task = pdfjs.getDocument({ ...settings, data: new Uint8Array(sourceBytes), isEvalSupported: false, enableXfa: false,
      disableAutoFetch: true, disableStream: true, stopAtErrors: true, maxImageSize: SLIDE_PDF_LIMITS.renderPixels,
      canvasMaxAreaInBytes: SLIDE_PDF_LIMITS.renderPixels * 4 }) as LoadingTask;
    if (!task || !promiseLike(task.promise) || typeof task.destroy !== "function") throw new Error("PDF.jsの読み込みタスクが正しくありません");
    const lifetime = new AbortController();
    let document: PdfDocument | undefined, destruction: Promise<void> | undefined, nativeDestruction: Promise<void> | undefined;
    const destroyLateDocument = (value: PdfDocument): Promise<void> => {
      nativeDestruction ??= Promise.resolve().then(async () => { await value.destroy?.(); });
      return nativeDestruction;
    };
    const destroy = (why: unknown = aborted()): Promise<void> => {
      if (destruction) return destruction;
      // Set before aborting: a synchronous render cancellation can re-enter destroy.
      // PDF.js 6 owns destruction on the loading task, including after loading completes.
      destruction = Promise.resolve().then(async () => { await task.destroy(); });
      signal.removeEventListener("abort", onAbort);
      lifetime.abort(why);
      return destruction;
    };
    const onAbort = () => { void destroy(reason(signal)).catch(() => {}); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    // Observe the existing loading promise even when abort occurred inside getDocument.
    const ready = Promise.resolve(task.promise).then(value => {
      document = value;
      // Older injected adapters may still publish a document after ignoring task destruction.
      if (lifetime.signal.aborted && value && typeof value.destroy === "function") void destroyLateDocument(value).catch(() => {});
      return value;
    });
    void ready.catch(() => {});
    try {
      document = await wait(() => ready, [lifetime.signal]);
      check(lifetime.signal);
      if (!document || typeof document.getPage !== "function" ||
        !Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > SLIDE_PDF_LIMITS.pages)
        throw new Error("PDFのページ数は1〜2000ページにしてください");
      const pageStates = new WeakMap<PdfPage, { renders: number }>();
      return Object.freeze({
        pageCount: document.numPages,
        destroy: () => destroy(),
        async getPage(pageNumber: number, { signal: pageSignal }: { signal?: AbortSignal } = {}): Promise<SlidePdfPage> {
          check(lifetime.signal, pageSignal);
          if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document!.numPages) throw new Error("PDFページ番号が範囲外です");
          const page = await wait(() => document!.getPage(pageNumber), [lifetime.signal, pageSignal], undefined, cleanupPage);
          if (!page || typeof page.getViewport !== "function" || typeof page.render !== "function") throw new Error("PDFページを取得できません");
          let base: Viewport;
          try { check(lifetime.signal, pageSignal); base = page.getViewport({ scale: 1 }); validViewport(base, false); }
          catch (error) { cleanupPage(page); throw error; }
          let state = pageStates.get(page);
          if (!state) { state = { renders: 0 }; pageStates.set(page, state); }
          const pageState = state;
          return Object.freeze({ width: base.width, height: base.height,
            async render({ canvas, scale, signal: renderSignal }: SlidePdfRenderOptions) {
              check(lifetime.signal, renderSignal);
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
                  if (lifetime.signal.aborted || renderSignal?.aborted || current.signal.aborted) cancelTask();
                  return renderTask.promise;
                }, [lifetime.signal, renderSignal, current.signal], cancelTask);
                check(lifetime.signal, renderSignal, current.signal);
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
    } catch (error) {
      void destroy(error).catch(() => {});
      if (error instanceof Error && error.name === "PasswordException")
        throw new Error("パスワードで保護されたPDFには対応していません。保護を解除したPDFを指定してください", { cause: error });
      throw error;
    }
  };
}

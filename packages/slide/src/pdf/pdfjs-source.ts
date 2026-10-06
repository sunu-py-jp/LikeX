import type { OfficePackageSignal } from "../ooxml";
import type { PdfInput, PdfJsModule, PdfLoaderOptions } from "./text-types";

export const SLIDE_PDF_LIMITS = Object.freeze({ fileBytes: 100 * 1024 * 1024, pages: 2_000,
  pageDimension: 100_000, renderDimension: 16_384, renderPixels: 40_000_000 });
type PdfDocument = { numPages: number; getPage(pageNumber: number): PromiseLike<unknown>; destroy?(): PromiseLike<unknown> };
type LoadingTask = { promise: PromiseLike<PdfDocument>; destroy(): PromiseLike<unknown> };
export const aborted = () => Object.assign(new Error("PDFの処理を中止しました"), { name: "AbortError" });
export const reason = (signal: OfficePackageSignal) => signal.reason === undefined ? aborted() : signal.reason;
export const check = (...signals: (OfficePackageSignal | undefined)[]) => {
  for (const signal of signals) if (signal?.aborted) throw reason(signal);
};
export const promiseLike = (value: unknown): value is PromiseLike<unknown> => !!value && typeof (value as PromiseLike<unknown>).then === "function";
export const cleanupPage = (page: { cleanup?(): unknown }) => { try { page.cleanup?.(); } catch { /* Document destruction remains the final cleanup boundary. */ } };

/** Reject promptly while still observing work which cannot be interrupted or settles late. */
export function wait<T>(start: () => PromiseLike<T> | T, signals: readonly (OfficePackageSignal | undefined)[],
  cancel?: () => void, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const active = [...new Set(signals.filter((signal): signal is OfficePackageSignal => !!signal))];
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

function optionsSnapshot(options: PdfLoaderOptions): PdfLoaderOptions {
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

function inputSnapshot(input: PdfInput): Uint8Array | Exclude<PdfInput, ArrayBuffer | Uint8Array> {
  const size = input instanceof Uint8Array || input instanceof ArrayBuffer ? input.byteLength
    : input && typeof input === "object" && "size" in input && typeof input.arrayBuffer === "function" ? input.size : NaN;
  if (!Number.isSafeInteger(size) || size < 1 || size > SLIDE_PDF_LIMITS.fileBytes)
    throw new Error("PDFは空でない100 MiB以下のBlob・Uint8Array・ArrayBufferを指定してください");
  if (input instanceof Uint8Array) return new Uint8Array(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  const file = input as Exclude<PdfInput, ArrayBuffer | Uint8Array>;
  return { size, arrayBuffer: file.arrayBuffer.bind(file) };
}


/** Shared byte snapshot and PDF.js task ownership for rendering and headless text. */
export function createPdfSource(pdfjs: PdfJsModule, data: PdfInput, options: PdfLoaderOptions = {}) {
  if (!pdfjs || typeof pdfjs.getDocument !== "function") throw new Error("PDF.jsのgetDocumentを指定してください");
  const source = inputSnapshot(data), settings = optionsSnapshot(options);
  return async ({ signal }: { signal: OfficePackageSignal }) => {
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
      return { document, signal: lifetime.signal, destroy: () => destroy() };
    } catch (error) {
      void destroy(error).catch(() => {});
      if (error instanceof Error && error.name === "PasswordException")
        throw new Error("パスワードで保護されたPDFには対応していません。保護を解除したPDFを指定してください", { cause: error });
      throw error;
    }
  };
}

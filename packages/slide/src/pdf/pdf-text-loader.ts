import type { OfficePackageSignal } from "../ooxml";
import type { PdfInput, PdfJsModule, PdfLoaderOptions, PdfTextLoader } from "./text-types";
import { check, cleanupPage, createPdfSource, wait } from "./pdfjs-source";
import { PDF_SEARCH_LIMITS } from "./search-limits";

type TextPage = { getTextContent(options: { includeMarkedContent: false }): PromiseLike<unknown>; cleanup?(): unknown };

/** Preserve extraction order: adjacent fragments concatenate, explicit line endings add LF. */
function pageText(value: unknown): string {
  if (!value || typeof value !== "object" || !("items" in value) || !Array.isArray(value.items) || value.items.length > PDF_SEARCH_LIMITS.textItemsPerPage)
    throw new Error("PDFページの文字情報が正しくないか、項目数が上限を超えています");
  const parts: string[] = [];
  let length = 0;
  for (const item of value.items) {
    if (!item || typeof item.str !== "string" || (item.hasEOL !== undefined && typeof item.hasEOL !== "boolean"))
      throw new Error("PDFページの文字情報が正しくありません");
    length += item.str.length + (item.hasEOL ? 1 : 0);
    if (length > PDF_SEARCH_LIMITS.pageTextCharacters) throw new Error("PDFページの文字数が上限を超えています");
    parts.push(item.str);
    if (item.hasEOL) parts.push("\n");
  }
  return parts.join("");
}

/** Extract native PDF text with the host's PDF.js; never initializes rendering, Canvas, React or OCR. */
export function createPdfTextLoader(pdfjs: PdfJsModule, data: PdfInput, options: PdfLoaderOptions = {}): PdfTextLoader {
  const loadSource = createPdfSource(pdfjs, data, options);
  return async context => {
    const source = await loadSource(context), counts = new WeakMap<TextPage, number>();
    // PDF.js can return the same cached page to concurrent requests. A cancelled
    // acquisition must leave cleanup to any extraction still using that page.
    const cleanupIfIdle = (page: TextPage) => { if (!counts.get(page)) cleanupPage(page); };
    return Object.freeze({
      pageCount: source.document.numPages,
      destroy: source.destroy,
      async getPageText(pageNumber: number, { signal }: { signal?: OfficePackageSignal } = {}): Promise<string> {
        check(source.signal, signal);
        if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > source.document.numPages) throw new Error("PDFページ番号が範囲外です");
        const page = await wait(() => source.document.getPage(pageNumber) as PromiseLike<TextPage>, [source.signal, signal], undefined, cleanupIfIdle);
        try { check(source.signal, signal); } catch (cause) { cleanupIfIdle(page); throw cause; }
        if (!page || typeof page.getTextContent !== "function") { cleanupIfIdle(page); throw new Error("このPDFページは文字情報の取得に対応していません"); }
        counts.set(page, (counts.get(page) ?? 0) + 1);
        const released = () => {
          const count = counts.get(page)! - 1;
          if (count) counts.set(page, count);
          else { counts.delete(page); cleanupIfIdle(page); }
        };
        let pending: Promise<unknown>;
        try { pending = Promise.resolve(page.getTextContent({ includeMarkedContent: false })); }
        catch (cause) { released(); throw cause; }
        // A cancelled read can settle later; cleanup must not race the underlying extraction.
        void pending.then(released, released);
        const content = await wait(() => pending, [source.signal, signal]);
        check(source.signal, signal);
        return pageText(content);
      },
    });
  };
}

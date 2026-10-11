import type { OfficePackageSignal } from "../ooxml";
import { check, cleanupPage, wait } from "./pdfjs-source";
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

/** A PDF.js page may be shared by renders and text reads; clean it only when both finish. */
export function createPdfPageActivity() {
  const counts = new WeakMap<object, number>();
  const cleanupIfIdle = (page: { cleanup?(): unknown }) => { if (!counts.get(page)) cleanupPage(page); };
  return {
    cleanupIfIdle,
    retain(page: object) { counts.set(page, (counts.get(page) ?? 0) + 1); },
    release(page: { cleanup?(): unknown }) {
      const count = (counts.get(page) ?? 1) - 1;
      if (count) counts.set(page, count);
      else { counts.delete(page); cleanupIfIdle(page); }
    },
  };
}

/** Shared extraction for the headless loader and the viewer's already loaded PDF. */
export function createPdfPageTextReader(
  source: { document: { numPages: number; getPage(pageNumber: number): PromiseLike<unknown> }; signal: OfficePackageSignal },
  activity = createPdfPageActivity(),
) {
  return async (pageNumber: number, { signal }: { signal?: OfficePackageSignal } = {}): Promise<string> => {
    check(source.signal, signal);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > source.document.numPages) throw new Error("PDFページ番号が範囲外です");
    const page = await wait(() => source.document.getPage(pageNumber) as PromiseLike<TextPage>, [source.signal, signal], undefined, activity.cleanupIfIdle);
    try { check(source.signal, signal); } catch (cause) { activity.cleanupIfIdle(page); throw cause; }
    if (!page || typeof page.getTextContent !== "function") { activity.cleanupIfIdle(page); throw new Error("このPDFページは文字情報の取得に対応していません"); }
    activity.retain(page);
    const released = () => activity.release(page);
    let pending: Promise<unknown>;
    try { pending = Promise.resolve(page.getTextContent({ includeMarkedContent: false })); }
    catch (cause) { released(); throw cause; }
    // Even a cancelled read must retain the native page until extraction actually settles.
    void pending.then(released, released);
    const content = await wait(() => pending, [source.signal, signal]);
    check(source.signal, signal);
    return pageText(content);
  };
}

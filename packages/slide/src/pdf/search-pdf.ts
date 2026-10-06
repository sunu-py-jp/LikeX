import { createKeywordSearchMatcher } from "../model/core-text-search";
import { aborted, check, SLIDE_PDF_LIMITS, wait } from "./pdfjs-source";
import { PDF_SEARCH_LIMITS } from "./search-limits";
import type { PdfSearchOptions, PdfSearchQuery, PdfSearchResult, PdfTextDocument, PdfTextLoader } from "./text-types";

/** Search each page independently. Owns and destroys a fresh document from the supplied loader. */
export async function searchPdf(loadPdf: PdfTextLoader, query: PdfSearchQuery, options: PdfSearchOptions = {}): Promise<PdfSearchResult> {
  const matcher = createKeywordSearchMatcher(query);
  if (typeof loadPdf !== "function") throw new Error("PDF文字情報ローダーを指定してください");
  if (!options || typeof options !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(key => !["signal", "limit"].includes(String(key)) ||
      typeof key !== "string" || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value")))
    throw new Error("PDF検索の設定が正しくありません");
  const { limit = 1000, signal } = options;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw new Error("検索結果の上限は1〜10,000で指定してください");
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function"))
    throw new Error("PDF検索のAbortSignalを指定してください");
  check(signal);
  if (matcher.empty) return { matches: [], truncated: false };
  const lifetime = new AbortController(), onAbort = () => lifetime.abort(signal?.reason ?? aborted());
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  let document: PdfTextDocument | undefined, failed = false;
  const destruction = new WeakMap<PdfTextDocument, Promise<void>>();
  const destroy = (value: PdfTextDocument): Promise<void> => {
    let pending = destruction.get(value);
    if (!pending) { pending = Promise.resolve().then(() => value.destroy?.()); destruction.set(value, pending); }
    return pending;
  };
  try {
    document = await wait(() => loadPdf({ signal: lifetime.signal }), [lifetime.signal], undefined,
      value => { if (value && typeof value === "object") void destroy(value).catch(() => {}); });
    check(lifetime.signal);
    if (!document || typeof document.destroy !== "function" || typeof document.getPageText !== "function")
      throw new Error("PDF文字情報ローダーはgetPageTextとdestroyを提供してください。描画用ローダーだけでは検索できません");
    const pageCount = document.pageCount;
    if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > SLIDE_PDF_LIMITS.pages) throw new Error("PDFのページ数は1〜2000ページにしてください");
    const matches: PdfSearchResult["matches"] = [];
    let characters = 0, ranges = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const text = await wait(() => document!.getPageText(pageNumber, { signal: lifetime.signal }), [lifetime.signal]);
      check(lifetime.signal);
      if (typeof text !== "string" || text.length > PDF_SEARCH_LIMITS.pageTextCharacters) throw new Error("PDFページの文字情報が正しくないか、文字数が上限を超えています");
      characters += text.length;
      if (characters > PDF_SEARCH_LIMITS.totalTextCharacters) throw new Error("PDF検索の合計文字数が上限を超えています");
      if (!matcher.test(text)) continue;
      if (matches.length === limit) return { matches, truncated: true };
      const positions = matcher.find(text);
      ranges += positions.length;
      if (ranges > PDF_SEARCH_LIMITS.totalMatchRanges) throw new Error("PDF検索の一致位置の合計が上限を超えています");
      matches.push(Object.freeze({ pageNumber, text, matches: positions }));
    }
    return { matches, truncated: false };
  } catch (cause) { failed = true; throw cause; }
  finally {
    const cancelled = lifetime.signal.aborted;
    signal?.removeEventListener("abort", onAbort);
    const closing = document && typeof document === "object" ? destroy(document) : Promise.resolve();
    lifetime.abort();
    // Abort rejects promptly even if a host loader cannot promptly finish destruction.
    if (cancelled) void closing.catch(() => {});
    else try { await wait(() => closing, [signal]); } catch (cause) { if (!failed) throw cause; }
  }
}

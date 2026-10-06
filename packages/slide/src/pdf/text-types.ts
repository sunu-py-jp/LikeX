import type { OfficePackageInput, OfficePackageSignal } from "../ooxml";
import type { KeywordSearchQuery, KeywordTextMatch } from "../model/core-text-search";

/** DOM-free file input; browser Blobs also satisfy this contract. URLs are not accepted. */
export type PdfInput = OfficePackageInput;
export type PdfSearchQuery = KeywordSearchQuery;
export type PdfLoaderOptions = {
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  wasmUrl?: string;
};
/** Host-owned PDF.js injection. Configure its worker in the host. */
export type PdfJsModule = {
  getDocument(options: PdfLoaderOptions & {
    data: Uint8Array;
    isEvalSupported: false;
    enableXfa: false;
    disableAutoFetch: true;
    disableStream: true;
    stopAtErrors: true;
    maxImageSize: number;
    canvasMaxAreaInBytes: number;
  }): unknown;
};
/** A loader creates a fresh, exclusively owned document for each search. */
export type PdfTextLoader = (context: { signal: OfficePackageSignal }) => Promise<PdfTextDocument>;
export type PdfTextDocument = {
  readonly pageCount: number;
  /** One-based page number; text is in extraction order, without OCR or annotations. */
  getPageText(pageNumber: number, options?: { signal?: OfficePackageSignal }): Promise<string>;
  destroy(): Promise<void>;
};
export type PdfSearchOptions = {
  signal?: OfficePackageSignal;
  /** Maximum matching pages, default 1000, up to 10000. */
  limit?: number;
};
export type PdfSearchMatch = Readonly<{
  pageNumber: number;
  text: string;
  /** UTF-16 offsets into text. A page is one AND/OR search unit. */
  matches: readonly KeywordTextMatch[];
}>;
export type PdfSearchResult = { matches: PdfSearchMatch[]; truncated: boolean };

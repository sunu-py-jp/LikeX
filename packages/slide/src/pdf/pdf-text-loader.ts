import type { PdfInput, PdfJsModule, PdfLoaderOptions, PdfTextLoader } from "./text-types";
import { createPdfSource } from "./pdfjs-source";
import { createPdfPageTextReader } from "./pdf-page-text";

/** Extract native PDF text with the host's PDF.js; never initializes rendering, Canvas, React or OCR. */
export function createPdfTextLoader(pdfjs: PdfJsModule, data: PdfInput, options: PdfLoaderOptions = {}): PdfTextLoader {
  const loadSource = createPdfSource(pdfjs, data, options);
  return async context => {
    const source = await loadSource(context);
    return Object.freeze({
      pageCount: source.document.numPages,
      destroy: source.destroy,
      getPageText: createPdfPageTextReader(source),
    });
  };
}

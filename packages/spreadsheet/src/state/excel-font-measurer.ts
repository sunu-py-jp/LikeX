import type { SpreadsheetExcelColumnWidthMeasurer } from "../import/types";

/** Browser-only font measurement. Missing fonts/canvas use the importer's reported fallback. */
export function createSpreadsheetExcelFontMeasurer(ownerDocument?: Document): SpreadsheetExcelColumnWidthMeasurer {
  return async font => {
    const document = ownerDocument ?? (typeof globalThis.document === "undefined" ? undefined : globalThis.document);
    if (!document) return;
    const ratio = document.defaultView?.devicePixelRatio ?? 1;
    if (!Number.isFinite(ratio) || ratio < 0.25 || ratio > 8) return;
    let context: CanvasRenderingContext2D | null;
    try { context = document.createElement("canvas").getContext("2d"); } catch { return; }
    if (!context) return;
    const family = JSON.stringify(font.fontFamily);
    const prefix = `${font.italic ? "italic" : "normal"} ${font.bold ? "700" : "400"} ${font.fontSize * ratio}px`;
    const cssFont = `${prefix} ${family}`;
    try { await document.fonts?.load(cssFont, "0123456789"); } catch { return; }

    // FontFaceSet.check() also succeeds for an absent system font. A real font
    // produces the same advances with two different generic fallbacks; a missing
    // font must not silently supply the browser's unrelated default metrics.
    for (const sample of ["0123456789", "iiiiWWWW"]) {
      context.font = `${cssFont}, monospace`;
      const mono = context.measureText(sample).width;
      context.font = `${cssFont}, serif`;
      const serif = context.measureText(sample).width;
      if (!Number.isFinite(mono) || !Number.isFinite(serif) || Math.abs(mono - serif) > 0.01) return;
    }
    context.font = cssFont;
    // Advance widths define the column unit, not glyph ink bounds or cell padding.
    const maximumDigitWidth = Math.max(...Array.from("0123456789", digit => context.measureText(digit).width));
    if (!Number.isFinite(maximumDigitWidth) || maximumDigitWidth <= 0 || maximumDigitWidth > 4096) return;
    return { maximumDigitWidth, pixelRatio: ratio };
  };
}

import type { SpreadsheetCellFormat } from "../../model/types";

/** Measurements use sheet CSS pixels, before the grid's zoom is applied. */
export type CellMeasurementStyle = {
  fontFamily: string; fontSize: number; fontWeight: string; fontStyle: string; lineHeight: number;
  letterSpacing: number; wordSpacing: number; paddingX: number; paddingY: number;
  borderLeft: number; borderRight: number; borderTop: number; borderBottom: number;
  checkboxWidth: number; checkboxHeight: number; listWidth: number;
};
export type TextMeasurer = ((text: string, format?: SpreadsheetCellFormat) => number) & { cellStyle?: CellMeasurementStyle };
export const DEFAULT_CELL_MEASUREMENT: CellMeasurementStyle = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif',
  fontSize: 13, fontWeight: "400", fontStyle: "normal", lineHeight: 1.4,
  letterSpacing: 0, wordSpacing: 0, paddingX: 14, paddingY: 0,
  borderLeft: 0, borderRight: 1, borderTop: 0, borderBottom: 1,
  checkboxWidth: 16, checkboxHeight: 16, listWidth: 24,
};
export const estimateTextWidth: TextMeasurer = (text, format) => Array.from(text).reduce((width, character) =>
  width + (/[^\u0000-\u00ff]/.test(character) ? 1 : 0.58) * (format?.fontSize ?? 13), 0) * (format?.bold ? 1.06 : 1);
const pixels = (value: string, fallback: number) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : fallback;

function readCellStyle(document?: Document, source?: Element | null): CellMeasurementStyle {
  const fallback = { ...DEFAULT_CELL_MEASUREMENT };
  const view = document?.defaultView;
  if (!document || !view?.getComputedStyle) return fallback;
  const root = source?.closest?.("[data-likex-spreadsheet]") ?? document.activeElement?.closest?.("[data-likex-spreadsheet]")
    ?? (() => { const roots = document.querySelectorAll?.("[data-likex-spreadsheet]"); return roots?.length === 1 ? roots[0] : null; })();
  if (!root) return fallback;
  // One unformatted probe avoids borrowing an active cell's explicit bold/font
  // settings, and also includes the host's scoped .lxs-cell CSS overrides.
  const probe = document.createElement("div");
  probe.className = "lxs-cell";
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden";
  const parent = root.querySelector(".lxs-grid") ?? root;
  parent.appendChild(probe);
  try {
    const css = view.getComputedStyle(probe), size = pixels(css.fontSize, fallback.fontSize);
    const checkbox = root.querySelector(".lxs-cell-checkbox input"), list = root.querySelector(".lxs-cell-list");
    const checkboxStyle = checkbox ? view.getComputedStyle(checkbox) : undefined, listStyle = list ? view.getComputedStyle(list) : undefined;
    return {
      fontFamily: css.fontFamily || fallback.fontFamily, fontSize: size,
      fontWeight: css.fontWeight || fallback.fontWeight, fontStyle: css.fontStyle || fallback.fontStyle,
      lineHeight: pixels(css.lineHeight, size * fallback.lineHeight) / size,
      letterSpacing: pixels(css.letterSpacing, 0), wordSpacing: pixels(css.wordSpacing, 0),
      paddingX: pixels(css.paddingLeft, 7) + pixels(css.paddingRight, 7),
      paddingY: pixels(css.paddingTop, 0) + pixels(css.paddingBottom, 0),
      borderLeft: pixels(css.borderLeftWidth, 0), borderRight: pixels(css.borderRightWidth, 1),
      borderTop: pixels(css.borderTopWidth, 0), borderBottom: pixels(css.borderBottomWidth, 1),
      checkboxWidth: pixels(checkboxStyle?.width ?? "", 16), checkboxHeight: pixels(checkboxStyle?.height ?? "", 16),
      listWidth: pixels(listStyle?.width ?? "", 24),
    };
  } finally { probe.remove(); }
}

export function createTextMeasurer(ownerDocument?: Document, source?: Element | null): TextMeasurer {
  const style = readCellStyle(ownerDocument, source);
  let context: CanvasRenderingContext2D | null = null;
  try { context = ownerDocument?.createElement("canvas").getContext("2d") ?? null; } catch { /* Canvas is optional in non-browser hosts. */ }
  const measure: TextMeasurer = (text, format) => {
    const size = format?.fontSize ?? style.fontSize;
    if (!context) return estimateTextWidth(text, { ...format, fontSize: size }) + Array.from(text).length * style.letterSpacing + (text.match(/ /g)?.length ?? 0) * style.wordSpacing;
    context.font = `${format?.italic ? "italic" : style.fontStyle} ${format?.bold ? "700" : style.fontWeight} ${size}px ${format?.fontFamily ?? style.fontFamily}`;
    // Canvas supports native font shaping; measuring whole strings preserves
    // kerning, ligatures and CJK fallback fonts that per-character sums lose.
    const metrics = context.measureText(text);
    const ink = (metrics.actualBoundingBoxLeft ?? 0) + (metrics.actualBoundingBoxRight ?? 0);
    return Math.max(metrics.width, ink) + Array.from(text).length * style.letterSpacing + (text.match(/ /g)?.length ?? 0) * style.wordSpacing;
  };
  measure.cellStyle = style;
  return measure;
}

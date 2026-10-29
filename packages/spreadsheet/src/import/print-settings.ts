import { normalizeSpreadsheetPrintSettings } from "../model/print-settings";
import { SPREADSHEET_LIMITS, type SpreadsheetPrintSettings } from "../model/types";
import { child, children, type XmlNode } from "./xml";
import type { ImportContext } from "./types";

/** Recover each supported part independently; malformed optional print metadata never discards cell data. */
export function readWorksheetPrintSettings(node: XmlNode, sheetName: string, context: ImportContext): SpreadsheetPrintSettings | undefined {
  let result: SpreadsheetPrintSettings | undefined;
  const dimensions = { rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns };
  const warn = (message: string) => context.warn({ code: "omitted", sheetName, message });
  const set = (patch: Partial<SpreadsheetPrintSettings>) => {
    try { result = normalizeSpreadsheetPrintSettings({ ...result, ...patch }, dimensions); }
    catch { warn("不正または未対応の印刷設定を省略しました（セルの内容は保持）"); }
  };
  const setup = child(node, "pageSetup");
  if (setup) {
    const paper = setup.attributes.paperSize;
    if (paper === undefined || paper === "1") set({ paperSize: "Letter" });
    else if (paper === "8" || paper === "9") set({ paperSize: paper === "8" ? "A3" : "A4" });
    else warn("未対応の印刷用紙サイズをA4へ変更しました");
    if (setup.attributes.orientation !== undefined && setup.attributes.orientation !== "default") set({ orientation: setup.attributes.orientation as SpreadsheetPrintSettings["orientation"] });
    if (setup.attributes.scale !== undefined) set({ scale: Number(setup.attributes.scale) });
    const supported = new Set(["paperSize", "orientation", "scale", "pageOrder"]);
    if (Object.keys(setup.attributes).some(key => !supported.has(key)) || setup.attributes.pageOrder && setup.attributes.pageOrder !== "downThenOver")
      warn("ページ数に合わせる拡大縮小・印刷順序・プリンター固有などの未対応の印刷設定を省略しました");
  }
  if (child(child(node, "sheetPr"), "pageSetUpPr")?.attributes.fitToPage === "1" || child(child(node, "sheetPr"), "pageSetUpPr")?.attributes.fitToPage === "true")
    warn("指定ページ数に収める印刷倍率は未対応のため固定倍率で表示します");
  const margins = child(node, "pageMargins");
  if (margins) set({ margins: { top: Number(margins.attributes.top), bottom: Number(margins.attributes.bottom),
    left: Number(margins.attributes.left), right: Number(margins.attributes.right) } });
  for (const [element, key, limit, span] of [["rowBreaks", "rowBreaks", SPREADSHEET_LIMITS.rows, 16_383],
    ["colBreaks", "columnBreaks", SPREADSHEET_LIMITS.columns, 1_048_575]] as const) {
    const breaks: number[] = [];
    for (const entry of children(child(node, element), "brk")) {
      const id = Number(entry.attributes.id);
      // OOXML ids are zero-based positions before the next row/column. Automatic breaks are recomputed.
      if (entry.attributes.man !== "1" && entry.attributes.man !== "true") continue;
      if (!Number.isSafeInteger(id) || id <= 0 || id >= limit || Number(entry.attributes.min ?? 0) !== 0 || Number(entry.attributes.max ?? span) !== span) {
        warn("シート上限外・部分的または不正な手動改ページを省略しました"); continue;
      }
      breaks.push(id);
    }
    if (breaks.length) set({ [key]: breaks });
  }
  return result;
}

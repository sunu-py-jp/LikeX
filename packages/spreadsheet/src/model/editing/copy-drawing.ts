import type { SpreadsheetFeatures } from "../../api/features";
import { resolveSpreadsheetFeatures } from "../../api/resolve-features";
import { validateSpreadsheetFeatures } from "../../api/validate-features";
import type { SpreadsheetWorkbookSnapshot } from "../../commands/types";
import { normalizeDrawing } from "../annotations";
import { normalizeImageResource } from "../image-resources";
import { normalizeWorkbook } from "../workbook/normalize";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetImageResource, type SpreadsheetWorkbook } from "../types";

type DrawingSnapshot = SpreadsheetDrawing extends infer Drawing ? Drawing extends SpreadsheetDrawing
  ? Readonly<Omit<Drawing, "anchor"> & { anchor: Readonly<Drawing["anchor"]> }> : never : never;
/** JSON-serializable copy captured independently of the current source object or browser clipboard. */
export type SpreadsheetDrawingPastePayload = Readonly<{
  drawing: DrawingSnapshot;
  /** Required for images, so the copy survives deletion of the original resource. */
  resource?: Readonly<SpreadsheetImageResource>;
}>;
export type SpreadsheetDrawingCopyOptions = Readonly<{ features?: SpreadsheetFeatures }>;

/** Validate and isolate a caller-owned snapshot before it is used by a paste command. */
export function normalizeDrawingPastePayload(input: SpreadsheetDrawingPastePayload): SpreadsheetDrawingPastePayload {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "drawing" && key !== "resource"))
    throw new Error("図形のコピー内容が正しくありません");
  const drawing = input.drawing;
  if (!drawing || typeof drawing !== "object" || Array.isArray(drawing)) throw new Error("図形のコピー内容が正しくありません");
  const common = ["id", "type", "anchor", "width", "height"];
  const specific = drawing.type === "image" ? ["resourceId", "alt"] : drawing.type === "shape"
    ? ["shape", "fill", "stroke", "strokeWidth", "text", "fontSize", "color", "bold"] : ["text", "fontSize", "color", "background", "bold"];
  if (Object.keys(drawing).some(key => !common.includes(key) && !specific.includes(key)) || !drawing.anchor ||
    Object.keys(drawing.anchor).some(key => !["row", "column", "offsetX", "offsetY"].includes(key)))
    throw new Error("図形のコピー内容に未対応のプロパティがあります");
  const resource = drawing.type === "image" ? normalizeImageResource(input.resource!) : undefined;
  if (drawing.type !== "image" && input.resource !== undefined) throw new Error("画像以外には画像リソースを指定できません");
  const normalized = normalizeDrawing(drawing, { rowCount: SPREADSHEET_LIMITS.rows, columnCount: SPREADSHEET_LIMITS.columns },
    resource && drawing.type === "image" ? { images: { [drawing.resourceId]: resource } } : undefined);
  return Object.freeze({ drawing: normalized, ...(resource ? { resource } : {}) });
}

/** Read a shape, image or text box without rendering UI or mutating the workbook. */
export function copySpreadsheetDrawing(input: SpreadsheetWorkbookSnapshot, sheetId: string, drawingId: string,
  options: SpreadsheetDrawingCopyOptions = {}): SpreadsheetDrawingPastePayload {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => key !== "features"))
    throw new Error("コピーの設定が正しくありません");
  validateSpreadsheetFeatures(options.features);
  const features = resolveSpreadsheetFeatures(options.features);
  if (!features.copy) throw new Error("コピーは無効です");
  const workbook = normalizeWorkbook(input as SpreadsheetWorkbook);
  const drawing = workbook.sheets.find(sheet => sheet.id === sheetId)?.drawings?.find(item => item.id === drawingId);
  if (!drawing) throw new Error("コピーする描画オブジェクトが見つかりません");
  const feature = drawing.type === "image" ? "images" : drawing.type === "shape" ? "shapes" : "textBoxes";
  if (!features[feature]) throw new Error(`機能「${feature}」は無効です`);
  return normalizeDrawingPastePayload({ drawing, ...(drawing.type === "image" ? { resource: workbook.resources?.images?.[drawing.resourceId] } : {}) });
}

export type SpreadsheetCellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  background?: string;
  numberFormat?: "general" | "number" | "currency" | "percent";
};

export type SpreadsheetCell = { value: string; format?: SpreadsheetCellFormat };
export type SpreadsheetImageResource = {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataUrl: string;
  width: number;
  height: number;
};
export type SpreadsheetDrawingAnchor = { row: number; column: number; offsetX: number; offsetY: number };
type SpreadsheetDrawingBase = { id: string; anchor: SpreadsheetDrawingAnchor; width: number; height: number };
export type SpreadsheetImageDrawing = SpreadsheetDrawingBase & { type: "image"; resourceId: string; alt: string };
export type SpreadsheetShapeDrawing = SpreadsheetDrawingBase & {
  type: "shape"; shape: "rectangle" | "ellipse" | "line" | "arrow"; fill: string; stroke: string; strokeWidth: number;
  /** Optional shape text; omitted formatting uses 16 px, #1f2937 and normal weight. */
  text?: string; fontSize?: number; color?: string; bold?: boolean;
};
export type SpreadsheetTextDrawing = SpreadsheetDrawingBase & {
  type: "text"; text: string; fontSize: number; color: string; background: string; bold?: boolean;
};
export type SpreadsheetDrawing = SpreadsheetImageDrawing | SpreadsheetShapeDrawing | SpreadsheetTextDrawing;
/** Identity and drawing type are stable; an anchor update supplies all four coordinates. */
export type SpreadsheetDrawingPatch = Partial<Omit<SpreadsheetDrawingBase, "id"> & {
  resourceId: string; alt: string; shape: SpreadsheetShapeDrawing["shape"]; fill: string; stroke: string;
  strokeWidth: number; text: string; fontSize: number; color: string; background: string; bold: boolean;
}>;
export type SpreadsheetComment = { id: string; text: string; author?: string };
/** Inclusive, zero-based rectangle. The top-left cell stores the merged value and comment. */
export type SpreadsheetMergedRange = Readonly<{ top: number; left: number; bottom: number; right: number }>;
export type SpreadsheetSheet = {
  id: string;
  name: string;
  cells: Readonly<Record<string, SpreadsheetCell>>;
  rowCount: number;
  columnCount: number;
  columnWidths?: Readonly<Record<number, number>>;
  rowHeights?: Readonly<Record<number, number>>;
  drawings?: readonly SpreadsheetDrawing[];
  comments?: Readonly<Record<string, SpreadsheetComment>>;
  merges?: readonly SpreadsheetMergedRange[];
};
export type SpreadsheetWorkbook = {
  schemaVersion?: 1;
  sheets: readonly SpreadsheetSheet[];
  resources?: { images?: Readonly<Record<string, SpreadsheetImageResource>> };
};
/** Zero-based row and column coordinates. */
export type SpreadsheetCellPosition = { row: number; column: number };
export type SpreadsheetCalculatedValue = string | number | boolean;
export type SpreadsheetMoveSource = { sheetId: string; top: number; left: number; bottom: number; right: number };
export type SpreadsheetMoveTarget = { sheetId: string; row: number; column: number };

export const SPREADSHEET_LIMITS = Object.freeze({ rows: 10_000, columns: 1_000, cells: 100_000,
  sheets: 100, cellLength: 100_000, formulaLength: 4_096, formulaTokens: 2_048,
  rangeCells: 10_000, evaluationSteps: 200_000, referenceDepth: 128,
  clipboardCharacters: 10 * 1024 * 1024, clipboardCells: 10_000,
  imageBytes: 5 * 1024 * 1024, totalImageBytes: 20 * 1024 * 1024,
  imageDimension: 10_000, imagePixels: 16_000_000, images: 1_000,
  drawings: 1_000, comments: 10_000, merges: 1_000, commentLength: 10_000, drawingTextLength: 100_000,
  serializedCharacters: 64 * 1024 * 1024 });

import type { SpreadsheetConditionalFormatRule } from "./conditional-formatting";
import type { SpreadsheetCellBorders } from "./formatting/types";
import type { SpreadsheetDataValidation } from "./data-validation";
import type { SpreadsheetTable } from "./tables/types";
import type { SpreadsheetShapeKind } from "./shapes";
import type { ConnectorArrowhead, ConnectorBinding, ConnectorEndpoint } from "./core-connectors";
export type { ConnectorArrowhead as SpreadsheetLineArrowhead, ConnectorBinding as SpreadsheetLineBinding, ConnectorEndpoint as SpreadsheetLineEndpoint, ConnectorPort as SpreadsheetLinePort } from "./core-connectors";

export type SpreadsheetCellFormat = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  background?: string;
  fontFamily?: string;
  /** Font size in CSS pixels. XLSX converts pixels to points.
   * @minimum 1
   * @maximum 200
   */
  fontSize?: number;
  wrap?: boolean;
  verticalAlign?: "top" | "middle" | "bottom";
  borders?: SpreadsheetCellBorders;
  numberFormat?: "general" | "text" | "number" | "currency" | "percent" | "date" | "time" | "datetime";
  decimalPlaces?: number;
  useGrouping?: boolean;
  negativeFormat?: "minus" | "parentheses" | "red" | "red-parentheses";
};

export type SpreadsheetCell = { value: string; format?: SpreadsheetCellFormat; validation?: SpreadsheetDataValidation };
export type SpreadsheetImageResource = {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataUrl: string;
  width: number;
  height: number;
};
export type SpreadsheetDrawingAnchor = { row: number; column: number; offsetX: number; offsetY: number };
/** Free endpoints follow their cell anchors; bound endpoints resolve to the target's current port. */
export type SpreadsheetStoredLineEndpoint = Readonly<{ anchor: SpreadsheetDrawingAnchor; binding?: ConnectorBinding }>;
export type SpreadsheetLine = Readonly<{ start: SpreadsheetStoredLineEndpoint; end: SpreadsheetStoredLineEndpoint }>;
export type SpreadsheetLineRouting = "straight" | "elbow";
export type SpreadsheetLinePoints = Readonly<{ start: ConnectorEndpoint; end: ConnectorEndpoint }>;
type SpreadsheetDrawingBase = {
  id: string; anchor: SpreadsheetDrawingAnchor; width: number; height: number;
  /** Reflection within the positive-sized frame. Omitted flags mean false; text stays readable. */
  flipX?: boolean; flipY?: boolean;
  /** Clockwise degrees about the frame center. Finite values normalize to [0, 360); zero is omitted. */
  rotation?: number;
};
export type SpreadsheetImageDrawing = SpreadsheetDrawingBase & { type: "image"; resourceId: string; alt: string };
export type SpreadsheetShapeDrawing = SpreadsheetDrawingBase & {
  type: "shape"; shape: SpreadsheetShapeKind; fill: string; stroke: string;
  /** @minimum 0
   * @maximum 100
   */
  strokeWidth: number;
  /** Only line/arrow shapes. Omitted on legacy rectangle-based lines. */
  line?: SpreadsheetLine;
  /** Two-endpoint routing. Omitted means straight; elbow is recalculated from current targets. */
  routing?: SpreadsheetLineRouting;
  /** End markers. Legacy shape:arrow defaults its end to triangle; otherwise none. */
  startArrow?: ConnectorArrowhead; endArrow?: ConnectorArrowhead;
  /** Optional shape text; omitted formatting uses 16 px, #1f2937 and normal weight. */
  text?: string;
  /** @minimum 1
   * @maximum 400
   */
  fontSize?: number; color?: string; bold?: boolean;
};
export type SpreadsheetTextDrawing = SpreadsheetDrawingBase & {
  type: "text"; text: string;
  /** @minimum 1
   * @maximum 400
   */
  fontSize: number; color: string; background: string; bold?: boolean;
};
export type SpreadsheetDrawing = SpreadsheetImageDrawing | SpreadsheetShapeDrawing | SpreadsheetTextDrawing;
/** Identity and drawing type are stable; an anchor update supplies all four coordinates. */
export type SpreadsheetDrawingPatch = Partial<Omit<SpreadsheetDrawingBase, "id"> & {
  resourceId: string; alt: string; shape: SpreadsheetShapeDrawing["shape"]; fill: string; stroke: string;
  /** @minimum 0
   * @maximum 100
   */
  strokeWidth: number; text: string;
  /** @minimum 1
   * @maximum 400
   */
  fontSize: number; color: string; background: string; bold: boolean;
  line: SpreadsheetLine; routing: SpreadsheetLineRouting; startArrow: ConnectorArrowhead; endArrow: ConnectorArrowhead;
}>;
export type SpreadsheetComment = { id: string; text: string; author?: string };
/** Inclusive, zero-based rectangle. The top-left cell stores the merged value and comment. */
export type SpreadsheetMergedRange = Readonly<{ top: number; left: number; bottom: number; right: number }>;
/** Workbook-scoped identity and name for a single, same-sheet rectangle. */
export type SpreadsheetNamedRange = Readonly<{ id: string; name: string; sheetId: string; range: SpreadsheetMergedRange }>;
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
  conditionalFormats?: readonly SpreadsheetConditionalFormatRule[];
  tables?: readonly SpreadsheetTable[];
};
export const SPREADSHEET_FORMAT = "likex.spreadsheet" as const;
export type SpreadsheetWorkbook = {
  /** Optional for host-created runtime models; normalized workbooks always include the format. */
  format?: typeof SPREADSHEET_FORMAT;
  /** Runtime model version; serialized files use the separate SpreadsheetFile layout. */
  schemaVersion?: 1;
  sheets: readonly SpreadsheetSheet[];
  resources?: { images?: Readonly<Record<string, SpreadsheetImageResource>> };
  namedRanges?: readonly SpreadsheetNamedRange[];
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
  drawings: 1_000, comments: 10_000, merges: 1_000, namedRanges: 1_000, tables: 1_000, commentLength: 10_000, drawingTextLength: 100_000,
  serializedCharacters: 64 * 1024 * 1024 });

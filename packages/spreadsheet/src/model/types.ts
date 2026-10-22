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
  /** Omitted or general uses the value type. centerContinuous centers across adjacent blank cells with the same alignment. */
  align?: "general" | "left" | "center" | "right" | "fill" | "justify" | "centerContinuous" | "distributed";
  color?: string;
  background?: string;
  fontFamily?: string;
  /** Font size in CSS pixels. XLSX converts pixels to points.
   * @minimum 1
   * @maximum 200
   */
  fontSize?: number;
  /** Wrap within the cell. Takes display priority when shrinkToFit is also true. */
  wrap?: boolean;
  /** Reduce the displayed text size to fit the cell without changing fontSize. Omitted means false. */
  shrinkToFit?: boolean;
  /** Omitted uses middle. XLSX calls middle "center". */
  verticalAlign?: "top" | "middle" | "bottom" | "justify" | "distributed";
  /** Integer indentation level, in units of three spaces. Used by left/right and both edges of distributed alignment.
   * @minimum 0
   * @maximum 250
   */
  indent?: number;
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
export type SpreadsheetImageDrawing = SpreadsheetDrawingBase & {
  type: "image"; resourceId: string; alt: string;
  /** Omitted/contain preserves the source aspect ratio; fill stretches the image to its frame. */
  fit?: "contain" | "fill";
};
/** Optional drawing text properties; omitted fields use the LikeX defaults. */
export type SpreadsheetDrawingTextStyle = {
  fontFamily?: string; italic?: boolean; underline?: boolean;
  /** Insets in CSS pixels. Defaults to 0px on each side for native LikeX objects. Imported Office insets are retained. */
  textInsets?: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  textWrap?: "wrap" | "none";
  textOverflow?: "clip" | "overflow";
  textVerticalOverflow?: "clip" | "overflow";
  textAlign?: "left" | "center" | "right";
  textVerticalAlign?: "top" | "middle" | "bottom";
  /** shrink fits text to the frame; resize allows the text area to grow vertically. */
  textAutoFit?: "none" | "shrink" | "resize";
  /** Saved DrawingML font scale, used before browser measurements are available.
   * @minimum 0.01
   * @maximum 1
   */
  textFontScale?: number;
  /** Line height as a font-size multiple.
   * @minimum 0.1
   * @maximum 10
   */
  textLineHeight?: number;
};
export type SpreadsheetShapeDrawing = SpreadsheetDrawingBase & SpreadsheetDrawingTextStyle & {
  type: "shape"; shape: SpreadsheetShapeKind; fill: string; stroke: string;
  /** @minimum 0
   * @maximum 100
   */
  strokeWidth: number;
  /** Rounded rectangle radius as a fraction of its shorter side. Omitted uses 0.16667.
   * @minimum 0
   * @maximum 0.5
   */
  cornerRadiusRatio?: number;
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
export type SpreadsheetTextDrawing = SpreadsheetDrawingBase & SpreadsheetDrawingTextStyle & {
  type: "text"; text: string;
  /** @minimum 1
   * @maximum 400
   */
  fontSize: number; color: string; background: string; bold?: boolean;
};
export type SpreadsheetDrawing = SpreadsheetImageDrawing | SpreadsheetShapeDrawing | SpreadsheetTextDrawing;
/** Identity and drawing type are stable; an anchor update supplies all four coordinates. */
export type SpreadsheetDrawingPatch = Partial<Omit<SpreadsheetDrawingBase, "id"> & SpreadsheetDrawingTextStyle & {
  resourceId: string; alt: string; fit: SpreadsheetImageDrawing["fit"]; shape: SpreadsheetShapeDrawing["shape"]; fill: string; stroke: string;
  /** @minimum 0
   * @maximum 100
   */
  strokeWidth: number; text: string;
  /** Rounded rectangle radius as a fraction of its shorter side.
   * @minimum 0
   * @maximum 0.5
   */
  cornerRadiusRatio: number;
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
/** Inclusive zero-based area. "end" follows the current sheet edge, including future growth. */
export type SpreadsheetFormatRangeBounds = Readonly<{ top: number; left: number; bottom: number | "end"; right: number | "end" }>;
/** A complete shared base format; ranges do not overlap. Explicit cell formats override it completely. */
export type SpreadsheetFormatRange = Readonly<{ range: SpreadsheetFormatRangeBounds; format: SpreadsheetCellFormat }>;
export type SpreadsheetSheet = {
  id: string;
  name: string;
  cells: Readonly<Record<string, SpreadsheetCell>>;
  rowCount: number;
  columnCount: number;
  formatRanges?: readonly SpreadsheetFormatRange[];
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
  formatRanges: 100_000, drawings: 1_000, comments: 10_000, merges: 10_000, namedRanges: 1_000, tables: 1_000, commentLength: 10_000, drawingTextLength: 100_000,
  serializedCharacters: 64 * 1024 * 1024 });

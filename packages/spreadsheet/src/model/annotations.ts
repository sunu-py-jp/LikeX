import { cellAddress, parseCellAddress } from "./address";
import { validateObjectId } from "./image-resources";
import { SPREADSHEET_LIMITS, type SpreadsheetComment, type SpreadsheetDrawing, type SpreadsheetSheet, type SpreadsheetTextDrawing, type SpreadsheetWorkbook } from "./types";

const fail = (message: string): never => { throw new Error(message); };
function text(value: string, limit: number, label: string): string {
  if (typeof value !== "string" || value.length > limit) return fail(`${label}の文字数が上限を超えています`);
  return value;
}
function number(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) return fail("描画オブジェクトのサイズまたは位置が正しくありません");
  return value;
}
/** Restrict SVG/CSS paint values to colors: URL paints and CSS variable indirection are not accepted. */
function color(value: string): string {
  if (typeof value !== "string" || value.length > 100 ||
    !/^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([\d.%+\-,/\s]+\))$/i.test(value))
    return fail("描画オブジェクトの色が正しくありません");
  return value;
}
function drawingText(input: Pick<SpreadsheetTextDrawing, "text" | "fontSize" | "color" | "bold">, label: string) {
  if (input.bold !== undefined && typeof input.bold !== "boolean") return fail(`${label}の書式が正しくありません`);
  return { text: text(input.text, SPREADSHEET_LIMITS.drawingTextLength, label),
    fontSize: number(input.fontSize, 1, 400), color: color(input.color),
    ...(input.bold !== undefined ? { bold: input.bold } : {}) };
}

export function normalizeDrawing(input: SpreadsheetDrawing, sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">,
  resources: SpreadsheetWorkbook["resources"]): SpreadsheetDrawing {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("描画オブジェクトが正しくありません");
  const id = validateObjectId(input.id), anchor = input.anchor;
  if (!anchor || !Number.isInteger(anchor.row) || !Number.isInteger(anchor.column) || anchor.row < 0 || anchor.row >= sheet.rowCount ||
    anchor.column < 0 || anchor.column >= sheet.columnCount) return fail("描画オブジェクトの位置がシートの範囲外です");
  const common = { id, anchor: Object.freeze({ row: anchor.row, column: anchor.column,
    offsetX: number(anchor.offsetX, 0, 10_000), offsetY: number(anchor.offsetY, 0, 10_000) }),
  width: number(input.width, input.type === "image" ? Number.MIN_VALUE : 1, 10_000),
  height: number(input.height, input.type === "image" ? Number.MIN_VALUE : 1, 10_000) };
  if (input.type === "image") {
    const resourceId = validateObjectId(input.resourceId);
    if (!resources?.images || !Object.hasOwn(resources.images, resourceId)) return fail("画像のリソースが見つかりません");
    return Object.freeze({ ...common, type: "image", resourceId, alt: text(input.alt, 10_000, "画像の説明") });
  }
  if (input.type === "shape") {
    if (!["rectangle", "ellipse", "line", "arrow"].includes(input.shape)) return fail("図形の種類が正しくありません");
    const content = drawingText({ text: input.text === undefined ? "" : input.text,
      fontSize: input.fontSize === undefined ? 16 : input.fontSize,
      color: input.color === undefined ? "#1f2937" : input.color, bold: input.bold }, "図形のテキスト");
    return Object.freeze({ ...common, type: "shape", shape: input.shape, fill: color(input.fill), stroke: color(input.stroke),
      strokeWidth: number(input.strokeWidth, 0, 100),
      ...(input.text !== undefined ? { text: content.text } : {}),
      ...(input.fontSize !== undefined ? { fontSize: content.fontSize } : {}),
      ...(input.color !== undefined ? { color: content.color } : {}),
      ...(content.bold !== undefined ? { bold: content.bold } : {}) });
  }
  if (input.type === "text") {
    return Object.freeze({ ...common, type: "text", ...drawingText(input, "テキストボックス"), background: color(input.background) });
  }
  return fail("描画オブジェクトの種類が正しくありません");
}

export function normalizeDrawings(input: SpreadsheetSheet["drawings"], sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">,
  resources: SpreadsheetWorkbook["resources"]): SpreadsheetSheet["drawings"] {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > SPREADSHEET_LIMITS.drawings) return fail("描画オブジェクトの数が上限を超えています");
  const ids = new Set<string>();
  const drawings = Array.from(input, drawing => {
    const normalized = normalizeDrawing(drawing, sheet, resources);
    if (ids.has(normalized.id)) return fail("同じ ID の描画オブジェクトがあります");
    ids.add(normalized.id);
    return normalized;
  });
  return drawings.length ? Object.freeze(drawings) : undefined;
}

export function normalizeComment(input: SpreadsheetComment): SpreadsheetComment {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("コメントが正しくありません");
  return Object.freeze({ id: validateObjectId(input.id), text: text(input.text, SPREADSHEET_LIMITS.commentLength, "コメント"),
    ...(input.author !== undefined ? { author: text(input.author, 200, "コメントの作成者") } : {}) });
}

export function normalizeComments(input: SpreadsheetSheet["comments"], sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): SpreadsheetSheet["comments"] {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("コメント一覧が正しくありません");
  const entries = Object.entries(input);
  if (entries.length > SPREADSHEET_LIMITS.comments) return fail("コメントの数が上限を超えています");
  const comments: Record<string, SpreadsheetComment> = Object.create(null), ids = new Set<string>();
  for (const [address, inputComment] of entries) {
    const position = parseCellAddress(address);
    if (!position || position.row >= sheet.rowCount || position.column >= sheet.columnCount) return fail("コメントの位置がシートの範囲外です");
    const canonical = cellAddress(position.row, position.column), comment = normalizeComment(inputComment);
    if (Object.hasOwn(comments, canonical) || ids.has(comment.id)) return fail("同じ位置または ID のコメントが重複しています");
    ids.add(comment.id);
    comments[canonical] = comment;
  }
  return entries.length ? Object.freeze(comments) : undefined;
}

export function drawingsEqual(left: SpreadsheetDrawing, right: SpreadsheetDrawing): boolean {
  if (left === right) return true;
  if (left.id !== right.id || left.type !== right.type || left.width !== right.width || left.height !== right.height ||
    left.anchor.row !== right.anchor.row || left.anchor.column !== right.anchor.column ||
    left.anchor.offsetX !== right.anchor.offsetX || left.anchor.offsetY !== right.anchor.offsetY) return false;
  if (left.type === "image" && right.type === "image") return left.resourceId === right.resourceId && left.alt === right.alt;
  if (left.type === "shape" && right.type === "shape") return left.shape === right.shape && left.fill === right.fill && left.stroke === right.stroke &&
    left.strokeWidth === right.strokeWidth && (left.text ?? "") === (right.text ?? "") && (left.fontSize ?? 16) === (right.fontSize ?? 16) &&
    (left.color ?? "#1f2937") === (right.color ?? "#1f2937") && !!left.bold === !!right.bold;
  return left.type === "text" && right.type === "text" && left.text === right.text && left.fontSize === right.fontSize &&
    left.color === right.color && left.background === right.background && !!left.bold === !!right.bold;
}
export function commentsEqual(left: SpreadsheetComment | undefined, right: SpreadsheetComment | undefined): boolean {
  return left === right || (!!left && !!right && left.id === right.id && left.text === right.text && left.author === right.author);
}

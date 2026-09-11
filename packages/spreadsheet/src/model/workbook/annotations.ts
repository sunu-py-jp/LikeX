import { cellAddress, parseCellAddress } from "../address";
import { commentsEqual, drawingsEqual, normalizeComment, normalizeDrawing } from "../annotations";
import { normalizeResources, pruneImageResources, validateObjectId } from "../image-resources";
import { getMergedRange, mergedCellPosition } from "../merges";
import type { SpreadsheetComment, SpreadsheetDrawing, SpreadsheetDrawingPatch, SpreadsheetImageDrawing, SpreadsheetImageResource, SpreadsheetWorkbook } from "../types";
import { finishWorkbook, getWorkbookSheet, replaceWorkbookSheet } from "./snapshot";
import { canonicalCellAddress, fail } from "./validation";

export function addDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawing: SpreadsheetDrawing): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), next = normalizeDrawing(drawing, sheet, workbook.resources);
  if (sheet.drawings?.some(item => item.id === next.id)) return fail("同じ ID の描画オブジェクトがあります");
  return replaceWorkbookSheet(workbook, { ...sheet, drawings: Object.freeze([...(sheet.drawings ?? []), next]) });
}

export function updateDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawingId: string, patch: SpreadsheetDrawingPatch): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), current = sheet.drawings?.find(item => item.id === drawingId);
  if (!current) return fail("描画オブジェクトが見つかりません");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.hasOwn(patch, "id") || Object.hasOwn(patch, "type"))
    return fail("描画オブジェクトの ID と種類は変更できません");
  const next = normalizeDrawing({ ...current, ...patch } as SpreadsheetDrawing, sheet, workbook.resources);
  if (drawingsEqual(current, next)) return workbook;
  const sheets = workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze(sheet.drawings!.map(drawing => drawing.id === drawingId ? next : drawing)) }) : item);
  return finishWorkbook(sheets, workbook, current.type === "image" && next.type === "image" && current.resourceId !== next.resourceId
    ? pruneImageResources(workbook.resources, sheets) : workbook.resources);
}

export function deleteDrawing(workbook: SpreadsheetWorkbook, sheetId: string, drawingId: string): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (!sheet.drawings?.some(item => item.id === drawingId)) return workbook;
  const sheets = workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze(sheet.drawings!.filter(drawing => drawing.id !== drawingId)) }) : item);
  return finishWorkbook(sheets, workbook, pruneImageResources(workbook.resources, sheets));
}

/** Add an embedded resource and its drawing atomically; a referenced ID cannot be silently replaced. */
export function insertImage(workbook: SpreadsheetWorkbook, sheetId: string, resourceId: string,
  resource: SpreadsheetImageResource, drawing: SpreadsheetImageDrawing): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  validateObjectId(resourceId);
  if (!drawing || drawing.type !== "image" || drawing.resourceId !== resourceId) return fail("画像のリソース ID が一致していません");
  const resources = normalizeResources({ images: { ...workbook.resources?.images, [resourceId]: resource } });
  const previous = workbook.resources?.images?.[resourceId], next = resources!.images![resourceId];
  if (previous && (previous.dataUrl !== next.dataUrl || previous.name !== next.name || previous.mimeType !== next.mimeType ||
    previous.width !== next.width || previous.height !== next.height)) return fail("同じ ID の画像リソースを別の画像に置き換えることはできません");
  const normalized = normalizeDrawing(drawing, sheet, resources);
  if (sheet.drawings?.some(item => item.id === normalized.id)) return fail("同じ ID の描画オブジェクトがあります");
  return finishWorkbook(workbook.sheets.map(item => item.id === sheetId
    ? Object.freeze({ ...sheet, drawings: Object.freeze([...(sheet.drawings ?? []), normalized]) }) : item), workbook, resources);
}

export function setCellComments(workbook: SpreadsheetWorkbook, sheetId: string,
  input: Readonly<Record<string, SpreadsheetComment | null>>): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId);
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("コメント一覧が正しくありません");
  const comments = { ...sheet.comments };
  let changed = false;
  for (const [address, value] of Object.entries(input)) {
    const key = canonicalCellAddress(sheet, address), next = value === null ? undefined : normalizeComment(value);
    const merge = getMergedRange(sheet, parseCellAddress(key)!);
    if (next && merge && key !== cellAddress(merge.top, merge.left)) return fail("結合セルのコメントは左上のセルにだけ保存してください");
    if (commentsEqual(comments[key], next)) continue;
    changed = true;
    if (next) comments[key] = next;
    else delete comments[key];
  }
  if (!changed) return workbook;
  const ids = new Set<string>();
  for (const comment of Object.values(comments)) {
    if (ids.has(comment.id)) return fail("同じ ID のコメントがあります");
    ids.add(comment.id);
  }
  return replaceWorkbookSheet(workbook, { ...sheet, comments: Object.freeze(comments) });
}

export function setCellComment(workbook: SpreadsheetWorkbook, sheetId: string, address: string,
  comment: SpreadsheetComment | null): SpreadsheetWorkbook {
  const sheet = getWorkbookSheet(workbook, sheetId), position = mergedCellPosition(sheet, parseCellAddress(canonicalCellAddress(sheet, address))!);
  return setCellComments(workbook, sheetId, { [cellAddress(position.row, position.column)]: comment });
}

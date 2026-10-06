import type { SpreadsheetWorkbook } from "./types";
import { validateId } from "./query-validation";

/** Exact ID/name selectors. Supplying both requires that they resolve to the same sheet. */
export type SpreadsheetSheetTarget = Readonly<
  { sheetId: string; sheetName?: string } | { sheetId?: string; sheetName: string }
>;

/** Shared view target resolution. Callers validate the workbook at their own input boundary. */
export function resolveSpreadsheetSheet(workbook: SpreadsheetWorkbook, target: { sheetId?: string; sheetName?: string } = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(target)) || Reflect.ownKeys(target).some(key =>
      (key !== "sheetId" && key !== "sheetName") || !Object.hasOwn(Object.getOwnPropertyDescriptor(target, key)!, "value")))
    throw new Error("表示するシートの指定が正しくありません");
  const { sheetId, sheetName } = target;
  if (sheetId !== undefined) validateId(sheetId);
  if (sheetName !== undefined && (typeof sheetName !== "string" || !sheetName.length)) throw new Error("表示するシート名が正しくありません");
  const byId = sheetId === undefined ? [] : workbook.sheets.filter(sheet => sheet.id === sheetId);
  const byName = sheetName === undefined ? [] : workbook.sheets.filter(sheet => sheet.name === sheetName);
  if ((sheetId !== undefined && byId.length !== 1) || (sheetName !== undefined && byName.length !== 1))
    throw new Error("表示するシートが見つからないか、同じ名前またはIDが重複しています");
  if (byId[0] && byName[0] && byId[0] !== byName[0]) throw new Error("シートIDとシート名は同じシートを指定してください");
  return byId[0] ?? byName[0] ?? workbook.sheets[0];
}

import type { SpreadsheetWorkbook } from "../../model/types";
import { xml, xlsxText } from "./xml";

/** Excel list validation uses named ranges to preserve commas, quotes, and long lists. */
export function createValidationListRegistry(workbook: SpreadsheetWorkbook) {
  const lists = new Map<string, { values: readonly string[]; name: string; firstRow: number }>();
  let rowCount = 0;
  for (const sheet of workbook.sheets) for (const cell of Object.values(sheet.cells)) {
    if (cell.validation?.type !== "list" && cell.validation?.type !== "checkbox") continue;
    const values = cell.validation.type === "list" ? cell.validation.values : ["TRUE", "FALSE"], key = JSON.stringify(values);
    if (lists.has(key)) continue;
    if (rowCount + values.length > 100_000) throw new Error("Excel出力用の入力候補が合計100,000件を超えています");
    lists.set(key, { values, name: `_LikeX_list_${lists.size + 1}`, firstRow: rowCount + 1 });
    rowCount += values.length;
  }
  const sheetNames = new Set(workbook.sheets.map(sheet => sheet.name.toLocaleLowerCase("en-US")));
  let sheetName = "_LikeX_lists", suffix = 1;
  while (sheetNames.has(sheetName.toLocaleLowerCase("en-US"))) sheetName = `_LikeX_lists_${suffix++}`;
  const formulaForList = (values: readonly string[]): string => {
    const source = lists.get(JSON.stringify(values));
    if (!source) throw new Error("Excel入力候補の参照が見つかりません");
    return source.name;
  };
  const definedNamesXml = lists.size ? `<definedNames>${[...lists.values()].map(list =>
    `<definedName name="${list.name}" hidden="1">${xml(`'${sheetName}'!$A$${list.firstRow}:$A$${list.firstRow + list.values.length - 1}`)}</definedName>`).join("")}</definedNames>` : "";
  const worksheetXml = () => {
    const rows = [...lists.values()].flatMap(list => list.values.map((value, index) => {
      if (value.length > 32_767 || (value.match(/\n/g)?.length ?? 0) > 253) throw new Error("Excel入力候補の文字数・改行数の上限を超えています");
      const row = list.firstRow + index;
      return `<row r="${row}"><c r="A${row}" t="inlineStr"><is><t xml:space="preserve">${xlsxText(value)}</t></is></c></row>`;
    })).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A${rowCount}"/><sheetData>${rows}</sheetData></worksheet>`;
  };
  return { hasLists: lists.size > 0, sheetName, formulaForList, definedNamesXml, worksheetXml };
}

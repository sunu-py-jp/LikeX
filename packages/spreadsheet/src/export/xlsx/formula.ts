import { parseFormula, tokenizeFormula, type FormulaReference } from "../../model/formula";
import { SUPPORTED_SPREADSHEET_FUNCTIONS } from "../../model/function-definitions";
import { parseCellAddress } from "../../model/address";
import type { SpreadsheetSheet, SpreadsheetWorkbook } from "../../model/types";

const functions = new Set<string>(SUPPORTED_SPREADSHEET_FUNCTIONS.map(item => item.name));
export const EXCEL_ERRORS = new Set(["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]);

/** Emit only the model's bounded, local formula language; never activate arbitrary Excel functions. */
export function xlsxFormula(value: string, workbook: SpreadsheetWorkbook, sheet: SpreadsheetSheet): string {
  try {
    const parsed = parseFormula(value), tokens = tokenizeFormula(value);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.kind === "end") continue;
      if (token.kind === "name") {
        const call = tokens[index + 1]?.text === "(";
        if (call ? !functions.has(token.text) : !["TRUE", "FALSE"].includes(token.text)) throw new Error("未対応の関数または名前です");
      } else if (token.kind === "error") {
        if (!EXCEL_ERRORS.has(token.text)) throw new Error("Excel未対応のエラー値です");
      }
    }
    function reference(input: FormulaReference, inherited = sheet) {
      const target = input.sheet === undefined ? inherited
        : workbook.sheets.find(item => item.name.toLocaleLowerCase("en-US") === input.sheet!.toLocaleLowerCase("en-US"));
      const position = parseCellAddress(input.address.replaceAll("$", ""));
      if (!target || !position || position.row >= target.rowCount || position.column >= target.columnCount)
        throw new Error("参照先がブック内の範囲外です");
      return { target, text: input.sheet === undefined ? input.address.toUpperCase()
        : `'${target.name.replaceAll("'", "''")}'!${input.address.toUpperCase()}` };
    }
    // Explicit operator grouping preserves the evaluator's precedence during Excel recalculation.
    function emit(node: ReturnType<typeof parseFormula>, nested = false, calls = 0): string {
      switch (node.type) {
        case "value": return typeof node.value === "string" ? `"${node.value.replaceAll('"', '""')}"`
          : typeof node.value === "boolean" ? node.value ? "TRUE" : "FALSE" : String(node.value);
        case "error": return node.code;
        case "reference": return reference(node.reference).text;
        case "range": {
          const first = reference(node.first), last = reference(node.last, first.target);
          if (first.target.id !== last.target.id) throw new Error("複数シートをまたぐ範囲は未対応です");
          return `${first.text}:${last.text}`;
        }
        case "call": {
          if (calls >= 64 || node.args.length > 255) throw new Error("Excelの関数の入れ子または引数の上限を超えています");
          return `${node.name === "CONCAT" ? "_xlfn.CONCAT" : node.name}(${node.args.map(argument => emit(argument, false, calls + 1)).join(",")})`;
        }
        case "unary": return node.operator === "%" ? `(${emit(node.value, false, calls)})%` : `${node.operator}(${emit(node.value, false, calls)})`;
        case "binary": {
          const expression = `${emit(node.left, true, calls)}${node.operator}${emit(node.right, true, calls)}`;
          return nested ? `(${expression})` : expression;
        }
      }
    }
    return emit(parsed);
  } catch (cause) {
    throw new Error(`Excelに書き出せない数式です（${sheet.name}）: ${value.slice(0, 120)}`, { cause });
  }
}

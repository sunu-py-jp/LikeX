import { createImportFormatRanges } from "./format-ranges";
import { parseXmlStream } from "../ooxml";
import type { OfficePackageStreamingArchive } from "../ooxml";
import { SPREADSHEET_LIMITS, type SpreadsheetCellFormat } from "../model/types";
import { child, localName, type XmlNode } from "./xml";
import { readExcelCellAddress, excelCellAddress } from "./worksheet-address";
import { readWorksheetCellValue } from "./worksheet";
import { XLSX_IMPORT_LIMITS, type ImportContext, type SpreadsheetExcelImportOptions } from "./types";

const fail = (message: string): never => { throw new Error(`Excelのワークシートを読み込めません: ${message}`); };

/**
 * Validate every source cell while discarding optional blank formatting before a
 * worksheet tree is materialized. Remaining cell nodes still use readWorksheet,
 * including its shared-formula resolution and style/merge recovery.
 */
export async function readWorksheetXml(archive: OfficePackageStreamingArchive, path: string, name: string,
  shared: readonly string[], styles: readonly (SpreadsheetCellFormat | undefined)[], date1904: boolean,
  context: ImportContext, emptyCellFormatting: SpreadsheetExcelImportOptions["emptyCellFormatting"]) {
  // Source coordinates are bounded by Excel's grid even for cells we discard.
  const seenRows = new Uint8Array(1_048_576 / 8);
  let inferredRow = 0, rowNode: XmlNode | undefined;
  let currentRow = 0, inferredColumn = 0;
  const seenColumns = new Uint8Array(16_384 / 8);
  let outside = 0, omitted = 0, invalidStyles = 0;
  const limits = context.limits ?? XLSX_IMPORT_LIMITS;
  const formatRanges = createImportFormatRanges(context, name);
  const blankFormats = new Map<number, SpreadsheetCellFormat>();
  const columnStyleIds = new Map<number, number>();
  const emptyFormat: SpreadsheetCellFormat = { numberFormat: "general" };
  let currentRowStyle: number | undefined;
  const warn = (code: "omitted" | "adjusted", message: string, count = 1) => {
    if (count) context.warn({ code, message, sheetName: name, count });
  };
  const beginRow = (row: XmlNode) => {
    if (rowNode === row) return;
    rowNode = row;
    currentRow = row.attributes.r === undefined ? inferredRow : Number(row.attributes.r) - 1;
    if (!Number.isInteger(currentRow) || currentRow < 0 || currentRow >= 1_048_576) fail("行番号が不正です");
    const bit = 1 << (currentRow & 7), index = currentRow >>> 3;
    if (seenRows[index] & bit) fail("行が重複しています");
    seenRows[index] |= bit;
    inferredRow = currentRow + 1;
    inferredColumn = 0;
    seenColumns.fill(0);
    blankFormats.clear();
    currentRowStyle = row.attributes.s === undefined ? undefined : Number(row.attributes.s);
    if (currentRowStyle !== undefined && (!Number.isInteger(currentRowStyle) || currentRowStyle < 0 || currentRowStyle >= styles.length)) {
      invalidStyles++; currentRowStyle = undefined;
    }
    if (currentRowStyle !== undefined && currentRow < SPREADSHEET_LIMITS.rows) {
      if (emptyCellFormatting !== "omit") formatRanges.rowStyles.set(currentRow, styles[currentRowStyle] ?? emptyFormat);
      else warn("omitted", "空セルの書式を省略する設定により、行全体・列全体の書式を省略しました");
    }
    // Explicit coordinates preserve inference when earlier empty rows/cells disappear.
    row.attributes.r = String(currentRow + 1);
  };
  const root = await parseXmlStream(archive.stream(path), {
    signal: context.signal,
    limits: { xmlBytes: limits.worksheetXmlBytes, xmlDepth: limits.xmlDepth,
      xmlNodes: limits.worksheetXmlNodes, xmlText: limits.worksheetXmlText,
      retainedNodes: limits.xmlNodes },
    onElement(node, parent, ancestors) {
      const inSheetData = ancestors.length >= 2 && localName(ancestors[0].name) === "worksheet" && localName(ancestors[1].name) === "sheetData";
      if (ancestors.length === 2 && localName(ancestors[0].name) === "worksheet" && localName(parent!.name) === "cols" && localName(node.name) === "col") {
        const min = Number(node.attributes.min), max = Number(node.attributes.max), style = Number(node.attributes.style);
        if (node.attributes.style !== undefined && Number.isInteger(min) && min > 0 && Number.isInteger(max) && max >= min && max <= 16_384) {
          if (!Number.isInteger(style) || style < 0 || style >= styles.length) invalidStyles++;
          else {
            if (max > SPREADSHEET_LIMITS.columns) warn("omitted", "シート上限外の列の書式を省略しました（対応範囲内の書式は保持）");
            if (emptyCellFormatting === "omit") warn("omitted", "空セルの書式を省略する設定により、行全体・列全体の書式を省略しました");
            for (let column = min - 1; column < Math.min(max, SPREADSHEET_LIMITS.columns); column++) {
              columnStyleIds.set(column, style);
              if (emptyCellFormatting !== "omit") formatRanges.columnStyles.set(column, styles[style] ?? emptyFormat);
            }
          }
        }
      }
      if (!inSheetData) return;
      if (ancestors.length === 3 && localName(parent!.name) === "row" && localName(node.name) === "c") {
        beginRow(parent!);
        delete node.attributes.likexClearFormat;
        const position = node.attributes.r ? readExcelCellAddress(node.attributes.r) : { row: currentRow, column: inferredColumn };
        if (!position || position.row !== currentRow || position.column >= 16_384) return fail("セルの位置が不正です");
        inferredColumn = position.column + 1;
        const bit = 1 << (position.column & 7), index = position.column >>> 3;
        if (seenColumns[index] & bit) return fail("セルが重複しています");
        seenColumns[index] |= bit;
        const styleId = Number(node.attributes.s ?? currentRowStyle ?? columnStyleIds.get(position.column) ?? 0), validStyle = Number.isInteger(styleId) && styleId >= 0 && styleId < styles.length;
        // Reuse styles during inspection: never clone a style just to throw it away.
        const value = readWorksheetCellValue(node, shared, validStyle ? styles[styleId] : undefined, date1904, false);
        const formula = child(node, "f"), hasData = value.value !== "" || !!formula;
        if (position.row >= SPREADSHEET_LIMITS.rows || position.column >= SPREADSHEET_LIMITS.columns) {
          if (hasData) return fail(`シート「${name}」のセル ${excelCellAddress(position)} は値・数式を持ち、10,000行・1,000列の上限を超えています`);
          outside++;
          if (!validStyle) invalidStyles++;
          return false;
        }
        if (hasData) {
          // A formula without a cached value may recover to an empty cell when
          // unsupported. Count those after resolution, as the existing importer does.
          if (value.value !== "") {
            context.sourceDataCells = (context.sourceDataCells ?? 0) + 1;
            if (context.sourceDataCells > SPREADSHEET_LIMITS.cells)
              return fail("値・数式を持つセル数が100,000件を超えています");
          }
        } else {
          if (!validStyle) invalidStyles++;
          if (emptyCellFormatting === "omit") { if (value.format) omitted++; return false; }
          // A default-style cell is an explicit clearing exception to a row/column style.
          if (value.format || currentRowStyle !== undefined || columnStyleIds.has(position.column))
            blankFormats.set(position.column, value.format ?? emptyFormat);
          return false;
        }
        node.attributes.r = excelCellAddress(position);
        // Carry inherited row/column styles through the common converter. Explicit
        // default-style cells need an empty complete override when a range exists.
        node.attributes.s = String(styleId);
        if (!value.format && (currentRowStyle !== undefined || columnStyleIds.has(position.column))) node.attributes.likexClearFormat = "1";
      } else if (ancestors.length === 2 && localName(node.name) === "row") {
        beginRow(node);
        if (emptyCellFormatting !== "omit") formatRanges.addRow(currentRow, blankFormats);
        if (currentRow >= SPREADSHEET_LIMITS.rows) {
          if (["1", "true"].includes(node.attributes.hidden)) warn("adjusted", "非表示の行・列を表示状態で読み込みました");
          if (node.attributes.ht !== undefined) {
            const height = Number(node.attributes.ht) / 0.75;
            if (!Number.isFinite(height) || height < 0) warn("adjusted", "不正な行高を標準の高さへ変更しました");
            else warn("omitted", "シート上限外の空行・空列の表示設定を省略しました");
          }
          if (node.attributes.s !== undefined) warn("omitted", "行全体・列全体の書式設定を省略しました");
          return false;
        }
        if (!node.children.length && node.attributes.ht === undefined && node.attributes.s === undefined && node.attributes.hidden === undefined) return false;
      }
    },
  });
  warn("omitted", "シート上限外の値・数式を持たない空セルとその書式を省略しました", outside);
  warn("omitted", "空セルの書式を省略する設定により、値・数式を持たないセルの書式を省略しました", omitted);
  warn("adjusted", "参照先が不正なセル書式を標準書式へ変更しました（セルの値・数式は保持）", invalidStyles);
  return { root, formatRanges };
}

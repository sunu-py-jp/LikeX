import { ByteReader } from "../../core";
import type { SpreadsheetExcelImportSignal, SpreadsheetExcelImportWarning } from "../types";
import { BiffStream, ContinuedReader, RT, cellName, fail, readCharacters, readString, xmlAttribute, xmlText, type BiffRecord } from "./biff";
import type { XlsBook, XlsSheetEntry } from "./biff-book";
import { XLS_ERRORS, formulaText, numberText, sharedFormulaTarget, type FormulaContext } from "./biff-formula";
import { MAIN_NAMESPACE } from "./xls-styles";
import type { XlsSheetGrid, XlsSheetObject } from "./xls-drawing";
import { xlsxBaseColumnWidthToPixels, xlsxColumnWidthToPixels, xlsxDefaultColumnWidthToPixels } from "../../xlsx-column-width";

export type XlsConvertContext = {
  book: XlsBook; sheetNames: readonly string[]; signal?: SpreadsheetExcelImportSignal;
  /** Converted XML is budgeted like expanded ZIP content. */
  maxPartBytes: number;
  warn(warning: SpreadsheetExcelImportWarning): void;
};
export type XlsSheetConversion = {
  comments?: string;
  /** OfficeArt drawing data and the objects announced next to it, for the drawing converter. */
  drawing: Uint8Array[]; objects: XlsSheetObject[]; grid: XlsSheetGrid; hasFilter: boolean;
  /** Completes the worksheet part; tail is inserted before the closing tag once relationship ids are known. */
  finish(tail: string): Uint8Array;
};
type Row = { cells: [column: number, xml: string][]; attributes: string };
type SharedFormula = { kind: "shared" | "array" | "table"; tokens: Uint8Array; extra?: Uint8Array; range: string };
type PendingFormula = { row: number; column: number; format: number; tokens: Uint8Array; extra: Uint8Array; result: Uint8Array; text?: string };

const RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const VALIDATION_TYPES = [undefined, "whole", "decimal", "list", "date", "time", "textLength", "custom"];
const VALIDATION_OPERATORS = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
const ERROR_STYLES = ["stop", "warning", "information"];
const FILTER_OPERATORS: Readonly<Record<number, string>> = { 1: "lessThan", 2: "equal", 3: "lessThanOrEqual", 4: "greaterThan", 5: "notEqual", 6: "greaterThanOrEqual" };
const encoder = new TextEncoder();

const tooLarge = () => fail("変換後のデータのサイズが上限を超えています");
/** Accumulates XML as UTF-8 chunks so a large sheet never exists as one giant string. */
class XmlBuffer {
  readonly #limit: number;
  #pending: string[] = [];
  #pendingLength = 0;
  #chunks: Uint8Array[] = [];
  #bytes = 0;
  constructor(limit: number) { this.#limit = limit; }
  push(text: string): void {
    this.#pending.push(text);
    if ((this.#pendingLength += text.length) >= 1 << 20) this.#flush();
  }
  #flush(): void {
    if (!this.#pending.length) return;
    const chunk = encoder.encode(this.#pending.join(""));
    this.#pending = []; this.#pendingLength = 0;
    if ((this.#bytes += chunk.byteLength) > this.#limit) tooLarge();
    this.#chunks.push(chunk);
  }
  finish(): Uint8Array {
    this.#flush();
    const result = new Uint8Array(this.#bytes);
    let offset = 0;
    for (const chunk of this.#chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  }
}
const range = (firstRow: number, lastRow: number, firstColumn: number, lastColumn: number) => {
  const first = cellName(firstRow, firstColumn), last = cellName(lastRow, lastColumn);
  return first === last ? first : `${first}:${last}`;
};
/** RK numbers hold an integer or the upper 30 bits of a double, optionally divided by 100. */
function rkNumber(value: number): number {
  let result: number;
  if (value & 2) result = value >> 2;
  else { const view = new DataView(new ArrayBuffer(8)); view.setUint32(4, value & 0xfffffffc, true); result = view.getFloat64(0, true); }
  return value & 1 ? result / 100 : result;
}
const numberCell = (value: number): string => `<v>${numberText(value) ?? fail("数値セルが不正です")}</v>`;
/** Formula text is read verbatim, so only XML syntax is escaped and unrepresentable characters are dropped. */
const formulaXml = (text: string): string => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/[&<>]/g, character => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");

/**
 * Reads one worksheet substream and writes the equivalent SpreadsheetML part. Everything the
 * XLSX reader validates or recovers is passed through unchanged, so both formats share its rules.
 */
export async function convertXlsSheet(stream: Uint8Array, entry: XlsSheetEntry, filterRange: string | undefined, context: XlsConvertContext): Promise<XlsSheetConversion> {
  const { book } = context, records = new BiffStream(stream, entry.offset), first = records.next();
  if (!first || first.type !== RT.BOF || first.data.length < 4 || new ByteReader(first.data, 2).u16() !== 0x0010) return fail("ワークシートの構造が不正です");
  const warn = (code: SpreadsheetExcelImportWarning["code"], message: string) => context.warn({ code, message, sheetName: entry.name });
  const rows = new Map<number, Row>(), rowFor = (index: number) => { let row = rows.get(index); if (!row) rows.set(index, row = { cells: [], attributes: "" }); return row; };
  const columns: string[] = [], merges: string[] = [], validations: string[] = [], filterColumns: string[] = [];
  const shared = new Map<number, SharedFormula>(), objects: XlsSheetObject[] = [], drawing: Uint8Array[] = [], notes: { row: number; column: number; object: number; author: string }[] = [];
  const margins: Record<string, number> = {}, rowBreaks: string[] = [], columnBreaks: string[] = [];
  // Stored sizes by index, for placing drawings: character widths of columns and point heights of rows.
  const columnCharacters = new Map<number, number>(), rowPoints = new Map<number, number>();
  let defaultRowHeight: number | undefined, baseColumnWidth: number | undefined, standardWidth: number | undefined, pending: PendingFormula | undefined;
  let fitToPage = false, frozen = false, pane = "", protection = false, conditional = false, hyperlinks = false, headerFooter = false, pageSetup = "", hasFilter = false;
  const key = (row: number, column: number) => row * 256 + column;
  // Cells wait for their row to be complete, so they are budgeted when added, not when written out.
  let cellCharacters = 0;
  const addCell = (row: number, column: number, format: number, type: string, body: string) => {
    const cell = `<c r="${cellName(row, column)}" s="${format}"${type}${body ? `>${body}</c>` : "/>"}`;
    if ((cellCharacters += cell.length) > context.maxPartBytes) tooLarge();
    rowFor(row).cells.push([column, cell]);
  };
  const formulaContext = (row: number, column: number): FormulaContext => ({ book, sheetNames: context.sheetNames, row, column });

  function flushFormula(): void {
    if (!pending) return;
    const { row, column, format, tokens, extra, result } = pending, target = sharedFormulaTarget(tokens);
    let formula: string;
    if (target) {
      const definition = shared.get(key(target.row, target.column)), base = target.row === row && target.column === column;
      if (!definition) formula = `<f t="dataTable"/>`;
      else if (definition.kind === "shared") {
        const text = formulaText(definition.tokens, definition.extra, formulaContext(row, column));
        formula = text === undefined ? `<f t="dataTable"/>` : `<f>${formulaXml(text)}</f>`;
      } else if (!base) formula = "";
      else if (definition.kind === "table") formula = `<f t="dataTable" ref="${definition.range}"/>`;
      else formula = `<f t="array" ref="${definition.range}">${formulaXml(formulaText(definition.tokens, definition.extra, formulaContext(row, column)) ?? "")}</f>`;
    } else {
      const text = formulaText(tokens, extra, formulaContext(row, column));
      // A marker type keeps the cached result and reports the formula through the reader's own warning.
      formula = text === undefined ? `<f t="dataTable"/>` : `<f>${formulaXml(text)}</f>`;
    }
    const view = new DataView(result.buffer, result.byteOffset, 8);
    if (view.getUint16(6, true) !== 0xffff) addCell(row, column, format, "", formula + numberCell(view.getFloat64(0, true)));
    else if (result[0] === 0) addCell(row, column, format, ' t="str"', `${formula}<v>${xmlText(pending.text ?? "")}</v>`);
    else if (result[0] === 1) addCell(row, column, format, ' t="b"', `${formula}<v>${result[2] ? 1 : 0}</v>`);
    else if (result[0] === 2) addCell(row, column, format, ' t="e"', `${formula}<v>${XLS_ERRORS[result[2]] ?? fail("エラーセルの値が不正です")}</v>`);
    else addCell(row, column, format, ' t="str"', `${formula}<v></v>`);
    pending = undefined;
  }
  function readValidation(data: Uint8Array): void {
    const reader = new ByteReader(data), flags = reader.u32();
    const text = () => { const value = readString(reader); return value === "\u0000" ? "" : value; };
    const promptTitle = text(), errorTitle = text(), prompt = text(), error = text();
    const expression = () => { const length = reader.u16(); reader.skip(2); return reader.take(length); };
    const first = expression(), second = expression(), count = reader.u16(), references: string[] = [];
    let top = 0, left = 0;
    for (let index = 0; index < count; index++) {
      const firstRow = reader.u16(), lastRow = reader.u16(), firstColumn = reader.u16(), lastColumn = reader.u16();
      if (!index) { top = firstRow; left = firstColumn; }
      references.push(range(firstRow, lastRow, firstColumn, lastColumn));
    }
    const type = VALIDATION_TYPES[flags & 15], formula = (tokens: Uint8Array) => tokens.length ? formulaText(tokens, undefined, formulaContext(top, left)) : undefined;
    let formula1 = formula(first);
    // A literal list is stored as one string whose items are separated by NUL.
    if (type === "list" && flags & 0x80 && formula1) formula1 = formula1.replaceAll("\u0000", ",");
    const formula2 = formula(second), attributes = [type && `type="${type}"`, `errorStyle="${ERROR_STYLES[flags >>> 4 & 7] ?? "stop"}"`,
      `operator="${VALIDATION_OPERATORS[flags >>> 20 & 15] ?? "between"}"`, flags & 0x100 && `allowBlank="1"`, flags & 0x200 && `showDropDown="1"`,
      flags & 0x40000 && `showInputMessage="1"`, `showErrorMessage="${flags & 0x80000 ? 1 : 0}"`, errorTitle && `errorTitle="${xmlAttribute(errorTitle)}"`,
      error && `error="${xmlAttribute(error)}"`, promptTitle && `promptTitle="${xmlAttribute(promptTitle)}"`, prompt && `prompt="${xmlAttribute(prompt)}"`,
      `sqref="${references.join(" ")}"`].filter(Boolean);
    validations.push(`<dataValidation ${attributes.join(" ")}>${formula1 === undefined ? "" : `<formula1>${formulaXml(formula1)}</formula1>`}${formula2 === undefined ? "" : `<formula2>${formulaXml(formula2)}</formula2>`}</dataValidation>`);
  }
  function readFilterColumn(data: Uint8Array): void {
    const reader = new ByteReader(data), column = reader.u16(), flags = reader.u16();
    const operands = [0, 1].map(() => { const type = reader.u8(), sign = reader.u8(), value = reader.take(8); return { type, sign, value }; });
    const values = operands.map(({ type, value }) => {
      if (type === 6) return readCharacters(reader, value[4]);
      if (type === 4) return numberText(new DataView(value.buffer, value.byteOffset, 8).getFloat64(0, true)) ?? "";
      if (type === 2) return String(rkNumber(new DataView(value.buffer, value.byteOffset, 8).getUint32(0, true)));
      return "";
    });
    const [one, two] = operands;
    let body: string;
    if (flags & 0x10) body = `<top10 val="${flags >>> 7}"/>`;
    else if (!two.type && one.type === 0x0c) body = `<filters blank="1"/>`;
    // A single value chosen from the list is stored as one simple "equals" criterion.
    else if (!two.type && one.type === 6 && one.sign === 2 && flags & 0x04) body = `<filters><filter val="${xmlAttribute(values[0])}"/></filters>`;
    else body = `<customFilters${(flags & 3) === 0 && two.type ? ' and="1"' : ""}>${operands.map(({ type, sign }, index) => !type ? "" :
      `<customFilter operator="${type === 0x0e ? "notEqual" : FILTER_OPERATORS[sign] ?? "equal"}" val="${type === 0x0c || type === 0x0e ? " " : xmlAttribute(values[index])}"/>`).join("")}</customFilters>`;
    filterColumns.push(`<filterColumn colId="${column}">${body}</filterColumn>`);
  }
  function readObject(record: BiffRecord): void {
    const reader = new ByteReader(record.data);
    if (reader.remaining < 8 || reader.u16() !== 0x15) return;
    reader.skip(2);
    const type = reader.u16();
    objects.push({ id: reader.u16(), type });
  }
  function readObjectText(record: BiffRecord): void {
    const reader = new ByteReader(record.data);
    const alignment = reader.u16();
    reader.skip(8);
    const length = reader.u16(), target = objects.at(-1);
    if (!target) return;
    target.alignment = alignment;
    if (!length || !record.continues.length) return;
    // The text follows in CONTINUE records, each restating its character width; formatting runs come last.
    target.text = new ContinuedReader({ type: record.type, data: new Uint8Array(), continues: record.continues }).characters(length, false);
  }

  let depth = 1, visited = 0;
  for (let record = records.next(); record; record = records.next()) {
    if (++visited % 8192 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
    const { type, data } = record;
    // Embedded charts are nested substreams whose records must not be read as sheet content.
    if (type === RT.BOF) { depth++; continue; }
    if (type === RT.EOF) { if (--depth === 0) break; continue; }
    if (depth > 1) continue;
    if (type === RT.STRING) { if (pending) pending.text = readString(new ByteReader(data)); continue; }
    if (type === RT.SHRFMLA || type === RT.ARRAY || type === RT.TABLE) {
      const target = pending && sharedFormulaTarget(pending.tokens), reader = new ByteReader(data);
      const firstRow = reader.u16(), lastRow = reader.u16(), firstColumn = reader.u8(), lastColumn = reader.u8();
      if (!target) continue;
      const definition: SharedFormula = { kind: type === RT.SHRFMLA ? "shared" : type === RT.ARRAY ? "array" : "table", tokens: new Uint8Array(), range: range(firstRow, lastRow, firstColumn, lastColumn) };
      if (type !== RT.TABLE) {
        reader.skip(type === RT.SHRFMLA ? 2 : 6);
        definition.tokens = reader.take(reader.u16()); definition.extra = reader.take(reader.remaining);
      }
      shared.set(key(target.row, target.column), definition);
      continue;
    }
    flushFormula();
    if (type === RT.NUMBER || type === RT.RK || type === RT.LABELSST || type === RT.LABEL || type === RT.BLANK || type === RT.BOOLERR || type === RT.FORMULA) {
      const reader = new ByteReader(data), row = reader.u16(), column = reader.u16(), format = reader.u16();
      if (type === RT.NUMBER) addCell(row, column, format, "", numberCell(reader.f64()));
      else if (type === RT.RK) addCell(row, column, format, "", numberCell(rkNumber(reader.u32())));
      else if (type === RT.BLANK) addCell(row, column, format, "", "");
      else if (type === RT.LABELSST) {
        const index = reader.u32();
        if (index >= book.strings.length) return fail("共有文字列の参照が不正です");
        addCell(row, column, format, ' t="s"', `<v>${index}</v>`);
      } else if (type === RT.LABEL) addCell(row, column, format, ' t="inlineStr"', `<is><t xml:space="preserve">${xmlText(readString(reader))}</t></is>`);
      else if (type === RT.BOOLERR) {
        const value = reader.u8();
        if (reader.u8()) addCell(row, column, format, ' t="e"', `<v>${XLS_ERRORS[value] ?? fail("エラーセルの値が不正です")}</v>`);
        else addCell(row, column, format, ' t="b"', `<v>${value ? 1 : 0}</v>`);
      } else {
        const result = reader.take(8);
        reader.skip(6);
        pending = { row, column, format, result, tokens: reader.take(reader.u16()), extra: reader.take(reader.remaining) };
      }
    } else if (type === RT.MULRK || type === RT.MULBLANK) {
      const reader = new ByteReader(data), row = reader.u16(), firstColumn = reader.u16(), size = type === RT.MULRK ? 6 : 2, count = (data.length - 6) / size;
      if (!Number.isInteger(count) || count < 1) return fail("セルの範囲が不正です");
      const items = Array.from({ length: count }, () => ({ format: reader.u16(), value: type === RT.MULRK ? reader.u32() : 0 }));
      if (reader.u16() !== firstColumn + count - 1) return fail("セルの範囲が不正です");
      items.forEach(({ format, value }, index) => addCell(row, firstColumn + index, format, "", type === RT.MULRK ? numberCell(rkNumber(value)) : ""));
    } else if (type === RT.ROW) {
      const reader = new ByteReader(data), index = reader.u16();
      reader.skip(4);
      const height = reader.u16();
      reader.skip(4);
      const flags = reader.u16(), format = reader.u16() & 0xfff;
      if (!(height & 0x8000)) rowPoints.set(index, (height & 0x7fff) / 20);
      rowFor(index).attributes = `${height & 0x8000 ? "" : ` ht="${(height & 0x7fff) / 20}"${flags & 0x40 ? ' customHeight="1"' : ""}`}${flags & 0x20 ? ' hidden="1"' : ""}${flags & 0x80 ? ` s="${format}" customFormat="1"` : ""}`;
    } else if (type === RT.COLINFO) {
      const reader = new ByteReader(data), firstColumn = reader.u16(), lastColumn = Math.min(reader.u16(), 255), width = reader.u16(), format = reader.u16(), flags = reader.u16();
      for (let column = firstColumn; column <= lastColumn; column++) if (!columnCharacters.has(column)) columnCharacters.set(column, width / 256);
      if (firstColumn <= lastColumn) columns.push(`<col min="${firstColumn + 1}" max="${lastColumn + 1}" width="${width / 256}" customWidth="1"${format !== 15 ? ` style="${format}"` : ""}${flags & 1 ? ' hidden="1"' : ""}/>`);
    } else if (type === RT.DEFAULTROWHEIGHT) defaultRowHeight = new ByteReader(data, 2).u16() / 20;
    else if (type === RT.DEFCOLWIDTH) baseColumnWidth = new ByteReader(data).u16();
    else if (type === RT.STANDARDWIDTH) standardWidth = new ByteReader(data).u16() / 256;
    else if (type === RT.MERGEDCELLS) {
      const reader = new ByteReader(data), count = reader.u16();
      for (let index = 0; index < count; index++) { const firstRow = reader.u16(), lastRow = reader.u16(), firstColumn = reader.u16(); merges.push(`<mergeCell ref="${range(firstRow, lastRow, firstColumn, reader.u16())}"/>`); }
    } else if (type === RT.DV) readValidation(data);
    else if (type === RT.AUTOFILTERINFO) hasFilter = true;
    else if (type === RT.AUTOFILTER) readFilterColumn(data);
    else if (type === RT.WSBOOL) fitToPage = !!(new ByteReader(data).u16() & 0x0100);
    else if (type === RT.LEFTMARGIN || type === RT.RIGHTMARGIN || type === RT.TOPMARGIN || type === RT.BOTTOMMARGIN)
      margins[type === RT.LEFTMARGIN ? "left" : type === RT.RIGHTMARGIN ? "right" : type === RT.TOPMARGIN ? "top" : "bottom"] = new ByteReader(data).f64();
    else if (type === RT.SETUP) {
      const reader = new ByteReader(data), paper = reader.u16(), scale = reader.u16();
      reader.skip(6);
      const flags = reader.u16();
      reader.skip(4);
      margins.header = reader.f64(); margins.footer = reader.f64();
      // Without printer data the paper, scale and orientation fields are undefined.
      pageSetup = flags & 0x04 ? "<pageSetup/>" : `<pageSetup paperSize="${paper}"${scale !== 100 && scale >= 10 && scale <= 400 ? ` scale="${scale}"` : ""}${flags & 0x40 ? "" : ` orientation="${flags & 0x02 ? "portrait" : "landscape"}"`}/>`;
    } else if (type === RT.HORIZONTALPAGEBREAKS || type === RT.VERTICALPAGEBREAKS) {
      const reader = new ByteReader(data), count = reader.u16(), horizontal = type === RT.HORIZONTALPAGEBREAKS;
      for (let index = 0; index < count; index++) {
        const position = reader.u16(), start = reader.u16(), end = reader.u16(), full = horizontal ? end >= 255 : end >= 65_535;
        (horizontal ? rowBreaks : columnBreaks).push(`<brk id="${position}"${start ? ` min="${start}"` : ""} max="${full ? horizontal ? 16_383 : 1_048_575 : end}" man="1"/>`);
      }
    } else if (type === RT.WINDOW2) frozen = !!(new ByteReader(data).u16() & 0x08);
    else if (type === RT.PANE) {
      const reader = new ByteReader(data), x = reader.u16(), y = reader.u16(), top = reader.u16(), left = reader.u16();
      pane = `<pane${x ? ` xSplit="${x}"` : ""}${y ? ` ySplit="${y}"` : ""} topLeftCell="${cellName(top, left)}" state="frozen"/>`;
    } else if (type === RT.PROTECT) protection ||= new ByteReader(data).u16() !== 0;
    else if (type === RT.CONDFMT) conditional = true;
    else if (type === RT.HLINK) hyperlinks = true;
    else if (type === 0x0014 || type === 0x0015) headerFooter ||= data.length > 0 && readString(new ByteReader(data)) !== "";
    else if (type === RT.MSODRAWING) drawing.push(data, ...record.continues);
    else if (type === RT.OBJ) readObject(record);
    else if (type === RT.TXO) readObjectText(record);
    else if (type === RT.NOTE) {
      const reader = new ByteReader(data), row = reader.u16(), column = reader.u16();
      reader.skip(2);
      notes.push({ row, column, object: reader.u16(), author: reader.remaining >= 3 ? readString(reader) : "" });
    }
  }
  flushFormula();
  context.signal?.throwIfAborted();

  const xml = new XmlBuffer(context.maxPartBytes);
  xml.push(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${MAIN_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}">`);
  if (fitToPage) xml.push(`<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
  if (frozen && pane) xml.push(`<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`);
  xml.push(`<sheetFormatPr${baseColumnWidth === undefined ? "" : ` baseColWidth="${baseColumnWidth}"`}${standardWidth === undefined ? "" : ` defaultColWidth="${standardWidth}"`} defaultRowHeight="${defaultRowHeight ?? 12.75}"/>`);
  if (columns.length) xml.push(`<cols>${columns.join("")}</cols>`);
  xml.push("<sheetData>");
  for (const index of [...rows.keys()].sort((a, b) => a - b)) {
    const row = rows.get(index)!;
    row.cells.sort((a, b) => a[0] - b[0]);
    xml.push(`<row r="${index + 1}"${row.attributes}>`);
    for (const [, cell] of row.cells) xml.push(cell);
    xml.push("</row>");
  }
  xml.push("</sheetData>");
  rows.clear();
  if (protection) xml.push(`<sheetProtection sheet="1"/>`);
  if (hasFilter && filterRange) xml.push(`<autoFilter ref="${filterRange}">${filterColumns.join("")}</autoFilter>`);
  else if (hasFilter) warn("omitted", "範囲を特定できないフィルターを省略しました");
  if (merges.length) xml.push(`<mergeCells count="${merges.length}">${merges.join("")}</mergeCells>`);
  if (conditional) xml.push(`<conditionalFormatting sqref="A1"><cfRule type="expression" priority="1"/></conditionalFormatting>`);
  if (validations.length) xml.push(`<dataValidations count="${validations.length}">${validations.join("")}</dataValidations>`);
  if (hyperlinks) xml.push(`<hyperlinks><hyperlink ref="A1"/></hyperlinks>`);
  if (["left", "right", "top", "bottom"].every(edge => margins[edge] !== undefined))
    xml.push(`<pageMargins left="${margins.left}" right="${margins.right}" top="${margins.top}" bottom="${margins.bottom}" header="${margins.header ?? 0.5}" footer="${margins.footer ?? 0.5}"/>`);
  if (pageSetup) xml.push(pageSetup);
  if (headerFooter) xml.push("<headerFooter/>");
  if (rowBreaks.length) xml.push(`<rowBreaks count="${rowBreaks.length}" manualBreakCount="${rowBreaks.length}">${rowBreaks.join("")}</rowBreaks>`);
  if (columnBreaks.length) xml.push(`<colBreaks count="${columnBreaks.length}" manualBreakCount="${columnBreaks.length}">${columnBreaks.join("")}</colBreaks>`);

  let comments: string | undefined;
  if (notes.length) {
    const texts = new Map(objects.map(object => [object.id, object.text ?? ""])), authors: string[] = [];
    const items = notes.map(note => {
      let author = authors.indexOf(note.author);
      if (author < 0) author = authors.push(note.author) - 1;
      return `<comment ref="${cellName(note.row, note.column)}" authorId="${author}"><text><r><t xml:space="preserve">${xmlText(texts.get(note.object) ?? "")}</t></r></text></comment>`;
    });
    comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><comments xmlns="${MAIN_NAMESPACE}"><authors>${authors.map(author => `<author>${xmlText(author)}</author>`).join("")}</authors><commentList>${items.join("")}</commentList></comments>`;
  }
  // The same conversions as the XLSX reader, so fractional cell offsets land where it expects them.
  const defaultColumn = standardWidth !== undefined ? xlsxColumnWidthToPixels(standardWidth) : baseColumnWidth !== undefined ? xlsxBaseColumnWidthToPixels(baseColumnWidth) : xlsxDefaultColumnWidthToPixels();
  const defaultRow = (defaultRowHeight ?? 12.75) / 0.75;
  const columnPixels = (column: number) => { const characters = columnCharacters.get(column); return characters === undefined ? defaultColumn : Math.max(1, xlsxColumnWidthToPixels(characters)); };
  const rowPixels = (row: number) => { const points = rowPoints.get(row); return points === undefined ? defaultRow : points > 0 ? points / 0.75 : 1; };
  const starts = (sizes: ReadonlyMap<number, number>, pixels: (index: number) => number, fallback: number) => {
    // Position of an index: the default size for every earlier index, corrected by the explicit sizes among them.
    const explicit = [...sizes.keys()].sort((a, b) => a - b), corrections = [0];
    for (const index of explicit) corrections.push(corrections.at(-1)! + pixels(index) - fallback);
    return (index: number) => {
      let low = 0, high = explicit.length;
      while (low < high) { const middle = (low + high) >>> 1; if (explicit[middle] < index) low = middle + 1; else high = middle; }
      return index * fallback + corrections[low];
    };
  };
  const grid: XlsSheetGrid = { columnPixels, rowPixels, columnStart: starts(columnCharacters, columnPixels, defaultColumn), rowStart: starts(rowPoints, rowPixels, defaultRow) };
  return { comments, drawing, objects, grid, hasFilter, finish: tail => { xml.push(`${tail}</worksheet>`); return xml.finish(); } };
}

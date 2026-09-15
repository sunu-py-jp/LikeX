import { normalizeWorkbook } from "../model/workbook/normalize";
import { normalizeRangeName } from "../model/named-ranges";
import { cellAddress } from "../model/address";
import { cellTextValue, isFormulaCell } from "../model/cell-value";
import { calculateWorkbook } from "../model/formula";
import { dataValidationError } from "../model/data-validation";
import { SPREADSHEET_LIMITS, type SpreadsheetCell, type SpreadsheetNamedRange, type SpreadsheetSheet } from "../model/types";
import { openXlsxArchive } from "./zip";
import { attribute, child, children, localName, parseXml, spreadsheetText, textContent, type XmlNode } from "./xml";
import { readRelationships, resolvePart, type XlsxRelationship } from "./relationships";
import { readXlsxStyles } from "./styles";
import { importRange, readWorksheet, richText } from "./worksheet";
import { readWorksheetExtras } from "./sheet-extras";
import { worksheetDefaultSizes } from "./worksheet-shared";
import { XLSX_IMPORT_LIMITS, type ImportContext, type SpreadsheetExcelImportInput, type SpreadsheetExcelImportOptions, type SpreadsheetExcelImportResult, type SpreadsheetExcelImportWarning } from "./types";

const workbookType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const fail = (message: string): never => { throw new Error(`Excelファイルを読み込めません: ${message}`); };
const relationFor = (relations: ReadonlyMap<string, XlsxRelationship>, kind: string) => [...relations.values()].find(item => item.type.endsWith(`/${kind}`) && !item.external);
/** Import an isolated XLSX snapshot. No persistence, remote requests, DOM, or script execution. */
export async function importSpreadsheetXlsx(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}): Promise<SpreadsheetExcelImportResult> {
  const { signal } = options;
  signal?.throwIfAborted();
  const archive = await openXlsxArchive(input, signal);
  const warnings: SpreadsheetExcelImportWarning[] = [], warningsByKey = new Map<string, number>();
  const context: ImportContext = { archive, warnings, signal, resources: Object.create(null), warn(warning) {
    const key = `${warning.code}\0${warning.sheetName ?? ""}\0${warning.message}`, index = warningsByKey.get(key);
    if (index === undefined) { warningsByKey.set(key, warnings.length); warnings.push({ ...warning, count: warning.count ?? 1 }); }
    else warnings[index] = { ...warnings[index], count: (warnings[index].count ?? 1) + (warning.count ?? 1) };
  } };
  const contentRoot = parseXml(await archive.read("[Content_Types].xml"));
  if (localName(contentRoot.name) !== "Types") return fail("OOXMLパッケージではありません");
  const contentTypes = new Map<string, string>();
  for (const item of contentRoot.children) {
    const type = item.attributes.ContentType;
    if (!type || /macroEnabled|vbaProject|ms-excel\.sheet\.binary|encrypted/i.test(type)) return fail("マクロ・暗号化・バイナリ形式には対応していません");
    if (localName(item.name) === "Override") {
      const part = resolvePart("", item.attributes.PartName ?? "");
      if (contentTypes.has(part)) return fail("コンテンツ形式が重複しています");
      contentTypes.set(part, type);
    }
  }
  if (archive.paths.some(path => /(?:^|\/)(?:vbaProject\.bin|EncryptedPackage|EncryptionInfo)$|\.xls[mb]$/i.test(path))) return fail("マクロ・暗号化・バイナリ形式には対応していません");
  const relationships = new Map<string, ReadonlyMap<string, XlsxRelationship>>();
  for (const path of archive.paths.filter(path => path.endsWith(".rels"))) {
    const match = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(path);
    if (!match) return fail("参照情報の場所が不正です");
    const part = `${match[1] ? `${match[1]}/` : ""}${match[2]}`;
    const relations = await readRelationships(archive, part); relationships.set(part, relations);
    for (const relation of relations.values()) {
      if (/vbaProject|attachedTemplate/i.test(relation.type)) return fail("マクロを含むファイルには対応していません");
      if (relation.external) context.warn({ code: "omitted", message: "外部参照を読み込まずに省略しました" });
    }
  }
  const rootRelations = relationships.get("") ?? new Map<string, XlsxRelationship>();
  const workbookRelation = relationFor(rootRelations, "officeDocument");
  if (!workbookRelation || contentTypes.get(workbookRelation.target) !== workbookType) return fail(".xlsx形式のブックを指定してください");
  const workbookPath = workbookRelation.target, workbook = parseXml(await archive.read(workbookPath));
  if (localName(workbook.name) !== "workbook") return fail("ブックの構造が不正です");
  const workbookRelations = relationships.get(workbookPath) ?? new Map<string, XlsxRelationship>();
  const styles = await readXlsxStyles(workbookRelations, context), shared: string[] = [];
  const stringsRelation = relationFor(workbookRelations, "sharedStrings");
  if (stringsRelation) {
    const strings = parseXml(await archive.read(stringsRelation.target));
    if (localName(strings.name) !== "sst") return fail("共有文字列の構造が不正です");
    for (const item of children(strings, "si")) {
      if (shared.length >= XLSX_IMPORT_LIMITS.sharedStrings) return fail("共有文字列数が100,000件を超えています");
      const text = richText(item); if (text.length > SPREADSHEET_LIMITS.cellLength) return fail("共有文字列が100,000文字を超えています");
      shared.push(text);
      if (child(item, "r")) context.warn({ code: "adjusted", message: "セル内の文字ごとの書式を単一の書式へ変更しました" });
    }
  }
  const date1904 = ["1", "true"].includes(child(workbook, "workbookPr")?.attributes.date1904 ?? "");
  context.date1904 = date1904;
  if (date1904) context.warn({ code: "adjusted", message: "1904年基準の日付を1900年基準へ変換し、数式を保存済みの計算結果へ置き換えました" });
  const sheetNodes = children(child(workbook, "sheets"), "sheet");
  if (!sheetNodes.length || sheetNodes.length > SPREADSHEET_LIMITS.sheets) return fail("シート数は1〜100枚にしてください");
  context.sheetNames = new Map(sheetNodes.map(node => { const name = spreadsheetText(node.attributes.name ?? ""); return [name.toLocaleLowerCase("en-US"), name.trim()]; }));
  const sheets: SpreadsheetSheet[] = [], sheetIds = new Set<string>(), paths = new Set<string>();
  const worksheetParts: { root: XmlNode; path: string }[] = [];
  let cells = 0;
  for (const [index, sheetNode] of sheetNodes.entries()) {
    signal?.throwIfAborted();
    const id = attribute(sheetNode, "id"), relation = id ? workbookRelations.get(id) : undefined;
    if (!relation || relation.external || !relation.type.endsWith("/worksheet") || paths.has(relation.target)) return fail("ワークシートの参照が不正または未対応です");
    paths.add(relation.target);
    const originalName = spreadsheetText(sheetNode.attributes.name ?? ""), name = originalName.trim(), sheetId = sheetNode.attributes.sheetId;
    if (name !== originalName) context.warn({ code: "adjusted", message: "シート名の前後の空白を除き、数式の参照先を更新しました", sheetName: name });
    if (!sheetId || sheetIds.has(sheetId)) return fail("シートIDが重複または不正です");
    sheetIds.add(sheetId);
    if (sheetNode.attributes.state && sheetNode.attributes.state !== "visible") context.warn({ code: "adjusted", message: "非表示のシートを表示状態で読み込みました", sheetName: name });
    const root = parseXml(await archive.read(relation.target));
    const sheet = await readWorksheet(root, `xlsx-sheet-${index + 1}`, name, shared, styles, date1904, context);
    worksheetParts.push({ root, path: relation.target });
    cells += Object.keys(sheet.cells).length;
    if (cells > SPREADSHEET_LIMITS.cells) return fail("ブック全体のセル数が100,000件を超えています");
    sheets.push(sheet);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  const definitions = children(child(workbook, "definedNames"), "definedName");
  context.resolveListValues = (reference, sheetName) => {
    let value = reference.replace(/^=/, "");
    const definition = definitions.find(item => item.attributes.name?.toLocaleLowerCase("en-US") === value.toLocaleLowerCase("en-US") && item.attributes.localSheetId === undefined);
    if (definition) value = textContent(definition);
    const match = /^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?)$/i.exec(value);
    if (!match) return;
    const originalTarget = match[1]?.replaceAll("''", "'") ?? match[2] ?? sheetName;
    const targetName = context.sheetNames?.get(originalTarget.toLocaleLowerCase("en-US")) ?? originalTarget;
    const sheet = sheets.find(item => item.name.toLocaleLowerCase("en-US") === targetName.toLocaleLowerCase("en-US"));
    if (!sheet) return;
    let range;
    try { range = importRange(match[3]); } catch { return; }
    if ((range.bottom - range.top + 1) * (range.right - range.left + 1) > 1000) return;
    const values: string[] = [];
    for (let row = range.top; row <= range.bottom; row++) for (let column = range.left; column <= range.right; column++) {
      const cell = sheet.cells[cellAddress(row, column)]; if (isFormulaCell(cell)) return;
      values.push(cellTextValue(cell?.value ?? ""));
    }
    return values;
  };
  cells = 0;
  for (const [index, part] of worksheetParts.entries()) {
    signal?.throwIfAborted();
    sheets[index] = await readWorksheetExtras(part.root, sheets[index], part.path, relationships.get(part.path) ?? new Map(), context);
    cells += Object.keys(sheets[index].cells).length;
    if (cells > SPREADSHEET_LIMITS.cells) return fail("ブック全体のセル数が100,000件を超えています");
  }
  const namedRanges: SpreadsheetNamedRange[] = [], names = new Set<string>();
  for (const node of definitions) {
    const name = spreadsheetText(node.attributes.name ?? ""), value = textContent(node);
    const match = /^(?:'((?:[^']|'')+)'|([^'!]+))!(\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?)$/i.exec(value);
    let valid = node.attributes.localSheetId === undefined && !!match;
    try { normalizeRangeName(name); } catch { valid = false; }
    const originalTarget = match?.[1]?.replaceAll("''", "'") ?? match?.[2];
    const sheetName = originalTarget && (context.sheetNames?.get(originalTarget.toLocaleLowerCase("en-US")) ?? originalTarget);
    const sheetIndex = sheets.findIndex(sheet => sheet.name.toLocaleLowerCase("en-US") === sheetName?.toLocaleLowerCase("en-US"));
    const key = name.toLocaleLowerCase("en-US");
    if (!valid || sheetIndex < 0 || names.has(key)) { context.warn({ code: "omitted", message: "シート固有・計算式・予約名など未対応の名前定義を省略しました" }); continue; }
    const range = importRange(match![3]);
    if (namedRanges.length >= SPREADSHEET_LIMITS.namedRanges) return fail("名前付き範囲の件数が上限を超えています");
    names.add(key);
    const previous = sheets[sheetIndex], rowCount = Math.max(previous.rowCount, range.bottom + 1), columnCount = Math.max(previous.columnCount, range.right + 1);
    const rowHeights = { ...previous.rowHeights }, columnWidths = { ...previous.columnWidths }, defaults = worksheetDefaultSizes(worksheetParts[sheetIndex].root);
    for (let row = previous.rowCount; row < rowCount; row++) rowHeights[row] = defaults.row;
    for (let column = previous.columnCount; column < columnCount; column++) columnWidths[column] = defaults.column;
    sheets[sheetIndex] = { ...previous, rowCount, columnCount, rowHeights, columnWidths };
    namedRanges.push({ id: `xlsx-name-${namedRanges.length + 1}`, name, sheetId: sheets[sheetIndex].id, range });
  }
  if (child(workbook, "externalReferences")) context.warn({ code: "omitted", message: "外部ブックへの参照を省略しました" });
  if (child(workbook, "workbookProtection")) context.warn({ code: "omitted", message: "ブック保護を省略しました" });
  const unsupported = archive.paths.filter(path => /(?:^|\/)(?:pivotTables|pivotCache|slicerCaches|slicers|activeX|embeddings|connections)(?:\/|\.)/i.test(path));
  if (unsupported.length) context.warn({ code: "omitted", message: "ピボット・外部接続など未対応のオブジェクトを省略しました", count: unsupported.length });
  // Excel allows adding rules over existing invalid values; the model requires every value to satisfy its rule.
  // Keep those original values and omit only incompatible rules before the final invariant check.
  const validationCells = sheets.flatMap(sheet => Object.entries(sheet.cells).filter(([, cell]) => cell.validation).map(([address, cell]) => ({ sheet, address, cell })));
  const calculated = validationCells.some(({ cell }) => isFormulaCell(cell)) ? calculateWorkbook({ sheets, namedRanges }) : undefined;
  for (const [index, sheet] of sheets.entries()) {
    let updated: Record<string, SpreadsheetCell> | undefined;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      if (!cell.validation) continue;
      const computed = calculated?.[sheet.id]?.[address];
      const invalidFormula = isFormulaCell(cell) && (computed === undefined || typeof computed === "string" && /^#(?:LIMIT|CYCLE|ERROR|REF|VALUE|DIV\/0|NAME|N\/A|NUM|NULL)/.test(computed));
      if (!invalidFormula && !dataValidationError(cell.validation, cell.value, computed, cell.format)) continue;
      updated ??= { ...sheet.cells };
      updated[address] = { value: cell.value, ...(cell.format ? { format: cell.format } : {}) };
      context.warn({ code: "omitted", sheetName: sheet.name, message: "既存のセル値に適合しない入力規則を省略しました" });
    }
    if (updated) sheets[index] = { ...sheet, cells: updated };
  }
  signal?.throwIfAborted();
  const normalized = normalizeWorkbook({ schemaVersion: 1, sheets, ...(Object.keys(context.resources).length ? { resources: { images: context.resources } } : {}), ...(namedRanges.length ? { namedRanges } : {}) });
  return Object.freeze({ workbook: normalized, warnings: Object.freeze(warnings.map(item => Object.freeze(item))) });
}

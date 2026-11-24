import { OFFICE_ART, createOfficePackageFromParts, officeArtRecords, openCompoundFile, readOfficeArtImages, type OfficeArtImage } from "../../core";
import { importSpreadsheetXlsxPackage } from "../import-xlsx";
import { resolveXlsxImportLimits, type SpreadsheetExcelImportInput, type SpreadsheetExcelImportOptions, type SpreadsheetExcelImportResult, type SpreadsheetExcelImportWarning } from "../types";
import { fail, xmlAttribute, xmlText } from "./biff";
import { readXlsBook, type XlsBook } from "./biff-book";
import { formulaText } from "./biff-formula";
import { convertXlsSheet } from "./xls-sheet";
import { convertXlsDrawing } from "./xls-drawing";
import { MAIN_NAMESPACE, xlsStylesXml } from "./xls-styles";

const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const DOCUMENT_RELATIONSHIPS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const SHEET_TYPES = "application/vnd.openxmlformats-officedocument.spreadsheetml";
const BUILT_IN_NAMES = ["Consolidate_Area", "Auto_Open", "Auto_Close", "Extract", "Database", "Criteria", "Print_Area", "Print_Titles", "Recorder", "Data_Form",
  "Auto_Activate", "Auto_Deactivate", "Sheet_Title", "_FilterDatabase"];
const XML_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const IMAGE_TYPES: Readonly<Record<string, [type: string, extension: string]>> = { png: ["image/png", "png"], jpeg: ["image/jpeg", "jpeg"], dib: ["image/bmp", "bmp"],
  emf: ["image/x-emf", "emf"], wmf: ["image/x-wmf", "wmf"], pict: ["image/x-pict", "pict"], tiff: ["image/tiff", "tiff"] };
const encoder = new TextEncoder();
const relationships = (items: readonly { id: string; type: string; target: string }[]) =>
  `${XML_HEADER}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${items.map(item => `<Relationship Id="${item.id}" Type="${DOCUMENT_RELATIONSHIPS}/${item.type}" Target="${item.target}"/>`).join("")}</Relationships>`;

/** Keep the Excel wording for failures of the shared container reader. */
async function excelContext<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Officeファイルを読み込めません:")) throw error;
    if (error.message.includes("複合ファイルではありません")) return fail(".xls形式（Excel 97–2003）のブックではありません");
    throw new Error(error.message.replace(/^Office/, "Excel"), { cause: error });
  }
}
function sharedStringsXml(book: XlsBook): string {
  const items = book.strings.map(({ text, rich }) => rich ? `<si><r><t xml:space="preserve">${xmlText(text)}</t></r></si>` : `<si><t xml:space="preserve">${xmlText(text)}</t></si>`);
  return `${XML_HEADER}<sst xmlns="${MAIN_NAMESPACE}" count="${items.length}" uniqueCount="${items.length}">${items.join("")}</sst>`;
}

/** Pictures of the workbook's drawing group, whose records may be split over several BIFF records. */
function readWorkbookImages(chunks: readonly Uint8Array[]): (OfficeArtImage | undefined)[] {
  if (!chunks.length) return [];
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const group = officeArtRecords(bytes).find(record => record.type === OFFICE_ART.drawingGroup);
  return group ? readOfficeArtImages(bytes, group) : [];
}

/**
 * Imports an Excel 97–2003 workbook (BIFF8). The binary records are rewritten as the equivalent
 * SpreadsheetML package and read by the XLSX importer, so limits, recovery and warnings are shared.
 * Macros are never loaded, encrypted files are rejected, and nothing is fetched or executed.
 */
export async function importSpreadsheetXls(input: SpreadsheetExcelImportInput, options: SpreadsheetExcelImportOptions = {}): Promise<SpreadsheetExcelImportResult> {
  const { signal, emptyCellFormatting = "preserve" } = options;
  if (emptyCellFormatting !== "preserve" && emptyCellFormatting !== "omit") return fail("emptyCellFormatting は preserve または omit を指定してください");
  signal?.throwIfAborted();
  const limits = resolveXlsxImportLimits(options.limits);
  // Whichever shared reader reports a failure in the binary format, it is worded as an Excel failure.
  const { archive, warnings } = await excelContext(() => convertXlsBook(input, signal, limits));
  const result = await importSpreadsheetXlsxPackage(archive, options);
  if (!warnings.length) return result;
  // Conversion notes come first; identical notes are counted once, as the reader does for its own.
  const merged: SpreadsheetExcelImportWarning[] = [], seen = new Map<string, number>();
  for (const warning of [...warnings, ...result.warnings]) {
    const key = `${warning.code}\0${warning.sheetName ?? ""}\0${warning.message}`, index = seen.get(key);
    if (index === undefined) { seen.set(key, merged.length); merged.push({ ...warning, count: warning.count ?? 1 }); }
    else merged[index] = { ...merged[index], count: (merged[index].count ?? 1) + (warning.count ?? 1) };
  }
  return Object.freeze({ workbook: result.workbook, warnings: Object.freeze(merged.map(item => Object.freeze(item))) });
}

/** Rewrites the workbook stream as the parts of a SpreadsheetML package. */
async function convertXlsBook(input: SpreadsheetExcelImportInput, signal: SpreadsheetExcelImportOptions["signal"], limits: ReturnType<typeof resolveXlsxImportLimits>):
  Promise<{ archive: ReturnType<typeof createOfficePackageFromParts>; warnings: SpreadsheetExcelImportWarning[] }> {
  const file = await openCompoundFile(input, signal, { inputBytes: limits.inputBytes, streamBytes: limits.inputBytes });
  // A password-protected OOXML workbook is also a compound file, wrapping the encrypted package.
  if (file.has("EncryptedPackage") || file.has("EncryptionInfo")) return fail("パスワードで保護または暗号化されたファイルには対応していません");
  const streamName = ["Workbook", "Book"].find(name => file.has(name));
  if (!streamName) return fail(".xls形式（Excel 97–2003）のブックではありません");
  const stream = file.read(streamName), book = readXlsBook(stream);
  if (!book.sheets.length) return fail("ワークシートがありません");
  const warnings: SpreadsheetExcelImportWarning[] = [], warn = (warning: SpreadsheetExcelImportWarning) => { warnings.push(warning); };
  if (file.paths.some(path => /^_VBA_PROJECT_CUR\//i.test(path))) warn({ code: "omitted", message: "マクロを読み込まずに省略しました" });
  const sheetNames = book.sheets.map(sheet => sheet.name);
  const context = { book, sheetNames, signal, warn, maxPartBytes: limits.entryBytes };
  const nameContext = { book, sheetNames, row: 0, column: 0 };
  // Converted parts are held in memory; their total is budgeted like the expanded size of a package.
  const parts: [string, Uint8Array][] = [];
  let convertedBytes = 0;
  const part = (path: string, content: string | Uint8Array) => {
    const bytes = typeof content === "string" ? encoder.encode(content) : content;
    if ((convertedBytes += bytes.byteLength) > limits.totalBytes) fail("変換後のデータのサイズが上限を超えています");
    parts.push([path, bytes]);
  };
  const overrides: string[] = [], bookRelationships: { id: string; type: string; target: string }[] = [], sheetNodes: string[] = [];
  // Macro sheets are dropped, so positions in the written sheet list differ from the source order.
  const writtenIndex = new Map<number, number>();
  const filterRanges = new Map<number, string>();
  for (const name of book.names) {
    if (name.builtin !== 13 || !name.sheet) continue;
    const reference = formulaText(name.formula, undefined, nameContext)?.split("!").at(-1)?.replaceAll("$", "");
    if (reference && /^[A-Z]+\d+(?::[A-Z]+\d+)?$/.test(reference)) filterRanges.set(name.sheet - 1, reference);
  }
  let worksheets = 0, charts = 0, comments = 0, drawings = 0;
  // Pictures are stored once for the workbook; shapes on any sheet refer to them by index.
  const images = readWorkbookImages(book.drawingGroup), imagePaths = new Map<number, string>(), extensions = new Map<string, string>();
  for (const [index, sheet] of book.sheets.entries()) {
    signal?.throwIfAborted();
    if (sheet.kind === "macro") { warn({ code: "omitted", sheetName: sheet.name, message: "マクロシートを省略しました" }); continue; }
    const id = `rId${sheetNodes.length + 1}`;
    writtenIndex.set(index, sheetNodes.length);
    sheetNodes.push(`<sheet name="${xmlAttribute(sheet.name)}" sheetId="${sheetNodes.length + 1}" r:id="${id}"${sheet.hidden ? ' state="hidden"' : ""}/>`);
    if (sheet.kind === "chart") {
      const path = `xl/chartsheets/sheet${++charts}.xml`;
      part(path, `${XML_HEADER}<chartsheet xmlns="${MAIN_NAMESPACE}"/>`);
      overrides.push(`<Override PartName="/${path}" ContentType="${SHEET_TYPES}.chartsheet+xml"/>`);
      bookRelationships.push({ id, type: "chartsheet", target: path.slice(3) });
      continue;
    }
    const path = `xl/worksheets/sheet${++worksheets}.xml`;
    const converted = await convertXlsSheet(stream, sheet, filterRanges.get(index), { ...context, maxPartBytes: Math.max(1, Math.min(limits.entryBytes, limits.totalBytes - convertedBytes)) });
    const sheetRelationships: { id: string; type: string; target: string }[] = [];
    if (converted.comments) {
      const target = `xl/comments${++comments}.xml`;
      part(target, converted.comments);
      overrides.push(`<Override PartName="/${target}" ContentType="${SHEET_TYPES}.comments+xml"/>`);
      sheetRelationships.push({ id: `rId${sheetRelationships.length + 1}`, type: "comments", target: `../${target.slice(3)}` });
    }
    let tail = "";
    if (converted.drawing.length) {
      const drawingRelationships: { id: string; type: string; target: string }[] = [];
      const drawing = convertXlsDrawing({ book, chunks: converted.drawing, objects: converted.objects, grid: converted.grid, images, hasFilter: converted.hasFilter, imageRelation(index) {
        const image = images[index - 1];
        if (!image) return undefined;
        let target = imagePaths.get(index);
        if (!target) {
          const [type, extension] = IMAGE_TYPES[image.format];
          target = `xl/media/image${imagePaths.size + 1}.${extension}`;
          part(target, image.data); extensions.set(extension, type); imagePaths.set(index, target);
        }
        const id = `rId${drawingRelationships.length + 1}`;
        drawingRelationships.push({ id, type: "image", target: `../${target.slice(3)}` });
        return id;
      } });
      if (drawing.xml) {
        const target = `xl/drawings/drawing${++drawings}.xml`, id = `rId${sheetRelationships.length + 1}`;
        part(target, drawing.xml);
        if (drawingRelationships.length) part(`xl/drawings/_rels/drawing${drawings}.xml.rels`, relationships(drawingRelationships));
        overrides.push(`<Override PartName="/${target}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        sheetRelationships.push({ id, type: "drawing", target: `../${target.slice(3)}` });
        tail += `<drawing r:id="${id}"/>`;
      }
      if (drawing.controls) tail += "<controls/>";
    }
    part(path, converted.finish(tail));
    if (sheetRelationships.length) part(`xl/worksheets/_rels/sheet${worksheets}.xml.rels`, relationships(sheetRelationships));
    overrides.push(`<Override PartName="/${path}" ContentType="${SHEET_TYPES}.worksheet+xml"/>`);
    bookRelationships.push({ id, type: "worksheet", target: path.slice(3) });
  }
  const definedNames: string[] = [];
  for (const name of book.names) {
    if (name.macro) continue;
    const label = name.builtin === undefined ? name.name : BUILT_IN_NAMES[name.builtin] && `_xlnm.${BUILT_IN_NAMES[name.builtin]}`;
    const local = name.sheet ? writtenIndex.get(name.sheet - 1) : undefined;
    if (!label || name.sheet && local === undefined) continue;
    // A name whose expression cannot be stated is passed on as a broken reference and reported by the reader.
    definedNames.push(`<definedName name="${xmlAttribute(label)}"${local === undefined ? "" : ` localSheetId="${local}"`}${name.hidden ? ' hidden="1"' : ""}>${xmlText(formulaText(name.formula, undefined, nameContext) ?? "#REF!")}</definedName>`);
  }
  bookRelationships.push({ id: `rId${bookRelationships.length + 1}`, type: "styles", target: "styles.xml" }, { id: `rId${bookRelationships.length + 2}`, type: "sharedStrings", target: "sharedStrings.xml" });
  part("xl/styles.xml", xlsStylesXml(book));
  part("xl/sharedStrings.xml", sharedStringsXml(book));
  part("xl/workbook.xml", `${XML_HEADER}<workbook xmlns="${MAIN_NAMESPACE}" xmlns:r="${DOCUMENT_RELATIONSHIPS}"><workbookPr${book.date1904 ? ' date1904="1"' : ""}/>` +
    `${book.protected ? `<workbookProtection lockStructure="1"/>` : ""}<sheets>${sheetNodes.join("")}</sheets>${definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : ""}</workbook>`);
  part("xl/_rels/workbook.xml.rels", relationships(bookRelationships));
  part("_rels/.rels", relationships([{ id: "rId1", type: "officeDocument", target: "xl/workbook.xml" }]));
  part("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>${[...extensions].map(([extension, type]) => `<Default Extension="${extension}" ContentType="${type}"/>`).join("")}<Override PartName="/xl/workbook.xml" ContentType="${SHEET_TYPES}.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="${SHEET_TYPES}.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="${SHEET_TYPES}.sharedStrings+xml"/>${overrides.join("")}</Types>`);
  signal?.throwIfAborted();
  return { archive: createOfficePackageFromParts(parts, { signal, limits: { entries: limits.entries, entryBytes: limits.entryBytes, totalBytes: limits.totalBytes } }), warnings };
}

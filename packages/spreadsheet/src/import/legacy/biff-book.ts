import { ByteReader } from "../../core";
import { BiffStream, ContinuedReader, RT, fail, readCharacters, readRichString, readString, type BiffRecord, type RichString } from "./biff";

export type XlsFont = { name: string; size: number; bold: boolean; italic: boolean; strike: boolean; outline: boolean; shadow: boolean;
  underline: number; escapement: number; color: number };
export type XlsFormat = {
  font: number; numberFormat: number; style: boolean; horizontal: number; vertical: number; wrap: boolean; rotation: number; indent: number; shrink: boolean;
  borders: { left: number; right: number; top: number; bottom: number; diagonal: number };
  borderColors: { left: number; right: number; top: number; bottom: number; diagonal: number };
  diagonalDown: boolean; diagonalUp: boolean; pattern: number; foreground: number; background: number;
};
export type XlsSheetEntry = { name: string; offset: number; hidden: boolean; kind: "worksheet" | "chart" | "macro" };
export type XlsExternSheet = { book: number; first: number; last: number };
/** Target of an EXTERNSHEET entry, with the external names declared for it (add-in functions among them). */
export type XlsSupBook = { kind: "self" | "addin" | "external"; names: string[] };
export type XlsName = { name: string; builtin?: number; hidden: boolean; macro: boolean; sheet: number; formula: Uint8Array };
export type XlsBook = {
  date1904: boolean; fonts: XlsFont[]; numberFormats: Map<number, string>; formats: XlsFormat[]; palette: string[];
  sheets: XlsSheetEntry[]; strings: RichString[]; externSheets: XlsExternSheet[]; supBooks: XlsSupBook[]; names: XlsName[];
  drawingGroup: Uint8Array[]; protected: boolean;
};

const DEFAULT_PALETTE = ("000000FFFFFFFF000000FF000000FFFFFF00FF00FF00FFFF800000008000000080808000800080008080C0C0C0808080" +
  "9999FF993366FFFFCCCCFFFF660066FF80800066CCCCCCFF000080FF00FFFFFF0000FFFF8000808000000080800000FF" +
  "00CCFFCCFFFFCCFFCCFFFF9999CCFFFF99CCCC99FFFFCC993366FF33CCCC99CC00FFCC00FF9900FF6600666699969696" +
  "003366339966003300333300993300993366333399333333").match(/.{6}/g)!;
const BASE_COLORS = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];

/** Resolves a colour index to RRGGBB; automatic and unknown indexes yield undefined. */
export function xlsColor(book: Pick<XlsBook, "palette">, index: number): string | undefined {
  if (index < 8) return BASE_COLORS[index];
  if (index < 64) return book.palette[index - 8];
  return index === 64 ? "000000" : index === 65 ? "FFFFFF" : undefined;
}

function readFont(data: Uint8Array): XlsFont {
  const reader = new ByteReader(data), height = reader.u16(), flags = reader.u16(), color = reader.u16(), weight = reader.u16(), escapement = reader.u16(), underline = reader.u8();
  reader.skip(3);
  return { name: readString(reader, 1), size: height / 20, bold: weight >= 600, italic: !!(flags & 0x02), strike: !!(flags & 0x08), outline: !!(flags & 0x10),
    shadow: !!(flags & 0x20), underline, escapement, color };
}
function readFormat(data: Uint8Array): XlsFormat {
  const reader = new ByteReader(data), font = reader.u16(), numberFormat = reader.u16(), flags = reader.u16(), alignment = reader.u8(), rotation = reader.u8(), indent = reader.u8();
  reader.skip(1);
  const border = reader.u32(), color = reader.u32(), fill = reader.u16();
  return { font, numberFormat, style: !!(flags & 0x04), horizontal: alignment & 7, wrap: !!(alignment & 8), vertical: alignment >> 4 & 7, rotation, indent: indent & 15, shrink: !!(indent & 0x10),
    borders: { left: border & 15, right: border >>> 4 & 15, top: border >>> 8 & 15, bottom: border >>> 12 & 15, diagonal: color >>> 21 & 15 },
    borderColors: { left: border >>> 16 & 127, right: border >>> 23 & 127, top: color & 127, bottom: color >>> 7 & 127, diagonal: color >>> 14 & 127 },
    diagonalDown: !!(border >>> 30 & 1), diagonalUp: !!(border >>> 31 & 1), pattern: color >>> 26 & 63, foreground: fill & 127, background: fill >>> 7 & 127 };
}
function readName(record: BiffRecord): XlsName {
  const reader = new ByteReader(record.data), flags = reader.u16();
  reader.skip(1);
  const length = reader.u8(), formulaLength = reader.u16();
  reader.skip(2);
  const sheet = reader.u16();
  reader.skip(4);
  const text = readCharacters(reader, length), builtin = !!(flags & 0x20);
  return { name: builtin ? "" : text, ...(builtin ? { builtin: text.charCodeAt(0) } : {}), hidden: !!(flags & 0x01), macro: !!(flags & 0x0e), sheet,
    formula: reader.take(Math.min(formulaLength, reader.remaining)) };
}
function readSupBook(data: Uint8Array): XlsSupBook {
  const reader = new ByteReader(data);
  reader.skip(2);
  const marker = reader.remaining === 2 ? reader.u16() : 0;
  // External workbooks are never opened, so only references into this workbook and add-in functions resolve.
  return { kind: marker === 0x0401 ? "self" : marker === 0x3a01 ? "addin" : "external", names: [] };
}
/** Name of an add-in function or external defined name; unreadable entries keep their position. */
function readExternName(data: Uint8Array): string {
  try { const reader = new ByteReader(data); reader.skip(6); return readString(reader, 1); } catch { return ""; }
}

/** Reads the workbook globals substream. Sheets are located but not read. */
export function readXlsBook(stream: Uint8Array): XlsBook {
  const records = new BiffStream(stream), first = records.next();
  if (!first || first.type !== RT.BOF || first.data.length < 4) return fail(".xls形式（Excel 97–2003）のブックではありません");
  const head = new ByteReader(first.data), version = head.u16(), kind = head.u16();
  if (version !== 0x0600) return fail("Excel 95以前の形式には対応していません");
  if (kind !== 0x0005) return fail("ブックの構造が不正です");
  const book: XlsBook = { date1904: false, fonts: [], numberFormats: new Map(), formats: [], palette: [...DEFAULT_PALETTE], sheets: [], strings: [],
    externSheets: [], supBooks: [], names: [], drawingGroup: [], protected: false };
  for (let record = records.next(); record && record.type !== RT.EOF; record = records.next()) {
    const { type, data } = record;
    if (type === RT.FILEPASS) return fail("パスワードで保護または暗号化されたファイルには対応していません");
    else if (type === RT.DATEMODE) book.date1904 = new ByteReader(data).u16() === 1;
    else if (type === RT.PROTECT) book.protected ||= new ByteReader(data).u16() !== 0;
    else if (type === RT.FONT) book.fonts.push(readFont(data));
    else if (type === RT.FORMAT) { const reader = new ByteReader(data), id = reader.u16(); book.numberFormats.set(id, readString(reader)); }
    else if (type === RT.XF) book.formats.push(readFormat(data));
    else if (type === RT.PALETTE) {
      const reader = new ByteReader(data), count = Math.min(reader.u16(), 56);
      for (let index = 0; index < count && reader.remaining >= 4; index++) {
        const [red, green, blue] = reader.take(4);
        book.palette[index] = [red, green, blue].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
      }
    } else if (type === RT.BOUNDSHEET) {
      const reader = new ByteReader(data), offset = reader.u32(), state = reader.u8() & 3, sheetType = reader.u8();
      book.sheets.push({ name: readString(reader, 1), offset, hidden: state !== 0, kind: sheetType === 0 ? "worksheet" : sheetType === 2 ? "chart" : "macro" });
    } else if (type === RT.SST) {
      const reader = new ContinuedReader(record);
      reader.skip(4);
      const unique = reader.u32();
      for (let index = 0; index < unique && !reader.done; index++) book.strings.push(readRichString(reader));
    } else if (type === RT.EXTERNSHEET) {
      const reader = new ContinuedReader(record), count = reader.u16();
      for (let index = 0; index < count && !reader.done; index++) { const entry = reader.u16(), from = reader.u16(), to = reader.u16(); book.externSheets.push({ book: entry, first: from, last: to }); }
    } else if (type === RT.SUPBOOK) book.supBooks.push(readSupBook(data));
    else if (type === RT.EXTERNNAME) book.supBooks.at(-1)?.names.push(readExternName(data));
    else if (type === RT.NAME) book.names.push(readName(record));
    else if (type === RT.MSODRAWINGGROUP) book.drawingGroup.push(data, ...record.continues);
    else if (type === RT.BOF) return fail("ブックの構造が不正です");
  }
  return book;
}

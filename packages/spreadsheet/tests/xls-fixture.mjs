// Test-only BIFF8 writer. Tests state workbooks record by record, so each case shows exactly
// which bytes of the Excel 97–2003 format it exercises.
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';

export const bytes = (...parts) => Uint8Array.from(parts.flatMap(part => typeof part === 'number' ? [part] : [...part]));
export const u8 = value => [value & 255];
export const u16 = value => [value & 255, (value >>> 8) & 255];
export const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
export const f64 = value => [...new Uint8Array(new Float64Array([value]).buffer)];
const wide = text => [...text].some(character => character.charCodeAt(0) > 255);
const characters = (text, forceWide = wide(text)) => forceWide ? [...text].flatMap(character => u16(character.charCodeAt(0))) : [...text].map(character => character.charCodeAt(0));
/** XLUnicodeString: 16-bit length, option flags, characters. */
export const str = (text, forceWide = wide(text)) => [...u16(text.length), forceWide ? 1 : 0, ...characters(text, forceWide)];
/** ShortXLUnicodeString: 8-bit length, option flags, characters. */
export const shortStr = (text, forceWide = wide(text)) => [text.length, forceWide ? 1 : 0, ...characters(text, forceWide)];
/** XLUnicodeStringNoCch: option flags and characters; the length is stored by the caller. */
export const noCch = (text, forceWide = wide(text)) => [forceWide ? 1 : 0, ...characters(text, forceWide)];

export function record(type, ...parts) {
  const data = bytes(...parts);
  if (data.length > 8224) throw new Error('record data exceeds 8224 bytes; split it with CONTINUE records');
  return bytes(u16(type), u16(data.length), data);
}
export const R = Object.freeze({ BOF: 0x0809, EOF: 0x000a, BOUNDSHEET: 0x0085, SST: 0x00fc, CONTINUE: 0x003c, FILEPASS: 0x002f, CODEPAGE: 0x0042,
  DATEMODE: 0x0022, FONT: 0x0031, FORMAT: 0x041e, XF: 0x00e0, PALETTE: 0x0092, STYLE: 0x0293, EXTERNSHEET: 0x0017, SUPBOOK: 0x01ae, NAME: 0x0018,
  DIMENSIONS: 0x0200, ROW: 0x0208, COLINFO: 0x007d, DEFCOLWIDTH: 0x0055, STANDARDWIDTH: 0x0099, DEFAULTROWHEIGHT: 0x0225,
  NUMBER: 0x0203, RK: 0x027e, MULRK: 0x00bd, LABELSST: 0x00fd, LABEL: 0x0204, BLANK: 0x0201, MULBLANK: 0x00be, BOOLERR: 0x0205,
  FORMULA: 0x0006, STRING: 0x0207, SHRFMLA: 0x04bc, ARRAY: 0x0221, TABLE: 0x0236, MERGEDCELLS: 0x00e5,
  NOTE: 0x001c, OBJ: 0x005d, TXO: 0x01b6, MSODRAWING: 0x00ec, MSODRAWINGGROUP: 0x00eb,
  DVAL: 0x01b2, DV: 0x01be, AUTOFILTERINFO: 0x009d, AUTOFILTER: 0x009e, FILTERMODE: 0x009b,
  SETUP: 0x00a1, LEFTMARGIN: 0x0026, RIGHTMARGIN: 0x0027, TOPMARGIN: 0x0028, BOTTOMMARGIN: 0x0029,
  HORIZONTALPAGEBREAKS: 0x001b, VERTICALPAGEBREAKS: 0x001a, WSBOOL: 0x0081, WINDOW2: 0x023e, PANE: 0x0041, PROTECT: 0x0012,
  CONDFMT: 0x01b0, HLINK: 0x01b8 });
export const bof = (kind, version = 0x0600) => record(R.BOF, u16(version), u16(kind), u16(0x0dbb), u16(0x07cc), u32(0), u32(6));
export const eof = () => record(R.EOF);
export const boundSheet = (offset, name, { state = 0, type = 0 } = {}) => record(R.BOUNDSHEET, u32(offset), state, type, shortStr(name));
export const cell = (row, column, xf = 15) => [...u16(row), ...u16(column), ...u16(xf)];
export const number = (row, column, value, xf) => record(R.NUMBER, cell(row, column, xf), f64(value));
export const labelSst = (row, column, index, xf) => record(R.LABELSST, cell(row, column, xf), u32(index));
/** Shared string table without continuation; strings may be plain text or prebuilt byte arrays. */
export const sst = strings => record(R.SST, u32(strings.length), u32(strings.length), ...strings.map(item => typeof item === 'string' ? str(item) : item));
export const defaultFont = () => font({ name: 'Arial', height: 200 });
export function font({ name = 'Arial', height = 200, bold = false, italic = false, strike = false, underline = 0, color = 0x7fff, escapement = 0 } = {}) {
  return record(R.FONT, u16(height), u16((italic ? 2 : 0) | (strike ? 8 : 0)), u16(color), u16(bold ? 700 : 400), u16(escapement), underline, 0, 0, 0, shortStr(name));
}
export function xf({ font: fontIndex = 0, format = 0, style = false, parent = style ? 0xfff : 0, horizontal = 0, wrap = false, vertical = 2, rotation = 0, indent = 0, shrink = false,
  left = 0, right = 0, top = 0, bottom = 0, leftColor = 0x40, rightColor = 0x40, topColor = 0x40, bottomColor = 0x40, diagonal = 0, diagonalColor = 0x40, diagonalStyle = 0,
  pattern = 0, fore = 0x40, back = 0x41 } = {}) {
  const borders = (left | right << 4 | top << 8 | bottom << 12 | leftColor << 16 | rightColor << 23 | diagonal << 30) >>> 0;
  const colors = (topColor | bottomColor << 7 | diagonalColor << 14 | diagonalStyle << 21 | pattern << 26) >>> 0;
  return record(R.XF, u16(fontIndex), u16(format), u16((style ? 4 : 0) | 1 | parent << 4), horizontal | (wrap ? 8 : 0) | vertical << 4, rotation, indent | (shrink ? 0x10 : 0), 0,
    u32(borders), u32(colors), u16(fore | back << 7));
}
/** Sixteen format records: fifteen style formats and the default cell format, as Excel writes them. */
export const defaultFormats = () => [...Array.from({ length: 15 }, () => xf({ style: true })), xf()];

/**
 * Assembles the Workbook stream. BoundSheet offsets are computed from the final layout.
 * @param {{ globals?: Uint8Array[], sheets?: { name: string, records?: Uint8Array[], state?: number, type?: number, kind?: number }[], version?: number }} book
 */
export function workbookStream({ globals = [defaultFont(), ...defaultFormats()], sheets = [{ name: 'Sheet1', records: [] }], version = 0x0600 } = {}) {
  const head = [bof(0x0005, version), ...globals], tail = [eof()];
  const size = parts => parts.reduce((total, part) => total + part.length, 0);
  const sheetStreams = sheets.map(sheet => bytes(bof(sheet.kind ?? 0x0010, version), ...(sheet.records ?? []), eof()));
  const bounds = offsets => sheets.map((sheet, index) => boundSheet(offsets[index], sheet.name, sheet));
  const globalsSize = size(head) + size(bounds(sheets.map(() => 0))) + size(tail);
  const offsets = sheetStreams.map((_, index) => globalsSize + size(sheetStreams.slice(0, index)));
  return bytes(...head, ...bounds(offsets), ...tail, ...sheetStreams);
}
/** A complete .xls file. Extra streams (for example a VBA storage) can be added by path. */
export function xls(book = {}, { streamName = 'Workbook', extraStreams = [] } = {}) {
  return createCompoundFile([{ path: streamName, content: workbookStream(book) }, ...extraStreams]);
}

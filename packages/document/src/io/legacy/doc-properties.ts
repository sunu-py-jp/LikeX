import { ByteReader } from "../../core";
import { FIB, type DocFile } from "./doc-file";

/** Property modifiers (Sprm) and the tables they refer to: styles, fonts and list definitions. */
export type CharacterProperties = {
  bold: boolean; italic: boolean; strike: boolean; underline: boolean; vanish: boolean; size: number;
  color?: string; highlight?: number; shade?: string; font?: number; eastAsianFont?: number; position: number;
  special: boolean; pictureOffset?: number; deleted: boolean; inserted: boolean; symbol: boolean; embedded: boolean; style?: number;
};
export type ParagraphProperties = {
  align: number; pageBreakBefore: boolean; list: number; listLevel: number; outline: number;
  depth: number; rowEnd: boolean; innerCellEnd: boolean; innerRowEnd: boolean;
};
export type TableCell = { left: number; right: number; merged: boolean; firstMerged: boolean; verticalMerge: "none" | "restart" | "continue"; shade?: string; borders: string };
export type TableRow = { cells: TableCell[]; header: boolean };
export type SectionProperties = { width: number; height: number; left: number; right: number; top: number; bottom: number; start: number; columns: number };
export type DocStyle = { kind: number; base: number; builtin: number; paragraph: Uint8Array; character: Uint8Array };
export type DocListLevel = { start: number; format: number; text: string };
export type DocList = { id: number; levels: DocListLevel[] };

export const DEFAULT_CHARACTER: CharacterProperties = Object.freeze({ bold: false, italic: false, strike: false, underline: false, vanish: false, size: 20, position: 0,
  special: false, deleted: false, inserted: false, symbol: false, embedded: false });
export const DEFAULT_PARAGRAPH: ParagraphProperties = Object.freeze({ align: 0, pageBreakBefore: false, list: 0, listLevel: 0, outline: 9, depth: 0, rowEnd: false, innerCellEnd: false, innerRowEnd: false });
export const DEFAULT_SECTION: SectionProperties = Object.freeze({ width: 12_240, height: 15_840, left: 1800, right: 1800, top: 1440, bottom: 1440, start: 2, columns: 1 });
/** The sixteen fixed colours of colour-index operands; index 0 is automatic. */
const INDEXED_COLORS = [undefined, "000000", "0000FF", "00FFFF", "00FF00", "FF00FF", "FF0000", "FFFF00", "FFFFFF", "000080", "008080", "008000", "800080", "800000", "808000", "808080", "C0C0C0"];
export const HIGHLIGHT_NAMES = [undefined, "black", "blue", "cyan", "green", "magenta", "red", "yellow", "white", "darkBlue", "darkCyan", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray"];

/** Visits each modifier with a reader confined to its operand. A malformed list ends quietly. */
export function eachSprm(grpprl: Uint8Array, visit: (sprm: number, operand: ByteReader) => void): void {
  const reader = new ByteReader(grpprl);
  try {
    while (reader.remaining >= 2) {
      const sprm = reader.u16(), kind = sprm >>> 13;
      let size = kind === 0 || kind === 1 ? 1 : kind === 2 || kind === 4 || kind === 5 ? 2 : kind === 3 ? 4 : kind === 7 ? 3 : -1;
      if (size < 0) {
        // Variable operands state their own length; the table definition uses two bytes for it.
        if (sprm === 0xd608 || sprm === 0xd606) size = reader.u16() - 1;
        else { size = reader.u8(); if (sprm === 0xc615 && size === 255) return; }
      }
      visit(sprm, reader.sub(size));
    }
  } catch { /* Truncated modifiers leave the properties read so far. */ }
}
/** COLORREF: red, green, blue and a flag byte that marks the automatic colour. */
function colorReference(operand: ByteReader): string | undefined {
  const [red, green, blue, flag] = operand.take(4);
  return flag === 0xff ? undefined : [red, green, blue].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}
/** A toggle is off, on, the style's value, or the opposite of the style's value. */
const toggle = (value: number, style: boolean): boolean => value === 0 ? false : value === 1 ? true : value === 0x81 ? !style : style;
/** Shading: a solid pattern shows the foreground, other patterns are approximated by their background; "nil" is none. */
function shading(pattern: number, foreground: string | undefined, background: string | undefined): string | undefined {
  return pattern === 0xffff ? undefined : pattern === 1 ? foreground : background;
}

export function applyCharacterSprms(grpprl: Uint8Array, target: CharacterProperties, style: CharacterProperties): void {
  eachSprm(grpprl, (sprm, operand) => {
    switch (sprm) {
      case 0x0835: target.bold = toggle(operand.u8(), style.bold); break;
      case 0x0836: target.italic = toggle(operand.u8(), style.italic); break;
      case 0x0837: case 0x2a53: target.strike = toggle(operand.u8(), style.strike); break;
      case 0x083c: target.vanish = toggle(operand.u8(), style.vanish); break;
      case 0x2a3e: target.underline = operand.u8() !== 0; break;
      case 0x4a43: target.size = operand.u16(); break;
      case 0x2a42: target.color = INDEXED_COLORS[operand.u8()]; break;
      case 0x6870: target.color = colorReference(operand); break;
      case 0x2a0c: target.highlight = operand.u8(); break;
      case 0x4866: { const value = operand.u16(); target.shade = value === 0xffff ? undefined : shading(value >>> 10, INDEXED_COLORS[value & 31], INDEXED_COLORS[value >>> 5 & 31]); break; }
      case 0xca71: { const foreground = colorReference(operand), background = colorReference(operand); target.shade = shading(operand.u16(), foreground, background); break; }
      case 0x4a4f: target.font = operand.u16(); break;
      case 0x4a50: target.eastAsianFont = operand.u16(); break;
      case 0x4a30: target.style = operand.u16(); break;
      case 0x2a48: target.position = operand.u8(); break;
      case 0x0855: target.special = operand.u8() !== 0; break;
      case 0x6a03: target.pictureOffset = operand.u32(); break;
      case 0x0806: case 0x080a: case 0x0856: target.embedded = target.embedded || operand.u8() !== 0; break;
      case 0x6a09: target.symbol = true; break;
      case 0x0800: target.deleted = operand.u8() !== 0; break;
      case 0x0801: target.inserted = operand.u8() !== 0; break;
    }
  });
}
export function applyParagraphSprms(grpprl: Uint8Array, target: ParagraphProperties): void {
  eachSprm(grpprl, (sprm, operand) => {
    switch (sprm) {
      case 0x2403: case 0x2461: target.align = operand.u8(); break;
      case 0x2407: target.pageBreakBefore = operand.u8() !== 0; break;
      case 0x260a: target.listLevel = operand.u8(); break;
      case 0x460b: target.list = operand.u16(); break;
      case 0x2640: target.outline = operand.u8(); break;
      case 0x2416: if (operand.u8()) target.depth = Math.max(target.depth, 1); else target.depth = 0; break;
      case 0x6649: target.depth = Math.max(0, Math.min(64, operand.i32())); break;
      case 0x2417: target.rowEnd = operand.u8() !== 0; break;
      case 0x244b: target.innerCellEnd = operand.u8() !== 0; break;
      case 0x244c: target.innerRowEnd = operand.u8() !== 0; break;
    }
  });
}
/** One border as WordprocessingML attributes; widths are eighths of a point in both formats. */
function border(name: string, operand: ByteReader): string {
  const width = operand.u8(), type = operand.u8(), color = operand.u8();
  operand.skip(1);
  if (type === 0 || type === 0xff) return `<w:${name} w:val="none"/>`;
  return `<w:${name} w:val="${type === 1 ? "single" : type === 3 ? "double" : type === 6 ? "dotted" : type === 7 ? "dashed" : "single"}" w:sz="${width}" w:color="${color > 1 ? INDEXED_COLORS[color] ?? "auto" : "auto"}"/>`;
}
/** Reads the row description that the row-end paragraph carries. */
export function readTableRow(grpprl: Uint8Array): TableRow | undefined {
  let row: TableRow | undefined, header = false;
  const shades: (string | undefined)[] = [];
  eachSprm(grpprl, (sprm, operand) => {
    if (sprm === 0xd608) {
      const count = operand.u8(), edges = Array.from({ length: count + 1 }, () => operand.i16()), cells: TableCell[] = [], merges: number[] = [];
      // Cell edges run left to right; an edge that steps back is held at the one before it.
      for (let index = 1; index < edges.length; index++) edges[index] = Math.max(edges[index], edges[index - 1]);
      for (let index = 0; index < count; index++) {
        let flags = 0, borders = "";
        if (operand.remaining >= 20) {
          flags = operand.u16(); operand.skip(2);
          const top = border("top", operand), left = border("left", operand), bottom = border("bottom", operand), right = border("right", operand);
          borders = top + left + bottom + right;
        }
        cells.push({ left: edges[index], right: edges[index + 1], firstMerged: false, merged: false,
          verticalMerge: flags & 0x40 ? "restart" : flags & 0x20 ? "continue" : "none", borders });
        merges.push(flags & 3);
      }
      // The two merge bits are documented in opposite ways by the format specification and by older
      // references. A run of flagged cells starts a merged set; the first later cell fixes which value
      // marks a member, and any other value starts the next set.
      let member: number | undefined, open = false;
      merges.forEach((value, index) => {
        if (!value) { open = false; return; }
        if (open && value !== 3 && (member ??= value) === value) cells[index].merged = true;
        else { cells[index].firstMerged = true; open = true; }
      });
      row = { cells, header: false };
    } else if (sprm === 0xd612 || sprm === 0xd616 || sprm === 0xd60c) {
      const offset = sprm === 0xd612 ? 0 : sprm === 0xd616 ? 22 : 44;
      for (let index = 0; operand.remaining >= 10; index++) { const foreground = colorReference(operand), background = colorReference(operand); shades[offset + index] = shading(operand.u16(), foreground, background); }
    } else if (sprm === 0xd609) {
      for (let index = 0; operand.remaining >= 2; index++) { const value = operand.u16(); if (value !== 0xffff) shades[index] ??= shading(value >>> 10, INDEXED_COLORS[value & 31], INDEXED_COLORS[value >>> 5 & 31]); }
    } else if (sprm === 0x3404) header = operand.u8() !== 0;
  });
  if (!row) return undefined;
  row.header = header;
  row.cells.forEach((cell, index) => { if (shades[index]) cell.shade = shades[index]; });
  return row;
}
export function readSection(grpprl: Uint8Array): SectionProperties {
  const section = { ...DEFAULT_SECTION };
  eachSprm(grpprl, (sprm, operand) => {
    switch (sprm) {
      case 0xb01f: section.width = operand.u16(); break;
      case 0xb020: section.height = operand.u16(); break;
      case 0xb021: section.left = operand.u16(); break;
      case 0xb022: section.right = operand.u16(); break;
      case 0x9023: section.top = Math.abs(operand.i16()); break;
      case 0x9024: section.bottom = Math.abs(operand.i16()); break;
      case 0x3009: section.start = operand.u8(); break;
      case 0x500b: section.columns = operand.u16() + 1; break;
    }
  });
  // The document model holds pages of 25–1200 mm with margins up to 500 mm that leave 10 mm of content.
  // A page outside that (a damaged or unusual section) is replaced by the default page, not refused.
  const mm = (twips: number) => twips * 25.4 / 1440, { width, height, left, right, top, bottom } = section;
  const usable = [width, height].every(value => mm(value) >= 25 && mm(value) <= 1200) && [left, right, top, bottom].every(value => mm(value) <= 500) &&
    mm(left + right) < mm(width) - 10 && mm(top + bottom) < mm(height) - 10;
  return usable ? section : { ...section, width: DEFAULT_SECTION.width, height: DEFAULT_SECTION.height, left: DEFAULT_SECTION.left, right: DEFAULT_SECTION.right, top: DEFAULT_SECTION.top, bottom: DEFAULT_SECTION.bottom };
}

export type DocStyleSheet = { styles: DocStyle[]; defaultFont?: number; defaultEastAsianFont?: number };
/** Style sheet: the document's default fonts and each style's kind, parent and own modifiers. */
export function readStyles(file: DocFile): DocStyleSheet {
  const { offset, length } = file.pair(FIB.styles), styles: DocStyle[] = [], sheet: DocStyleSheet = { styles };
  if (length < 4) return sheet;
  try {
    const reader = new ByteReader(file.table, offset, offset + length), headerSize = reader.u16(), header = reader.sub(headerSize);
    const count = header.u16(), baseSize = header.u16();
    if (header.remaining >= 12) { header.skip(8); sheet.defaultFont = header.u16(); sheet.defaultEastAsianFont = header.u16(); }
    for (let index = 0; index < count && reader.remaining >= 2; index++) {
      const size = reader.u16(), empty = new Uint8Array();
      if (!size) { styles.push({ kind: 0, base: 0xfff, builtin: 0xfff, paragraph: empty, character: empty }); continue; }
      const start = reader.offset, body = reader.sub(size), builtin = body.u16() & 0xfff, second = body.u16(), kind = second & 15, base = second >>> 4, formats = body.u16() & 15;
      const style: DocStyle = { kind, base, builtin, paragraph: empty, character: empty };
      styles.push(style);
      try {
        body.seek(start + baseSize);
        body.skip((body.u16() + 1) * 2);
        for (let format = 0; format < formats; format++) {
          // Each formatting set starts on an even offset within the style.
          if ((body.offset - start) & 1) body.skip(1);
          const set = body.sub(body.u16());
          if (kind === 1 && format === 0) { set.skip(2); style.paragraph = set.take(set.remaining); }
          else if (kind === 1 && format === 1 || kind === 2 && format === 0) style.character = set.take(set.remaining);
        }
      } catch { /* A damaged style keeps what was read; the document text is unaffected. */ }
    }
  } catch { /* A damaged style sheet leaves the default formatting. */ }
  return sheet;
}
/** Font names by index. */
export function readFonts(file: DocFile): string[] {
  const { offset, length } = file.pair(FIB.fonts), fonts: string[] = [];
  if (length < 4) return fonts;
  try {
    const reader = new ByteReader(file.table, offset, offset + length), count = reader.u16();
    reader.skip(2);
    for (let index = 0; index < count && reader.remaining; index++) {
      const entry = reader.sub(reader.u8());
      entry.skip(39);
      const name = entry.utf16(Math.floor(entry.remaining / 2)), end = name.indexOf("\u0000");
      fonts.push(end < 0 ? name : name.slice(0, end));
    }
  } catch { /* Missing font names fall back to the application default. */ }
  return fonts;
}
/** List definitions, indexed as paragraphs refer to them (one-based override index). */
export function readLists(file: DocFile): (DocList | undefined)[] {
  const lists = file.pair(FIB.lists), overrides = file.pair(FIB.listOverrides), result: (DocList | undefined)[] = [];
  if (lists.length < 2 || overrides.length < 4) return result;
  try {
    const reader = new ByteReader(file.table, lists.offset), count = reader.i16(), definitions = new Map<number, DocList>(), pending: { list: DocList; levels: number }[] = [];
    for (let index = 0; index < count; index++) {
      const id = reader.i32();
      reader.skip(22);
      const flags = reader.u8();
      reader.skip(1);
      const list = { id, levels: [] };
      definitions.set(id, list); pending.push({ list, levels: flags & 1 ? 1 : 9 });
    }
    // Level descriptions follow the list headers, in the same order.
    for (const { list, levels } of pending) for (let level = 0; level < levels; level++) {
      const start = reader.i32(), format = reader.u8();
      reader.skip(19);
      const characterBytes = reader.u8(), paragraphBytes = reader.u8();
      reader.skip(2 + paragraphBytes + characterBytes);
      list.levels.push({ start, format, text: reader.utf16(reader.u16()) });
    }
    const table = new ByteReader(file.table, overrides.offset, overrides.offset + overrides.length), total = table.i32();
    for (let index = 0; index < total && table.remaining >= 16; index++) { result.push(definitions.get(table.i32())); table.skip(12); }
  } catch { /* Damaged list tables leave the paragraphs unnumbered. */ }
  return result;
}

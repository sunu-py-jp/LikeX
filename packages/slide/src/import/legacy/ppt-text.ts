import { ByteReader, type OfficeArtRecord } from "../../core";
import { RT } from "./ppt-file";

/** Text of a shape or placeholder: characters, paragraph and character runs, and the master styles they inherit. */
export type PptParagraphStyle = { align?: number; bullet?: boolean; level: number };
export type PptCharacterStyle = { bold?: boolean; italic?: boolean; underline?: boolean; font?: number; size?: number; color?: number };
export type PptTextRun = { text: string; style: PptCharacterStyle };
export type PptParagraph = { style: PptParagraphStyle; runs: PptTextRun[]; ownBullet: boolean };
export type PptText = { type: number; paragraphs: PptParagraph[] };
/** Master text style: per indent level, the paragraph and character defaults of one text type. */
export type PptLevelStyle = { paragraph: PptParagraphStyle; character: PptCharacterStyle };
export type PptMasterStyles = Map<number, PptLevelStyle[]>;

/** Paragraph exception: the mask says which fields follow, in a fixed order. */
function readParagraphException(reader: ByteReader, level: number): PptParagraphStyle & { ownBullet: boolean } {
  const mask = reader.u32(), style: PptParagraphStyle & { ownBullet: boolean } = { level, ownBullet: false };
  if (mask & 0x0f) { const flags = reader.u16(); if (mask & 0x01) { style.bullet = !!(flags & 1); style.ownBullet = true; } }
  if (mask & 0x80) reader.skip(2);
  if (mask & 0x10) reader.skip(2);
  if (mask & 0x40) reader.skip(2);
  if (mask & 0x20) reader.skip(4);
  if (mask & 0x800) style.align = reader.u16();
  for (const bit of [0x1000, 0x2000, 0x4000, 0x100, 0x400, 0x8000]) if (mask & bit) reader.skip(2);
  if (mask & 0x100000) reader.skip(reader.u16() * 4);
  if (mask & 0x10000) reader.skip(2);
  if (mask & 0xe0000) reader.skip(2);
  if (mask & 0x200000) reader.skip(2);
  return style;
}
/** Character exception: style bits, font references, size, colour and position, as the mask states. */
function readCharacterException(reader: ByteReader): PptCharacterStyle {
  const mask = reader.u32(), style: PptCharacterStyle = {};
  if (mask & 0xffff) {
    const flags = reader.u16();
    if (mask & 0x01) style.bold = !!(flags & 0x01);
    if (mask & 0x02) style.italic = !!(flags & 0x02);
    if (mask & 0x04) style.underline = !!(flags & 0x04);
  }
  if (mask & 0x10000) style.font = reader.u16();
  for (const bit of [0x200000, 0x400000, 0x800000]) if (mask & bit) reader.skip(2);
  if (mask & 0x20000) style.size = reader.u16();
  if (mask & 0x40000) style.color = reader.u32();
  if (mask & 0x80000) reader.skip(2);
  return style;
}
/** Reads a master style record: levels inherit the fields that deeper levels leave unstated. */
export function readMasterStyle(bytes: Uint8Array, record: OfficeArtRecord, target: PptMasterStyles): void {
  try {
    const reader = new ByteReader(bytes, record.start, record.end), count = Math.min(reader.u16(), 5), levels: PptLevelStyle[] = [];
    for (let level = 0; level < count; level++) {
      // Text types from 5 upward restate the level they describe.
      if (record.instance >= 5) reader.skip(2);
      const paragraph = readParagraphException(reader, level), character = readCharacterException(reader), previous = levels[level - 1];
      levels.push({ paragraph: { ...previous?.paragraph, ...paragraph, level }, character: { ...previous?.character, ...character } });
    }
    target.set(record.instance, levels);
  } catch { /* A damaged style keeps the levels of the base text type. */ }
}
/** Style of a text type at a level. Centred and partial body types build on the title and body styles. */
export function masterLevelStyle(styles: PptMasterStyles, type: number, level: number): PptLevelStyle {
  const base = type === 6 ? 0 : type === 5 || type === 7 || type === 8 ? 1 : undefined;
  const pick = (kind: number | undefined) => { const levels = kind === undefined ? undefined : styles.get(kind); return levels?.[Math.min(level, levels.length - 1)]; };
  const inherited = pick(base), own = pick(type);
  return { paragraph: { level, ...inherited?.paragraph, ...own?.paragraph }, character: { ...inherited?.character, ...own?.character } };
}

/** Characters of a text body as stored, before it is decoded: 16-bit units or single bytes. */
export function storedTextLength(records: readonly OfficeArtRecord[]): number {
  const characters = records.find(record => record.type === RT.textCharacters), narrow = records.find(record => record.type === RT.textBytes);
  return characters ? (characters.end - characters.start) >>> 1 : narrow ? narrow.end - narrow.start : 0;
}

/**
 * Reads the text records of one text body. Paragraphs end at carriage returns; the run tables
 * count one more character than the text, for the final paragraph end.
 */
export function readText(bytes: Uint8Array, records: readonly OfficeArtRecord[], styles: PptMasterStyles): PptText | undefined {
  const header = records.find(record => record.type === RT.textHeader), characters = records.find(record => record.type === RT.textCharacters), narrow = records.find(record => record.type === RT.textBytes);
  if (!header || header.end - header.start < 4) return undefined;
  const type = new ByteReader(bytes, header.start, header.end).u32();
  let text = "";
  if (characters) text = new TextDecoder("utf-16le").decode(bytes.subarray(characters.start, characters.end));
  // Byte text stores the low byte of each UTF-16 code unit.
  else if (narrow) for (let at = narrow.start; at < narrow.end; at += 8192) text += String.fromCharCode(...bytes.subarray(at, Math.min(narrow.end, at + 8192)));
  const total = text.length + 1, paragraphRuns: { count: number; style: PptParagraphStyle & { ownBullet: boolean } }[] = [], characterRuns: { count: number; style: PptCharacterStyle }[] = [];
  const properties = records.find(record => record.type === RT.styleTextProperties);
  if (properties) try {
    const reader = new ByteReader(bytes, properties.start, properties.end);
    // Runs that cover no characters are tolerated, but a table never needs more runs than the text has characters.
    let covered = 0;
    while (covered < total && paragraphRuns.length < total) { const count = reader.u32(), level = reader.u16(); paragraphRuns.push({ count, style: readParagraphException(reader, level) }); covered += count; }
    // The character runs follow the paragraph runs, so they are only found when those were read completely.
    if (covered >= total) for (covered = 0; covered < total && characterRuns.length < total && reader.remaining >= 8;) { const count = reader.u32(); characterRuns.push({ count, style: readCharacterException(reader) }); covered += count; }
  } catch { /* A truncated table leaves the remaining text with the master style. */ }
  const paragraphs: PptParagraph[] = [];
  let position = 0, paragraphIndex = 0, paragraphEnd = paragraphRuns[0]?.count ?? Infinity, characterIndex = 0, characterEnd = characterRuns[0]?.count ?? Infinity;
  for (const line of text.split("\r")) {
    while (position >= paragraphEnd && paragraphIndex + 1 < paragraphRuns.length) paragraphEnd += paragraphRuns[++paragraphIndex].count;
    const own = paragraphRuns[paragraphIndex]?.style, level = own?.level ?? 0, master = masterLevelStyle(styles, type, level);
    const paragraph: PptParagraph = { style: { ...master.paragraph, ...own, level }, runs: [], ownBullet: own?.ownBullet ?? false };
    for (let start = 0; start < line.length;) {
      while (position + start >= characterEnd && characterIndex + 1 < characterRuns.length) characterEnd += characterRuns[++characterIndex].count;
      const end = Math.min(line.length, characterEnd - position);
      paragraph.runs.push({ text: line.slice(start, end > start ? end : line.length), style: { ...master.character, ...characterRuns[characterIndex]?.style } });
      start = end > start ? end : line.length;
    }
    // An empty paragraph still has the formatting of the character run at its position.
    if (!paragraph.runs.length) {
      while (position >= characterEnd && characterIndex + 1 < characterRuns.length) characterEnd += characterRuns[++characterIndex].count;
      paragraph.runs.push({ text: "", style: { ...master.character, ...characterRuns[characterIndex]?.style } });
    }
    paragraphs.push(paragraph);
    position += line.length + 1;
  }
  return { type, paragraphs };
}

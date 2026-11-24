import { ByteReader, OFFICE_PACKAGE_LIMITS, decodeCodePage } from "../../core";
import { DOCX_BLOCK_ELEMENT_LIMIT } from "../import-docx";
import { FIB, fail, runAt, type DocFile, type DocRun } from "./doc-file";
import { DEFAULT_CHARACTER, DEFAULT_PARAGRAPH, applyCharacterSprms, applyParagraphSprms, readSection, readTableRow,
  type CharacterProperties, type DocStyle, type DocStyleSheet, type ParagraphProperties, type SectionProperties, type TableRow } from "./doc-properties";

/** The main text of a document as paragraphs, tables and sections, with all style inheritance resolved. */
export type DocTextRun = { text: string; properties: CharacterProperties };
export type DocParagraph = { kind: "paragraph"; runs: DocTextRun[]; properties: ParagraphProperties; heading: number; section?: SectionProperties };
export type DocTable = { kind: "table"; rows: { description: TableRow | undefined; cells: DocBlock[][] }[] };
export type DocBlock = DocParagraph | DocTable;
export type DocContent = { blocks: DocBlock[]; lastSection: SectionProperties; sections: number; hasHeaders: boolean };
type SourceParagraph = DocParagraph & { mark: number; rowDescription: Uint8Array };
type ResolvedStyle = { paragraph: ParagraphProperties; character: CharacterProperties; heading: number };

const PARAGRAPH_END = /[\r\u0007\u000c]/g, MAX_STYLE_DEPTH = 32;

/** Resolves paragraph and character styles along their parent chain. Loops and deep chains end at the defaults. */
function createStyleResolver({ styles, defaultFont, defaultEastAsianFont }: DocStyleSheet) {
  const cache = new Map<number, ResolvedStyle>();
  const base: CharacterProperties = { ...DEFAULT_CHARACTER, ...(defaultFont === undefined ? {} : { font: defaultFont }), ...(defaultEastAsianFont === undefined ? {} : { eastAsianFont: defaultEastAsianFont }) };
  const chain = (index: number): DocStyle[] => {
    const result: DocStyle[] = [], seen = new Set<number>();
    for (let current = index; styles[current] && !seen.has(current) && result.length < MAX_STYLE_DEPTH; current = styles[current].base) { seen.add(current); result.unshift(styles[current]); }
    return result;
  };
  function paragraph(index: number): ResolvedStyle {
    const known = cache.get(index);
    if (known) return known;
    const resolved: ResolvedStyle = { paragraph: { ...DEFAULT_PARAGRAPH }, character: { ...base }, heading: 0 };
    for (const style of chain(index)) {
      applyParagraphSprms(style.paragraph, resolved.paragraph);
      applyCharacterSprms(style.character, resolved.character, { ...resolved.character });
      // Built-in styles 1–9 are the heading levels.
      if (style.builtin >= 1 && style.builtin <= 9) resolved.heading = style.builtin;
    }
    cache.set(index, resolved);
    return resolved;
  }
  /** Applies a character style on top of the paragraph's character formatting. */
  function character(index: number, target: CharacterProperties): void {
    for (const style of chain(index)) if (style.kind === 2) applyCharacterSprms(style.character, target, { ...target });
  }
  return { paragraph, character };
}

/**
 * Splits the main text into paragraphs by their end marks and attaches the formatting that
 * applies to each run. Paragraph formatting is that of the run of offsets holding the end mark.
 */
function readParagraphs(file: DocFile, styles: DocStyleSheet, sectionEnds: ReadonlyMap<number, SectionProperties>): SourceParagraph[] {
  const resolver = createStyleResolver(styles), paragraphs: SourceParagraph[] = [], limit = file.counts.text;
  const wide = new TextDecoder("utf-16le");
  let pending: { text: string; run: DocRun | undefined }[] = [], units = 0, elements = 0;
  // Every paragraph and run becomes at least one XML element, and every paragraph that does not end a
  // table row one block element. Past what the DOCX reader accepts, nothing more is held in memory.
  const counted = (limit: number, value: number) => { if (value > limit) fail("文書の要素数が読み込み上限を超えています"); };
  const add = (text: string, run: DocRun | undefined) => { counted(OFFICE_PACKAGE_LIMITS.xmlNodes, ++units); pending.push({ text, run }); };
  const finish = (mark: number, offset: number, cp: number) => {
    const exception = runAt(file.paragraphs, offset), style = resolver.paragraph(exception?.istd ?? 0), properties = { ...style.paragraph };
    if (exception) applyParagraphSprms(exception.grpprl, properties);
    counted(OFFICE_PACKAGE_LIMITS.xmlNodes, ++units);
    if (!properties.rowEnd && !properties.innerRowEnd) counted(DOCX_BLOCK_ELEMENT_LIMIT, ++elements);
    const formatted = new Map<DocRun | undefined, CharacterProperties>();
    const runs = pending.filter(item => item.text).map(({ text, run }) => {
      let character = formatted.get(run);
      if (!character) {
        character = { ...style.character };
        if (run) {
          // A character style named by the run applies before the run's own modifiers.
          const probe = { ...character };
          applyCharacterSprms(run.grpprl, probe, style.character);
          if (probe.style !== undefined) resolver.character(probe.style, character);
          applyCharacterSprms(run.grpprl, character, { ...character });
        }
        formatted.set(run, character);
      }
      return { text, properties: character };
    });
    const heading = style.heading || (properties.outline < 9 ? properties.outline + 1 : 0);
    paragraphs.push({ kind: "paragraph", runs, properties, heading, mark, rowDescription: exception?.grpprl ?? new Uint8Array(), ...(sectionEnds.has(cp + 1) ? { section: sectionEnds.get(cp + 1) } : {}) });
    pending = [];
  };
  for (const piece of file.pieces) {
    if (piece.cpStart >= limit) break;
    const length = Math.min(piece.cpEnd, limit) - piece.cpStart, width = piece.compressed ? 1 : 2;
    const bytes = file.main.subarray(piece.offset, piece.offset + length * width), text = piece.compressed ? decodeCodePage(bytes, 1252) : wide.decode(bytes);
    for (let index = 0; index < length;) {
      const offset = piece.offset + index * width, run = runAt(file.characters, offset);
      // A formatting run covers a range of file offsets; convert its end back to a character index.
      let end = run ? Math.min(length, index + Math.ceil((run.end - offset) / width)) : index + 1;
      if (!run) while (end < length && !runAt(file.characters, piece.offset + end * width)) end++;
      PARAGRAPH_END.lastIndex = index;
      const match = PARAGRAPH_END.exec(text), stop = match && match.index < end ? match.index : -1;
      if (stop < 0) { add(text.slice(index, end), run); index = end; continue; }
      const mark = text.charCodeAt(stop), cp = piece.cpStart + stop;
      // A form feed ends a paragraph only where a section ends; elsewhere it is a page break inside one.
      if (mark === 0x0c && !sectionEnds.has(cp + 1)) { add(text.slice(index, stop + 1), run); index = stop + 1; continue; }
      add(text.slice(index, stop), run);
      finish(mark, piece.offset + stop * width, cp);
      index = stop + 1;
    }
  }
  if (pending.some(item => item.text)) finish(0x0d, -1, limit);
  return paragraphs;
}

/** Folds consecutive table paragraphs into rows and cells; a deeper nesting level becomes a nested table. */
function buildBlocks(paragraphs: readonly SourceParagraph[], depth: number): DocBlock[] {
  const blocks: DocBlock[] = [];
  for (let index = 0; index < paragraphs.length;) {
    if (paragraphs[index].properties.depth <= depth) { blocks.push(paragraphs[index++]); continue; }
    let end = index;
    while (end < paragraphs.length && paragraphs[end].properties.depth > depth) end++;
    const level = depth + 1, table: DocTable = { kind: "table", rows: [] };
    let cells: DocBlock[][] = [], cell: SourceParagraph[] = [];
    for (const paragraph of paragraphs.slice(index, end)) {
      const own = paragraph.properties.depth === level;
      const rowEnd = own && (level === 1 ? paragraph.mark === 0x07 && paragraph.properties.rowEnd : paragraph.properties.innerRowEnd);
      const cellEnd = own && !rowEnd && (level === 1 ? paragraph.mark === 0x07 : paragraph.properties.innerCellEnd);
      if (rowEnd) { table.rows.push({ description: readTableRow(paragraph.rowDescription), cells }); cells = []; cell = []; continue; }
      cell.push(paragraph);
      if (cellEnd) { cells.push(buildBlocks(cell, level)); cell = []; }
    }
    // Text after the last complete row (a damaged table) is kept as ordinary paragraphs.
    const loose = [...cells.flat(), ...buildBlocks(cell, level)];
    if (table.rows.length) blocks.push(table);
    blocks.push(...loose);
    index = end;
  }
  return blocks;
}

/** Section ends by character position, read from the section table and its property lists. */
function readSections(file: DocFile): { ends: Map<number, SectionProperties>; last: SectionProperties } {
  const { offset, length } = file.pair(FIB.sections), ends = new Map<number, SectionProperties>(), count = Math.floor((length - 4) / 16);
  let last = readSection(new Uint8Array());
  try {
    const positions = new ByteReader(file.table, offset, offset + (count + 1) * 4), descriptors = new ByteReader(file.table, offset + (count + 1) * 4, offset + length);
    positions.skip(4);
    for (let index = 0; index < count; index++) {
      const end = positions.u32();
      descriptors.skip(2);
      const location = descriptors.i32();
      descriptors.skip(6);
      let section = readSection(new Uint8Array());
      if (location >= 0 && location + 2 <= file.main.length) {
        const reader = new ByteReader(file.main, location);
        section = readSection(reader.take(Math.min(reader.u16(), reader.remaining)));
      }
      if (index < count - 1) ends.set(end, section); else last = section;
    }
  } catch { /* A damaged section table leaves a single default page setup. */ }
  return { ends, last };
}

export function readDocContent(file: DocFile, styles: DocStyleSheet): DocContent {
  const sections = readSections(file), paragraphs = readParagraphs(file, styles, sections.ends);
  // Header and footer stories follow six separator stories; any text there means the document has them.
  const headers = file.pair(FIB.headers);
  let hasHeaders = false;
  try {
    const reader = new ByteReader(file.table, headers.offset, headers.offset + headers.length), positions = Array.from({ length: Math.floor(headers.length / 4) }, () => reader.u32());
    hasHeaders = positions.some((position, index) => index >= 6 && index + 1 < positions.length && positions[index + 1] > position);
  } catch { /* No readable header table: treated as no headers. */ }
  return { blocks: buildBlocks(paragraphs, 0), lastSection: sections.last, sections: sections.ends.size + 1, hasHeaders };
}

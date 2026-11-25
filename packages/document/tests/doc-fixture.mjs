// Test-only writer for Word 97–2003 documents ([MS-DOC]). It lays out the minimum a reader
// needs: FIB, text, piece table, formatting pages, and the optional tables a case asks for.
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';
import { artContainer, artRecord, blipEntry, groupBounds, shapeHeader, SHAPE } from '../../core/tests/office-art-fixture.mjs';

export const u8 = value => [value & 255];
export const u16 = value => [value & 255, (value >>> 8) & 255];
export const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const utf16 = text => [...text].flatMap(character => u16(character.charCodeAt(0)));
const flat = parts => parts.flatMap(part => typeof part === 'number' ? [part] : [...part]);

/** A property modifier: its code and operand bytes. */
export const sprm = (code, ...operand) => [...u16(code), ...flat(operand)];
export const S = Object.freeze({
  bold: (value = 1) => sprm(0x0835, value), italic: (value = 1) => sprm(0x0836, value), strike: (value = 1) => sprm(0x0837, value), vanish: (value = 1) => sprm(0x083c, value),
  underline: (kind = 1) => sprm(0x2a3e, kind), size: halfPoints => sprm(0x4a43, u16(halfPoints)), colorIndex: index => sprm(0x2a42, index),
  color: (red, green, blue, auto = 0) => sprm(0x6870, red, green, blue, auto), highlight: index => sprm(0x2a0c, index), font: index => sprm(0x4a4f, u16(index)),
  eastAsianFont: index => sprm(0x4a50, u16(index)), characterStyle: index => sprm(0x4a30, u16(index)), position: value => sprm(0x2a48, value),
  special: (value = 1) => sprm(0x0855, value), pictureOffset: offset => sprm(0x6a03, u32(offset)), deleted: (value = 1) => sprm(0x0800, value), inserted: (value = 1) => sprm(0x0801, value),
  shade: (fore, back, pattern) => sprm(0xca71, 10, fore, back, u16(pattern)), symbol: () => sprm(0x6a09, u16(0), u16(0xf0b7)), embedded: () => sprm(0x0856, 1),
  align: value => sprm(0x2461, value), pageBreakBefore: (value = 1) => sprm(0x2407, value), list: (index, level = 0) => [...sprm(0x460b, u16(index)), ...sprm(0x260a, level)],
  outline: level => sprm(0x2640, level), inTable: (value = 1) => sprm(0x2416, value), rowEnd: () => sprm(0x2417, 1), depth: value => sprm(0x6649, u32(value)),
  innerCellEnd: () => sprm(0x244b, 1), innerRowEnd: () => sprm(0x244c, 1), tableHeader: () => sprm(0x3404, 1),
  pageWidth: twips => sprm(0xb01f, u16(twips)), pageHeight: twips => sprm(0xb020, u16(twips)), marginLeft: twips => sprm(0xb021, u16(twips)), marginRight: twips => sprm(0xb022, u16(twips)),
  marginTop: twips => sprm(0x9023, u16(twips)), marginBottom: twips => sprm(0x9024, u16(twips)), sectionStart: kind => sprm(0x3009, kind), columns: count => sprm(0x500b, u16(count - 1)),
});
/** Row definition: cell edges in twips and, per cell, merge flags and four borders. */
export function tableDefinition(edges, cells = []) {
  const count = edges.length - 1;
  const cell = ({ flags = 0, border = [4, 1, 0, 0] } = {}) => [...u16(flags), ...u16(0), ...border, ...border, ...border, ...border];
  const body = [count, ...edges.flatMap(u16), ...Array.from({ length: count }, (_, index) => cell(cells[index])).flat()];
  return sprm(0xd608, u16(body.length + 1), body);
}
export const CELL = Object.freeze({ firstMerged: 0x01, merged: 0x02, verticalRestart: 0x60, verticalContinue: 0x20 });
export const cellShades = (...colors) => sprm(0xd612, colors.length * 10, ...colors.map(color => color ? [0xff, 0, 0, 0xff, ...color, 0, ...u16(0)] : [0xff, 0, 0, 0xff, 0xff, 0, 0, 0xff, ...u16(0)]));

/** Packs formatting runs into 512-byte pages; returns the pages and the bin table that lists them. */
function formattingPages(runs, paragraph, firstPage) {
  const pages = [], bins = [];
  let current = [];
  const entrySize = run => { const body = paragraph ? 2 + run.grpprl.length : run.grpprl.length; return (paragraph ? 13 : 1) + 4 + (body ? body + 2 + (body & 1) : 0); };
  const close = () => {
    if (!current.length) return;
    const page = new Uint8Array(512), view = new DataView(page.buffer), count = current.length, offsets = (count + 1) * 4;
    let end = 510;
    current.forEach((run, index) => {
      view.setUint32(index * 4, run.start, true);
      const body = paragraph ? [...u16(run.istd ?? 0), ...run.grpprl] : [...run.grpprl];
      if (!body.length) return;
      // Paragraph entries state their size in words; an even size needs the two-byte form.
      const header = !paragraph ? [body.length] : body.length & 1 ? [(body.length + 1) / 2] : [0, body.length / 2];
      const size = header.length + body.length, at = (end - size) & ~1;
      page.set([...header, ...body], at); end = at;
      page[offsets + index * (paragraph ? 13 : 1)] = at / 2;
    });
    view.setUint32(count * 4, current.at(-1).end, true);
    page[511] = count;
    bins.push({ first: current[0].start, page: firstPage + pages.length });
    pages.push(page); current = [];
  };
  let used = 4 + 1;
  for (const run of runs) {
    if (used + entrySize(run) > 500) { close(); used = 5; }
    current.push(run); used += entrySize(run);
  }
  close();
  const table = [...bins.flatMap(bin => u32(bin.first)), ...u32(runs.at(-1)?.end ?? 0), ...bins.flatMap(bin => u32(bin.page))];
  return { pages, table: runs.length ? table : [] };
}

/**
 * @param {object} document
 * @param {{ runs?: { text: string, sprms?: number[] }[], text?: string, sprms?: number[], style?: number, mark?: string, markSprms?: number[] }[]} document.paragraphs
 * @param {{ builtin?: number, kind?: number, base?: number, name: string, paragraph?: number[], character?: number[] }[]} [document.styles]
 * @param {string[]} [document.fonts]
 * @param {{ id: number, levels: { start?: number, format: number, text: string }[] }[]} [document.lists]
 * @param {number[]} [document.listOverrides] list ids, in the order paragraphs index them (one-based)
 * @param {{ sprms?: number[] }[]} [document.sections] one per section; a paragraph mark of '\f' ends a section
 * @param {number[]} [document.headerPositions] character positions of the header stories
 * @param {Uint8Array} [document.data] the Data stream (pictures)
 * @param {object} [document.floating] drawing-layer content: shapes anchored at the 0x08 characters of the text
 * @param {{ cp: number, spid: number, bounds: number[], flags?: number }[]} document.floating.anchors bounds are left, top, right, bottom in twips
 * @param {Uint8Array[]} [document.floating.blips] pictures of the store, kept in the main stream unless `embedded`
 * @param {{ header?: boolean, shapes: Uint8Array[] }[]} [document.floating.drawings] shape (or group) containers per drawing
 * @param {{ spid: number, text: string }[]} [document.floating.textboxes] text of the shapes that hold text
 */
export function docStreams({ paragraphs, styles, fonts = ['Times New Roman'], lists = [], listOverrides = [], sections = [{}], headerPositions, data, compressed = false,
  version = 0x00c1, encrypted = false, extraText = '', floating }) {
  const TEXT = 0x600, width = compressed ? 1 : 2, characters = [], paragraphRuns = [], sectionEnds = [];
  let text = '';
  for (const paragraph of paragraphs) {
    const start = text.length, runs = paragraph.runs ?? [{ text: paragraph.text ?? '', sprms: [] }];
    for (const run of runs) {
      if (run.text) characters.push({ start: TEXT + text.length * width, end: TEXT + (text.length + run.text.length) * width, grpprl: run.sprms ?? [] });
      text += run.text;
    }
    const mark = paragraph.mark ?? '\r';
    characters.push({ start: TEXT + text.length * width, end: TEXT + (text.length + 1) * width, grpprl: paragraph.markSprms ?? [] });
    text += mark;
    paragraphRuns.push({ start: TEXT + start * width, end: TEXT + text.length * width, grpprl: paragraph.sprms ?? [], istd: paragraph.style ?? 0 });
    if (mark === '\f') sectionEnds.push(text.length);
  }
  const mainTextLength = text.length;
  text += extraText;
  // The textbox document follows the other parts; each text ends with a paragraph mark, and a spare entry closes the list.
  const textboxes = floating?.textboxes ?? [], textboxPositions = [0];
  for (const item of textboxes) { text += `${item.text}\r`; textboxPositions.push(textboxPositions.at(-1) + item.text.length + 1); }
  if (textboxes.length) { text += '\r'; textboxPositions.push(textboxPositions.at(-1) + 1); }
  const textBytes = compressed ? [...text].map(character => character.charCodeAt(0) & 255) : utf16(text);
  const firstPage = Math.ceil((TEXT + textBytes.length) / 512);
  const characterPages = formattingPages(characters, false, firstPage), paragraphPages = formattingPages(paragraphRuns, true, firstPage + characterPages.pages.length);
  const pagesEnd = (firstPage + characterPages.pages.length + paragraphPages.pages.length) * 512;
  // Section property lists live in the main stream, after the formatting pages.
  let cursor = pagesEnd;
  const sectionBytes = [], sectionOffsets = sections.map(section => { const grpprl = section.sprms ?? []; if (!grpprl.length) return -1; const at = cursor; sectionBytes.push(...u16(grpprl.length), ...grpprl); cursor += 2 + grpprl.length; return at; });
  // Pictures of the drawing layer are kept in this stream; their store entries point here.
  const blipOffsets = floating?.embedded ? [] : (floating?.blips ?? []).map(blip => { const at = cursor; cursor += blip.length; return at; });
  const main = new Uint8Array(cursor), mainView = new DataView(main.buffer);
  main.set(textBytes, TEXT);
  [...characterPages.pages, ...paragraphPages.pages].forEach((page, index) => main.set(page, (firstPage + index) * 512));
  main.set(sectionBytes, pagesEnd);
  blipOffsets.forEach((at, index) => main.set(floating.blips[index], at));

  const table = [], pairs = new Map(), add = (index, bytes) => { if (bytes.length) pairs.set(index, [table.length, bytes.length]); table.push(...bytes); };
  const xstz = name => [...u16(name.length), ...utf16(name), 0, 0];
  if (styles) {
    const header = [...u16(styles.length), ...u16(10), ...u16(1), ...u16(0), ...u16(15), ...u16(0), ...u16(0), ...u16(0), ...u16(0)];
    const entries = styles.flatMap(style => {
      if (!style) return u16(0);
      const kind = style.kind ?? 1, sets = kind === 1 ? [[...u16(0), ...(style.paragraph ?? [])], style.character ?? []] : [style.character ?? []];
      const body = [...u16(style.builtin ?? 0xffe), ...u16(kind | (style.base ?? 0xfff) << 4), ...u16(sets.length | 0 << 4), ...u16(0), ...u16(0), ...xstz(style.name)];
      for (const set of sets) { if (body.length & 1) body.push(0); body.push(...u16(set.length), ...set); }
      return [...u16(body.length), ...body];
    });
    add(1, [...u16(header.length), ...header, ...entries]);
  }
  const sectionCount = sections.length, sectionPositions = [0, ...sectionEnds.slice(0, sectionCount - 1), mainTextLength];
  add(6, [...sectionPositions.flatMap(u32), ...sectionOffsets.flatMap(offset => [...u16(0), ...u32(offset), ...u16(0), ...u32(0xffffffff)])]);
  if (headerPositions) add(11, headerPositions.flatMap(u32));
  add(12, characterPages.table); add(13, paragraphPages.table);
  add(15, [...u16(fonts.length), ...u16(0), ...fonts.flatMap(name => { const body = [0x24, ...u16(400), 0, 0, ...new Array(34).fill(0), ...utf16(name), 0, 0]; return [body.length, ...body]; })]);
  // One uncompressed (or compressed) piece covering all text.
  add(33, [2, ...u32(4 * 2 + 8), ...u32(0), ...u32(text.length), ...u16(0), ...u32(compressed ? TEXT * 2 | 0x40000000 : TEXT), ...u16(0)]);
  if (lists.length) {
    const headers = lists.flatMap(list => [...u32(list.id), ...u32(0), ...new Array(18).fill(0), list.levels.length === 1 ? 1 : 0, 0]);
    const levels = lists.flatMap(list => list.levels.flatMap(level => [...u32(level.start ?? 1), level.format, 0, ...new Array(9).fill(0), 0, ...u32(0), ...u32(0), 0, 0, 0, 0, ...u16(level.text.length), ...utf16(level.text)]));
    add(73, [...u16(lists.length), ...headers, ...levels]);
    add(74, [...u32(listOverrides.length), ...listOverrides.flatMap(id => [...u32(id), ...u32(0), ...u32(0), 0, 0, 0, 0])]);
  }
  if (floating) {
    const anchors = floating.anchors ?? [];
    add(40, floating.anchorTable ?? [...anchors.flatMap(anchor => u32(anchor.cp)), ...u32(mainTextLength),
      ...anchors.flatMap(anchor => [...u32(anchor.spid), ...anchor.bounds.flatMap(u32), ...u16(anchor.flags ?? 0), ...u32(0)])]);
    const entries = (floating.blips ?? []).map((blip, index) => floating.embedded ? blipEntry({ embedded: blip }) : blipEntry({ size: blip.length, delayOffset: blipOffsets[index] }));
    const group = artContainer(0xf000, artRecord(0, 0, 0xf006, u32(2048), u32(2), u32(1), u32(1)), ...(entries.length ? [artContainer(0xf001, ...entries)] : []));
    const drawings = (floating.drawings ?? []).flatMap((drawing, index) => [drawing.header ? 1 : 0, ...artContainer(0xf002, artRecord(0, index + 1, 0xf008, u32(drawing.shapes.length + 1), u32(1024 * (index + 1))),
      artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 0, 0), shapeHeader(1024 * (index + 1), 0, SHAPE.group | SHAPE.patriarch)), ...drawing.shapes))]);
    add(50, floating.drawingData ?? [...group, ...drawings]);
    if (textboxes.length) add(56, [...textboxPositions.flatMap(u32),
      ...[...textboxes, undefined].flatMap(item => [...u32(1), ...u32(0), ...u16(item ? 0 : 1), ...u32(0), ...u32(item?.spid ?? 0), ...u32(0)])]);
  }
  main.set([0xec, 0xa5, ...u16(version), 0, 0, ...u16(0x0411), 0, 0, ...u16(0x0200 | (encrypted ? 0x0100 : 0))], 0);
  mainView.setUint16(32, 14, true); mainView.setUint16(62, 22, true); mainView.setUint16(152, 93, true);
  mainView.setInt32(64, main.length, true); mainView.setInt32(64 + 3 * 4, mainTextLength, true);
  if (headerPositions) mainView.setInt32(64 + 5 * 4, extraText.length, true);
  if (textboxes.length) mainView.setInt32(64 + 9 * 4, textboxPositions.at(-1), true);
  for (const [index, [offset, length]] of pairs) { mainView.setUint32(154 + index * 8, offset, true); mainView.setUint32(158 + index * 8, length, true); }
  return { main, table: Uint8Array.from(table), data };
}
/** A complete .doc file. */
export function doc(document, { extraStreams = [], tableName = '1Table' } = {}) {
  const { main, table, data } = docStreams(document);
  return createCompoundFile([{ path: 'WordDocument', content: main }, { path: tableName, content: table }, ...(data ? [{ path: 'Data', content: data }] : []), ...extraStreams]);
}
/** Inline picture header followed by the drawing records that hold the image. */
export function pictureData(records, { width = 1440, height = 720, scaleX = 1000, scaleY = 1000 } = {}) {
  const header = new Uint8Array(68), view = new DataView(header.buffer), body = flat(records);
  view.setInt32(0, 68 + body.length, true); view.setUint16(4, 68, true); view.setInt16(6, 0x64, true);
  view.setInt16(28, width, true); view.setInt16(30, height, true); view.setUint16(32, scaleX, true); view.setUint16(34, scaleY, true);
  return Uint8Array.from([...header, ...body]);
}

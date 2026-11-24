// Test-only writer for PowerPoint 97–2003 presentations ([MS-PPT]). Records use the same header
// as Office drawing records, so the drawing fixture helpers are reused for both.
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';
import { artRecord, artContainer, shapeHeader, artProperties, groupBounds, SHAPE, blip } from '../../core/tests/office-art-fixture.mjs';

export { SHAPE, artRecord, artContainer };
export const u16 = value => [value & 255, (value >>> 8) & 255];
export const u32 = value => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
const utf16 = text => [...text].flatMap(character => u16(character.charCodeAt(0)));
const join = (...parts) => Uint8Array.from(parts.flatMap(part => typeof part === 'number' ? [part] : [...part]));
const atom = (type, payload, instance = 0, version = 0) => artRecord(version, instance, type, payload);
const container = (type, children, instance = 0) => artRecord(15, instance, type, ...children);
export const T = Object.freeze({ document: 0x03e8, documentAtom: 0x03e9, slide: 0x03ee, slideAtom: 0x03ef, notes: 0x03f0, notesAtom: 0x03f1, environment: 0x03f2, slidePersist: 0x03f3,
  mainMaster: 0x03f8, slideShowInfo: 0x03f9, drawingGroup: 0x040b, drawing: 0x040c, colorScheme: 0x07f0, fontCollection: 0x07d5, placeholder: 0x0bc3, outlineTextReference: 0x0f9e,
  textHeader: 0x0f9f, textCharacters: 0x0fa0, styleTextProperties: 0x0fa1, textMasterStyle: 0x0fa3, textBytes: 0x0fa8, fontEntity: 0x0fb7, slideList: 0x0ff0, userEdit: 0x0ff5,
  currentUser: 0x0ff6, animationInfo: 0x1014, programTags: 0x1388, persistDirectory: 0x1772 });

/** Paragraph exception: mask, then the fields the mask announces. */
export function paragraphException({ align, bullet, spaceBefore } = {}) {
  const mask = (bullet === undefined ? 0 : 0x01) | (align === undefined ? 0 : 0x800) | (spaceBefore === undefined ? 0 : 0x2000);
  return [...u32(mask), ...(bullet === undefined ? [] : u16(bullet ? 1 : 0)), ...(align === undefined ? [] : u16(align)), ...(spaceBefore === undefined ? [] : u16(spaceBefore))];
}
/** Character exception: mask, style bits, font reference, size and colour. */
export function characterException({ bold, italic, underline, font, size, color } = {}) {
  const styleMask = (bold === undefined ? 0 : 1) | (italic === undefined ? 0 : 2) | (underline === undefined ? 0 : 4);
  const mask = styleMask | (font === undefined ? 0 : 0x10000) | (size === undefined ? 0 : 0x20000) | (color === undefined ? 0 : 0x40000);
  return [...u32(mask), ...(styleMask ? u16((bold ? 1 : 0) | (italic ? 2 : 0) | (underline ? 4 : 0)) : []), ...(font === undefined ? [] : u16(font)), ...(size === undefined ? [] : u16(size)), ...(color === undefined ? [] : color)];
}
/** Colour of a text run: RGB (index byte 0xFE) or a scheme index. */
export const rgb = (red, green, blue) => [red, green, blue, 0xfe];
export const schemeColor = index => [0, 0, 0, index];
export const textHeader = type => atom(T.textHeader, u32(type));
export const textCharacters = text => atom(T.textCharacters, utf16(text));
export const textBytes = text => atom(T.textBytes, [...text].map(character => character.charCodeAt(0) & 255));
/** Run tables: paragraph runs [count, level, exception], then character runs [count, exception]. */
export const styleText = (paragraphs, characters) => atom(T.styleTextProperties, [...paragraphs.flatMap(([count, level, exception]) => [...u32(count), ...u16(level), ...paragraphException(exception)]),
  ...characters.flatMap(([count, exception]) => [...u32(count), ...characterException(exception)])]);
/** Text records of one body, with a single style for all of it unless runs are given. */
export function textRecords(type, text, { paragraphs, characters, bytes = false } = {}) {
  return [textHeader(type), bytes ? textBytes(text) : textCharacters(text), styleText(paragraphs ?? [[text.length + 1, 0, {}]], characters ?? [[text.length + 1, {}]])];
}
export const masterStyle = (type, levels) => atom(T.textMasterStyle, [...u16(levels.length), ...levels.flatMap((level, index) => [...(type >= 5 ? u16(index) : []), ...paragraphException(level.paragraph), ...characterException(level.character)])], type);

/** Position of a shape: top, left, right, bottom in master units (1/576 inch). */
const clientAnchor = (top, left, right, bottom) => atom(0xf010, [...u16(top), ...u16(left), ...u16(right), ...u16(bottom)]);
/**
 * One shape container.
 * @param {{ id: number, type?: number, flags?: number, anchor?: number[], properties?: any[], placeholder?: number, text?: Uint8Array[], outline?: number, data?: Uint8Array[], external?: boolean }} shape
 */
export function shape({ id, type = 1, flags = SHAPE.hasAnchor | SHAPE.hasType, anchor = [0, 0, 100, 100], properties = [], placeholder, text, outline, data = [], external = false, wideAnchor = false }) {
  const client = [...(placeholder === undefined ? [] : [atom(T.placeholder, [...u32(0), placeholder, 0, 0, 0])]), ...(external ? [atom(0x0bc1, u32(1))] : []), ...data];
  const textbox = outline !== undefined ? [atom(T.outlineTextReference, u32(outline))] : text;
  return artContainer(0xf004, shapeHeader(id, type, flags), ...(properties.length ? [artProperties(properties)] : []),
    wideAnchor ? atom(0xf010, [...u32(anchor[0]), ...u32(anchor[1]), ...u32(anchor[2]), ...u32(anchor[3])]) : clientAnchor(...anchor),
    ...(client.length ? [container(0xf011, client)] : []), ...(textbox ? [container(0xf00d, textbox)] : []));
}
/** A group: its own shape first, then its members. */
export const group = (id, members, flags = SHAPE.group | SHAPE.hasAnchor) => artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 1000, 1000), shapeHeader(id, 0, flags), clientAnchor(0, 0, 500, 500)), ...members);
const drawing = (shapes, { background, rules = [] } = {}) => container(T.drawing, [artContainer(0xf002, atom(0xf008, [...u32(shapes.length + 1), ...u32(1)], 1),
  artContainer(0xf003, artContainer(0xf004, groupBounds(0, 0, 0, 0), shapeHeader(1, 0, SHAPE.group | SHAPE.patriarch)), ...shapes),
  ...(background ? [artContainer(0xf004, shapeHeader(2, 1, SHAPE.background | SHAPE.hasType), artProperties(background))] : []),
  ...(rules.length ? [artContainer(0xf005, ...rules.map(([connector, start, end, startSite = 0, endSite = 0], index) => atom(0xf012, [...u32(index + 1), ...u32(start), ...u32(end), ...u32(connector), ...u32(startSite), ...u32(endSite)])))] : []))]);
const slideAtom = ({ masterId = 0, notesId = 0, flags = 7 }) => atom(T.slideAtom, [...u32(0), ...new Array(8).fill(0), ...u32(masterId), ...u32(notesId), ...u16(flags), ...u16(0)], 0, 2);
const colorScheme = colors => atom(T.colorScheme, colors.flatMap(color => [...color, 0]), 1);
export const DEFAULT_SCHEME = [[255, 255, 255], [0, 0, 0], [128, 128, 128], [0, 0, 128], [187, 224, 227], [51, 51, 153], [0, 153, 153], [153, 204, 0]];
/** Timing data as PowerPoint 2002 and later store it: a tagged blob holding time-node records. */
export const animationTags = () => container(T.programTags, [container(0x138a, [atom(0x0fba, utf16('___PPT10')), container(0x138b, [container(0xf144, [container(0xf144, [container(0xf12d, [atom(0xf133, new Array(8).fill(0))])])])])])]);

/**
 * Assembles the document stream: every top-level object becomes a persist object, and the
 * user edit with its persist directory is written last.
 */
export function pptStreams({ size = [5760, 4320], fonts = ['Arial'], documentStyles = [], images = [], drawingDefaults = [], masters = [], slides = [], notes = [],
  encrypted = false, macros = false, staleEdit = false }) {
  const objects = [], offsets = [];
  const add = bytes => { objects.push(bytes); return objects.length; };
  const pictures = [], pictureOffsets = images.map(image => { const at = pictures.length; pictures.push(...blip(image.type === 'png' ? 0xf01e : image.type === 'jpeg' ? 0xf01d : 0xf01a, image.type === 'png' ? 0x6e0 : image.type === 'jpeg' ? 0x46a : 0x3d4, image.data)); return at; });
  const sheet = (item, kind) => {
    const body = [kind === T.notes ? atom(T.notesAtom, [...u32(item.slideId ?? 0), ...u16(0), ...u16(0)], 0, 1) : slideAtom(item), ...(item.scheme ? [colorScheme(item.scheme)] : []), ...(item.styles ?? []),
      ...(item.hidden || item.transition ? [atom(T.slideShowInfo, [...u32(0), ...u32(0), 0, item.transition ? 5 : 0, ...u16(item.hidden ? 4 : 0), 0, 0, 0, 0])] : []),
      drawing(item.shapes ?? [], item), ...(item.animation ? [animationTags()] : [])];
    return add(container(kind, body));
  };
  const masterEntries = masters.map(master => ({ item: master, persist: sheet(master, master.kind === 'title' ? T.slide : T.mainMaster) }));
  const slideEntries = slides.map(slide => ({ item: slide, persist: sheet(slide, T.slide) }));
  const noteEntries = notes.map(note => ({ item: note, persist: sheet(note, T.notes) }));
  const list = (entries, instance) => container(T.slideList, entries.flatMap(({ item, persist }) => [atom(T.slidePersist, [...u32(persist), ...u32(0), ...u32(item.texts?.length ?? 0), ...u32(item.id), ...u32(0)]), ...(item.texts ?? []).flat()]), instance);
  const fontEntity = (name, index) => atom(T.fontEntity, [...utf16(name), ...new Array(64 - name.length * 2).fill(0), 0, 0, 0, 0], index);
  const blipEntry = (offset, length) => { const header = new Array(36).fill(0); header.splice(20, 4, ...u32(length)); header.splice(24, 4, ...u32(1)); header.splice(28, 4, ...u32(offset)); return artRecord(2, 6, 0xf007, header); };
  const drawingGroup = container(T.drawingGroup, [artContainer(0xf000, atom(0xf006, new Array(16).fill(0)),
    ...(images.length ? [artContainer(0xf001, ...images.map((image, index) => blipEntry(pictureOffsets[index], image.data.length + 25)))] : []),
    ...(drawingDefaults.length ? [artProperties(drawingDefaults)] : []))]);
  const documentBody = [atom(T.documentAtom, [...u32(size[0]), ...u32(size[1]), ...u32(size[1]), ...u32(size[0]), ...u32(1), ...u32(1), ...u32(0), ...u32(0), ...u16(1), ...u16(0), 0, 0, 0, 0], 0, 1),
    container(T.environment, [container(T.fontCollection, fonts.map(fontEntity)), ...documentStyles]), drawingGroup,
    ...(macros ? [container(0x07d0, [container(0x03ff, [atom(0x0400, new Array(12).fill(0))])])] : []),
    ...(masterEntries.length ? [list(masterEntries, 1)] : []), ...(slideEntries.length ? [list(slideEntries, 0)] : []), ...(noteEntries.length ? [list(noteEntries, 2)] : []), atom(0x03ea, [])];
  const documentPersist = add(container(T.document, documentBody));
  const chunks = [];
  let length = 0;
  for (const object of objects) { offsets.push(length); chunks.push(object); length += object.length; }
  const directory = (first, values) => atom(T.persistDirectory, [...u32(first | values.length << 20), ...values.flatMap(u32)]);
  const edit = (previous, directoryOffset) => atom(T.userEdit, [...u32(256), ...u16(0), 0, 3, ...u32(previous), ...u32(directoryOffset), ...u32(documentPersist), ...u32(objects.length + 1), ...u16(1), ...u16(0), ...(encrypted ? u32(99) : [])]);
  let previous = 0;
  if (staleEdit) {
    // An earlier save whose objects are superseded: its directory points every id at a dummy record.
    const stale = atom(0x03ea, []), staleOffset = length; chunks.push(stale); length += stale.length;
    const staleDirectory = directory(1, offsets.map(() => staleOffset)), staleDirectoryOffset = length; chunks.push(staleDirectory); length += staleDirectory.length;
    const staleEditRecord = edit(0, staleDirectoryOffset); previous = length; chunks.push(staleEditRecord); length += staleEditRecord.length;
  }
  const liveDirectory = directory(1, offsets), directoryOffset = length; chunks.push(liveDirectory); length += liveDirectory.length;
  const editOffset = length; chunks.push(edit(previous, directoryOffset));
  const currentUser = atom(T.currentUser, [...u32(0x14), ...u32(encrypted ? 0xf3d1c4df : 0xe391c05f), ...u32(editOffset), ...u16(0), ...u16(0x03f4), 3, 0, ...u16(0), ...u32(8)]);
  return { document: join(...chunks), currentUser, pictures: Uint8Array.from(pictures) };
}
/** A complete .ppt file. */
export function ppt(presentation, { extraStreams = [] } = {}) {
  const { document, currentUser, pictures } = pptStreams(presentation);
  return createCompoundFile([{ path: 'PowerPoint Document', content: document }, { path: 'Current User', content: currentUser }, ...(pictures.length ? [{ path: 'Pictures', content: pictures }] : []), ...extraStreams]);
}

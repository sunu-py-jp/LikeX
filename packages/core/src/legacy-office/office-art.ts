import { ByteReader } from "./bytes";

/**
 * Office drawing records ([MS-ODRAW]) shared by the 97–2003 spreadsheet, document and presentation
 * formats: record framing, embedded pictures and the shape tree with its property table.
 * Host-specific payloads (anchors, client data, text) are returned as ranges for the caller.
 */
export type OfficeArtRecord = { version: number; instance: number; type: number; start: number; end: number };
export type OfficeArtImage = { format: "png" | "jpeg" | "dib" | "emf" | "wmf" | "pict" | "tiff"; data: Uint8Array };
export type OfficeArtProperty = { value: number; data?: Uint8Array };
export type OfficeArtBounds = { left: number; top: number; right: number; bottom: number };
export type OfficeArtShape = {
  id: number; shapeType: number; group: boolean; child: boolean; patriarch: boolean; deleted: boolean;
  flipHorizontal: boolean; flipVertical: boolean; connector: boolean; background: boolean;
  properties: Map<number, OfficeArtProperty>;
  clientAnchor?: OfficeArtRecord; clientData?: OfficeArtRecord; clientTextbox?: OfficeArtRecord;
  /** Position inside the parent group's coordinate system. */
  childAnchor?: OfficeArtBounds;
  /** Coordinate system of a group, in which its children are placed. */
  groupBounds?: OfficeArtBounds;
  children: OfficeArtShape[];
};
export type OfficeArtColor = { rgb?: string; scheme?: number; system?: number };

export const OFFICE_ART = Object.freeze({ drawingGroup: 0xf000, blipStore: 0xf001, drawing: 0xf002, group: 0xf003, shape: 0xf004, blipEntry: 0xf007,
  groupBounds: 0xf009, shapeHeader: 0xf00a, properties: 0xf00b, clientTextbox: 0xf00d, childAnchor: 0xf00f, clientAnchor: 0xf010, clientData: 0xf011 });
/** Property identifiers used by the importers. */
export const OFFICE_ART_PROPERTY = Object.freeze({ rotation: 0x0004, textLeft: 0x0081, textTop: 0x0082, textRight: 0x0083, textBottom: 0x0084, textAnchor: 0x0087,
  cropTop: 0x0100, cropBottom: 0x0101, cropLeft: 0x0102, cropRight: 0x0103, picture: 0x0104, adjust: 0x0147, fillType: 0x0180, fillColor: 0x0181, fillOpacity: 0x0182,
  fillFlags: 0x01bf, lineColor: 0x01c0, lineWidth: 0x01cb, lineDash: 0x01ce, lineStart: 0x01d0, lineEnd: 0x01d1, lineFlags: 0x01ff, name: 0x0380, description: 0x0381, groupFlags: 0x03bf });
const MAX_RECORDS = 200_000, MAX_DEPTH = 32;
const IMAGE_FORMATS: Readonly<Record<number, OfficeArtImage["format"]>> = { 0xf01a: "emf", 0xf01b: "wmf", 0xf01c: "pict", 0xf01d: "jpeg", 0xf02a: "jpeg", 0xf01e: "png", 0xf01f: "dib", 0xf029: "tiff" };
/** Shape types that have a DrawingML preset of the same outline. Unlisted types have no direct equivalent. */
const PRESETS: Readonly<Record<number, string>> = { 1: "rect", 2: "roundRect", 3: "ellipse", 4: "diamond", 5: "triangle", 6: "rtTriangle", 7: "parallelogram", 8: "trapezoid", 9: "hexagon",
  10: "octagon", 11: "plus", 12: "star5", 13: "rightArrow", 15: "homePlate", 16: "cube", 19: "arc", 20: "line", 21: "plaque", 22: "can", 23: "donut", 32: "straightConnector1", 33: "bentConnector2",
  34: "bentConnector3", 35: "bentConnector4", 36: "bentConnector5", 37: "curvedConnector2", 38: "curvedConnector3", 39: "curvedConnector4", 40: "curvedConnector5", 55: "chevron", 56: "pentagon",
  57: "noSmoking", 58: "star8", 59: "star16", 60: "star32", 61: "wedgeRectCallout", 62: "wedgeRoundRectCallout", 63: "wedgeEllipseCallout", 64: "wave", 65: "foldedCorner", 66: "leftArrow",
  67: "downArrow", 68: "upArrow", 69: "leftRightArrow", 70: "upDownArrow", 71: "irregularSeal1", 72: "irregularSeal2", 73: "lightningBolt", 74: "heart", 75: "rect", 76: "quadArrow",
  77: "leftArrowCallout", 78: "rightArrowCallout", 79: "upArrowCallout", 80: "downArrowCallout", 81: "leftRightArrowCallout", 82: "upDownArrowCallout", 83: "quadArrowCallout", 84: "bevel",
  85: "leftBracket", 86: "rightBracket", 87: "leftBrace", 88: "rightBrace", 89: "leftUpArrow", 90: "bentUpArrow", 91: "bentArrow", 92: "star24", 93: "stripedRightArrow", 94: "notchedRightArrow",
  95: "blockArc", 96: "smileyFace", 97: "verticalScroll", 98: "horizontalScroll", 99: "circularArrow", 101: "uturnArrow", 102: "curvedRightArrow", 103: "curvedLeftArrow", 104: "curvedUpArrow",
  105: "curvedDownArrow", 106: "cloudCallout", 107: "ellipseRibbon", 108: "ellipseRibbon2", 109: "flowChartProcess", 110: "flowChartDecision", 111: "flowChartInputOutput",
  112: "flowChartPredefinedProcess", 113: "flowChartInternalStorage", 114: "flowChartDocument", 115: "flowChartMultidocument", 116: "flowChartTerminator", 117: "flowChartPreparation",
  118: "flowChartManualInput", 119: "flowChartManualOperation", 120: "flowChartConnector", 121: "flowChartPunchedCard", 122: "flowChartPunchedTape", 123: "flowChartSummingJunction",
  124: "flowChartOr", 125: "flowChartCollate", 126: "flowChartSort", 127: "flowChartExtract", 128: "flowChartMerge", 129: "flowChartOfflineStorage", 130: "flowChartOnlineStorage",
  131: "flowChartMagneticTape", 132: "flowChartMagneticDisk", 133: "flowChartMagneticDrum", 134: "flowChartDisplay", 135: "flowChartDelay", 176: "flowChartAlternateProcess",
  177: "flowChartOffpageConnector", 183: "sun", 184: "moon", 185: "bracketPair", 186: "bracePair", 187: "star4", 188: "doubleWave", 202: "rect" };

/** DrawingML preset name for a shape type, when one exists. */
export const officeArtPreset = (shapeType: number): string | undefined => PRESETS[shapeType];
/** Sibling records in a range. A record that runs past the range ends the list. */
export function officeArtRecords(bytes: Uint8Array, start = 0, end = bytes.byteLength): OfficeArtRecord[] {
  const records: OfficeArtRecord[] = [], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at + 8 <= end && at + 8 <= bytes.byteLength && records.length < MAX_RECORDS;) {
    const head = view.getUint16(at, true), length = view.getUint32(at + 4, true), finish = at + 8 + length;
    if (finish > end) break;
    records.push({ version: head & 15, instance: head >>> 4, type: view.getUint16(at + 2, true), start: at + 8, end: finish });
    at = finish;
  }
  return records;
}
/** The single record that starts at an offset, when it lies completely inside the range. */
export function officeArtRecordAt(bytes: Uint8Array, offset: number, end = bytes.byteLength): OfficeArtRecord | undefined {
  if (!Number.isInteger(offset) || offset < 0 || offset + 8 > end || end > bytes.byteLength) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), head = view.getUint16(offset, true), finish = offset + 8 + view.getUint32(offset + 4, true);
  return finish > end ? undefined : { version: head & 15, instance: head >>> 4, type: view.getUint16(offset + 2, true), start: offset + 8, end: finish };
}
const children = (bytes: Uint8Array, record: OfficeArtRecord) => officeArtRecords(bytes, record.start, record.end);

function readBlip(bytes: Uint8Array, record: OfficeArtRecord): OfficeArtImage | undefined {
  const format = IMAGE_FORMATS[record.type];
  if (!format) return undefined;
  if (format === "emf" || format === "wmf" || format === "pict") return { format, data: new Uint8Array() };
  // One or two 16-byte identifiers and a tag byte precede the image; odd instances carry two.
  const header = (record.instance & 1 ? 32 : 16) + 1, starts = [record.start + header, record.start + 17, record.start + 33];
  const signature = format === "png" ? [0x89, 0x50, 0x4e, 0x47] : format === "jpeg" ? [0xff, 0xd8, 0xff] : undefined;
  const start = signature ? starts.find(at => at + signature.length <= record.end && signature.every((value, index) => bytes[at + index] === value)) : starts[0];
  return start === undefined || start >= record.end ? undefined : { format, data: bytes.slice(start, record.end) };
}
/**
 * Reads a picture from a blip record or from a store entry. A store entry either embeds the
 * picture or points into a separate stream, which the caller passes as delay.
 */
export function readOfficeArtImage(bytes: Uint8Array, record: OfficeArtRecord, delay?: Uint8Array): OfficeArtImage | undefined {
  if (record.type !== OFFICE_ART.blipEntry) return readBlip(bytes, record);
  if (record.end - record.start < 36) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), embedded = officeArtRecordAt(bytes, record.start + 36 + bytes[record.start + 33], record.end);
  if (embedded) return readBlip(bytes, embedded);
  const offset = view.getUint32(record.start + 28, true);
  if (!delay || !view.getUint32(record.start + 20, true)) return undefined;
  const referenced = officeArtRecordAt(delay, offset);
  return referenced && readBlip(delay, referenced);
}
/** Pictures of a drawing group, in store order; shapes refer to them by one-based index. */
export function readOfficeArtImages(bytes: Uint8Array, drawingGroup: OfficeArtRecord, delay?: Uint8Array): (OfficeArtImage | undefined)[] {
  const store = children(bytes, drawingGroup).find(record => record.type === OFFICE_ART.blipStore);
  return store ? children(bytes, store).map(record => readOfficeArtImage(bytes, record, delay)) : [];
}
function readProperties(bytes: Uint8Array, record: OfficeArtRecord, target: Map<number, OfficeArtProperty>): void {
  try {
    const reader = new ByteReader(bytes, record.start, record.end), complex: [number, number][] = [];
    for (let index = 0; index < record.instance; index++) {
      const id = reader.u16(), value = reader.u32();
      target.set(id & 0x3fff, { value });
      if (id & 0x8000) complex.push([id & 0x3fff, value]);
    }
    // Complex values follow the fixed table, in table order.
    for (const [id, length] of complex) target.set(id, { value: length, data: reader.take(length) });
  } catch { /* A truncated table keeps the properties read so far. */ }
}
/** Reads one shape container. */
export function readOfficeArtShape(bytes: Uint8Array, container: OfficeArtRecord): OfficeArtShape {
  const shape: OfficeArtShape = { id: 0, shapeType: 0, group: false, child: false, patriarch: false, deleted: false, flipHorizontal: false, flipVertical: false,
    connector: false, background: false, properties: new Map(), children: [] };
  const bounds = (record: OfficeArtRecord): OfficeArtBounds | undefined => {
    if (record.end - record.start < 16) return undefined;
    const reader = new ByteReader(bytes, record.start, record.end);
    return { left: reader.i32(), top: reader.i32(), right: reader.i32(), bottom: reader.i32() };
  };
  for (const record of children(bytes, container)) {
    if (record.type === OFFICE_ART.shapeHeader && record.end - record.start >= 8) {
      const reader = new ByteReader(bytes, record.start, record.end), id = reader.u32(), flags = reader.u32();
      Object.assign(shape, { id, shapeType: record.instance, group: !!(flags & 0x001), child: !!(flags & 0x002), patriarch: !!(flags & 0x004), deleted: !!(flags & 0x008),
        flipHorizontal: !!(flags & 0x040), flipVertical: !!(flags & 0x080), connector: !!(flags & 0x100), background: !!(flags & 0x400) });
    } else if (record.type === OFFICE_ART.properties || record.type === 0xf121 || record.type === 0xf122) readProperties(bytes, record, shape.properties);
    else if (record.type === OFFICE_ART.groupBounds) shape.groupBounds = bounds(record);
    else if (record.type === OFFICE_ART.childAnchor) shape.childAnchor = bounds(record);
    else if (record.type === OFFICE_ART.clientAnchor) shape.clientAnchor = record;
    else if (record.type === OFFICE_ART.clientData) shape.clientData = record;
    else if (record.type === OFFICE_ART.clientTextbox) shape.clientTextbox = record;
  }
  return shape;
}
/** Reads a group container: its first shape describes the group, the rest are its members. */
export function readOfficeArtGroup(bytes: Uint8Array, container: OfficeArtRecord, depth = 0): OfficeArtShape | undefined {
  let group: OfficeArtShape | undefined;
  for (const record of children(bytes, container)) {
    if (record.type === OFFICE_ART.shape) { const shape = readOfficeArtShape(bytes, record); if (group) group.children.push(shape); else group = shape; }
    else if (record.type === OFFICE_ART.group && group && depth < MAX_DEPTH) { const nested = readOfficeArtGroup(bytes, record, depth + 1); if (nested) group.children.push(nested); }
  }
  return group;
}
/** Reads a drawing container: the top-level group and, where the host has one, the background shape. */
export function readOfficeArtDrawing(bytes: Uint8Array, container: OfficeArtRecord): { root?: OfficeArtShape; background?: OfficeArtShape } {
  const records = children(bytes, container), group = records.find(record => record.type === OFFICE_ART.group), background = records.find(record => record.type === OFFICE_ART.shape);
  return { root: group && readOfficeArtGroup(bytes, group), background: background && readOfficeArtShape(bytes, background) };
}
/** A boolean property is in force only when its "use" bit is set; otherwise the default applies. */
export function officeArtFlag(shape: OfficeArtShape, property: number, bit: number, fallback: boolean): boolean {
  const value = shape.properties.get(property)?.value;
  return value === undefined || !(value & bit << 16) ? fallback : !!(value & bit);
}
/** Colours are RGB, or an index into the host's colour scheme or the system palette. */
export function officeArtColor(value: number): OfficeArtColor {
  const flags = value >>> 24;
  if (flags & 0x08) return { scheme: value & 0xff };
  if (flags & 0x10) return { system: value & 0xffff };
  return { rgb: [value & 0xff, value >>> 8 & 0xff, value >>> 16 & 0xff].map(part => part.toString(16).padStart(2, "0")).join("").toUpperCase() };
}
/** Text of a complex string property (UTF-16, NUL-terminated). */
export function officeArtString(shape: OfficeArtShape, property: number): string | undefined {
  const data = shape.properties.get(property)?.data;
  if (!data) return undefined;
  const text = new TextDecoder("utf-16le").decode(data), end = text.indexOf("\u0000");
  return end < 0 ? text : text.slice(0, end);
}

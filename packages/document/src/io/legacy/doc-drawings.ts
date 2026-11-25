import { ByteReader, OFFICE_ART, OFFICE_ART_PROPERTY as P, officeArtColor, officeArtFlag, officeArtPreset, officeArtRecordAt, officeArtString,
  readOfficeArtDrawing, readOfficeArtImages, type OfficeArtImage, type OfficeArtShape } from "../../core";
import { readDocText } from "./doc-content";
import { FIB, type DocFile } from "./doc-file";

/**
 * The drawing layer of a document: pictures, text boxes and shapes that float over the page.
 * Each is anchored at a 0x08 character of the main text; a table gives the shape and its box
 * for that character, the drawing records give the shape, and the textbox document its text.
 */
/** `bitmap` marks data still in the bitmap format of Office 97, which is rewritten as PNG once the package is laid out. */
export type DocImageData = { type: string; extension: string; data: Uint8Array; bitmap?: boolean };
export type DocFloating = { /** Size in EMU. */ width: number; height: number; name: string; description: string; place: DocPlace } & (
  | { kind: "picture"; image: DocImageData; /** Index in the picture store; anchors of one picture share its data. */ store: number; adjusted: boolean }
  | { kind: "shape"; preset: string | undefined; text: string; fill: string | undefined; line: string | undefined; lineWidth: number;
    rotation: number; flipHorizontal: boolean; flipVertical: boolean }
  | { kind: "group" });

/**
 * Where an object stands on the page, in the terms of an anchored drawing: the offsets in EMU from an origin,
 * or the side of that origin it is aligned to, and how text passes it.
 */
export type DocPlace = { left: number; top: number; horizontal: string; vertical: string; alignHorizontal?: string; alignVertical?: string;
  wrap: "square" | "topAndBottom" | "none" | "tight" | "through"; behind: boolean };
const HORIZONTAL_ORIGINS = ["margin", "page", "column", "character"], VERTICAL_ORIGINS = ["margin", "page", "paragraph", "line"];
const HORIZONTAL_SIDES = [undefined, "left", "center", "right", "inside", "outside"], VERTICAL_SIDES = [undefined, "top", "center", "bottom", "inside", "outside"];
const WRAPS = ["square", "topAndBottom", "square", "none", "tight", "through"] as const;

const PICTURE_TYPES: Readonly<Record<OfficeArtImage["format"], [type: string, extension: string]>> = { png: ["image/png", "png"], jpeg: ["image/jpeg", "jpeg"], dib: ["image/png", "png"],
  emf: ["image/x-emf", "emf"], wmf: ["image/x-wmf", "wmf"], pict: ["image/x-pict", "pict"], tiff: ["image/tiff", "tiff"] };
/** The part a stored picture becomes. Metafiles keep their own type, which the reader leaves out by name. */
export function docImageData(image: OfficeArtImage): DocImageData {
  const [type, extension] = PICTURE_TYPES[image.format];
  return { type, extension, data: image.data, ...(image.format === "dib" ? { bitmap: true } : {}) };
}
const TWIP_EMU = 635, ANCHOR_BYTES = 26, TEXTBOX_BYTES = 22, PICTURE_FRAME = 75;
/** A document has one drawing for its main text and one for its headers. */
const MAX_DRAWINGS = 16;
/** The longest text a shape of the document model holds. */
const MAX_SHAPE_TEXT = 100_000;
/** The widest line (100 px) a shape of the document model holds. */
const MAX_LINE_EMU = 952_500;

/** Text of a textbox as plain lines: field results without their instructions, breaks as new lines. */
function plainText(source: string): string {
  let result = "", instructions = 0;
  const fields: boolean[] = [];
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    if (code === 0x13) { fields.push(true); instructions++; }
    else if (code === 0x14) { if (fields.at(-1)) { fields[fields.length - 1] = false; instructions--; } }
    else if (code === 0x15) { if (fields.pop()) instructions--; }
    else if (instructions) continue;
    else if (code === 0x0d || code === 0x0b || code === 0x0c) result += "\n";
    else if (code === 0x09 || code === 0x07) result += "\t";
    else if (code === 0x1e) result += "‑";
    else if (code >= 0x20 && code !== 0x7f && code !== 0xfffe && code !== 0xffff) result += source[index];
  }
  return result.replace(/\n+$/, "");
}

/** Returns the lookup from the character position of an anchor to its drawn object. Damaged tables lose their objects. */
export function readDocDrawings(file: DocFile): (cp: number) => DocFloating | undefined {
  const anchors = new Map<number, { shape: number; left: number; top: number; width: number; height: number; flags: number }>(), shapes = new Map<number, OfficeArtShape>();
  const ranges = new Map<number, [start: number, end: number]>(), texts = new Map<number, string>();
  let images: (OfficeArtImage | undefined)[] = [];
  try {
    const { offset, length } = file.pair(FIB.shapes), count = Math.floor((length - 4) / (4 + ANCHOR_BYTES));
    if (count > 0) {
      const positions = new ByteReader(file.table, offset, offset + (count + 1) * 4), entries = new ByteReader(file.table, offset + (count + 1) * 4, offset + length);
      for (let index = 0; index < count; index++) {
        const cp = positions.u32(), shape = entries.u32(), left = entries.i32(), top = entries.i32(), right = entries.i32(), bottom = entries.i32();
        const flags = entries.u16();
        entries.skip(4);
        anchors.set(cp, { shape, left: left * TWIP_EMU, top: top * TWIP_EMU, width: (right - left) * TWIP_EMU, height: (bottom - top) * TWIP_EMU, flags });
      }
    }
  } catch { /* The anchors read before the damage are kept. */ }
  if (!anchors.size) return () => undefined;
  try {
    const { offset, length } = file.pair(FIB.drawings), bytes = file.table.subarray(offset, offset + length), group = officeArtRecordAt(bytes, 0);
    if (group?.type === OFFICE_ART.drawingGroup) {
      // The pictures of the store are kept in the main stream.
      images = readOfficeArtImages(bytes, group, file.main);
      // Each drawing follows a byte that tells the main text (0) from the headers.
      for (let at = group.end, seen = 0; at < bytes.length && seen < MAX_DRAWINGS; seen++) {
        const main = bytes[at] === 0, record = officeArtRecordAt(bytes, at + 1);
        if (!record) break;
        at = record.end;
        if (main && record.type === OFFICE_ART.drawing) for (const shape of readOfficeArtDrawing(bytes, record).root?.children ?? []) if (!shape.deleted) shapes.set(shape.id, shape);
      }
    }
  } catch { /* Without readable drawing records the anchors have nothing to show. */ }
  try {
    const { offset, length } = file.pair(FIB.textboxes), count = Math.floor((length - 4) / (4 + TEXTBOX_BYTES)), { counts } = file;
    if (count > 0 && counts.textboxes > 0) {
      // The textbox document follows the main text, footnotes, headers, comments and endnotes.
      const base = counts.text + counts.footnotes + counts.headers + counts.comments + counts.endnotes;
      const positions = new ByteReader(file.table, offset, offset + (count + 1) * 4), entries = new ByteReader(file.table, offset + (count + 1) * 4, offset + length);
      for (let index = 0, start = positions.u32(); index < count; index++) {
        const end = positions.u32();
        entries.skip(8);
        const spare = entries.u16();
        entries.skip(4);
        const shape = entries.u32();
        entries.skip(4);
        if (!spare && shape && end > start && end <= counts.textboxes && !ranges.has(shape)) ranges.set(shape, [base + start, base + end]);
        start = end;
      }
    }
  } catch { /* Shapes whose text cannot be located are imported without it. */ }
  const textOf = (shape: number): string => {
    let text = texts.get(shape);
    if (text === undefined) {
      const range = ranges.get(shape);
      // Read once per shape, and no further than a shape can hold.
      text = range ? plainText(readDocText(file, range[0], Math.min(range[1], range[0] + MAX_SHAPE_TEXT))).slice(0, MAX_SHAPE_TEXT) : "";
      texts.set(shape, text);
    }
    return text;
  };

  return cp => {
    const anchor = anchors.get(cp), shape = anchor && shapes.get(anchor.shape);
    if (!anchor || !shape || !(anchor.width > 0 && anchor.height > 0)) return undefined;
    const value = (id: number) => shape.properties.get(id)?.value, { flags } = anchor;
    // The anchor names the origins of its box (bits 1–2 and 3–4), how text passes it (5–8) and whether it lies behind the text (14).
    // A shape that states its own origins or an alignment overrides the anchor.
    const place: DocPlace = { left: anchor.left, top: anchor.top,
      horizontal: HORIZONTAL_ORIGINS[value(P.originHorizontal) ?? (flags >> 1) & 3] ?? "column", vertical: VERTICAL_ORIGINS[value(P.originVertical) ?? (flags >> 3) & 3] ?? "paragraph",
      alignHorizontal: HORIZONTAL_SIDES[value(P.alignHorizontal) ?? 0], alignVertical: VERTICAL_SIDES[value(P.alignVertical) ?? 0],
      wrap: WRAPS[(flags >> 5) & 15] ?? "square", behind: (flags & 0x4000) !== 0 };
    const base = { width: anchor.width, height: anchor.height, name: officeArtString(shape, P.name) ?? "", description: officeArtString(shape, P.description) ?? "", place };
    if (shape.group) return { ...base, kind: "group" };
    const store = value(P.picture);
    if (store) {
      const image = images[store - 1];
      if (!image) return undefined;
      const adjusted = [P.cropTop, P.cropBottom, P.cropLeft, P.cropRight, P.rotation].some(id => value(id)) || shape.flipHorizontal || shape.flipVertical;
      return { ...base, kind: "picture", image: docImageData(image), store, adjusted };
    }
    // A picture frame without stored data shows a linked file, which is not read.
    if (shape.shapeType === PICTURE_FRAME) return undefined;
    // Unstated colours are those of the format: a white fill and a black hairline.
    const colour = (id: number, fallback: string) => { const stated = value(id); return stated === undefined ? fallback : officeArtColor(stated).rgb ?? fallback; };
    const turns = ((value(P.rotation) ?? 0) | 0) / 65_536;
    return { ...base, kind: "shape", preset: officeArtPreset(shape.shapeType), text: textOf(shape.id),
      fill: officeArtFlag(shape, P.fillFlags, 0x10, true) ? colour(P.fillColor, "FFFFFF") : undefined,
      line: officeArtFlag(shape, P.lineFlags, 0x08, true) ? colour(P.lineColor, "000000") : undefined,
      lineWidth: Math.min(MAX_LINE_EMU, Math.max(0, value(P.lineWidth) ?? 9525)),
      rotation: Number.isFinite(turns) ? turns % 360 : 0, flipHorizontal: shape.flipHorizontal, flipVertical: shape.flipVertical };
  };
}

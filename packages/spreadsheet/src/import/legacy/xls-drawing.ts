import { ByteReader, OFFICE_ART, OFFICE_ART_PROPERTY as P, officeArtColor, officeArtFlag, officeArtPreset, officeArtRecords, officeArtString, readOfficeArtDrawing,
  type OfficeArtImage, type OfficeArtShape } from "../../core";
import { xmlAttribute, xmlText } from "./biff";
import { xlsColor, type XlsBook } from "./biff-book";

/** Converts the drawing layer of one worksheet (pictures, shapes, text boxes and lines) to a SpreadsheetDrawingML part. */
export type XlsSheetObject = { id: number; type: number; text?: string; alignment?: number };
/** Sizes of the source grid, in CSS pixels, as the XLSX reader derives them from the same stored values. */
export type XlsSheetGrid = { columnPixels(column: number): number; rowPixels(row: number): number; columnStart(column: number): number; rowStart(row: number): number };
export type XlsDrawingInput = {
  book: XlsBook; chunks: readonly Uint8Array[]; objects: readonly XlsSheetObject[]; grid: XlsSheetGrid; images: readonly (OfficeArtImage | undefined)[];
  /** Filter buttons are drawn objects too; they belong to the auto-filter, not to the drawing layer. */
  hasFilter: boolean;
  /** Returns the relationship id of a picture, or undefined when it has no usable data. */
  imageRelation(index: number): string | undefined;
};
export type XlsDrawingResult = { xml: string | undefined; controls: boolean };

const DRAWING_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing", A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", EMU_PER_PIXEL = 9525, MAX_OBJECTS = 5000;
const ARROWHEADS = ["none", "triangle", "stealth", "diamond", "oval", "arrow"], DASHES = ["solid", "sysDash", "sysDot", "sysDashDot", "sysDashDotDot", "dot", "dash", "lgDash", "dashDot", "lgDashDot", "lgDashDotDot"];
const NOTE = 0x19, CHART = 0x05, PICTURE = 0x08, TEXT_BOX = 0x06, LINE = 0x01, DROPDOWN = 0x14;
const isControl = (type: number) => type === 0x07 || type >= 0x0b && type <= 0x14;

export function convertXlsDrawing(input: XlsDrawingInput): XlsDrawingResult {
  const { book, grid } = input, total = input.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0), bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of input.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const container = officeArtRecords(bytes).find(record => record.type === OFFICE_ART.drawing), root = container && readOfficeArtDrawing(bytes, container).root;
  if (!root) return { xml: undefined, controls: false };
  const anchors: string[] = [], objects = [...input.objects];
  let controls = false, count = 0;
  /** Colours are RGB or an index into the workbook palette. */
  const color = (value: number | undefined, fallback: string): string => {
    if (value === undefined) return fallback;
    const parsed = officeArtColor(value);
    return parsed.rgb ?? (parsed.scheme !== undefined ? xlsColor(book, parsed.scheme) : undefined) ?? fallback;
  };
  const solid = (rgb: string) => `<a:solidFill><a:srgbClr val="${rgb}"/></a:solidFill>`;
  /** Cell anchor: column and row with fractional offsets (1/1024 of the column, 1/256 of the row). */
  function readAnchor(shape: OfficeArtShape) {
    const record = shape.clientAnchor;
    if (!record || record.end - record.start < 18) return undefined;
    const reader = new ByteReader(bytes, record.start + 2, record.end), values = Array.from({ length: 8 }, () => reader.u16());
    const [leftColumn, leftOffset, topRow, topOffset, rightColumn, rightOffset, bottomRow, bottomOffset] = values;
    const horizontal = (column: number, fraction: number) => Math.min(1, fraction / 1024) * grid.columnPixels(column), vertical = (row: number, fraction: number) => Math.min(1, fraction / 256) * grid.rowPixels(row);
    const marker = (column: number, x: number, row: number, y: number) => `<xdr:col>${column}</xdr:col><xdr:colOff>${Math.round(x * EMU_PER_PIXEL)}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${Math.round(y * EMU_PER_PIXEL)}</xdr:rowOff>`;
    const left = grid.columnStart(leftColumn) + horizontal(leftColumn, leftOffset), top = grid.rowStart(topRow) + vertical(topRow, topOffset);
    const right = grid.columnStart(rightColumn) + horizontal(rightColumn, rightOffset), bottom = grid.rowStart(bottomRow) + vertical(bottomRow, bottomOffset);
    return { xml: `<xdr:from>${marker(leftColumn, horizontal(leftColumn, leftOffset), topRow, vertical(topRow, topOffset))}</xdr:from><xdr:to>${marker(rightColumn, horizontal(rightColumn, rightOffset), bottomRow, vertical(bottomRow, bottomOffset))}</xdr:to>`,
      left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  }
  function convert(shape: OfficeArtShape): void {
    // Every shape with client data is announced by one object record, in the same order.
    const object = shape.clientData ? objects.shift() : undefined;
    if (shape.deleted || object?.type === NOTE) return;
    if (object && isControl(object.type)) { if (!(object.type === DROPDOWN && input.hasFilter)) controls = true; return; }
    const anchor = readAnchor(shape);
    if (!anchor || ++count > MAX_OBJECTS) return;
    const id = shape.id || count, hidden = officeArtFlag(shape, P.groupFlags, 0x02, false), description = officeArtString(shape, P.description);
    const identity = `<xdr:cNvPr id="${id}" name="${xmlAttribute(officeArtString(shape, P.name) || `Object ${count}`)}"${description ? ` descr="${xmlAttribute(description)}"` : ""}${hidden ? ' hidden="1"' : ""}/>`;
    const wrap = (body: string) => { anchors.push(`<xdr:twoCellAnchor editAs="oneCell">${anchor.xml}${body}<xdr:clientData/></xdr:twoCellAnchor>`); };
    // Groups and charts are not imported; the reader omits and reports them as it does for XLSX.
    if (shape.group) return wrap(`<xdr:grpSp><xdr:nvGrpSpPr>${identity}<xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr/></xdr:grpSp>`);
    if (object?.type === CHART) return wrap(`<xdr:graphicFrame><xdr:nvGraphicFramePr>${identity}<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr></xdr:graphicFrame>`);
    const rotation = ((shape.properties.get(P.rotation)?.value ?? 0) | 0) / 65_536, turns = ((rotation % 360) + 360) % 360;
    let { left, top, width, height } = anchor;
    // Near a quarter turn the anchor holds the turned box; swap it back around its centre.
    if (turns >= 45 && turns < 135 || turns >= 225 && turns < 315) { left += (width - height) / 2; top += (height - width) / 2; [width, height] = [height, width]; }
    const transform = `<a:xfrm${turns ? ` rot="${Math.round(turns * 60_000)}"` : ""}${shape.flipHorizontal ? ' flipH="1"' : ""}${shape.flipVertical ? ' flipV="1"' : ""}>` +
      `<a:off x="${Math.round(Math.max(0, left) * EMU_PER_PIXEL)}" y="${Math.round(Math.max(0, top) * EMU_PER_PIXEL)}"/><a:ext cx="${Math.round(width * EMU_PER_PIXEL)}" cy="${Math.round(height * EMU_PER_PIXEL)}"/></a:xfrm>`;
    const picture = shape.properties.get(P.picture)?.value;
    if (picture || object?.type === PICTURE) {
      const relation = picture ? input.imageRelation(picture) : undefined, cropped = [P.cropLeft, P.cropTop, P.cropRight, P.cropBottom].some(key => shape.properties.get(key)?.value);
      return wrap(`<xdr:pic><xdr:nvPicPr>${identity}<xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip${relation ? ` r:embed="${relation}"` : ""}/>${cropped ? "<a:srcRect/>" : ""}<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr>${transform}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`);
    }
    const lined = officeArtFlag(shape, P.lineFlags, 0x08, true), dash = DASHES[shape.properties.get(P.lineDash)?.value ?? 0];
    const start = ARROWHEADS[shape.properties.get(P.lineStart)?.value ?? 0], end = ARROWHEADS[shape.properties.get(P.lineEnd)?.value ?? 0];
    const line = lined ? `<a:ln w="${shape.properties.get(P.lineWidth)?.value ?? 9525}">${solid(color(shape.properties.get(P.lineColor)?.value, "000000"))}${dash && dash !== "solid" ? `<a:prstDash val="${dash}"/>` : ""}` +
      `${start && start !== "none" ? `<a:headEnd type="${start}"/>` : ""}${end && end !== "none" ? `<a:tailEnd type="${end}"/>` : ""}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
    const preset = officeArtPreset(shape.shapeType);
    if (shape.connector || shape.shapeType === 20 || shape.shapeType >= 32 && shape.shapeType <= 40 || object?.type === LINE)
      return wrap(`<xdr:cxnSp><xdr:nvCxnSpPr>${identity}<xdr:cNvCxnSpPr/></xdr:nvCxnSpPr><xdr:spPr>${transform}<a:prstGeom prst="${preset ?? "line"}"><a:avLst/></a:prstGeom>${line}</xdr:spPr></xdr:cxnSp>`);
    const textBox = shape.shapeType === 202 || object?.type === TEXT_BOX, filled = officeArtFlag(shape, P.fillFlags, 0x10, true), fillType = shape.properties.get(P.fillType)?.value ?? 0;
    const fill = !filled ? "<a:noFill/>" : fillType !== 0 ? "<a:gradFill/>" : solid(color(shape.properties.get(P.fillColor)?.value, "FFFFFF"));
    const font = book.fonts[0], horizontal = [undefined, "l", "ctr", "r", "just"][(object?.alignment ?? 0) >> 1 & 7], vertical = [undefined, "t", "ctr", "b"][(object?.alignment ?? 0) >> 4 & 7];
    const run = `<a:rPr${font ? ` sz="${Math.round(font.size * 100)}"` : ""}>${font ? `<a:latin typeface="${xmlAttribute(font.name)}"/>` : ""}</a:rPr>`;
    const text = object?.text ? `<xdr:txBody><a:bodyPr${vertical ? ` anchor="${vertical}"` : ""}/><a:lstStyle/>${object.text.split(/\r\n|\n|\r/).map(lineText =>
      `<a:p>${horizontal ? `<a:pPr algn="${horizontal}"/>` : ""}<a:r>${run}<a:t>${xmlText(lineText)}</a:t></a:r></a:p>`).join("")}</xdr:txBody>` : "";
    // A shape type without a preset outline is written as a custom shape, which the reader reports as unsupported.
    const outline = preset ? `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>` : `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst/></a:custGeom>`;
    wrap(`<xdr:sp><xdr:nvSpPr>${identity}<xdr:cNvSpPr${textBox ? ' txBox="1"' : ""}/></xdr:nvSpPr><xdr:spPr>${transform}${outline}${fill}${textBox && !shape.properties.has(P.lineFlags) ? "<a:ln><a:noFill/></a:ln>" : line}</xdr:spPr>${text}</xdr:sp>`);
  }
  /** Members of a group are announced by object records too, even though the group is omitted as a whole. */
  const skipMembers = (group: OfficeArtShape) => { for (const member of group.children) { if (member.clientData) objects.shift(); skipMembers(member); } };
  for (const shape of root.children) { convert(shape); skipMembers(shape); }
  return { xml: anchors.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="${DRAWING_NAMESPACE}" xmlns:a="${A}" xmlns:r="${R}">${anchors.join("")}</xdr:wsDr>` : undefined, controls };
}

import { normalizeDrawings } from "../../model/annotations";
import { normalizeResources } from "../../model/image-resources";
import { getShapeDefinition, shapeBodyFrame } from "../../model/shapes";
import { normalizeDrawingRotation, rotateDrawingVector } from "../../model/drawing-transform";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../../model/sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetDrawingAnchor, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../../model/types";
import { checkImageExportCancellation, createXlsxMediaRegistry, prepareXlsxMedia, type XlsxImage, type XlsxMediaRegistry } from "./images";
import type { XlsxContentType, XlsxPart } from "./types";
import type { SpreadsheetImageRasterizer, SpreadsheetXlsxExportWarning } from "../portable-types";
import { xml, xlsxColor } from "./xml";
import { CONNECTOR_PORTS } from "../../core";
import { getSpreadsheetLinePoints, getSpreadsheetLineRoute, spreadsheetLineRouteMidpoint } from "../../model/lines";
import { createOfficeElbowConnectorGeometry } from "../../ooxml";
import { connectorTargetGeometry } from "./connector-geometry";

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const MAIN_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const emu = (pixels: number) => Math.round(pixels * 9525);

export type XlsxWorksheetDrawings = Readonly<{
  parts: XlsxPart[];
  drawingPath?: string;
  drawingRelationshipTarget?: string;
  contentTypes: XlsxContentType[];
}>;

type Rectangle = { x: number; y: number; width: number; height: number };
type Geometry = { columns: readonly number[]; rows: readonly number[]; sheet: SpreadsheetSheet };

function geometry(sheet: SpreadsheetSheet): Geometry {
  const columns = [0], rows = [0];
  for (let column = 0; column < sheet.columnCount; column++) columns.push(columns[column] + (sheet.columnWidths?.[column] ?? DEFAULT_COLUMN_WIDTH));
  for (let row = 0; row < sheet.rowCount; row++) rows.push(rows[row] + (sheet.rowHeights?.[row] ?? DEFAULT_ROW_HEIGHT));
  return { columns, rows, sheet };
}

function frame(drawing: SpreadsheetDrawing, grid: Geometry): Rectangle {
  return { x: grid.columns[drawing.anchor.column] + drawing.anchor.offsetX,
    y: grid.rows[drawing.anchor.row] + drawing.anchor.offsetY, width: drawing.width, height: drawing.height };
}

/** The exported picture matches object-fit:contain, including centered letterboxing. */
export function containXlsxImage(rectangle: Rectangle, image: Pick<XlsxImage, "width" | "height">): Rectangle {
  const ratio = Math.min(rectangle.width / image.width, rectangle.height / image.height);
  const width = image.width * ratio, height = image.height * ratio;
  return { x: rectangle.x + (rectangle.width - width) / 2, y: rectangle.y + (rectangle.height - height) / 2, width, height };
}

function locate(position: number, offsets: readonly number[], fallback: number) {
  let low = 0, high = offsets.length - 1;
  while (low < high) { const middle = Math.floor((low + high + 1) / 2); if (offsets[middle] <= position) low = middle; else high = middle - 1; }
  if (low < offsets.length - 1) return { index: low, offset: position - offsets[low] };
  const beyond = Math.floor((position - offsets[low]) / fallback);
  return { index: low + beyond, offset: position - offsets[low] - beyond * fallback };
}

function anchor(rectangle: Rectangle, grid: Geometry): SpreadsheetDrawingAnchor {
  const column = locate(rectangle.x, grid.columns, DEFAULT_COLUMN_WIDTH), row = locate(rectangle.y, grid.rows, DEFAULT_ROW_HEIGHT);
  return { column: column.index, row: row.index, offsetX: column.offset, offsetY: row.offset };
}

function transform(rectangle: Rectangle, flip: { flipX?: boolean; flipY?: boolean; rotation?: number } = {}) {
  const angle = Math.round(normalizeDrawingRotation(flip.rotation) * 60_000) % 21_600_000;
  return `<a:xfrm${flip.flipX ? ' flipH="1"' : ""}${flip.flipY ? ' flipV="1"' : ""}${angle ? ` rot="${angle}"` : ""}><a:off x="${emu(rectangle.x)}" y="${emu(rectangle.y)}"/><a:ext cx="${Math.max(1, emu(rectangle.width))}" cy="${Math.max(1, emu(rectangle.height))}"/></a:xfrm>`;
}

function anchored(rectangle: Rectangle, content: string, grid: Geometry) {
  const from = anchor(rectangle, grid);
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${from.column}</xdr:col><xdr:colOff>${emu(from.offsetX)}</xdr:colOff><xdr:row>${from.row}</xdr:row><xdr:rowOff>${emu(from.offsetY)}</xdr:rowOff></xdr:from><xdr:ext cx="${Math.max(1, emu(rectangle.width))}" cy="${Math.max(1, emu(rectangle.height))}"/>${content}<xdr:clientData/></xdr:oneCellAnchor>`;
}

function fill(color: string, fallback: string) {
  const { rgb, alpha } = xlsxColor(color, fallback);
  if (alpha === 0 || color.toLowerCase() === "none") return "<a:noFill/>";
  return `<a:solidFill><a:srgbClr val="${rgb}">${alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>`;
}

function picture(drawing: Extract<SpreadsheetDrawing, { type: "image" }>, id: number, relationship: string, rectangle: Rectangle, connected = false, contained = rectangle) {
  const fillRect = connected ? ` l="${Math.round((contained.x - rectangle.x) / rectangle.width * 100000)}" t="${Math.round((contained.y - rectangle.y) / rectangle.height * 100000)}" r="${Math.round((rectangle.x + rectangle.width - contained.x - contained.width) / rectangle.width * 100000)}" b="${Math.round((rectangle.y + rectangle.height - contained.y - contained.height) / rectangle.height * 100000)}"` : "";
  return `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}" descr="${xml(drawing.alt)}"></xdr:cNvPr><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect${fillRect}/></a:stretch></xdr:blipFill><xdr:spPr>${transform(rectangle, drawing)}${connected ? connectorTargetGeometry(drawing) : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}<a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic>`;
}

function shape(drawing: Extract<SpreadsheetDrawing, { type: "shape" }>, id: number, rectangle: Rectangle, connected = false) {
  const definition = getShapeDefinition(drawing.shape);
  const line = definition.geometry.type === "line";
  const stroke = drawing.strokeWidth;
  let adjusted = { ...rectangle };
  let flip = { flipX: drawing.flipX, flipY: drawing.flipY };
  if (line) {
    const start = Math.max(stroke, 4);
    const endX = Math.max(stroke, rectangle.width - (drawing.shape === "arrow" ? stroke * 7 : stroke));
    const endY = Math.max(stroke, rectangle.height - (drawing.shape === "arrow" ? stroke * 7 : stroke));
    adjusted = { x: rectangle.x + Math.min(start, endX), y: rectangle.y + Math.min(start, endY),
      width: Math.abs(endX - start), height: Math.abs(endY - start) };
    // Very short lines already reverse an axis; a user flip cancels that reversal.
    flip = { flipX: (endX < start) !== !!drawing.flipX, flipY: (endY < start) !== !!drawing.flipY };
  } else {
    const inset = shapeBodyFrame(drawing.shape, rectangle.width, rectangle.height, stroke);
    adjusted = { ...inset, x: rectangle.x + inset.x, y: rectangle.y + inset.y };
  }
  // Reflect inset geometry within the full frame, including arrow margins and oversized strokes.
  // DrawingML offsets are signed coordinates, so overflowing SVG geometry may remain outside A1.
  if (drawing.flipX) adjusted.x = rectangle.x * 2 + rectangle.width - adjusted.x - adjusted.width;
  if (drawing.flipY) adjusted.y = rectangle.y * 2 + rectangle.height - adjusted.y - adjusted.height;
  if (drawing.rotation) {
    // SVG rotates the full frame. Inset lines/arrows can have a different center:
    // rotate that center too, then let DrawingML rotate about the new center.
    const center = { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
    const offset = rotateDrawingVector({ x: adjusted.x + adjusted.width / 2 - center.x,
      y: adjusted.y + adjusted.height / 2 - center.y }, drawing.rotation);
    adjusted = { ...adjusted, x: center.x + offset.x - adjusted.width / 2, y: center.y + offset.y - adjusted.height / 2 };
  }
  const outline = stroke === 0 ? "<a:ln><a:noFill/></a:ln>" : `<a:ln w="${emu(stroke)}">${fill(drawing.stroke, "000000")}${line ? lineMarkers(drawing, true) : ""}</a:ln>`;
  const adjustment = definition.xlsxAdjustment;
  const shortSide = Math.min(adjusted.width, adjusted.height);
  const adjustmentValue = adjustment && shortSide > 0 ? Math.round(100_000 * adjustment.ratio * adjusted[adjustment.axis] / shortSide) : 0;
  const guides = adjustment ? `<a:avLst><a:gd name="${adjustment.name}" fmla="val ${adjustmentValue}"/></a:avLst>` : "<a:avLst/>";
  const content = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}"></xdr:cNvPr><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr>${transform(adjusted, { ...flip, rotation: drawing.rotation })}${connected ? connectorTargetGeometry(drawing) : `<a:prstGeom prst="${definition.xlsxPreset}">${guides}</a:prstGeom>`}${line ? "<a:noFill/>" : fill(drawing.fill, "FFFFFF")}${outline}</xdr:spPr>${drawingTextBody(drawing.text ?? "", { ...drawing, flipY: flip.flipY, color: drawing.color ?? "#1f2937" }, "center")}</xdr:sp>`;
  return { rectangle: adjusted, content };
}

/** DrawingML uses one text body inside either a native shape or a text box. */
function drawingTextBody(text: string, style: { fontSize?: number; color?: string; bold?: boolean; rotation?: number; flipY?: boolean }, alignment: "center" | "top-left") {
  const centered = alignment === "center";
  const properties = `sz="${Math.max(100, Math.round((style.fontSize ?? 16) * 75))}" b="${style.bold ? 1 : 0}"`;
  const paragraphs = text.split(/\r\n|\r|\n/).map(line => `<a:p><a:pPr algn="${centered ? "ctr" : "l"}"><a:lnSpc><a:spcPct val="140000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr ${properties}>${fill(style.color ?? "currentColor", "000000")}<a:latin typeface="Segoe UI"/><a:ea typeface="Noto Sans JP"/></a:rPr><a:t xml:space="preserve">${xml(line)}</a:t></a:r><a:endParaRPr ${properties}/></a:p>`).join("");
  // Upright ignores all rotation, including bodyPr.rot. Preserve old flip-only behavior,
  // but let rotated text follow the frame. DrawingML keeps letters unmirrored yet flipV
  // adds a half turn; cancel it (also for short lines' effective flips).
  // Cross-checked against Apache POI REL_5_4_1 DrawTextShape.drawContent.
  const textRotation = style.rotation && style.flipY ? ' rot="10800000"' : "";
  return `<xdr:txBody><a:bodyPr wrap="square" lIns="${emu(8)}" tIns="${emu(8)}" rIns="${emu(8)}" bIns="${emu(8)}" anchor="${centered ? "ctr" : "t"}" upright="${style.rotation ? 0 : 1}"${textRotation} vertOverflow="clip" horzOverflow="clip"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</xdr:txBody>`;
}

function textBox(drawing: Extract<SpreadsheetDrawing, { type: "text" }>, id: number, rectangle: Rectangle, connected = false) {
  return `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}"></xdr:cNvPr><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr>${transform(rectangle, drawing)}${connected ? connectorTargetGeometry(drawing) : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}${fill(drawing.background, "FFFFFF")}<a:ln><a:noFill/></a:ln></xdr:spPr>${drawingTextBody(drawing.text, drawing, "top-left")}</xdr:sp>`;
}

function lineMarkers(drawing: Extract<SpreadsheetDrawing, { type: "shape" }>, legacy = false) {
  const marker = (name: string, value: string) => `<a:${name} type="${value === "openArrow" ? "arrow" : value}"/>`;
  if (legacy && drawing.shape === "arrow" && drawing.startArrow === undefined && drawing.endArrow === undefined) return '<a:tailEnd type="triangle" w="lg" len="lg"/>';
  return marker("headEnd", drawing.startArrow ?? "none") + marker("tailEnd", drawing.endArrow ?? (drawing.shape === "arrow" ? "triangle" : "none"));
}

function connector(drawing: Extract<SpreadsheetDrawing, { type: "shape" }>, id: number, sheet: SpreadsheetSheet, ids: Map<string, number>) {
  const points = getSpreadsheetLinePoints(sheet, drawing.id);
  const route = getSpreadsheetLineRoute(sheet, drawing.id);
  const rectangle = drawing.routing === "elbow" ? route.bounds : { x: Math.min(points.start.x, points.end.x), y: Math.min(points.start.y, points.end.y), width: Math.abs(points.end.x - points.start.x), height: Math.abs(points.end.y - points.start.y) };
  const binding = (end: "start" | "end") => points[end].binding ? `<a:${end === "start" ? "stCxn" : "endCxn"} id="${ids.get(points[end].binding!.targetId)}" idx="${CONNECTOR_PORTS.indexOf(points[end].binding!.port)}"/>` : "";
  const xfrm = `<a:xfrm${drawing.routing !== "elbow" && points.end.x < points.start.x ? ' flipH="1"' : ""}${drawing.routing !== "elbow" && points.end.y < points.start.y ? ' flipV="1"' : ""}><a:off x="${emu(rectangle.x)}" y="${emu(rectangle.y)}"/><a:ext cx="${emu(rectangle.width)}" cy="${emu(rectangle.height)}"/></a:xfrm>`;
  const pathGeometry = drawing.routing === "elbow" ? createOfficeElbowConnectorGeometry(route.points, route.bounds) : '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>';
  const content = `<xdr:cxnSp><xdr:nvCxnSpPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}"/><xdr:cNvCxnSpPr>${binding("start")}${binding("end")}</xdr:cNvCxnSpPr></xdr:nvCxnSpPr><xdr:spPr>${xfrm}${pathGeometry}<a:noFill/><a:ln w="${emu(drawing.strokeWidth)}">${fill(drawing.stroke, "000000")}${lineMarkers(drawing)}</a:ln></xdr:spPr></xdr:cxnSp>`;
  return { rectangle, content };
}

/** Build native DrawingML parts. sheetIndex is the one-based OOXML sheet number. */
export async function prepareWorksheetDrawings(sheet: SpreadsheetSheet, inputResources: SpreadsheetWorkbook["resources"],
  { sheetIndex, signal, media = createXlsxMediaRegistry(), rasterizeImage, onWarning }: { sheetIndex: number; signal?: AbortSignal; media?: XlsxMediaRegistry; rasterizeImage?: SpreadsheetImageRasterizer; onWarning?: (warning: SpreadsheetXlsxExportWarning) => void }): Promise<XlsxWorksheetDrawings> {
  checkImageExportCancellation(signal);
  if (!Number.isInteger(sheetIndex) || sheetIndex < 1) throw new Error("シートの番号が正しくありません");
  const resources = normalizeResources(inputResources);
  const drawings = normalizeDrawings(sheet.drawings, sheet, resources);
  const parts: XlsxPart[] = [], contentTypes: XlsxContentType[] = [];
  if (!drawings?.length) return { parts, contentTypes };
  const grid = geometry(sheet), images = new Map<string, { image: XlsxImage; relationship: string; filename: string }>();
  const anchors: string[] = [];
  const connected = new Set(drawings.flatMap(drawing => drawing.type === "shape" && drawing.line ? [drawing.line.start.binding?.targetId, drawing.line.end.binding?.targetId].filter((id): id is string => !!id) : []));
  const ids = new Map(drawings.map((drawing, index) => [drawing.id, index + 1]));
  let imageBytes = 0, characters = 0;
  for (let index = 0; index < drawings.length; index++) {
    checkImageExportCancellation(signal);
    const drawing = drawings[index];
    let rectangle = frame(drawing, grid), content: string;
    if (drawing.type === "image") {
      let record = images.get(drawing.resourceId);
      if (!record) {
        const prepared = await prepareXlsxMedia(drawing.resourceId, resources!.images![drawing.resourceId], sheetIndex, media, signal, rasterizeImage);
        const { image, filename } = prepared.media;
        const number = images.size + 1;
        record = { image, relationship: `rIdImage${number}`, filename };
        images.set(drawing.resourceId, record);
        if (prepared.firstUse) {
          imageBytes += image.content.size;
          if (imageBytes > SPREADSHEET_LIMITS.totalImageBytes) throw new Error("変換後の画像の合計が20 MiBを超えています");
          parts.push({ path: `xl/media/${record.filename}`, content: image.content });
        }
        if (!contentTypes.some(type => type.extension === image.extension)) contentTypes.push({ extension: image.extension, contentType: image.contentType });
      }
      const contained = containXlsxImage(rectangle, record.image);
      if (!connected.has(drawing.id)) rectangle = contained;
      content = picture(drawing, index + 1, record.relationship, rectangle, connected.has(drawing.id), contained);
    } else if (drawing.type === "shape") {
      const result = drawing.line ? connector(drawing, index + 1, { ...sheet, drawings }, ids) : shape(drawing, index + 1, rectangle, connected.has(drawing.id));
      rectangle = result.rectangle;
      content = result.content;
    } else content = textBox(drawing, index + 1, rectangle, connected.has(drawing.id));
    const element = anchored(rectangle, content, grid);
    characters += element.length;
    if (characters > SPREADSHEET_LIMITS.serializedCharacters) throw new Error("描画オブジェクトの書き出しサイズが上限を超えています");
    anchors.push(element);
    if (drawing.type === "shape" && drawing.line && drawing.text) {
      // Spreadsheet CT_Connector has no txBody. Retain the text in a standard, independently editable text box.
      const points = getSpreadsheetLinePoints({ ...sheet, drawings }, drawing.id);
      const width = Math.max(120, Math.min(10000, Math.abs(points.end.x - points.start.x))), height = Math.min(10000, Math.max(40, (drawing.fontSize ?? 16) * 1.4 * drawing.text.split(/\r\n|\r|\n/).length + 16));
      const labelPoint = spreadsheetLineRouteMidpoint(getSpreadsheetLineRoute({ ...sheet, drawings }, drawing.id).points);
      const labelFrame = { x: Math.max(0, labelPoint.x - width / 2), y: Math.max(0, labelPoint.y - height / 2), width, height };
      const label: Extract<SpreadsheetDrawing, { type: "text" }> = { id: `${drawing.id}-label`, type: "text", anchor: drawing.anchor, width, height,
        text: drawing.text, fontSize: drawing.fontSize ?? 16, color: drawing.color ?? "#1f2937", bold: drawing.bold, background: "transparent" };
      const labelXml = anchored(labelFrame, textBox(label, drawings.length + index + 1, labelFrame), grid);
      characters += labelXml.length;
      if (characters > SPREADSHEET_LIMITS.serializedCharacters || anchors.length + drawings.length - index > SPREADSHEET_LIMITS.drawings)
        throw new Error("線のラベルを含むExcelの描画オブジェクト数またはサイズが上限を超えています");
      anchors.push(labelXml);
      onWarning?.({ code: "adjusted", sheetId: sheet.id, drawingId: drawing.id, message: "線の文字を独立したテキストボックスとして出力しました。Excelでは線の移動に追従しません。" });
    }
  }
  checkImageExportCancellation(signal);
  const drawingPath = `xl/drawings/drawing${sheetIndex}.xml`;
  parts.push({ path: drawingPath, content: new Blob([`${declaration}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${MAIN_NS}" xmlns:r="${REL_NS}">${anchors.join("")}</xdr:wsDr>`], { type: "application/xml" }) });
  contentTypes.push({ partName: `/${drawingPath}`, contentType: "application/vnd.openxmlformats-officedocument.drawing+xml" });
  if (images.size) parts.push({ path: `xl/drawings/_rels/drawing${sheetIndex}.xml.rels`,
    content: new Blob([`${declaration}<Relationships xmlns="${PACKAGE_REL_NS}">${Array.from(images.values(), record => `<Relationship Id="${record.relationship}" Type="${REL_NS}/image" Target="../media/${record.filename}"/>`).join("")}</Relationships>`], { type: "application/xml" }) });
  return { parts, drawingPath, drawingRelationshipTarget: `../drawings/drawing${sheetIndex}.xml`, contentTypes };
}

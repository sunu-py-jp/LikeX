import { normalizeDrawings } from "../../model/annotations";
import { normalizeResources } from "../../model/image-resources";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "../../model/sheet-dimensions";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetDrawingAnchor, type SpreadsheetSheet, type SpreadsheetWorkbook } from "../../model/types";
import { checkImageExportCancellation, createXlsxMediaRegistry, prepareXlsxMedia, type XlsxImage, type XlsxMediaRegistry } from "./images";
import type { XlsxContentType, XlsxPart } from "./types";
import { xml, xlsxColor } from "./xml";

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

function transform(rectangle: Rectangle, flip = "") {
  return `<a:xfrm${flip}><a:off x="${emu(rectangle.x)}" y="${emu(rectangle.y)}"/><a:ext cx="${Math.max(1, emu(rectangle.width))}" cy="${Math.max(1, emu(rectangle.height))}"/></a:xfrm>`;
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

function picture(drawing: Extract<SpreadsheetDrawing, { type: "image" }>, id: number, relationship: string, rectangle: Rectangle) {
  return `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}" descr="${xml(drawing.alt)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationship}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr>${transform(rectangle)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic>`;
}

function shape(drawing: Extract<SpreadsheetDrawing, { type: "shape" }>, id: number, rectangle: Rectangle) {
  const line = drawing.shape === "line" || drawing.shape === "arrow";
  const stroke = drawing.strokeWidth;
  let adjusted = { ...rectangle };
  let flip = "";
  if (line) {
    const start = Math.max(stroke, 4);
    const endX = Math.max(stroke, rectangle.width - (drawing.shape === "arrow" ? stroke * 7 : stroke));
    const endY = Math.max(stroke, rectangle.height - (drawing.shape === "arrow" ? stroke * 7 : stroke));
    adjusted = { x: rectangle.x + Math.min(start, endX), y: rectangle.y + Math.min(start, endY), width: Math.abs(endX - start), height: Math.abs(endY - start) };
    flip = `${endX < start ? ' flipH="1"' : ""}${endY < start ? ' flipV="1"' : ""}`;
  } else {
    // SVG outlines are drawn inside the frame; DrawingML outlines straddle geometry.
    adjusted = { x: rectangle.x + stroke / 2, y: rectangle.y + stroke / 2, width: Math.max(0, rectangle.width - stroke), height: Math.max(0, rectangle.height - stroke) };
  }
  const outline = stroke === 0 ? "<a:ln><a:noFill/></a:ln>" : `<a:ln w="${emu(stroke)}">${fill(drawing.stroke, "000000")}${drawing.shape === "arrow" ? '<a:tailEnd type="triangle" w="lg" len="lg"/>' : ""}</a:ln>`;
  const content = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr>${transform(adjusted, flip)}<a:prstGeom prst="${line ? "line" : drawing.shape === "ellipse" ? "ellipse" : "rect"}"><a:avLst/></a:prstGeom>${line ? "<a:noFill/>" : fill(drawing.fill, "FFFFFF")}${outline}</xdr:spPr>${drawingTextBody(drawing.text ?? "", { ...drawing, color: drawing.color ?? "#1f2937" }, "center")}</xdr:sp>`;
  return { rectangle: adjusted, content };
}

/** DrawingML uses one text body inside either a native shape or a text box. */
function drawingTextBody(text: string, style: { fontSize?: number; color?: string; bold?: boolean }, alignment: "center" | "top-left") {
  const centered = alignment === "center";
  const properties = `sz="${Math.max(100, Math.round((style.fontSize ?? 16) * 75))}" b="${style.bold ? 1 : 0}"`;
  const paragraphs = text.split(/\r\n|\r|\n/).map(line => `<a:p><a:pPr algn="${centered ? "ctr" : "l"}"><a:lnSpc><a:spcPct val="140000"/></a:lnSpc><a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr><a:r><a:rPr ${properties}>${fill(style.color ?? "currentColor", "000000")}<a:latin typeface="Segoe UI"/><a:ea typeface="Noto Sans JP"/></a:rPr><a:t xml:space="preserve">${xml(line)}</a:t></a:r><a:endParaRPr ${properties}/></a:p>`).join("");
  return `<xdr:txBody><a:bodyPr wrap="square" lIns="${emu(8)}" tIns="${emu(8)}" rIns="${emu(8)}" bIns="${emu(8)}" anchor="${centered ? "ctr" : "t"}"${centered ? ' upright="1"' : ""} vertOverflow="clip" horzOverflow="clip"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</xdr:txBody>`;
}

function textBox(drawing: Extract<SpreadsheetDrawing, { type: "text" }>, id: number, rectangle: Rectangle) {
  return `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${xml(drawing.id)}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr>${transform(rectangle)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${fill(drawing.background, "FFFFFF")}<a:ln><a:noFill/></a:ln></xdr:spPr>${drawingTextBody(drawing.text, drawing, "top-left")}</xdr:sp>`;
}

/** Build native DrawingML parts. sheetIndex is the one-based OOXML sheet number. */
export async function prepareWorksheetDrawings(sheet: SpreadsheetSheet, inputResources: SpreadsheetWorkbook["resources"],
  { sheetIndex, signal, media = createXlsxMediaRegistry() }: { sheetIndex: number; signal?: AbortSignal; media?: XlsxMediaRegistry }): Promise<XlsxWorksheetDrawings> {
  checkImageExportCancellation(signal);
  if (!Number.isInteger(sheetIndex) || sheetIndex < 1) throw new Error("シートの番号が正しくありません");
  const resources = normalizeResources(inputResources);
  const drawings = normalizeDrawings(sheet.drawings, sheet, resources);
  const parts: XlsxPart[] = [], contentTypes: XlsxContentType[] = [];
  if (!drawings?.length) return { parts, contentTypes };
  const grid = geometry(sheet), images = new Map<string, { image: XlsxImage; relationship: string; filename: string }>();
  const anchors: string[] = [];
  let imageBytes = 0, characters = 0;
  for (let index = 0; index < drawings.length; index++) {
    checkImageExportCancellation(signal);
    const drawing = drawings[index];
    let rectangle = frame(drawing, grid), content: string;
    if (drawing.type === "image") {
      let record = images.get(drawing.resourceId);
      if (!record) {
        const prepared = await prepareXlsxMedia(drawing.resourceId, resources!.images![drawing.resourceId], sheetIndex, media, signal);
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
      rectangle = containXlsxImage(rectangle, record.image);
      content = picture(drawing, index + 1, record.relationship, rectangle);
    } else if (drawing.type === "shape") {
      const result = shape(drawing, index + 1, rectangle);
      rectangle = result.rectangle;
      content = result.content;
    } else content = textBox(drawing, index + 1, rectangle);
    const element = anchored(rectangle, content, grid);
    characters += element.length;
    if (characters > SPREADSHEET_LIMITS.serializedCharacters) throw new Error("描画オブジェクトの書き出しサイズが上限を超えています");
    anchors.push(element);
  }
  checkImageExportCancellation(signal);
  const drawingPath = `xl/drawings/drawing${sheetIndex}.xml`;
  parts.push({ path: drawingPath, content: new Blob([`${declaration}<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${MAIN_NS}" xmlns:r="${REL_NS}">${anchors.join("")}</xdr:wsDr>`], { type: "application/xml" }) });
  contentTypes.push({ partName: `/${drawingPath}`, contentType: "application/vnd.openxmlformats-officedocument.drawing+xml" });
  if (images.size) parts.push({ path: `xl/drawings/_rels/drawing${sheetIndex}.xml.rels`,
    content: new Blob([`${declaration}<Relationships xmlns="${PACKAGE_REL_NS}">${Array.from(images.values(), record => `<Relationship Id="${record.relationship}" Type="${REL_NS}/image" Target="../media/${record.filename}"/>`).join("")}</Relationships>`], { type: "application/xml" }) });
  return { parts, drawingPath, drawingRelationshipTarget: `../drawings/drawing${sheetIndex}.xml`, contentTypes };
}

import { CONNECTOR_PORTS, getConnectorRoute, connectorLocalToWorld, getConnectorPortPoint, type ConnectorBox, type ConnectorEndpoint, type ConnectorPoint, type ConnectorOutline } from "./core-connectors";
import { getOfficeShapeOutline } from "./core-office-shapes";
import { DEFAULT_COLUMN_WIDTH, DEFAULT_ROW_HEIGHT } from "./sheet-dimensions";
import { getShapeDefinition, shapeBodyFrame } from "./shapes";
import type { SpreadsheetDrawing, SpreadsheetDrawingAnchor, SpreadsheetLine, SpreadsheetLinePoints, SpreadsheetSheet, SpreadsheetShapeDrawing, SpreadsheetStoredLineEndpoint } from "./types";

export const isSpreadsheetLine = (drawing: SpreadsheetDrawing): drawing is SpreadsheetShapeDrawing & { shape: "line" | "arrow" } => drawing.type === "shape" && (drawing.shape === "line" || drawing.shape === "arrow");
export function sheetDrawingGeometry(sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount" | "columnWidths" | "rowHeights">) {
  const columns = [0], rows = [0];
  for (let index = 0; index < sheet.columnCount; index++) columns.push(columns[index] + (sheet.columnWidths?.[index] ?? DEFAULT_COLUMN_WIDTH));
  for (let index = 0; index < sheet.rowCount; index++) rows.push(rows[index] + (sheet.rowHeights?.[index] ?? DEFAULT_ROW_HEIGHT));
  return { columns, rows };
}
export function anchorPoint(anchor: SpreadsheetDrawingAnchor, grid: { columns: readonly number[]; rows: readonly number[] }): ConnectorPoint {
  return { x: grid.columns[anchor.column] + anchor.offsetX, y: grid.rows[anchor.row] + anchor.offsetY };
}
export function pointAnchor(point: ConnectorPoint, grid: { columns: readonly number[]; rows: readonly number[] }): SpreadsheetDrawingAnchor {
  const locate = (value: number, offsets: readonly number[]) => {
    if (!Number.isFinite(value) || value < -10_000) throw new Error("線の端点の座標が対応範囲外です");
    let index = 0;
    while (index + 1 < offsets.length - 1 && offsets[index + 1] <= value) index++;
    if (value - offsets[index] > 10_000) throw new Error("線の端点がシートの対応範囲外です");
    return { index, offset: value - offsets[index] };
  };
  const x = locate(point.x, grid.columns), y = locate(point.y, grid.rows);
  return { row: y.index, column: x.index, offsetX: x.offset, offsetY: y.offset };
}
export function spreadsheetDrawingBox(sheet: SpreadsheetSheet, drawing: SpreadsheetDrawing, grid: { columns: readonly number[]; rows: readonly number[] } = sheetDrawingGeometry(sheet)): ConnectorBox {
  const box = { ...anchorPoint(drawing.anchor, grid), width: drawing.width, height: drawing.height, rotation: drawing.rotation, flipX: drawing.flipX, flipY: drawing.flipY };
  if (drawing.type !== "shape" || isSpreadsheetLine(drawing)) return box;
  const inset = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, drawing.strokeWidth);
  const center = connectorLocalToWorld({ x: inset.x + inset.width / 2, y: inset.y + inset.height / 2 }, box);
  return { ...box, x: center.x - inset.width / 2, y: center.y - inset.height / 2, width: inset.width, height: inset.height };
}
export function spreadsheetDrawingOutline(drawing: SpreadsheetDrawing): ConnectorOutline | undefined {
  if (drawing.type !== "shape" || isSpreadsheetLine(drawing)) return;
  const geometry = getShapeDefinition(drawing.shape).geometry;
  if (geometry.type === "office") {
    const frame = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, drawing.strokeWidth);
    return getOfficeShapeOutline(geometry.preset, frame.width, frame.height);
  }
  if (geometry.type === "ellipse") return { type: "ellipse" };
  if (geometry.type === "polygon") return { type: "polygon", points: geometry.points.map(([x, y]) => ({ x, y })) };
  if (geometry.type === "rectangle" && geometry.rounded) {
    const frame = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, drawing.strokeWidth), radius = Math.min(frame.width, frame.height) * 16667 / 100000;
    return { type: "roundedRect", radiusX: frame.width ? radius / frame.width : 0, radiusY: frame.height ? radius / frame.height : 0 };
  }
}
export function normalizeStoredLine(input: SpreadsheetLine, sheet: Pick<SpreadsheetSheet, "rowCount" | "columnCount">): SpreadsheetLine {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "start" && key !== "end")) throw new Error("線の始点・終点が正しくありません");
  const endpoint = (value: SpreadsheetStoredLineEndpoint): SpreadsheetStoredLineEndpoint => {
    const anchor = value?.anchor, binding = value?.binding;
    if (!value || Object.keys(value).some(key => key !== "anchor" && key !== "binding") || !anchor || Object.keys(anchor).some(key => !["row", "column", "offsetX", "offsetY"].includes(key)) ||
      !Number.isInteger(anchor.row) || !Number.isInteger(anchor.column) || anchor.row < 0 || anchor.row >= sheet.rowCount || anchor.column < 0 || anchor.column >= sheet.columnCount ||
      ![anchor.offsetX, anchor.offsetY].every(n => Number.isFinite(n) && n >= -10_000 && n <= 10_000)) throw new Error("線の端点アンカーが正しくありません");
    if (binding !== undefined && (!binding || typeof binding !== "object" || Object.keys(binding).some(key => key !== "targetId" && key !== "port") ||
      typeof binding.targetId !== "string" || !binding.targetId || binding.targetId.length > 200 || binding.targetId.includes("\0") || !CONNECTOR_PORTS.includes(binding.port))) throw new Error("線の接続先が正しくありません");
    return Object.freeze({ anchor: Object.freeze({ ...anchor }), ...(binding ? { binding: Object.freeze({ ...binding }) } : {}) });
  };
  return Object.freeze({ start: endpoint(input.start), end: endpoint(input.end) });
}
export function validateLineBindings(drawings: readonly SpreadsheetDrawing[]) {
  const targets = new Map(drawings.map(drawing => [drawing.id, drawing]));
  for (const drawing of drawings) if (isSpreadsheetLine(drawing) && drawing.line) for (const endpoint of [drawing.line.start, drawing.line.end]) {
    if (!endpoint.binding) continue;
    const target = targets.get(endpoint.binding.targetId);
    if (!target || target === drawing || isSpreadsheetLine(target)) throw new Error("線の接続先には同じシートの線以外のオブジェクトを指定してください");
  }
}
/** Resolve binding against the current geometry; stored fallbacks never override live target ports. */
export function getSpreadsheetLinePoints(sheet: SpreadsheetSheet, drawingId: string, grid: { columns: readonly number[]; rows: readonly number[] } = sheetDrawingGeometry(sheet)): SpreadsheetLinePoints {
  const drawing = sheet.drawings?.find(item => item.id === drawingId);
  if (!drawing || !isSpreadsheetLine(drawing)) throw new Error("指定された線が見つかりません");
  if (drawing.line) {
    const resolve = (endpoint: SpreadsheetStoredLineEndpoint): ConnectorEndpoint => {
      if (endpoint.binding) {
        const target = sheet.drawings?.find(item => item.id === endpoint.binding!.targetId);
        if (!target || isSpreadsheetLine(target)) throw new Error("線の接続先が見つかりません");
        return { ...getConnectorPortPoint(spreadsheetDrawingBox(sheet, target, grid), endpoint.binding.port, spreadsheetDrawingOutline(target)), binding: endpoint.binding };
      }
      return anchorPoint(endpoint.anchor, grid);
    };
    return Object.freeze({ start: Object.freeze(resolve(drawing.line.start)), end: Object.freeze(resolve(drawing.line.end)) });
  }
  // Legacy SVG lines used inset endpoints, then frame reflection and rotation.
  const inset = Math.max(drawing.strokeWidth, 4), box = spreadsheetDrawingBox(sheet, drawing, grid);
  return Object.freeze({ start: Object.freeze(connectorLocalToWorld({ x: inset, y: inset }, box)),
    end: Object.freeze(connectorLocalToWorld({ x: Math.max(drawing.strokeWidth, drawing.width - (drawing.shape === "arrow" ? drawing.strokeWidth * 7 : drawing.strokeWidth)),
      y: Math.max(drawing.strokeWidth, drawing.height - (drawing.shape === "arrow" ? drawing.strokeWidth * 7 : drawing.strokeWidth)) }, box)) });
}
/** Recalculate the visible path from current endpoint anchors and bound target geometry. */
export function getSpreadsheetLineRoute(sheet: SpreadsheetSheet, drawingId: string,
  grid: { columns: readonly number[]; rows: readonly number[] } = sheetDrawingGeometry(sheet), preview?: SpreadsheetLinePoints) {
  const drawing = sheet.drawings?.find(item => item.id === drawingId);
  if (!drawing || !isSpreadsheetLine(drawing)) throw new Error("指定された線が見つかりません");
  const points = preview ?? getSpreadsheetLinePoints(sheet, drawingId, grid);
  const target = (endpoint: ConnectorEndpoint) => {
    const item = endpoint.binding && sheet.drawings?.find(candidate => candidate.id === endpoint.binding!.targetId);
    return item && !isSpreadsheetLine(item) ? { id: item.id, box: spreadsheetDrawingBox(sheet, item, grid), outline: spreadsheetDrawingOutline(item) } : undefined;
  };
  return getConnectorRoute(points.start, points.end, { routing: drawing.routing, startTarget: target(points.start), endTarget: target(points.end) });
}
/** Label position halfway along the rendered path, including any automatic bends. */
export function spreadsheetLineRouteMidpoint(points: readonly ConnectorPoint[]): ConnectorPoint {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  let distance = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (length && distance <= length) return { x: points[index].x + (points[index + 1].x - points[index].x) * distance / length,
      y: points[index].y + (points[index + 1].y - points[index].y) * distance / length };
    distance -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}
export function lineFromPoints(sheet: SpreadsheetSheet, points: SpreadsheetLinePoints): SpreadsheetLine {
  const grid: { columns: readonly number[]; rows: readonly number[] } = sheetDrawingGeometry(sheet);
  const convert = (point: ConnectorEndpoint): SpreadsheetStoredLineEndpoint => {
    if (!point || typeof point !== "object" || Object.keys(point).some(key => !["x", "y", "binding"].includes(key))) throw new Error("線の端点はx・yと任意のbindingで指定してください");
    const target = point.binding && sheet.drawings?.find(item => item.id === point.binding!.targetId);
    if (point.binding && (!target || isSpreadsheetLine(target))) throw new Error("線の接続先には同じシートの線以外のオブジェクトを指定してください");
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("線の端点は有限の座標で指定してください");
    const resolved = target ? getConnectorPortPoint(spreadsheetDrawingBox(sheet, target, grid), point.binding!.port, spreadsheetDrawingOutline(target)) : point;
    return { anchor: pointAnchor(resolved, grid), ...(point.binding !== undefined ? { binding: point.binding } : {}) };
  };
  return normalizeStoredLine({ start: convert(points.start), end: convert(points.end) }, sheet);
}
export function withLinePoints(sheet: SpreadsheetSheet, drawing: SpreadsheetShapeDrawing, points: SpreadsheetLinePoints): SpreadsheetShapeDrawing {
  const line = lineFromPoints(sheet, points), grid: { columns: readonly number[]; rows: readonly number[] } = sheetDrawingGeometry(sheet);
  const start = anchorPoint(line.start.anchor, grid), end = anchorPoint(line.end.anchor, grid);
  if (Math.abs(end.x - start.x) > 10_000 || Math.abs(end.y - start.y) > 10_000) throw new Error("線の幅・高さは10,000pxまでです");
  const rest = { ...drawing };
  delete rest.rotation; delete rest.flipX; delete rest.flipY;
  return { ...rest, anchor: pointAnchor({ x: Math.max(0, Math.min(start.x, end.x)), y: Math.max(0, Math.min(start.y, end.y)) }, grid),
    width: Math.max(1, Math.abs(end.x - start.x)), height: Math.max(1, Math.abs(end.y - start.y)), line };
}
export function detachLineTargets(sheet: SpreadsheetSheet, drawing: SpreadsheetDrawing, targets?: ReadonlySet<string>): SpreadsheetDrawing {
  if (!isSpreadsheetLine(drawing) || !drawing.line) return drawing;
  if (targets && ![drawing.line.start, drawing.line.end].some(endpoint => endpoint.binding && targets.has(endpoint.binding.targetId))) return drawing;
  const points = getSpreadsheetLinePoints(sheet, drawing.id);
  const free = (point: ConnectorEndpoint) => !targets || point.binding && targets.has(point.binding.targetId) ? { x: point.x, y: point.y } : point;
  return withLinePoints(sheet, drawing, { start: free(points.start), end: free(points.end) });
}

import { CONNECTOR_PORTS, connectorLocalToWorld, getConnectorPortPoint, isConnectorArrowhead, type ConnectorArrowhead, type ConnectorEndpoint } from "../core";
import { getOfficePresetConnectorPort } from "../ooxml";
import { isSpreadsheetLine, sheetDrawingGeometry, spreadsheetDrawingBox, spreadsheetDrawingOutline, withLinePoints } from "../model/lines";
import type { SpreadsheetDrawing, SpreadsheetLinePoints, SpreadsheetShapeDrawing, SpreadsheetSheet } from "../model/types";
import { EMU_PER_PIXEL, finiteNumber, type DrawingFrame } from "./drawing-geometry";
import { adjusted } from "./worksheet-shared";
import { importFailureMessage, rethrowImportFailure } from "./recovery";
import type { ImportContext } from "./types";
import { child, children, type XmlNode } from "./xml";

export type ImportedDrawingTarget = { id: string; custom: boolean; preset?: string; adjusted: boolean };
export type PendingDrawingConnector = { drawingId: string; label?: string; scope: string; points: SpreadsheetLinePoints; start?: XmlNode; end?: XmlNode };

/** Check the final coordinates, including rotation/rebasing or bound target ports,
 * before constructing a line. Native model limits still reject invalid input. */
export function importedLineBoundsIssue(points: SpreadsheetLinePoints, sheet: SpreadsheetSheet): string | undefined {
  const grid = sheetDrawingGeometry(sheet);
  for (const point of [points.start, points.end]) {
    if (![point.x, point.y].every(Number.isFinite)) return "線の端点が有限の座標ではありません";
    if (point.x < -10_000 || point.y < -10_000 || point.x > grid.columns[grid.columns.length - 2] + 10_000 || point.y > grid.rows[grid.rows.length - 2] + 10_000)
      return "線の端点がシートの対応範囲外です";
  }
  if (Math.abs(points.end.x - points.start.x) > 10_000 || Math.abs(points.end.y - points.start.y) > 10_000)
    return "線の幅・高さが10,000pxを超えています";
}

/** Native line transforms permit zero extents and signed positions, unlike shape frames. */
export function readConnectorFrame(transform: XmlNode | undefined, elbowRoute = false): DrawingFrame | undefined {
  const offset = child(transform, "off"), extent = child(transform, "ext");
  const x = (finiteNumber(offset?.attributes.x) ?? NaN) / EMU_PER_PIXEL, y = (finiteNumber(offset?.attributes.y) ?? NaN) / EMU_PER_PIXEL;
  const width = (finiteNumber(extent?.attributes.cx) ?? NaN) / EMU_PER_PIXEL, height = (finiteNumber(extent?.attributes.cy) ?? NaN) / EMU_PER_PIXEL;
  // A routed frame includes bends outside the endpoint frame. A 10,000px
  // endpoint span plus both rotated 10,000px targets and clearance fits 40,000px.
  // Endpoints still pass the normal model limits in withLinePoints after import.
  const maximumExtent = elbowRoute ? 40_000 : 10_000;
  if (![x, y, width, height].every(Number.isFinite) || x < -10000 || y < -10000 || width < 0 || height < 0 || width > maximumExtent || height > maximumExtent) return;
  return { x, y, width, height };
}
export function connectorPoints(frame: DrawingFrame, transform: XmlNode | undefined): SpreadsheetLinePoints {
  const box = { ...frame, rotation: (finiteNumber(transform?.attributes.rot) ?? 0) / 60000,
    flipX: ["1", "true"].includes(transform?.attributes.flipH ?? ""), flipY: ["1", "true"].includes(transform?.attributes.flipV ?? "") };
  return { start: connectorLocalToWorld({ x: 0, y: 0 }, box), end: connectorLocalToWorld({ x: frame.width, y: frame.height }, box) };
}
export function readLineArrow(line: XmlNode | undefined, endpoint: "headEnd" | "tailEnd", context: ImportContext, sheet: SpreadsheetSheet): ConnectorArrowhead {
  const value = child(line, endpoint)?.attributes.type ?? "none", normalized = value === "arrow" ? "openArrow" : value;
  if (isConnectorArrowhead(normalized)) return normalized;
  adjusted(context, sheet, "未対応の線端の矢印を三角の矢印へ近似しました");
  return "triangle";
}
export function presetHasAdjustments(preset: XmlNode | undefined): boolean {
  const guides = children(child(preset, "avLst"), "gd");
  // roundRect uses the same four cardinal connection sites for every radius.
  if (preset?.attributes.prst === "roundRect") return guides.some(item => item.attributes.name !== "adj" ||
    !/^val\s+[+-]?\d+(?:\.\d+)?$/.test(item.attributes.fmla ?? ""));
  return guides.length > 0;
}
/** Resolve Office IDs only after every target has been imported. Unknown sites detach with a warning. */
export function connectImportedDrawings(sheet: SpreadsheetSheet, drawings: SpreadsheetDrawing[], pending: PendingDrawingConnector[], targets: Map<string, ImportedDrawingTarget>, context: ImportContext): SpreadsheetDrawing[] {
  const resolve = (point: ConnectorEndpoint, reference: XmlNode | undefined, scope: string, label: string): ConnectorEndpoint => {
    if (!reference) return point;
    const target = targets.get(`${scope}:${reference.attributes.id}`), drawing = target && drawings.find(item => item.id === target.id);
    const index = finiteNumber(reference.attributes.idx);
    const port = index !== undefined && Number.isInteger(index) && index >= 0 && target && !target.adjusted
      ? target.custom ? CONNECTOR_PORTS[index] : getOfficePresetConnectorPort(target.preset ?? "", index) : undefined;
    if (!target || !drawing || isSpreadsheetLine(drawing) || !port) {
      adjusted(context, sheet, `${label}: 未対応・不正な接続先または接続点を持つ線は端点の位置を保って接続を解除しました`);
      return point;
    }
    return { ...getConnectorPortPoint(spreadsheetDrawingBox(sheet, drawing), port, spreadsheetDrawingOutline(drawing)), binding: { targetId: target.id, port } };
  };
  const records = new Map(pending.map(item => [item.drawingId, item]));
  return drawings.map(drawing => {
    const record = records.get(drawing.id);
    if (!record) return drawing;
    const label = record.label ?? `描画オブジェクト「${drawing.id}」`;
    try {
      const points = {
        start: resolve(record.points.start, record.start, record.scope, label), end: resolve(record.points.end, record.end, record.scope, label),
      };
      const issue = importedLineBoundsIssue(points, sheet);
      if (issue) {
        adjusted(context, sheet, `${label}: ${issue}。取り込み前の端点の位置を保って接続を解除しました`);
        return drawing;
      }
      return withLinePoints({ ...sheet, drawings }, drawing as SpreadsheetShapeDrawing, points);
    } catch (error) {
      rethrowImportFailure(error, context);
      adjusted(context, sheet, `${label}: 接続情報が正しくないため、元の端点を保持して接続を解除しました: ${importFailureMessage(error)}`);
      return drawing;
    }
  });
}

import { getConnectorPortPoint, getConnectorRoute, isConnectorPort, isConnectorArrowhead, type ConnectorEndpoint } from "./core-connectors";
import { getOfficeShapeOutline } from "./core-office-shapes";
import { normalizeShapeAttributes, shapeAttributeKeys } from "./shape-attributes";
import { color, identifier, number, record, choice } from "./validation";
import type { DocumentCanvasAttributes, DocumentCanvasShape, DocumentCanvasConnector, DocumentCanvasCommand } from "./types";
export type NormalizedDocumentCanvas = { width: number; height: number; shapes: DocumentCanvasShape[]; connectors: DocumentCanvasConnector[] };
export const canvasAttributeKeys = ["id", "width", "height", "shapes", "connectors"];
const connectorKeys = ["id", "start", "end", "routing", "stroke", "strokeWidth", "startArrow", "endArrow"];
export function getDocumentCanvasTarget(shape: DocumentCanvasShape) {
  const input = record(shape, "Canvas target", [...shapeAttributeKeys, "x", "y"]);
  const attrs = normalizeShapeAttributes(Object.fromEntries(Object.entries(input).filter(([key]) => key !== "x" && key !== "y")));
  return { id: identifier(shape.id), box: { x: number(shape.x, "Shape x", -16384, 32768), y: number(shape.y, "Shape y", -16384, 32768), width: attrs.width!, height: attrs.height!, rotation: attrs.rotation, flipX: attrs.flipH, flipY: attrs.flipV }, outline: getOfficeShapeOutline(attrs.preset, attrs.width!, attrs.height!) };
}
function endpoint(input: unknown, shapes: DocumentCanvasShape[]): ConnectorEndpoint {
  const value = record(input, "Connector endpoint", ["x", "y", "binding"]);
  const point = { x: number(value.x, "Connector x", -1_000_000, 1_000_000), y: number(value.y, "Connector y", -1_000_000, 1_000_000) };
  if (value.binding === undefined) return point;
  const binding = record(value.binding, "Connector binding", ["targetId", "port"]), targetId = identifier(binding.targetId);
  if (!isConnectorPort(binding.port)) throw new Error("Connector port is unsupported.");
  const target = shapes.find(shape => shape.id === targetId); if (!target) throw new Error("A connector must bind to a shape in the same canvas.");
  const { box, outline } = getDocumentCanvasTarget(target);
  return { ...getConnectorPortPoint(box, binding.port, outline), binding: { targetId, port: binding.port } };
}
export function normalizeCanvasAttributes(input: unknown): NormalizedDocumentCanvas {
  const value = record(input, "Drawing canvas", canvasAttributeKeys);
  const width = number(value.width ?? 600, "Canvas width", 1, 16384), height = number(value.height ?? 360, "Canvas height", 1, 16384);
  const ids = new Set<string>();
  const id = (input: unknown) => { const result = identifier(input); if (ids.has(result)) throw new Error("Canvas element IDs must be unique."); ids.add(result); return result; };
  const array = (input: unknown, name: string) => { if (!Array.isArray(input) || input.length > 500) throw new Error(`${name} must contain at most 500 elements.`); return input; };
  const shapes = array(value.shapes ?? [], "Canvas shapes").map(input => {
    const shape = record(input, "Canvas shape", [...shapeAttributeKeys, "x", "y"]);
    const attrs = Object.fromEntries(Object.entries(shape).filter(([key]) => key !== "x" && key !== "y"));
    return { ...normalizeShapeAttributes(attrs), id: id(shape.id), x: number(shape.x, "Shape x", -16384, 32768), y: number(shape.y, "Shape y", -16384, 32768) };
  });
  const connectors = array(value.connectors ?? [], "Canvas connectors").map(input => {
    const line = record(input, "Canvas connector", connectorKeys);
    for (const key of ["startArrow", "endArrow"]) if (line[key] !== undefined && !isConnectorArrowhead(line[key])) throw new Error("Connector arrowhead is unsupported.");
    return { id: id(line.id), start: endpoint(line.start, shapes), end: endpoint(line.end, shapes), routing: choice(line.routing ?? "elbow", ["straight", "elbow"], "Connector routing"), stroke: color(line.stroke ?? "#334155"), strokeWidth: number(line.strokeWidth ?? 2, "Connector stroke width", 0, 100), startArrow: line.startArrow as DocumentCanvasConnector["startArrow"] ?? "none", endArrow: line.endArrow as DocumentCanvasConnector["endArrow"] ?? "triangle" };
  });
  return { width, height, shapes, connectors };
}
/** Resolve current bindings before routing, including while the caller previews a shape move. */
export function getDocumentCanvasConnectorRoute(canvas: DocumentCanvasAttributes, connector: DocumentCanvasConnector) {
  const shapes = canvas.shapes ?? [], start = endpoint(connector.start, shapes), end = endpoint(connector.end, shapes);
  const target = (point: ConnectorEndpoint) => { const shape = shapes.find(shape => shape.id === point.binding?.targetId); return shape ? getDocumentCanvasTarget(shape) : undefined; };
  return getConnectorRoute(start, end, { routing: connector.routing ?? "elbow", startTarget: target(start), endTarget: target(end) });
}
export function applyCanvasCommand(attrs: DocumentCanvasAttributes, command: Exclude<DocumentCanvasCommand, { type: "canvas.insert" }>): NormalizedDocumentCanvas {
  const canvas = normalizeCanvasAttributes(attrs);
  if (command.type === "canvas.update") return normalizeCanvasAttributes({ ...canvas, ...(command.width !== undefined ? { width: command.width } : {}), ...(command.height !== undefined ? { height: command.height } : {}) });
  if (command.type === "canvas.shape.insert") { record(command.shape, "Canvas shape", [...shapeAttributeKeys, "x", "y"]); canvas.shapes.push({ ...command.shape, id: command.shape.id ?? crypto.randomUUID() }); }
  else if (command.type === "canvas.connector.insert") { record(command.connector, "Canvas connector", connectorKeys); canvas.connectors.push({ ...command.connector, id: command.connector.id ?? crypto.randomUUID() }); }
  else {
    const isShape = command.type.startsWith("canvas.shape."), elements = isShape ? canvas.shapes : canvas.connectors;
    const index = elements.findIndex(item => item.id === identifier(command.id)); if (index < 0) throw new Error("Canvas element was not found.");
    if (command.type.endsWith(".delete")) {
      elements.splice(index, 1);
      if (isShape) canvas.connectors = canvas.connectors.map(line => ({ ...line,
        start: line.start.binding?.targetId === command.id ? { x: line.start.x, y: line.start.y } : line.start,
        end: line.end.binding?.targetId === command.id ? { x: line.end.x, y: line.end.y } : line.end }));
    } else if ("patch" in command) {
      record(command.patch, "Canvas element patch", isShape ? [...shapeAttributeKeys.filter(key => key !== "id"), "x", "y"] : connectorKeys.filter(key => key !== "id"));
      const patch = Object.fromEntries(Object.entries(command.patch).filter(([, value]) => value !== undefined));
      elements[index] = { ...elements[index], ...patch } as DocumentCanvasShape & DocumentCanvasConnector;
    }
  }
  return normalizeCanvasAttributes(canvas);
}

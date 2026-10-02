import { getOfficeShapeOutline } from "./core-office-shapes";
import { getSlideOfficeShapePreset } from "./shapes";
import { connectorLocalToWorld, getConnectorBounds, getConnectorPortPoint, CONNECTOR_PORTS } from "./core-connectors";
import type { ConnectorEndpoint, ConnectorOutline } from "./core-connectors";
import type { SlideElement, SlideElementBase, SlideLineGeometry, SlideShapeElement } from "./types";
import { choice, identifier, number, record } from "./validation";

export function isSlideLine(element: SlideElement): element is SlideShapeElement & { shape: "line" } { return element.type === "shape" && element.shape === "line"; }
/** Local outline used by snapping, live attachment resolution and Office connections. */
export function getSlideConnectorOutline(element: SlideElement): ConnectorOutline | undefined {
  if (element.type !== "shape") return undefined;
  if (element.shape === "ellipse") return { type: "ellipse" };
  if (element.shape === "roundRect") { const radius = Math.min(element.width, element.height) * .12; return { type: "roundedRect", radiusX: radius / element.width, radiusY: radius / element.height }; }
  const points = element.shape === "triangle" ? [[.5, 0], [1, 1], [0, 1]]
    : element.shape === "diamond" ? [[.5, 0], [1, .5], [.5, 1], [0, .5]]
    : (element.shape === "arrow" || element.shape === "leftArrow") ? [[0, .28], [.65, .28], [.65, 0], [1, .5], [.65, 1], [.65, .72], [0, .72]] : undefined;
  if (points) return { type: "polygon", points: points.map(([x, y]) => ({ x: element.shape === "leftArrow" ? 1 - x : x, y })) };
  return element.shape === "line" || element.shape === "rect" ? undefined : getOfficeShapeOutline(getSlideOfficeShapePreset(element.shape), element.width, element.height);
}
export function normalizeSlideLineEndpoint(input: unknown): ConnectorEndpoint {
  const raw = record(input, "線の端点", ["x", "y", "binding"]);
  const point = { x: number(raw.x, "端点X座標", -100000, 100000), y: number(raw.y, "端点Y座標", -100000, 100000) };
  if (raw.binding === undefined) return Object.freeze(point);
  const binding = record(raw.binding, "線の接続", ["targetId", "port"]);
  return Object.freeze({ ...point, binding: Object.freeze({ targetId: identifier(binding.targetId), port: choice(binding.port, CONNECTOR_PORTS, "接続点") }) });
}
export function normalizeSlideLine(input: unknown): SlideLineGeometry {
  const raw = record(input, "線の端点", ["start", "end"]);
  const line = { start: normalizeSlideLineEndpoint(raw.start), end: normalizeSlideLineEndpoint(raw.end) };
  const bounds = getConnectorBounds(line.start, line.end);
  if (bounds.width > 100000 || bounds.height > 100000) throw new Error("線の幅・高さは100,000px以下にしてください");
  return Object.freeze(line);
}
/** Legacy diagonal rectangles retain their original rendered endpoints until explicitly edited. */
export function getSlideLineEndpoints(element: SlideShapeElement): SlideLineGeometry {
  if (element.shape !== "line") throw new Error("線を指定してください");
  if (element.line) return element.line;
  const pad = element.strokeWidth / 2;
  return { start: connectorLocalToWorld({ x: pad, y: pad }, element),
    end: connectorLocalToWorld({ x: element.width - pad, y: element.height - pad }, element) };
}
export function slideLineGeometry(line: SlideLineGeometry): Pick<SlideElementBase, "x" | "y" | "width" | "height" | "rotation"> {
  const bounds = getConnectorBounds(line.start, line.end);
  // Keep positive legacy dimensions while permitting horizontal, vertical and point lines.
  return { ...bounds, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), rotation: 0 };
}
/** Shared normalization/preview path; bindings can only target non-line elements on this page. */
export function resolveSlideLines(elements: readonly SlideElement[], detachMissing = false): SlideElement[] {
  const targets = new Map(elements.map(element => [element.id, element]));
  return elements.map(element => {
    if (!isSlideLine(element) || !element.line) return element;
    const endpoint = (point: ConnectorEndpoint): ConnectorEndpoint => {
      if (!point.binding) return point;
      const target = targets.get(point.binding.targetId);
      if (!target && detachMissing) return { x: point.x, y: point.y };
      if (!target || isSlideLine(target)) throw new Error("線の接続先は同じスライド内の線以外の要素にしてください");
      const position = getConnectorPortPoint(target, point.binding.port, getSlideConnectorOutline(target));
      return { ...position, binding: point.binding };
    };
    const line = normalizeSlideLine({ start: endpoint(element.line.start), end: endpoint(element.line.end) });
    const geometry = slideLineGeometry(line);
    if (JSON.stringify(line) === JSON.stringify(element.line) && Object.entries(geometry).every(([key, value]) => Reflect.get(element, key) === value)) return element;
    return { ...element, ...geometry, line };
  });
}
/** Moving a whole line detaches it; moving its targets preserves and resolves their attachments. */
export function transformSlideLine(element: SlideShapeElement, geometry: Pick<SlideElementBase, "x" | "y" | "width" | "height" | "rotation">): SlideLineGeometry {
  const line = getSlideLineEndpoints(element);
  if (!element.line) {
    return getSlideLineEndpoints({ ...element, ...geometry });
  }
  const map = (point: ConnectorEndpoint) => connectorLocalToWorld({
    x: (point.x - element.x) * geometry.width / element.width,
    y: (point.y - element.y) * geometry.height / element.height,
  }, geometry);
  return normalizeSlideLine({ start: map(line.start), end: map(line.end) });
}
/** A group translation preserves only attachments to targets translated in the same gesture. */
export function translateSlideLine(element: SlideShapeElement, dx: number, dy: number, movingIds: ReadonlySet<string>): SlideLineGeometry {
  const previous = getSlideLineEndpoints(element);
  const point = (endpoint: ConnectorEndpoint): ConnectorEndpoint => ({ x: endpoint.x + dx, y: endpoint.y + dy,
    ...(endpoint.binding && movingIds.has(endpoint.binding.targetId) ? { binding: endpoint.binding } : {}) });
  return normalizeSlideLine({ start: point(previous.start), end: point(previous.end) });
}
/** Copy only internal attachments; external targets remain detached at their current coordinates. */
export function copySlideLine(element: SlideElement, remap: ReadonlyMap<string, string>, offset = 0): SlideElement {
  const base = { ...element, id: remap.get(element.id) ?? element.id, x: element.x + offset, y: element.y + offset };
  if (!isSlideLine(element) || !element.line) return base;
  const endpoint = (point: ConnectorEndpoint): ConnectorEndpoint => ({ x: point.x + offset, y: point.y + offset,
    ...(point.binding && remap.has(point.binding.targetId) ? { binding: { ...point.binding, targetId: remap.get(point.binding.targetId)! } } : {}) });
  const line = { start: endpoint(element.line.start), end: endpoint(element.line.end) };
  return { ...element, id: base.id, ...slideLineGeometry(line), line };
}

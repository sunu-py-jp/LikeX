import type { DOMOutputSpec } from "prosemirror-model";
import { getOfficeShapeGeometry } from "./core-office-shapes";
import { getDocumentCanvasConnectorRoute } from "./canvas";
import type { DocumentCanvasAttributes, DocumentCanvasConnector, DocumentCanvasShape } from "./types";
export function canvasLinePath(points: readonly { x: number; y: number }[]): string { return points.map((point, i) => `${i ? "L" : "M"}${point.x} ${point.y}`).join(" "); }
export function canvasArrowPath(kind: DocumentCanvasConnector["endArrow"]): string {
  if (kind === "openArrow") return "M0 0 L8 4 L0 8";
  if (kind === "diamond") return "M0 4 L4 0 L8 4 L4 8 Z";
  if (kind === "oval") return "M0 4 C0 -1.33 8 -1.33 8 4 C8 9.33 0 9.33 0 4 Z";
  return kind === "stealth" ? "M0 0 L8 4 L0 8 L2 4 Z" : "M0 0 L8 4 L0 8 Z";
}
export function canvasShapeTransform(shape: DocumentCanvasShape): string {
  return `translate(${shape.x} ${shape.y}) translate(${shape.width! / 2} ${shape.height! / 2}) rotate(${shape.rotation ?? 0}) scale(${shape.flipH ? -1 : 1} ${shape.flipV ? -1 : 1}) translate(${-shape.width! / 2} ${-shape.height! / 2})`;
}
const svg = (tag: string) => `http://www.w3.org/2000/svg ${tag}`;
export function canvasDom(attrs: Record<string, unknown>): DOMOutputSpec {
  const canvas = attrs as DocumentCanvasAttributes, shapes = canvas.shapes ?? [], connectors = canvas.connectors ?? [];
  const prefix = `lxd-canvas-${encodeURIComponent(String(attrs.id ?? "preview"))}`;
  const markers: DOMOutputSpec[] = [], lines: DOMOutputSpec[] = [];
  for (const [index, line] of connectors.entries()) {
    const route = getDocumentCanvasConnectorRoute(canvas, line), ends: Record<string, string> = {};
    for (const end of ["start", "end"] as const) {
      const kind = end === "start" ? line.startArrow : line.endArrow;
      if (!kind || kind === "none") continue;
      const id = `${prefix}-${index}-${end}`; ends[`marker-${end}`] = `url(#${id})`;
      markers.push([svg("marker"), { id, viewBox: "0 0 8 8", refX: 8, refY: 4, markerWidth: 8, markerHeight: 8, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" }, [svg("path"), { d: canvasArrowPath(kind), fill: kind === "openArrow" ? "none" : line.stroke, stroke: line.stroke, "stroke-width": 1.2 }]]);
    }
    lines.push([svg("path"), { d: canvasLinePath(route.points), fill: "none", stroke: line.stroke, "stroke-width": line.strokeWidth, ...ends }]);
  }
  const content: DOMOutputSpec[] = shapes.map(shape => {
    const geometry = getOfficeShapeGeometry(shape.preset, shape.width!, shape.height!), rect = geometry.textRect, text = (shape.text ?? "").split("\n"), size = (shape.fontSize ?? 14) * 4 / 3;
    return [svg("g"), { transform: canvasShapeTransform(shape) }, ...geometry.paths.map(path => [svg("path"), { d: path.d, fill: path.fill === false ? "none" : shape.fill ?? "none", stroke: path.stroke === false ? "none" : shape.stroke ?? "none", "stroke-width": shape.strokeWidth }] as DOMOutputSpec),
      [svg("text"), { "text-anchor": "middle", fill: shape.color, "font-size": size, "font-family": "sans-serif" }, ...text.map((line, index) => [svg("tspan"), { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + (index - (text.length - 1) / 2) * size * 1.2, "dominant-baseline": "middle" }, line] as DOMOutputSpec)]];
  });
  return ["div", { class: "lxd-drawing-canvas", "data-document-canvas": "true", "data-document-id": attrs.id, "data-canvas-attrs": JSON.stringify(attrs), contenteditable: "false", role: "img", "aria-label": `描画キャンバス（図形${shapes.length}個、接続線${connectors.length}本）`, style: `width:${canvas.width}px;max-width:100%` },
    [svg("svg"), { viewBox: `0 0 ${canvas.width} ${canvas.height}`, width: canvas.width, height: canvas.height, style: "display:block;width:100%;height:auto;background:#fff;border:1px solid #d0d8e1" }, [svg("defs"), ...markers], ...lines, ...content]];
}

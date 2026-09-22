import { normalizeDiagram } from "./model";
import { xml } from "./validation";
import type { DiagramModel, DiagramNode } from "./types";

export function getDiagramEdgeGeometry(source: DiagramNode, target: DiagramNode) {
  const boundary = (node: DiagramNode, other: DiagramNode) => {
    const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
    let dx = other.x + other.width / 2 - cx; const dy = other.y + other.height / 2 - cy;
    if (dx === 0 && dy === 0) dx = node.id < other.id ? 1 : -1;
    const x = Math.abs(dx) / (node.width / 2), y = Math.abs(dy) / (node.height / 2);
    const scale = node.shape === "ellipse" ? 1 / Math.sqrt(x * x + y * y) : node.shape === "diamond" ? 1 / (x + y) : 1 / Math.max(x, y);
    return { x: cx + dx * scale, y: cy + dy * scale };
  };
  const start = boundary(source, target), end = boundary(target, source);
  return { start, end, label: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 8 } };
}
export function getDiagramBounds(input: DiagramModel) {
  const { nodes } = normalizeDiagram(input);
  if (!nodes.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const x = Math.min(...nodes.map(node => node.x)) - 40, y = Math.min(...nodes.map(node => node.y)) - 40;
  return { x, y, width: Math.max(...nodes.map(node => node.x + node.width)) - x + 40, height: Math.max(...nodes.map(node => node.y + node.height)) - y + 40 };
}
export function diagramTextLines(text: string, width: number): string[] {
  const limit = Math.max(4, Math.floor(width / 14)), result: string[] = [];
  for (const line of text.split("\n")) { const chars = [...line]; if (!chars.length) result.push(""); else for (let index = 0; index < chars.length; index += limit) result.push(chars.slice(index, index + limit).join("")); }
  return result;
}
/** Standalone static SVG; no foreignObject, external resources or executable content. */
export function exportDiagramSvg(input: DiagramModel): string {
  const model = normalizeDiagram(input), bounds = getDiagramBounds(model), nodes = new Map(model.nodes.map(node => [node.id, node]));
  const edges = model.edges.map(edge => { const { start, end, label } = getDiagramEdgeGeometry(nodes.get(edge.sourceId)!, nodes.get(edge.targetId)!); return `<g><path d="M ${start.x} ${start.y} L ${end.x} ${end.y}" fill="none" stroke="${edge.color}" stroke-width="2" marker-end="url(#arrow)"/><text x="${label.x}" y="${label.y}" text-anchor="middle" fill="${edge.color}" font-size="13">${xml(edge.label)}</text></g>`; }).join("");
  const shapes = model.nodes.map(node => { const attrs = `fill="${node.fill}" stroke="${node.stroke}" stroke-width="1.5"`; const shape = node.shape === "ellipse" ? `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" ${attrs}/>` : node.shape === "diamond" ? `<polygon points="${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}" ${attrs}/>` : `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" ${attrs}/>`;
    const lines = diagramTextLines(node.text, node.width * (node.shape === "diamond" ? .6 : .85));
    return `<g>${shape}<text text-anchor="middle" fill="${node.textColor}" font-family="Arial,sans-serif" font-size="14">${lines.map((line, index) => `<tspan x="${node.x + node.width / 2}" y="${node.y + node.height / 2 + (index - (lines.length - 1) / 2) * 19 + 5}">${xml(line)}</tspan>`).join("")}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img"><title>${xml(model.title)}</title><defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M 0 0 L 10 4 L 0 8 Z" fill="context-stroke"/></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${edges}${shapes}</svg>`;
}

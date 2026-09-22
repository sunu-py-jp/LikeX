import { serializeStableJson } from "../json";
import { color, choice, freeze, id, number, object, string } from "./validation";
import type { DiagramEdge, DiagramEdgeInput, DiagramInput, DiagramModel, DiagramNode, DiagramNodeInput } from "./types";

export const DIAGRAM_LIMITS = Object.freeze({ nodes: 5000, edges: 10000, jsonLength: 8 * 1024 * 1024 });
export function createDiagramNode(input: DiagramNodeInput = {}): DiagramNode {
  const value = object(input, "Node", ["id", "shape", "text", "x", "y", "width", "height", "fill", "stroke", "textColor"]);
  return freeze({ id: id(value.id ?? crypto.randomUUID()), shape: choice(value.shape ?? "rectangle", ["rectangle", "ellipse", "diamond"]), text: string(value.text ?? "ノード"), x: number(value.x ?? 100), y: number(value.y ?? 100), width: number(value.width ?? 180, 30, 5000), height: number(value.height ?? 90, 30, 5000), fill: color(value.fill ?? "#ffffff"), stroke: color(value.stroke ?? "#536b88"), textColor: color(value.textColor ?? "#263548") });
}
export function createDiagramEdge(input: DiagramEdgeInput): DiagramEdge {
  const value = object(input, "Edge", ["id", "sourceId", "targetId", "label", "color"]);
  return freeze({ id: id(value.id ?? crypto.randomUUID()), sourceId: id(value.sourceId), targetId: id(value.targetId), label: string(value.label ?? "", 1000), color: color(value.color ?? "#536b88") });
}
export function normalizeDiagram(input: unknown): DiagramModel {
  const value = object(input, "Diagram", ["format", "version", "id", "title", "nodes", "edges"]);
  if (value.format !== "likex.diagram" || value.version !== 1) throw new Error("Unsupported LikeDiagram format or version.");
  if (!Array.isArray(value.nodes) || value.nodes.length > DIAGRAM_LIMITS.nodes || !Array.isArray(value.edges) || value.edges.length > DIAGRAM_LIMITS.edges) throw new Error("Diagram exceeds its element limits.");
  const nodes = value.nodes.map(node => { const result = createDiagramNode(node); if (node.id == null) throw new Error("Nodes must have IDs."); return result; });
  const edges = value.edges.map(edge => { const result = createDiagramEdge(edge); if (edge.id == null) throw new Error("Edges must have IDs."); return result; });
  const ids = new Set(nodes.map(node => node.id));
  if (ids.size !== nodes.length || new Set([...ids, ...edges.map(edge => edge.id)]).size !== nodes.length + edges.length) throw new Error("Node and edge IDs must be unique.");
  for (const edge of edges) if (!ids.has(edge.sourceId) || !ids.has(edge.targetId) || edge.sourceId === edge.targetId) throw new Error("Edges require two different existing nodes.");
  return freeze({ format: "likex.diagram", version: 1, id: id(value.id), title: string(value.title, 1000), nodes, edges });
}
export function createDiagram(input: DiagramInput = {}): DiagramModel {
  object(input, "Diagram input", ["id", "title", "nodes", "edges"]);
  return normalizeDiagram({ format: "likex.diagram", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "無題のダイアグラム", nodes: (input.nodes ?? []).map(createDiagramNode), edges: (input.edges ?? []).map(createDiagramEdge) });
}
export function serializeDiagram(model: DiagramModel): string { return serializeStableJson(normalizeDiagram(model), { space: 2, maxLength: DIAGRAM_LIMITS.jsonLength }) + "\n"; }
export function parseDiagram(json: string): DiagramModel { if (typeof json !== "string" || json.length > DIAGRAM_LIMITS.jsonLength) throw new Error("Diagram JSON exceeds its size limit."); return normalizeDiagram(JSON.parse(json)); }
export function getDiagramNode(model: DiagramModel, nodeId: string): DiagramNode | undefined { return normalizeDiagram(model).nodes.find(node => node.id === nodeId); }
export function getDiagramEdge(model: DiagramModel, edgeId: string): DiagramEdge | undefined { return normalizeDiagram(model).edges.find(edge => edge.id === edgeId); }

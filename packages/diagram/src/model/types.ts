export type DiagramShape = "rectangle" | "ellipse" | "diamond";
export type DiagramNode = { id: string; shape: DiagramShape; text: string; x: number; y: number; width: number; height: number; fill: string; stroke: string; textColor: string };
export type DiagramEdge = { id: string; sourceId: string; targetId: string; label: string; color: string };
export type DiagramModel = { format: "likex.diagram"; version: 1; id: string; title: string; nodes: DiagramNode[]; edges: DiagramEdge[] };
export type DiagramNodeInput = Partial<DiagramNode>;
export type DiagramEdgeInput = Partial<DiagramEdge> & Pick<DiagramEdge, "sourceId" | "targetId">;
export type DiagramInput = Partial<Pick<DiagramModel, "id" | "title">> & { nodes?: DiagramNodeInput[]; edges?: DiagramEdgeInput[] };
export type DiagramCommand =
  | { type: "node.add"; node: DiagramNodeInput }
  | { type: "node.update"; id: string; patch: Partial<Omit<DiagramNode, "id">> }
  | { type: "node.remove"; ids: readonly string[] }
  | { type: "nodes.order"; ids: readonly string[]; position: "front" | "back" }
  | { type: "edges.order"; ids: readonly string[]; position: "front" | "back" }
  | { type: "nodes.move"; ids: readonly string[]; dx: number; dy: number }
  | { type: "nodes.align"; ids: readonly string[]; alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" }
  | { type: "edge.add"; edge: DiagramEdgeInput }
  | { type: "edge.update"; id: string; patch: Partial<Omit<DiagramEdge, "id">> }
  | { type: "edge.remove"; ids: readonly string[] }
  | { type: "diagram.update"; title: string }
  | { type: "diagram.replace"; model: DiagramModel };

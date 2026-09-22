import { createDiagramEdge, createDiagramNode, normalizeDiagram } from "./model";
import { choice, identifiers, number, object } from "./validation";
import type { DiagramCommand, DiagramModel } from "./types";

export const MAX_DIAGRAM_COMMANDS = 10000;

/** Apply a complete batch immutably; any invalid command rejects the entire batch. */
export function executeDiagramCommands(input: DiagramModel, commands: DiagramCommand | readonly DiagramCommand[]): DiagramModel {
  let model = normalizeDiagram(input);
  const list = Array.isArray(commands) ? commands : [commands];
  if (list.length > MAX_DIAGRAM_COMMANDS) throw new Error("Too many commands.");
  for (const command of list as readonly DiagramCommand[]) {
    const value = object(command, "Command", ["type", "node", "edge", "id", "ids", "patch", "dx", "dy", "alignment", "position", "title", "model"]);
    if (value.type === "diagram.replace") { model = normalizeDiagram(value.model); continue; }
    let nodes = [...model.nodes], edges = [...model.edges], title = model.title;
    switch (command.type) {
      case "node.add": nodes.push(createDiagramNode(command.node)); break;
      case "node.update": { const node = nodes.find(node => node.id === command.id); if (!node) throw new Error("Node not found."); object(command.patch, "Node patch", ["shape", "text", "x", "y", "width", "height", "fill", "stroke", "textColor"]); nodes = nodes.map(item => item.id === command.id ? createDiagramNode({ ...item, ...command.patch }) : item); break; }
      case "node.remove": { const ids = identifiers(command.ids); if (ids.some(id => !nodes.some(node => node.id === id))) throw new Error("Node not found."); nodes = nodes.filter(node => !ids.includes(node.id)); edges = edges.filter(edge => !ids.includes(edge.sourceId) && !ids.includes(edge.targetId)); break; }
      case "nodes.move": { const ids = identifiers(command.ids), dx = number(command.dx), dy = number(command.dy); if (ids.some(id => !nodes.some(node => node.id === id))) throw new Error("Node not found."); nodes = nodes.map(node => ids.includes(node.id) ? createDiagramNode({ ...node, x: node.x + dx, y: node.y + dy }) : node); break; }
      case "nodes.align": { const ids = identifiers(command.ids), alignment = choice(command.alignment, ["left", "center", "right", "top", "middle", "bottom"]); if (ids.some(id => !nodes.some(node => node.id === id))) throw new Error("Node not found."); const selected = nodes.filter(node => ids.includes(node.id)); const left = Math.min(...selected.map(n => n.x)), right = Math.max(...selected.map(n => n.x + n.width)), top = Math.min(...selected.map(n => n.y)), bottom = Math.max(...selected.map(n => n.y + n.height)); nodes = nodes.map(node => !ids.includes(node.id) ? node : createDiagramNode({ ...node, ...(alignment === "left" ? { x: left } : alignment === "right" ? { x: right - node.width } : alignment === "center" ? { x: (left + right - node.width) / 2 } : alignment === "top" ? { y: top } : alignment === "bottom" ? { y: bottom - node.height } : { y: (top + bottom - node.height) / 2 }) })); break; }
      case "nodes.order": case "edges.order": {
        const ids = identifiers(command.ids), position = choice(command.position, ["front", "back"]);
        const reorder = <T extends { id: string }>(items: T[]): T[] => {
          if (ids.some(id => !items.some(item => item.id === id))) throw new Error("Element not found.");
          const selected = items.filter(item => ids.includes(item.id)), other = items.filter(item => !ids.includes(item.id));
          return position === "front" ? [...other, ...selected] : [...selected, ...other];
        };
        if (command.type === "nodes.order") nodes = reorder(nodes); else edges = reorder(edges);
        break;
      }
      case "edge.add": edges.push(createDiagramEdge(command.edge)); break;
      case "edge.update": { if (!edges.some(edge => edge.id === command.id)) throw new Error("Edge not found."); object(command.patch, "Edge patch", ["sourceId", "targetId", "label", "color"]); edges = edges.map(edge => edge.id === command.id ? createDiagramEdge({ ...edge, ...command.patch }) : edge); break; }
      case "edge.remove": { const ids = identifiers(command.ids); if (ids.some(id => !edges.some(edge => edge.id === id))) throw new Error("Edge not found."); edges = edges.filter(edge => !ids.includes(edge.id)); break; }
      case "diagram.update": title = command.title; break;
      default: throw new Error("Unsupported diagram command.");
    }
    model = normalizeDiagram({ ...model, title, nodes, edges });
  }
  return model;
}

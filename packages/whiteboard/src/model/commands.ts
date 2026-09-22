import { createWhiteboardElement, normalizeWhiteboard } from "./model";
import { choice, identifiers, number, object } from "./validation";
import type { WhiteboardCommand, WhiteboardElementInput, WhiteboardModel } from "./types";

/** JSON-only atomic commands; array order is the front-to-back painting order. */
export const MAX_WHITEBOARD_COMMANDS = 10000;

export function executeWhiteboardCommands(input: WhiteboardModel, commands: WhiteboardCommand | readonly WhiteboardCommand[]): WhiteboardModel {
  let model = normalizeWhiteboard(input);
  const list = Array.isArray(commands) ? commands : [commands];
  if (list.length > MAX_WHITEBOARD_COMMANDS) throw new Error("Too many commands.");
  for (const command of list as readonly WhiteboardCommand[]) {
    object(command, "Command", ["type", "element", "id", "ids", "patch", "dx", "dy", "alignment", "position", "title", "model"]);
    if (command.type === "whiteboard.replace") { model = normalizeWhiteboard(command.model); continue; }
    let elements = [...model.elements], title = model.title;
    switch (command.type) {
      case "element.add": elements.push(createWhiteboardElement(command.element)); break;
      case "element.update": { const existing = elements.find(element => element.id === command.id); if (!existing) throw new Error("Element not found."); object(command.patch, "Element patch", ["text", "src", "alt", "x", "y", "width", "height", "fill", "stroke", "textColor", "fontSize"]); elements = elements.map(element => element.id === command.id ? createWhiteboardElement({ ...element, ...command.patch } as WhiteboardElementInput) : element); break; }
      case "element.remove": { const ids = identifiers(command.ids); if (ids.some(id => !elements.some(element => element.id === id))) throw new Error("Element not found."); elements = elements.filter(element => !ids.includes(element.id)); break; }
      case "elements.move": { const ids = identifiers(command.ids), dx = number(command.dx), dy = number(command.dy); if (ids.some(id => !elements.some(element => element.id === id))) throw new Error("Element not found."); elements = elements.map(element => ids.includes(element.id) ? createWhiteboardElement({ ...element, x: element.x + dx, y: element.y + dy }) : element); break; }
      case "elements.align": { const ids = identifiers(command.ids), alignment = choice(command.alignment, ["left", "center", "right", "top", "middle", "bottom"]); if (ids.some(id => !elements.some(element => element.id === id))) throw new Error("Element not found."); const selected = elements.filter(element => ids.includes(element.id)); const left = Math.min(...selected.map(n => n.x)), right = Math.max(...selected.map(n => n.x + n.width)), top = Math.min(...selected.map(n => n.y)), bottom = Math.max(...selected.map(n => n.y + n.height)); elements = elements.map(element => !ids.includes(element.id) ? element : createWhiteboardElement({ ...element, ...(alignment === "left" ? { x: left } : alignment === "right" ? { x: right - element.width } : alignment === "center" ? { x: (left + right - element.width) / 2 } : alignment === "top" ? { y: top } : alignment === "bottom" ? { y: bottom - element.height } : { y: (top + bottom - element.height) / 2 }) })); break; }
      case "elements.order": { const ids = identifiers(command.ids), position = choice(command.position, ["front", "back"]); if (ids.some(id => !elements.some(element => element.id === id))) throw new Error("Element not found."); const selected = elements.filter(element => ids.includes(element.id)), other = elements.filter(element => !ids.includes(element.id)); elements = position === "front" ? [...other, ...selected] : [...selected, ...other]; break; }
      case "whiteboard.update": title = command.title; break;
      default: throw new Error("Unsupported whiteboard command.");
    }
    model = normalizeWhiteboard({ ...model, title, elements });
  }
  return model;
}

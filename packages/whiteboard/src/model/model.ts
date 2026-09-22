import { inspectEmbeddedImage } from "../core";
import { serializeStableJson } from "../json";
import { color, choice, freeze, id, number, object, string } from "./validation";
import type { WhiteboardElement, WhiteboardElementInput, WhiteboardInput, WhiteboardModel } from "./types";

export const WHITEBOARD_LIMITS = Object.freeze({ elements: 5000, jsonLength: 40 * 1024 * 1024, imageBytes: 8 * 1024 * 1024, totalImageBytes: 24 * 1024 * 1024 });
export function createWhiteboardElement(input: WhiteboardElementInput = {}): WhiteboardElement {
  const value = object(input, "Element", ["id", "kind", "text", "src", "alt", "x", "y", "width", "height", "fill", "stroke", "textColor", "fontSize"]);
  const kind = choice(value.kind ?? "sticky", ["sticky", "text", "rectangle", "ellipse", "image"]);
  const base = { id: id(value.id ?? crypto.randomUUID()), x: number(value.x ?? 100), y: number(value.y ?? 100) };
  if (kind === "image") {
    object(input, "Image", ["id", "kind", "src", "alt", "x", "y", "width", "height"]);
    const image = inspectEmbeddedImage(value.src), width = number(value.width ?? (value.height === undefined ? Math.min(image.width, 480) : number(value.height, 1, 5000) * image.width / image.height), 1, 5000);
    return freeze({ ...base, kind, src: image.src, alt: string(value.alt ?? "", 4000), width, height: number(value.height ?? width * image.height / image.width, 1, 5000) });
  }
  object(input, "Text element", ["id", "kind", "text", "x", "y", "width", "height", "fill", "stroke", "textColor", "fontSize"]);
  return freeze({ ...base, kind, text: string(value.text ?? (kind === "sticky" ? "アイデアを書き留める" : kind === "text" ? "テキスト" : "")), width: number(value.width ?? 220, 20, 5000), height: number(value.height ?? (kind === "text" ? 60 : 180), 20, 5000), fill: color(value.fill ?? (kind === "sticky" ? "#fff2a8" : "#ffffff")), stroke: color(value.stroke ?? (kind === "sticky" ? "#e6d486" : kind === "text" ? "#ffffff" : "#718097")), textColor: color(value.textColor ?? "#263548"), fontSize: number(value.fontSize ?? 18, 8, 120) });
}
export function normalizeWhiteboard(input: unknown): WhiteboardModel {
  const value = object(input, "Whiteboard", ["format", "version", "id", "title", "elements"]);
  if (value.format !== "likex.whiteboard" || value.version !== 1) throw new Error("Unsupported LikeWhiteboard format or version.");
  if (!Array.isArray(value.elements) || value.elements.length > WHITEBOARD_LIMITS.elements) throw new Error("Whiteboard exceeds its element limit.");
  let bytes = 0;
  const elements = value.elements.map(element => { const result = createWhiteboardElement(element); if (element.id == null) throw new Error("Elements must have IDs."); if (result.kind === "image") bytes += inspectEmbeddedImage(result.src).bytes; return result; });
  if (bytes > WHITEBOARD_LIMITS.totalImageBytes) throw new Error("Whiteboard images exceed the total size limit.");
  if (new Set(elements.map(element => element.id)).size !== elements.length) throw new Error("Element IDs must be unique.");
  return freeze({ format: "likex.whiteboard", version: 1, id: id(value.id), title: string(value.title, 1000), elements });
}
export function createWhiteboard(input: WhiteboardInput = {}): WhiteboardModel {
  object(input, "Whiteboard input", ["id", "title", "elements"]);
  return normalizeWhiteboard({ format: "likex.whiteboard", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "無題のホワイトボード", elements: (input.elements ?? []).map(createWhiteboardElement) });
}
export function serializeWhiteboard(model: WhiteboardModel): string { return serializeStableJson(normalizeWhiteboard(model), { space: 2, maxLength: WHITEBOARD_LIMITS.jsonLength }) + "\n"; }
export function parseWhiteboard(json: string): WhiteboardModel { if (typeof json !== "string" || json.length > WHITEBOARD_LIMITS.jsonLength) throw new Error("Whiteboard JSON exceeds its size limit."); return normalizeWhiteboard(JSON.parse(json)); }
export function getWhiteboardElement(model: WhiteboardModel, elementId: string): WhiteboardElement | undefined { return normalizeWhiteboard(model).elements.find(element => element.id === elementId); }

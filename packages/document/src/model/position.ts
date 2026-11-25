import { choice, number, record } from "./validation";
import type { DocumentBlockPosition } from "./types";

/** Validates a place on the page. Without one (`null` or `undefined`) the block stands in the text. */
export function normalizeBlockPosition(input: unknown): DocumentBlockPosition | null {
  if (input == null) return null;
  const value = record(input, "Block position", ["horizontal", "vertical"]);
  const horizontal = record(value.horizontal, "Horizontal position", ["from", "offset"]), vertical = record(value.vertical, "Vertical position", ["from", "offset"]);
  return {
    horizontal: { from: choice(horizontal.from, ["page", "margin"], "Horizontal origin"), offset: number(horizontal.offset, "Horizontal offset", -1200, 1200) },
    vertical: { from: choice(vertical.from, ["page", "margin", "paragraph"], "Vertical origin"), offset: number(vertical.offset, "Vertical offset", -1200, 1200) },
  };
}

/** DOM attributes of a placed block. The style sheet applies them to blocks of the body only. */
export function blockPositionDom(input: unknown): Record<string, string> {
  const position = input as DocumentBlockPosition | null | undefined;
  if (!position) return {};
  return { "data-document-position": JSON.stringify(position), "data-lxd-float-h": position.horizontal.from, "data-lxd-float-v": position.vertical.from,
    style: `--lxd-float-x:${position.horizontal.offset}mm;--lxd-float-y:${position.vertical.offset}mm` };
}
export function parseBlockPositionDom(dom: HTMLElement): DocumentBlockPosition | null {
  try { return normalizeBlockPosition(JSON.parse(dom.getAttribute("data-document-position") ?? "null")); } catch { return null; }
}

/** A block in the text states no position, so documents without placed blocks are saved as before. */
export function omitTextPosition<T>(node: T): T {
  const value = node as { attrs?: Record<string, unknown>; content?: unknown[] };
  if (value.attrs && value.attrs.position === null) delete value.attrs.position;
  value.content?.forEach(omitTextPosition);
  return node;
}

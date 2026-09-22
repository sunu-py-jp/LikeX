import { normalizeWhiteboard } from "./model";
import { xml } from "./validation";
import type { WhiteboardModel } from "./types";

export function getWhiteboardBounds(input: WhiteboardModel) {
  const { elements } = normalizeWhiteboard(input);
  if (!elements.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const x = Math.min(...elements.map(element => element.x)) - 40, y = Math.min(...elements.map(element => element.y)) - 40;
  return { x, y, width: Math.max(...elements.map(element => element.x + element.width)) - x + 40, height: Math.max(...elements.map(element => element.y + element.height)) - y + 40 };
}
export function whiteboardTextLines(text: string, width: number, fontSize: number): string[] {
  const limit = Math.max(2, Math.floor(width / fontSize)), result: string[] = [];
  for (const line of text.split("\n")) { const chars = [...line]; if (!chars.length) result.push(""); else for (let index = 0; index < chars.length; index += limit) result.push(chars.slice(index, index + limit).join("")); }
  return result;
}
/** Static SVG keeps element order and embeds validated PNG/JPEG data; no external resources. */
export function exportWhiteboardSvg(input: WhiteboardModel): string {
  const model = normalizeWhiteboard(input), bounds = getWhiteboardBounds(model);
  const shapes = model.elements.map(element => {
    if (element.kind === "image") return `<image x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" href="${element.src}" preserveAspectRatio="xMidYMid meet"><title>${xml(element.alt)}</title></image>`;
    const attrs = `fill="${element.kind === "text" ? "none" : element.fill}" stroke="${element.kind === "text" ? "none" : element.stroke}" stroke-width="1.5"`;
    const shape = element.kind === "ellipse" ? `<ellipse cx="${element.x + element.width / 2}" cy="${element.y + element.height / 2}" rx="${element.width / 2}" ry="${element.height / 2}" ${attrs}/>` : `<rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}" rx="${element.kind === "sticky" ? 2 : 7}" ${attrs}/>`;
    return `<g>${shape}<text fill="${element.textColor}" font-family="Arial,sans-serif" font-size="${element.fontSize}">${whiteboardTextLines(element.text, element.width - 32, element.fontSize).map((line, index) => `<tspan x="${element.x + 16}" y="${element.y + 24 + index * element.fontSize * 1.4}">${xml(line)}</tspan>`).join("")}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" role="img"><title>${xml(model.title)}</title><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${shapes}</svg>`;
}

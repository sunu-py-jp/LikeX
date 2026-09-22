import type { SlideShapeElement } from "../model/types";

/** Geometry and layout values shared by the DOM artwork and the PNG renderer. */
export const SLIDE_TEXT_STYLE = Object.freeze({ paddingX: 10, paddingY: 8, lineHeight: 1.2 });
export const SHAPE_TEXT_STYLE = Object.freeze({ paddingX: 12, paddingY: 8, lineHeight: 1.2, fontFamily: 'Arial, "Yu Gothic", sans-serif' });
export type SlideShapeGeometry =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: readonly (readonly [number, number])[] }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; radius: number };
export function getSlideShapeGeometry(element: Pick<SlideShapeElement, "shape" | "width" | "height" | "strokeWidth">): SlideShapeGeometry {
  const { width, height, strokeWidth } = element, pad = strokeWidth / 2;
  switch (element.shape) {
    case "ellipse": return { kind: "ellipse", cx: width / 2, cy: height / 2, rx: Math.max(0, width / 2 - pad), ry: Math.max(0, height / 2 - pad) };
    case "triangle": return { kind: "polygon", points: [[width / 2, pad], [width - pad, height - pad], [pad, height - pad]] };
    case "diamond": return { kind: "polygon", points: [[width / 2, pad], [width - pad, height / 2], [width / 2, height - pad], [pad, height / 2]] };
    case "arrow": return { kind: "polygon", points: [[pad, height * .28], [width * .65, height * .28], [width * .65, pad], [width - pad, height / 2], [width * .65, height - pad], [width * .65, height * .72], [pad, height * .72]] };
    case "line": return { kind: "line", x1: pad, y1: pad, x2: width - pad, y2: height - pad };
    default: return { kind: "rect", x: pad, y: pad, width: Math.max(0, width - strokeWidth), height: Math.max(0, height - strokeWidth), radius: element.shape === "roundRect" ? Math.min(width, height) * .12 : 0 };
  }
}

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const clusters = (text: string): string[] => graphemes ? [...graphemes.segment(text)].map(value => value.segment) : Array.from(text);
/** Preserve explicit lines, break Western words as a unit, and wrap CJK/long words without splitting a grapheme. */
export function wrapSlideText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!(maxWidth > 0)) return [];
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const tokens: string[] = []; let word: string[] = [];
    for (const part of clusters(paragraph.replace(/\t/g, "        "))) {
      if (/^[\p{Script=Latin}\p{N}\p{M}_]+$/u.test(part)) word.push(part);
      else { if (word.length) { tokens.push(word.join("")); word = []; } tokens.push(part); }
    }
    if (word.length) tokens.push(word.join(""));
    let line = "", lineWidth = 0;
    const widths = new Map<string, number>();
    const widthOf = (value: string) => { let width = widths.get(value); if (width === undefined) { width = measure(value); widths.set(value, width); } return width; };
    for (const token of tokens) {
      const tokenWidth = widthOf(token);
      if (lineWidth + tokenWidth <= maxWidth) { line += token; lineWidth += tokenWidth; continue; }
      // Keep common Japanese closing punctuation with the preceding character,
      // and do not strand an opening bracket at the end of a line.
      if (line) {
        const parts = clusters(line), last = parts.at(-1)!;
        if ((/^[、。，．！？：；）］｝〕〉》」』】]/u.test(token) || /^[（［｛〔〈《「『【]$/u.test(last)) && parts.length > 1) {
          result.push(parts.slice(0, -1).join("")); line = last; lineWidth = widthOf(last);
          if (lineWidth + tokenWidth <= maxWidth) { line += token; lineWidth += tokenWidth; continue; }
        }
        result.push(line); line = ""; lineWidth = 0;
      }
      if (tokenWidth <= maxWidth) { line = token; lineWidth = tokenWidth; continue; }
      // Grow a bounded prefix before searching, so narrow boxes with a long word
      // do not repeatedly measure the entire unconsumed suffix.
      const parts = clusters(token);
      for (let start = 0; start < parts.length;) {
        const remaining = parts.length - start;
        let low = 1, high = 1;
        while (high < remaining && measure(parts.slice(start, start + high).join("")) <= maxWidth) { low = high; high = Math.min(remaining, high * 2); }
        // An oversized single glyph is retained and clipped by the element.
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (measure(parts.slice(start, start + middle).join("")) <= maxWidth) low = middle; else high = middle - 1; }
        const piece = parts.slice(start, start + low).join(""); start += low;
        if (start < parts.length) result.push(piece); else { line = piece; lineWidth = widthOf(piece); }
      }
    }
    result.push(line);
  }
  return result;
}

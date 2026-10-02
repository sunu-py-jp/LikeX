import { getOfficeShapeGeometry, type OfficeShapeGeometry } from "../model/core-office-shapes";
import { getSlideOfficeShapePreset } from "../model/shapes";
import type { SlideShapeElement } from "../model/types";

/** Geometry and layout values shared by the DOM artwork and the PNG renderer. */
export { SLIDE_TEXT_STYLE, SHAPE_TEXT_STYLE, wrapSlideText } from "../model/text-layout";
export type SlideShapeGeometry =
  | { kind: "paths"; paths: OfficeShapeGeometry["paths"] }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "polygon"; points: readonly (readonly [number, number])[] }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "rect"; x: number; y: number; width: number; height: number; radius: number };
export function getSlideShapeGeometry(element: Pick<SlideShapeElement, "shape" | "width" | "height" | "strokeWidth"> & Partial<Pick<SlideShapeElement, "line" | "x" | "y">>): SlideShapeGeometry {
  const { width, height, strokeWidth } = element, pad = strokeWidth / 2;
  switch (element.shape) {
    case "ellipse": return { kind: "ellipse", cx: width / 2, cy: height / 2, rx: Math.max(0, width / 2 - pad), ry: Math.max(0, height / 2 - pad) };
    case "triangle": return { kind: "polygon", points: [[width / 2, pad], [width - pad, height - pad], [pad, height - pad]] };
    case "diamond": return { kind: "polygon", points: [[width / 2, pad], [width - pad, height / 2], [width / 2, height - pad], [pad, height / 2]] };
    case "leftArrow": { const right = getSlideShapeGeometry({ ...element, shape: "arrow" }); return right.kind === "polygon" ? { ...right, points: right.points.map(([x, y]) => [width - x, y] as const) } : right; }
    case "arrow": return { kind: "polygon", points: [[pad, height * .28], [width * .65, height * .28], [width * .65, pad], [width - pad, height / 2], [width * .65, height - pad], [width * .65, height * .72], [pad, height * .72]] };
    case "line": return element.line ? { kind: "line", x1: element.line.start.x - (element.x ?? 0), y1: element.line.start.y - (element.y ?? 0), x2: element.line.end.x - (element.x ?? 0), y2: element.line.end.y - (element.y ?? 0) } : { kind: "line", x1: pad, y1: pad, x2: width - pad, y2: height - pad };
    case "rect": case "roundRect": return { kind: "rect", x: pad, y: pad, width: Math.max(0, width - strokeWidth), height: Math.max(0, height - strokeWidth), radius: element.shape === "roundRect" ? Math.min(width, height) * .12 : 0 };
    default: return { kind: "paths", paths: getOfficeShapeGeometry(getSlideOfficeShapePreset(element.shape), width, height).paths };
  }
}

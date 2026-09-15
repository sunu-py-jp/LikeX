import type { SpreadsheetShapeDrawing } from "./types";

export type SpreadsheetShapeCategory = "basic" | "arrows" | "lines";

type Point = readonly [number, number];
type ShapeGeometry =
  | Readonly<{ type: "rectangle"; rounded?: boolean }>
  | Readonly<{ type: "ellipse" }>
  | Readonly<{ type: "line"; arrow?: boolean }>
  | Readonly<{ type: "polygon"; points: readonly Point[] }>;
type ShapeDefinition = Readonly<{
  label: string; category: SpreadsheetShapeCategory; geometry: ShapeGeometry;
  /** ECMA-376 DrawingML preset name, independent of the public identifier. */
  xlsxPreset: string;
  /** Preset guides use the short side; our normalized polygons use their own axis. */
  xlsxAdjustment?: Readonly<{ name: "adj" | "adj2"; axis: "width" | "height"; ratio: number }>;
  /** Native DrawingML text rectangle: normalized [left, top, right, bottom]. */
  textFrame?: readonly [number, number, number, number] | "rounded";
}>;

// One catalog drives validation, the insertion gallery, SVGs and DrawingML export.
// Presets: https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.shapetypevalues
// Guide formulas cross-checked against Apache POI's presetShapeDefinitions.xml (REL_5_4_1).
const shapeDefinitions = {
  rectangle: { label: "長方形", category: "basic", xlsxPreset: "rect", geometry: { type: "rectangle" } },
  roundedRectangle: { textFrame: "rounded", label: "角丸長方形", category: "basic", xlsxPreset: "roundRect", geometry: { type: "rectangle", rounded: true } },
  ellipse: { label: "楕円", category: "basic", xlsxPreset: "ellipse", geometry: { type: "ellipse" } },
  triangle: { textFrame: [0.25, 0.5, 0.75, 1], label: "三角形", category: "basic", xlsxPreset: "triangle", geometry: { type: "polygon", points: [[0.5, 0], [1, 1], [0, 1]] } },
  rightTriangle: { textFrame: [1 / 12, 7 / 12, 7 / 12, 11 / 12], label: "直角三角形", category: "basic", xlsxPreset: "rtTriangle", geometry: { type: "polygon", points: [[0, 0], [1, 1], [0, 1]] } },
  diamond: { textFrame: [0.25, 0.25, 0.75, 0.75], label: "ひし形", category: "basic", xlsxPreset: "diamond", geometry: { type: "polygon", points: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] } },
  parallelogram: { textFrame: [3 / 16, 3 / 16, 13 / 16, 13 / 16], label: "平行四辺形", category: "basic", xlsxPreset: "parallelogram", xlsxAdjustment: { name: "adj", axis: "width", ratio: 0.25 }, geometry: { type: "polygon", points: [[0.25, 0], [1, 0], [0.75, 1], [0, 1]] } },
  trapezoid: { textFrame: [1 / 6, 1 / 6, 5 / 6, 1], label: "台形", category: "basic", xlsxPreset: "trapezoid", xlsxAdjustment: { name: "adj", axis: "width", ratio: 0.25 }, geometry: { type: "polygon", points: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]] } },
  rightArrow: { textFrame: [0, 0.25, 0.75, 0.75], label: "右矢印", category: "arrows", xlsxPreset: "rightArrow", xlsxAdjustment: { name: "adj2", axis: "width", ratio: 0.5 }, geometry: { type: "polygon", points: [[0, 0.25], [0.5, 0.25], [0.5, 0], [1, 0.5], [0.5, 1], [0.5, 0.75], [0, 0.75]] } },
  leftArrow: { textFrame: [0.25, 0.25, 1, 0.75], label: "左矢印", category: "arrows", xlsxPreset: "leftArrow", xlsxAdjustment: { name: "adj2", axis: "width", ratio: 0.5 }, geometry: { type: "polygon", points: [[1, 0.25], [0.5, 0.25], [0.5, 0], [0, 0.5], [0.5, 1], [0.5, 0.75], [1, 0.75]] } },
  upArrow: { textFrame: [0.25, 0.25, 0.75, 1], label: "上矢印", category: "arrows", xlsxPreset: "upArrow", xlsxAdjustment: { name: "adj2", axis: "height", ratio: 0.5 }, geometry: { type: "polygon", points: [[0.25, 1], [0.25, 0.5], [0, 0.5], [0.5, 0], [1, 0.5], [0.75, 0.5], [0.75, 1]] } },
  downArrow: { textFrame: [0.25, 0, 0.75, 0.75], label: "下矢印", category: "arrows", xlsxPreset: "downArrow", xlsxAdjustment: { name: "adj2", axis: "height", ratio: 0.5 }, geometry: { type: "polygon", points: [[0.25, 0], [0.25, 0.5], [0, 0.5], [0.5, 1], [1, 0.5], [0.75, 0.5], [0.75, 0]] } },
  leftRightArrow: { textFrame: [0.125, 0.25, 0.875, 0.75], label: "左右矢印", category: "arrows", xlsxPreset: "leftRightArrow", xlsxAdjustment: { name: "adj2", axis: "width", ratio: 0.25 }, geometry: { type: "polygon", points: [[0, 0.5], [0.25, 0], [0.25, 0.25], [0.75, 0.25], [0.75, 0], [1, 0.5], [0.75, 1], [0.75, 0.75], [0.25, 0.75], [0.25, 1]] } },
  upDownArrow: { textFrame: [0.25, 0.125, 0.75, 0.875], label: "上下矢印", category: "arrows", xlsxPreset: "upDownArrow", xlsxAdjustment: { name: "adj2", axis: "height", ratio: 0.25 }, geometry: { type: "polygon", points: [[0.5, 0], [1, 0.25], [0.75, 0.25], [0.75, 0.75], [1, 0.75], [0.5, 1], [0, 0.75], [0.25, 0.75], [0.25, 0.25], [0, 0.25]] } },
  line: { label: "直線", category: "lines", xlsxPreset: "line", geometry: { type: "line" } },
  arrow: { label: "矢印付き直線", category: "lines", xlsxPreset: "line", geometry: { type: "line", arrow: true } },
} as const satisfies Record<string, ShapeDefinition>;

/** Shape identifiers accepted by JSON, commands and the component's insertion UI. */
export type SpreadsheetShapeKind = keyof typeof shapeDefinitions;
export type SpreadsheetShapeInfo = Readonly<{ kind: SpreadsheetShapeKind; label: string; category: SpreadsheetShapeCategory }>;
export const SPREADSHEET_SHAPES: readonly SpreadsheetShapeInfo[] = Object.freeze(
  (Object.keys(shapeDefinitions) as SpreadsheetShapeKind[]).map(kind => Object.freeze({
    kind, label: shapeDefinitions[kind].label, category: shapeDefinitions[kind].category,
  })),
);

export function isSpreadsheetShapeKind(value: unknown): value is SpreadsheetShapeKind {
  return typeof value === "string" && Object.hasOwn(shapeDefinitions, value);
}

export function getShapeDefinition(kind: SpreadsheetShapeKind): ShapeDefinition { return shapeDefinitions[kind]; }

/** SVG strokes are inset; exports use the same frame because DrawingML centers strokes on its outline. */
export function shapeBodyFrame(kind: SpreadsheetShapeKind, width: number, height: number, stroke: number) {
  // Keep old rectangle geometry stable, including intentionally oversized outlines.
  return { x: (kind === "rectangle" ? stroke : Math.min(stroke, width)) / 2,
    y: (kind === "rectangle" ? stroke : Math.min(stroke, height)) / 2,
    width: Math.max(0, width - stroke), height: Math.max(0, height - stroke) };
}

/** Native text area for new presets. Reflection changes its position, never the letters. */
export function shapeTextFrame(drawing: SpreadsheetShapeDrawing) {
  const { width, height, shape, strokeWidth } = drawing;
  const text = getShapeDefinition(shape).textFrame;
  // Preserve the existing four shapes' text layout for stored workbooks.
  if (!text) return { left: 0, top: 0, width, height };
  const frame = shapeBodyFrame(shape, width, height, strokeWidth);
  const cornerInset = Math.min(frame.width, frame.height) * 16667 / 100000 * 29289 / 100000;
  const left = frame.x + (text === "rounded" ? cornerInset : frame.width * text[0]);
  const top = frame.y + (text === "rounded" ? cornerInset : frame.height * text[1]);
  const right = frame.x + (text === "rounded" ? frame.width - cornerInset : frame.width * text[2]);
  const bottom = frame.y + (text === "rounded" ? frame.height - cornerInset : frame.height * text[3]);
  return { left: drawing.flipX ? width - right : left, top: drawing.flipY ? height - bottom : top,
    width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

import type { SpreadsheetDrawingTextStyle } from "./types";
import { normalizeDrawingRotation } from "./drawing-transform";

/** World-space text angle for labels rendered outside a rotated drawing container. */
export function getDrawingTextRotation(drawing: SpreadsheetDrawingTextStyle & { rotation?: number }): number {
  return drawing.textUpright ? 0 : normalizeDrawingRotation((drawing.rotation ?? 0) + (drawing.textRotation ?? 0));
}

/** Native LikeX drawings add no padding unless an explicit layout supplies it. */
export const DEFAULT_DRAWING_TEXT_INSETS: NonNullable<SpreadsheetDrawingTextStyle["textInsets"]> = Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });

/** Shared by command validation, snapshots and normalization. */
export const DRAWING_TEXT_STYLE_KEYS = ["fontFamily", "italic", "underline", "textInsets", "textWrap", "textOverflow", "textVerticalOverflow",
  "textAlign", "textVerticalAlign", "textAutoFit", "textFontScale", "textLineHeight", "textRotation", "textUpright"] as const;
export function pickDrawingTextStyle(input: SpreadsheetDrawingTextStyle): SpreadsheetDrawingTextStyle {
  return Object.fromEntries(DRAWING_TEXT_STYLE_KEYS.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}
export function normalizeDrawingTextStyle(input: SpreadsheetDrawingTextStyle): SpreadsheetDrawingTextStyle {
  const result = pickDrawingTextStyle(input);
  const fail = (): never => { throw new Error("描画オブジェクトの文字レイアウトが正しくありません"); };
  if (input.fontFamily !== undefined && (typeof input.fontFamily !== "string" || !input.fontFamily.trim() || input.fontFamily.length > 100 || /[;{}<>\u0000-\u001f]/.test(input.fontFamily))) fail();
  for (const key of ["italic", "underline", "textUpright"] as const) if (input[key] !== undefined && typeof input[key] !== "boolean") fail();
  const rotation = normalizeDrawingRotation(input.textRotation);
  if (rotation) result.textRotation = rotation; else delete result.textRotation;
  if (!input.textUpright) delete result.textUpright;
  const choices = { textWrap: ["wrap", "none"], textOverflow: ["clip", "overflow"], textVerticalOverflow: ["clip", "overflow"],
    textAlign: ["left", "center", "right"], textVerticalAlign: ["top", "middle", "bottom"], textAutoFit: ["none", "shrink", "resize"] };
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) if (input[key] !== undefined && !choices[key].includes(input[key]!)) fail();
  for (const [key, min, max] of [["textFontScale", 0.01, 1], ["textLineHeight", 0.1, 10]] as const)
    if (input[key] !== undefined && (!Number.isFinite(input[key]) || input[key]! < min || input[key]! > max)) fail();
  if (input.textInsets !== undefined) {
    const value = input.textInsets, keys = ["left", "top", "right", "bottom"] as const;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !(keys as readonly string[]).includes(key)) ||
      keys.some(key => !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 10_000)) fail();
    result.textInsets = Object.freeze({ left: value.left, top: value.top, right: value.right, bottom: value.bottom });
  }
  return result;
}
export function drawingTextStylesEqual(left: SpreadsheetDrawingTextStyle, right: SpreadsheetDrawingTextStyle): boolean {
  return DRAWING_TEXT_STYLE_KEYS.every(key => key === "textInsets" ? ["left", "top", "right", "bottom"].every(edge =>
    left.textInsets?.[edge as keyof NonNullable<SpreadsheetDrawingTextStyle["textInsets"]>] === right.textInsets?.[edge as keyof NonNullable<SpreadsheetDrawingTextStyle["textInsets"]>]) : left[key] === right[key]);
}

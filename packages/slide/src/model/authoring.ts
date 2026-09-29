import type { Slide, SlideElementBase, SlideShapeElement, SlideTextElement } from "./types";
import { normalizeSlide, normalizeSlideElement } from "./normalize";
import { number } from "./validation";
import { SHAPE_TEXT_STYLE, SLIDE_TEXT_STYLE, wrapSlideText } from "./text-layout";

export type SlideTextMeasureStyle = { fontSize: number; fontFamily: string; bold: boolean; italic: boolean };
/** Return pixel width using the same installed fonts as the final renderer. */
export type SlideTextMeasure = (text: string, style: SlideTextMeasureStyle) => number;
export type SlideTextLayout = {
  lines: string[]; measuredWidth: number; measuredHeight: number; availableWidth: number; availableHeight: number; overflow: boolean;
};
export type SlideLayoutDiagnostic = {
  code: "text-overflow" | "out-of-bounds"; elementId: string; message: string;
  measuredHeight?: number; availableHeight?: number; measuredWidth?: number; availableWidth?: number;
};
export type SlideLayoutOptions = { width: number; height: number; measureText: SlideTextMeasure };
type TextElement = SlideTextElement | SlideShapeElement;

/** Match the PNG renderer's padding, line height, graphemes, and wrapping. */
export function measureSlideText(element: TextElement, measureText: SlideTextMeasure): SlideTextLayout {
  const accepted = normalizeSlideElement(element);
  if (accepted.type === "image") throw new Error("文字を持つ要素を指定してください");
  if (typeof measureText !== "function") throw new Error("文字幅を測定する関数を指定してください");
  const style = accepted.type === "text" ? SLIDE_TEXT_STYLE : SHAPE_TEXT_STYLE;
  const font: SlideTextMeasureStyle = { fontSize: accepted.fontSize,
    fontFamily: accepted.type === "text" ? accepted.fontFamily : SHAPE_TEXT_STYLE.fontFamily,
    bold: accepted.type === "text" && accepted.bold, italic: accepted.type === "text" && accepted.italic };
  const measure = (text: string) => number(measureText(text, font), "測定した文字幅", 0, Number.MAX_VALUE);
  const availableWidth = Math.max(0, accepted.width - style.paddingX * 2), availableHeight = Math.max(0, accepted.height - style.paddingY * 2);
  const lines = accepted.text ? wrapSlideText(accepted.text, availableWidth, measure) : [];
  const measuredWidth = lines.reduce((max, line) => Math.max(max, measure(line)), 0), measuredHeight = lines.length * accepted.fontSize * style.lineHeight;
  const overflow = !!accepted.text && (!availableWidth || !availableHeight || measuredWidth > availableWidth + 1e-7 || measuredHeight > availableHeight + 1e-7);
  return { lines, measuredWidth, measuredHeight, availableWidth, availableHeight, overflow };
}

/** Shrink text to the largest fitting 0.1px size; the input and stored geometry stay unchanged. */
export function fitSlideText<T extends TextElement>(element: T, options: { measureText: SlideTextMeasure; minFontSize?: number }): { element: T; layout: SlideTextLayout; fits: boolean } {
  const accepted = normalizeSlideElement(element) as T;
  const minimum = number(options.minFontSize ?? Math.min(12, accepted.fontSize), "最小文字サイズ", 1, accepted.fontSize);
  const inspect = (fontSize: number) => { const next = normalizeSlideElement({ ...accepted, fontSize }) as T; return { element: next, layout: measureSlideText(next, options.measureText) }; };
  const original = inspect(accepted.fontSize);
  if (!original.layout.overflow) return { ...original, fits: true };
  let best = inspect(minimum);
  if (best.layout.overflow) return { ...best, fits: false };
  let low = Math.ceil(minimum * 10), high = Math.floor(accepted.fontSize * 10);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), next = inspect(middle / 10);
    if (next.layout.overflow) high = middle - 1;
    else { best = next; low = middle + 1; }
  }
  return { ...best, fits: true };
}

export type SlideElementBounds = { left: number; top: number; right: number; bottom: number };
export type SlideElementGeometry = Pick<SlideElementBase, "x" | "y" | "width" | "height" | "rotation">;
/** Axis-aligned bounds including rotation around the element center, excluding stroke. */
export function getSlideElementBounds(element: SlideElementGeometry): SlideElementBounds {
  const x = number(element.x, "X座標", -100_000, 100_000), y = number(element.y, "Y座標", -100_000, 100_000);
  const width = number(element.width, "幅", Number.MIN_VALUE, 100_000), height = number(element.height, "高さ", Number.MIN_VALUE, 100_000);
  const angle = number(element.rotation, "回転", -3_600_000, 3_600_000) * Math.PI / 180;
  const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
  const halfHeight = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
  const cx = x + width / 2, cy = y + height / 2;
  return { left: cx - halfWidth, top: cy - halfHeight, right: cx + halfWidth, bottom: cy + halfHeight };
}

/** Advisory diagnostics for the static page; overlaps may be intentional and are not rejected. */
export function getSlideLayoutDiagnostics(slide: Slide, options: SlideLayoutOptions): SlideLayoutDiagnostic[] {
  const accepted = normalizeSlide(slide), width = number(options.width, "スライドの幅", 1, 10_000), height = number(options.height, "スライドの高さ", 1, 10_000);
  const diagnostics: SlideLayoutDiagnostic[] = [];
  for (const element of accepted.elements) {
    const bounds = getSlideElementBounds(element);
    if (bounds.left < -1e-7 || bounds.top < -1e-7 || bounds.right > width + 1e-7 || bounds.bottom > height + 1e-7)
      diagnostics.push({ code: "out-of-bounds", elementId: element.id, message: "要素がスライドの外にはみ出しています。位置・サイズ・回転を調整してください。" });
    if (element.type === "image" || !element.text) continue;
    const layout = measureSlideText(element, options.measureText);
    if (layout.overflow) diagnostics.push({ code: "text-overflow", elementId: element.id,
      message: "文字が要素の内容領域に収まりません。文章を短くするか領域を広げ、必要なら文字サイズを調整してください。",
      measuredWidth: layout.measuredWidth, availableWidth: layout.availableWidth, measuredHeight: layout.measuredHeight, availableHeight: layout.availableHeight });
  }
  return diagnostics;
}

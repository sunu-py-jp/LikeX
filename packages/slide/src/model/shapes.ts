import { OFFICE_SHAPE_PRESETS, getOfficeShapeGeometry, type OfficeShapePreset, type OfficeShapeCategory } from "./core-office-shapes";
import type { SlideShapeKind } from "./types";

/** Shared insert menu and model catalog. Lines use their separate endpoint API. */
export const SLIDE_SHAPES: readonly Readonly<{ preset: OfficeShapePreset; label: string; category: OfficeShapeCategory;
  shape: Exclude<SlideShapeKind, "line"> }>[] = Object.freeze(OFFICE_SHAPE_PRESETS.map(item => Object.freeze({
  ...item, label: item.preset === "rightArrow" ? "右ブロック矢印" : item.preset === "leftArrow" ? "左ブロック矢印" : item.label, shape: (item.preset === "rightArrow" ? "arrow" : item.preset) as Exclude<SlideShapeKind, "line">,
})));
export function getSlideOfficeShapePreset(shape: Exclude<SlideShapeKind, "line">): OfficeShapePreset {
  return shape === "arrow" ? "rightArrow" : shape;
}
/** Inner shape text region, before the shared text padding is applied. */
export function getSlideShapeTextRect(element: { shape: SlideShapeKind; width: number; height: number }) {
  if (["rect", "roundRect", "ellipse", "triangle", "diamond", "arrow", "leftArrow", "line"].includes(element.shape))
    return { left: 0, top: 0, width: element.width, height: element.height };
  return getOfficeShapeGeometry(getSlideOfficeShapePreset(element.shape as Exclude<SlideShapeKind, "line">), element.width, element.height).textRect;
}

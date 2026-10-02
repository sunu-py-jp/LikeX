import { isOfficeShapePreset } from "./core-office-shapes";
import { color, number, record, text } from "./validation";
import type { DocumentShapeAttributes } from "./types";

export const shapeAttributeKeys = ["id", "preset", "text", "width", "height", "fill", "stroke", "strokeWidth", "rotation", "flipH", "flipV", "color", "fontSize"];
/** Shared validation for JSON input, commands and clipboard HTML. */
export function normalizeShapeAttributes(input: unknown): Omit<DocumentShapeAttributes, "id"> {
  const originalAttrs = record(input, "Shape attributes", shapeAttributeKeys);
  if (!isOfficeShapePreset(originalAttrs.preset)) throw new Error("Shape preset is unsupported.");
  for (const key of ["flipH", "flipV"]) if (originalAttrs[key] !== undefined && typeof originalAttrs[key] !== "boolean") throw new Error("Shape flip must be a boolean.");
  return { preset: originalAttrs.preset, text: text(originalAttrs.text ?? "", "Shape text", 100_000),
    width: number(originalAttrs.width ?? 240, "Shape width", 1, 16_384), height: number(originalAttrs.height ?? 140, "Shape height", 1, 16_384),
    fill: originalAttrs.fill === null ? null : color(originalAttrs.fill ?? "#dbeafe"), stroke: originalAttrs.stroke === null ? null : color(originalAttrs.stroke ?? "#2563eb"),
    strokeWidth: number(originalAttrs.strokeWidth ?? 1.5, "Shape stroke width", 0, 100), rotation: number(originalAttrs.rotation ?? 0, "Shape rotation", -360, 360),
    flipH: originalAttrs.flipH === true, flipV: originalAttrs.flipV === true, color: color(originalAttrs.color ?? "#172554"), fontSize: number(originalAttrs.fontSize ?? 14, "Shape font size", 4, 240),
  };
}

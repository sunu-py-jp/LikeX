import type { SpreadsheetShapeDrawing } from "../../model/types";
import { rotateDrawingVector } from "../../model/drawing-transform";
import { roundedRectangleRadius, shapeBodyFrame } from "../../model/shapes";

/** The yellow adjustment diamond follows the actual outline, including reflected shapes. */
export function cornerAdjustmentPosition(drawing: SpreadsheetShapeDrawing) {
  const frame = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, drawing.strokeWidth);
  const x = frame.x + roundedRectangleRadius(drawing), y = frame.y;
  return { left: drawing.flipX ? drawing.width - x : x, top: drawing.flipY ? drawing.height - y : y };
}

/** Use pointer displacement in unrotated, unreflected shape coordinates so pressing never jumps. */
export function cornerRadiusAfterDrag(drawing: SpreadsheetShapeDrawing, delta: { x: number; y: number }) {
  const frame = shapeBodyFrame(drawing.shape, drawing.width, drawing.height, drawing.strokeWidth);
  const shortSide = Math.min(frame.width, frame.height), initial = drawing.cornerRadiusRatio ?? 0.16667;
  if (shortSide <= 0) return initial;
  const local = rotateDrawingVector(delta, -(drawing.rotation ?? 0));
  return Math.max(0, Math.min(0.5, initial + local.x * (drawing.flipX ? -1 : 1) / shortSide));
}

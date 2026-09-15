import { normalizeDrawingRotation, rotateDrawingVector } from "../model/drawing-transform";
import type { DrawingGeometry, DrawingRectangle, DrawingResizeCorner, DrawingResizeOptions, DrawingResizeRectangle } from "./drawing-geometry";

/** Rotation follows the angle swept around the original center, independent of zoom and initial handle position. */
export function drawingRotationAtPointer(frame: DrawingRectangle, rotation: number,
  start: { x: number; y: number }, pointer: { x: number; y: number }, snap = false): number {
  if (pointer.x === start.x && pointer.y === start.y) return rotation;
  const center = { x: frame.left + frame.width / 2, y: frame.top + frame.height / 2 };
  // A point at the center has no angle; keep the original rather than jump unexpectedly.
  if (Math.hypot(pointer.x - center.x, pointer.y - center.y) < 1e-7 ||
    Math.hypot(start.x - center.x, start.y - center.y) < 1e-7) return rotation;
  const delta = Math.atan2(pointer.y - center.y, pointer.x - center.x) - Math.atan2(start.y - center.y, start.x - center.x);
  const next = normalizeDrawingRotation(rotation + delta * 180 / Math.PI);
  return normalizeDrawingRotation(snap ? Math.round(next / 15) * 15 : Math.round(next * 100) / 100);
}

/** Resize in the drawing's local axes, then map its center back to the sheet.
 * The opposite visual corner remains fixed, including when a dragged corner crosses it. */
export function resizeRotatedDrawingRectangle(initial: DrawingRectangle, corner: DrawingResizeCorner,
  delta: { x: number; y: number }, geometry: DrawingGeometry, options: DrawingResizeOptions): DrawingResizeRectangle {
  const rotation = options.rotation ?? 0, east = corner.endsWith("e"), south = corner.startsWith("s");
  const originalX = east ? 1 : -1, originalY = south ? 1 : -1;
  const localDelta = rotateDrawingVector(delta, -rotation);
  const oppositeOffset = rotateDrawingVector({ x: -originalX * initial.width / 2, y: -originalY * initial.height / 2 }, rotation);
  const fixed = { x: initial.left + initial.width / 2 + oppositeOffset.x, y: initial.top + initial.height / 2 + oppositeOffset.y };
  const at = (progress: number): DrawingResizeRectangle => {
    if (progress === 0) return { ...initial, flipX: !!options.flipX, flipY: !!options.flipY };
    const signedWidth = originalX * initial.width + localDelta.x * progress;
    const signedHeight = originalY * initial.height + localDelta.y * progress;
    const directionX = Math.sign(signedWidth) || originalX, directionY = Math.sign(signedHeight) || originalY;
    let width: number, height: number;
    if (options.preserveAspectRatio) {
      const longest = Math.max(initial.width, initial.height), unitX = initial.width / longest, unitY = initial.height / longest;
      const requested = (Math.abs(signedWidth) * unitX + Math.abs(signedHeight) * unitY) / (unitX * unitX + unitY * unitY);
      const size = Math.max(16, Math.min(10_000, requested));
      width = size * unitX; height = size * unitY;
    } else {
      width = Math.max(16, Math.min(10_000, Math.abs(signedWidth)));
      height = Math.max(16, Math.min(10_000, Math.abs(signedHeight)));
    }
    const centerOffset = rotateDrawingVector({ x: directionX * width / 2, y: directionY * height / 2 }, rotation);
    return { left: fixed.x + centerOffset.x - width / 2, top: fixed.y + centerOffset.y - height / 2, width, height,
      flipX: !!options.flipX !== (directionX !== originalX), flipY: !!options.flipY !== (directionY !== originalY) };
  };
  const within = (frame: DrawingRectangle) => frame.left >= geometry.columnOffsets[0] && frame.top >= geometry.rowOffsets[0] &&
    frame.left <= geometry.columnOffsets.at(-1)! - 1 && frame.top <= geometry.rowOffsets.at(-1)! - 1;
  const requested = at(1);
  if (within(requested)) return requested;
  // Stop at a sheet edge without translating the fixed corner. Only the anchor is bounded.
  let low = 0, high = 1, valid = at(0);
  for (let index = 0; index < 48; index++) {
    const middle = (low + high) / 2, candidate = at(middle);
    if (within(candidate)) { low = middle; valid = candidate; } else high = middle;
  }
  return valid;
}

/** Cursor directions remain meaningful as the selected frame rotates. */
export function drawingResizeCursor(corner: DrawingResizeCorner, rotation = 0, reversed = false) {
  const diagonal = (corner === "nw" || corner === "se" ? 45 : 135) + rotation + (reversed ? 90 : 0);
  return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[Math.round(normalizeDrawingRotation(diagonal) / 45) % 4];
}

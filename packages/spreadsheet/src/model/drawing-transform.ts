/** Clockwise degrees around the drawing frame's center. Zero is represented by an omitted field. */
export function normalizeDrawingRotation(value: unknown = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("描画オブジェクトの回転角度は有限の数値で指定してください");
  const angle = value % 360;
  return angle < 0 ? angle + 360 : angle || 0;
}

/** Exact quarter turns avoid tiny floating point overshoots when finding the next row/column. */
export function drawingRotationVector(rotation: number) {
  const angle = normalizeDrawingRotation(rotation);
  if (angle === 0) return { cos: 1, sin: 0 };
  if (angle === 90) return { cos: 0, sin: 1 };
  if (angle === 180) return { cos: -1, sin: 0 };
  if (angle === 270) return { cos: 0, sin: -1 };
  const radians = angle * Math.PI / 180;
  return { cos: Math.cos(radians), sin: Math.sin(radians) };
}

export function rotateDrawingVector(point: { x: number; y: number }, rotation: number) {
  const { cos, sin } = drawingRotationVector(rotation);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/** Axis-aligned visual frame, excluding editor handles and any stroke overflow. */
export function rotatedDrawingBounds(frame: { left: number; top: number; width: number; height: number }, rotation = 0) {
  const { cos, sin } = drawingRotationVector(rotation);
  const width = Math.abs(frame.width * cos) + Math.abs(frame.height * sin);
  const height = Math.abs(frame.width * sin) + Math.abs(frame.height * cos);
  const left = frame.left + (frame.width - width) / 2, top = frame.top + (frame.height - height) / 2;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

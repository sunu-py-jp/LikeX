/** Viewport coordinates; independent of DOM and any rendering framework. */
export type DragPoint = { x: number; y: number };
export type DragBounds = { left: number; top: number; right: number; bottom: number };
export type DragScrollOptions = { edge?: number; maxSpeed?: number; axes?: "both" | "x" | "y" };

/** Scroll distance for a frame. Speed increases towards/beyond the viewport edge. */
export function getDragScrollDelta(point: DragPoint, bounds: DragBounds, elapsedMs = 16, options: DragScrollOptions = {}): DragPoint {
  const edge = options.edge ?? 48, speed = options.maxSpeed ?? 720;
  if (![point.x, point.y, bounds.left, bounds.top, bounds.right, bounds.bottom, elapsedMs, edge, speed].every(Number.isFinite) || edge <= 0 || speed <= 0) return { x: 0, y: 0 };
  const time = Math.max(0, Math.min(64, elapsedMs)) / 1000;
  function delta(position: number, start: number, end: number) {
    if (end <= start) return 0;
    const threshold = Math.min(edge, (end - start) / 3);
    const factor = position < start + threshold ? -Math.min(1, (start + threshold - position) / threshold)
      : position > end - threshold ? Math.min(1, (position - end + threshold) / threshold) : 0;
    return factor * speed * time;
  }
  return { x: options.axes === "y" ? 0 : delta(point.x, bounds.left, bounds.right), y: options.axes === "x" ? 0 : delta(point.y, bounds.top, bounds.bottom) };
}

/** Insertion boundary for ordered item bounds. Exclude the dragged item first. */
export function getDragInsertionIndex(position: number, items: readonly { start: number; end: number }[]): number {
  const index = items.findIndex(item => position < (item.start + item.end) / 2);
  return index === -1 ? items.length : index;
}

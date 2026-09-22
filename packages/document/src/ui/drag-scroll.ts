import { getDragScrollDelta } from "../core";
export type DragPoint = { x: number; y: number };
/** View-only rAF adapter; geometry is shared by core and never edits the model. */
export function startDragEdgeMotion(element: Element, pointer: () => DragPoint | null, move: (dx: number, dy: number) => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (!win?.requestAnimationFrame) return () => {};
  let frame = 0, last = 0, stopped = false;
  const tick = (now: number) => {
    if (stopped) return;
    const elapsed = last ? Math.min(50, now - last) : 16; last = now;
    const point = pointer();
    if (point && element.isConnected) {
      const rect = element.getBoundingClientRect();
      const velocity = getDragScrollDelta(point, { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(win.innerWidth, rect.right), bottom: Math.min(win.innerHeight, rect.bottom) }, elapsed);
      if (velocity.x || velocity.y) move(velocity.x, velocity.y);
    }
    if (!stopped) frame = win.requestAnimationFrame(tick);
  };
  frame = win.requestAnimationFrame(tick);
  return () => { stopped = true; win.cancelAnimationFrame(frame); };
}

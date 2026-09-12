export type HorizontalScrollMetrics = { scrollLeft: number; scrollWidth: number; clientWidth: number };
export type HorizontalScrollItem = { start: number; end: number };
const tolerance = 1;
// Reveal the narrow padding after an edge item in the same click as the item.
const edgePaddingTolerance = 8;

export function horizontalScrollState(metrics: HorizontalScrollMetrics, fullWidth = metrics.clientWidth) {
  const overflow = metrics.clientWidth > 0 && metrics.scrollWidth > fullWidth + tolerance;
  return { overflow, previous: overflow && metrics.scrollLeft > tolerance,
    next: overflow && metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - tolerance };
}

/** Select using the current viewport, then reveal the item in the viewport
 * after directional arrow slots have appeared or disappeared. */
export function horizontalScrollTarget(metrics: HorizontalScrollMetrics, items: readonly HorizontalScrollItem[],
  direction: "previous" | "next", targetWidth = metrics.clientWidth): number {
  const maximum = Math.max(0, metrics.scrollWidth - targetWidth);
  const left = Math.min(maximum, Math.max(0, metrics.scrollLeft));
  if (metrics.clientWidth <= 0 || targetWidth <= 0) return left;
  const page = Math.min(metrics.clientWidth, targetWidth);
  const candidates = items.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start);
  let target: number;
  if (direction === "next") {
    const item = candidates.find(item => item.end > metrics.scrollLeft + metrics.clientWidth + tolerance);
    target = item ? item.end - item.start > targetWidth
      ? Math.min(left + page, item.end - targetWidth) : item.end - targetWidth : left + page;
  } else {
    const item = candidates.filter(item => item.start < metrics.scrollLeft - tolerance).at(-1);
    target = item ? item.end - item.start > targetWidth ? Math.max(left - page, item.start) : item.start : left - page;
  }
  const bounded = Math.min(maximum, Math.max(0, direction === "next" ? Math.max(left, target) : Math.min(left, target)));
  if (direction === "next" && maximum - bounded <= edgePaddingTolerance &&
    candidates.every(item => item.end <= bounded + targetWidth + tolerance)) return maximum;
  if (direction === "previous" && bounded <= edgePaddingTolerance &&
    candidates.every(item => item.start >= bounded - tolerance)) return 0;
  return bounded;
}

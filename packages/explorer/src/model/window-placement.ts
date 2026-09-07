export type WindowTabAnchor = {
  screenX: number;
  screenY: number;
  offsetX: number;
  offsetY: number;
};

export type WindowPosition = {
  left: number;
  top: number;
  tabAnchor?: WindowTabAnchor;
};

export type WindowPlacementMetrics = Readonly<{
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
}>;

export type WindowTabRect = Readonly<{ left: number; top: number }>;

/** Align the grabbed point of a rendered tab with its drop position on screen. */
export function calcDetachedWindowPosition(
  metrics: WindowPlacementMetrics,
  tabRect: WindowTabRect,
  tabAnchor: Readonly<WindowTabAnchor>,
): Pick<WindowPosition, "left" | "top"> | null {
  const values = [
    metrics.screenX, metrics.screenY,
    metrics.outerWidth, metrics.outerHeight, metrics.innerWidth, metrics.innerHeight,
    tabRect.left, tabRect.top,
    tabAnchor.screenX, tabAnchor.screenY, tabAnchor.offsetX, tabAnchor.offsetY,
  ];
  if (!values.every(Number.isFinite) ||
    metrics.outerWidth <= 0 || metrics.outerHeight <= 0 ||
    metrics.innerWidth <= 0 || metrics.innerHeight <= 0) return null;

  const borderX = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
  const topChrome = Math.max(0, metrics.outerHeight - metrics.innerHeight - borderX);
  // The viewport begins at screenX + borderX / screenY + topChrome.
  // Solving for the new window origin cancels its previous screen position.
  const left = tabAnchor.screenX - borderX - tabRect.left - tabAnchor.offsetX;
  const top = tabAnchor.screenY - topChrome - tabRect.top - tabAnchor.offsetY;
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left: Math.round(left), top: Math.round(top) };
}

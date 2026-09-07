export const SIDEBAR_DEFAULT_WIDTH = 208;
export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 400;
export const SIDEBAR_GRIP_WIDTH = 6;
export const SIDEBAR_MAIN_MIN_WIDTH = 320;
export const SIDEBAR_DESKTOP_BREAKPOINT = 720;

/** Reserve room for the file list when the containing Explorer gets narrower. */
export function sidebarLimits(containerWidth: number | null) {
  const max = containerWidth === null
    ? SIDEBAR_MAX_WIDTH
    : Math.max(0, Math.min(
      SIDEBAR_MAX_WIDTH,
      containerWidth - SIDEBAR_MAIN_MIN_WIDTH - SIDEBAR_GRIP_WIDTH,
    ));
  return { min: Math.min(SIDEBAR_MIN_WIDTH, max), max };
}

export function clampSidebarWidth(width: number, containerWidth: number | null) {
  const { min, max } = sidebarLimits(containerWidth);
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Presentation only; never persisted into a document or its edit history. */
export type ResponsiveLayout = "auto" | "desktop" | "mobile";
export type ResolvedResponsiveLayout = Exclude<ResponsiveLayout, "auto">;

/** CSS pixels of the component, independent of the device or browser window. */
export const MOBILE_LAYOUT_BREAKPOINT = 720;

export function resolveResponsiveLayout(layout: ResponsiveLayout | undefined, width: number): ResolvedResponsiveLayout {
  if (layout === "mobile" || layout === "desktop") return layout;
  return Number.isFinite(width) && width > 0 && width < MOBILE_LAYOUT_BREAKPOINT ? "mobile" : "desktop";
}

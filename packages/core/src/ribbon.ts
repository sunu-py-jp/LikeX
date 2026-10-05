/** View-only presentation shared by the Office-style editors; never document data. */
export type RibbonDisplayMode = "expanded" | "tabs" | "autoHide" | "hidden";

export function isRibbonDisplayMode(value: unknown): value is RibbonDisplayMode {
  return value === "expanded" || value === "tabs" || value === "autoHide" || value === "hidden";
}

export function normalizeRibbonDisplayMode(value: unknown): RibbonDisplayMode {
  return isRibbonDisplayMode(value) ? value : "expanded";
}

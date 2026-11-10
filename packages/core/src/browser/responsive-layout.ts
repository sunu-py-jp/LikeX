import { resolveResponsiveLayout, type ResponsiveLayout, type ResolvedResponsiveLayout } from "../responsive-layout";

/** Observe the host's CSS width without importing React or accessing DOM at module load. */
export function observeResponsiveLayout(element: HTMLElement, layout: ResponsiveLayout | undefined,
  listener: (layout: ResolvedResponsiveLayout) => void): () => void {
  let active = true, previous: ResolvedResponsiveLayout | undefined;
  const update = () => {
    if (!active) return;
    const next = resolveResponsiveLayout(layout, element.clientWidth);
    if (next === previous) return;
    previous = next;
    listener(next);
  };
  update();
  if (layout === "desktop" || layout === "mobile") return () => { active = false; };
  const view = element.ownerDocument?.defaultView;
  const observer = view?.ResizeObserver ? new view.ResizeObserver(update) : undefined;
  observer?.observe(element);
  // Useful for older embedded browsers without element resize observation.
  if (!observer) view?.addEventListener("resize", update);
  return () => { active = false; observer?.disconnect(); if (!observer) view?.removeEventListener("resize", update); };
}

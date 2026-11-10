/** Keep DOM focus ownership inside an embedding dialog, without depending on its UI library. */
export function getSpreadsheetFloatingHost(region: HTMLElement, contained = false) {
  const dialog = region.closest<HTMLElement>('dialog, [role="dialog"], [role="alertdialog"]');
  const popover = !!dialog && !contained && typeof region.showPopover === "function";
  return { container: dialog ? popover ? dialog : region : region.ownerDocument.body,
    popover, contained: !!dialog && !popover };
}

/** A manual popover escapes clipping/transforms while remaining a DOM descendant of the focus scope. */
export function showSpreadsheetFloatingLayer(layer: HTMLElement, region: HTMLElement): () => void {
  const doc = region.ownerDocument, view = doc.defaultView;
  const owner = region.closest('dialog, [role="dialog"], [role="alertdialog"]');
  let foregroundObserver: MutationObserver | undefined;
  const sync = () => {
    // Yield to a newer modal that makes this sheet inert or hides its accessible subtree.
    // Some focus scopes hide individual descendants instead of the enclosing dialog itself.
    const focusedDialog = doc.activeElement?.closest('dialog, [role="dialog"], [role="alertdialog"]');
    const foreground = focusedDialog && focusedDialog !== owner && !layer.contains(focusedDialog) &&
      focusedDialog.getAttribute("aria-modal") !== "false" ? focusedDialog : null;
    // Removing a focused dialog need not produce another focusin event (focus can return to body).
    foregroundObserver?.disconnect();
    // Watch its ancestor chain, not the whole document subtree: hosts may remove a portal wrapper.
    for (let parent = foreground?.parentElement; parent; parent = parent.parentElement)
      foregroundObserver?.observe(parent, { childList: true });
    const hidden = !!region.closest('[inert], [aria-hidden="true"], [hidden], dialog:not([open])') ||
      !!foreground;
    if (hidden) {
      if (layer.matches(":popover-open")) layer.hidePopover();
    } else if (!layer.matches(":popover-open")) layer.showPopover();
  };
  if (view) foregroundObserver = new view.MutationObserver(sync);
  sync();
  doc.addEventListener("focusin", sync);
  const observer = view && new view.MutationObserver(sync);
  for (let element: HTMLElement | null = region; element; element = element.parentElement)
    observer?.observe(element, { attributes: true, attributeFilter: ["inert", "aria-hidden", "hidden", "open"] });
  return () => {
    doc.removeEventListener("focusin", sync);
    foregroundObserver?.disconnect();
    observer?.disconnect();
    if (layer.matches(":popover-open")) layer.hidePopover();
  };
}

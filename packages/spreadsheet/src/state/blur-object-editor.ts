/** Pointer selection prevents the browser's normal focus change. Flush an
 * object editor before its selected cell/object is replaced and unmounted. */
export function blurObjectEditor(target: HTMLElement) {
  const active = target.ownerDocument.activeElement as HTMLElement | null;
  const root = target.closest("[data-likex-spreadsheet]");
  if (active && root?.contains(active) && active.matches(".lxs-comment-editor,.lxs-drawing-text-editor,.lxs-object-property input")) active.blur();
}

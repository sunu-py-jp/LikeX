import type { MouseEvent } from "react";

/** Editable controls and selected text retain the browser's native actions. */
export function preserveNativeContextMenu(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.closest("input,textarea,select,[contenteditable]:not([contenteditable='false'])") ||
    target.ownerDocument.getSelection()?.isCollapsed === false) event.stopPropagation();
}

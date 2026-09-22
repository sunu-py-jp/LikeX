"use client";

import { useLayoutEffect, useRef, type MouseEvent } from "react";
import { openContextMenu, type ContextMenuAction } from "../browser";
import type { SlideEditor } from "../state/use-slide-editor";

/** Keep a menu's captured targets valid while sharing the core DOM menu. */
export function useSlideContextMenu(editor: SlideEditor) {
  const close = useRef<(() => void) | undefined>(undefined);
  const policy = JSON.stringify(editor.features);
  useLayoutEffect(() => {
    close.current?.();
    return () => close.current?.();
  }, [editor.deck, editor.editable, editor.readOnly, policy]);

  return (event: MouseEvent<HTMLElement>, items: readonly ContextMenuAction[]) => {
    if (event.shiftKey || !items.length || (event.target as HTMLElement).closest?.("input,textarea,[contenteditable=true]")) return false;
    event.preventDefault(); event.stopPropagation();
    close.current?.();
    close.current = openContextMenu({
      anchor: event.currentTarget, x: event.clientX, y: event.clientY, items,
      onError: editor.reportError,
      onClose: () => { close.current = undefined; },
    });
    return true;
  };
}

"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { openContextMenu } from "../browser";
import { getBlocks } from "../model/index";
import type { DocumentEditor } from "../state/use-document-editor";
import type { DocumentSurfaceHandle } from "./document-surface";
import { createDocumentContextMenuItems, resolveDocumentContextTarget } from "./document-context-menu";

export function useDocumentContextMenu(editor: DocumentEditor, surface: RefObject<DocumentSurfaceHandle | null>) {
  const latest = useRef(editor), close = useRef<(() => void) | null>(null), mounted = useRef(true);
  useLayoutEffect(() => { latest.current = editor; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; close.current?.(); }; }, []);
  const policy = JSON.stringify(editor.features);
  useLayoutEffect(() => { close.current?.(); close.current = null; }, [editor.document, editor.selection, editor.readOnly, editor.busy, policy]);
  function open(event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) {
    const viewport = event.currentTarget, element = event.target as HTMLElement;
    if (typeof element.closest !== "function") return;
    let context = resolveDocumentContextTarget(element, viewport);
    const keyboard = !("clientX" in event) || (!event.clientX && !event.clientY);
    if (!context && keyboard && element.closest(".lxd-editor")) {
      const snapshot = latest.current.session.getSnapshot();
      const block = getBlocks(snapshot.document).find(item => (item.node.type === "image" || item.node.type === "table") && item.from === snapshot.selection.from && item.to === snapshot.selection.to);
      const anchor = block && [...viewport.querySelectorAll<HTMLElement>("[data-document-id]")].find(node => node.getAttribute("data-document-id") === block.id);
      if (anchor) context = resolveDocumentContextTarget(anchor, viewport);
    }
    if (!context) return;
    const { anchor, target } = context;
    const clipboard = anchor.ownerDocument.defaultView?.navigator?.clipboard;
    const items = createDocumentContextMenuItems(() => latest.current, target, {
      isCurrent: () => mounted.current && anchor.isConnected && viewport.contains(anchor),
      focus: () => surface.current?.focus(),
      copyText: clipboard?.writeText ? text => clipboard.writeText(text) : undefined,
    });
    if (!items.length) return;
    event.preventDefault(); event.stopPropagation(); close.current?.();
    close.current = openContextMenu({ anchor, ...("clientX" in event ? { x: event.clientX, y: event.clientY } : {}), items,
      onError: cause => latest.current.error(cause), onClose: () => { close.current = null; } });
  }
  return { onContextMenu: open, onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
    if (!event.nativeEvent.isComposing && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) open(event);
  } };
}

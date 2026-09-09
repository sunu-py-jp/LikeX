"use client";

import { useLayoutEffect, useRef } from "react";
import { useExplorerDom } from "./explorer-dom-context";

/** Start host actions only after Radix has released the closing menu's focus scope. */
export function useMenuActionHandoff() {
  const { document: ownerDocument, dialogContainer } = useExplorerDom();
  const pending = useRef<(() => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    // Invalidate the latest queued job; generation is a counter, not a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; pending.current = null; generation.current++; };
  }, []);

  function onOpenChange(open: boolean) {
    if (!open) return;
    generation.current++;
    pending.current = null;
    previousFocus.current = ownerDocument?.activeElement as HTMLElement | null;
  }
  function defer(action: () => void) { pending.current = action; }
  function onCloseAutoFocus(event: Event) {
    const action = pending.current;
    if (!action) return;
    pending.current = null;
    event.preventDefault();
    const revision = generation.current;
    // Radix removes its focus scope after dispatching onCloseAutoFocus. A
    // microtask runs after that cleanup; an immediately opened host dialog
    // cannot then lose focus to the menu's trigger restoration or focus trap.
    queueMicrotask(() => {
      if (!mounted.current || generation.current !== revision || ownerDocument?.defaultView?.closed) return;
      const prior = previousFocus.current;
      const target = prior?.isConnected && !prior.matches(":disabled,[inert]") ? prior : dialogContainer;
      target?.focus({ preventScroll: true });
      action();
    });
  }
  return { onOpenChange, defer, onCloseAutoFocus };
}

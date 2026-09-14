"use client";

import { useEffect, useInsertionEffect, useRef, type RefObject } from "react";

type MouseNavigationOptions = {
  rootRef: RefObject<HTMLElement | null>;
  ownerDocument: Document | null;
  enabled: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  travel: (direction: -1 | 1) => void;
};

type SideButton = 3 | 4;
type Gesture = {
  consumed: boolean;
  phase: "pointerdown" | "mousedown" | "released";
  pointerId?: number;
};

function sideButton(event: MouseEvent): SideButton | null {
  return event.button === 3 || event.button === 4 ? event.button : null;
}

function belongsToPane(event: Event, root: HTMLElement | null) {
  if (!root) return false;
  // Inspect DOM ancestry, not React portal ancestry. The closest pane owns the
  // gesture even when that pane has this feature disabled. Avoid instanceof so
  // nodes from detached Explorer windows work across document realms.
  const path = event.composedPath();
  for (const target of path) {
    if (target === root) return true;
    if ((target as Element).hasAttribute?.("data-explorer-root")) return false;
  }
  return false;
}

function consume(event: Event) {
  event.preventDefault();
  event.stopPropagation();
}

/** Side buttons borrow folder history only for gestures started in this pane. */
export function useExplorerMouseNavigation(options: MouseNavigationOptions) {
  const current = useRef(options);
  // A gesture must use the visible tab and policy, including when a subsequent
  // render suspends. Its already-made decision survives tab/policy changes.
  useInsertionEffect(() => { current.current = options; }, [options]);
  const { rootRef, ownerDocument } = options;

  useEffect(() => {
    if (!ownerDocument) return;
    const gestures = new Map<SideButton, Gesture>();

    function down(event: MouseEvent) {
      const button = sideButton(event);
      if (button === null) return;
      const previous = gestures.get(button);
      if (event.type === "mousedown" && previous?.phase === "pointerdown") {
        // Compatibility mouse events belong to the preceding pointer press;
        // navigating there may already have reached the history endpoint.
        previous.phase = "mousedown";
        if (previous.consumed) consume(event);
        return;
      }

      const latest = current.current;
      const direction = button === 3 ? -1 : 1;
      const available = direction === -1 ? latest.canGoBack : latest.canGoForward;
      const consumed = latest.enabled && available && event.cancelable &&
        !event.defaultPrevented && belongsToPane(event, rootRef.current);
      const gesture: Gesture = {
        consumed,
        phase: event.type === "pointerdown" ? "pointerdown" : "mousedown",
        ...(event.type === "pointerdown" ? { pointerId: (event as PointerEvent).pointerId } : {}),
      };
      // Record pass-through presses too: a later release must not borrow newly
      // available history or move into an Explorer after starting outside it.
      gestures.set(button, gesture);
      if (!consumed) return;
      consume(event);
      latest.travel(direction);
    }

    function finish(event: MouseEvent) {
      const button = sideButton(event);
      if (button === null) return;
      const gesture = gestures.get(button);
      if (!gesture) return;
      if (gesture.consumed) consume(event);
      gesture.phase = "released";
      if (event.type === "auxclick") gestures.delete(button);
    }

    function cancel(event: PointerEvent) {
      for (const gesture of gestures.values()) {
        if (gesture.pointerId === event.pointerId) gesture.phase = "released";
      }
    }
    const reset = () => gestures.clear();
    const capture = { capture: true, passive: false };
    ownerDocument.addEventListener("pointerdown", down, capture);
    ownerDocument.addEventListener("mousedown", down, capture);
    ownerDocument.addEventListener("pointerup", finish, capture);
    ownerDocument.addEventListener("mouseup", finish, capture);
    ownerDocument.addEventListener("auxclick", finish, capture);
    ownerDocument.addEventListener("pointercancel", cancel, capture);
    ownerDocument.defaultView?.addEventListener?.("blur", reset);
    ownerDocument.defaultView?.addEventListener?.("pagehide", reset);
    return () => {
      ownerDocument.removeEventListener("pointerdown", down, capture);
      ownerDocument.removeEventListener("mousedown", down, capture);
      ownerDocument.removeEventListener("pointerup", finish, capture);
      ownerDocument.removeEventListener("mouseup", finish, capture);
      ownerDocument.removeEventListener("auxclick", finish, capture);
      ownerDocument.removeEventListener("pointercancel", cancel, capture);
      ownerDocument.defaultView?.removeEventListener?.("blur", reset);
      ownerDocument.defaultView?.removeEventListener?.("pagehide", reset);
      reset();
    };
  }, [ownerDocument, rootRef]);
}

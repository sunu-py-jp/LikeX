"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import type { SlideEditor } from "./use-slide-editor";

type TextControl = HTMLInputElement | HTMLTextAreaElement;
function textControl(target: EventTarget | null): TextControl | null {
  const element = target as HTMLElement | null;
  return element?.matches?.("textarea, input:not([type]), input[type=text], input[type=number], input[type=search]") ? element as TextControl : null;
}

/** Compare focused input buffers with their starting values, without storing document data twice. */
export function useSlideInputTracking(root: RefObject<HTMLDivElement | null>, editor: Pick<SlideEditor, "registerInputFlush" | "refreshPendingInput">) {
  const inputs = useRef(new Map<TextControl, string>());
  const register = editor.registerInputFlush, refresh = editor.refreshPendingInput;
  useLayoutEffect(() => {
    const flush = () => {
      const active = root.current?.ownerDocument.activeElement as HTMLElement | null;
      if (active && root.current?.contains(active) && textControl(active)) active.blur();
    };
    return register(flush,
      () => {
        let pending = false;
        for (const [element, initial] of inputs.current) {
          if (!element.isConnected) inputs.current.delete(element);
          else if (element.value !== initial) pending = true;
        }
        return pending;
      },
      () => { for (const [element, initial] of inputs.current) if (element.isConnected) element.value = initial; flush(); inputs.current.clear(); });
  }, [register, root]);
  return {
    onFocusCapture(event: { target: EventTarget | null }) {
      const element = textControl(event.target);
      if (element && !inputs.current.has(element)) inputs.current.set(element, element.value);
      refresh();
    },
    onInputCapture() { refresh(); },
    onBlur(event: { target: EventTarget | null }) {
      const element = textControl(event.target);
      if (element) inputs.current.delete(element);
      refresh();
    },
    onKeyDownCapture(event: { key: string }) {
      // Escape may restore a field or unmount the canvas textarea without blur.
      if (event.key === "Escape") queueMicrotask(refresh);
    },
  };
}

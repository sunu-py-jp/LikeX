"use client";

import { useEffect, useRef, useState } from "react";

type VisibilityObserver = {
  observer: IntersectionObserver;
  listeners: Map<Element, (visible: boolean) => void>;
};
const observers = new WeakMap<Document, VisibilityObserver>();

/** One viewport observer per document, including documents in detached windows. */
export function useMediaVisible() {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const document = element?.ownerDocument;
    const Observer = document?.defaultView?.IntersectionObserver;
    if (!element || !document || !Observer) {
      // Browsers without IntersectionObserver keep the existing eager fallback.
      setVisible(true);
      return;
    }
    let shared = observers.get(document);
    if (!shared) {
      const listeners = new Map<Element, (visible: boolean) => void>();
      const observer = new Observer(entries => {
        for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
      });
      shared = { observer, listeners };
      observers.set(document, shared);
    }
    shared.listeners.set(element, setVisible);
    shared.observer.observe(element);
    return () => {
      shared.listeners.delete(element);
      shared.observer.unobserve(element);
      if (!shared.listeners.size) { shared.observer.disconnect(); observers.delete(document); }
    };
  }, []);
  return { ref, visible };
}

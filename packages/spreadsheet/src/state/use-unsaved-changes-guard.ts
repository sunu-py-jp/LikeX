"use client";

import { useLayoutEffect, useState, type RefObject } from "react";
import { createUnsavedChangesGuard } from "../core";

/** Registers against the actual host document, including an embedded popup view. */
export function useUnsavedChangesGuard(root: RefObject<HTMLElement | null>, active: boolean) {
  const [guard] = useState(createUnsavedChangesGuard);
  useLayoutEffect(() => guard.register(root.current?.ownerDocument.defaultView), [guard, root]);
  useLayoutEffect(() => {
    guard.setActive(active);
    return () => guard.setActive(false);
  }, [guard, active]);
}

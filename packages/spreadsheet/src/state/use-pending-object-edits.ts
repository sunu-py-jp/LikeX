"use client";

import { useCallback, useRef, useState } from "react";

/** Multiple object fields can own unfinished edits without clearing another field's pending state. */
export function usePendingObjectEdits() {
  const [pendingObjectEdit, setPendingObjectEditState] = useState(false);
  const pendingObjectEditRef = useRef(false);
  const owners = useRef(new Set<object>());
  const defaultOwner = useRef({});
  const setPendingObjectEdit = useCallback((value: boolean, owner = defaultOwner.current) => {
    if (value) owners.current.add(owner);
    else owners.current.delete(owner);
    const pending = owners.current.size > 0;
    pendingObjectEditRef.current = pending;
    setPendingObjectEditState(pending);
  }, []);
  return { pendingObjectEdit, pendingObjectEditRef, setPendingObjectEdit };
}

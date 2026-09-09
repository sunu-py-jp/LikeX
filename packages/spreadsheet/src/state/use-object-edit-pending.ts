"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import type { SpreadsheetController } from "./use-spreadsheet";

// Each input owns its flag: confirming one cannot clear another invalid draft.
export function useObjectEditPending(controller: SpreadsheetController) {
  const [owner] = useState(() => ({}));
  const setter = controller.setPendingObjectEdit;
  const markPending = useCallback((pending: boolean) => setter(pending, owner), [owner, setter]);
  useLayoutEffect(() => () => markPending(false), [markPending]);
  return markPending;
}

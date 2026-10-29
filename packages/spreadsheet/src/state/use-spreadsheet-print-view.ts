"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { notifyHost } from "../core";
import type { SpreadsheetProps } from "../props";

/** Page-boundary presentation is local view state, including for read-only workbooks. */
export function useSpreadsheetPrintView(props: SpreadsheetProps) {
  const [printAreaView, update] = useState(props.initialPrintAreaView === true);
  const current = useRef(printAreaView), mounted = useRef(true), callback = useRef(props.onPrintAreaViewChange);
  useLayoutEffect(() => { callback.current = props.onPrintAreaViewChange; }, [props.onPrintAreaViewChange]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const setPrintAreaView = useCallback((visible: boolean) => {
    if (!mounted.current || typeof visible !== "boolean" || visible === current.current) return false;
    current.current = visible; update(visible); notifyHost(callback.current, visible); return true;
  }, []);
  const getPrintAreaView = useCallback(() => current.current, []);
  return { printAreaView, setPrintAreaView, getPrintAreaView };
}

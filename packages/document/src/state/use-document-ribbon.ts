"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { isRibbonDisplayMode, normalizeRibbonDisplayMode, notifyHost } from "../core";
import type { DocumentProps, DocumentRibbonDisplayMode } from "../props";

/** Ribbon presentation never requests an editing lease or changes the saved document. */
export function useDocumentRibbon(props: DocumentProps) {
  const controlled = props.ribbonDisplayMode !== undefined;
  const [localMode, updateMode] = useState(() => normalizeRibbonDisplayMode(props.ribbonDisplayMode ?? props.initialRibbonDisplayMode));
  const ribbonDisplayMode = controlled ? normalizeRibbonDisplayMode(props.ribbonDisplayMode) : localMode;
  // Derive the fallback before commit so releasing host control retains its last displayed mode.
  if (controlled && localMode !== ribbonDisplayMode) updateMode(ribbonDisplayMode);
  const current = useRef(ribbonDisplayMode);
  const latest = useRef({ controlled, onChange: props.onRibbonDisplayModeChange });
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    current.current = ribbonDisplayMode;
    latest.current = { controlled, onChange: props.onRibbonDisplayModeChange };
  }, [controlled, ribbonDisplayMode, props.onRibbonDisplayModeChange]);

  const setRibbonDisplayMode = useCallback((mode: DocumentRibbonDisplayMode): boolean => {
    if (!mounted.current || !isRibbonDisplayMode(mode) || mode === current.current) return false;
    const { controlled: isControlled, onChange } = latest.current;
    if (isControlled && !onChange) return false;
    if (!isControlled) {
      current.current = mode;
      updateMode(mode);
    }
    notifyHost(onChange, mode);
    return true;
  }, []);
  const getRibbonDisplayMode = useCallback(() => current.current, []);
  return { ribbonDisplayMode, setRibbonDisplayMode, getRibbonDisplayMode,
    ribbonDisplayModeLocked: controlled && !props.onRibbonDisplayModeChange };
}

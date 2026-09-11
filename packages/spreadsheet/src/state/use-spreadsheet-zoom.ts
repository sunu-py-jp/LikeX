"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { SpreadsheetProps } from "../props";
import type { SpreadsheetEvent } from "../api/lifecycle";

export const MIN_ZOOM = 25;
export const MAX_ZOOM = 200;
export function clampZoom(value: number) {
  return Number.isFinite(value) ? Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))) : 100;
}
/** The midpoint is always 100%, with a separate linear scale on each side. */
export function zoomSliderPosition(zoom: number) { return zoom <= 100 ? (zoom - MIN_ZOOM) / (100 - MIN_ZOOM) * 50 : 50 + (zoom - 100) / (MAX_ZOOM - 100) * 50; }
export function zoomAtSliderPosition(position: number) { return clampZoom(position <= 50 ? MIN_ZOOM + position / 50 * (100 - MIN_ZOOM) : 100 + (position - 50) / 50 * (MAX_ZOOM - 100)); }

/** View-only state: no workbook transaction, editing lease or history entry. */
export function useSpreadsheetZoom(props: SpreadsheetProps, emitEvent: (event: SpreadsheetEvent) => void) {
  const [zoom, updateZoom] = useState(() => clampZoom(props.initialZoom ?? 100));
  const current = useRef(zoom), latest = useRef({ enabled: props.features?.zoom !== false, emitEvent });
  const mounted = useRef(true);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { enabled: props.features?.zoom !== false, emitEvent }; });
  const setZoom = (value: number): boolean => {
    if (!mounted.current || !latest.current.enabled || !Number.isFinite(value)) return false;
    const next = clampZoom(value), previousZoom = current.current;
    if (next !== previousZoom) {
      current.current = next; updateZoom(next);
      latest.current.emitEvent({ type: "zoom-change", zoom: next, previousZoom });
    }
    return true;
  };
  return { zoom, setZoom, getZoom: () => current.current };
}

"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { SpreadsheetController } from "../../state/use-spreadsheet";
import { MIN_ZOOM, MAX_ZOOM } from "../../state/use-spreadsheet-zoom";

type PinchEvent = Event & { scale: number };

/** Native non-passive listeners intercept only zoom gestures over this grid. */
export function useGridZoom(c: SpreadsheetController, scroller: RefObject<HTMLDivElement | null>) {
  const latest = useRef(c);
  useLayoutEffect(() => { latest.current = c; });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let wheelZoom = latest.current.getZoom(), publishedZoom = wheelZoom, pinchStart: number | null = null;
    const wheel = (event: WheelEvent) => {
      const current = latest.current;
      if (!current.features.zoom || !event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      if (pinchStart !== null || !Number.isFinite(event.deltaY)) return;
      // Native events and host API calls can occur before React commits another render.
      const zoom = current.getZoom();
      if (zoom !== publishedZoom) wheelZoom = zoom;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      wheelZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, wheelZoom * Math.exp(-Math.max(-400, Math.min(400, delta)) / 300)));
      publishedZoom = Math.round(wheelZoom);
      current.setZoom(publishedZoom);
    };
    // Safari exposes trackpad pinch through GestureEvent instead of ctrl+wheel.
    const start = (event: Event) => {
      if (!latest.current.features.zoom) return;
      event.preventDefault(); pinchStart = latest.current.getZoom();
    };
    const change = (event: Event) => {
      if (pinchStart === null || !latest.current.features.zoom) return;
      event.preventDefault();
      const scale = (event as PinchEvent).scale;
      if (Number.isFinite(scale) && scale > 0) latest.current.setZoom(pinchStart * scale);
    };
    const end = (event: Event) => { if (pinchStart !== null) event.preventDefault(); pinchStart = null; };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", start, { passive: false });
    element.addEventListener("gesturechange", change, { passive: false });
    element.addEventListener("gestureend", end, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel); element.removeEventListener("gesturestart", start);
      element.removeEventListener("gesturechange", change); element.removeEventListener("gestureend", end);
    };
  }, [scroller]);
}

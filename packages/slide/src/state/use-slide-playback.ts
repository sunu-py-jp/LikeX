"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { evaluateSlideAnimations, resolveSlideAnimations } from "../model/index";
import type { Slide } from "../model/types";

type Click = { elapsedMs: number; elementId?: string };
type Playback = { source: Slide; enabled: boolean; final: boolean; visit: number; elapsedMs: number; clockElapsed: number; clicks: Click[]; revision: number };

function evaluate(state: Playback, reducedMotion: boolean) {
  let elapsedMs = state.elapsedMs;
  if (!state.enabled || state.final) return { elapsedMs,
    frame: { slide: resolveSlideAnimations(state.source), finished: true, waitingForClick: false } as ReturnType<typeof evaluateSlideAnimations> };
  let frame = evaluateSlideAnimations(state.source, { elapsedMs, clicks: state.clicks });
  // Keep authored click gates accessible while removing motion and timed waits.
  for (let count = 0; reducedMotion && !frame.finished && !frame.waitingForClick && count <= (state.source.animations?.length ?? 0); count++) {
    if (frame.stepEndMs === undefined || frame.stepEndMs <= elapsedMs) break;
    elapsedMs = frame.stepEndMs;
    frame = evaluateSlideAnimations(state.source, { elapsedMs, clicks: state.clicks });
  }
  return { frame, elapsedMs };
}

/** Playback state is local to the presentation; no edit command or history entry is created. */
export function useSlidePlayback(source: Slide, ownerDocument: Document, enabled = true, final = false, visit = 0) {
  const media = useMemo(() => ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)"), [ownerDocument]);
  const subscribe = useCallback((notify: () => void) => {
    if (!media) return () => {};
    if (media.addEventListener) { media.addEventListener("change", notify); return () => media.removeEventListener("change", notify); }
    media.addListener(notify); return () => media.removeListener(notify);
  }, [media]);
  const reducedMotion = useSyncExternalStore(subscribe, () => media?.matches ?? false, () => false);
  const [state, setState] = useState<Playback>(() => ({ source, enabled, final, visit, elapsedMs: 0, clockElapsed: 0, clicks: [], revision: 0 }));
  const current = useMemo<Playback>(() => state.source !== source || state.enabled !== enabled || state.final !== final || state.visit !== visit
    ? { source, enabled, final, visit, elapsedMs: 0, clockElapsed: 0, clicks: [], revision: state.revision + 1 } : state,
  [state, source, enabled, final, visit]);
  if (current !== state) setState(current);
  const evaluated = useMemo(() => evaluate(current, reducedMotion), [current, reducedMotion]);
  if (evaluated.elapsedMs !== current.elapsedMs) setState({ ...current, elapsedMs: evaluated.elapsedMs, clockElapsed: evaluated.elapsedMs });
  const { frame } = evaluated;

  useEffect(() => {
    const view = ownerDocument.defaultView;
    if (!view || !enabled || final || reducedMotion || frame.finished || frame.waitingForClick) return;
    let request = 0, start: number | undefined, disposed = false;
    const base = current.clockElapsed, revision = current.revision;
    const tick = (timestamp: number) => {
      if (disposed) return;
      start ??= timestamp;
      const elapsedMs = base + Math.max(0, timestamp - start);
      setState(current => current.source === source && current.revision === revision ? { ...current, elapsedMs } : current);
      request = view.requestAnimationFrame(tick);
    };
    request = view.requestAnimationFrame(tick);
    return () => { disposed = true; view.cancelAnimationFrame(request); };
    // Animation frames update elapsed time without restarting their clock.
  }, [ownerDocument, source, enabled, final, reducedMotion, frame.finished, frame.waitingForClick, current.revision, current.clockElapsed]);

  const advance = (elementId?: string): boolean => {
    if (frame.finished) return false;
    setState(current => {
      const { frame: latest, elapsedMs } = evaluate(current, reducedMotion);
      if (latest.finished) return current;
      if (latest.waitingForClick) {
        if (latest.waitingTargetId !== undefined && latest.waitingTargetId !== elementId) return current;
        return { ...current, elapsedMs, clockElapsed: elapsedMs, clicks: [...current.clicks, { elapsedMs, ...(elementId === undefined ? {} : { elementId }) }], revision: current.revision + 1 };
      }
      return latest.stepEndMs !== undefined ? { ...current, elapsedMs: latest.stepEndMs, clockElapsed: latest.stepEndMs, revision: current.revision + 1 } : current;
    });
    return true;
  };
  return { ...frame, advance, reducedMotion };
}

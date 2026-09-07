"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import { createMediaCache, type MediaCache } from "./media-cache";

// Standalone icons and previews still work without an Explorer provider.
const fallback = createMediaCache();
export const MediaCacheContext = createContext<MediaCache>(fallback);
export function useMediaCache() { return useContext(MediaCacheContext); }

/** Saves can overwrite an existing content ID; local Files remain immutable. */
export function useMediaRevision(cache: MediaCache, existing: boolean) {
  const subscribe = useCallback((listener: () => void) => existing ? cache.subscribe(listener) : () => {}, [cache, existing]);
  const snapshot = useCallback(() => existing ? cache.getRevision() : 0, [cache, existing]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { SlideProps } from "../props";

const light = { background: "#ffffff", panel: "#fafafa", foreground: "#242424", muted: "#616161", border: "#dedede", hover: "#eeeeee", canvas: "#ededed", accent: "#c64f2c", selection: "#fbe7df" };
const dark = { background: "#242424", panel: "#2b2b2b", foreground: "#f2f2f2", muted: "#b8b8b8", border: "#494949", hover: "#3b3b3b", canvas: "#191919", accent: "#f39472", selection: "#51352c" };
const falseSnapshot = () => false;
const noSubscription = () => () => {};

export function useSlideTheme(mode: SlideProps["colorMode"], ownerDocument: Document | null): CSSProperties {
  const media = useMemo(() => mode === "system" ? ownerDocument?.defaultView?.matchMedia?.("(prefers-color-scheme: dark)") : null, [mode, ownerDocument]);
  const store = useMemo(() => media ? {
    subscribe: (callback: () => void) => { media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); },
    getSnapshot: () => media.matches,
  } : { subscribe: noSubscription, getSnapshot: falseSnapshot }, [media]);
  const systemDark = useSyncExternalStore(store.subscribe, store.getSnapshot, falseSnapshot);
  const isDark = mode === "dark" || (mode === "system" && systemDark);
  return useMemo(() => ({ ...Object.fromEntries(Object.entries(isDark ? dark : light).map(([key, value]) => [`--lxp-${key}`, value])), colorScheme: isDark ? "dark" : "light" }), [isDark]);
}

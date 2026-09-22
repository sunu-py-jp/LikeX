"use client";

import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import type { DocumentProps } from "../props";
import { createPrimaryColorPalette } from "../core";

const light = { background: "#ffffff", panel: "#fafafa", foreground: "#242424", muted: "#616161", border: "#dedede", hover: "#eeeeee", canvas: "#ededed", accent: "#2b579a", selection: "#e6eefb" };
const dark = { background: "#242424", panel: "#2b2b2b", foreground: "#f2f2f2", muted: "#b8b8b8", border: "#494949", hover: "#3b3b3b", canvas: "#191919", accent: "#91baff", selection: "#243b60" };
const falseSnapshot = () => false;
const noSubscription = () => () => {};

export function useDocumentTheme(mode: DocumentProps["colorMode"], ownerDocument: Document | null, primaryColor?: string): CSSProperties {
  const media = useMemo(() => mode === "system" ? ownerDocument?.defaultView?.matchMedia?.("(prefers-color-scheme: dark)") : null, [mode, ownerDocument]);
  const store = useMemo(() => media ? {
    subscribe: (callback: () => void) => { media.addEventListener("change", callback); return () => media.removeEventListener("change", callback); },
    getSnapshot: () => media.matches,
  } : { subscribe: noSubscription, getSnapshot: falseSnapshot }, [media]);
  const systemDark = useSyncExternalStore(store.subscribe, store.getSnapshot, falseSnapshot);
  const isDark = mode === "dark" || (mode === "system" && systemDark);
  return useMemo(() => {
    const palette = createPrimaryColorPalette(primaryColor, isDark ? "dark" : "light");
    return {
      ...Object.fromEntries(Object.entries(isDark ? dark : light).map(([key, value]) => [`--lxd-${key}`, value])),
      ...(palette ? { "--lxd-primary": palette.primary, "--lxd-on-primary": palette.onPrimary,
        "--lxd-primary-hover": palette.primaryHover, "--lxd-accent": palette.accent, "--lxd-selection": palette.selection } : {}),
      colorScheme: isDark ? "dark" : "light",
    } as CSSProperties;
  }, [isDark, primaryColor]);
}

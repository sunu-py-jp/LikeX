"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type CSSProperties } from "react";

export type ExplorerColorMode = "light" | "dark" | "system";

export type ExplorerTheme = {
  background: string;
  panel: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  accentForeground: string;
  selection: string;
  hover: string;
  danger: string;
  /** Text on destructive action buttons. Optional for existing full palettes. */
  dangerForeground?: string;
  folder: string;
  fontFamily: string;
  colorScheme: "light" | "dark";
};

export type ExplorerThemeOverrides = Partial<Omit<ExplorerTheme, "colorScheme">> & {
  /** Base surface color; generates background, panel, border, hover and selection. */
  baseColor?: string;
};

export type ExplorerThemeOptions = Partial<ExplorerTheme> & {
  baseColor?: string;
  light?: ExplorerThemeOverrides;
  dark?: ExplorerThemeOverrides;
};

export const lightExplorerTheme: ExplorerTheme = {
  background: "#ffffff",
  panel: "#fafafa",
  foreground: "#252525",
  muted: "#666666",
  border: "#e5e5e5",
  accent: "#0067c0",
  accentForeground: "#ffffff",
  selection: "#e5f3ff",
  hover: "#f0f0f0",
  danger: "#b42318",
  dangerForeground: "#ffffff",
  folder: "#d6a126",
  fontFamily:
    '"Segoe UI Variable", "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif',
  colorScheme: "light",
};

/** The unchanged light palette remains the default for existing consumers. */
export const defaultExplorerTheme = lightExplorerTheme;

export const darkExplorerTheme: ExplorerTheme = {
  ...lightExplorerTheme,
  background: "#1f1f1f",
  panel: "#262626",
  foreground: "#f3f3f3",
  muted: "#b3b3b3",
  border: "#454545",
  accent: "#75baff",
  accentForeground: "#102a43",
  selection: "#243d54",
  hover: "#333333",
  danger: "#ff9b91",
  dangerForeground: "#3d0c08",
  folder: "#e4b94f",
  colorScheme: "dark",
};

export function explorerThemeStyle(
  theme: ExplorerThemeOptions = {},
  colorScheme: ExplorerTheme["colorScheme"] = theme.colorScheme ?? "light",
): CSSProperties {
  const preset = colorScheme === "dark" ? darkExplorerTheme : lightExplorerTheme;
  const overrides = {
    ...theme,
    ...Object.fromEntries(Object.entries(theme[colorScheme] ?? {}).filter(([, value]) => value !== undefined)),
  };
  // Only palette keys become CSS variables. Nested configuration never leaks
  // into the style, and an explicitly undefined option still uses its default.
  const explicit = Object.fromEntries(
    Object.keys(preset)
      .filter(key => key !== "colorScheme" && overrides[key as keyof ExplorerTheme] !== undefined)
      .map(key => [key, overrides[key as keyof ExplorerTheme]]),
  );
  const resolved = { ...preset, ...explicit, colorScheme };
  const base = overrides.baseColor;
  if (base !== undefined) {
    Object.assign(resolved, {
      background: base,
      panel: `color-mix(in srgb, ${base}, ${resolved.foreground} 3%)`,
      border: `color-mix(in srgb, ${base}, ${resolved.foreground} 16%)`,
      hover: `color-mix(in srgb, ${base}, ${resolved.foreground} 7%)`,
      selection: `color-mix(in srgb, ${base}, ${resolved.accent} 18%)`,
    }, explicit);
  }
  return {
    ...Object.fromEntries(
      Object.entries(resolved).map(([key, value]) => [
        `--explorer-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        value,
      ]),
    ),
    fontFamily: resolved.fontFamily,
    colorScheme: resolved.colorScheme,
  };
}

const lightSnapshot = () => false;
const noSubscription = () => () => {};

/** Subscribe to the owning window, including when the pane is in a popup. */
export function useExplorerColorScheme(
  colorMode: ExplorerColorMode | undefined,
  theme: ExplorerThemeOptions | undefined,
  ownerDocument: Document | null,
): ExplorerTheme["colorScheme"] {
  const mode = colorMode ?? theme?.colorScheme ?? "light";
  const ownerWindow = ownerDocument?.defaultView;
  const media = useMemo(() => {
    if (mode !== "system" || !ownerWindow?.matchMedia) return null;
    try {
      return ownerWindow.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return null;
    }
  }, [mode, ownerWindow]);
  const store = useMemo(() => media ? {
    subscribe: (onChange: () => void) => {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    getSnapshot: () => media.matches,
  } : { subscribe: noSubscription, getSnapshot: lightSnapshot }, [media]);
  const systemDark = useSyncExternalStore(store.subscribe, store.getSnapshot, lightSnapshot);
  return mode === "system" ? systemDark ? "dark" : "light" : mode;
}

// Portals cannot inherit root DOM variables, so every floating surface receives
// the same instance theme through React context.
export const ExplorerThemeContext =
  createContext<CSSProperties>(explorerThemeStyle());
export function useExplorerTheme() {
  return useContext(ExplorerThemeContext);
}

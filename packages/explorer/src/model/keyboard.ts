/** Internal keyboard contract shared by command handlers and shortcut hints. */
type KeyEvent = {
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

type Modifier = "primary" | "alt" | "meta";
type Binding = { keys: readonly string[]; modifier?: Modifier };

const bindings = {
  save: [{ keys: ["s"], modifier: "primary" }],
  search: [{ keys: ["f", "k"], modifier: "primary" }],
  selectAll: [{ keys: ["a"], modifier: "primary" }],
  copy: [{ keys: ["c"], modifier: "primary" }],
  cut: [{ keys: ["x"], modifier: "primary" }],
  paste: [{ keys: ["v"], modifier: "primary" }],
  rename: [{ keys: ["F2"] }],
  delete: [{ keys: ["Delete"] }, { keys: ["Backspace"], modifier: "meta" }],
  open: [{ keys: ["Enter", " "] }],
  clear: [{ keys: ["Escape"] }],
  up: [{ keys: ["ArrowUp"], modifier: "alt" }],
  back: [{ keys: ["ArrowLeft"], modifier: "alt" }],
  forward: [{ keys: ["ArrowRight"], modifier: "alt" }],
  refresh: [{ keys: ["F5"] }],
} as const satisfies Record<string, readonly Binding[]>;

export type ExplorerShortcut = keyof typeof bindings;

export function isComposingKeyEvent(event: KeyEvent): boolean {
  return event.isComposing === true || event.keyCode === 229 ||
    event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229;
}

export function hasKeyModifiers(event: KeyEvent): boolean {
  return Boolean(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
}

export function matchesExplorerShortcut(event: KeyEvent, shortcut: ExplorerShortcut): boolean {
  if (isComposingKeyEvent(event) || event.shiftKey) return false;
  return (bindings[shortcut] as readonly Binding[]).some(({ keys, modifier }) => {
    if (!keys.some(key => key.toLowerCase() === event.key?.toLowerCase())) return false;
    switch (modifier) {
      case "primary": return !event.altKey && Boolean(event.ctrlKey) !== Boolean(event.metaKey);
      case "alt": return !!event.altKey && !event.ctrlKey && !event.metaKey;
      case "meta": return !!event.metaKey && !event.ctrlKey && !event.altKey;
      default: return !event.altKey && !event.ctrlKey && !event.metaKey;
    }
  });
}

const keyLabels: Record<string, string> = {
  " ": "Space", Escape: "Esc", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→",
};

export function shortcutLabel(shortcut: ExplorerShortcut): string {
  return (bindings[shortcut] as readonly Binding[]).map(({ keys, modifier }) => {
    const prefix = modifier === "primary" ? "Ctrl / ⌘ + " : modifier === "alt" ? "Alt + " : modifier === "meta" ? "⌘ + " : "";
    return prefix + keys.map(key => keyLabels[key] ?? (key.length === 1 ? key.toUpperCase() : key)).join(" / ");
  }).join(" / ");
}

export function shortcutAriaKeys(shortcut: ExplorerShortcut): string {
  return (bindings[shortcut] as readonly Binding[]).flatMap(({ keys, modifier }) =>
    keys.flatMap(key => {
      const value = key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : key;
      const prefixes = modifier === "primary" ? ["Control+", "Meta+"] :
        modifier === "alt" ? ["Alt+"] : modifier === "meta" ? ["Meta+"] : [""];
      return prefixes.map(prefix => prefix + value);
    }),
  ).join(" ");
}

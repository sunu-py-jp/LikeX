import type { ExplorerProps } from "@likex/explorer";

/** Optional playground-only switch; applications pass this prop directly. */
export function getDemoContextMenuMode(): NonNullable<ExplorerProps["contextMenuExecutionMode"]> {
  const mode = new URLSearchParams(window.location.search).get("menuMode");
  return mode === "confirm" || mode === "reject-if-changed" ? mode : "block";
}

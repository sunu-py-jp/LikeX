import type { ExplorerEntry } from "./draft";
import { getEntryIndex } from "./entry-index";
import { describeEntry, type ExplorerItemInfo } from "./item-info";

export type ExplorerPreviewRequest = ExplorerItemInfo & Readonly<{ kind: "file" }>;
/** Void preserves host-owned previews. Only "default" opens the built-in dialog. */
export type ExplorerPreviewResult = "default" | "handled" | void;
export type ExplorerPreviewHandler = (
  request: ExplorerPreviewRequest,
) => ExplorerPreviewResult | Promise<ExplorerPreviewResult>;
export type ExplorerPreviewTrigger = "doubleClick" | "click";

export type ExplorerPreviewMode = "image" | "pdf" | "video" | "text";
export type ExplorerPreviewFormat = Readonly<{
  mode: ExplorerPreviewMode;
  mime?: string;
}>;
export type ExplorerPreviewOptions = Readonly<{
  /** Add/override formats by dot-prefixed extension. Case and whitespace are normalized.
   * False disables that built-in format; SVG/HTML remain inert text. */
  formatsByExtension?: Readonly<Record<string, ExplorerPreviewFormat | false>>;
  /** Defaults to an empty sandbox. False omits the attribute; only use with
   * trusted PDF sources. The host owns URL response types, redirects and CSP. */
  pdfSandbox?: string | false;
}>;
export type ExplorerPreviewReadContext = Readonly<{ signal: AbortSignal }>;
export type ExplorerPreviewSourceContext = ExplorerPreviewReadContext & Readonly<{ processing: boolean }>;
/** Presentation-only source. It never replaces an entry or its download content. */
export type ExplorerPreviewSource =
  | Readonly<{
      kind: "blob";
      /** Stable identity of this preview variant; change it when its bytes change. */
      cacheKey: string;
      mime: string;
      mode?: ExplorerPreviewMode;
      /** Invoked lazily, after the preview cache has been checked. */
      read: (context: ExplorerPreviewReadContext) => Promise<Blob>;
    }>
  | Readonly<{
      kind: "url";
      url: string;
      mode: "image" | "pdf" | "video";
      /** Change to reload a new version served at the same URL; stable keys preserve playback. */
      cacheKey?: string;
      crossOrigin?: "anonymous" | "use-credentials";
    }>
  | Readonly<{ kind: "pending"; message?: string }>
  | null
  | undefined;
export type ExplorerPreviewSourceResolver = (
  entry: ExplorerPreviewRequest,
  context: ExplorerPreviewSourceContext,
) => ExplorerPreviewSource | Promise<ExplorerPreviewSource>;

export function createPreviewRequest(
  entries: readonly ExplorerEntry[],
  id: string,
): ExplorerPreviewRequest | null {
  const entry = getEntryIndex(entries).byId.get(id);
  return entry?.kind === "file"
    ? { ...describeEntry(entries, entry), kind: "file" }
    : null;
}

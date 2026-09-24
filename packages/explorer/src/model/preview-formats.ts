import type { ExplorerEntry } from "./draft";
import type { ExplorerPreviewFormat, ExplorerPreviewMode, ExplorerPreviewOptions } from "./preview";
import { fileExtension } from "./text";

/** Shared with upload inspection so both features recognize the same video suffixes. */
export const EXPLORER_VIDEO_MIME_TYPES = Object.freeze({
  ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/x-m4v",
  ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg",
  ".ogv": "video/ogg", ".3gp": "video/3gpp",
});

const imageMimeTypes: Readonly<Record<string, string>> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".avif": "image/avif", ".bmp": "image/bmp",
};
const textExtensions = new Set("txt md csv tsv json spon slon dcon js jsx ts tsx xml yaml yml html htm css vb cs py log sql sh ini cfg svg".split(" "));
const modes = new Set<ExplorerPreviewMode>(["image", "video", "pdf", "text"]);

export function inertPreviewMime(mime: string): boolean {
  return /^(?:image\/svg\+xml|text\/html|application\/xhtml\+xml)$/.test(mime.toLowerCase().split(";")[0].trim());
}

export function previewModeForMime(mime: string): ExplorerPreviewMode | undefined {
  const type = mime.toLowerCase().split(";")[0].trim();
  if (inertPreviewMime(type)) return "text";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/") || /^(?:application\/(?:json|xml|javascript))$/.test(type)) return "text";
}

/** Return a normalized format without mutating the host's configuration. */
export function getPreviewFormat(entry: ExplorerEntry, options?: ExplorerPreviewOptions): ExplorerPreviewFormat | null {
  if (entry.kind !== "file") return null;
  const extension = fileExtension(entry.name);
  let override: ExplorerPreviewFormat | false | undefined;
  for (const [key, value] of Object.entries(options?.formatsByExtension ?? {})) {
    const normalized = key.trim().normalize("NFC").toLowerCase();
    if (!/^\.[^./\s]+$/.test(normalized)) throw new Error("プレビュー形式の拡張子には先頭のドットを含めてください");
    if (normalized === `.${extension}`) override = value;
  }
  if (override === false) return null;
  // HTML and SVG remain inert even when a host overrides their display format.
  if (/^(?:svg|html|htm)$/.test(extension) || inertPreviewMime(entry.mime)) return { mode: "text" };
  if (override) {
    if (!modes.has(override.mode) || (override.mime !== undefined && (typeof override.mime !== "string" || /[\r\n]/.test(override.mime))))
      throw new Error("プレビュー形式のmodeまたはmimeが正しくありません");
    return { mode: inertPreviewMime(override.mime ?? "") ? "text" : override.mode, mime: override.mime };
  }
  const imageMime = imageMimeTypes[`.${extension}`];
  if (imageMime) return { mode: "image", mime: imageMime };
  const videoMime = EXPLORER_VIDEO_MIME_TYPES[`.${extension}` as keyof typeof EXPLORER_VIDEO_MIME_TYPES];
  if (videoMime) return { mode: "video", mime: videoMime };
  if (extension === "pdf") return { mode: "pdf", mime: "application/pdf" };
  return textExtensions.has(extension) ? { mode: "text" } : null;
}

/** Browser-owned direct URLs are never fetched or revoked by Explorer. */
export function validatePreviewUrl(value: string): string {
  if (typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error("プレビューURLが正しくありません");
  let url: URL;
  try { url = new URL(value, typeof location === "undefined" ? undefined : location.href); }
  catch { throw new Error("プレビューURLが正しくありません"); }
  if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "blob:")
    throw new Error("プレビューURLにはhttp、https、blobを使用してください");
  if (url.protocol === "blob:" && !/^blob:(?:https?:\/\/|null\/)/i.test(url.href))
    throw new Error("プレビュー用のBlob URLが正しくありません");
  return url.href;
}

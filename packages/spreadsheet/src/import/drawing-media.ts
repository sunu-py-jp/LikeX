import { imageMetadata, normalizeImageResource } from "../model/image-resources";
import { SPREADSHEET_LIMITS, type SpreadsheetImageResource } from "../model/types";
import type { ImportContext } from "./types";

const caches = new WeakMap<ImportContext, Map<string, string>>();
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(""));
}
/** Embedded raster bytes only; URLs and SVG markup are never fetched or rendered. */
export async function readDrawingImage(path: string, context: ImportContext): Promise<string | undefined> {
  context.signal?.throwIfAborted();
  let cache = caches.get(context);
  if (!cache) { cache = new Map(); caches.set(context, cache); }
  if (cache.has(path)) return cache.get(path);
  const mime: Record<string, SpreadsheetImageResource["mimeType"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  const extension = path.split(".").at(-1)?.toLowerCase(), mimeType = extension ? mime[extension] : undefined;
  if (!mimeType) return;
  const bytes = await context.archive.read(path);
  context.signal?.throwIfAborted();
  if (bytes.length > SPREADSHEET_LIMITS.imageBytes) throw new Error("Excelの画像1件のサイズが5 MiBを超えています");
  if (Object.keys(context.resources).length >= SPREADSHEET_LIMITS.images) throw new Error("Excelの画像数が上限を超えています");
  const totalBytes = Object.values(context.resources).reduce((sum, resource) => {
    const payload = resource.dataUrl.slice(resource.dataUrl.indexOf(",") + 1);
    return sum + payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
  }, bytes.length);
  if (totalBytes > SPREADSHEET_LIMITS.totalImageBytes) throw new Error("Excelの画像の合計サイズが20 MiBを超えています");
  let resource: SpreadsheetImageResource;
  try {
    const { width, height } = imageMetadata(bytes, mimeType);
    resource = normalizeImageResource({ name: path.split("/").at(-1)!, mimeType, width, height,
      dataUrl: `data:${mimeType};base64,${base64(bytes)}` });
  } catch { return; }
  const id = `image-${Object.keys(context.resources).length + 1}`;
  context.resources[id] = resource;
  cache.set(path, id);
  return id;
}

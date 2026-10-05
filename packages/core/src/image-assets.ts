import type { OfficePackageSignal } from "./ooxml/types";

export type EmbeddedImageAsset = {
  imageId: string;
  src: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml";
  byteLength: number;
};
export type EmbeddedImageCollectionOptions = { signal?: OfficePackageSignal };
export type EmbeddedImageCollection = {
  images: EmbeddedImageAsset[];
  /** One ID per input source, retaining duplicates and input order. */
  imageIds: string[];
};
export const IMAGE_ASSET_LIMITS = Object.freeze({ sources: 100_000, imageBytes: 10 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 });

function abortReason(signal: OfficePackageSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("Image collection was aborted."); error.name = "AbortError"; return error;
}
const checkAbort = (signal?: OfficePackageSignal) => { if (signal?.aborted) throw abortReason(signal); };

function readSignal(options: EmbeddedImageCollectionOptions): OfficePackageSignal | undefined {
  if (!options || typeof options !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(key => key !== "signal" || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value")))
    throw new Error("Image collection options accept only signal.");
  const { signal } = options;
  if (signal !== undefined && (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" ||
    typeof signal.throwIfAborted !== "function" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function"))
    throw new Error("Image collection signal is invalid.");
  checkAbort(signal); return signal;
}

function digestBytes(bytes: Uint8Array<ArrayBuffer>, signal?: OfficePackageSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true; signal?.removeEventListener("abort", onAbort); callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    try {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) throw new Error("Image collection requires Web Crypto (HTTPS / localhost or Node.js 22.13+).");
      // Observe late success/failure even if the native digest outlives cancellation.
      subtle.digest("SHA-256", bytes).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    } catch (error) { finish(() => reject(error)); }
  });
}

/**
 * Deduplicate original file bytes, without rendering, networking or perceptual matching.
 * Validates the bounded canonical base64 envelope; callers must separately validate
 * the actual image format/content with their document model's image validator.
 */
export async function collectEmbeddedImageAssets(input: readonly string[], options: EmbeddedImageCollectionOptions = {}): Promise<EmbeddedImageCollection> {
  const signal = readSignal(options), limits = IMAGE_ASSET_LIMITS;
  if (!Array.isArray(input) || input.length > limits.sources) throw new Error("Image source count exceeds the collection limit.");
  const sources: string[] = [], unique = new Map<string, { mimeType: EmbeddedImageAsset["mimeType"]; payload: string; byteLength: number }>();
  let totalBytes = 0;
  // Copy and validate the entire input before awaiting, including slots/accessors.
  for (let index = 0; index < input.length; index++) {
    checkAbort(signal);
    const descriptor = Object.getOwnPropertyDescriptor(input, index), src: unknown = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof src !== "string" || src.length > 40 + Math.ceil(limits.imageBytes / 3) * 4)
      throw new Error("Image sources must be bounded embedded data URLs.");
    sources.push(src);
    if (unique.has(src)) continue;
    const prefix = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,/.exec(src);
    if (!prefix) throw new Error("Image sources must be embedded PNG, JPEG, GIF, WebP or SVG data URLs.");
    const payload = src.slice(prefix[0].length);
    if (!payload.length || payload.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) throw new Error("Image base64 is invalid.");
    const byteLength = payload.length / 4 * 3 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
    totalBytes += byteLength;
    if (byteLength > limits.imageBytes || totalBytes > limits.totalBytes) throw new Error("Image bytes exceed the collection limit.");
    unique.set(src, { mimeType: prefix[1] as EmbeddedImageAsset["mimeType"], payload, byteLength });
  }
  const images: EmbeddedImageAsset[] = [], byId = new Map<string, EmbeddedImageAsset>(), bySource = new Map<string, string>();
  for (const [src, { mimeType, payload, byteLength }] of unique) {
    checkAbort(signal);
    const binary = atob(payload);
    if (btoa(binary) !== payload) throw new Error("Image base64 must use canonical encoding.");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    const digest = await digestBytes(bytes, signal);
    checkAbort(signal);
    const imageId = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    const previous = byId.get(imageId);
    if (previous && previous.src.slice(previous.src.indexOf(",") + 1) !== payload)
      throw new Error("Image hash collision: different files cannot share an image asset.");
    if (!previous) { const asset = { imageId, src, mimeType, byteLength }; byId.set(imageId, asset); images.push(asset); }
    bySource.set(src, imageId);
  }
  checkAbort(signal);
  return { images, imageIds: sources.map(src => bySource.get(src)!) };
}

import { SPREADSHEET_LIMITS, type SpreadsheetImageResource } from "../model/types";
import { imageDimensions } from "../model/image-resources";

const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("画像の読み込みを中止しました", "AbortError");
}

function imageType(bytes: Uint8Array): SpreadsheetImageResource["mimeType"] | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  const header = String.fromCharCode(...bytes.slice(0, 12));
  if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) return "image/gif";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
}

function dimensions(blob: Blob, signal?: AbortSignal): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    aborted(signal);
    const image = new Image();
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      image.onload = null; image.onerror = null;
      signal?.removeEventListener("abort", cancel);
      URL.revokeObjectURL(url);
    };
    const cancel = () => { cleanup(); image.src = ""; reject(new DOMException("画像の読み込みを中止しました", "AbortError")); };
    image.onload = () => { const result = { width: image.naturalWidth, height: image.naturalHeight }; cleanup(); resolve(result); };
    image.onerror = () => { cleanup(); reject(new Error("画像を読み込めません。画像ファイルを確認してください")); };
    signal?.addEventListener("abort", cancel, { once: true });
    try { image.src = url; } catch (cause) { cleanup(); reject(cause); }
  });
}

export type SpreadsheetImagePreparationOptions = Readonly<{
  signal?: AbortSignal;
  /** Defaults to the File's name, or "image" when reading a Blob. */
  name?: string;
}>;

/** Only the returned JSON resource is stored in a workbook; the temporary object
 * URL is revoked on success, decode failure, and cancellation. */
export async function readImageResource(file: Blob, { signal, name }: SpreadsheetImagePreparationOptions = {}): Promise<SpreadsheetImageResource> {
  aborted(signal);
  if (!file || typeof file.arrayBuffer !== "function" || !Number.isFinite(file.size)) throw new Error("画像の File または Blob を指定してください");
  const resourceName = name ?? ("name" in file && typeof file.name === "string" ? file.name : "image");
  if (typeof resourceName !== "string" || resourceName.length > 1000) throw new Error("画像の名前は1,000文字以内で指定してください");
  if (!file.size || file.size > SPREADSHEET_LIMITS.imageBytes) throw new Error("画像は空でない5 MiB以下のファイルを選んでください");
  if (file.type && !allowed.has(file.type)) throw new Error("PNG・JPEG・WebP・GIFの画像を選んでください");
  const bytes = new Uint8Array(await file.arrayBuffer());
  aborted(signal);
  if (bytes.byteLength !== file.size || bytes.byteLength > SPREADSHEET_LIMITS.imageBytes) throw new Error("画像ファイルのサイズが正しくありません");
  const mimeType = imageType(bytes);
  if (!mimeType || (file.type && file.type !== mimeType)) throw new Error("画像の形式とファイル内容が一致しません");
  // Reject oversized headers before asking the browser to allocate pixels.
  const [width, height] = imageDimensions(bytes, mimeType);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > SPREADSHEET_LIMITS.imageDimension || height > SPREADSHEET_LIMITS.imageDimension || width * height > SPREADSHEET_LIMITS.imagePixels)
    throw new Error("画像は各辺10,000ピクセル以下、合計1,600万画素以下にしてください");
  const decoded = await dimensions(new Blob([bytes], { type: mimeType }), signal);
  aborted(signal);
  // JPEG EXIF orientation may exchange the browser's natural dimensions.
  if (!(decoded.width === width && decoded.height === height) &&
    !(mimeType === "image/jpeg" && decoded.width === height && decoded.height === width))
    throw new Error("画像の寸法とファイル内容が一致しません");
  let binary = "";
  for (let index = 0; index < bytes.length; index += 32_768) binary += String.fromCharCode(...bytes.subarray(index, index + 32_768));
  return { name: resourceName, mimeType, dataUrl: `data:${mimeType};base64,${btoa(binary)}`, width, height };
}

import { imageMetadata, normalizeImageResource } from "../../model/image-resources";
import { jpegOrientation } from "../../model/image-orientation";
import { SPREADSHEET_LIMITS, type SpreadsheetImageResource } from "../../model/types";

export type XlsxImage = Readonly<{
  content: Blob;
  extension: "png" | "jpeg";
  contentType: "image/png" | "image/jpeg";
  width: number;
  height: number;
}>;

type XlsxMedia = Readonly<{ image: XlsxImage; filename: string }>;
/** One registry per export, shared by all sheets. It stores no URLs or DOM nodes. */
export type XlsxMediaRegistry = Map<string, { dataUrl: string; media: Promise<XlsxMedia> }>;

export function createXlsxMediaRegistry(): XlsxMediaRegistry { return new Map(); }

export async function prepareXlsxMedia(id: string, image: SpreadsheetImageResource, sheetIndex: number,
  registry: XlsxMediaRegistry, signal?: AbortSignal): Promise<{ media: XlsxMedia; firstUse: boolean }> {
  checkImageExportCancellation(signal);
  const existing = registry.get(id);
  if (existing && existing.dataUrl !== image.dataUrl) throw new Error("画像リソースが書き出し中に変更されました");
  const firstUse = !existing;
  let entry = existing;
  if (!entry) {
    const number = registry.size + 1;
    entry = { dataUrl: image.dataUrl, media: prepareXlsxImage(image, signal).then(prepared => ({
      image: prepared, filename: `image${sheetIndex}_${number}.${prepared.extension}`,
    })) };
    registry.set(id, entry);
  }
  const media = await entry.media;
  checkImageExportCancellation(signal);
  return { media, firstUse };
}

export function checkImageExportCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("画像の書き出しをキャンセルしました", "AbortError");
}

function checkedSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    width > SPREADSHEET_LIMITS.imageDimension || height > SPREADSHEET_LIMITS.imageDimension ||
    width * height > SPREADSHEET_LIMITS.imagePixels)
    throw new Error("画像は各辺10,000ピクセル以下、合計1,600万画素以下にしてください");
}

/** Preserve browser-rendered EXIF orientation, alpha and the first animation frame. */
function rasterizePng(source: Blob, width: number, height: number, signal?: AbortSignal): Promise<Blob> {
  checkImageExportCancellation(signal);
  if (typeof document === "undefined" || typeof Image === "undefined" || typeof URL.createObjectURL !== "function")
    throw new Error("WebP・GIF・回転情報付きJPEGのExcel書き出しには、Canvasを利用できるブラウザーが必要です");
  checkedSize(width, height);
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.toBlob !== "function") {
      reject(new Error("画像を変換するCanvasを利用できません"));
      return;
    }
    const image = new Image();
    const url = URL.createObjectURL(source);
    let settled = false;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", cancel);
      URL.revokeObjectURL(url);
      // Release decoded pixels after toBlob has taken its snapshot, on every exit.
      image.src = "";
      canvas.width = 0;
      canvas.height = 0;
    };
    const finish = (blob?: Blob, error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (blob) resolve(blob);
      else reject(new Error("画像をPNGへ変換できませんでした"));
    };
    const cancel = () => finish(undefined, new DOMException("画像の書き出しをキャンセルしました", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    image.onload = () => {
      try {
        checkImageExportCancellation(signal);
        // HTMLImageElement applies EXIF when decoding. Reject browsers that report
        // encoded dimensions for a rotated image instead of stretching its pixels.
        if (image.naturalWidth !== width || image.naturalHeight !== height)
          throw new Error("画像の表示寸法が一致しないため、Excelへ書き出せません");
        canvas.width = width;
        canvas.height = height;
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob(blob => {
          if (signal?.aborted) { cancel(); return; }
          if (!blob || blob.type !== "image/png") { finish(undefined, new Error("画像をPNGへ変換できませんでした")); return; }
          if (!blob.size || blob.size > SPREADSHEET_LIMITS.imageBytes) {
            finish(undefined, new Error("変換後の画像が5 MiBを超えています。画像を小さくして再実行してください"));
            return;
          }
          finish(blob);
        }, "image/png");
      } catch (error) { finish(undefined, error); }
    };
    image.onerror = () => finish(undefined, new Error("画像を読み込めないため、Excelへ書き出せません"));
    try { image.src = url; } catch (error) { finish(undefined, error); }
  });
}

/** Validated inline data only; no fetch, remote URL or host storage dependency. */
export async function prepareXlsxImage(input: SpreadsheetImageResource, signal?: AbortSignal): Promise<XlsxImage> {
  checkImageExportCancellation(signal);
  const image = normalizeImageResource(input);
  const payload = image.dataUrl.slice(image.dataUrl.indexOf(",") + 1);
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const { displayWidth: width, displayHeight: height } = imageMetadata(bytes, image.mimeType);
  checkedSize(width, height);
  checkImageExportCancellation(signal);
  const source = new Blob([bytes], { type: image.mimeType });
  if (image.mimeType === "image/png" || (image.mimeType === "image/jpeg" && jpegOrientation(bytes) === 1))
    return { content: source, extension: image.mimeType === "image/png" ? "png" : "jpeg", contentType: image.mimeType, width, height };
  const content = await rasterizePng(source, width, height, signal);
  checkImageExportCancellation(signal);
  return { content, extension: "png", contentType: "image/png", width, height };
}

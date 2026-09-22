import type { OfficePackageBlob } from "../ooxml";
import { imageMetadata } from "../model/image-resources";
import { SPREADSHEET_LIMITS } from "../model/types";
import type { SpreadsheetImageRasterizeRequest, SpreadsheetImageRasterizer } from "./portable-types";

/** Cancel our wait even if a host converter does not cooperate. Its late result is ignored. */
async function waitForConversion<T>(work: () => T | Promise<T>, signal: SpreadsheetImageRasterizeRequest["signal"]): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return work();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("画像の書き出しをキャンセルしました", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Validate host-provided PNG bytes instead of trusting MIME, dimensions or size declarations. */
export async function rasterizeXlsxImage(convert: SpreadsheetImageRasterizer, request: SpreadsheetImageRasterizeRequest): Promise<Blob> {
  const converted: OfficePackageBlob = await waitForConversion(() => convert(Object.freeze(request)), request.signal);
  request.signal?.throwIfAborted();
  if (!converted || converted.type !== "image/png" || typeof converted.arrayBuffer !== "function" ||
    !Number.isSafeInteger(converted.size) || converted.size < 1 || converted.size > SPREADSHEET_LIMITS.imageBytes)
    throw new Error("変換結果は5 MiB以下のPNGにしてください");
  const bytes = new Uint8Array(await waitForConversion(() => converted.arrayBuffer(), request.signal));
  request.signal?.throwIfAborted();
  if (bytes.byteLength !== converted.size || bytes.byteLength > SPREADSHEET_LIMITS.imageBytes)
    throw new Error("変換後の画像サイズが正しくありません");
  const metadata = imageMetadata(bytes, "image/png");
  if (metadata.width !== request.width || metadata.height !== request.height)
    throw new Error("変換後の画像寸法が表示寸法と一致しません");
  return new Blob([bytes], { type: "image/png" });
}

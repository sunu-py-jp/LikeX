import { validateSlideImageSource } from "../model/image-source";
import { inspectSlideSvg } from "../model/svg-source";
import type { SlideImageElement } from "../model/types";
import { SLIDE_LIMITS } from "../model/limits";
import type { SlidePptxExportOptions } from "./types";

/** Run each source once; validate the real PNG returned by the host before writing Office media. */
export async function createSvgFallbacks(elements: readonly SlideImageElement[], options: SlidePptxExportOptions): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>(); let totalBytes = 0;
  for (const element of elements) {
    if (!element.src.startsWith("data:image/svg+xml;base64,") || result.has(element.src)) continue;
    options.signal?.throwIfAborted();
    if (!options.rasterizeSvg) throw new Error("SVGを含むPowerPointの出力には rasterizeSvg を指定してください。ブラウザー用の @likex/slide はPNG代替画像を自動生成します");
    const binary = atob(element.src.slice(element.src.indexOf(",") + 1));
    const { width, height } = inspectSlideSvg(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
    const request = { src: element.src, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)), signal: options.signal };
    if (request.width * request.height > SLIDE_LIMITS.imagePixels) throw new Error("SVGのPNG代替画像の画素数が上限を超えています");
    const signal = options.signal;
    let abort: (() => void) | undefined;
    try {
      const interrupted = new Promise<never>((_resolve, reject) => {
        if (signal) { abort = () => reject(signal.reason ?? new Error("SVGのPNG変換をキャンセルしました")); signal.addEventListener("abort", abort, { once: true }); }
      });
      signal?.throwIfAborted();
      const blob = await Promise.race([options.rasterizeSvg(Object.freeze(request)), interrupted]);
      signal?.throwIfAborted();
      if (!blob || blob.type !== "image/png" || !Number.isSafeInteger(blob.size) || blob.size < 33 || blob.size > SLIDE_LIMITS.imageBytes) throw new Error("rasterizeSvg は10 MiB以下のPNGを返してください");
      const bytes = new Uint8Array(await Promise.race([blob.arrayBuffer(), interrupted])); signal?.throwIfAborted();
      if (bytes.length !== blob.size) throw new Error("rasterizeSvg のPNGサイズが一致しません");
      const chunks: string[] = []; for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
      validateSlideImageSource(`data:image/png;base64,${btoa(chunks.join(""))}`);
      const dimensions = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (dimensions.getUint32(16) !== request.width || dimensions.getUint32(20) !== request.height) throw new Error("rasterizeSvg のPNG寸法は指定された width / height と一致させてください");
      totalBytes += bytes.length;
      if (totalBytes > SLIDE_LIMITS.totalImageBytes) throw new Error("SVGのPNG代替画像の合計サイズが上限を超えています");
      result.set(element.src, bytes);
    } finally { if (abort) signal?.removeEventListener("abort", abort); }
  }
  return result;
}

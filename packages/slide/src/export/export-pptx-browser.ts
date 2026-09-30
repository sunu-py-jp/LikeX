import type { SlideDeck } from "../model/types";
import { validateSlideImageSource } from "../model/image-source";
import { exportSlidePptx as exportPptx } from "./export-pptx";
import type { SlidePptxExportOptions, SlideSvgRasterizer } from "./types";

const rasterizeSvg: SlideSvgRasterizer = request => {
  validateSlideImageSource(request.src);
  request.signal?.throwIfAborted();
  if (typeof document === "undefined") throw new Error("SVGのPNG代替画像の生成にはブラウザーのCanvas、または rasterizeSvg の指定が必要です");
  const canvas = document.createElement("canvas"), image = document.createElement("img"), context = canvas.getContext("2d");
  if (!context || typeof canvas.toBlob !== "function") throw new Error("SVGを描画するCanvasを利用できません");
  return new Promise<Blob>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, blob?: Blob) => {
      if (finished) return;
      finished = true; clearTimeout(timer); request.signal?.removeEventListener("abort", abort);
      image.onload = null; image.onerror = null; image.src = ""; canvas.width = 0; canvas.height = 0;
      if (error) reject(error); else resolve(blob!);
    };
    const abort = () => finish(request.signal?.reason ?? new Error("SVGのPNG変換をキャンセルしました"));
    const timer = setTimeout(() => finish(new Error("SVGのPNG変換が30秒以内に完了しませんでした")), 30_000);
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) { abort(); return; }
    image.onload = () => {
      try {
        request.signal?.throwIfAborted(); canvas.width = request.width; canvas.height = request.height;
        context.clearRect(0, 0, request.width, request.height); context.drawImage(image, 0, 0, request.width, request.height);
        canvas.toBlob(blob => { if (!blob?.size || blob.type !== "image/png") finish(new Error("SVGをPNGへ変換できません")); else finish(undefined, blob); }, "image/png");
      } catch (error) { finish(error); }
    };
    image.onerror = () => finish(new Error("SVGを描画できません")); image.src = request.src;
  });
};

/** Browser export supplies a real Canvas fallback while retaining the original SVG in the PPTX. */
export function exportSlidePptx(deck: SlideDeck, options: SlidePptxExportOptions = {}): Promise<Blob> {
  return exportPptx(deck, { ...options, rasterizeSvg: options.rasterizeSvg ?? rasterizeSvg });
}

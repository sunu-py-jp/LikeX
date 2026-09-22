import type { SlideElement, SlideShapeElement, SlideTextElement } from "../model/types";
import { validateSlideImageSource } from "../model/image-source";
import { getSlideShapeGeometry, SHAPE_TEXT_STYLE, SLIDE_TEXT_STYLE, wrapSlideText } from "./render-style";
import type { SlideImageRenderRequest } from "./types";

type DecodedImage = { source: CanvasImageSource; width: number; height: number; close(): void };
type ImageFrame = CanvasImageSource & { displayWidth: number; displayHeight: number; close(): void };
type Decoder = { decode(options: { frameIndex: number }): Promise<{ image: ImageFrame }>; close(): void };
type DecoderConstructor = { new(options: { data: Uint8Array; type: string; preferAnimation: boolean }): Decoder };
const TIMEOUT_MS = 30_000;
const cancelled = () => new DOMException("スライド画像の書き出しをキャンセルしました", "AbortError");
const font = (element: SlideTextElement | SlideShapeElement) => element.type === "text"
  ? `${element.italic ? "italic" : "normal"} ${element.bold ? 700 : 400} ${element.fontSize}px ${element.fontFamily}`
  : `normal 400 ${element.fontSize}px ${SHAPE_TEXT_STYLE.fontFamily}`;

/** A browser-only renderer: no React mounting, remote image fetching, or editor state. */
export async function renderSlideImage(request: SlideImageRenderRequest): Promise<Blob> {
  const { deck, slide, width, height, signal } = request;
  signal?.throwIfAborted();
  if (typeof document === "undefined") throw new Error("PNGの描画にはブラウザーのCanvas、または画像レンダラーの指定が必要です");
  const canvas = document.createElement("canvas");
  let context: CanvasRenderingContext2D | null;
  try { context = canvas.getContext("2d"); } catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
  if (!context || typeof canvas.toBlob !== "function") { canvas.width = 0; canvas.height = 0; throw new Error("スライド画像を描画するCanvasを利用できません"); }
  const dispose = new Set<() => void>();
  let finished = false, rejectPending: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
  const abort = () => { if (!finished) rejectPending(signal?.reason ?? cancelled()); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => rejectPending(new Error("スライド画像の書き出しが30秒以内に完了しませんでした")), TIMEOUT_MS);
  const check = () => { if (finished) throw cancelled(); signal?.throwIfAborted(); };
  async function loadImage(src: string): Promise<DecodedImage> {
    validateSlideImageSource(src);
    const comma = src.indexOf(","), type = src.slice(5, src.indexOf(";")), binary = atob(src.slice(comma + 1));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    // Animated sources need an explicit frame index. A live <img> can advance while fonts load.
    const animated = type === "image/gif" || type === "image/webp" && hasChunk(bytes, "ANIM", true) || type === "image/png" && hasChunk(bytes, "acTL", false);
    if (animated) {
      const ImageDecoder = (globalThis as typeof globalThis & { ImageDecoder?: DecoderConstructor }).ImageDecoder;
      if (!ImageDecoder) throw new Error("アニメーション画像の先頭フレームを描画するImageDecoderを利用できません");
      const decoder = new ImageDecoder({ data: bytes, type, preferAnimation: true });
      let closed = false;
      const close = () => { if (!closed) { closed = true; decoder.close(); } };
      dispose.add(close);
      const { image } = await decoder.decode({ frameIndex: 0 });
      if (finished || signal?.aborted) { image.close(); check(); }
      close(); dispose.delete(close);
      if (!(image.displayWidth > 0 && image.displayHeight > 0)) { image.close(); throw new Error("画像の表示寸法を取得できません"); }
      const result = { source: image, width: image.displayWidth, height: image.displayHeight, close: () => image.close() };
      dispose.add(result.close); return result;
    }
    return new Promise<DecodedImage>((resolve, reject) => {
      const image = document.createElement("img");
      let closed = false;
      const close = () => { if (!closed) { closed = true; image.onload = null; image.onerror = null; image.src = ""; } };
      dispose.add(close);
      image.onload = () => {
        if (finished || signal?.aborted) { close(); return; }
        if (!(image.naturalWidth > 0 && image.naturalHeight > 0)) { reject(new Error("画像の表示寸法を取得できません")); return; }
        resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, close });
      };
      image.onerror = () => reject(new Error("埋め込み画像を描画できません"));
      image.src = src;
    });
  }
  const operation = async () => {
    const fonts = document.fonts;
    if (fonts) {
      const descriptors = new Map<string, string>();
      for (const element of slide.elements) if (element.type !== "image" && element.text) descriptors.set(font(element), (descriptors.get(font(element)) ?? "") + element.text);
      await Promise.all([...descriptors].map(([descriptor, text]) => fonts.load(descriptor, text)));
      await fonts.ready; check();
    }
    canvas.width = width; canvas.height = height;
    context.scale(width / deck.width, height / deck.height);
    context.clearRect(0, 0, deck.width, deck.height);
    if (slide.background !== "transparent") { context.fillStyle = slide.background; context.fillRect(0, 0, deck.width, deck.height); }
    let layer: HTMLCanvasElement | undefined, layerContext: CanvasRenderingContext2D | null = null;
    const paint = (target: CanvasRenderingContext2D, element: SlideElement, image?: DecodedImage) => {
      target.save();
      try {
        target.translate(element.x + element.width / 2, element.y + element.height / 2);
        target.rotate(element.rotation * Math.PI / 180);
        target.translate(-element.width / 2, -element.height / 2);
        if (element.type === "image") {
          const scale = Math.min(element.width / image!.width, element.height / image!.height), w = image!.width * scale, h = image!.height * scale;
          target.drawImage(image!.source, (element.width - w) / 2, (element.height - h) / 2, w, h);
        } else if (element.type === "shape") { drawShape(target, element); if (element.text) drawText(target, element); }
        else drawText(target, element);
      } finally { target.restore(); }
    };
    for (const element of slide.elements) {
      check(); if (!element.opacity) continue;
      // Keep only one decoded source alive; compressed JSON limits alone do not bound decoded memory.
      const image = element.type === "image" ? await loadImage(element.src) : undefined;
      check(); context.save();
      try {
        context.globalAlpha = element.opacity;
        // CSS opacity composites the whole element, not each overlapping fill/stroke/glyph.
        if (element.opacity < 1 && element.type !== "image") {
          if (!layer) {
            layer = document.createElement("canvas"); layer.width = width; layer.height = height; layerContext = layer.getContext("2d");
            dispose.add(() => { layer!.width = 0; layer!.height = 0; });
            if (!layerContext) throw new Error("不透明度を合成するCanvasを利用できません");
          }
          layerContext!.clearRect(0, 0, width, height); layerContext!.save();
          try { layerContext!.scale(width / deck.width, height / deck.height); paint(layerContext!, element); }
          finally { layerContext!.restore(); }
          context.drawImage(layer, 0, 0, deck.width, deck.height);
        } else paint(context, element, image);
      } finally { context.restore(); if (image) { image.close(); dispose.delete(image.close); } }
    }
    check();
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
      if (finished || signal?.aborted) { reject(signal?.reason ?? cancelled()); return; }
      if (!blob?.size || blob.type !== "image/png") reject(new Error("スライド画像をPNGへ変換できません"));
      else resolve(blob);
    }, "image/png"));
  };
  try { return await Promise.race([operation(), interrupted]); }
  finally {
    finished = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
    for (const close of dispose) { try { close(); } catch { /* Release all remaining resources. */ } }
    dispose.clear(); canvas.width = 0; canvas.height = 0;
  }
}

function hasChunk(bytes: Uint8Array, name: string, webp: boolean): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = webp ? 12 : 8; offset + 8 <= bytes.length;) {
    const length = view.getUint32(webp ? offset + 4 : offset, webp);
    const kind = webp ? offset : offset + 4;
    if (String.fromCharCode(...bytes.subarray(kind, kind + 4)) === name) return true;
    const next = offset + length + (webp ? 8 + length % 2 : 12);
    if (next <= offset || next > bytes.length) break;
    offset = next;
  }
  return false;
}
function drawShape(context: CanvasRenderingContext2D, element: SlideShapeElement) {
  const shape = getSlideShapeGeometry(element);
  context.save(); context.beginPath(); context.rect(0, 0, element.width, element.height); context.clip(); context.beginPath();
  if (shape.kind === "ellipse") context.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
  else if (shape.kind === "line") { context.moveTo(shape.x1, shape.y1); context.lineTo(shape.x2, shape.y2); }
  else if (shape.kind === "polygon") { shape.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath(); }
  else {
    const { x, y, width, height } = shape, r = Math.min(shape.radius, width / 2, height / 2);
    if (!r) context.rect(x, y, width, height);
    else {
      context.moveTo(x + r, y); context.lineTo(x + width - r, y); context.arcTo(x + width, y, x + width, y + r, r);
      context.lineTo(x + width, y + height - r); context.arcTo(x + width, y + height, x + width - r, y + height, r);
      context.lineTo(x + r, y + height); context.arcTo(x, y + height, x, y + height - r, r);
      context.lineTo(x, y + r); context.arcTo(x, y, x + r, y, r); context.closePath();
    }
  }
  if (shape.kind !== "line" && element.fill !== "transparent") { context.fillStyle = element.fill; context.fill(); }
  if (element.strokeWidth > 0 && element.stroke !== "transparent") { context.strokeStyle = element.stroke; context.lineWidth = element.strokeWidth; context.lineJoin = "round"; context.stroke(); }
  context.restore();
}
function drawText(context: CanvasRenderingContext2D, element: Exclude<SlideElement, { type: "image" }>) {
  const style = element.type === "text" ? SLIDE_TEXT_STYLE : SHAPE_TEXT_STYLE;
  context.save(); context.beginPath(); context.rect(0, 0, element.width, element.height); context.clip();
  if (element.type === "text" && element.fill !== "transparent") { context.fillStyle = element.fill; context.fillRect(0, 0, element.width, element.height); }
  context.font = font(element); context.fillStyle = element.type === "text" ? element.color : element.textColor;
  const lines = wrapSlideText(element.text, element.width - style.paddingX * 2, text => context.measureText(text).width);
  const lineHeight = element.fontSize * style.lineHeight, contentHeight = element.height - style.paddingY * 2;
  const vertical = element.type === "text" ? element.verticalAlign : "middle", align = element.type === "text" ? element.align : "center";
  const extra = contentHeight - lines.length * lineHeight, top = style.paddingY + (vertical === "middle" ? extra / 2 : vertical === "bottom" ? extra : 0);
  const metrics = context.measureText("Mgあ"), ascent = metrics.fontBoundingBoxAscent ?? element.fontSize * .8, descent = metrics.fontBoundingBoxDescent ?? element.fontSize * .2;
  context.textAlign = align; context.textBaseline = "alphabetic";
  const x = align === "center" ? element.width / 2 : align === "right" ? element.width - style.paddingX : style.paddingX;
  lines.forEach((line, index) => context.fillText(line, x, top + index * lineHeight + (lineHeight - ascent - descent) / 2 + ascent));
  context.restore();
}

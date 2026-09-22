import type { SlideDeck } from "../model/types";
import { normalizeSlideDeck } from "../model/normalize";
import { resolveSlideAnimations } from "../model/index";
import { identifier, list, number, record } from "../model/validation";
import type { OfficePackageBlob, OfficePackageSignal } from "../ooxml";
import { SLIDE_IMAGE_EXPORT_LIMITS, type SlideImageOptions, type SlideImageRenderer,
  type SlideImageResult, type SlideImagesOptions } from "./types";
import { awaitSlideImageTask, throwIfSlideImageAborted as checkAbort } from "./async";

const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];

function snapshotDeck(input: SlideDeck): SlideDeck {
  const deck = normalizeSlideDeck(input);
  // Normalization freezes every level. Clone even an already-normalized deck so
  // neither caller references nor renderer requests can affect later pages.
  return normalizeSlideDeck({ ...deck, slides: deck.slides.map(slide => ({ ...slide,
    elements: slide.elements.map(element => ({ ...element })),
  })) });
}

function pageNumber(value: unknown, count: number): number {
  return number(value, "ページ番号", 1, count, true);
}

function selectPages(deck: SlideDeck, raw: Record<string, unknown>, single: boolean): number[] {
  const selectors = (single ? ["pageNumber", "slideId"] : ["range", "pageNumbers", "slideIds"])
    .filter(key => raw[key] !== undefined);
  if (selectors.length > 1 || (single && selectors.length !== 1))
    throw new Error("画像出力の対象は1種類だけ指定してください");
  const byId = new Map(deck.slides.map((slide, index) => [slide.id, index + 1]));
  const fromId = (value: unknown) => {
    const id = identifier(value), page = byId.get(id);
    if (page === undefined) throw new Error(`スライドが見つかりません: ${id}`);
    return page;
  };
  let pages: number[];
  if (single) pages = raw.pageNumber !== undefined ? [pageNumber(raw.pageNumber, deck.slides.length)] : [fromId(raw.slideId)];
  else if (raw.range !== undefined) {
    const range = record(raw.range, "ページ範囲", ["from", "to"]);
    const from = pageNumber(range.from, deck.slides.length), to = pageNumber(range.to, deck.slides.length);
    if (from > to) throw new Error("ページ範囲の開始は終了以下にしてください");
    pages = Array.from({ length: to - from + 1 }, (_, index) => from + index);
  } else if (raw.pageNumbers !== undefined) {
    pages = list(raw.pageNumbers, "ページ番号", deck.slides.length, 1).map(value => pageNumber(value, deck.slides.length));
  } else if (raw.slideIds !== undefined) {
    pages = list(raw.slideIds, "スライドID", deck.slides.length, 1).map(fromId);
  } else pages = deck.slides.map((_, index) => index + 1);
  if (new Set(pages).size !== pages.length) throw new Error("画像出力の対象が重複しています");
  return pages;
}

function prepare<TBlob extends OfficePackageBlob>(input: SlideDeck,
  options: (SlideImageOptions | SlideImagesOptions) & { renderer: SlideImageRenderer<TBlob> }, single: boolean) {
  const raw = record(options, "画像出力オプション", ["scale", "format", "signal", "renderer", "animationState",
    ...(single ? ["pageNumber", "slideId"] : ["range", "pageNumbers", "slideIds"])]);
  if (typeof raw.renderer !== "function") throw new Error("画像描画rendererを指定してください");
  if (raw.format !== undefined && raw.format !== "png") throw new Error("画像出力形式はpngを指定してください");
  if (raw.animationState !== undefined && raw.animationState !== "initial" && raw.animationState !== "final")
    throw new Error("画像のアニメーション状態はinitialまたはfinalを指定してください");
  const signal = raw.signal as OfficePackageSignal | undefined;
  if (signal !== undefined && (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" ||
    typeof signal.throwIfAborted !== "function" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function"))
    throw new Error("画像出力のsignalが正しくありません");
  checkAbort(signal);
  const scale = number(raw.scale === undefined ? 1 : raw.scale, "画像倍率", Number.MIN_VALUE, Number.MAX_VALUE);
  const source = snapshotDeck(input), pages = selectPages(source, raw, single);
  const deck = normalizeSlideDeck({ ...source, slides: source.slides.map(slide => {
    if (raw.animationState !== "initial") return resolveSlideAnimations(slide);
    const initial = { ...slide };
    delete initial.animations;
    return initial;
  }) });
  const width = Math.round(deck.width * scale), height = Math.round(deck.height * scale);
  const limits = SLIDE_IMAGE_EXPORT_LIMITS;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    width > limits.dimension || height > limits.dimension || width * height > limits.pixels)
    throw new Error("画像の幅・高さまたは画素数が出力上限を超えています");
  if (width * height * pages.length > limits.totalPixels) throw new Error("画像全体の画素数が出力上限を超えています");
  return { deck, pages, width, height, scale, signal, renderer: raw.renderer as SlideImageRenderer<TBlob> };
}

async function validatePng(blob: OfficePackageBlob, width: number, height: number, remainingBytes: number,
  signal?: OfficePackageSignal): Promise<number> {
  if (!blob || typeof blob !== "object" || blob.type !== "image/png" ||
    typeof blob.arrayBuffer !== "function" || typeof blob.text !== "function" ||
    !Number.isSafeInteger(blob.size) || blob.size < 33 || blob.size > remainingBytes)
    throw new Error("rendererは出力サイズ上限内のPNG Blobを返してください");
  const size = blob.size;
  const buffer = await awaitSlideImageTask(() => blob.arrayBuffer(), signal);
  checkAbort(signal);
  // Use the intrinsic getter so cross-realm ArrayBuffers work without accepting
  // array-like objects or a forged byteLength / toStringTag property.
  let byteLength: number;
  try { byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!.call(buffer) as number; }
  catch { throw new Error("PNG Blobの読み込み結果がArrayBufferではありません"); }
  if (byteLength !== size || byteLength > remainingBytes) throw new Error("PNG Blobのサイズが一致しないか出力上限を超えています");
  const bytes = new Uint8Array(buffer);
  if (!PNG_HEADER.every((value, index) => bytes[index] === value)) throw new Error("PNGの署名またはIHDRが正しくありません");
  const header = new DataView(buffer);
  if (header.getUint32(16) !== width || header.getUint32(20) !== height)
    throw new Error("PNGのIHDR寸法が要求した出力サイズと一致しません");
  return size;
}

async function render<TBlob extends OfficePackageBlob>(prepared: ReturnType<typeof prepare<TBlob>>): Promise<SlideImageResult<TBlob>[]> {
  const { deck, pages, width, height, scale, signal, renderer } = prepared;
  const results: SlideImageResult<TBlob>[] = [];
  let totalBytes = 0;
  for (const pageNumber of pages) {
    checkAbort(signal);
    const slide = deck.slides[pageNumber - 1];
    const request = Object.freeze({ deck, slide, pageNumber, width, height, scale, format: "png" as const, signal });
    const blob = await awaitSlideImageTask(() => renderer(request), signal);
    checkAbort(signal);
    totalBytes += await validatePng(blob, width, height, SLIDE_IMAGE_EXPORT_LIMITS.totalBytes - totalBytes, signal);
    checkAbort(signal);
    results.push({ blob, width, height, mimeType: "image/png", pageNumber, slideId: slide.id });
  }
  return results;
}

/** Render a single PNG using an injected renderer; no DOM or global Blob is required. */
export async function exportImage<TBlob extends OfficePackageBlob = OfficePackageBlob>(deck: SlideDeck,
  options: SlideImageOptions & { renderer: SlideImageRenderer<TBlob> }): Promise<SlideImageResult<TBlob>> {
  return (await render(prepare(deck, options, true)))[0];
}

/** Validate the whole selection, then render sequentially. Failure never returns a partial array. */
export async function exportImages<TBlob extends OfficePackageBlob = OfficePackageBlob>(deck: SlideDeck,
  options: SlideImagesOptions & { renderer: SlideImageRenderer<TBlob> }): Promise<SlideImageResult<TBlob>[]> {
  return render(prepare(deck, options, false));
}

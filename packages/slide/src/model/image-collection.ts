import type { OfficePackageSignal } from "../ooxml";
import type { SlideDeck, SlideImageElement } from "./types";
import { getDeck } from "./query";
import { resolveSlideAppearance } from "./layouts";
import { record } from "./validation";
import { collectEmbeddedImageAssets, type EmbeddedImageAsset } from "./core-image-assets";

/** One original embedded image, identified by SHA-256 of its encoded file bytes. */
export type SlideImageAsset = EmbeddedImageAsset;

/** A use of an image on a page; inherited decorations have their definition's owner. */
export type SlideImagePlacement = Pick<SlideImageElement, "x" | "y" | "width" | "height" | "rotation" | "opacity" | "name" | "alt"> & {
  imageId: string;
  slideId: string;
  /** One-based position in the input deck. */
  pageNumber: number;
  elementId: string;
  source: "slide" | "master" | "layout";
  sourceId: string;
};

export type SlideImageCollectionOptions = {
  /** Placement geometry after all animations (default), or the authored values. */
  animationState?: "initial" | "final";
  signal?: OfficePackageSignal;
};

export type SlideImageCollection = {
  /** First occurrence order. Equal file bytes share an imageId, regardless of placement. */
  images: SlideImageAsset[];
  /** Page order, then back-to-front: master, layout, local elements. */
  placements: SlideImagePlacement[];
};

function optionsFor(options: SlideImageCollectionOptions) {
  const raw = record(options, "画像収集オプション", ["animationState", "signal"]);
  if (raw.animationState !== undefined && raw.animationState !== "initial" && raw.animationState !== "final")
    throw new Error("画像のアニメーション状態はinitialまたはfinalを指定してください");
  const signal = raw.signal as OfficePackageSignal | undefined;
  if (signal !== undefined && (!signal || typeof signal !== "object" || typeof signal.aborted !== "boolean" ||
    typeof signal.throwIfAborted !== "function" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function"))
    throw new Error("画像収集のsignalが正しくありません");
  signal?.throwIfAborted();
  return { initial: raw.animationState === "initial", signal };
}

/**
 * Collect original images once with references for every page placement.
 * Requires Web Crypto for nonempty image collections; never decodes pixels,
 * renders slides, sends requests, or mutates the deck/native file format.
 */
export async function collectSlideImages(input: SlideDeck, options: SlideImageCollectionOptions = {}): Promise<SlideImageCollection> {
  const { initial, signal } = optionsFor(options);
  // getDeck validates and freezes a snapshot synchronously, before any digest awaits.
  const deck = getDeck(input, { includeAnimations: initial });
  const owners = new Map<string, Pick<SlideImagePlacement, "source" | "sourceId">>();
  for (const master of deck.masters ?? []) for (const element of master.elements)
    owners.set(element.id, { source: "master", sourceId: master.id });
  for (const layout of deck.layouts ?? []) for (const element of layout.elements)
    owners.set(element.id, { source: "layout", sourceId: layout.id });

  const sources: string[] = [], placements: Omit<SlideImagePlacement, "imageId">[] = [];
  for (const [index, slide] of deck.slides.entries()) {
    signal?.throwIfAborted();
    const appearance = resolveSlideAppearance(deck, slide);
    for (const element of [...appearance.inheritedElements, ...appearance.localElements]) {
      signal?.throwIfAborted();
      if (element.type !== "image") continue;
      sources.push(element.src);
      placements.push({ slideId: slide.id, pageNumber: index + 1, elementId: element.id,
        ...(owners.get(element.id) ?? { source: "slide", sourceId: slide.id }),
        x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation,
        opacity: element.opacity, name: element.name, alt: element.alt });
    }
  }
  signal?.throwIfAborted();
  const collected = await collectEmbeddedImageAssets(sources, { signal });
  signal?.throwIfAborted();
  return { images: collected.images, placements: placements.map((placement, index) => ({ ...placement, imageId: collected.imageIds[index] })) };
}

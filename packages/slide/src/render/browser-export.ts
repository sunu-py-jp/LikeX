import type { SlideDeck } from "../model/types";
import { exportImage as renderImage, exportImages as renderImages } from "./export-images";
import { renderSlideImage } from "./canvas-renderer";
import type { SlideImageOptions, SlideImagesOptions, SlideImageRenderer, SlideImageResult } from "./types";

/** PNG output without mounting LikeSlide. A browser Canvas is used by default. */
export type SlideImageExportOptions = SlideImageOptions & { renderer?: SlideImageRenderer<Blob> };
export type SlideImagesExportOptions = SlideImagesOptions & { renderer?: SlideImageRenderer<Blob> };

export function exportImage(deck: SlideDeck, options: SlideImageExportOptions): Promise<SlideImageResult<Blob>> {
  return renderImage(deck, { ...options, renderer: options?.renderer ?? renderSlideImage });
}

export function exportImages(deck: SlideDeck, options: SlideImagesExportOptions = {}): Promise<SlideImageResult<Blob>[]> {
  return renderImages(deck, { ...options, renderer: options?.renderer ?? renderSlideImage });
}

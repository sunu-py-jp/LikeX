import type { OfficePackageBlob, OfficePackageSignal } from "../ooxml";
import type { Slide, SlideDeck } from "../model/types";

/** Fixed PNG export budgets, checked for the whole selection before rendering. */
export const SLIDE_IMAGE_EXPORT_LIMITS = Object.freeze({
  dimension: 16_384,
  pixels: 40_000_000,
  totalPixels: 160_000_000,
  totalBytes: 100 * 1024 * 1024,
});

export type SlideImageCommonOptions = {
  /** Positive finite scale; output dimensions use Math.round. Defaults to 1. */
  scale?: number;
  format?: "png";
  /** Final static state by default; initial uses the stored properties before playback. */
  animationState?: "initial" | "final";
  signal?: OfficePackageSignal;
};

/** Exactly one target; page numbers start at 1. */
export type SlideImageOptions = SlideImageCommonOptions & (
  | { pageNumber: number; slideId?: never }
  | { slideId: string; pageNumber?: never }
);

/** An inclusive range or ordered unique list. Omit all selectors for every page. */
export type SlideImagesOptions = SlideImageCommonOptions & (
  | { range: { from: number; to: number }; pageNumbers?: never; slideIds?: never }
  | { pageNumbers: readonly number[]; range?: never; slideIds?: never }
  | { slideIds: readonly string[]; range?: never; pageNumbers?: never }
  | { range?: never; pageNumbers?: never; slideIds?: never }
);

/** The deck and slide are deeply frozen snapshots; dimensions are output pixels. */
export type SlideImageRenderRequest = Readonly<{
  deck: SlideDeck;
  slide: Slide;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
  format: "png";
  signal?: OfficePackageSignal;
}>;

export type SlideImageRenderer<TBlob extends OfficePackageBlob = OfficePackageBlob> =
  (request: SlideImageRenderRequest) => TBlob | Promise<TBlob>;

export type SlideImageResult<TBlob extends OfficePackageBlob = OfficePackageBlob> = {
  blob: TBlob;
  width: number;
  height: number;
  mimeType: "image/png";
  pageNumber: number;
  slideId: string;
};

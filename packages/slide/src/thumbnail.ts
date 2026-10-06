"use client";

/** Preview-only entry. Does not mount editing sessions, filmstrips or command UIs. */
export { LikeSlideThumbnail } from "./ui/slide-thumbnail";
export type { SlideThumbnailProps } from "./ui/slide-thumbnail";
export type { SlidePageTarget } from "./state/slide-page-target";
export { LikeSlidePdfThumbnail } from "./pdf/pdf-thumbnail";
export type { SlidePdfThumbnailProps } from "./pdf/pdf-thumbnail";
export { createSlidePdfLoader, SLIDE_PDF_LIMITS } from "./pdf/pdfjs-loader";
export type { SlidePdfLoader, SlidePdfDocument, SlidePdfPage, SlidePdfInput, SlidePdfJsModule, SlidePdfLoaderOptions, SlidePdfRenderOptions } from "./pdf/types";

/** Model, commands and Office conversion for Node.js, workers and applications without React. */
export * from "./model";
export { createSlideSession } from "./session/create-slide-session";
export type { SlideSession, SlideSessionSnapshot } from "./session/create-slide-session";
export { importSlidePptx } from "./import/import-pptx";
export type { SlidePptxImportOptions, SlidePptxImportResult } from "./import/import-pptx";
export { exportSlidePptx } from "./export/export-pptx-headless";
export type { SlidePptxExportOptions } from "./export/types";
export type { OfficePackageBlob as SlidePptxExportBlob } from "./ooxml";
/** Image output on a server/worker requires an explicitly supplied renderer. */
export { exportImage, exportImages } from "./render/export-images";
export { SLIDE_IMAGE_EXPORT_LIMITS } from "./render/types";
export type { SlideImageCommonOptions, SlideImageOptions, SlideImagesOptions, SlideImageResult, SlideImageRenderRequest, SlideImageRenderer } from "./render/types";

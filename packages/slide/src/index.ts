"use client";

export { default, default as LikeSlide } from "./slide";
export type { SlideProps, SlideHandle, SlideFeatures, SlideSelection, SlideEvent } from "./props";
export * from "./model";
export { createSlideSession } from "./session/create-slide-session";
export type { SlideSession, SlideSessionSnapshot } from "./session/create-slide-session";
export { importSlidePptx } from "./import/import-pptx";
export { importSlidePptxMasters } from "./import/pptx-masters";
export type { SlidePptxMastersImportResult } from "./import/pptx-masters";
export type { SlidePptxImportOptions, SlidePptxImportResult } from "./import/import-pptx";
export { exportSlidePptx } from "./export/export-pptx";
export type { SlidePptxExportOptions } from "./export/types";
export type { SlidePptxDiagnostic, SlidePptxDiagnosticCode, SlidePptxDiagnosticLocation } from "./office/types";
export * from "./render-entry";

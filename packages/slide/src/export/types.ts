import type { SlidePptxDiagnostic } from "../office/types";
import type { OfficePackageBlob, OfficePackageSignal } from "../ooxml";

/** A validated static SVG and the required intrinsic PNG pixel dimensions. */
export type SlideSvgRasterizeRequest = Readonly<{ src: string; width: number; height: number; signal?: OfficePackageSignal }>;
/** Supply a real PNG fallback for readers without native SVG support. Never fetch remote resources. */
export type SlideSvgRasterizer = (request: SlideSvgRasterizeRequest) => OfficePackageBlob | Promise<OfficePackageBlob>;

/** Portable export options shared by the browser and headless entry points. */
export type SlidePptxExportOptions = {
  /** Cancels conversion between processing chunks and while creating the ZIP. */
  signal?: OfficePackageSignal;
  /** Required by the headless entry point for SVG images; supplied automatically by the browser entry. */
  rasterizeSvg?: SlideSvgRasterizer;
  /** Reports approximations or conversion losses when writing PresentationML. */
  onWarning?: (warning: string) => void;
  /** Reports each distinct affected page/element/property, in addition to legacy text warnings. */
  onDiagnostic?: (diagnostic: SlidePptxDiagnostic) => void;
};

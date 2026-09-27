import type { SlidePptxDiagnostic } from "../office/types";
import type { OfficePackageSignal } from "../ooxml";

/** Portable export options shared by the browser and headless entry points. */
export type SlidePptxExportOptions = {
  /** Cancels conversion between processing chunks and while creating the ZIP. */
  signal?: OfficePackageSignal;
  /** Reports approximations or conversion losses when writing PresentationML. */
  onWarning?: (warning: string) => void;
  /** Reports each distinct affected page/element/property, in addition to legacy text warnings. */
  onDiagnostic?: (diagnostic: SlidePptxDiagnostic) => void;
};

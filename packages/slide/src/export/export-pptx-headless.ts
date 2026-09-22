import type { SlideDeck } from "../model/types";
import type { OfficePackageBlob } from "../ooxml";
import { exportSlidePptx as exportPptx } from "./export-pptx";
import type { SlidePptxExportOptions } from "./types";

/** Returns a native Blob at runtime; its public contract also works without DOM typings. */
export function exportSlidePptx(deck: SlideDeck, options?: SlidePptxExportOptions): Promise<OfficePackageBlob> {
  return exportPptx(deck, options);
}

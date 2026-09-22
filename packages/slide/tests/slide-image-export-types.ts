import { exportImage, exportImages } from "../src/render/export-images";
import type { SlideImageOptions, SlideImagesOptions, SlideImageRenderer } from "../src/render/types";
import type { SlideDeck } from "../src/model/types";
import type { OfficePackageBlob } from "../src/ooxml";

declare const deck: SlideDeck;
type CustomBlob = OfficePackageBlob & { custom: true };
declare const renderer: SlideImageRenderer<CustomBlob>;
void exportImage(deck, { pageNumber: 1, renderer }).then(result => { const custom: true = result.blob.custom; return custom; });
void exportImages(deck, { slideIds: ["id"], renderer });
void exportImages(deck, { renderer });
// @ts-expect-error The portable entry requires an explicit renderer.
void exportImage(deck, { pageNumber: 1 });
// @ts-expect-error Single output requires exactly one selector.
const missing: SlideImageOptions = { scale: 1 };
// @ts-expect-error Single selectors are mutually exclusive.
const conflicting: SlideImageOptions = { pageNumber: 1, slideId: "id" };
// @ts-expect-error Batch selectors are mutually exclusive.
const multiple: SlideImagesOptions = { range: { from: 1, to: 2 }, pageNumbers: [1] };
void [missing, conflicting, multiple];

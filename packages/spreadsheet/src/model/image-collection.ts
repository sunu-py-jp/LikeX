import { collectEmbeddedImageAssets, type EmbeddedImageAsset } from "./core-image-assets";
import type { OfficePackageSignal } from "../ooxml";
import type { SpreadsheetWorkbookSnapshot } from "../commands/types";
import type { SpreadsheetDrawingAnchor, SpreadsheetWorkbook } from "./types";
import { normalizeWorkbook } from "./workbook/normalize";

/** One original embedded image, identified by SHA-256 of its file bytes. */
export type SpreadsheetImageAsset = EmbeddedImageAsset;
export type SpreadsheetImagePlacement = {
  imageId: string;
  sheetId: string;
  sheetName: string;
  /** Zero-based position in the input workbook's sheet order. */
  sheetIndex: number;
  drawingId: string;
  resourceId: string;
  /** Row and column are zero-based; offsets and dimensions are CSS pixels. */
  anchor: SpreadsheetDrawingAnchor;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  alt: string;
};
export type SpreadsheetImageCollectionOptions = { signal?: OfficePackageSignal };
export type SpreadsheetImageCollection = {
  /** Unique original bytes, in first-placement order; unused resources are omitted. */
  images: SpreadsheetImageAsset[];
  /** Every image use, in sheet order followed by drawing order. */
  placements: SpreadsheetImagePlacement[];
};

/** Collect embedded images and their cell anchors without rendering, requests, or workbook changes. */
export async function collectSpreadsheetImages(input: SpreadsheetWorkbookSnapshot,
  options: SpreadsheetImageCollectionOptions = {}): Promise<SpreadsheetImageCollection> {
  if (!options || typeof options !== "object" || Array.isArray(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
    Reflect.ownKeys(options).some(key => key !== "signal" || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key)!, "value")))
    throw new Error("画像収集の設定が正しくありません");
  if (input === undefined) throw new Error("画像を収集するブックを指定してください");
  const signal = options.signal;
  // The complete model is validated and copied before collecting immutable source strings and placement fields.
  const workbook = normalizeWorkbook(input as SpreadsheetWorkbook);
  const sources: string[] = [], placements: Omit<SpreadsheetImagePlacement, "imageId">[] = [];
  for (const [sheetIndex, sheet] of workbook.sheets.entries()) for (const drawing of sheet.drawings ?? []) {
    if (drawing.type !== "image") continue;
    sources.push(workbook.resources!.images![drawing.resourceId].dataUrl);
    placements.push({ sheetId: sheet.id, sheetName: sheet.name, sheetIndex, drawingId: drawing.id, resourceId: drawing.resourceId,
      anchor: { ...drawing.anchor }, width: drawing.width, height: drawing.height, rotation: drawing.rotation ?? 0,
      flipX: drawing.flipX ?? false, flipY: drawing.flipY ?? false, alt: drawing.alt });
  }
  const { images, imageIds } = await collectEmbeddedImageAssets(sources, { signal });
  signal?.throwIfAborted();
  return { images, placements: placements.map((placement, index) => ({ imageId: imageIds[index], ...placement })) };
}

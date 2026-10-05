import { collectSpreadsheetImages, createWorkbook } from "../src/model-entry";
import { collectSpreadsheetImages as collectFromUi } from "../src";
import type { SpreadsheetImageAsset, SpreadsheetImagePlacement, SpreadsheetImageCollection,
  SpreadsheetImageCollectionOptions, SpreadsheetWorkbookSnapshot } from "../src/model-entry";

declare const snapshot: SpreadsheetWorkbookSnapshot;
declare const signal: AbortSignal;
const options: SpreadsheetImageCollectionOptions = { signal };
const result: Promise<SpreadsheetImageCollection> = collectSpreadsheetImages(snapshot, options);
const fromUi: typeof collectSpreadsheetImages = collectFromUi;
void collectSpreadsheetImages(createWorkbook());
void result.then(collection => {
  const asset: SpreadsheetImageAsset | undefined = collection.images[0];
  const placement: SpreadsheetImagePlacement | undefined = collection.placements[0];
  if (asset && placement) {
    const id: string = asset.imageId;
    const sheetIndex: number = placement.sheetIndex;
    const rotation: number = placement.rotation;
    const flipX: boolean = placement.flipX;
    return [id, sheetIndex, rotation, flipX];
  }
});
// @ts-expect-error Image collection accepts a workbook, not a sheet identifier.
void collectSpreadsheetImages("sheet-1");
// @ts-expect-error Rasterization is not part of collecting embedded image bytes.
void collectSpreadsheetImages(snapshot, { rasterizeImage: () => undefined });
void fromUi;

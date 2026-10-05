import { collectSlideImages } from "../src/model-entry";
import { collectSlideImages as collectFromUi } from "../src";
import { collectSlideImages as collectFromModel } from "../src/model";
import type { SlideDeck, SlideImageAsset, SlideImagePlacement, SlideImageCollectionOptions, SlideImageCollection } from "../src/model-entry";

declare const deck: SlideDeck;
declare const signal: AbortSignal;
const options: SlideImageCollectionOptions = { animationState: "initial", signal };
const fromUi: typeof collectSlideImages = collectFromUi;
const fromModel: typeof collectSlideImages = collectFromModel;
const result: Promise<SlideImageCollection> = collectSlideImages(deck, options);
void collectSlideImages(deck);
void collectSlideImages(deck, { animationState: "final" });
void result.then(collection => {
  const asset: SlideImageAsset | undefined = collection.images[0];
  const placement: SlideImagePlacement | undefined = collection.placements[0];
  if (asset && placement) {
    const id: string = asset.imageId;
    const source: "slide" | "master" | "layout" = placement.source;
    const page: number = placement.pageNumber;
    const mimeType: string = asset.mimeType;
    return [id, source, page, mimeType];
  }
});
// @ts-expect-error Only authored and final animation states are accepted.
void collectSlideImages(deck, { animationState: "running" });
// @ts-expect-error The collector accepts a deck, not a slide identifier.
void collectSlideImages("page");
// @ts-expect-error Renderers are unrelated to collecting original embedded image bytes.
void collectSlideImages(deck, { renderer: () => undefined });
void [fromUi, fromModel];

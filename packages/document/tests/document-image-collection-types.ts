import { collectDocumentImages, createDocument, type DocumentImageAsset, type DocumentImagePlacement,
  type DocumentImageCollection, type DocumentImageCollectionOptions } from "../src/model-entry";
import { collectDocumentImages as collectFromUI } from "../src/index";

const options: DocumentImageCollectionOptions = { signal: new AbortController().signal };
const collection: Promise<DocumentImageCollection> = collectDocumentImages(createDocument(), options);
void collectFromUI(createDocument());
void collection.then(result => {
  const image: DocumentImageAsset | undefined = result.images[0];
  const placement: DocumentImagePlacement | undefined = result.placements[0];
  if (placement) {
    const position: number = placement.from;
    // @ts-expect-error Document pages require a renderer; no inferred page number is returned.
    void placement.pageNumber;
    void position;
  }
  void image;
});
// @ts-expect-error Document collections have no animation timeline.
void collectDocumentImages(createDocument(), { animationState: "final" });

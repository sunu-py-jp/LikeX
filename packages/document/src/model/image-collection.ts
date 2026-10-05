import { collectEmbeddedImageAssets, type EmbeddedImageAsset } from "./core-image-assets";
import type { OfficePackageSignal } from "../ooxml";
import { normalizeDocument } from "./document";
import { documentSchema } from "./schema";
import type { DocumentModel } from "./types";
import { record } from "./validation";

/** One embedded PNG/JPEG, identified by SHA-256 of the original file bytes. */
export type DocumentImageAsset = EmbeddedImageAsset;
/** ProseMirror positions in this document snapshot, including nested blocks. */
export type DocumentImagePlacement = {
  imageId: string;
  documentId: string;
  blockId: string;
  from: number;
  to: number;
  width: number;
  height: number;
  alt: string;
};
export type DocumentImageCollectionOptions = { signal?: OfficePackageSignal };
export type DocumentImageCollection = {
  /** Unique images in first occurrence order. */
  images: DocumentImageAsset[];
  /** Every image block in document traversal order. No rendered page numbers. */
  placements: DocumentImagePlacement[];
};

/** Collect original image bytes and all uses without DOM, network, or document mutations. */
export async function collectDocumentImages(input: DocumentModel, options: DocumentImageCollectionOptions = {}): Promise<DocumentImageCollection> {
  record(options, "Image collection options", ["signal"]);
  const signal = options.signal;
  // Normalize before the first await so later caller mutations cannot alter this snapshot.
  const document = normalizeDocument(input), doc = documentSchema.nodeFromJSON(document.content);
  const sources: string[] = [], placements: Omit<DocumentImagePlacement, "imageId">[] = [];
  // Visit images directly: cloning every table/list ancestor would repeat its embedded bytes.
  doc.descendants((node, from) => {
    if (node.type.name !== "image") return;
    sources.push(node.attrs.src);
    // Normalization fills these attributes and validates their limits.
    placements.push({ documentId: document.id, blockId: node.attrs.id, from, to: from + node.nodeSize,
      width: node.attrs.width, height: node.attrs.height, alt: node.attrs.alt });
  });
  const { images, imageIds } = await collectEmbeddedImageAssets(sources, { signal });
  signal?.throwIfAborted();
  return { images, placements: placements.map((placement, index) => ({ imageId: imageIds[index], ...placement })) };
}

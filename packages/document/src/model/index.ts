export type * from "./types";
export { documentSchema } from "./schema";
export { createDocument, normalizeDocument, normalizeDocumentMark, normalizeDocumentPage, parseDocument, serializeDocument, DOCUMENT_FILE_EXTENSION, DEFAULT_DOCUMENT_PAGE } from "./document";
export { DOCUMENT_LIMITS } from "./validation";
export { inspectDocumentImage } from "./image-source";
export { collectDocumentImages } from "./image-collection";
export type { DocumentImageAsset, DocumentImagePlacement, DocumentImageCollection, DocumentImageCollectionOptions } from "./image-collection";
export { executeDocumentCommands } from "./commands";
export { getDocumentText, getBlocks, getBlock, getImages, getImage, getShapes, getShape, getCanvases, getCanvas } from "./query";

export { getDocumentCanvasConnectorRoute, getDocumentCanvasTarget } from "./canvas";

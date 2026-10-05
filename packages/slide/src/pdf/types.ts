/** Page dimensions at PDF.js viewport scale 1 (normally PDF points), including page rotation. */
export type SlidePdfPage = {
  readonly width: number;
  readonly height: number;
  render(options: SlidePdfRenderOptions): Promise<void>;
};
export type SlidePdfRenderOptions = {
  canvas: HTMLCanvasElement;
  /** Physical pixels per scale-1 page unit. Set the canvas CSS size separately. */
  scale: number;
  signal?: AbortSignal;
};
export type SlidePdfDocument = {
  readonly pageCount: number;
  /** Page numbers are one-based. */
  getPage(pageNumber: number, options?: { signal?: AbortSignal }): Promise<SlidePdfPage>;
  destroy(): Promise<void>;
};
/** Aborting the loader context also closes its successfully loaded document. */
export type SlidePdfLoader = (context: { signal: AbortSignal }) => Promise<SlidePdfDocument>;
export type SlidePdfInput = Blob | Uint8Array | ArrayBuffer;
/** Asset URLs and worker configuration belong to the host. These URLs are not read from the PDF. */
export type SlidePdfLoaderOptions = {
  cMapUrl?: string;
  cMapPacked?: boolean;
  standardFontDataUrl?: string;
  wasmUrl?: string;
};
/** Minimal injection boundary; does not import or depend on a particular PDF.js package version. */
export type SlidePdfJsModule = {
  getDocument(options: SlidePdfLoaderOptions & {
    data: Uint8Array;
    isEvalSupported: false;
    enableXfa: false;
    disableAutoFetch: true;
    disableStream: true;
    stopAtErrors: true;
    maxImageSize: number;
    canvasMaxAreaInBytes: number;
  }): unknown;
};

import type { OfficePackageBlob, OfficePackageSignal } from "../ooxml";

/** The source is a Blob; dimensions describe the image after EXIF orientation is applied. */
export type SpreadsheetImageRasterizeRequest = Readonly<{
  resourceId: string;
  name: string;
  source: OfficePackageBlob;
  width: number;
  height: number;
  signal?: OfficePackageSignal;
}>;

/** Return a PNG at the requested display dimensions. Preserve alpha and the first animation frame. */
export type SpreadsheetImageRasterizer = (
  request: SpreadsheetImageRasterizeRequest,
) => OfficePackageBlob | Promise<OfficePackageBlob>;

/** Framework-independent options for XLSX conversion. */
export type SpreadsheetXlsxExportOptions = Readonly<{
  signal?: OfficePackageSignal;
  /** Used only for GIF, WebP and JPEG with EXIF orientation. Defaults to browser Canvas. */
  rasterizeImage?: SpreadsheetImageRasterizer;
}>;

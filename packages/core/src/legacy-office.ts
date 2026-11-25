// Shared readers for the Office 97–2003 binary formats (.xls, .doc, .ppt). Import only: nothing here writes them.
export { openCompoundFile, COMPOUND_FILE_LIMITS } from "./legacy-office/compound-file";
export type { CompoundFile, CompoundFileLimits } from "./legacy-office/compound-file";
export { ByteReader } from "./legacy-office/bytes";
export { decodeCodePage, isSupportedCodePage } from "./legacy-office/code-page";
export { readCompoundFileTitle } from "./legacy-office/summary";
export { OFFICE_ART, OFFICE_ART_PROPERTY, officeArtRecords, officeArtRecordAt, officeArtPreset, readOfficeArtImage, readOfficeArtImages, readOfficeArtShape, readOfficeArtGroup,
  readOfficeArtDrawing, officeArtFlag, officeArtColor, officeArtString } from "./legacy-office/office-art";
export type { OfficeArtRecord, OfficeArtImage, OfficeArtProperty, OfficeArtBounds, OfficeArtShape, OfficeArtColor } from "./legacy-office/office-art";
export { convertDibToPng, DIB_LIMITS } from "./legacy-office/dib";

// OOXML widths use the Normal font's maximum digit width. Calibri 11pt at
// 96dpi is 7px; keep that deterministic fallback when no font metrics exist.
// https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.column
const maximumDigitWidth = 7;

/** Stored col/defaultColWidth values already include the 5px margin/grid allowance. */
export function xlsxColumnWidthToPixels(width: number): number {
  return Math.floor(((256 * width + Math.floor(128 / maximumDigitWidth)) / 256) * maximumDigitWidth);
}

/** Inverse OOXML encoding; pixel dimensions are quantized to 1/256 digit widths. */
export function pixelsToXlsxColumnWidth(pixels: number): number {
  return Math.floor(pixels / maximumDigitWidth * 256) / 256;
}

/** baseColWidth counts characters only, unlike col/defaultColWidth. */
export function xlsxBaseColumnWidthToPixels(characters: number): number {
  return characters * maximumDigitWidth + 5;
}

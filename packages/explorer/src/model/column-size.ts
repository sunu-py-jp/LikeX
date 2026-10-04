export const EXPLORER_DETAILS_COLUMNS = ["name", "location", "updatedAt", "extension", "size"] as const;
export const EXPLORER_STANDARD_DETAILS_COLUMNS = ["name", "updatedAt", "extension", "size"] as const;
export type ExplorerDetailsColumn = (typeof EXPLORER_DETAILS_COLUMNS)[number];
export type ExplorerDetailsColumnWidths = Record<ExplorerDetailsColumn, number>;

export const DEFAULT_DETAILS_COLUMN_WIDTHS: ExplorerDetailsColumnWidths = {
  name: 234, location: 240, updatedAt: 128, extension: 80, size: 96,
};
export const COLUMN_MIN_WIDTHS: ExplorerDetailsColumnWidths = {
  name: 140, location: 140, updatedAt: 64, extension: 64, size: 64,
};
export const COLUMN_MAX_WIDTH = 2000;

export function clampColumnWidth(column: ExplorerDetailsColumn, width: number): number {
  return Math.round(Math.min(COLUMN_MAX_WIDTH, Math.max(COLUMN_MIN_WIDTHS[column],
    Number.isFinite(width) ? width : DEFAULT_DETAILS_COLUMN_WIDTHS[column])));
}

/** Ignore invalid host values and preserve an omitted name width as automatic. */
export function normalizeColumnWidths(input?: Partial<ExplorerDetailsColumnWidths>): Partial<ExplorerDetailsColumnWidths> {
  const widths: Partial<ExplorerDetailsColumnWidths> = {};
  for (const column of EXPLORER_DETAILS_COLUMNS) {
    const width = input?.[column];
    if (typeof width === "number" && Number.isFinite(width)) widths[column] = clampColumnWidth(column, width);
  }
  return widths;
}

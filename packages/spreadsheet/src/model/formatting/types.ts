export type SpreadsheetCellBorder = Readonly<{
  style?: "none" | "solid" | "dashed" | "dotted" | "double";
  width?: 1 | 2 | 3;
  color?: string;
}>;
export type SpreadsheetCellBorders = Readonly<Partial<Record<"top" | "right" | "bottom" | "left", SpreadsheetCellBorder>>>;

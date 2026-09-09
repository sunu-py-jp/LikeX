import type { SpreadsheetProps } from "../props";

export type SpreadsheetFeatureSettings = Required<NonNullable<SpreadsheetProps["features"]>>;

export function resolveSpreadsheetFeatures(features: SpreadsheetProps["features"]): SpreadsheetFeatureSettings {
  return {
    formulas: features?.formulas !== false,
    clipboard: features?.clipboard !== false,
    formatting: features?.formatting !== false,
    mergeCells: features?.mergeCells !== false,
    rowColumnOperations: features?.rowColumnOperations !== false,
    sheets: features?.sheets !== false,
    resize: features?.resize !== false,
    undoRedo: features?.undoRedo !== false,
    images: features?.images !== false,
    shapes: features?.shapes !== false,
    textBoxes: features?.textBoxes !== false,
    comments: features?.comments !== false,
  };
}

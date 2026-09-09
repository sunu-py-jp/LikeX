import type { SpreadsheetFeatures } from "../api/features";

export type SpreadsheetFeatureSettings = Required<SpreadsheetFeatures>;

export function resolveSpreadsheetFeatures(features: SpreadsheetFeatures | undefined): SpreadsheetFeatureSettings {
  return {
    formulas: features?.formulas !== false,
    clipboard: features?.clipboard !== false,
    copy: features?.clipboard !== false && features?.copy !== false,
    cut: features?.clipboard !== false && features?.cut !== false,
    paste: features?.clipboard !== false && features?.paste !== false,
    formatting: features?.formatting !== false,
    mergeCells: features?.mergeCells !== false,
    rowColumnOperations: features?.rowColumnOperations !== false,
    insertRows: features?.rowColumnOperations !== false && features?.insertRows !== false,
    deleteRows: features?.rowColumnOperations !== false && features?.deleteRows !== false,
    insertColumns: features?.rowColumnOperations !== false && features?.insertColumns !== false,
    deleteColumns: features?.rowColumnOperations !== false && features?.deleteColumns !== false,
    sheets: features?.sheets !== false,
    createSheet: features?.sheets !== false && features?.createSheet !== false,
    renameSheet: features?.sheets !== false && features?.renameSheet !== false,
    deleteSheet: features?.sheets !== false && features?.deleteSheet !== false,
    resize: features?.resize !== false,
    undoRedo: features?.undoRedo !== false,
    images: features?.images !== false,
    shapes: features?.shapes !== false,
    textBoxes: features?.textBoxes !== false,
    comments: features?.comments !== false,
    save: features?.save !== false,
    refresh: features?.refresh !== false,
  };
}

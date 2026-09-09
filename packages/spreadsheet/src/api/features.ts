/** Omitted features are enabled. False hides controls and prevents their actions. */
export type SpreadsheetFeatures = Readonly<{
  formulas?: boolean;
  /** Master switch for copy, cut and paste. */
  clipboard?: boolean;
  copy?: boolean;
  cut?: boolean;
  paste?: boolean;
  formatting?: boolean;
  /** Existing merged cells still render when merging/unmerging is disabled. */
  mergeCells?: boolean;
  /** Master switch for row and column insertion/deletion. */
  rowColumnOperations?: boolean;
  insertRows?: boolean;
  deleteRows?: boolean;
  insertColumns?: boolean;
  deleteColumns?: boolean;
  /** Shows sheet tabs and enables sheet operations. */
  sheets?: boolean;
  createSheet?: boolean;
  renameSheet?: boolean;
  deleteSheet?: boolean;
  /** Allows dragging sheet tabs to change their order. */
  reorderSheets?: boolean;
  /** Allows resizing columns and drawing objects. */
  resize?: boolean;
  undoRedo?: boolean;
  images?: boolean;
  shapes?: boolean;
  textBoxes?: boolean;
  comments?: boolean;
  /** Disables all save entry points, including the imperative handle. */
  save?: boolean;
  /** Refresh also requires onRefresh. */
  refresh?: boolean;
}>;

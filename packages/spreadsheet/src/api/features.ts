/** Omitted features are enabled. False hides controls and prevents their actions. */
export type SpreadsheetFeatures = Readonly<{
  formulas?: boolean;
  /** Master switch for copy, cut and paste. */
  clipboard?: boolean;
  copy?: boolean;
  cut?: boolean;
  paste?: boolean;
  /** Values, formulas, or formats only; also requires clipboard and paste. */
  pasteSpecial?: boolean;
  /** Find cells in a sheet or across the workbook, including in read-only mode. */
  search?: boolean;
  /** Replace matching cell content; also requires search. */
  replace?: boolean;
  /** Drag the selection handle to extend values, sequences, and formulas. */
  autoFill?: boolean;
  formatting?: boolean;
  /** Create, update, or remove named ranges. Reading existing names remains available. */
  namedRanges?: boolean;
  /** Structured tables and bordered table writes. */
  tables?: boolean;
  /** Allows changing rules; existing conditional formatting still renders. */
  conditionalFormatting?: boolean;
  /** Allows configuring input rules. Existing rules remain enforced when disabled. */
  dataValidation?: boolean;
  /** Shows checkbox controls for cells with a checkbox rule. */
  checkboxes?: boolean;
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
  /** Also requires sheets and createSheet. */
  duplicateSheet?: boolean;
  renameSheet?: boolean;
  deleteSheet?: boolean;
  /** Allows dragging sheet tabs to change their order. */
  reorderSheets?: boolean;
  /** Allows resizing rows, columns and drawing objects, including automatic sizing. */
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
  /** Excel output is available even in read-only mode. */
  exportExcel?: boolean;
}>;

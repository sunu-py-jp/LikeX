/** Pure immutable workbook operations. Implementation modules depend on foundations, never this barrel. */
export { normalizeWorkbook, createWorkbook } from "./workbook/normalize";
export { setCellValue, setCellValues, formatCells } from "./workbook/cells";
export { mergeCells, unmergeCells } from "./workbook/merges";
export { resizeColumn, insertRows, deleteRows, insertColumns, deleteColumns } from "./workbook/structure";
export { moveCells } from "./workbook/move-cells";
export { addSheet, renameSheet, deleteSheet, moveSheet } from "./workbook/sheets";
export { addDrawing, updateDrawing, deleteDrawing, insertImage, setCellComment, setCellComments } from "./workbook/annotations";

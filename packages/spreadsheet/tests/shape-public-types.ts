import { SPREADSHEET_SHAPES, type SpreadsheetShapeKind, type SpreadsheetShapeInfo, type SpreadsheetShapeCategory,
  type SpreadsheetShapeDrawing, type SpreadsheetCommand } from "../src/index";
import { SPREADSHEET_SHAPES as headlessShapes } from "../src/model-entry";

const kinds: readonly SpreadsheetShapeKind[] = ["rectangle", "roundedRectangle", "ellipse", "triangle", "rightTriangle",
  "diamond", "parallelogram", "trapezoid", "rightArrow", "leftArrow", "upArrow", "downArrow", "leftRightArrow", "upDownArrow", "line", "arrow"];
const infos: readonly SpreadsheetShapeInfo[] = SPREADSHEET_SHAPES;
const category: SpreadsheetShapeCategory = infos[0].category;
const command: SpreadsheetCommand = { type: "shapes.insert", sheetId: "sheet", shape: kinds[0], anchor: { row: 0, column: 0 }, rotation: 45 };
const drawing: SpreadsheetShapeDrawing = { id: "shape", type: "shape", shape: "leftRightArrow", width: 120, height: 60,
  anchor: { row: 0, column: 0, offsetX: 0, offsetY: 0 }, fill: "#fff", stroke: "#000", strokeWidth: 2, rotation: 315 };
const update: SpreadsheetCommand = { type: "shapes.update", sheetId: "sheet", drawingId: drawing.id, patch: { shape: "roundedRectangle", rotation: -90 } };
const rotateText: SpreadsheetCommand = { type: "textBoxes.insert", sheetId: "sheet", anchor: { row: 0, column: 0 }, rotation: 30 };
const rotateImage: SpreadsheetCommand = { type: "images.update", sheetId: "sheet", drawingId: "image", patch: { rotation: 720 } };
// @ts-expect-error Rotation accepts degrees as a number, not a CSS angle string.
const invalidRotation: SpreadsheetCommand = { type: "shapes.update", sheetId: "sheet", drawingId: drawing.id, patch: { rotation: "45deg" } };
// @ts-expect-error Unsupported shapes cannot be passed to the public API.
const unsupported: SpreadsheetShapeKind = "star";
// @ts-expect-error The public catalog is readonly.
SPREADSHEET_SHAPES.push({ kind: "rectangle", label: "test", category: "basic" });
// @ts-expect-error Catalog entries are readonly too.
SPREADSHEET_SHAPES[0].label = "test";
void [headlessShapes, category, command, update, rotateText, rotateImage, invalidRotation, unsupported];

import type { SpreadsheetContextMenuContext } from "../../api/context-menu";
import type { SpreadsheetController } from "../use-spreadsheet";

export type DrawingMenuTarget = Extract<SpreadsheetContextMenuContext["target"], { kind: "drawing" }>;
export type DrawingMenuAction = "drawing-copy" | "drawing-paste" | "drawing-duplicate" | "drawing-flip-x" | "drawing-flip-y" | "drawing-reset-rotation" | "drawing-delete";
export type DrawingMenuItem = Readonly<{ id: DrawingMenuAction; label: string; group: number; disabled: boolean; disabledReason?: string; destructive?: boolean }>;

export function drawingMenuItems(c: SpreadsheetController, target: DrawingMenuTarget): DrawingMenuItem[] {
  const drawing = c.getWorkbook().sheets.find(sheet => sheet.id === target.sheetId)?.drawings?.find(item => item.id === target.drawingId);
  if (!drawing || drawing.type !== target.drawingType || !c.features[drawing.type === "image" ? "images" : drawing.type === "shape" ? "shapes" : "textBoxes"]) return [];
  const items: DrawingMenuItem[] = [];
  const busy = c.disabled || c.requesting || c.pendingObjectEdit || !!c.editing;
  const add = (id: DrawingMenuAction, label: string, group: number, disabled = busy, destructive = false) => items.push({ id, label, group, disabled, destructive });
  if (c.features.copy) add("drawing-copy", "コピー", 0, c.saving || c.refreshing || c.requesting || c.pendingObjectEdit || !!c.editing);
  if (!c.readOnly) {
    if (c.features.paste) add("drawing-paste", "貼り付け", 0);
    if (c.features.copy && c.features.paste) add("drawing-duplicate", "複製", 0);
    if (c.features.resize) {
      add("drawing-flip-x", "左右反転", 1);
      add("drawing-flip-y", "上下反転", 1);
      add("drawing-reset-rotation", "回転をリセット", 1, busy || !(drawing.rotation ?? 0));
    }
    add("drawing-delete", "削除", 2, busy, true);
  }
  return items;
}

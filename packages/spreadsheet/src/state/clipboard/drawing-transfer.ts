import { copySpreadsheetDrawing, type SpreadsheetDrawingPastePayload } from "../../model/editing/copy-drawing";
import type { SpreadsheetController } from "../use-spreadsheet";
import type { SpreadsheetCommand } from "../../commands/types";
import type { SpreadsheetSelection } from "../../props";

export type CopiedDrawing = { kind: "drawing"; token: string; text: string; payload: SpreadsheetDrawingPastePayload };

export function captureCopiedDrawing(controller: SpreadsheetController): CopiedDrawing | null {
  if (!controller.selectedDrawingId || !controller.features.copy || controller.pendingObjectEdit) return null;
  const payload = copySpreadsheetDrawing(controller.getWorkbook(), controller.activeSheet.id, controller.selectedDrawingId, { features: controller.features });
  return { kind: "drawing", payload, token: crypto.randomUUID(),
    text: payload.drawing.type === "image" ? payload.drawing.alt : payload.drawing.text ?? "図形" };
}

export function prepareDrawingPaste(controller: SpreadsheetController, copied: CopiedDrawing,
  selection?: SpreadsheetSelection): SpreadsheetCommand {
  const selected = selection ? undefined : controller.selectedDrawing;
  const anchor = selected ? { ...selected.anchor, offsetX: Math.min(10_000, selected.anchor.offsetX + 16), offsetY: Math.min(10_000, selected.anchor.offsetY + 16) }
    : { ...(selection ?? controller.selection).focus, offsetX: 0, offsetY: 0 };
  return { type: "drawings.paste", sheetId: selection?.sheetId ?? controller.activeSheet.id, payload: copied.payload, anchor };
}

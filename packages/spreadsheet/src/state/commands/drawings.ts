import type { SpreadsheetCommand, SpreadsheetCommandAnchor, SpreadsheetCommandReceipt } from "../../api/types";
import { addDrawing, deleteDrawing, insertImage, updateDrawing } from "../../model/workbook";
import type { SpreadsheetDrawingAnchor, SpreadsheetDrawingPatch, SpreadsheetWorkbook } from "../../model/types";
import type { SpreadsheetFeatureSettings } from "../features";
import { commandKeys, commandRecord, rejectCommand, requireCommandFeature, requireCommandSheet } from "./validation";

type DrawingCommand = Extract<SpreadsheetCommand, { type: "images.insert" | "shapes.insert" | "textBoxes.insert" |
  "drawings.delete" | "images.update" | "shapes.update" | "textBoxes.update" }>;

function drawingAnchor(input: SpreadsheetCommandAnchor): SpreadsheetDrawingAnchor {
  const anchor = commandRecord(input, "描画位置");
  commandKeys(anchor, ["row", "column", "offsetX", "offsetY"], "描画位置");
  for (const key of ["offsetX", "offsetY"])
    if (anchor[key] !== undefined && typeof anchor[key] !== "number") return rejectCommand("INVALID_COMMAND", `${key}は数値で指定してください`);
  return { row: input.row, column: input.column, offsetX: input.offsetX ?? 0, offsetY: input.offsetY ?? 0 };
}

/** Construct typed drawing operations without coupling their defaults or ID creation to a toolbar. */
export function applyDrawingCommand(workbook: SpreadsheetWorkbook, command: DrawingCommand,
  features: SpreadsheetFeatureSettings, nextId: () => string): { workbook: SpreadsheetWorkbook; receipt: SpreadsheetCommandReceipt } {
  const sheet = requireCommandSheet(workbook, command.sheetId);
  const receipt = (next: SpreadsheetWorkbook, drawingId: string, resourceId?: string) => ({ workbook: next,
    receipt: { type: command.type, sheetId: sheet.id, drawingId, ...(resourceId ? { resourceId } : {}) } });
  switch (command.type) {
    case "images.insert": {
      requireCommandFeature(features, "images");
      commandRecord(command.resource, "画像リソース");
      const anchor = drawingAnchor(command.anchor), resourceId = nextId(), drawingId = nextId();
      const scale = Math.min(1, 320 / command.resource.width, 240 / command.resource.height);
      const width = command.width ?? Math.max(1, Math.round(command.resource.width * scale));
      const height = command.height ?? Math.max(1, Math.round(command.resource.height * scale));
      return receipt(insertImage(workbook, sheet.id, resourceId, command.resource,
        { id: drawingId, type: "image", resourceId, anchor, width, height, alt: command.alt ?? command.resource.name }), drawingId, resourceId);
    }
    case "shapes.insert": {
      requireCommandFeature(features, "shapes");
      const anchor = drawingAnchor(command.anchor), drawingId = nextId();
      const line = command.shape === "line" || command.shape === "arrow";
      return receipt(addDrawing(workbook, sheet.id, { id: drawingId, type: "shape", shape: command.shape, anchor,
        width: command.width ?? 160, height: command.height ?? (line ? 72 : 100),
        fill: command.fill ?? (line ? "transparent" : "#e8f3ec"), stroke: command.stroke ?? "#217346", strokeWidth: command.strokeWidth ?? 2 }), drawingId);
    }
    case "textBoxes.insert": {
      requireCommandFeature(features, "textBoxes");
      const anchor = drawingAnchor(command.anchor), drawingId = nextId();
      return receipt(addDrawing(workbook, sheet.id, { id: drawingId, type: "text", anchor,
        text: command.text ?? "テキスト", width: command.width ?? 200, height: command.height ?? 80,
        fontSize: command.fontSize ?? 16, color: command.color ?? "currentColor", background: command.background ?? "transparent",
        ...(command.bold !== undefined ? { bold: command.bold } : {}) }), drawingId);
    }
    default: {
      if (typeof command.drawingId !== "string" || !command.drawingId) return rejectCommand("INVALID_COMMAND", "drawingIdを指定してください");
      const drawing = sheet.drawings?.find(item => item.id === command.drawingId);
      if (!drawing) return rejectCommand("INVALID_TARGET", "指定された描画オブジェクトが見つかりません");
      const feature = drawing.type === "image" ? "images" : drawing.type === "shape" ? "shapes" : "textBoxes";
      requireCommandFeature(features, feature);
      if (command.type === "drawings.delete") return receipt(deleteDrawing(workbook, sheet.id, drawing.id), drawing.id,
        drawing.type === "image" ? drawing.resourceId : undefined);
      if ((command.type === "images.update" && drawing.type !== "image") || (command.type === "shapes.update" && drawing.type !== "shape") ||
        (command.type === "textBoxes.update" && drawing.type !== "text")) return rejectCommand("INVALID_TARGET", "描画オブジェクトの種類がコマンドと一致しません");
      const patch = commandRecord(command.patch, "更新内容");
      const specific = drawing.type === "image" ? ["resourceId", "alt"] : drawing.type === "shape" ? ["shape", "fill", "stroke", "strokeWidth"]
        : ["text", "fontSize", "color", "background", "bold"];
      commandKeys(patch, ["anchor", "width", "height", ...specific], "更新内容");
      if ((patch.width !== undefined && patch.width !== drawing.width) || (patch.height !== undefined && patch.height !== drawing.height))
        requireCommandFeature(features, "resize");
      const normalized: SpreadsheetDrawingPatch = { ...patch,
        ...(patch.anchor !== undefined ? { anchor: drawingAnchor(patch.anchor as SpreadsheetCommandAnchor) } : {}) };
      const next = updateDrawing(workbook, sheet.id, drawing.id, normalized);
      const updated = next.sheets.find(item => item.id === sheet.id)!.drawings!.find(item => item.id === drawing.id)!;
      return receipt(next, drawing.id, updated.type === "image" ? updated.resourceId : undefined);
    }
  }
}

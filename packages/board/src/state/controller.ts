import { createModelEditorController, type ModelEditorAdapter, type ModelEditorOptions } from "../core";
import { createBoard, normalizeBoard, serializeBoard, executeBoardCommands, type BoardModel, type BoardCommand } from "../model";
import type { BoardFeature } from "../model/types";
export const boardEditorAdapter: ModelEditorAdapter<BoardModel, BoardCommand, BoardFeature> = {
  normalize: normalizeBoard, serialize: serializeBoard, execute: (board, commands) => executeBoardCommands(board, commands).board,
  features: ["rename", "columns", "cards", "move", "labels", "members", "import", "export", "history"],
  getCommandFeatures(command) {
    if (command.type === "board.replace") return ["import"];
    if (command.type === "board.rename") return ["rename"];
    if (command.type === "column.add") return ["columns", ...(command.column.cards?.length ? ["cards" as const] : []), ...(command.column.cards?.some(card => card.labelIds?.length) ? ["labels" as const] : []), ...(command.column.cards?.some(card => card.assigneeIds?.length) ? ["members" as const] : [])];
    if (command.type.startsWith("column.")) return command.type === "column.move" ? ["columns", "move"] : command.type === "column.delete" ? ["columns", "cards"] : ["columns"];
    if (command.type.startsWith("label.")) return ["labels"];
    if (command.type.startsWith("member.")) return ["members"];
    if (command.type === "card.move") return ["cards", "move"];
    if (command.type === "card.update") return ["cards", ...(command.patch.labelIds ? ["labels" as const] : []), ...(command.patch.assigneeIds ? ["members" as const] : [])];
    if (command.type === "card.add") return ["cards", ...(command.card.labelIds?.length ? ["labels" as const] : []), ...(command.card.assigneeIds?.length ? ["members" as const] : [])];
    return ["cards"];
  },
};
export function createBoardController(board: BoardModel = createBoard(), options: ModelEditorOptions<BoardModel, BoardFeature> = {}) { return createModelEditorController(boardEditorAdapter, board, options); }

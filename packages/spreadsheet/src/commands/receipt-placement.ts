import { parseCellAddress } from "../model/address";
import { getDrawingPlacement } from "../model/drawing-placement";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import type { SpreadsheetCommand, SpreadsheetCommandPlacement, SpreadsheetCommandReceipt } from "./types";

function getCommandPlacement(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand,
  receipt: SpreadsheetCommandBaseReceipt): Partial<SpreadsheetCommandPlacement> | undefined {
  switch (command.type) {
    case "images.insert":
    case "images.update":
    case "shapes.insert":
    case "shapes.update":
    case "textBoxes.insert":
    case "textBoxes.update": {
      const { nextRow, nextColumn } = getDrawingPlacement(workbook, receipt.sheetId, receipt.drawingId!);
      return { nextRow, nextColumn };
    }
    case "cells.set": {
      let nextRow = 0, nextColumn = 0;
      for (const address of Object.keys(command.values)) {
        const position = parseCellAddress(address)!; // The command was validated before application.
        nextRow = Math.max(nextRow, position.row + 1);
        nextColumn = Math.max(nextColumn, position.column + 1);
      }
      return nextRow ? { nextRow, nextColumn } : undefined;
    }
    case "cells.paste": {
      const height = command.payload.values.length;
      const width = command.payload.values.reduce((max, row) => Math.max(max, row.length), 0);
      return height && width ? { nextRow: command.target.row + height, nextColumn: command.target.column + width } : undefined;
    }
    case "cells.fill":
      return { nextRow: command.target.bottom + 1, nextColumn: command.target.right + 1 };
    case "rows.insert":
      return { nextRow: command.index + (command.count ?? 1) };
    case "columns.insert":
      return { nextColumn: command.index + (command.count ?? 1) };
    default:
      return undefined;
  }
}

/** Called once after each successful command, so later batch mutations cannot change prior coordinates. */
export function completeCommandReceipt(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand,
  receipt: SpreadsheetCommandBaseReceipt): SpreadsheetCommandReceipt {
  const placement = getCommandPlacement(workbook, command, receipt);
  // The command discriminant and placement are paired centrally instead of in every model operation.
  return Object.freeze({ ...receipt, ...(placement ? { placement: Object.freeze(placement) } : {}) }) as SpreadsheetCommandReceipt;
}

import { parseCellAddress } from "../model/address";
import { getDrawingPlacement } from "../model/drawing-placement";
import { getCellPasteRange } from "../model/editing/paste";
import type { SpreadsheetWorkbook } from "../model/types";
import type { SpreadsheetCommandBaseReceipt } from "./internal-types";
import type { SpreadsheetCommand, SpreadsheetCommandPlacement, SpreadsheetCommandReceipt } from "./types";

function getCommandPlacement(workbook: SpreadsheetWorkbook, command: SpreadsheetCommand,
  receipt: SpreadsheetCommandBaseReceipt): Partial<SpreadsheetCommandPlacement> | undefined {
  switch (command.type) {
    case "drawings.paste":
    case "images.insert":
    case "images.update":
    case "shapes.insert":
    case "shapes.update":
    case "textBoxes.insert":
    case "textBoxes.update": {
      const { nextRow, nextColumn } = getDrawingPlacement(workbook, receipt.sheetId, receipt.drawingId!);
      return { nextRow, nextColumn };
    }
    case "tables.insert": case "cells.writeTable":
      return { nextRow: receipt.range!.bottom + 1, nextColumn: receipt.range!.right + 1 };
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
      const destination = getCellPasteRange(workbook.sheets.find(sheet => sheet.id === command.sheetId)!, command.target, command.payload);
      return destination ? { nextRow: destination.bottom + 1, nextColumn: destination.right + 1 } : undefined;
    }
    case "cells.move":
      return { nextRow: command.target.row + command.source.bottom - command.source.top + 1,
        nextColumn: command.target.column + command.source.right - command.source.left + 1 };
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

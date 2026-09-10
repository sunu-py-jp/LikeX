import type { SpreadsheetFeatures } from "../api/features";
import { resolveSpreadsheetFeatures } from "../api/resolve-features";
import { validateSpreadsheetFeatures } from "../api/validate-features";
import { stageSpreadsheetCommands } from "../commands/stage-spreadsheet-commands";
import { captureSpreadsheetCommands } from "../commands/capture-spreadsheet-commands";
import type { SpreadsheetCommand, SpreadsheetCommandResult, SpreadsheetWorkbookSnapshot } from "../commands/types";
import { commandKeys, commandRecord } from "../commands/validation";
import { createWorkbookHistory, type SpreadsheetHistoryState, type WorkbookHistoryDirection } from "../history/workbook-history";
import { normalizeWorkbook } from "../model/workbook/normalize";
import type { SpreadsheetWorkbook } from "../model/types";
import { createSpreadsheetReader, type SpreadsheetReadApi } from "../model/query-reader";

export type SpreadsheetSessionOptions = Readonly<{
  features?: SpreadsheetFeatures;
  /** Maximum Undo/Redo snapshots, from 0 to 1,000. Defaults to 50. Zero disables history. */
  historyLimit?: number;
}>;

export type SpreadsheetSession = SpreadsheetReadApi & Readonly<{
  execute(command: SpreadsheetCommand): SpreadsheetCommandResult;
  batch(commands: readonly SpreadsheetCommand[]): SpreadsheetCommandResult;
  getWorkbook(): SpreadsheetWorkbookSnapshot;
  undo(): boolean;
  redo(): boolean;
  getHistoryState(): SpreadsheetHistoryState;
  clearHistory(): void;
  /** Validate and replace the current workbook, clearing history. Invalid data leaves the session unchanged. */
  replaceWorkbook(workbook: SpreadsheetWorkbookSnapshot): void;
}>;

/**
 * A synchronous local command session for servers, workers and non-React callers.
 * Each successful changed batch creates one shared-history entry. Persistence, edit
 * permission, events and a saved baseline remain the host's responsibility.
 */
export function createSpreadsheetSession(initialWorkbook: SpreadsheetWorkbookSnapshot,
  options: SpreadsheetSessionOptions = {}): SpreadsheetSession {
  commandKeys(commandRecord(options, "セッションの設定"), ["features", "historyLimit"], "セッションの設定");
  validateSpreadsheetFeatures(options.features);
  const history = createWorkbookHistory(options.historyLimit);
  if (initialWorkbook === undefined) throw new Error("操作するブックを指定してください");
  const features = resolveSpreadsheetFeatures(options.features);
  // Validate/copy the host boundary once; subsequent commands operate on isolated snapshots.
  let workbook = normalizeWorkbook(initialWorkbook as SpreadsheetWorkbook), busy = false;
  const getWorkbook = () => workbook;
  const batch = (commands: readonly SpreadsheetCommand[]): SpreadsheetCommandResult => {
    if (busy) return Object.freeze({ ok: false, code: "BUSY", message: "ほかの操作を処理しています" });
    busy = true;
    try {
      const captured = captureSpreadsheetCommands(commands);
      if (!captured.ok) return captured;
      const result = stageSpreadsheetCommands(workbook, captured.commands, features, () => crypto.randomUUID());
      if (!result.ok) return result;
      if (result.changed) { history.record(workbook, features.undoRedo); workbook = result.workbook; }
      return Object.freeze({ ok: true, changed: result.changed, results: result.results });
    } finally { busy = false; }
  };
  const step = (direction: WorkbookHistoryDirection): boolean => {
    if (busy || !features.undoRedo) return false;
    const next = history.step(direction, workbook);
    if (!next) return false;
    workbook = next;
    return true;
  };
  const assertIdle = () => { if (busy) throw new Error("ほかの操作を処理しています"); };
  return Object.freeze({
    ...createSpreadsheetReader(getWorkbook),
    execute: (command: SpreadsheetCommand) => batch([command]), batch,
    getWorkbook,
    undo: () => step("past"), redo: () => step("future"),
    getHistoryState: history.getState,
    clearHistory: () => { assertIdle(); history.clear(); },
    replaceWorkbook(next: SpreadsheetWorkbookSnapshot): void {
      assertIdle();
      busy = true;
      try {
        if (next === undefined) throw new Error("置き換えるブックを指定してください");
        const accepted = normalizeWorkbook(next as SpreadsheetWorkbook);
        workbook = accepted;
        history.clear();
      } finally { busy = false; }
    },
  });
}

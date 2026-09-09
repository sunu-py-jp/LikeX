"use client";

import { useCallback, type RefObject } from "react";
import type { SpreadsheetCommand, SpreadsheetCommandFailure, SpreadsheetCommandResult } from "../api/types";
import { stageSpreadsheetCommands } from "./commands/stage-spreadsheet-commands";
import { resolveSpreadsheetFeatures } from "./features";
import type { DraftSelection } from "./types";
import type { useWorkbookDraft } from "./use-workbook-draft";

type CommandSession = DraftSelection & {
  editingRef: RefObject<unknown>;
  pendingObjectEditRef: RefObject<boolean>;
};

/** Shared command validation and one-transaction publication for GUI and imperative callers. */
export function useSpreadsheetCommands(draft: ReturnType<typeof useWorkbookDraft>, session: CommandSession) {
  const { workbookRef, propsRef, applyTransaction, getMutationFailure, reportError } = draft;
  const { selectionRef, setSelection, editingRef, pendingObjectEditRef } = session;
  const run = useCallback((commands: readonly SpreadsheetCommand[], external: boolean): SpreadsheetCommandResult => {
    const unavailable = getMutationFailure();
    if (unavailable) return unavailable;
    if (external && (editingRef.current || pendingObjectEditRef.current))
      return { ok: false, code: "PENDING_EDIT", message: "編集中の内容を確定してから操作してください" };
    const attempt: { staged?: ReturnType<typeof stageSpreadsheetCommands> } = {};
    const committed = applyTransaction(workbook => {
      const staged = stageSpreadsheetCommands(workbook, commands, resolveSpreadsheetFeatures(propsRef.current.features), () => crypto.randomUUID());
      attempt.staged = staged;
      return staged.ok && staged.changed ? staged.workbook : workbook;
    }, { selectionRef, setSelection });
    if (!committed.ok) return committed;
    const staged = attempt.staged;
    if (!staged) return { ok: false, code: "VALIDATION_FAILED", message: "操作を完了できませんでした" };
    if (!staged.ok) return staged;
    return { ok: true, changed: committed.changed, results: staged.results };
  }, [getMutationFailure, editingRef, pendingObjectEditRef, applyTransaction, propsRef, selectionRef, setSelection]);
  const showFailure = useCallback((failure: SpreadsheetCommandFailure) => {
    if (failure.code !== "NOT_MOUNTED") reportError(new Error(failure.message));
  }, [reportError]);
  const executeCommands = useCallback((commands: readonly SpreadsheetCommand[]): SpreadsheetCommandResult => {
    const result = run(commands, false);
    if (!result.ok) showFailure(result);
    return result;
  }, [run, showFailure]);
  const executeCommand = useCallback((command: SpreadsheetCommand) => executeCommands([command]), [executeCommands]);
  const externalBatch = useCallback((commands: readonly SpreadsheetCommand[]) => run(commands, true), [run]);
  const externalExecute = useCallback((command: SpreadsheetCommand) => externalBatch([command]), [externalBatch]);
  const getWorkbook = useCallback(() => workbookRef.current, [workbookRef]);

  return { executeCommand, executeCommands, externalExecute, externalBatch, getWorkbook };
}

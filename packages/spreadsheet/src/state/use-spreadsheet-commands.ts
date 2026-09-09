"use client";

import { useCallback, type RefObject } from "react";
import type { MaybePromise } from "../core";
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
  const run = useCallback((commands: readonly SpreadsheetCommand[], external: boolean, synchronous = false): MaybePromise<SpreadsheetCommandResult> => {
    const unavailable = getMutationFailure();
    if (unavailable) return unavailable;
    if (external && (editingRef.current || pendingObjectEditRef.current))
      return { ok: false, code: "PENDING_EDIT", message: "編集中の内容を確定してから操作してください" };
    let captured: readonly SpreadsheetCommand[];
    if (!Array.isArray(commands)) return { ok: false, code: "INVALID_COMMAND", message: "コマンドを配列で指定してください" };
    try { captured = structuredClone(commands); }
    catch { return { ok: false, code: "INVALID_COMMAND", message: "コマンドはシリアライズ可能なデータで指定してください" }; }
    const sheetIds = new Set(captured.flatMap(command => command && typeof command === "object" && "sheetId" in command && typeof command.sheetId === "string" ? [command.sheetId] : []));
    const sheetId = sheetIds.size === 1 ? [...sheetIds][0] : undefined;
    const attempt: { staged?: ReturnType<typeof stageSpreadsheetCommands> } = {};
    const committed = applyTransaction(workbook => {
      const staged = stageSpreadsheetCommands(workbook, captured, resolveSpreadsheetFeatures(propsRef.current.features), () => crypto.randomUUID());
      attempt.staged = staged;
      return staged.ok && staged.changed ? staged.workbook : workbook;
    }, { selectionRef, setSelection }, { source: external ? "api" : "ui", synchronous,
      ...(sheetId ? { sheetId } : {}),
      action: captured.length === 1 ? captured[0]?.type : "batch", commands: captured.map(command => command?.type),
      ...(external ? { isCurrent: () => !editingRef.current && !pendingObjectEditRef.current } : {}) });
    const finish = (value: Awaited<typeof committed>): SpreadsheetCommandResult => {
      if (!value.ok) return value;
      const staged = attempt.staged;
      if (!staged) return { ok: false, code: "VALIDATION_FAILED", message: "操作を完了できませんでした" };
      if (!staged.ok) return staged;
      return { ok: true, changed: value.changed, results: staged.results };
    };
    return committed instanceof Promise ? committed.then(finish) : finish(committed);
  }, [getMutationFailure, editingRef, pendingObjectEditRef, applyTransaction, propsRef, selectionRef, setSelection]);
  const showFailure = useCallback((failure: SpreadsheetCommandFailure) => {
    if (failure.code !== "NOT_MOUNTED" && failure.code !== "EDIT_CANCELLED") reportError(new Error(failure.message));
  }, [reportError]);
  const executeCommands = useCallback((commands: readonly SpreadsheetCommand[]): MaybePromise<SpreadsheetCommandResult> => {
    const result = run(commands, false);
    const finish = (value: SpreadsheetCommandResult) => { if (!value.ok) showFailure(value); return value; };
    return result instanceof Promise ? result.then(finish) : finish(result);
  }, [run, showFailure]);
  const executeCommand = useCallback((command: SpreadsheetCommand) => executeCommands([command]), [executeCommands]);
  // Synchronous execution never starts a host permission request; there is no deferred side effect.
  const externalBatch = useCallback((commands: readonly SpreadsheetCommand[]) => run(commands, true, true) as SpreadsheetCommandResult, [run]);
  const externalExecute = useCallback((command: SpreadsheetCommand) => externalBatch([command]), [externalBatch]);
  const externalBatchAsync = useCallback(async (commands: readonly SpreadsheetCommand[]) => run(commands, true), [run]);
  const externalExecuteAsync = useCallback((command: SpreadsheetCommand) => externalBatchAsync([command]), [externalBatchAsync]);
  const getWorkbook = useCallback(() => workbookRef.current, [workbookRef]);

  return { executeCommand, executeCommands, externalExecute, externalBatch, externalExecuteAsync, externalBatchAsync, getWorkbook };
}

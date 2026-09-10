"use client";

import { useCallback, type RefObject } from "react";
import type { MaybePromise } from "../core";
import type { SpreadsheetCommand, SpreadsheetCommandFailure, SpreadsheetCommandResult } from "../api/types";
import { stageSpreadsheetCommands } from "../commands/stage-spreadsheet-commands";
import { captureSpreadsheetCommands } from "../commands/capture-spreadsheet-commands";
import { resolveSpreadsheetFeatures } from "../api/resolve-features";
import type { DraftSelection } from "./types";
import type { useWorkbookDraft } from "./use-workbook-draft";
import type { DraftOperationOptions } from "./use-workbook-draft";

type CommandSession = DraftSelection & {
  editingRef: RefObject<unknown>;
  pendingObjectEditRef: RefObject<boolean>;
};
/** GUI adapters can guard captured editor/clipboard targets without bypassing command validation. */
export type SpreadsheetGuiCommandOptions = Readonly<{
  isCurrent?: () => boolean;
  allowSaveStarting?: boolean;
  allowPendingCellEdit?: boolean;
}>;

/** Shared command validation and one-transaction publication for GUI and imperative callers. */
export function useSpreadsheetCommands(draft: ReturnType<typeof useWorkbookDraft>, session: CommandSession) {
  const { workbookRef, propsRef, applyTransaction, getMutationFailure, reportError } = draft;
  const { selectionRef, setSelection, editingRef, pendingObjectEditRef } = session;
  const run = useCallback((commands: readonly SpreadsheetCommand[], external: boolean, synchronous = false,
    contextMenu?: Pick<DraftOperationOptions, "mutationOwner" | "isCurrent">,
    gui?: SpreadsheetGuiCommandOptions): MaybePromise<SpreadsheetCommandResult> => {
    const unavailable = getMutationFailure(gui?.allowSaveStarting, contextMenu?.mutationOwner);
    if (unavailable) return unavailable;
    const guarded = external || !!contextMenu || !!gui?.isCurrent;
    const editorAvailable = () => (gui?.allowPendingCellEdit || !editingRef.current) && !pendingObjectEditRef.current;
    if (guarded && !editorAvailable())
      return { ok: false, code: "PENDING_EDIT", message: "編集中の内容を確定してから操作してください" };
    const capture = captureSpreadsheetCommands(commands);
    if (!capture.ok) return capture;
    const captured = capture.commands;
    const sheetIds = new Set(captured.flatMap(command => command && typeof command === "object" && "sheetId" in command && typeof command.sheetId === "string" ? [command.sheetId] : []));
    const sheetId = sheetIds.size === 1 ? [...sheetIds][0] : undefined;
    const attempt: { staged?: ReturnType<typeof stageSpreadsheetCommands> } = {};
    const committed = applyTransaction(workbook => {
      const staged = stageSpreadsheetCommands(workbook, captured, resolveSpreadsheetFeatures(propsRef.current.features), () => crypto.randomUUID());
      attempt.staged = staged;
      return staged.ok && staged.changed ? staged.workbook : workbook;
    }, { selectionRef, setSelection }, { source: external ? "api" : "ui", synchronous,
      ...(gui?.allowSaveStarting ? { allowSaveStarting: true } : {}),
      ...(sheetId ? { sheetId } : {}),
      action: captured.length === 1 ? captured[0]?.type : "batch", commands: captured.map(command => command?.type),
      ...(contextMenu ? { mutationOwner: contextMenu.mutationOwner } : {}),
      ...(guarded ? { isCurrent: () => editorAvailable() && (!contextMenu?.isCurrent || contextMenu.isCurrent()) && (!gui?.isCurrent || gui.isCurrent()) } : {}) });
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
  const executeCommands = useCallback((commands: readonly SpreadsheetCommand[], options?: SpreadsheetGuiCommandOptions): MaybePromise<SpreadsheetCommandResult> => {
    const result = run(commands, false, false, undefined, options);
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
  const applyContextMenuCommands = useCallback((commands: readonly SpreadsheetCommand[], owner: object, isCurrent: () => boolean) =>
    run(commands, false, false, { mutationOwner: owner, isCurrent }), [run]);

  return { executeCommand, executeCommands, externalExecute, externalBatch, externalExecuteAsync, externalBatchAsync, getWorkbook, applyContextMenuCommands };
}

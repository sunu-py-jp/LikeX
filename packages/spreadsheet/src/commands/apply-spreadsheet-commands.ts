import type { SpreadsheetFeatures } from "../api/features";
import { resolveSpreadsheetFeatures } from "../api/resolve-features";
import { normalizeWorkbook } from "../model/workbook/normalize";
import type { SpreadsheetWorkbook } from "../model/types";
import { stageSpreadsheetCommands } from "./stage-spreadsheet-commands";
import type { SpreadsheetCommand, SpreadsheetCommandFailure, SpreadsheetCommandSuccess, SpreadsheetWorkbookSnapshot } from "./types";
import { commandKeys, commandRecord, rejectCommand, SpreadsheetCommandError } from "./validation";

export type SpreadsheetApplyCommandsOptions = Readonly<{
  /** Uses the same feature switches and parent switches as the component. Omitted features are enabled. */
  features?: SpreadsheetFeatures;
}>;

export type SpreadsheetApplyCommandsResult =
  | (SpreadsheetCommandSuccess & Readonly<{ workbook: SpreadsheetWorkbook }>)
  | SpreadsheetCommandFailure;

/**
 * Apply an ordered command batch to a validated copy, without mounting a component.
 * Failed batches return no partial workbook or receipts. Input objects are never mutated.
 * `changed` compares workbook content; even an unchanged result can contain a normalized copy.
 * Persistence, permissions, locking and event delivery remain the caller's responsibility.
 */
export function applySpreadsheetCommands(workbook: SpreadsheetWorkbookSnapshot, commands: readonly SpreadsheetCommand[],
  options?: SpreadsheetApplyCommandsOptions): SpreadsheetApplyCommandsResult {
  try {
    if (options !== undefined) {
      commandKeys(commandRecord(options, "コマンドの設定"), ["features"], "コマンドの設定");
      if (options.features !== undefined) {
        const features = commandRecord(options.features, "機能の設定");
        commandKeys(features, Object.keys(resolveSpreadsheetFeatures(undefined)), "機能の設定");
        if (Object.values(features).some(value => value !== undefined && typeof value !== "boolean"))
          rejectCommand("INVALID_COMMAND", "機能の設定はtrueまたはfalseで指定してください");
      }
    }
    if (workbook === undefined) return rejectCommand("VALIDATION_FAILED", "操作するブックを指定してください");
    // The model boundary validates/copies every field, including deeply readonly snapshots and parsed JSON.
    const normalized = normalizeWorkbook(workbook as SpreadsheetWorkbook);
    return stageSpreadsheetCommands(normalized, commands, resolveSpreadsheetFeatures(options?.features), () => crypto.randomUUID());
  } catch (cause) {
    return Object.freeze({ ok: false, code: cause instanceof SpreadsheetCommandError ? cause.code : "VALIDATION_FAILED",
      message: cause instanceof Error ? cause.message : "コマンドを実行できませんでした" });
  }
}

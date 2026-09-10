import { MAX_SPREADSHEET_COMMANDS } from "./stage-spreadsheet-commands";
import type { SpreadsheetCommand, SpreadsheetCommandFailure } from "./types";

type CapturedCommands = Readonly<{ ok: true; commands: readonly SpreadsheetCommand[] }> | SpreadsheetCommandFailure;

/** Bound work before copying caller data. Semantic command validation remains in the shared dispatcher. */
export function captureSpreadsheetCommands(input: readonly SpreadsheetCommand[]): CapturedCommands {
  if (!Array.isArray(input)) return Object.freeze({ ok: false, code: "INVALID_COMMAND", message: "コマンドを配列で指定してください" });
  if (input.length > MAX_SPREADSHEET_COMMANDS)
    return Object.freeze({ ok: false, code: "VALIDATION_FAILED", message: "一度に実行できるコマンドは1,000件までです" });
  try { return Object.freeze({ ok: true, commands: structuredClone(input) }); }
  catch { return Object.freeze({ ok: false, code: "INVALID_COMMAND", message: "コマンドはシリアライズ可能なデータで指定してください" }); }
}

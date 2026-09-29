import { createHash } from "node:crypto";
import { AIToolError } from "./tool-errors.ts";

export const NO_CHANGE_STOP_AFTER = 3;
export interface NoChangeNotice {
  code: "no_change" | "empty_patch";
  repeatCount: number;
  stopAfter: number;
  message: string;
}

/** This error terminates the run; it must not become a retryable tool failure. */
export class AIRepetitionError extends AIToolError {
  constructor() {
    super(`同じ変更のない編集が${NO_CHANGE_STOP_AFTER}回繰り返されたため、処理を停止しました。今回の編集内容は反映していません。`, {
      code: "repeated_no_change",
      path: "commands",
      actual: { repeatCount: NO_CHANGE_STOP_AFTER, stopAfter: NO_CHANGE_STOP_AFTER },
    });
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

function emptyPatches(commands: unknown): boolean {
  return Array.isArray(commands) && commands.length > 0 && commands.every(command => {
    if (!command || typeof command !== "object" || Array.isArray(command)) return false;
    const patch = command.patch;
    return !!patch && typeof patch === "object" && !Array.isArray(patch) && Object.keys(patch).length === 0;
  });
}

/** A workspace is the only writer. Real mutations advance its revision and reset all fingerprints. */
export class NoChangeTracker {
  private readonly repeats = new Map<string, number>();

  observe(operation: string, commands: unknown, dryRun: unknown, result: unknown): unknown {
    if (dryRun || !result || typeof result !== "object" || !("changed" in result)) return result;
    if (result.changed === true) {
      this.repeats.clear();
      return result;
    }
    if (operation !== "apply" || result.changed !== false) return result;
    // Inputs have already passed strict-null normalization and the native command schema.
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical(commands))).digest("hex");
    const repeatCount = (this.repeats.get(fingerprint) ?? 0) + 1;
    this.repeats.set(fingerprint, repeatCount);
    if (repeatCount >= NO_CHANGE_STOP_AFTER) throw new AIRepetitionError();
    const code = emptyPatches(commands) ? "empty_patch" : "no_change";
    const noChange: NoChangeNotice = {
      code, repeatCount, stopAfter: NO_CHANGE_STOP_AFTER,
      message: `${code === "empty_patch" ? "変更する項目が空です。" : "指定内容は既存の状態と同じため、変更はありません。"}同じ操作の再送は不要です。依頼が満たされていれば必要な画像確認・失敗修復を終えて完了し、未完了なら実際に必要な別の編集を行ってください。同じ文書状態で同じ編集を${NO_CHANGE_STOP_AFTER}回繰り返すと処理を停止します。`,
    };
    return { ...result, noChange };
  }
}

export function noChangeInstructions(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("noChange" in result)) return undefined;
  const notice = result.noChange as NoChangeNotice | undefined;
  if (!notice || !["no_change", "empty_patch"].includes(notice.code)) return undefined;
  return `The preceding edit made no document change (${notice.code}). Do not resend that operation. It has occurred ${notice.repeatCount} time(s) in this document revision; the third identical no-change edit terminates the run without applying staged changes. If the request is satisfied, complete any outstanding failure repairs and current slide previews, then finish. Otherwise perform only a different edit needed by the request. A no-change result does not resolve unrelated failed writes or waive required previews. Do not repeat reads or previews merely to reset this guard; only an actual document change resets it.`;
}

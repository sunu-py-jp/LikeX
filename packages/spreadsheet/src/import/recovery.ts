import type { ImportContext } from "./types";

/** Optional feature recovery must never turn cancellation or archive failures into success. */
export function rethrowImportFailure(error: unknown, context: Pick<ImportContext, "signal">): void {
  context.signal?.throwIfAborted();
  if (error instanceof Error && (error.name === "AbortError" || /^(?:Office|Excel)ファイルを読み込めません:/.test(error.message) ||
    /Officeの参照(?:先がパッケージ外|パスが不正)/.test(error.message))) throw error;
}

export function importFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "データが正しくありません";
}

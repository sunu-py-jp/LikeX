import type { AIModule, AIResult } from "./ai-client";

export type DocumentSnapshot = { document: string; documentTitle?: string; revision: number; selection?: unknown };
export type DocumentAdapter = {
  module: AIModule;
  label: string;
  suggestions: readonly string[];
  snapshot(signal: AbortSignal): Promise<DocumentSnapshot>;
  readCurrent(): Pick<DocumentSnapshot, "document" | "revision">;
  normalize(document: string): string;
  apply(document: string, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
};

export function assertDocumentCurrent(adapter: DocumentAdapter, snapshot: DocumentSnapshot, signal: AbortSignal, isActive: () => boolean) {
  signal.throwIfAborted();
  if (!isActive()) throw new DOMException("AIの操作を中止しました。", "AbortError");
  const current = adapter.readCurrent();
  if (current.revision !== snapshot.revision || current.document !== snapshot.document)
    throw new Error("送信後に資料が変更されたため、AIの編集は反映していません。最新の内容で再送信してください。");
}

export async function applyAIResult(adapter: DocumentAdapter, snapshot: DocumentSnapshot, result: AIResult, signal: AbortSignal, isActive: () => boolean): Promise<boolean> {
  const assertCurrent = () => assertDocumentCurrent(adapter, snapshot, signal, isActive);
  assertCurrent();
  const document = adapter.normalize(result.document);
  // The actual document determines whether there is an edit, not the model's claim.
  if (document === snapshot.document) return false;
  assertCurrent();
  await adapter.apply(document, signal, assertCurrent);
  if (adapter.readCurrent().document !== document) throw new Error("AIの編集を反映できませんでした。資料の状態を確認してください。");
  return true;
}

/** Slide checks this text loader after its pending operations and permission await. */
export class GuardedDocumentBlob extends Blob {
  constructor(private readonly documentText: string, private readonly assertCurrent: () => void) {
    super([documentText], { type: "application/json" });
  }
  override async text(): Promise<string> {
    this.assertCurrent();
    return this.documentText;
  }
}

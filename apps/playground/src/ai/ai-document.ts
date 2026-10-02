import type { AIModule, AIResult } from "./ai-client";
import type { AILiveDocumentRequest, AILiveDocumentResult } from "../../build/ai/protocol";

export type DocumentSnapshot = { document: string; documentTitle?: string; revision: number; selection?: unknown };
export type DocumentAdapter = {
  module: AIModule;
  label: string;
  suggestions: readonly (string | { label: string; prompt: string })[];
  /** Host-owned starter content; opening it never sends a request automatically. */
  introduction?: { title: string; description: string };
  initialChatOpen?: boolean;
  snapshot(signal: AbortSignal): Promise<DocumentSnapshot>;
  readCurrent(): Pick<DocumentSnapshot, "document" | "revision">;
  normalize(document: string): string;
  apply(document: string, signal: AbortSignal, assertCurrent: () => void): Promise<void>;
  /** Each commit uses the public editor transaction, including permissions and Undo. */
  live(request: AILiveDocumentRequest, signal: AbortSignal): Promise<AILiveDocumentResult>;
};

export class LiveDocumentError extends Error {
  constructor(readonly code: string, message: string, readonly conflicts?: unknown) { super(message); }
}

/** Stop waiting without cancelling a pre-existing user operation owned by the editor. */
export function awaitDocumentRead<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? new DOMException("操作を中止しました。", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(value => { signal.removeEventListener("abort", abort); if (!signal.aborted) resolve(value); }, error => {
      signal.removeEventListener("abort", abort); reject(error);
    });
  });
}

export function assertLiveDocumentSize(document: string) {
  if (new TextEncoder().encode(document).byteLength > 8 * 1024 * 1024)
    throw new LiveDocumentError("write_failed", "編集後の資料がAIデモの8 MiB上限を超えるため適用していません。画像やデータ量を減らしてください。");
}

export function mutationToken(text: string): { sessionId: string; structureRevision: number } {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new LiveDocumentError("invalid_request", "編集元の情報を読み取れません。"); }
  if (!value || typeof value !== "object" || !("sessionId" in value) || typeof value.sessionId !== "string" ||
    !("structureRevision" in value) || !Number.isSafeInteger(value.structureRevision) || (value.structureRevision as number) < 0)
    throw new LiveDocumentError("invalid_request", "編集元の情報が正しくありません。");
  return { sessionId: value.sessionId, structureRevision: value.structureRevision as number };
}

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

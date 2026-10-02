import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AIError } from "./provider.ts";
import { AIToolError } from "./tool-errors.ts";
import type { AILiveDocumentEvent, AILiveDocumentRequest, AILiveDocumentResult } from "./protocol.ts";

const DOCUMENT_LIMIT = 8 * 1024 * 1024;
// A native 8 MiB JSON document is itself JSON-escaped once in this envelope.
export const LIVE_DOCUMENT_BODY_LIMIT = 18 * 1024 * 1024;
type Pending = { token: string; expiresAt: number; request: AILiveDocumentRequest; resolve(value: AILiveDocumentResult): void; reject(reason: unknown): void };
type Receipt = { token: string; hash: string; expiresAt: number };

/** An uncertain acknowledgement must stop the run; retrying can duplicate an already-applied edit. */
export class AILiveDocumentUnavailable extends AIError {}

function credential(left: string, right: unknown): boolean {
  return typeof right === "string" && /^[0-9a-f]{64}$/.test(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/** One-use, run-bound rendezvous; writes happen only in the host's conditional model API. */
export class LiveDocumentBroker {
  private readonly pending = new Map<string, Pending>();
  private readonly receipts = new Map<string, Receipt>();
  constructor(private readonly timeoutMs = 30_000) {}

  request(request: AILiveDocumentRequest, signal: AbortSignal, emit: (event: AILiveDocumentEvent) => void): Promise<AILiveDocumentResult> {
    signal.throwIfAborted();
    if (this.pending.size >= 2) throw new AILiveDocumentUnavailable("資料との同期処理が混み合っています。反映済みの編集は保持されています。");
    const id = randomUUID(), token = randomBytes(32).toString("hex"), expiresAt = Date.now() + this.timeoutMs;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.pending.delete(id); };
      const settle = (reason: unknown) => { cleanup(); reject(reason); };
      const abort = () => settle(signal.reason ?? new AILiveDocumentUnavailable("同期を中止しました。反映済みの編集は保持されています。"));
      const timer = setTimeout(() => settle(new AILiveDocumentUnavailable("資料への反映結果を時間内に確認できませんでした。処理を停止しました。画面に反映済みの編集は保持されています。")), this.timeoutMs);
      this.pending.set(id, { token, expiresAt, request, resolve: value => { cleanup(); resolve(value); }, reject: settle });
      signal.addEventListener("abort", abort, { once: true });
      try { emit({ type: "document", id, token, expiresAt, ...request }); }
      catch (error) { settle(error); }
    });
  }

  complete(id: string, body: unknown): boolean {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const value = body as Record<string, unknown>, pending = this.pending.get(id);
    const hash = () => createHash("sha256").update(JSON.stringify(body)).digest("hex");
    if (!pending) {
      const receipt = this.receipts.get(id);
      return !!receipt && receipt.expiresAt >= Date.now() && credential(receipt.token, value.token) && receipt.hash === hash();
    }
    if (!credential(pending.token, value.token)) return false;
    if (pending.expiresAt < Date.now()) {
      pending.reject(new AILiveDocumentUnavailable("資料への反映結果の確認期限が切れました。反映済みの編集は保持されています。"));
      return false;
    }
    if (Object.keys(value).some(key => !["token", "result", "error"].includes(key)) || (value.result === undefined) === (value.error === undefined))
      throw new AIError("資料の同期応答の形式が正しくありません。");
    let result: AILiveDocumentResult | undefined, error: AIError | undefined;
    if (value.error !== undefined) {
      if (!value.error || typeof value.error !== "object" || Array.isArray(value.error)) throw new AIError("同期エラーの形式が正しくありません。");
      const detail = value.error as Record<string, unknown>;
      if (Object.keys(detail).some(key => !["code", "message", "conflicts"].includes(key)) ||
        typeof detail.code !== "string" || !/^[a-z_]{1,80}$/.test(detail.code) || typeof detail.message !== "string" || !detail.message || detail.message.length > 2000 ||
        detail.conflicts !== undefined && (!Array.isArray(detail.conflicts) || detail.conflicts.length > 100 || JSON.stringify(detail.conflicts).length > 32000))
        throw new AIError("同期エラーの形式が正しくありません。");
      error = detail.code === "conflict" ? new AIToolError(detail.message, { code: "conflict", conflicts: detail.conflicts as unknown[] | undefined,
        retry: "The entire batch was rejected without applying it. Inspect the affected targets again, reconsider the user's request against current data, then submit a corrected batch using the new read revision." })
        : ["invalid_argument", "invalid_command", "invalid_target", "write_failed", "validation_failed", "unknown_id"].includes(detail.code)
          ? new AIToolError(detail.message, { code: detail.code }) : new AILiveDocumentUnavailable(detail.message);
    } else {
      const candidate = value.result as AILiveDocumentResult;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || Object.keys(candidate).some(key => !["targetId", "document", "token", "changed", "receipts"].includes(key)) ||
        candidate.targetId !== pending.request.targetId || typeof candidate.document !== "string" || Buffer.byteLength(candidate.document) > DOCUMENT_LIMIT ||
        typeof candidate.token !== "string" || !candidate.token || candidate.token.length > 1000 ||
        candidate.receipts !== undefined && Buffer.byteLength(JSON.stringify(candidate.receipts)) > 1024 * 1024 ||
        candidate.changed !== undefined && typeof candidate.changed !== "boolean" || pending.request.action === "commit" && typeof candidate.changed !== "boolean")
        throw new AIError("資料の同期結果・対象が正しくありません。");
      result = { targetId: candidate.targetId, document: candidate.document, token: candidate.token, ...(candidate.changed === undefined ? {} : { changed: candidate.changed }),
        ...(candidate.receipts === undefined ? {} : { receipts: candidate.receipts }) };
    }
    for (const [key, receipt] of this.receipts) if (receipt.expiresAt < Date.now()) this.receipts.delete(key);
    if (this.receipts.size >= 128) this.receipts.delete(this.receipts.keys().next().value!);
    this.receipts.set(id, { token: pending.token, hash: hash(), expiresAt: Date.now() + 60_000 });
    if (error) pending.reject(error); else pending.resolve(result!);
    return true;
  }
}

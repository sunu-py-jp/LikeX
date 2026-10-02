import type { AILiveDocumentEvent, AILiveDocumentRequest, AILiveDocumentResult, AILiveDocumentError, AIJSONValue } from "../../build/ai/protocol";
import { LiveDocumentError } from "./ai-document";

export type LiveDocumentHandler = (request: AILiveDocumentRequest, signal: AbortSignal) => Promise<AILiveDocumentResult>;

function conflictDetails(input: unknown[]): AIJSONValue[] {
  const result: AIJSONValue[] = [];
  let bytes = 0;
  for (const conflict of input.slice(0, 100)) {
    const text = JSON.stringify(conflict, (_key, value) => typeof value === "string" && value.length > 1000 ? `${value.slice(0, 1000)}…` : value);
    if (!text || text.length > 8000 || bytes + text.length > 28000) break;
    result.push(JSON.parse(text) as AIJSONValue); bytes += text.length;
  }
  return result;
}

/** One request owns the deduplication map. Retrying transport never executes a mutation twice. */
export function createLiveDocumentResponder(targetId: string, handle: LiveDocumentHandler, fetcher: typeof fetch = fetch, cacheBytes = 32 * 1024 * 1024) {
  const replies = new Map<string, { request: string; body: Promise<string>; bytes: number }>(), seen = new Set<string>();
  let retained = 0;
  return async (event: AILiveDocumentEvent, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (event.targetId !== targetId) throw new Error("編集する資料が変わったため、AIの操作を停止しました。");
    const request = JSON.stringify(event);
    let cached = replies.get(event.id);
    if (cached && cached.request !== request) throw new Error("編集要求の識別子が重複しています。");
    if (!cached) {
      if (seen.has(event.id)) throw new Error("古い編集要求の再送を受信したため処理を停止しました。反映済みの変更は残っています。");
      if (seen.size >= 512) throw new Error("資料の同期回数が多すぎるため処理を停止しました。");
      seen.add(event.id);
      const body = (async () => {
        const controller = new AbortController(), abort = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        const remaining = event.expiresAt - Date.now();
        if (remaining <= 0 || signal.aborted) controller.abort(signal.reason ?? new Error("編集要求の期限が切れました。"));
        const timer = setTimeout(() => controller.abort(new Error("編集要求の期限が切れました。")), Math.max(0, remaining));
        try {
          controller.signal.throwIfAborted();
          const result = await handle(event, controller.signal);
          if (result.targetId !== targetId) throw new LiveDocumentError("target_changed", "資料の対象が一致しません。");
          return JSON.stringify({ token: event.token, result });
        } catch (cause) {
          const error: AILiveDocumentError = { code: cause instanceof LiveDocumentError ? cause.code : "editor_unavailable",
            message: cause instanceof Error ? cause.message : "資料を操作できませんでした。" };
          if (cause instanceof LiveDocumentError && Array.isArray(cause.conflicts))
            error.conflicts = conflictDetails(cause.conflicts);
          return JSON.stringify({ token: event.token, error });
        } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
      })();
      cached = { request, body, bytes: request.length * 2 }; replies.set(event.id, cached); retained += cached.bytes;
    }
    const body = await cached.body;
    const bytes = (request.length + body.length) * 2;
    retained += bytes - cached.bytes; cached.bytes = bytes;
    while (replies.size > 16 || retained > cacheBytes) {
      const key = replies.keys().next().value;
      if (key === undefined) break;
      retained -= replies.get(key)!.bytes; replies.delete(key);
    }
    signal.throwIfAborted();
    // If an acknowledgement is lost, stop the run. A future run re-reads the live document.
    const response = await fetcher(`/api/ai/documents/${event.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
    if (!response.ok) throw new Error("AIとの編集結果の同期に失敗しました。反映済みの変更は残っています。最新の状態を確認してください。");
  };
}

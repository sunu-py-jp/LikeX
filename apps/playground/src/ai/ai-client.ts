import { RUN_ID_PATTERN } from "../../build/ai/protocol";
import type { AIJSONValue, AIToolCall, AITruncation, AIPreviewEvent, AILiveDocumentEvent } from "../../build/ai/protocol";
import { createLiveDocumentResponder, type LiveDocumentHandler } from "./live-document";
export type { AIJSONValue, AIToolCall, AITruncation } from "../../build/ai/protocol";

export type AIModule = "spreadsheet" | "slide";
export type AIConfig = { configured: boolean; provider: string; model: string; missing?: string[] };
export type AIMessage = { role: "user" | "assistant"; content: string };
export type AIRequest = { module: AIModule; document: string; documentTitle?: string; messages: AIMessage[]; selection?: unknown; targetId?: string };
export type AIResult = { type: "result"; document: string; changed: boolean };
export type AIStreamEvent = { type: "progress"; message: string } | { type: "text"; text: string } | AIResult | { type: "run"; id: string } | { type: "tool"; call: AIToolCall };
type AITransportEvent = AIStreamEvent | AIPreviewEvent | AILiveDocumentEvent;
const RESPONSE_LIMIT = 64 * 1024 * 1024;
const TRANSPORT_RECORD_LIMIT = 20 * 1024 * 1024;

/** Keep the transcript in the UI while sending only bounded recent context. */
export function recentAIMessages(messages: readonly AIMessage[]): AIMessage[] {
  const recent: AIMessage[] = [];
  for (let index = messages.length - 1; index >= 0 && recent.length < 20; index--) {
    const candidate = messages[index];
    if (candidate.role === "assistant" && !candidate.content.trim()) continue;
    if (candidate.content.length > 16_000 || JSON.stringify([candidate, ...recent]).length > 60_000) {
      if (recent.length === 0) throw new Error("メッセージが長すぎます。内容を短くして送信してください。");
      break;
    }
    recent.unshift(candidate);
  }
  return recent;
}

export async function fetchAIConfig(signal: AbortSignal): Promise<AIConfig> {
  const response = await fetch("/api/ai/config", { signal });
  if (!response.ok) throw new Error("AIの設定を取得できませんでした。開発サーバーを確認してください。");
  const value = await response.json();
  if (!value || typeof value.configured !== "boolean" || typeof value.provider !== "string" || typeof value.model !== "string")
    throw new Error("AIの設定応答が正しくありません。");
  return { configured: value.configured, provider: value.provider, model: value.model,
    ...(Array.isArray(value.missing) && value.missing.every((item: unknown) => typeof item === "string") ? { missing: value.missing } : {}) };
}

function jsonValue(value: unknown, depth = 0): value is AIJSONValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= 128 || !value || typeof value !== "object") return false;
  return (Array.isArray(value) ? value : Object.values(value)).every(item => jsonValue(item, depth + 1));
}

function truncation(value: unknown): value is AITruncation | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || !("originalBytes" in value) || !("storedBytes" in value)) return false;
  return typeof value.originalBytes === "number" && typeof value.storedBytes === "number" && Number.isSafeInteger(value.originalBytes) && Number.isSafeInteger(value.storedBytes) && value.originalBytes > value.storedBytes && value.storedBytes >= 0;
}

function toolCall(value: unknown): AIToolCall {
  const invalid = () => new Error("AIのツール実行記録の形式が正しくありません。");
  if (!value || typeof value !== "object") throw invalid();
  const call = value as AIToolCall;
  const timestamp = (text: unknown) => typeof text === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) && Number.isFinite(Date.parse(text));
  if (typeof call.id !== "string" || !call.id || call.id.length > 200 || typeof call.name !== "string" || !call.name || call.name.length > 200 ||
    !["running", "complete", "error"].includes(call.status) || !jsonValue(call.input) || call.output !== undefined && !jsonValue(call.output) ||
    call.error !== undefined && typeof call.error !== "string" || !timestamp(call.startedAt) || call.finishedAt !== undefined && !timestamp(call.finishedAt) ||
    call.status !== "running" && !call.finishedAt || !truncation(call.inputTruncated) || !truncation(call.outputTruncated)) throw invalid();
  return { id: call.id, name: call.name, status: call.status, input: call.input, startedAt: call.startedAt,
    ...(call.output !== undefined ? { output: call.output } : {}), ...(call.error !== undefined ? { error: call.error } : {}),
    ...(call.finishedAt ? { finishedAt: call.finishedAt } : {}), ...(call.inputTruncated ? { inputTruncated: call.inputTruncated } : {}), ...(call.outputTruncated ? { outputTruncated: call.outputTruncated } : {}) };
}

function parseEvent(line: string): AITransportEvent {
  let value: unknown;
  try { value = JSON.parse(line); } catch { throw new Error("AIの応答が途中で途切れたか、形式が正しくありません。"); }
  if (!value || typeof value !== "object" || !("type" in value)) throw new Error("AIの応答形式が正しくありません。");
  if (value.type === "error" && "message" in value && typeof value.message === "string") throw new Error(value.message);
  if (value.type === "progress" && "message" in value && typeof value.message === "string") return { type: "progress", message: value.message };
  if (value.type === "text" && "text" in value && typeof value.text === "string") return { type: "text", text: value.text };
  if (value.type === "run" && "id" in value && typeof value.id === "string" && RUN_ID_PATTERN.test(value.id)) return { type: "run", id: value.id };
  if (value.type === "tool" && "call" in value) return { type: "tool", call: toolCall(value.call) };
  if (value.type === "document") {
    const event = value as AILiveDocumentEvent;
    const invalid = () => new Error("AIの編集要求の形式が正しくありません。");
    if (typeof event.id !== "string" || !RUN_ID_PATTERN.test(event.id) || typeof event.token !== "string" || !/^[0-9a-f]{64}$/.test(event.token) ||
      typeof event.targetId !== "string" || !event.targetId || event.targetId.length > 200 || !Number.isSafeInteger(event.expiresAt) || event.expiresAt <= 0) throw invalid();
    if (event.action === "snapshot") return { type: "document", id: event.id, token: event.token, expiresAt: event.expiresAt, targetId: event.targetId, action: "snapshot" };
    if (event.action !== "commit" || !event.expected || typeof event.expected.document !== "string" ||
      new TextEncoder().encode(event.expected.document).byteLength > 8 * 1024 * 1024 || typeof event.expected.token !== "string" || event.expected.token.length > 2000 ||
      !["document", "targets"].includes(event.expected.scope) ||
      !["apply", "create"].includes(event.operation) || !Array.isArray(event.commands) || event.commands.length > 1000 || !jsonValue(event.commands)) throw invalid();
    return { type: "document", id: event.id, token: event.token, expiresAt: event.expiresAt, targetId: event.targetId, action: "commit",
      operation: event.operation, expected: { document: event.expected.document, token: event.expected.token, scope: event.expected.scope }, commands: event.commands };
  }
  if (value.type === "preview") {
    const preview = value as AIPreviewEvent;
    if (typeof preview.id !== "string" || !RUN_ID_PATTERN.test(preview.id) || typeof preview.token !== "string" || !/^[0-9a-f]{64}$/.test(preview.token) ||
      typeof preview.document !== "string" || new TextEncoder().encode(preview.document).byteLength > 8 * 1024 * 1024 ||
      typeof preview.slideId !== "string" || !preview.slideId || preview.slideId.length > 200) throw new Error("AIのプレビュー要求の形式が正しくありません。");
    return { type: "preview", id: preview.id, token: preview.token, document: preview.document, slideId: preview.slideId };
  }
  if (value.type === "result" && "document" in value && typeof value.document === "string" && "changed" in value && typeof value.changed === "boolean")
    return { type: "result", document: value.document, changed: value.changed };
  throw new Error("AIの応答形式が正しくありません。");
}

/** A result is usable only after a clean EOF, never from a truncated stream. */
export async function* readAIResponse(response: Response, signal: AbortSignal): AsyncGenerator<AITransportEvent> {
  signal.throwIfAborted();
  if (!response.ok) {
    let message = `AIへの接続に失敗しました（${response.status}）。`;
    try { const value = await response.json(); if (typeof value?.error === "string") message = value.error; else if (typeof value?.message === "string") message = value.message; } catch { /* Keep the HTTP error. */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("AIの応答がありません。");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  let pending = "", bytes = 0, records = 0, result: AIResult | undefined;
  function accept(line: string) {
    if (!line.trim()) return;
    const size = new TextEncoder().encode(line).byteLength;
    if (++records > 2000 || size > TRANSPORT_RECORD_LIMIT) throw new Error("AIの応答が大きすぎます。");
    if (result) throw new Error("AIの完了通知の後に余分な応答を受信しました。");
    const event = parseEvent(line);
    // Document and preview frames carry repeated bounded snapshots, not growing
    // conversation context. Bound them per frame and by frame count instead.
    if (event.type !== "document" && event.type !== "preview") {
      bytes += size;
      if (bytes > RESPONSE_LIMIT) throw new Error("AIの応答が大きすぎます。");
    }
    if (event.type === "result") { result = event; return; }
    return event;
  }
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const event = accept(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (event) yield event;
      }
      if (pending.length > TRANSPORT_RECORD_LIMIT) throw new Error("AIの応答が大きすぎます。");
    }
    pending += decoder.decode();
    if (pending.trim()) { const event = accept(pending); if (event) yield event; }
    signal.throwIfAborted();
    if (!result) throw new Error("AIの応答が完了しなかったため、処理を停止しました。反映済みの変更は残っています。");
    yield result;
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function* requestAI(request: AIRequest, signal: AbortSignal, live?: LiveDocumentHandler): AsyncGenerator<AIStreamEvent> {
  const respond = live && request.targetId ? createLiveDocumentResponder(request.targetId, live) : undefined;
  const capabilities = { ...(request.module === "slide" ? { slidePreview: true } : {}), ...(respond ? { liveDocument: true } : {}) };
  const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ ...request, ...(Object.keys(capabilities).length ? { capabilities } : {}) }), signal });
  for await (const event of readAIResponse(response, signal)) {
    if (event.type === "document") {
      if (!respond) throw new Error("この画面はAIの逐次編集に対応していません。");
      await respond(event, signal); continue;
    }
    if (event.type !== "preview") { yield event; continue; }
    if (request.module !== "slide") throw new Error("この資料ではスライドのプレビューを生成できません。");
    const { respondToSlidePreview } = await import("./slide-preview");
    await respondToSlidePreview(event, signal);
  }
}

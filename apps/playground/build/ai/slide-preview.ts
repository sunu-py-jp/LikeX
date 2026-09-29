import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { AIError } from "./provider.ts";
import type { AIPreviewEvent, AIPreviewRequest, AIPreviewResult } from "./protocol.ts";

export const PREVIEW_BODY_LIMIT = 3 * 1024 * 1024;
const PNG_LIMIT = 2 * 1024 * 1024;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
type Pending = { token: string; slideId: string; width: number; height: number; resolve(value: AIPreviewResult): void; reject(reason: unknown): void };

/** Per-middleware rendezvous: a browser renders an immutable staged page, never the live editor. */
export class SlidePreviewBroker {
  private pending = new Map<string, Pending>();

  constructor(private readonly timeoutMs = 35_000) {}

  request(request: AIPreviewRequest, signal: AbortSignal, emit: (event: AIPreviewEvent) => void): Promise<AIPreviewResult> {
    signal.throwIfAborted();
    if (this.pending.size >= 2) throw new AIError("プレビューの処理中です。完了してから再試行してください。");
    let page: { width: number; height: number; slides: { id: string }[] };
    try { page = JSON.parse(request.document); }
    catch { throw new AIError("プレビューの資料を読み取れません。"); }
    if (!page || !Array.isArray(page.slides) || page.slides.length !== 1 || page.slides[0]?.id !== request.slideId ||
      !Number.isFinite(page.width) || page.width < 1 || page.width > 10000 || !Number.isFinite(page.height) || page.height < 1 || page.height > 10000 ||
      Buffer.byteLength(request.document) > 8 * 1024 * 1024) throw new AIError("プレビューには有効な1ページだけを指定してください。");
    const scale = Math.min(1, 1600 / page.width, 1600 / page.height);
    const width = Math.round(page.width * scale), height = Math.round(page.height * scale);
    if (!width || !height) throw new AIError("プレビューの画像寸法が小さすぎます。");
    const id = randomUUID(), token = randomBytes(32).toString("hex");
    return new Promise((resolve, reject) => {
      const abort = () => settle(signal.reason ?? new AIError("プレビューを中止しました。"));
      const timer = setTimeout(() => settle(new AIError("スライドのプレビューが時間内に完了しませんでした。画面の接続を確認して再試行してください。")), this.timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.pending.delete(id); };
      const settle = (reason: unknown) => { cleanup(); reject(reason); };
      this.pending.set(id, { token, slideId: request.slideId, width, height, resolve: value => { cleanup(); resolve(value); }, reject: settle });
      signal.addEventListener("abort", abort, { once: true });
      try { emit({ type: "preview", id, token, ...request }); }
      catch (error) { settle(error); }
    });
  }

  /** A wrong, expired or already consumed credential cannot complete another request. */
  complete(id: string, body: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending || !body || typeof body !== "object" || Array.isArray(body)) return false;
    const value = body as Record<string, unknown>;
    if (typeof value.token !== "string" || !/^[0-9a-f]{64}$/.test(value.token) ||
      !timingSafeEqual(Buffer.from(pending.token), Buffer.from(value.token))) return false;
    if (Object.keys(value).some(key => !["token", "result", "error"].includes(key)) || (value.result === undefined) === (value.error === undefined))
      throw new AIError("プレビュー応答の形式が正しくありません。");
    if (value.error !== undefined) {
      if (typeof value.error !== "string" || !value.error.trim() || value.error.length > 1000) throw new AIError("プレビューのエラー形式が正しくありません。");
      pending.reject(new AIError(`プレビューを描画できませんでした: ${value.error}`));
      return true;
    }
    const result = validatePreviewResult(value.result, pending.slideId);
    if (result.width !== pending.width || result.height !== pending.height) throw new AIError("プレビューの画像寸法が対象ページと一致しません。");
    pending.resolve(result);
    return true;
  }
}

export function validatePreviewResult(input: unknown, slideId: string): AIPreviewResult {
  const invalid = () => new AIError("プレビュー画像・寸法・診断の形式が正しくありません。");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid();
  const value = input as AIPreviewResult;
  if (Object.keys(value).some(key => !["imageUrl", "width", "height", "slideId", "diagnostics"].includes(key)) ||
    value.slideId !== slideId || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 1600 ||
    !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 1600 ||
    typeof value.imageUrl !== "string" || value.imageUrl.length > Math.ceil(PNG_LIMIT / 3) * 4 + 22 ||
    !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.imageUrl) ||
    !Array.isArray(value.diagnostics) || value.diagnostics.length > 200 || JSON.stringify(value.diagnostics).length > 64_000 ||
    value.diagnostics.some(diagnostic => !validDiagnostic(diagnostic))) throw invalid();
  const png = Buffer.from(value.imageUrl.slice(22), "base64");
  if (png.length < 33 || png.length > PNG_LIMIT || !png.subarray(0, 16).equals(PNG_HEADER) ||
    png.readUInt32BE(16) !== value.width || png.readUInt32BE(20) !== value.height) throw invalid();
  return { imageUrl: value.imageUrl, width: value.width, height: value.height, slideId, diagnostics: value.diagnostics };
}

function validDiagnostic(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const diagnostic = value as Record<string, unknown>;
  const metrics = ["measuredWidth", "availableWidth", "measuredHeight", "availableHeight"];
  if (Object.keys(diagnostic).some(key => !["code", "elementId", "message", ...metrics].includes(key)) ||
    !["text-overflow", "out-of-bounds"].includes(String(diagnostic.code)) || typeof diagnostic.elementId !== "string" ||
    !diagnostic.elementId || diagnostic.elementId.length > 200 || typeof diagnostic.message !== "string" || diagnostic.message.length > 1000) return false;
  return metrics.every(key => diagnostic[key] === undefined || typeof diagnostic[key] === "number" && Number.isFinite(diagnostic[key]) && diagnostic[key] >= 0);
}

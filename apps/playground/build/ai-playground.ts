import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "vite";
import type { Plugin } from "vite";
import { AIError, publicConfiguration, readConfiguration } from "./ai/provider.ts";
import type { AIConfiguration } from "./ai/provider.ts";
import { parseRequest, runAISession } from "./ai/session.ts";
import { readAIRunLog } from "./ai/run-log.ts";
import { RUN_ID_PATTERN } from "./ai/protocol.ts";
import type { AIInstructions } from "./ai/prompts.ts";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const BODY_LIMIT = 10 * 1024 * 1024;

export function localRequest(request: IncomingMessage, mutation: boolean) {
  const host = request.headers.host;
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
  const address = request.socket.remoteAddress;
  if (address && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) return false;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  return !mutation || typeof origin === "string";
}

async function readBody(request: IncomingMessage, signal: AbortSignal) {
  if (Number(request.headers["content-length"] ?? 0) > BODY_LIMIT) throw new AIError("リクエストが 10 MiB を超えています。");
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => request.destroy();
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of request) {
      signal.throwIfAborted();
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > BODY_LIMIT) throw new AIError("リクエストが 10 MiB を超えています。");
      chunks.push(buffer);
    }
    try { return parseRequest(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch (error) { if (error instanceof AIError) throw error; throw new AIError("JSON リクエストを読み取れませんでした。"); }
  } finally { signal.removeEventListener("abort", abort); }
}

export function createAIMiddleware(options: { repository: string; config: AIConfiguration; fetcher?: typeof fetch; timeoutMs?: number; instructions?: AIInstructions }) {
  let active = 0;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const pathname = request.url?.split("?")[0];
    const runPath = pathname?.startsWith("/api/ai/runs/");
    if (pathname !== "/api/ai/config" && pathname !== "/api/ai/chat" && !runPath) { next(); return; }
    const json = (status: number, body: unknown) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end(JSON.stringify(body));
    };
    if (!localRequest(request, pathname === "/api/ai/chat")) { json(403, { error: "この API は同じローカルデモ画面からのみ利用できます。" }); return; }
    if (runPath) {
      if (request.method !== "GET") { json(405, { error: "GET を使用してください。" }); return; }
      const id = pathname!.slice("/api/ai/runs/".length);
      if (!RUN_ID_PATTERN.test(id)) { json(400, { error: "実行ログの ID が不正です。" }); return; }
      try {
        const content = await readAIRunLog(options.repository, id);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        response.setHeader("Content-Disposition", `attachment; filename="likex-ai-${id}.jsonl"`);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.end(content);
      } catch { json(404, { error: "実行ログが見つからないか、読み込めませんでした。" }); }
      return;
    }
    if (pathname === "/api/ai/config") {
      if (request.method !== "GET") { json(405, { error: "GET を使用してください。" }); return; }
      json(200, publicConfiguration(options.config)); return;
    }
    if (request.method !== "POST") { json(405, { error: "POST を使用してください。" }); return; }
    if (!/^application\/json(?:;|$)/i.test(request.headers["content-type"] ?? "")) { json(415, { error: "Content-Type は application/json を指定してください。" }); return; }
    if (!options.config.configured) { json(503, { error: ".env に AI サービスを設定し、デモサーバーを再起動してください。" }); return; }
    if (active >= 2) { json(429, { error: "AI が処理中です。完了してから再試行してください。" }); return; }
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new AIError("AI の処理が時間切れになりました。依頼を分割して再試行してください。")), options.timeoutMs ?? 120_000);
    const aborted = () => controller.abort(new AIError("処理をキャンセルしました。"));
    const closed = () => { if (!response.writableEnded) aborted(); };
    request.once("aborted", aborted);
    response.once("close", closed);
    try {
      const body = await readBody(request, controller.signal);
      controller.signal.throwIfAborted();
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      await runAISession({ ...options, request: body, signal: controller.signal, emit: event => {
        controller.signal.throwIfAborted();
        if (!response.destroyed) response.write(JSON.stringify(event) + "\n");
      } });
    } catch (error) {
      if (!response.destroyed) {
        const reason = controller.signal.aborted ? controller.signal.reason : error;
        const message = reason instanceof AIError ? reason.message : "AI 処理を完了できませんでした。設定とランタイムを確認してください。";
        if (response.headersSent) response.write(JSON.stringify({ type: "error", message }) + "\n");
        else json(400, { error: message });
      }
    } finally {
      clearTimeout(timer);
      request.off("aborted", aborted);
      response.off("close", closed);
      if (!response.writableEnded && !response.destroyed) response.end();
      active--;
    }
  };
}

/** Development/preview host only: secrets and process execution never enter a client bundle. */
export function aiPlayground(options: { instructions?: AIInstructions } = {}): Plugin {
  let config: AIConfiguration;
  return {
    name: "likex-ai-playground",
    config(current) {
      const ignored = current.server?.watch?.ignored;
      return { server: { fs: { deny: [...(current.server?.fs?.deny ?? []), "**/.git/**", "**/.likex-ai/**", "**/*.{crt,pem,key,p12,pfx,cer,der}", "**/.npmrc", "**/.yarnrc.yml", "**/.env", "**/.env.*", "**/.env*"] },
        watch: { ignored: [...(Array.isArray(ignored) ? ignored : ignored ? [ignored] : []), "**/.likex-ai/**"] } } };
    },
    configResolved(resolved) {
      config = readConfiguration({ ...loadEnv(resolved.mode, repository, ""), ...loadEnv(resolved.mode, path.join(repository, "apps/playground"), ""), ...process.env });
    },
    configureServer(server) { server.middlewares.use(createAIMiddleware({ repository, config, ...options })); },
    configurePreviewServer(server) { server.middlewares.use(createAIMiddleware({ repository, config, ...options })); },
  };
}

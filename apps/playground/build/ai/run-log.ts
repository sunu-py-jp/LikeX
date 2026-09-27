import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AIError } from "./provider.ts";
import type { AIConfiguration } from "./provider.ts";
import type { AIModule } from "./tools.ts";
import { RUN_ID_PATTERN } from "./protocol.ts";
import type { AIJSONValue, AIToolCall, AITruncation } from "./protocol.ts";

const INPUT_LIMIT = 544 * 1024;
const STREAM_INPUT_LIMIT = 64 * 1024;
const LOG_OUTPUT_LIMIT = 128 * 1024;
const STREAM_OUTPUT_LIMIT = 40 * 1024;
export class AILogError extends AIError {}
const logFailure = () => new AILogError("AI の実行ログを保存できませんでした。リポジトリの .likex-ai/runs の書き込み権限と空き容量を確認してください。変更は適用していません。");

async function directory(repository: string, create: boolean) {
  let target = await realpath(repository);
  for (const part of [".likex-ai", "runs"]) {
    target = path.join(target, part);
    if (create) await mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid log directory");
  }
  return target;
}

function bounded(value: unknown, limit: number, redact: (text: string) => string): { value: AIJSONValue; truncated?: AITruncation } {
  const serialized = redact(JSON.stringify(value ?? null));
  const originalBytes = Buffer.byteLength(serialized);
  if (originalBytes <= limit) return { value: JSON.parse(serialized) };
  const prefix = (end: number) => {
    const last = serialized.charCodeAt(end - 1), next = serialized.charCodeAt(end);
    return serialized.slice(0, last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? end - 1 : end);
  };
  let low = 0, high = Math.min(serialized.length, limit);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const size = Buffer.byteLength(JSON.stringify({ truncated: true, preview: prefix(middle), originalBytes }));
    if (size <= limit) low = middle; else high = middle - 1;
  }
  const summary = { truncated: true, preview: prefix(low), originalBytes };
  return { value: summary, truncated: { originalBytes, storedBytes: Buffer.byteLength(JSON.stringify(summary)) } };
}

export class AIRunLog {
  private constructor(readonly id: string, private readonly handle: FileHandle, private readonly metadata: { module: AIModule; provider: string; model: string }, private readonly secret: string) {}
  private closed = false;
  redact(text: string) { return this.secret ? text.replaceAll(this.secret, "[redacted]") : text; }
  private redactJSON(text: string) { return this.secret ? text.replaceAll(JSON.stringify(this.secret).slice(1, -1), "[redacted]") : text; }

  static async create(repository: string, module: AIModule, config: AIConfiguration) {
    let handle: FileHandle | undefined;
    try {
      const target = await directory(repository, true), id = randomUUID();
      handle = await open(path.join(target, `${id}.jsonl`), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const log = new AIRunLog(id, handle, { module, provider: config.provider, model: config.model }, config.key);
      await log.write({ type: "run-start", id, startedAt: new Date().toISOString() });
      return log;
    } catch { await handle?.close().catch(() => {}); throw logFailure(); }
  }

  private async write(record: Record<string, unknown>) {
    try {
      if (this.closed) throw new Error("Log closed");
      await this.handle.writeFile(this.redactJSON(JSON.stringify({ runId: this.id, ...this.metadata, ...record })) + "\n");
      await this.handle.sync();
    } catch { throw logFailure(); }
  }

  async tool(call: Omit<AIToolCall, "input" | "output"> & { input: unknown; output?: unknown }, context: { source: "initial" | "model" | "final"; modelCallId?: string }): Promise<AIToolCall> {
    const input = bounded(call.input, INPUT_LIMIT, text => this.redactJSON(text));
    const visibleInput = bounded(call.input, STREAM_INPUT_LIMIT, text => this.redactJSON(text));
    const storedOutput = call.output === undefined ? undefined : bounded(call.output, LOG_OUTPUT_LIMIT, text => this.redactJSON(text));
    const visibleOutput = call.output === undefined ? undefined : bounded(call.output, STREAM_OUTPUT_LIMIT, text => this.redactJSON(text));
    const base: AIToolCall = { id: call.id, name: this.redact(call.name), status: call.status, input: input.value, startedAt: call.startedAt,
      ...(call.finishedAt ? { finishedAt: call.finishedAt } : {}), ...(call.error ? { error: this.redact(call.error) } : {}),
      ...(input.truncated ? { inputTruncated: input.truncated } : {}) };
    await this.write({ type: "tool", source: context.source, ...(context.modelCallId ? { modelCallId: context.modelCallId } : {}),
      call: { ...base, ...(storedOutput ? { output: storedOutput.value } : {}), ...(storedOutput?.truncated ? { outputTruncated: storedOutput.truncated } : {}) } });
    return { ...base, input: visibleInput.value, ...(visibleInput.truncated ? { inputTruncated: visibleInput.truncated } : {}),
      ...(visibleOutput ? { output: visibleOutput.value } : {}), ...(visibleOutput?.truncated ? { outputTruncated: visibleOutput.truncated } : {}) };
  }

  async finish(status: "completed" | "error" | "cancelled", error?: string) {
    await this.write({ type: "run-finish", status, finishedAt: new Date().toISOString(), ...(error ? { error: this.redact(error) } : {}) });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try { await this.handle.close(); } catch { throw logFailure(); }
  }
}

export async function readAIRunLog(repository: string, id: string): Promise<string> {
  if (!RUN_ID_PATTERN.test(id)) throw new AIError("実行ログの ID が不正です。");
  const target = await directory(repository, false);
  const handle = await open(path.join(target, `${id}.jsonl`), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new AIError("実行ログを読み込めませんでした。");
    const content = await handle.readFile("utf8");
    let first;
    try { first = JSON.parse(content.split("\n", 1)[0]); } catch { throw new AIError("実行ログを読み込めませんでした。"); }
    if (first?.type !== "run-start" || first.id !== id || first.runId !== id) throw new AIError("実行ログを読み込めませんでした。");
    return content;
  } finally { await handle.close(); }
}

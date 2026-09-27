import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({ stdin: { contents: `export * from './apps/playground/src/ai/ai-client.ts'; export * from './apps/playground/src/ai/ai-document.ts';`, resolveDir: root }, bundle: true, platform: "node", format: "esm", write: false });
const { readAIResponse, recentAIMessages, applyAIResult, GuardedDocumentBlob } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const encoder = new TextEncoder();
const result = document => ({ type: "result", document, changed: true });
const lines = (...events) => events.map(event => JSON.stringify(event)).join("\n") + "\n";
const collect = async response => Array.fromAsync(readAIResponse(response, new AbortController().signal));

test("NDJSON survives UTF-8 characters and JSON split at every byte boundary", async () => {
  const events = [{ type: "progress", message: "スキルを確認" }, { type: "text", text: "こんにちは ✨" }, result('{"title":"新しい資料"}')];
  const bytes = encoder.encode(lines(...events));
  const response = new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }));
  assert.deepEqual(await collect(response), events);
});

test("a complete final JSON record without newline is accepted", async () => {
  assert.deepEqual(await collect(new Response(JSON.stringify(result("{}")))), [result("{}")]);
});

test("completed-looking result is withheld until a clean EOF", async () => {
  let source;
  const response = new Response(new ReadableStream({ start(controller) { source = controller; controller.enqueue(encoder.encode(lines(result("{}")))); } }));
  const iterator = readAIResponse(response, new AbortController().signal);
  let settled = false;
  const next = iterator.next().then(value => { settled = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(settled, false);
  source.close();
  assert.deepEqual((await next).value, result("{}"));
  await iterator.return();
});

test("missing result and malformed trailing JSON cannot produce an applicable document", async () => {
  await assert.rejects(collect(new Response(lines({ type: "text", text: "編集しました" }))), /完了しなかった/);
  await assert.rejects(collect(new Response(lines({ type: "text", text: "編集しました" }) + '{"type":"res')), /途切れた/);
});

test("server error after a provisional result invalidates the stream", async () => {
  const seen = [];
  await assert.rejects(async () => { for await (const event of readAIResponse(new Response(lines(result("{}"), { type: "error", message: "失敗" })), new AbortController().signal)) seen.push(event); }, /余分な応答/);
  assert.deepEqual(seen, []);
});

test("error records and non-success HTTP responses surface useful errors", async () => {
  await assert.rejects(collect(new Response(lines({ type: "error", message: "APIキーが未設定です" }))), /APIキー/);
  await assert.rejects(collect(new Response(JSON.stringify({ error: "利用制限です" }), { status: 429 })), /利用制限/);
  await assert.rejects(collect(new Response("failure", { status: 502 })), /502/);
});

test("abort cancels an outstanding read even if the stream never sends another chunk", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const pending = Array.fromAsync(readAIResponse(response, controller.signal));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});

test("unknown record types and invalid result fields are rejected", async () => {
  for (const event of [{ type: "surprise" }, { type: "result", document: {}, changed: true }, { type: "result", document: "{}", changed: "true" }])
    await assert.rejects(collect(new Response(lines(event))), /応答形式/);
});

test("run and structured tool events preserve exact command inputs, results and error status", async () => {
  const id = "12345678-1234-4123-8123-123456789abc";
  const startedAt = "2026-09-27T00:00:00.000Z", finishedAt = "2026-09-27T00:00:01.000Z";
  const input = { operation: "apply", commands: [{ type: "cells.set", sheetId: "sheet-1", values: { A1: "✨原文\\n", A2: "=SUM(B1:B3)" } }] };
  const tool = { id: "tool-1", name: "run_script", status: "running", input, startedAt };
  const events = [{ type: "run", id }, { type: "tool", call: tool }, { type: "tool", call: { ...tool, status: "complete", output: { ok: true }, finishedAt } },
    { type: "tool", call: { ...tool, id: "tool-2", status: "error", error: "無効なコマンド", finishedAt } }, result("{}")];
  assert.deepEqual(await collect(new Response(lines(...events))), events);
});

test("malformed execution logs cannot enter the chat transcript", async () => {
  const startedAt = "2026-09-27T00:00:00.000Z";
  const tool = { id: "tool-1", name: "run_script", status: "running", input: {}, startedAt };
  await assert.rejects(collect(new Response(lines({ type: "run", id: "../.env" }))), /応答形式/);
  for (const call of [{ ...tool, status: "surprise" }, { ...tool, status: "complete" }, { ...tool, startedAt: "bad time" }, { ...tool, inputTruncated: { originalBytes: 1, storedBytes: 100 } }])
    await assert.rejects(collect(new Response(lines({ type: "tool", call }))), /実行記録の形式/);
});

function fixture() {
  let document = "original", revision = 1, applied = 0;
  const adapter = { module: "slide", label: "Slide", suggestions: [], snapshot: async () => ({ document, revision }), readCurrent: () => ({ document, revision }), normalize: value => value,
    async apply(value, signal, assertCurrent) { signal.throwIfAborted(); assertCurrent(); document = value; revision++; applied++; } };
  return { adapter, snapshot: { document, revision }, edit(value) { document = value; revision++; }, get applied() { return applied; } };
}

test("stale, closed and aborted requests never import their document", async () => {
  const stale = fixture(); stale.edit("manual edit");
  await assert.rejects(applyAIResult(stale.adapter, stale.snapshot, result("ai edit"), new AbortController().signal, () => true), /送信後に資料が変更/);
  const closed = fixture();
  await assert.rejects(applyAIResult(closed.adapter, closed.snapshot, result("ai edit"), new AbortController().signal, () => false), { name: "AbortError" });
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(applyAIResult(aborted.adapter, aborted.snapshot, result("ai edit"), controller.signal, () => true), { name: "AbortError" });
  assert.equal(stale.applied + closed.applied + aborted.applied, 0);
});

test("edit then undo to the same text still invalidates an older request revision", async () => {
  const value = fixture(); value.edit("temporary"); value.edit("original");
  await assert.rejects(applyAIResult(value.adapter, value.snapshot, result("ai edit"), new AbortController().signal, () => true), /送信後に資料が変更/);
});

test("actual result content determines changed status and verifies a successful import", async () => {
  const unchanged = fixture();
  assert.equal(await applyAIResult(unchanged.adapter, unchanged.snapshot, result("original"), new AbortController().signal, () => true), false);
  assert.equal(unchanged.applied, 0);
  const changed = fixture();
  assert.equal(await applyAIResult(changed.adapter, changed.snapshot, { ...result("edited"), changed: false }, new AbortController().signal, () => true), true);
  assert.equal(changed.applied, 1);
  const denied = fixture(); denied.adapter.apply = async () => {};
  await assert.rejects(applyAIResult(denied.adapter, denied.snapshot, result("edited"), new AbortController().signal, () => true), /反映できません/);
});

test("guarded Slide native payload rechecks cancellation when delayed importer reads it", async () => {
  const controller = new AbortController();
  const blob = new GuardedDocumentBlob("document", () => controller.signal.throwIfAborted());
  assert.equal(blob.size, 8);
  controller.abort();
  await assert.rejects(blob.text(), { name: "AbortError" });
});

test("long conversations retain recent context without exceeding server limits", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `message ${index}` }));
  messages.push({ role: "user", content: "最新の指示" });
  const recent = recentAIMessages(messages);
  assert.deepEqual(recent, messages.slice(-20));
  assert.equal(messages.length, 101);
  const bounded = recentAIMessages([{ role: "user", content: "x".repeat(50_000) }, { role: "assistant", content: "y".repeat(20_000) }, { role: "assistant", content: "" }, { role: "user", content: "最新の指示" }]);
  assert.equal(bounded.length, 1);
  assert.ok(JSON.stringify(bounded).length <= 60_000);
  assert.equal(bounded.at(-1).content, "最新の指示");
  assert.throws(() => recentAIMessages([{ role: "user", content: "x".repeat(16_001) }]), /メッセージが長すぎ/);
  const withinTotal = recentAIMessages(Array.from({ length: 10 }, () => ({ role: "user", content: "x".repeat(16_000) })));
  assert.equal(withinTotal.length, 3);
  assert.ok(JSON.stringify(withinTotal).length <= 60_000);
});

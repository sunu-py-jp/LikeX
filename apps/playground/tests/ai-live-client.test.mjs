import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({ stdin: { resolveDir: root, contents: `
  export { createLiveDocumentResponder } from './apps/playground/src/ai/live-document.ts';
  export { readAIResponse } from './apps/playground/src/ai/ai-client.ts';
` }, bundle: true, platform: "node", format: "esm", write: false });
const { createLiveDocumentResponder, readAIResponse } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const event = () => ({ type: "document", id: "12345678-1234-4123-8123-123456789abc", token: "a".repeat(64), expiresAt: Date.now() + 5000,
  targetId: "editor", action: "commit", operation: "apply", expected: { document: "{}", token: "snapshot", scope: "document" }, commands: [] });
const result = { targetId: "editor", document: "{}", token: "next", changed: true };

test("duplicate delivery and acknowledgement do not repeat live mutations", async () => {
  let calls = 0; const replies = [];
  const respond = createLiveDocumentResponder("editor", async () => { calls++; return result; }, async (_url, options) => {
    replies.push(JSON.parse(options.body)); return new Response("{}");
  });
  const request = event(), signal = new AbortController().signal;
  await respond(request, signal); await respond(request, signal);
  assert.equal(calls, 1); assert.deepEqual(replies[0], replies[1]);
});

test("wrong targets, expired requests and cancellation cannot mutate", async () => {
  let calls = 0; const replies = [];
  const respond = createLiveDocumentResponder("editor", async () => { calls++; return result; }, async (_url, options) => {
    replies.push(JSON.parse(options.body)); return new Response("{}");
  });
  const signal = new AbortController().signal;
  await assert.rejects(respond({ ...event(), targetId: "other" }, signal), /資料が変わった/);
  await respond({ ...event(), expiresAt: Date.now() - 1 }, signal);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(respond(event(), controller.signal), { name: "AbortError" });
  assert.equal(calls, 0); assert.equal(replies[0].error.code, "editor_unavailable");
});

test("lost acknowledgement stops with an explicit partial-commit message", async () => {
  let calls = 0;
  const respond = createLiveDocumentResponder("editor", async () => { calls++; return result; }, async () => new Response("", { status: 410 }));
  await assert.rejects(respond(event(), new AbortController().signal), /反映済みの変更は残って/);
  assert.equal(calls, 1);
});

test("an evicted duplicate is rejected rather than applied again", async () => {
  let calls = 0;
  const respond = createLiveDocumentResponder("editor", async () => { calls++; return result; }, async () => new Response("{}"), 1);
  const request = event(), signal = new AbortController().signal;
  await respond(request, signal);
  await assert.rejects(respond(request, signal), /古い編集要求/);
  assert.equal(calls, 1);
});

const encoder = new TextEncoder();
const finalFrame = encoder.encode(JSON.stringify({ type: "result", document: "{}", changed: false }) + "\n");
/** Reuse bounded encoded frames and pull one at a time; never accumulate the full transport in the test. */
function repeatedFrames(frames, count) {
  let cursor = 0, cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (cursor < count) controller.enqueue(frames[cursor++ % frames.length]);
      else if (cursor++ === count) controller.enqueue(finalFrame);
      else controller.close();
    },
    cancel() { cancelled = true; },
  }));
  return { response, get cancelled() { return cancelled; } };
}

test("repeated valid document and preview snapshots can each exceed 64 MiB cumulatively", async () => {
  const document = JSON.stringify({ note: "x".repeat(1024 * 1024) });
  const commit = encoder.encode(JSON.stringify({ ...event(), expected: { document, token: "snapshot", scope: "document" } }) + "\n");
  const preview = encoder.encode(JSON.stringify({ type: "preview", id: event().id, token: event().token, slideId: "one", document }) + "\n");
  const stream = repeatedFrames([commit, preview], 130);
  assert.ok(65 * commit.byteLength > 64 * 1024 * 1024);
  assert.ok(65 * preview.byteLength > 64 * 1024 * 1024);
  let documents = 0, previews = 0, finals = 0;
  for await (const item of readAIResponse(stream.response, new AbortController().signal)) {
    if (item.type === "document") { documents++; assert.equal(item.expected.document.length, document.length); }
    else if (item.type === "preview") { previews++; assert.equal(item.document.length, document.length); }
    else { assert.equal(item.type, "result"); finals++; }
  }
  assert.equal(documents, 65); assert.equal(previews, 65); assert.equal(finals, 1);
});

test("ordinary text still stops at the cumulative 64 MiB limit and cancels unread transport", async () => {
  const text = encoder.encode(JSON.stringify({ type: "text", text: "x".repeat(1024 * 1024) }) + "\n");
  const stream = repeatedFrames([text], 65); let received = 0;
  await assert.rejects(async () => {
    for await (const item of readAIResponse(stream.response, new AbortController().signal)) {
      assert.equal(item.type, "text"); received++;
    }
  }, /応答が大きすぎ/);
  assert.equal(received, 63); assert.equal(stream.cancelled, true);
});

test("document traffic still obeys the 2000-record limit including the completion record", async () => {
  const frame = encoder.encode(JSON.stringify({ ...event(), action: "snapshot" }) + "\n");
  const allowed = repeatedFrames([frame], 1999); let accepted = 0;
  for await (const item of readAIResponse(allowed.response, new AbortController().signal)) {
    accepted++; if (accepted === 2000) assert.equal(item.type, "result");
  }
  assert.equal(accepted, 2000);
  const oversized = repeatedFrames([frame], 2000); let received = 0;
  await assert.rejects(async () => {
    for await (const item of readAIResponse(oversized.response, new AbortController().signal)) {
      assert.equal(item.type, "document"); received++;
    }
  }, /応答が大きすぎ/);
  assert.equal(received, 2000);
});

test("one unfinished record cannot grow beyond 20 MiB even without a newline", async () => {
  const chunk = encoder.encode("x".repeat(1024 * 1024)); let pulls = 0, cancelled = false;
  const response = new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(pulls === 1 ? encoder.encode('{"type":"text","text":"') : chunk); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(async () => {
    for await (const item of readAIResponse(response, new AbortController().signal)) assert.fail(`Unexpected event: ${item.type}`);
  }, /応答が大きすぎ/);
  assert.equal(cancelled, true); assert.ok(pulls <= 22);
});

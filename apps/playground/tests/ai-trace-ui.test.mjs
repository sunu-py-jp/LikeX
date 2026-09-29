import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const built = await build({ absWorkingDir: root,
  stdin: { contents: `export * from './apps/playground/src/ai/ai-workspace'; export * from './apps/playground/src/ai/ai-trace-parts'; export { default as LikeAIChat } from '@likex/aichat';`, resolveDir: root },
  alias: { "@likex/aichat": `${root}/packages/aichat/src/index.ts`, "@likex/core": `${root}/packages/core/src/index.ts`,
    "@likex/core/json": `${root}/packages/core/src/json.ts`, "@likex/core/browser": `${root}/packages/core/src/browser.ts`,
    "@likex/core/ooxml": `${root}/packages/core/src/ooxml.ts` },
  loader: { ".css": "empty" }, bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
  plugins: [{ name: "shared-react", setup(builder) {
    builder.onResolve({ filter: /^(?:react|react-dom|lucide-react)(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    // Keep the lazy Slide renderer out of this chat-only bundle. Its public model
    // and Canvas behavior are exercised by ai-preview.test.mjs.
    builder.onResolve({ filter: /^@likex\/slide\/(?:model|render)$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { AIWorkspace, AIRunPart, ToolExecutionPart, createRunPart, LikeAIChat } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const runId = "d3149b1e-2dce-4a28-8e91-447d090608f3";
const input = { operation: "apply", commands: [{ type: "sheets.add", name: "売上速報" }] };
const call = { id: "call-1", name: "run_script", status: "running", input, startedAt: "2026-09-27T00:00:00.000Z" };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("host trace renderers escape command contents and restrict log download paths", () => {
  const html = renderToStaticMarkup(h(ToolExecutionPart, { part: { id: "tool", type: "likex.tool", data: { ...call, input: { text: "<script>bad()</script>" } } }, messageStatus: "cancelled" }));
  assert.match(html, /入力・編集コマンド/); assert.match(html, /中断/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  const valid = renderToStaticMarkup(h(AIRunPart, { part: createRunPart(runId), messageStatus: "streaming" }));
  assert.ok(valid.includes(`/api/ai/runs/${runId}`));
  const invalid = renderToStaticMarkup(h(AIRunPart, { part: createRunPart("../../.env"), messageStatus: "complete" }));
  assert.doesNotMatch(invalid, /href=/); assert.match(invalid, /不正/);
});

for (const documentKind of ["spreadsheet", "slide"]) for (const failed of [false, true]) test(`${documentKind} new chat clears visible context after ${failed ? "an error" : "completion"} while retaining the document and old conversation`, async t => {
  const originalFetch = globalThis.fetch, originalFrame = globalThis.requestAnimationFrame;
  const requests = [];
  let document = "before", revision = 0, applied = 0;
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  globalThis.fetch = async (url, init) => {
    if (url === "/api/ai/config") return Response.json({ configured: true, provider: "openai", model: "test" });
    requests.push(JSON.parse(init.body));
    const first = requests.length === 1;
    const events = [{ type: "run", id: runId }, { type: "tool", call }, { type: "progress", message: "古い実行の進捗" },
      first && failed ? { type: "error", message: "古い実行のエラー" } : { type: "result", document: "after", changed: true }];
    return new Response(events.map(event => JSON.stringify(event)).join("\n") + "\n");
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalFrame; });
  const adapter = { module: documentKind, label: documentKind, suggestions: ["資料を編集して"], snapshot: async () => ({ document, revision }),
    readCurrent: () => ({ document, revision }), normalize: value => value,
    async apply(value) { document = value; revision++; applied++; } };
  let renderer;
  await act(async () => { renderer = create(h(AIWorkspace, { adapter, colorMode: "light" }, h("p", null, "Document"))); await tick(); });
  t.after(() => act(async () => renderer.unmount()));
  const handle = () => renderer.root.findByType(LikeAIChat).props.ref.current;
  const input = () => renderer.root.findByProps({ "aria-label": "メッセージを入力" });
  async function send(text) {
    await act(async () => { input().props.onChange({ target: { value: text } }); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); await tick(); await tick(); });
  }
  await send("最初の依頼");
  const previous = handle().getAIChatConversation(), currentDocument = document, previousApplied = applied;
  assert.equal(previous.messages.length, 2);
  assert.equal(previous.messages[1].status, failed ? "error" : "complete");
  await act(async () => { input().props.onChange({ target: { value: "送信前の下書き" } }); });
  await act(async () => { renderer.root.findByProps({ "aria-label": "新しいチャット" }).props.onClick(); await tick(); });
  assert.notEqual(handle().getAIChatConversation().id, previous.id);
  assert.deepEqual(handle().getAIChatConversation().messages, []);
  assert.deepEqual(handle().getAIChat().conversations.find(item => item.id === previous.id), previous);
  assert.equal(handle().getAIChat().conversations.length, 2);
  assert.equal(input().props.value, "");
  assert.equal(document, currentDocument); assert.equal(applied, previousApplied);
  assert.equal(renderer.root.findAllByProps({ className: "playground-ai-progress" }).length, 0);
  assert.equal(renderer.root.findAllByProps({ className: "playground-ai-tool" }).length, 0);
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
  assert.equal(renderer.root.findAllByProps({ className: "playground-ai-suggestions" }).length, 1);
  await send("新しい依頼");
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "新しい依頼" }]);
  assert.equal(requests[1].document, currentDocument);
});

test("new chat cancels an in-flight request and rejects its late result without leaking into the next conversation", async t => {
  const originalFetch = globalThis.fetch, originalFrame = globalThis.requestAnimationFrame;
  const requests = [];
  let completeFirst, firstSignal, document = "before", revision = 0, applied = 0;
  const firstResponse = new Promise(resolve => { completeFirst = resolve; });
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  globalThis.fetch = async (url, init) => {
    if (url === "/api/ai/config") return Response.json({ configured: true, provider: "openai", model: "test" });
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) { firstSignal = init.signal; return firstResponse; }
    return new Response(`${JSON.stringify({ type: "result", document: "new result", changed: true })}\n`);
  };
  t.after(() => { globalThis.fetch = originalFetch; globalThis.requestAnimationFrame = originalFrame; });
  const adapter = { module: "slide", label: "Slide", suggestions: [], snapshot: async () => ({ document, revision }),
    readCurrent: () => ({ document, revision }), normalize: value => value,
    async apply(value) { document = value; revision++; applied++; } };
  let renderer;
  await act(async () => { renderer = create(h(AIWorkspace, { adapter, colorMode: "light" }, h("p", null, "Document"))); await tick(); });
  t.after(() => act(async () => renderer.unmount()));
  const handle = () => renderer.root.findByType(LikeAIChat).props.ref.current;
  async function send(text) {
    await act(async () => { renderer.root.findByProps({ "aria-label": "メッセージを入力" }).props.onChange({ target: { value: text } }); });
    await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); await tick(); });
  }
  await send("古い依頼");
  const previousId = handle().getAIChatConversation().id;
  assert.equal(firstSignal.aborted, false);
  assert.equal(renderer.root.findByProps({ className: "playground-ai-editor" }).props.inert, true);
  const button = renderer.root.findByProps({ "aria-label": "新しいチャット" });
  assert.equal(button.props.disabled, false);
  assert.match(button.props.title, /停止/);
  await act(async () => { button.props.onClick(); button.props.onClick(); await tick(); });
  assert.equal(firstSignal.aborted, true);
  assert.equal(renderer.root.findByProps({ className: "playground-ai-editor" }).props.inert, false);
  assert.deepEqual(handle().getAIChatConversation().messages, []);
  assert.equal(handle().getAIChat().conversations.length, 2, "a repeated click creates only one conversation");
  assert.equal(handle().getAIChat().conversations.find(item => item.id === previousId).messages[1].status, "cancelled");
  assert.equal(document, "before"); assert.equal(applied, 0);
  await send("新しい依頼");
  assert.equal(document, "new result"); assert.equal(applied, 1);
  await act(async () => { completeFirst(new Response(`${JSON.stringify({ type: "result", document: "stale result", changed: true })}\n`)); await tick(); await tick(); });
  assert.equal(document, "new result"); assert.equal(applied, 1);
  assert.deepEqual(requests[1].messages, [{ role: "user", content: "新しい依頼" }]);
  assert.equal(handle().getAIChatConversation().messages.length, 2);
  assert.equal(handle().getAIChatConversation().messages[1].status, "complete");
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /停止しました/);
});

for (const failed of [false, true]) test(`AI host keeps actual tool commands in chat ${failed ? "on error without applying the book" : "and applies only a completed result"}`, async t => {
  const originalFetch = globalThis.fetch;
  let applied = 0, document = "before", revision = 0, sentRequest;
  const end = failed ? { type: "error", message: "テスト用の実行エラー" } : { type: "result", document: "after", changed: true };
  const events = [{ type: "run", id: runId }, { type: "tool", call },
    { type: "tool", call: { ...call, status: failed ? "error" : "complete", finishedAt: "2026-09-27T00:00:01.000Z", ...(failed ? { error: "command failed" } : { output: { ok: true } }) } }, end];
  globalThis.fetch = async (url, init) => {
    if (url === "/api/ai/config") return Response.json({ configured: true, provider: "openai", model: "test" });
    sentRequest = JSON.parse(init.body);
    return new Response(events.map(event => JSON.stringify(event)).join("\n") + "\n");
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const adapter = { module: "spreadsheet", label: "Spreadsheet", suggestions: [], snapshot: async () => ({ document, documentTitle: "月次売上ブック", revision }),
    readCurrent: () => ({ document, revision }), normalize: value => value,
    async apply(value) { document = value; revision++; applied++; } };
  let renderer;
  await act(async () => { renderer = create(h(AIWorkspace, { adapter, colorMode: "light" }, h("p", null, "Workbook"))); await tick(); });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => { renderer.root.findByProps({ "aria-label": "メッセージを入力" }).props.onChange({ target: { value: "売上速報を作って" } }); });
  await act(async () => { renderer.root.findByType("form").props.onSubmit({ preventDefault() {} }); await tick(); await tick(); });
  const rendered = JSON.stringify(renderer.toJSON());
  assert.match(rendered, /sheets.add/); assert.match(rendered, /売上速報/); assert.match(rendered, /JSONLをダウンロード/);
  assert.equal(renderer.root.findAllByProps({ className: "playground-ai-tool" }).length, 1, "running and final events update one history part");
  assert.equal(applied, failed ? 0 : 1);
  assert.equal(document, failed ? "before" : "after");
  assert.equal(sentRequest.documentTitle, "月次売上ブック");
  assert.equal(sentRequest.document, "before");
  assert.deepEqual(sentRequest.messages, [{ role: "user", content: "売上速報を作って" }]);
  if (failed) assert.match(rendered, /テスト用の実行エラー/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({ entryPoints: [new URL("../build/ai/provider.ts", import.meta.url).pathname], bundle: true, platform: "node", format: "esm", write: false });
const { complete, readConfiguration, publicConfiguration } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const config = readConfiguration({ OPENAI_API_KEY: "test-key-never-public", OPENAI_MODEL: "gpt-6-luna" });
const signal = () => new AbortController().signal;
const message = (text = "完了しました", extra = {}) => ({ id: "msg-1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }], ...extra });
const call = (extra = {}) => ({ id: "fc-1", type: "function_call", call_id: "call-1", name: "run_script", arguments: '{"operation":"inspect"}', status: "completed", ...extra });
const response = (output = [message()], extra = {}) => new Response(JSON.stringify({ id: "resp-1", status: "completed", output, ...extra }));

test("Responses configuration preserves model defaults and keeps secrets private", () => {
  assert.equal(config.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(publicConfiguration(config), { configured: true, provider: "openai", model: "gpt-6-luna" });
  for (const model of ["gpt-6-luna", "gpt-6-luna-2026-09-22", "gpt-6-sol", "gpt-6-astra", "gpt-4.1"])
    assert.equal(readConfiguration({ OPENAI_API_KEY: "key", OPENAI_MODEL: model }).reasoningEffort, undefined);
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"])
    assert.equal(readConfiguration({ OPENAI_API_KEY: "key", AI_REASONING_EFFORT: effort }).reasoningEffort, effort);
  assert.equal(readConfiguration({ OPENAI_API_KEY: "key", AI_REASONING_EFFORT: "invalid" }).configured, false);
});

test("Azure uses Responses routes and retains deployment names in the model field", async () => {
  const env = { AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "azure-key", AZURE_OPENAI_ENDPOINT: "https://resource.openai.azure.com", AZURE_OPENAI_DEPLOYMENT: "my deployment" };
  assert.equal(readConfiguration(env).url, "https://resource.openai.azure.com/openai/v1/responses");
  const legacy = readConfiguration({ ...env, AZURE_OPENAI_API_VERSION: "2025-04-01-preview" });
  assert.equal(legacy.url, "https://resource.openai.azure.com/openai/responses?api-version=2025-04-01-preview");
  await complete(legacy, [], [], signal(), async (url, init) => {
    assert.equal(url, legacy.url); assert.equal(init.headers["api-key"], "azure-key"); assert.equal(init.headers.Authorization, undefined);
    assert.equal(JSON.parse(init.body).model, "my deployment");
    return response();
  });
});

test("request uses flat function tools, top-level instructions, stateless input and explicit reasoning", async () => {
  const input = [{ role: "user", content: "Inspect the workbook" }];
  const tools = [{ type: "function", name: "run_script", strict: false, parameters: { type: "object", properties: { operation: { type: "string" } } } }];
  const result = await complete(config, input, tools, signal(), async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body.input, input); assert.deepEqual(body.tools, tools); assert.equal(body.instructions, "Use the workbook skill.");
    assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false); assert.equal(body.tool_choice, "auto");
    assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
    assert.equal(body.reasoning, undefined); assert.equal(body.messages, undefined); assert.equal(body.reasoning_effort, undefined);
    assert.equal(init.headers.Authorization, "Bearer test-key-never-public"); assert.equal(init.redirect, "error");
    return response();
  }, "Use the workbook skill.");
  assert.equal(result.text, "完了しました"); assert.deepEqual(result.calls, []);
  for (const effort of ["none", "high"]) {
    await complete({ ...config, reasoningEffort: effort }, input, tools, signal(), async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body).reasoning, { effort }); return response();
    });
  }
});

test("reasoning, assistant phase and function-call items replay intact with call_id-linked outputs", async () => {
  const output = [
    { id: "rs-1", type: "reasoning", summary: [{ type: "summary_text", text: "Use the tool." }], encrypted_content: "opaque-encrypted-state", status: null },
    message("対象を確認します。", { phase: "commentary" }),
    call(),
  ];
  const first = await complete(config, [{ role: "user", content: "Inspect" }], [], signal(), async () => response(output));
  assert.deepEqual(first.output, output); assert.deepEqual(first.calls, [{ id: "call-1", name: "run_script", arguments: '{"operation":"inspect"}' }]);
  assert.equal(first.text, "対象を確認します。");
  const input = [...first.output, { type: "function_call_output", call_id: first.calls[0].id, output: '{"ok":true}' }];
  await complete(config, input, [], signal(), async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body).input, input);
    return response([message("確認しました。", { id: "msg-2", phase: "final_answer" })]);
  });
});

test("message text and refusals remain readable instead of becoming empty success", async () => {
  const refusal = message("", { content: [{ type: "refusal", refusal: "この依頼には対応できません。" }] });
  const refused = await complete(config, [], [], signal(), async () => response([refusal]));
  assert.equal(refused.text, "この依頼には対応できません。"); assert.equal(refused.refused, true);
  const multiple = [message("", { content: [{ type: "output_text", text: "A" }, { type: "output_text", text: "B" }] }), message("C", { id: "msg-2" })];
  assert.equal((await complete(config, [], [], signal(), async () => response(multiple))).text, "AB\n\nC");
});

test("failed, incomplete and malformed envelopes never release tool calls", async () => {
  for (const status of ["failed", "incomplete", "queued", "in_progress", "cancelled", null]) {
    await assert.rejects(complete(config, [], [], signal(), async () => response([call()], { status, error: { message: "test-key-never-public" } })), error => /完了しません/.test(error.message) && !error.message.includes("test-key"));
  }
  for (const payload of [{ choices: [{ message: { content: "old API" } }] }, { status: "completed", output: null }, { status: "completed", output: [] }, { status: "completed", output: [message()], incomplete_details: { reason: "max_output_tokens" } }])
    await assert.rejects(complete(config, [], [], signal(), async () => new Response(JSON.stringify(payload))));
});

test("malformed, duplicate, excessive and partial tool calls are rejected atomically", async () => {
  for (const output of [
    [call({ call_id: "" })], [call({ call_id: "bad id" })], [call({ name: "" })], [call({ name: "invalid/name" })], [call({ arguments: {} })],
    [call({ arguments: "x".repeat(512 * 1024 + 1) })], [call({ status: "in_progress" })], [call(), call({ id: "fc-2" })],
    Array.from({ length: 9 }, (_, index) => call({ id: `fc-${index}`, call_id: `call-${index}` })),
  ]) await assert.rejects(complete(config, [], [], signal(), async () => response(output)));
});

test("invalid output items cannot be mistaken for an editable final answer", async () => {
  for (const output of [
    [message("", { role: "user" })], [message("", { phase: "unknown" })], [message("", { content: [{ type: "refusal", refusal: 123 }] })],
    [{ id: "rs-1", type: "reasoning", summary: [], encrypted_content: 42 }],
    [{ id: "rs-1", type: "reasoning", summary: [], encrypted_content: "opaque" }],
    [{ type: "computer_call", id: "computer-1" }], [message(), message()], [null],
  ]) await assert.rejects(complete(config, [], [], signal(), async () => response(output)));
});

test("provider still bounds responses, suppresses server errors and respects cancellation", async () => {
  await assert.rejects(complete(config, [], [], signal(), async () => new Response("echo test-key-never-public", { status: 401 })), error => /HTTP 401/.test(error.message) && !error.message.includes("test-key"));
  await assert.rejects(complete(config, [], [], signal(), async () => new Response("x".repeat(1024 * 1024 + 1))), /大きすぎ/);
  await assert.rejects(complete(config, [], [], signal(), async () => new Response("not JSON")), /読み取れません/);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(complete(config, [], [], controller.signal, async () => { calls++; return response(); }), error => error.name === "AbortError");
  assert.equal(calls, 0);
});

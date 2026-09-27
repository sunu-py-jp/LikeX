import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { access, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { createWorkbook, normalizeWorkbook, serializeWorkbook, parseWorkbook } from "@likex/spreadsheet/model";
import { createSlideDeck, createSlideElement, serializeSlideDeck, parseSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const pluginUrl = new URL("../build/ai-playground.ts", import.meta.url).href;
const bundled = await build({
  stdin: { contents: `export * from './apps/playground/build/ai-playground.ts'; export * from './apps/playground/build/ai/provider.ts'; export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/run-log.ts';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.url": JSON.stringify(pluginUrl) },
  plugins: [{ name: "vite-external", setup(builder) { builder.onResolve({ filter: /^vite$/ }, () => ({ path: import.meta.resolve("vite"), external: true })); } }],
});
const { readConfiguration, publicConfiguration, complete, SkillWorkspace, toolDefinitions, parseRequest, runAISession: runAISessionRaw, createAIMiddleware, aiPlayground, AIRunLog, readAIRunLog } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const testLogIds = new Set();
const rememberRun = event => { if (event.type === "run") testLogIds.add(event.id); };
const runAISession = options => runAISessionRaw({ ...options, emit: event => { rememberRun(event); options.emit(event); } });
after(async () => { await Promise.all([...testLogIds].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const config = readConfiguration({ OPENAI_API_KEY: "test-secret-do-not-expose" });
const signal = () => new AbortController().signal;
const workbook = createWorkbook();
const sheetId = workbook.sheets[0].id;
const native = serializeWorkbook(workbook);
const request = () => ({ module: "spreadsheet", document: native, messages: [{ role: "user", content: "A1 を 42 にしてください" }] });
const response = (content = "完了しました", calls, extra = []) => new Response(JSON.stringify({ status: "completed", output: [...extra, ...(calls ?? [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: content, annotations: [] }] }])] }), { status: 200 });
let callSequence = 0;
const call = (name, args, id = `call-${++callSequence}`) => ({ id: `fc_${id}`, call_id: id, type: "function_call", name, arguments: typeof args === "string" ? args : JSON.stringify(args) });
const edit = () => ({ operation: "apply", commands: [{ type: "cells.set", sheetId, values: { A1: "42" } }] });

test("AI configuration supports OpenAI and Azure v1/legacy without publishing credentials", () => {
  assert.equal(config.model, "gpt-4.1");
  assert.deepEqual(publicConfiguration(config), { configured: true, provider: "openai", model: "gpt-4.1" });
  const azure = readConfiguration({ AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "secret", AZURE_OPENAI_ENDPOINT: "https://sample.openai.azure.com/", AZURE_OPENAI_DEPLOYMENT: "my model" });
  assert.equal(azure.url, "https://sample.openai.azure.com/openai/v1/responses");
  assert.equal(azure.configured, true);
  assert.equal(readConfiguration({ AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "secret", AZURE_OPENAI_ENDPOINT: "https://sample.openai.azure.com/", AZURE_OPENAI_DEPLOYMENT: "my model", AZURE_OPENAI_API_VERSION: "2025-04-01-preview" }).url,
    "https://sample.openai.azure.com/openai/responses?api-version=2025-04-01-preview");
  for (const endpoint of ["http://sample.openai.azure.com", "https://evil.example", "https://sample.openai.azure.com.evil.example", "https://secret@sample.openai.azure.com", "https://sample.openai.azure.com:444"]) {
    assert.equal(readConfiguration({ AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "secret", AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_DEPLOYMENT: "x" }).configured, false);
  }
  assert.deepEqual(publicConfiguration(readConfiguration({})).missing, ["OPENAI_API_KEY"]);
  assert.equal(readConfiguration({ AI_PROVIDER: "typo", OPENAI_API_KEY: "secret" }).configured, false);
});

test("provider uses native tool calling and suppresses response-body secrets on errors", async () => {
  await complete(config, [{ role: "user", content: "hello" }], [], signal(), async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.headers.Authorization, "Bearer test-secret-do-not-expose");
    assert.equal(init.redirect, "error");
    assert.equal(JSON.parse(init.body).parallel_tool_calls, false);
    return response();
  });
  await assert.rejects(complete(config, [], [], signal(), async () => new Response("echo test-secret-do-not-expose", { status: 401 })), error => /HTTP 401/.test(error.message) && !error.message.includes("test-secret"));
  await assert.rejects(complete(config, [], [], signal(), async () => new Response("x".repeat(1024 * 1024 + 1))), /大きすぎ/);
});

test("Responses preserves the configured model and uses only explicitly configured reasoning effort", async () => {
  for (const model of ["gpt-6-luna", "gpt-6-sol", "gpt-6-luna-2026-09-22", "gpt-4.1", "gpt-6-astra"]) {
    const settings = readConfiguration({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: model });
    await complete(settings, [{ role: "user", content: "test" }], [], signal(), async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, model);
      assert.equal(body.reasoning_effort, undefined);
      assert.equal(body.reasoning, undefined);
      assert.equal(body.store, false);
      return response();
    });
  }
  const azure = readConfiguration({ AI_PROVIDER: "azure", AZURE_OPENAI_API_KEY: "test-key", AZURE_OPENAI_ENDPOINT: "https://sample.openai.azure.com", AZURE_OPENAI_DEPLOYMENT: "my-luna-deployment", AI_REASONING_EFFORT: "none" });
  assert.equal(azure.reasoningEffort, "none");
  await complete(azure, [], [], signal(), async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, "my-luna-deployment");
    assert.deepEqual(JSON.parse(init.body).reasoning, { effort: "none" });
    return response();
  });
  assert.equal(readConfiguration({ OPENAI_API_KEY: "test-key", AI_REASONING_EFFORT: "typo" }).configured, false);
});

test("real skill CLI reads references, edits and validates SPON, cleans up and ignores inherited NODE_OPTIONS", async () => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", native);
  const previous = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = "--import=/definitely-not-a-module";
    assert.match((await workspace.invoke("read_skill", {}, signal())).content, /LikeX Spreadsheet/);
    const first = await workspace.invoke("read_reference", { name: "commands.schema.json", limit: 100 }, signal());
    assert.equal(first.nextOffset, 100);
    const next = await workspace.invoke("read_reference", { name: "commands.schema.json", offset: first.nextOffset, limit: 100 }, signal());
    assert.notEqual(first.content, next.content);
    await assert.rejects(workspace.invoke("read_reference", { name: "../../../../.env" }, signal()), /reference/);
    assert.equal((await workspace.invoke("run_script", { operation: "inspect" }, signal())).summary.sheets[0].id, sheetId);
    await workspace.invoke("run_script", { ...edit(), dryRun: true }, signal());
    assert.equal((await workspace.result(signal())).changed, false);
    await workspace.invoke("run_script", edit(), signal());
    const result = await workspace.result(signal());
    assert.equal(result.changed, true);
    assert.equal(parseWorkbook(result.document).sheets[0].cells.A1.value, "42");
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    await workspace.dispose();
  }
  await assert.rejects(access(workspace.directory));
});

test("real Slide CLI keeps animation source values and definitions when editing", async () => {
  const animation = { id: "move", trigger: { type: "click" }, animation: { type: "tween", elementId: "box", durationMs: 500, to: { x: 500 } } };
  const source = serializeSlideDeck(createSlideDeck({ slides: [{ id: "page", name: "Page", notes: "", background: "#ffffff", elements: [createSlideElement({ id: "box", type: "shape", x: 10 })], animations: [animation] }] }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const listing = await workspace.invoke("run_script", { operation: "inspect" }, signal());
    assert.equal(JSON.stringify(listing).includes('"to":{"x":500}'), false);
    const inspection = await workspace.invoke("run_script", { operation: "inspect", slideId: "page" }, signal());
    assert.ok(JSON.stringify(inspection).includes('"x":10'));
    assert.ok(JSON.stringify(inspection).includes('"to":{"x":500}'));
    await workspace.invoke("run_script", { operation: "apply", commands: [{ type: "slide.update", slideId: "page", patch: { name: "Edited" } }] }, signal());
    const deck = parseSlideDeck((await workspace.result(signal())).document);
    assert.equal(deck.slides[0].name, "Edited");
    assert.equal(deck.slides[0].elements[0].x, 10);
    assert.equal(deck.slides[0].animations[0].animation.to.x, 500);
  } finally { await workspace.dispose(); }
});

const searchNative = serializeWorkbook(normalizeWorkbook({ sheets: [
  { id: "sales-now", name: "売上速報", rowCount: 20, columnCount: 6, cells: {
    A1: { value: "テスト！" }, B2: { value: "売上" }, C3: { value: "売上予定" },
    F3: { value: "=120*3" }, B4: { value: "--help" }, C4: { value: "long-cell " + "x".repeat(25000) },
  } },
  { id: "sales-plan", name: "売上計画", rowCount: 20, columnCount: 6, cells: { A1: { value: "売上" } } },
  { id: "costs", name: "経費", rowCount: 20, columnCount: 6, cells: {} },
] }));

test("AI search uses the real read-only skill CLI with scope, literal text, and pagination", async () => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", searchNative);
  const inspect = async args => (await workspace.invoke("run_script", { operation: "inspect", ...args }, signal())).selection;
  try {
    assert.match((await workspace.invoke("read_reference", { name: "inspect.md" }, signal())).content, /--search/);
    assert.deepEqual(await inspect({ search: "sheets", text: "売上", offset: 1, limit: 1 }), {
      search: "sheets", text: "売上", matches: [{ sheetId: "sales-plan", name: "売上計画", index: 1, rowCount: 20, columnCount: 6 }],
      offset: 1, limit: 1, total: 2, hasMore: false,
    });
    const cells = await inspect({ search: "cells", text: "売上", limit: 1 });
    assert.equal(cells.total, 3);
    assert.equal(cells.hasMore, true);
    assert.deepEqual(cells.matches, [{ sheetId: "sales-now", address: "B2", value: "売上", matchedText: "売上" }]);
    const scope = { search: "cells", sheetId: "sales-now", range: "C3:F3" };
    assert.deepEqual((await inspect({ ...scope, text: "売上" })).matches.map(cell => cell.address), ["C3"]);
    assert.equal((await inspect({ ...scope, text: "売上", exact: true })).total, 0);
    assert.equal((await inspect({ ...scope, text: "360", lookIn: "values", exact: true })).matches[0].value, "=120*3");
    assert.equal((await inspect({ ...scope, text: "120*", lookIn: "formulas" })).matches[0].matchedText, "=120*3");
    assert.equal((await inspect({ search: "cells", text: "--help" })).matches[0].address, "B4");
    const longMatch = (await inspect({ search: "cells", text: "long-cell", limit: 1 })).matches[0];
    assert.equal(longMatch.address, "C4");
    assert.equal(longMatch.value.length, 200);
    assert.equal(longMatch.valueLength, 25010);
    assert.equal(longMatch.valueTruncated, true);
    assert.equal(longMatch.matchedTextLength, 25010);
    assert.equal(longMatch.matchedTextTruncated, true);
    assert.equal((await inspect({ search: "cells", text: "long-cell", previewLength: 300 })).matches[0].value.length, 300);
    assert.deepEqual(await inspect({ sheetId: "sales-now", range: "A1" }), { sheetId: "sales-now", range: "A1", rows: [[{ value: "テスト！" }]] });
    assert.deepEqual((await inspect({ search: "sheets", text: "missing" })).matches, []);
    assert.equal(await readFile(workspace.file, "utf8"), searchNative);
    assert.deepEqual(await workspace.result(signal()), { type: "result", changed: false, document: searchNative });
  } finally { await workspace.dispose(); }
});

test("AI rejects ambiguous search options and exposes search only for Spreadsheet", async () => {
  const properties = module => toolDefinitions(module).find(tool => tool.name === "run_script").parameters.properties;
  assert.deepEqual(properties("spreadsheet").search.enum, ["sheets", "cells"]);
  assert.equal(properties("slide").search, undefined);
  const workspace = await SkillWorkspace.create(root, "spreadsheet", searchNative);
  const slide = await SkillWorkspace.create(root, "slide", serializeSlideDeck(createSlideDeck()));
  try {
    for (const args of [
      { text: "売上" }, { offset: 0 }, { search: "other", text: "売上" },
      { search: "cells", text: "" }, { search: "cells", text: "x\0y" },
      { search: "sheets", text: "売上", sheetId: "sales-now" },
      { search: "sheets", text: "売上", lookIn: "values" },
      { search: "sheets", text: "売上", previewLength: 200 },
      { search: "cells", text: "売上", range: "A1" },
      { search: "cells", text: "売上", drawingId: "drawing" },
      { search: "cells", text: "売上", includeData: false },
      { search: "cells", text: "売上", matchCase: "false" },
      { search: "cells", text: "売上", exact: 1 },
      { search: "cells", text: "売上", lookIn: "invalid" },
      { search: "cells", text: "売上", offset: -1 },
      { search: "cells", text: "売上", limit: 1001 },
      { search: "cells", text: "売上", previewLength: 0 },
      { search: "cells", text: "売上", previewLength: 10001 },
      { operation: "validate", search: "cells", text: "売上" },
    ]) await assert.rejects(workspace.invoke("run_script", { operation: "inspect", ...args }, signal()));
    await assert.rejects(slide.invoke("run_script", { operation: "inspect", search: "cells", text: "x" }, signal()));
    assert.equal((await workspace.result(signal())).changed, false);
  } finally { await workspace.dispose(); await slide.dispose(); }
});

test("AI session passes search results back to the model and logs them without editing the book", async () => {
  const events = [];
  const input = { operation: "inspect", search: "cells", text: "売上", sheetId: "sales-now", range: "B2:F6", limit: 10 };
  let round = 0;
  await runAISession({ repository: root, config, request: { ...request(), document: searchNative }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    if (round++ === 0) return response(null, [call("run_script", input, "search-cells")]);
    const tool = JSON.parse(init.body).input.findLast(item => item.type === "function_call_output");
    const result = JSON.parse(tool.output);
    assert.equal(result.selection.total, 2);
    assert.deepEqual(result.selection.matches.map(cell => cell.address), ["B2", "C3"]);
    return response("B2 と C3 が一致しました。");
  } });
  assert.equal(events.at(-1).changed, false);
  assert.equal(events.at(-1).document, searchNative);
  const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
  const search = log.find(record => record.type === "tool" && record.modelCallId === "search-cells" && record.call.status === "complete");
  assert.deepEqual(search.call.input, input);
  assert.equal(search.call.output.selection.total, 2);
  assert.equal(log.at(-1).status, "completed");
});

test("initial Responses input is overview only; skills and selected sheet data arrive on demand", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: [
    { id: "requested", name: "売上速報", rowCount: 20, columnCount: 6, cells: { A1: { value: "REQUESTED_CELL_CONTENT" }, B2: { value: "SECOND_PAGE_CONTENT" } } },
    { id: "unrelated", name: "経費", rowCount: 20, columnCount: 6, cells: { A1: { value: "UNREQUESTED_PRIVATE_CELL" } } },
  ] }));
  const requests = [], events = [];
  const reasoning = { type: "reasoning", id: "rs_context", summary: [], encrypted_content: "opaque-reasoning" };
  const replies = [
    response(null, [call("read_skill", {}, "skill")], [reasoning]),
    response(null, [call("run_script", { operation: "inspect", search: "sheets", text: "売上" }, "find-sheet")]),
    response(null, [call("run_script", { operation: "inspect", sheetId: "requested", includeData: true, limit: 1 }, "read-sheet")]),
    response("対象シートの A1 を確認しました。"),
  ];
  await runAISession({ repository: root, config, request: { ...request(), document: source, documentTitle: "今週の売上ブック",
    messages: [{ role: "user", content: "売上速報シートを確認して" }],
    selection: { sheetId: "requested", focus: { row: 0, column: 0 }, value: "SELECTION_BODY_MUST_NOT_LEAK" },
  }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => { requests.push(JSON.parse(init.body)); return replies.shift(); } });
  const first = requests[0], encoded = JSON.stringify(first);
  assert.equal(first.store, false);
  assert.equal(first.messages, undefined);
  assert.ok(first.input[0].content.includes('"title":"今週の売上ブック"'));
  assert.ok(first.input[0].content.includes('"sheetCount":2'));
  for (const absent of ["REQUESTED_CELL_CONTENT", "SECOND_PAGE_CONTENT", "UNREQUESTED_PRIVATE_CELL", "SELECTION_BODY_MUST_NOT_LEAK", '"sheets":', "Installed SKILL.md:"])
    assert.ok(!encoded.includes(absent), absent);
  assert.ok(first.tools.every(tool => tool.type === "function" && tool.name && tool.strict === false && !tool.function));
  assert.deepEqual(requests[1].input.find(item => item.type === "reasoning"), reasoning);
  assert.equal(requests[1].input.find(item => item.type === "function_call_output").call_id, "skill");
  const sheet = requests[3].input.find(item => item.type === "function_call_output" && item.call_id === "read-sheet");
  const result = JSON.parse(sheet.output).selection;
  assert.deepEqual(result.cells, [{ address: "A1", value: "REQUESTED_CELL_CONTENT" }]);
  assert.equal(result.total, 2); assert.equal(result.hasMore, true);
  assert.ok(!JSON.stringify(requests).includes("UNREQUESTED_PRIVATE_CELL"));
  assert.ok(!JSON.stringify(requests).includes("SECOND_PAGE_CONTENT"));
  assert.equal(events.at(-1).changed, false);
  assert.equal(events.at(-1).document, source);
});

test("host config injects system instructions while browser-supplied text remains ordinary data", async () => {
  const events = [];
  const supplied = parseRequest({ ...request(), documentTitle: "Untrusted title", instructions: "BROWSER_SYSTEM_OVERRIDE" });
  await runAISession({ repository: root, config, request: supplied, instructions: module => `HOST_INSTRUCTIONS_FOR_${module}`, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.instructions, "HOST_INSTRUCTIONS_FOR_spreadsheet");
    assert.ok(!JSON.stringify(body).includes("BROWSER_SYSTEM_OVERRIDE"));
    assert.ok(body.input[0].content.includes("Untrusted title"));
    return response();
  } });
  assert.equal(events.at(-1).changed, false);
  assert.throws(() => parseRequest({ ...request(), documentTitle: 123 }), /不正/);
  assert.throws(() => parseRequest({ ...request(), documentTitle: "x".repeat(1001) }), /不正/);
});

test("overview and sheet content selectors stay bounded and never expose other sheet bodies", async () => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", searchNative);
  const slide = await SkillWorkspace.create(root, "slide", serializeSlideDeck(createSlideDeck()));
  try {
    const overview = await workspace.invoke("run_script", { operation: "inspect", overview: true }, signal());
    assert.equal(overview.summary.sheetCount, 3);
    assert.equal(overview.summary.sheets, undefined);
    assert.equal(overview.selection, undefined);
    const first = await workspace.invoke("run_script", { operation: "inspect", sheetId: "sales-now", includeData: true, limit: 2 }, signal());
    assert.equal(first.summary.sheets, undefined);
    assert.deepEqual(first.selection.cells.map(cell => cell.address), ["A1", "B2"]);
    assert.equal(Object.hasOwn(first.selection, "rows"), false);
    assert.equal(first.selection.hasMore, true);
    const next = await workspace.invoke("run_script", { operation: "inspect", sheetId: "sales-now", includeData: true, offset: 2, limit: 1 }, signal());
    assert.deepEqual(next.selection.cells.map(cell => cell.address), ["C3"]);
    const slideOverview = await slide.invoke("run_script", { operation: "inspect", overview: true }, signal());
    assert.equal(slideOverview.summary.slides, undefined);
    assert.equal(slideOverview.selection, undefined);
    assert.match((await slide.invoke("read_reference", { name: "inspect.md" }, signal())).content, /--overview/);
    for (const args of [
      { overview: true, sheetId: "sales-now" }, { overview: true, search: "sheets", text: "売上" },
      { overview: true, includeData: false }, { overview: "true" }, { operation: "validate", overview: true },
      { sheetId: "sales-now", includeData: true, offset: -1 }, { sheetId: "sales-now", includeData: true, limit: 1001 },
      { sheetId: "sales-now", range: "A1", includeData: true }, { sheetId: "sales-now", offset: 0 },
    ]) await assert.rejects(workspace.invoke("run_script", { operation: "inspect", ...args }, signal()));
    assert.equal((await workspace.result(signal())).changed, false);
  } finally { await workspace.dispose(); await slide.dispose(); }
});

test("Responses tool results and execution logs retain range rows without duplicating cells", async () => {
  const events = [], expected = { sheetId: "sales-now", range: "C3:F3", rows: [[{ value: "売上予定" }, null, null, { value: "=120*3" }]] };
  let round = 0;
  await runAISession({ repository: root, config, request: { ...request(), document: searchNative }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    if (round++ === 0) return response(null, [call("run_script", { operation: "inspect", sheetId: "sales-now", range: "C3:F3" })]);
    const output = JSON.parse(JSON.parse(init.body).input.findLast(item => item.type === "function_call_output").output);
    assert.deepEqual(output.selection, expected);
    return response("取得しました。");
  } });
  assert.equal(events.at(-1).changed, false);
  assert.deepEqual(events.find(event => event.type === "tool" && event.call.status === "complete" && event.call.input.range)?.call.output.selection, expected);
  const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
  assert.deepEqual(log.find(record => record.type === "tool" && record.call.status === "complete" && record.call.input.range)?.call.output.selection, expected);
});

test("a refusal after staged edits never publishes the partial document", async () => {
  const events = [];
  let round = 0;
  await assert.rejects(runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async () => {
    if (round++ === 0) return response(null, [call("run_script", edit())]);
    return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "この依頼には対応できません。" }] }] }));
  } }), /この依頼には対応できません/);
  assert.equal(events.some(event => event.type === "result"), false);
  const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
  assert.equal(log.at(-1).status, "error");
});

test("failed apply validation prevents publishing an earlier staged edit", async () => {
  const workspace = await SkillWorkspace.create(root, "spreadsheet", native);
  try {
    await workspace.invoke("run_script", edit(), signal());
    await assert.rejects(workspace.invoke("run_script", { operation: "apply" }, signal()), /commands/);
    await assert.rejects(workspace.result(signal()), /失敗した編集/);
    await workspace.invoke("run_script", edit(), signal());
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("agent actually loads skill/references and executes CLI tool calls before returning one document", async () => {
  const events = [], requests = [];
  const replies = [response(null, [call("read_skill", {})]), response(null, [call("read_reference", { name: "commands.md" })]), response(null, [call("run_script", edit())]), response()];
  await runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => { requests.push(JSON.parse(init.body)); return replies.shift(); } });
  assert.match(requests[0].instructions, /Initially you only receive document overview/);
  assert.ok(requests.at(-1).input.some(item => item.type === "function_call_output" && item.output.includes('"written":true')));
  assert.equal(events.filter(event => event.type === "result").length, 1);
  assert.equal(parseWorkbook(events.at(-1).document).sheets[0].cells.A1.value, "42");
  const runId = events.find(event => event.type === "run").id;
  const logText = await readAIRunLog(root, runId);
  const records = logText.trim().split("\n").map(JSON.parse);
  assert.equal(records[0].type, "run-start");
  assert.equal(records.at(-1).status, "completed");
  assert.ok(records.every(record => record.runId === runId && record.module === "spreadsheet" && record.model === config.model));
  assert.ok(!logText.includes(config.key));
  assert.ok(!Object.hasOwn(records[0], "document"));
  const loggedEdit = records.find(record => record.type === "tool" && record.call.status === "complete" && record.call.input.operation === "apply");
  assert.deepEqual(loggedEdit.call.input, edit());
  assert.equal(loggedEdit.call.output.ok, true);
  assert.ok(loggedEdit.call.startedAt && loggedEdit.call.finishedAt);
  const streamEdit = events.find(event => event.type === "tool" && event.call.id === loggedEdit.call.id && event.call.status === "complete");
  assert.deepEqual(streamEdit.call.input.commands, edit().commands);
  assert.deepEqual(records.filter(record => record.type === "tool" && record.source === "initial" && record.call.status === "complete").map(record => record.call.input), [{ operation: "inspect", overview: true }]);
  assert.ok(records.some(record => record.source === "final" && record.call.input.operation === "validate" && record.call.status === "complete"));
});

test("provider failure, malformed operation, and cancellation return no staged result", async () => {
  for (const mode of ["provider", "malformed", "abort"]) {
    const events = [], controller = new AbortController();
    let round = 0;
    await assert.rejects(runAISession({ repository: root, config, request: request(), signal: controller.signal, emit: event => events.push(event), fetcher: async () => {
      if (round++ === 0) return response(null, [call("run_script", edit())]);
      if (mode === "provider") return new Response("private diagnostic", { status: 500 });
      if (mode === "malformed") return response(null, [call("run_script", "{bad")]);
      controller.abort(new Error("cancelled")); return response();
    } }));
    assert.equal(events.some(event => event.type === "result"), false, mode);
    const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
    assert.equal(log.at(-1).status, mode === "abort" ? "cancelled" : "error");
    if (mode === "malformed") assert.ok(log.some(record => record.type === "tool" && record.call.status === "error" && record.call.input.arguments === "{bad"));
  }
});

test("tool loop has a fixed bound and never publishes unfinished work", async () => {
  const events = [];
  let count = 0;
  await assert.rejects(runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async () => {
    count++;
    return response(null, [call("read_skill", {})]);
  } }), /完了しなかった/);
  assert.equal(count, 16);
  assert.equal(events.some(event => event.type === "result"), false);
});

test("invalid roles, excessively large documents, and unbounded requests are rejected", () => {
  assert.throws(() => parseRequest({ ...request(), messages: [{ role: "system", content: "unsafe" }] }), /不正/);
  assert.throws(() => parseRequest({ ...request(), document: "x".repeat(8 * 1024 * 1024 + 1) }), /不正/);
  assert.throws(() => parseRequest({ ...request(), messages: Array.from({ length: 41 }, () => ({ role: "user", content: "x" })) }), /不正/);
});

class MemoryResponse extends EventEmitter {
  headers = {}; chunks = []; statusCode = 200; headersSent = false; writableEnded = false; destroyed = false;
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  flushHeaders() { this.headersSent = true; }
  write(value) { this.headersSent = true; this.chunks.push(value); try { rememberRun(JSON.parse(value)); } catch { /* HTTP config/error is not a run event. */ } return true; }
  end(value) { if (value) this.write(value); this.writableEnded = true; this.emit("finish"); }
  text() { return this.chunks.join(""); }
}
function httpRequest({ url = "/api/ai/chat", method = "POST", headers = {}, body = request(), remoteAddress = "127.0.0.1" } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.url = url; req.method = method;
  req.headers = { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173", "content-type": "application/json", ...headers };
  req.socket = { remoteAddress };
  return req;
}
async function http(middleware, options) {
  const res = new MemoryResponse();
  await middleware(httpRequest(options), res, () => { throw new Error("unexpected next"); });
  return res;
}

test("middleware exposes config without secrets and restricts Host, Origin, IP and content type", async () => {
  const middleware = createAIMiddleware({ repository: root, config });
  const res = await http(middleware, { url: "/api/ai/config", method: "GET" });
  assert.deepEqual(JSON.parse(res.text()), publicConfiguration(config));
  assert.ok(!res.text().includes("secret"));
  for (const options of [{ headers: { host: "evil.example" } }, { headers: { origin: "https://evil.example" } }, { headers: { origin: undefined } }, { headers: { "sec-fetch-site": "cross-site" } }, { remoteAddress: "192.168.1.20" }]) {
    assert.equal((await http(middleware, options)).statusCode, 403);
  }
  assert.equal((await http(middleware, { headers: { "content-type": "text/plain" } })).statusCode, 415);
  assert.equal((await http(middleware, { headers: { "content-length": String(11 * 1024 * 1024) } })).statusCode, 400);
  assert.equal((await http(createAIMiddleware({ repository: root, config: readConfiguration({}) }), {})).statusCode, 503);
});

test("middleware returns NDJSON, releases concurrency slots, and aborts on response disconnect", async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let providerCalls = 0;
  const middleware = createAIMiddleware({ repository: root, config, fetcher: async (_url, init) => {
    providerCalls++;
    if (providerCalls > 1) return response();
    started(init.signal);
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
  } });
  const res = new MemoryResponse();
  const pending = middleware(httpRequest(), res, () => {});
  const providerSignal = await ready;
  res.destroyed = true; res.emit("close");
  await pending;
  assert.equal(providerSignal.aborted, true);
  assert.equal(res.text().includes('"type":"result"'), false);
  const successful = await http(middleware, {});
  assert.equal(successful.headers["content-type"], "application/x-ndjson; charset=utf-8");
  assert.equal(JSON.parse(successful.text().trim().split("\n").at(-1)).type, "result");
});

test("middleware request timeout produces no final document", async () => {
  const middleware = createAIMiddleware({ repository: root, config, timeoutMs: 20, fetcher: async (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true })) });
  const res = await http(middleware, {});
  assert.ok(res.text().includes("時間切れ"));
  assert.ok(!res.text().includes('"type":"result"'));
});

test("middleware admits only two requests and restores capacity after completion", async () => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const bothEntered = new Promise(resolve => { entered = resolve; });
  let count = 0;
  const middleware = createAIMiddleware({ repository: root, config, fetcher: async () => {
    if (++count === 2) entered();
    await gate;
    return response();
  } });
  const first = http(middleware, {}), second = http(middleware, {});
  await bothEntered;
  assert.equal((await http(middleware, {})).statusCode, 429);
  release();
  assert.equal((await first).statusCode, 200);
  assert.equal((await second).statusCode, 200);
  assert.equal((await http(middleware, {})).statusCode, 200);
});

test("Vite plugin retains deny protections and adds private env files", () => {
  const deny = aiPlayground().config({ server: { fs: { deny: ["**/private/**"] } } }).server.fs.deny;
  for (const pattern of ["**/private/**", "**/.git/**", "**/.likex-ai/**", "**/.npmrc", "**/.yarnrc.yml", "**/*.{crt,pem,key,p12,pfx,cer,der}", "**/.env*"]) assert.ok(deny.includes(pattern), pattern);
  assert.deepEqual(aiPlayground().config({ server: { watch: { ignored: "**/existing/**" } } }).server.watch.ignored, ["**/existing/**", "**/.likex-ai/**"]);
  assert.deepEqual(aiPlayground().config({ server: { watch: { ignored: ["**/one/**", "**/two/**"] } } }).server.watch.ignored, ["**/one/**", "**/two/**", "**/.likex-ai/**"]);
});

test("failed exact commands and errors are retained, and a successful repair completes the same run", async () => {
  const invalid = { operation: "apply", commands: [{ type: "unsupported.command", literal: "日本語\\n & <xml>" }] };
  for (const repaired of [false, true]) {
    const events = [];
    const replies = [response(null, [call("run_script", invalid)]), ...(repaired ? [response(null, [call("run_script", edit())])] : []), response()];
    const pending = runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async () => replies.shift() });
    if (repaired) await pending; else await assert.rejects(pending, /失敗した編集/);
    const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
    const failed = log.find(record => record.type === "tool" && record.call.status === "error");
    assert.deepEqual(failed.call.input, invalid);
    assert.match(failed.call.error, /スクリプト/);
    assert.ok(events.some(event => event.type === "tool" && event.call.id === failed.call.id && event.call.status === "error"));
    assert.equal(log.at(-1).status, repaired ? "completed" : "error");
  }
});

test("local download exposes only strict UUID logs and rejects paths, other origins and symlinks", async t => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "likex-ai-log-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const log = await AIRunLog.create(repository, "slide", config);
  await log.finish("completed"); await log.close();
  const middleware = createAIMiddleware({ repository, config });
  const success = await http(middleware, { url: `/api/ai/runs/${log.id}`, method: "GET" });
  assert.equal(success.statusCode, 200);
  assert.equal(success.headers["cache-control"], "no-store");
  assert.equal(success.headers["content-disposition"], `attachment; filename="likex-ai-${log.id}.jsonl"`);
  assert.match(success.text(), /run-start/);
  assert.equal((await stat(path.join(repository, ".likex-ai/runs", `${log.id}.jsonl`))).mode & 0o777, 0o600);
  assert.equal((await http(middleware, { url: `/api/ai/runs/${log.id}`, method: "POST" })).statusCode, 405);
  for (const id of ["../.env", "%2e%2e%2f.env", `${log.id}/extra`, "not-a-uuid", ""]) assert.equal((await http(middleware, { url: `/api/ai/runs/${id}`, method: "GET" })).statusCode, 400);
  assert.equal((await http(middleware, { url: `/api/ai/runs/${log.id}`, method: "GET", headers: { origin: "https://evil.example" } })).statusCode, 403);
  const absent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  assert.equal((await http(middleware, { url: `/api/ai/runs/${absent}`, method: "GET" })).statusCode, 404);
  await symlink(path.join(repository, ".likex-ai/runs", `${log.id}.jsonl`), path.join(repository, ".likex-ai/runs", `${absent}.jsonl`));
  assert.equal((await http(middleware, { url: `/api/ai/runs/${absent}`, method: "GET" })).statusCode, 404);
});

test("large exact commands survive logging while outputs are explicitly bounded and configured keys redacted", async t => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "likex-ai-log-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  const log = await AIRunLog.create(repository, "spreadsheet", config);
  const commands = [{ type: "cells.set", sheetId, values: { A1: "x".repeat(512 * 1024 - 100) } }];
  assert.ok(Buffer.byteLength(JSON.stringify(commands)) <= 512 * 1024);
  const startedAt = new Date().toISOString();
  const visible = await log.tool({ id: "tool-1", name: "run_script", status: "complete", input: { operation: "apply", commands }, output: { content: "✨🧑‍💻日本語\\\"".repeat(100_000), secret: config.key }, startedAt, finishedAt: startedAt }, { source: "model", modelCallId: "model-id" });
  assert.equal(visible.input.truncated, true);
  assert.ok(visible.inputTruncated.originalBytes > 64 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(visible.input)) <= 64 * 1024);
  assert.ok(visible.outputTruncated.originalBytes > visible.outputTruncated.storedBytes);
  assert.ok(Buffer.byteLength(JSON.stringify(visible.output)) <= 40 * 1024);
  assert.equal(visible.output.preview.isWellFormed(), true);
  await log.finish("completed"); await log.close();
  const text = await readAIRunLog(repository, log.id);
  const entry = text.trim().split("\n").map(JSON.parse).find(record => record.type === "tool");
  assert.deepEqual(entry.call.input.commands, commands);
  assert.ok(Buffer.byteLength(JSON.stringify(entry.call.output)) <= 128 * 1024);
  assert.equal(entry.call.output.preview.isWellFormed(), true);
  assert.ok(!text.includes(config.key));
  assert.equal(entry.modelCallId, "model-id");
});

test("an unavailable log destination stops the session before provider calls or edits", async t => {
  const repository = await mkdtemp(path.join(os.tmpdir(), "likex-ai-log-test-"));
  t.after(() => rm(repository, { recursive: true, force: true }));
  await writeFile(path.join(repository, ".likex-ai"), "not a directory");
  let called = false;
  await assert.rejects(runAISession({ repository, config, request: request(), signal: signal(), emit: () => {}, fetcher: async () => { called = true; return response(); } }), /実行ログを保存できません/);
  assert.equal(called, false);
  assert.equal(await readFile(path.join(repository, ".likex-ai"), "utf8"), "not a directory");
});

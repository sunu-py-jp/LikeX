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
  stdin: { contents: `export * from './apps/playground/build/ai-playground.ts'; export * from './apps/playground/build/ai/provider.ts'; export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/run-log.ts'; export * from './apps/playground/build/ai/command-schema.ts'; export * from './apps/playground/build/ai/write-diagnostics.ts'; export * from './apps/playground/build/ai/tool-errors.ts';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false,
  define: { "import.meta.url": JSON.stringify(pluginUrl) },
  plugins: [{ name: "vite-external", setup(builder) { builder.onResolve({ filter: /^vite$/ }, () => ({ path: import.meta.resolve("vite"), external: true })); } }],
});
const { readConfiguration, publicConfiguration, complete, SkillWorkspace, toolDefinitions, commandSchemas, strictSchema, normalizeCommandValue, normalizeCommands, validateSchema, WriteFailures, AIToolError, toolErrorResult, parseRequest, runAISession: runAISessionRaw, createAIMiddleware, aiPlayground, AIRunLog, readAIRunLog } =
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
    const deck = parseSlideDeck(await readFile(workspace.file, "utf8"));
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
  assert.ok(toolDefinitions("spreadsheet", root).some(tool => tool.name === "search_cells"));
  assert.ok(toolDefinitions("spreadsheet", root).some(tool => tool.name === "search_sheets"));
  assert.ok(!toolDefinitions("slide", root).some(tool => tool.name.startsWith("search_")));
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
  assert.ok(first.tools.every(tool => tool.type === "function" && tool.name && tool.strict === true && !tool.function));
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

test("Slide edits a many-element page with grouped reads while keeping initial and unrelated content out of context", async () => {
  const elements = [
    ...Array.from({ length: 20 }, (_, index) => createSlideElement({ id: `text-${index}`, type: "text", text: `PAGE_CONTENT_${index}`, x: 20 + index * 5, y: 40, width: 160, height: 40, fontSize: 18, bold: true })),
    createSlideElement({ id: "shape-text", type: "shape", text: "SHAPE_CONTENT", x: 30, y: 100, fill: "#123456", textColor: "#ffffff" }),
  ];
  const animation = { id: "move", trigger: { type: "click" }, animation: { type: "tween", elementId: "text-0", durationMs: 500, to: { x: 500 } } };
  const original = createSlideDeck({ title: "ページ編集テスト", slides: [
    { id: "requested-page", name: "編集対象", background: "#ffffff", notes: "", elements, animations: [animation] },
    { id: "unrelated-page", name: "別ページ", background: "#ffffff", notes: "", elements: [createSlideElement({ id: "private-text", type: "text", text: "UNREQUESTED_SLIDE_BODY" })] },
  ] });
  const source = serializeSlideDeck(original), events = [], requests = [];
  const pageInput = { operation: "inspect", slideId: "requested-page", includeData: true };
  let round = 0;
  await runAISession({ repository: root, config, request: {
    module: "slide", document: source, selection: { slideId: "requested-page", elementIds: [], text: "SELECTION_CONTENT_MUST_NOT_LEAK" },
    messages: [{ role: "user", content: "現在のページのすべてのテキストと図形内文字の末尾に 編集済み を追加してください" }],
  }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    switch (round++) {
      case 0: return response(null, [call("read_skill", {}, "slide-skill")]);
      case 1: return response(null, [call("read_reference", { name: "commands.md" }, "slide-reference")]);
      case 2: return response(null, [call("run_script", pageInput, "read-page")]);
      case 3: {
        const output = JSON.parse(body.input.findLast(item => item.type === "function_call_output").output);
        assert.equal(output.summary.slides, undefined);
        assert.equal(output.selection.elements.length, 21);
        assert.equal(output.selection.elements[0].text, "PAGE_CONTENT_0");
        assert.equal(output.selection.elements[0].fontSize, 18);
        assert.equal(output.selection.elements[0].bold, true);
        assert.equal(output.selection.elements[0].x, 20);
        assert.equal(output.selection.animations[0].animation.to.x, 500);
        assert.equal(output.selection.elements.at(-1).text, "SHAPE_CONTENT");
        assert.equal(output.selection.elements.at(-1).fill, "#123456");
        const commands = output.selection.elements.map(element => ({ type: "element.update", slideId: output.selection.slide.id, elementId: element.id, patch: { text: `${element.text} 編集済み` } }));
        return response(null, [call("run_script", { operation: "apply", commands }, "edit-page")]);
      }
      case 4: return response(null, [call("run_script", pageInput, "verify-page")]);
      case 5: {
        const verified = JSON.parse(body.input.findLast(item => item.type === "function_call_output").output);
        assert.ok(verified.selection.elements.every(element => element.text.endsWith(" 編集済み")));
        return response("現在のページの21要素を編集しました。");
      }
      default: throw new Error("Unnecessary extra provider round");
    }
  } });
  assert.equal(requests.length, 6);
  for (const absent of ["PAGE_CONTENT", "SHAPE_CONTENT", "UNREQUESTED_SLIDE_BODY", "SELECTION_CONTENT_MUST_NOT_LEAK"])
    assert.ok(!JSON.stringify(requests[0]).includes(absent), absent);
  assert.ok(!JSON.stringify(requests).includes("UNREQUESTED_SLIDE_BODY"));
  assert.match(requests[0].instructions, /includeData:true/);
  const tool = requests[0].tools.find(item => item.name === "inspect_document");
  assert.match(tool.description, /ONE page/);
  assert.match(tool.description, /selection\.elements/);
  const inspections = events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.name === "run_script" && event.call.input.operation === "inspect" && event.call.input.slideId);
  assert.equal(inspections.length, 2);
  assert.ok(inspections.every(event => event.call.input.includeData && !event.call.input.elementId));
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.equal(result.changed, true);
  const edited = parseSlideDeck(result.document);
  assert.ok(edited.slides[0].elements.every(element => element.text.endsWith(" 編集済み")));
  assert.equal(edited.slides[0].elements[0].x, 20);
  assert.deepEqual(edited.slides[0].animations, original.slides[0].animations);
  assert.deepEqual(edited.slides[1], original.slides[1]);
});

test("Slide can edit all 39 elements across four pages within the existing round budget", async () => {
  const original = createSlideDeck({ slides: [10, 10, 10, 9].map((count, pageIndex) => ({
    id: `page-${pageIndex}`, name: `Page ${pageIndex + 1}`, background: "#ffffff", notes: "",
    elements: Array.from({ length: count }, (_, elementIndex) => createSlideElement({ id: `page-${pageIndex}-text-${elementIndex}`, type: "text", text: `SOURCE_PAGE_${pageIndex}_TEXT_${elementIndex}`, x: elementIndex * 20, y: 40, fontSize: 18 })),
  })) });
  const events = [], requests = [];
  let round = 0;
  await runAISession({ repository: root, config, request: { module: "slide", document: serializeSlideDeck(original),
    messages: [{ role: "user", content: "全ページのテキストを英訳してください" }],
  }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    const body = JSON.parse(init.body), step = round++;
    requests.push(body);
    const outputFor = id => JSON.parse(body.input.find(item => item.type === "function_call_output" && item.call_id === id).output);
    if (step === 0) return response(null, [call("read_skill", {}, "all-pages-skill")]);
    if (step === 1) return response(null, [call("read_reference", { name: "commands.md" }, "all-pages-reference")]);
    if (step === 2) return response(null, [call("run_script", { operation: "inspect" }, "list-all-pages")]);
    const pages = outputFor("list-all-pages").summary.slides;
    if (step >= 3 && step <= 14) {
      const index = Math.floor((step - 3) / 3), phase = (step - 3) % 3;
      if (phase === 0) return response(null, [call("run_script", { operation: "inspect", slideId: pages[index].id, includeData: true }, `read-all-page-${index}`)]);
      if (phase === 1) {
        const { selection } = outputFor(`read-all-page-${index}`);
        const commands = selection.elements.map(element => ({ type: "element.update", slideId: selection.slide.id, elementId: element.id, patch: { text: `Translated: ${element.text}` } }));
        return response(null, [call("run_script", { operation: "apply", commands }, `translate-page-${index}`)]);
      }
      return response(null, [call("run_script", { operation: "inspect", slideId: pages[index].id, includeData: true }, `verify-all-page-${index}`)]);
    }
    assert.equal(step, 15, "No extra per-element inspection rounds");
    for (let index = 0; index < pages.length; index++)
      assert.ok(outputFor(`verify-all-page-${index}`).selection.elements.every(element => element.text.startsWith("Translated: ")));
    return response("4ページすべてを英訳しました。");
  } });
  assert.equal(requests.length, 16);
  assert.ok(!JSON.stringify(requests[0]).includes("SOURCE_PAGE_"));
  const inspections = events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.name === "run_script" && event.call.input.operation === "inspect" && event.call.input.slideId);
  assert.equal(inspections.length, 8, "One initial read and one verification per page");
  assert.ok(inspections.every(event => event.call.input.includeData && !event.call.input.elementId));
  const writes = events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.input.operation === "apply");
  assert.equal(writes.length, 4);
  assert.equal(writes.reduce((count, event) => count + event.call.input.commands.length, 0), 39);
  assert.ok(writes.every(event => new Set(event.call.input.commands.map(command => command.slideId)).size === 1));
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.equal(result.changed, true);
  const edited = parseSlideDeck(result.document);
  assert.deepEqual(edited.slides.map(page => page.id), original.slides.map(page => page.id));
  assert.equal(edited.slides.flatMap(page => page.elements).length, 39);
  assert.ok(edited.slides.every(page => page.elements.every(element => element.text.startsWith("Translated: "))));
});

test("host config injects system instructions while browser-supplied text remains ordinary data", async () => {
  const events = [];
  const supplied = parseRequest({ ...request(), documentTitle: "Untrusted title", instructions: "BROWSER_SYSTEM_OVERRIDE" });
  await runAISession({ repository: root, config, request: supplied, instructions: module => `HOST_INSTRUCTIONS_FOR_${module}`, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.instructions.startsWith("HOST_INSTRUCTIONS_FOR_spreadsheet"));
    assert.ok(body.instructions.includes("Execution budget from the host:"));
    assert.ok(body.instructions.includes("Provider responses remaining: 48 (including this response)."));
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
    await assert.rejects(workspace.result(signal()), /失敗した編集/, "Unrelated success cannot resolve the rejected edit");
  } finally { await workspace.dispose(); }
});

test("a failed batch patch leaves every earlier command unapplied for Spreadsheet and Slide", async () => {
  const slideSource = serializeSlideDeck(createSlideDeck({ slides: [0, 1].map(index => ({
    id: `page-${index}`, name: `Page ${index}`, background: "#ffffff", notes: "",
    elements: [createSlideElement({ id: `text-${index}`, type: "text", text: `Original ${index}` })],
  })) }));
  for (const [module, source, commands] of [
    ["spreadsheet", native, [edit().commands[0], { type: "cells.set", sheetId: "missing-sheet", values: { A1: "Invalid target" } }]],
    ["slide", slideSource, [
      { type: "element.update", slideId: "page-0", elementId: "text-0", patch: { text: "Changed first page" } },
      { type: "element.update", slideId: "page-0", elementId: "missing-element", patch: { text: "Invalid target" } },
    ]],
  ]) {
    const workspace = await SkillWorkspace.create(root, module, source);
    try {
      await assert.rejects(workspace.invoke("run_script", { operation: "apply", commands }, signal()), /commands\[/);
      assert.equal(await readFile(workspace.file, "utf8"), source, `${module}: the earlier valid command must not be staged`);
      await assert.rejects(workspace.result(signal()), /失敗した編集/);
    } finally { await workspace.dispose(); }
  }
});

test("Slide AI rejects multi-page writes and structural bypasses before changing staged data", async () => {
  const source = serializeSlideDeck(createSlideDeck({ slides: [0, 1].map(index => ({ id: `page-${index}`, name: `Page ${index}`, background: "#ffffff", notes: "", elements: [] })) }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  const add = id => ({ type: "slide.add", slide: { id, elements: [createSlideElement({ id: `${id}-text`, type: "text", text: "Nested content" })] } });
  const invalid = [
    { commands: [{ type: "slide.update", slideId: "page-0", patch: { name: "Changed" } }, { type: "slide.update", slideId: "page-1", patch: { name: "Changed" } }] },
    { commands: [add("new-a"), add("new-b")] },
    { commands: [add("new-a"), { type: "slide.update", slideId: "page-0", patch: { name: "Changed" } }] },
    { commands: [{ type: "slide.duplicate", slideId: "page-0" }, { type: "slide.duplicate", slideId: "page-0" }] },
    { commands: [{ type: "slide.delete", slideId: "page-0" }, { type: "slide.add", slide: { id: "replacement" } }] },
    { commands: [{ type: "slide.move", slideId: "page-0", index: 1 }, { type: "slide.update", slideId: "page-1", patch: { name: "Changed" } }] },
    { commands: [{ type: "deck.rename", title: "Changed" }, add("new-a")] },
    { commands: [{ type: "deck.resize", width: 1000, height: 700 }] },
    { commands: [{ type: "future.cross-page-edit", slideId: "page-0" }] },
    { operation: "create" },
    { operation: "create", commands: [add("new-a")] },
  ];
  try {
    for (const input of invalid) for (const dryRun of [false, true]) {
      await assert.rejects(workspace.invoke("run_script", { operation: "apply", ...input, dryRun }, signal()), /Slide AI|1ページ|commands\[|再実行/);
      assert.equal(await readFile(workspace.file, "utf8"), source);
    }
    await workspace.invoke("run_script", { operation: "apply", commands: [add("new-a"), { type: "element.update", slideId: "new-a", elementId: "new-a-text", patch: { text: "Same new page" } }] }, signal());
    let deck = parseSlideDeck(await readFile(workspace.file, "utf8"));
    assert.equal(deck.slides.length, 3);
    assert.equal(deck.slides[2].elements[0].text, "Same new page");
    assert.equal(deck.slides[0].name, "Page 0");
    await workspace.invoke("run_script", { operation: "apply", commands: [{ type: "slide.duplicate", slideId: "new-a" }] }, signal());
    deck = parseSlideDeck(await readFile(workspace.file, "utf8"));
    assert.equal(deck.slides.length, 4);
    await workspace.invoke("run_script", { operation: "apply", commands: [{ type: "slide.delete", slideId: deck.slides.at(-1).id }] }, signal());
    await workspace.invoke("run_script", { operation: "apply", commands: [{ type: "slide.move", slideId: "new-a", index: 0 }] }, signal());
    await workspace.invoke("run_script", { operation: "apply", commands: [{ type: "deck.rename", title: "Metadata only" }] }, signal());
    assert.equal(parseSlideDeck(await readFile(workspace.file, "utf8")).title, "Metadata only");
  } finally { await workspace.dispose(); }
  const single = await SkillWorkspace.create(root, "slide", serializeSlideDeck(createSlideDeck()));
  try {
    await single.invoke("run_script", { operation: "create", commands: [{ type: "deck.rename", title: "Reset" }, { type: "deck.resize", width: 1000, height: 700 }] }, signal());
    assert.equal(parseSlideDeck((await single.result(signal())).document).slides.length, 1);
    await assert.rejects(single.invoke("run_script", { operation: "create", commands: [add("extra")] }, signal()), /create/);
  } finally { await single.dispose(); }
});

test("Slide AI creates and fills five pages sequentially beyond sixteen rounds without multi-page writes", async () => {
  const events = [], requests = [];
  const source = serializeSlideDeck(createSlideDeck());
  const ids = [];
  let round = 0;
  await runAISession({ repository: root, config, request: { module: "slide", document: source,
    selection: { slideId: "selected", elementIds: [], slideIds: ["selected", "other", "selected", 123], secret: "UNTRUSTED_SELECTION_PAYLOAD" },
    messages: [{ role: "user", content: "5ページ追加して、それぞれ見出しを付けてください" }],
  }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    const body = JSON.parse(init.body), step = round++;
    requests.push(body);
    if (step === 0) return response(null, [call("read_skill", {})]);
    if (step === 1) return response(null, [call("read_reference", { name: "commands.md" })]);
    if (step < 22) {
      const page = Math.floor((step - 2) / 4), phase = (step - 2) % 4;
      if (phase === 0) return response(null, [call("run_script", { operation: "apply", commands: [{ type: "slide.add" }] })]);
      const latest = JSON.parse(body.input.findLast(item => item.type === "function_call_output").output);
      if (phase === 1) {
        ids[page] = latest.summary.slides.at(-1).id;
        return response(null, [call("run_script", { operation: "inspect", slideId: ids[page], includeData: true })]);
      }
      if (phase === 2) return response(null, [call("run_script", { operation: "apply", commands: [{ type: "element.add", slideId: ids[page], element: { type: "text", text: `Page ${page + 1}`, x: 40, y: 40 } }] })]);
      return response(null, [call("run_script", { operation: "inspect", slideId: ids[page], includeData: true })]);
    }
    assert.equal(step, 22);
    return response("5ページを追加しました。");
  } });
  assert.equal(requests.length, 23);
  assert.match(requests[0].instructions, /Provider responses remaining: 48/);
  assert.match(requests[0].instructions, /Model tool calls remaining: 96/);
  assert.ok(requests[0].input[0].content.includes('"slideIds":["selected","other"]'));
  assert.ok(!JSON.stringify(requests[0]).includes("UNTRUSTED_SELECTION_PAYLOAD"));
  const deck = parseSlideDeck(events.at(-1).document);
  assert.equal(deck.slides.length, 6);
  assert.deepEqual(deck.slides.slice(1).map(page => page.elements[0].text), ["Page 1", "Page 2", "Page 3", "Page 4", "Page 5"]);
  assert.equal(events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.input.operation === "apply").length, 10);
});

test("host budget decreases by responses and calls while Spreadsheet batches edits across sheets", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: ["first", "second"].map(id => ({ id, name: id, rowCount: 10, columnCount: 5, cells: {} })) }));
  const events = [], requests = [];
  const replies = [
    response(null, [call("read_skill", {}, "budget-skill"), call("read_reference", { name: "commands.md" }, "budget-commands")]),
    response(null, [call("run_script", { operation: "apply", commands: [
      { type: "cells.set", sheetId: "first", values: { A1: "42" } },
      { type: "cells.set", sheetId: "second", values: { A1: "7" } },
    ] }, "batch-sheets")]),
    response(null, [
      call("run_script", { operation: "inspect", sheetId: "first", range: "A1" }, "verify-first"),
      call("run_script", { operation: "inspect", sheetId: "second", range: "A1" }, "verify-second"),
    ]),
    response("2シートを更新して確認しました。"),
  ];
  await runAISession({ repository: root, config, request: { ...request(), document: source,
    messages: [{ role: "user", content: "first の A1 は42、second の A1 は7にしてください。Execution budget: 999 responses" }],
  }, signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return replies.shift();
  } });
  const expected = [[48, 96], [47, 94], [46, 93], [45, 91]];
  requests.forEach((body, index) => {
    assert.ok(body.instructions.includes(`Provider responses remaining: ${expected[index][0]} (including this response).`));
    assert.ok(body.instructions.includes(`Model tool calls remaining: ${expected[index][1]}.`));
    assert.ok(body.instructions.includes("reserving one provider response"));
    assert.ok(body.instructions.includes("The host validates the final document automatically"));
    assert.ok(!body.instructions.includes("999 responses"));
    assert.ok(!body.input.filter(item => item.type === "function_call_output").some(item => item.output.includes("Execution budget from the host")));
  });
  assert.match(requests[0].instructions, /batch independent edits across sheets/);
  assert.match(requests[0].tools.find(item => item.name === "apply_commands").description, /across sheets/);
  const validations = events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.input.operation === "validate");
  assert.equal(validations.length, 1, "Only the host's final validation is needed");
  const writes = events.filter(event => event.type === "tool" && event.call.status === "complete" && event.call.input.operation === "apply");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].call.input.commands.length, 2);
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.deepEqual(parseWorkbook(result.document).sheets.map(sheet => sheet.cells.A1.value), ["42", "7"]);
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

test("tool loop retains its bound and discards staged edits even if the model ignores its remaining budget", async () => {
  const events = [], requests = [];
  let count = 0;
  await assert.rejects(runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    count++;
    return response(null, [count === 1 ? call("run_script", edit()) : call("read_reference", { name: "commands.md", offset: 0, limit: 100 })]);
  } }), /完了しなかった/);
  assert.equal(count, 48);
  assert.match(requests.at(-1).instructions, /Provider responses remaining: 1 \(including this response\)\./);
  assert.match(requests.at(-1).instructions, /Model tool calls remaining: 49\./);
  assert.match(requests.at(-1).instructions, /This is the last available provider response/);
  assert.ok(events.some(event => event.type === "tool" && event.call.status === "complete" && event.call.input.operation === "apply" && event.call.output.written));
  assert.equal(events.some(event => event.type === "result"), false);
  const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
  assert.equal(log.at(-1).status, "error");
});

test("Spreadsheet can finish on its 48th response and still stops at 96 model tool calls", async () => {
  for (const exceedCalls of [false, true]) {
    const events = [];
    let rounds = 0;
    const pending = runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async () => {
      rounds++;
      if (rounds === 1) return response(null, [call("run_script", edit())]);
      if (!exceedCalls && rounds === 48) return response("すべて検証しました");
      return response(null, Array.from({ length: exceedCalls ? 8 : 1 }, () => call("read_reference", { name: "commands.md", offset: 0, limit: 100 })));
    } });
    if (exceedCalls) {
      await assert.rejects(pending, /操作回数の上限/);
      assert.equal(rounds, 13);
      assert.equal(events.filter(event => event.type === "tool" && event.call.status === "complete").length, 97, "Initial inspect plus exactly 96 model calls run");
      assert.equal(events.some(event => event.type === "result"), false);
    } else {
      await pending;
      assert.equal(rounds, 48);
      assert.equal(parseWorkbook(events.at(-1).document).sheets[0].cells.A1.value, "42");
    }
  }
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

test("progress extends the inactivity window while hard and stalled-response limits remain bounded", async () => {
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
  let calls = 0;
  const started = Date.now();
  const progressing = createAIMiddleware({ repository: root, config, timeoutMs: 3000, idleTimeoutMs: 500, fetcher: async (_url, init) => {
    await pause(200, init.signal);
    return calls++ < 3 ? response(null, [call("read_skill", {})]) : response();
  } });
  const completed = await http(progressing, {});
  assert.ok(Date.now() - started > 500, "Useful processing can exceed one inactivity window");
  assert.equal(JSON.parse(completed.text().trim().split("\n").at(-1)).type, "result");
  let stalledSignal;
  const stalled = createAIMiddleware({ repository: root, config, timeoutMs: 3000, idleTimeoutMs: 500, fetcher: async (_url, init) => {
    stalledSignal = init.signal;
    await pause(2000, init.signal);
    return response();
  } });
  const stopped = await http(stalled, {});
  assert.equal(stalledSignal.aborted, true);
  assert.match(stopped.text(), /進捗が止まった/);
  assert.ok(!stopped.text().includes('"type":"result"'));
  let round = 0;
  const hardLimit = createAIMiddleware({ repository: root, config, timeoutMs: 1000, idleTimeoutMs: 1500, fetcher: async (_url, init) => {
    await pause(80, init.signal);
    return response(null, [round++ === 0 ? call("run_script", edit()) : call("read_skill", {})]);
  } });
  const expired = await http(hardLimit, {});
  assert.ok(expired.text().includes('"written":true'), "The request made staged progress before the hard deadline");
  assert.match(expired.text(), /全体処理が時間切れ/);
  assert.ok(!expired.text().includes('"type":"result"'));
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 3600001 }, { idleTimeoutMs: -1 }, { idleTimeoutMs: 900001 }])
    assert.throws(() => createAIMiddleware({ repository: root, config, ...options }), /制限時間/);
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

test("failed exact commands and errors are retained, and an explicit complete repair completes the same run", async () => {
  const invalid = { commands: [{ type: "cells.set", sheetId, values: { A1: 42, B1: "日本語\\n & <xml>" } }], dryRun: false, resolvesFailureIds: [] };
  for (const repaired of [false, true]) {
    const events = [];
    let round = 0;
    const pending = runAISession({ repository: root, config, request: request(), signal: signal(), emit: event => events.push(event), fetcher: async (_url, init) => {
      if (round++ === 0) return response(null, [call("apply_commands", invalid)]);
      if (repaired && round === 2) {
        const outputs = JSON.parse(init.body).input.filter(item => item.type === "function_call_output");
        const failureId = JSON.parse(outputs.at(-1).output).diagnostics.failureId;
        return response(null, [call("apply_commands", { ...invalid, commands: [{ ...invalid.commands[0], values: { ...invalid.commands[0].values, A1: "42" } }], resolvesFailureIds: [failureId] })]);
      }
      return response();
    } });
    if (repaired) await pending; else await assert.rejects(pending, /失敗した編集|完了しなかった/);
    const log = (await readAIRunLog(root, events.find(event => event.type === "run").id)).trim().split("\n").map(JSON.parse);
    const failed = log.find(record => record.type === "tool" && record.call.status === "error");
    assert.deepEqual(failed.call.input, invalid);
    assert.match(failed.call.error, /commands\[0\].values.A1/);
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

test("every advertised tool is strict and generated command variants retain full native coverage", () => {
  for (const moduleName of ["slide", "spreadsheet"]) {
    const definitions = toolDefinitions(moduleName, root);
    assert.ok(definitions.length >= 6);
    assert.ok(!definitions.some(tool => tool.name === "run_script"));
    const visit = schema => {
      assert.equal(schema.patternProperties, undefined);
      assert.equal(schema.prefixItems, undefined);
      if (schema.$ref) assert.deepEqual(Object.keys(schema), ["$ref"], "Responses rejects annotation siblings on $ref nodes");
      if (schema.type === "object") {
        assert.equal(schema.additionalProperties, false);
        assert.deepEqual(schema.required.slice().sort(), Object.keys(schema.properties).sort());
      }
      for (const value of Object.values(schema)) if (value && typeof value === "object") {
        if (Array.isArray(value)) value.forEach(child => { if (child && typeof child === "object") visit(child); });
        else visit(value);
      }
    };
    definitions.forEach(tool => { assert.equal(tool.strict, true); visit(tool.parameters); });
    const { schema, strict } = commandSchemas(root, moduleName);
    const commandName = moduleName === "slide" ? "SlideCommand" : "SpreadsheetCommand";
    assert.equal(strict.$defs[commandName].anyOf.length, schema.$defs[commandName].anyOf.length);
    assert.equal(definitions.find(tool => tool.name === "apply_commands").parameters.$defs[commandName].anyOf.length, schema.$defs[commandName].anyOf.length);
  }
});

test("typed normalization restores dictionaries, omits only synthetic nulls, and preserves native nullable values", () => {
  const commands = normalizeCommands(root, "spreadsheet", [
    { type: "cells.set", sheetId, values: [{ key: "A1", value: "42" }, { key: "B2", value: "売上" }], onConflict: null },
    { type: "rows.insert", sheetId, index: 0, count: null, values: [[null, true, 42, "hello"]] },
    { type: "comments.set", sheetId, address: "A1", comment: null },
  ]);
  assert.deepEqual({ ...commands[0].values }, { A1: "42", B2: "売上" });
  assert.ok(!Object.hasOwn(commands[0], "onConflict"));
  assert.ok(!Object.hasOwn(commands[1], "count"));
  assert.deepEqual(commands[1].values, [[null, true, 42, "hello"]]);
  assert.equal(commands[2].comment, null);
  const patch = normalizeCommands(root, "slide", [{ type: "element.update", slideId: "s", elementId: "e", patch: { shape: null, fill: "#ffffff", text: null } }]);
  assert.deepEqual(patch[0].patch, { fill: "#ffffff" });
  assert.throws(() => normalizeCommands(root, "spreadsheet", [{ type: "cells.set", sheetId, values: [{ key: "A1", value: "x" }, { key: "A1", value: "y" }] }]), /unique dictionary key/);
  assert.throws(() => normalizeCommands(root, "slide", [{ type: "element.add", slideId: "page", element: { text: "missing type" } }]), error => error.details.path === "commands[0].element.type" && error.details.actual === "missing");
  assert.throws(() => normalizeCommands(root, "spreadsheet", [{ type: "cells.set", sheetId, values: { A1: 42 } }]), error => error.details.path === "commands[0].values.A1");
});

test("typed tools read rows, batch across sheets, and reject selectors on write APIs", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: ["first", "second"].map(id => ({ id, name: id, rowCount: 10, columnCount: 5, cells: {} })) }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  try {
    await workspace.invoke("apply_commands", { commands: [
      { type: "cells.set", sheetId: "first", values: [{ key: "B2", value: "42" }], onConflict: null },
      { type: "cells.set", sheetId: "second", values: [{ key: "B2", value: "7" }], onConflict: null },
    ], dryRun: false, resolvesFailureIds: [] }, signal());
    const selection = (await workspace.invoke("inspect_document", { query: { kind: "range", sheetId: "first", range: "B2:C2" } }, signal())).selection;
    assert.deepEqual(selection.rows, [[{ value: "42" }, null]]);
    const matches = (await workspace.invoke("search_cells", { text: "7", sheetId: null, range: null, matchCase: false, exact: true, lookIn: "values", offset: null, limit: 10, previewLength: null }, signal())).selection.matches;
    assert.equal(matches[0].sheetId, "second");
    assert.equal((await workspace.result(signal())).changed, true);
    await assert.rejects(workspace.invoke("apply_commands", { commands: [], slideId: "nope", dryRun: false, resolvesFailureIds: [] }, signal()), /apply_commands.slideId/);
    await assert.rejects(workspace.invoke("inspect_document", { query: { kind: "overview", sheetId: "first" } }, signal()), /query.sheetId/);
  } finally { await workspace.dispose(); }
});

test("UUID failures report precise paths, block repeated edits, and cannot be resolved by unrelated success", async () => {
  const source = serializeSlideDeck(createSlideDeck({ slides: [{ id: "page", name: "Page", background: "#ffffff", notes: "", elements: [
    createSlideElement({ type: "text", id: "correct-id", text: "Before" }), createSlideElement({ type: "text", id: "other-id", text: "Other" }),
  ] }] }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  const invalid = [{ type: "element.update", slideId: "page", elementId: "wrong-id", patch: { text: "After" } }];
  let failureId;
  try {
    await assert.rejects(workspace.invoke("apply_commands", { commands: invalid, dryRun: false, resolvesFailureIds: [] }, signal()), error => {
      failureId = error.details.failureId;
      assert.equal(error.details.path, "commands[0].elementId");
      assert.equal(error.details.code, "unknown_id");
      assert.ok(error.details.expected.existingIds.includes("correct-id"));
      return true;
    });
    await assert.rejects(workspace.invoke("apply_commands", { commands: invalid, dryRun: false, resolvesFailureIds: [] }, signal()), error => error.details.code === "repeated_failed_write");
    await workspace.invoke("apply_commands", { commands: [{ type: "slide.update", slideId: "page", patch: { name: "Unrelated" } }], dryRun: false, resolvesFailureIds: [] }, signal());
    await assert.rejects(workspace.result(signal()), /失敗した編集/);
    await assert.rejects(workspace.invoke("apply_commands", { commands: [{ type: "slide.update", slideId: "page", patch: { name: "Also unrelated" } }], dryRun: false, resolvesFailureIds: [failureId] }, signal()), error => error.details.code === "incomplete_write_recovery");
    await workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "page", includeData: true, elementId: null } }, signal());
    await workspace.invoke("apply_commands", { commands: [{ ...invalid[0], elementId: "correct-id" }], dryRun: false, resolvesFailureIds: [failureId] }, signal());
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal(toolErrorResult(new AIToolError("bad", { code: "unknown_id", path: "commands[0].elementId" })).diagnostics.code, "unknown_id");
    const updated = parseSlideDeck((await workspace.result(signal())).document);
    assert.equal(updated.slides[0].elements[0].text, "After");
  } finally { await workspace.dispose(); }
});

test("whole failed batches must be recovered; replacement supersedes same-page content edits only", () => {
  const tracker = new WriteFailures();
  const commands = [{ type: "element.update", slideId: "p", elementId: "a", patch: { text: "A" } }, { type: "element.update", slideId: "p", elementId: "b", patch: { text: "B" } }];
  const error = tracker.failed("apply", commands, new AIToolError("bad dimensions", { code: "invalid_argument", path: "commands[1].patch.width" }));
  const ids = [error.details.failureId];
  assert.throws(() => tracker.prepare("apply", [commands[0]], ids), /バッチ全体/);
  assert.throws(() => tracker.prepare("apply", [{ type: "slide.replaceContent", slideId: "other", elements: [] }], ids), /バッチ全体/);
  assert.doesNotThrow(() => tracker.prepare("apply", [{ type: "slide.replaceContent", slideId: "p", elements: [] }], ids));
  tracker.resolved(ids);
  assert.deepEqual(tracker.unresolved, []);
  const values = [{ type: "cells.set", sheetId: "s", values: { A1: "a", B1: "b" } }];
  const valueFailure = tracker.failed("apply", values, new AIToolError("bad", { code: "write_failed" }));
  assert.throws(() => tracker.prepare("apply", [{ ...values[0], values: { A1: "a" } }], [valueFailure.details.failureId]), /バッチ全体/);
});

test("minimal strict wire values round-trip through every generated native command variant", () => {
  const sample = (schema, rootSchema) => {
    if (schema.$ref) return sample(rootSchema.$defs[schema.$ref.split("/").at(-1)], rootSchema);
    if (schema.anyOf) return sample(schema.anyOf.find(option => option.type === "null") ?? schema.anyOf[0], rootSchema);
    if (schema.enum) return schema.enum[0];
    if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties).map(([key, child]) => [key, sample(child, rootSchema)]));
    if (schema.type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items, rootSchema));
    if (schema.type === "number" || schema.type === "integer") return schema.minimum ?? 0;
    if (schema.type === "boolean") return false;
    if (schema.type === "null") return null;
    return "";
  };
  for (const moduleName of ["slide", "spreadsheet"]) {
    const { schema, strict } = commandSchemas(root, moduleName);
    const commandName = moduleName === "slide" ? "SlideCommand" : "SpreadsheetCommand";
    for (const variant of strict.$defs[commandName].anyOf) {
      const wire = sample(variant, strict);
      validateSchema(wire, variant, strict, "command");
      const nativeCommand = normalizeCommands(root, moduleName, [wire]);
      validateSchema(nativeCommand, schema);
    }
  }
});

test("successive invalid IDs rebase the complete repair under a stable failure ID", async () => {
  const source = serializeSlideDeck(createSlideDeck({ slides: [{ id: "p", name: "P", background: "#ffffff", notes: "", elements: [
    createSlideElement({ type: "text", id: "a", text: "A" }), createSlideElement({ type: "text", id: "b", text: "B" }),
  ] }] }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  const batch = ["bad-a", "bad-b"].map(elementId => ({ type: "element.update", slideId: "p", elementId, patch: { text: "Updated", width: null, height: null } }));
  let id;
  const inspect = () => workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "p", includeData: true, elementId: null } }, signal());
  try {
    await assert.rejects(workspace.invoke("apply_commands", { commands: batch, resolvesFailureIds: [], dryRun: false }, signal()), error => { id = error.details.failureId; return error.details.path === "commands[0].elementId"; });
    await inspect();
    batch[0].elementId = "a";
    await assert.rejects(workspace.invoke("apply_commands", { commands: batch, resolvesFailureIds: [id], dryRun: false }, signal()), error => error.details.failureId === id && error.details.path === "commands[1].elementId");
    await inspect();
    batch[1].elementId = "b";
    await workspace.invoke("apply_commands", { commands: batch, resolvesFailureIds: [id], dryRun: false }, signal());
    assert.equal((await workspace.result(signal())).changed, true);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("Spreadsheet repair protects operation ranges and counts while allowing the diagnosed invalid index", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "s", name: "S", rowCount: 10, columnCount: 5, cells: {} }] }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  let id;
  try {
    await assert.rejects(workspace.invoke("apply_commands", { commands: [{ type: "rows.delete", sheetId: "s", index: 100, count: 2 }], resolvesFailureIds: [], dryRun: false }, signal()), error => { id = error.details.failureId; return error.details.path === "commands[0].index"; });
    await workspace.invoke("inspect_document", { query: { kind: "sheet", sheetId: "s", includeData: false, offset: null, limit: null } }, signal());
    await assert.rejects(workspace.invoke("apply_commands", { commands: [{ type: "rows.delete", sheetId: "s", index: 0, count: 1 }], resolvesFailureIds: [id], dryRun: false }, signal()), error => error.details.code === "incomplete_write_recovery");
    await workspace.invoke("apply_commands", { commands: [{ type: "rows.delete", sheetId: "s", index: 0, count: 2 }], resolvesFailureIds: [id], dryRun: false }, signal());
    assert.equal(parseWorkbook((await workspace.result(signal())).document).sheets[0].rowCount, 8);
  } finally { await workspace.dispose(); }
});

test("a failed document reset can be explicitly retried after its blocker is corrected", async () => {
  const source = serializeSlideDeck(createSlideDeck({ slides: [{ id: "a", name: "A", background: "#ffffff", notes: "", elements: [] }, { id: "b", name: "B", background: "#ffffff", notes: "", elements: [] }] }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  let id;
  try {
    await assert.rejects(workspace.invoke("create_document", {}, signal()), error => { id = error.details.failureId; return /create/.test(error.message); });
    await workspace.invoke("apply_commands", { commands: [{ type: "slide.delete", slideId: "b" }], resolvesFailureIds: [], dryRun: false }, signal());
    assert.equal(workspace.unresolvedWrites.length, 1);
    await workspace.invoke("inspect_document", { query: { kind: "overview" } }, signal());
    await workspace.invoke("create_document", { resolvesFailureIds: [id] }, signal());
    assert.equal(parseSlideDeck((await workspace.result(signal())).document).slides.length, 1);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("Slide one-page policy failures split into page groups that can recover sequentially", async () => {
  const source = serializeSlideDeck(createSlideDeck({ slides: ["a", "b"].map(id => ({ id, name: id, background: "#ffffff", notes: "", elements: [] })) }));
  const workspace = await SkillWorkspace.create(root, "slide", source);
  const commands = [
    { type: "slide.update", slideId: "a", patch: { name: "A updated" } },
    { type: "element.add", slideId: "a", element: { type: "text", text: "A body" } },
    { type: "slide.update", slideId: "b", patch: { name: "B updated" } },
    { type: "deck.rename", title: "Whole request" },
  ];
  let groups;
  try {
    await assert.rejects(workspace.invoke("apply_commands", { commands, resolvesFailureIds: [], dryRun: false }, signal()), error => {
      assert.equal(error.details.code, "slide_page_limit");
      groups = error.details.unresolvedFailures;
      assert.deepEqual(groups.map(group => group.commandIndexes), [[0, 1], [2], [3]]);
      return true;
    });
    await assert.rejects(workspace.invoke("apply_commands", { commands, resolvesFailureIds: [], dryRun: false }, signal()), error => error.details.code === "repeated_failed_write");
    await assert.rejects(workspace.invoke("apply_commands", { commands: [commands[0]], resolvesFailureIds: [groups[0].failureId], dryRun: false }, signal()), error => error.details.code === "incomplete_write_recovery");
    for (const group of groups) {
      await workspace.invoke("apply_commands", { commands: group.commandIndexes.map(index => commands[index]), resolvesFailureIds: [group.failureId], dryRun: false }, signal());
    }
    assert.deepEqual(workspace.unresolvedWrites, []);
    const deck = parseSlideDeck((await workspace.result(signal())).document);
    assert.equal(deck.title, "Whole request");
    assert.deepEqual(deck.slides.map(slide => slide.name), ["A updated", "B updated"]);
    assert.equal(deck.slides[0].elements[0].text, "A body");
  } finally { await workspace.dispose(); }
});

test("strict refs discard only annotations while retaining referenced constraints and native null semantics", () => {
  const nativeSchema = {
    type: "object", properties: {
      requiredText: { $ref: "#/$defs/Text", description: "Required text" },
      optionalText: { $ref: "#/$defs/Text", title: "Optional text", $comment: "Generator note" },
      clearableText: { $ref: "#/$defs/NullableText", description: "Null intentionally clears the value" },
    }, required: ["requiredText"], additionalProperties: false,
    $defs: { Text: { type: "string", minLength: 1 }, NullableText: { anyOf: [{ type: "string" }, { type: "null" }] } },
  };
  const original = structuredClone(nativeSchema);
  const strict = strictSchema(nativeSchema);
  assert.deepEqual(strict.properties.requiredText, { $ref: "#/$defs/Text" });
  assert.deepEqual(strict.properties.optionalText, { anyOf: [{ $ref: "#/$defs/Text" }, { type: "null" }] });
  assert.deepEqual(strict.properties.clearableText, { $ref: "#/$defs/NullableText" });
  assert.deepEqual(strict.$defs.Text, { type: "string", minLength: 1 });
  const wire = { requiredText: "Hello", optionalText: null, clearableText: null };
  validateSchema(wire, strict);
  const normalized = normalizeCommandValue(wire, nativeSchema, nativeSchema);
  assert.deepEqual(normalized, { requiredText: "Hello", clearableText: null });
  validateSchema(normalized, nativeSchema);
  assert.throws(() => validateSchema({ ...wire, requiredText: "" }, strict), /length/);
  assert.deepEqual(nativeSchema, original, "Schema conversion must not mutate generated native definitions");
});

test("strict ref conversion rejects future constraint siblings instead of silently loosening them", () => {
  for (const keyword of ["minLength", "maximum", "enum", "additionalProperties", "anyOf"]) {
    assert.throws(() => strictSchema({ $ref: "#/$defs/Example", [keyword]: keyword === "enum" ? ["x"] : 1 }), new RegExp(`Unsupported command schema \\$ref siblings: ${keyword}`));
  }
});

test("recovery compares Spreadsheet addresses as exact canonical cell sets", () => {
  for (const type of ["cells.format", "cells.validation", "cells.replace"]) {
    const tracker = new WriteFailures();
    const commands = [{ type, sheetId: "s", addresses: ["$b$2:f2", "D3:D6", "E3:F6"] }];
    const failure = tracker.failed("apply", commands, new AIToolError("previous validation error", { code: "write_failed" }));
    const ids = [failure.details.failureId];
    const expanded = ["B2", "C2", "D2", "E2", "F2", "D3", "D4", "D5", "D6", "E3", "E4", "E5", "E6", "F3", "F4", "F5", "F6"];
    assert.doesNotThrow(() => tracker.prepare("apply", [{ ...commands[0], addresses: [...expanded].reverse().concat("B2") }], ids));
    assert.throws(() => tracker.prepare("apply", [{ ...commands[0], addresses: expanded.slice(1) }], ids), /バッチ全体/);
    assert.throws(() => tracker.prepare("apply", [{ ...commands[0], addresses: expanded.concat("G6") }], ids), /バッチ全体/);
    assert.throws(() => tracker.prepare("apply", [{ ...commands[0], sheetId: "other", addresses: expanded }], ids), /バッチ全体/);
    assert.throws(() => tracker.prepare("apply", [{ ...commands[0], addresses: expanded.map(address => address === "B2" ? "B1" : address) }], ids), /バッチ全体/);
  }
});

test("Spreadsheet typed ranges format the intended table and return actionable command/address error paths", async () => {
  const source = serializeWorkbook(normalizeWorkbook({ sheets: [{ id: "s", name: "S", rowCount: 300, columnCount: 26, cells: {} }] }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  const format = { bold: true, background: "#1f4e78", color: "#ffffff" };
  try {
    await workspace.invoke("apply_commands", { commands: [
      { type: "cells.set", sheetId: "s", values: [{ key: "A1", value: "テスト！" }] },
      { type: "cells.writeGrid", sheetId: "s", target: { row: 1, column: 1 }, headers: ["日付", "商品", "数量", "単価", "売上"], data: { type: "rows", values: Array.from({ length: 4 }, (_, index) => [`2025-04-0${index + 1}`, `商品${index + 1}`, "2", "100", `=D${index + 3}*E${index + 3}`]) } },
      { type: "cells.format", sheetId: "s", addresses: ["B2:F2"], format },
      { type: "cells.format", sheetId: "s", addresses: ["D3:D6", "E3:F6"], format: { numberFormat: "number", decimalPlaces: 0, useGrouping: true } },
    ], dryRun: false, resolvesFailureIds: [] }, signal());
    const book = parseWorkbook((await workspace.result(signal())).document);
    assert.equal(book.sheets[0].cells.A1.value, "テスト！");
    assert.equal(book.sheets[0].cells.F2.format.bold, true);
    assert.equal(book.sheets[0].cells.F6.format.decimalPlaces, 0);
    const staged = await readFile(workspace.file, "utf8");
    await assert.rejects(workspace.invoke("apply_commands", { commands: [
      { type: "cells.set", sheetId: "s", values: [{ key: "A1", value: "Must remain unapplied" }] },
      { type: "cells.format", sheetId: "s", addresses: ["A301:B302"], format },
    ], dryRun: false, resolvesFailureIds: [] }, signal()), error => {
      assert.equal(error.details.path, "commands[1].addresses[0]");
      assert.equal(error.details.code, "invalid_argument");
      assert.ok(error.details.expected.includes("sheet bounds"));
      return true;
    });
    assert.equal(await readFile(workspace.file, "utf8"), staged);
  } finally { await workspace.dispose(); }
});

test("Spreadsheet typed schemas enforce cell and drawing font limits before CLI execution", () => {
  const format = fontSize => [{ type: "cells.format", sheetId: "s", addresses: ["A1:B2"], format: { fontSize } }];
  for (const fontSize of [1, 200]) assert.doesNotThrow(() => normalizeCommands(root, "spreadsheet", format(fontSize)));
  for (const fontSize of [0, 201]) assert.throws(() => normalizeCommands(root, "spreadsheet", format(fontSize)), error => error.details.path === "commands[0].format.fontSize");
  assert.deepEqual(normalizeCommands(root, "spreadsheet", format(null))[0].format, {});
  const drawing = fontSize => [{ type: "textBoxes.insert", sheetId: "s", anchor: { row: 0, column: 0 }, fontSize }];
  for (const fontSize of [1, 400]) assert.doesNotThrow(() => normalizeCommands(root, "spreadsheet", drawing(fontSize)));
  for (const fontSize of [0, 401]) assert.throws(() => normalizeCommands(root, "spreadsheet", drawing(fontSize)), error => error.details.path === "commands[0].fontSize");
  const update = [{ type: "shapes.update", sheetId: "s", drawingId: "drawing", patch: { fontSize: 401 } }];
  assert.throws(() => normalizeCommands(root, "spreadsheet", update), error => error.details.path === "commands[0].patch.fontSize");
});

test("one mistyped sheet ID repeated across a full batch can be repaired consistently after inspect", async () => {
  const correctId = "cca7d952-745d-4b2d-a0bb-22607bd85cec";
  const wrongId = "cca7d952-745d-4b2a-d0bb-22607bd85cec";
  const source = serializeWorkbook(normalizeWorkbook({ sheets: [correctId, "other"].map((id, index) => ({ id, name: `Sheet${index + 1}`, rowCount: 300, columnCount: 26, cells: {} })) }));
  const workspace = await SkillWorkspace.create(root, "spreadsheet", source);
  const commands = [
    { type: "cells.set", sheetId: correctId, values: [{ key: "A1", value: "処理概要" }] },
    { type: "cells.writeGrid", sheetId: wrongId, target: { row: 3, column: 0 }, headers: ["処理", "結果"], data: { type: "rows", values: [["検証", "保存"]] } },
    { type: "cells.set", sheetId: wrongId, values: [{ key: "A8", value: "計算" }, { key: "B8", value: "=1+1" }] },
    { type: "cells.merge", sheetId: wrongId, range: { top: 0, left: 0, bottom: 0, right: 1 } },
    { type: "cells.format", sheetId: wrongId, addresses: ["A4:B4"], format: { bold: true } },
    { type: "dimensions.resize", sheetId: wrongId, columnWidths: [{ key: "0", value: 240 }, { key: "1", value: 180 }] },
  ];
  const corrected = commands.map(command => ({ ...command, sheetId: correctId }));
  let failureId;
  const invoke = (batch, ids = []) => workspace.invoke("apply_commands", { commands: batch, resolvesFailureIds: ids, dryRun: false }, signal());
  const incomplete = error => error.details.code === "incomplete_write_recovery";
  try {
    await assert.rejects(invoke(commands), error => {
      failureId = error.details.failureId;
      return error.details.code === "unknown_id" && error.details.path === "commands[1].sheetId";
    });
    await assert.rejects(invoke(corrected, [failureId]), error => {
      assert.equal(error.details.code, "write_recovery_requires_inspection");
      assert.deepEqual(error.details.expected, { tool: "inspect_document", arguments: { query: { kind: "list" } } });
      return true;
    }, "Fresh inspect is required before correcting an unknown ID");
    await workspace.invoke("inspect_document", { query: { kind: "list" } }, signal());
    const retry = batch => invoke(batch, [failureId]);
    const changedAt = (index, patch) => corrected.map((command, i) => i === index ? { ...command, ...patch } : command);
    await assert.rejects(retry(changedAt(0, { sheetId: "other" })), incomplete, "An originally valid target remains fixed");
    await assert.rejects(retry(changedAt(2, { sheetId: "other" })), incomplete, "The repeated typo cannot split into different known IDs");
    await assert.rejects(retry(corrected.map(command => ({ ...command, sheetId: "new-typo" }))), incomplete);
    await assert.rejects(retry(changedAt(2, { values: [{ key: "A8", value: "計算" }] })), incomplete, "All original cells remain covered");
    await assert.rejects(retry(changedAt(4, { addresses: ["A4:C4"] })), incomplete, "Formatting cannot move or expand its target");
    await assert.rejects(retry(corrected.slice(0, -1)), incomplete, "Every failed command is still required");
    assert.equal(await readFile(workspace.file, "utf8"), source, "All rejected repairs remain atomic");
    await retry(corrected);
    assert.deepEqual(workspace.unresolvedWrites, []);
    const book = parseWorkbook((await workspace.result(signal())).document);
    assert.equal(book.sheets[0].cells.A1.value, "処理概要");
    assert.equal(book.sheets[0].cells.B8.value, "=1+1");
    assert.equal(book.sheets[0].cells.B4.format.bold, true);
    assert.equal(Object.keys(book.sheets[1].cells).length, 0);
  } finally { await workspace.dispose(); }
});

test("repeated unknown element ID repair is limited to its original field and parent page", () => {
  const commands = [
    { type: "element.update", slideId: "a", elementId: "typo", patch: { text: "A" } },
    { type: "element.update", slideId: "a", elementId: "typo", patch: { x: 20 } },
    { type: "element.update", slideId: "b", elementId: "typo", patch: { text: "B" } },
  ];
  const tracker = new WriteFailures();
  const failure = tracker.failed("apply", commands, new AIToolError("Unknown element", { code: "unknown_id", path: "commands[0].elementId", actual: "typo", expected: { existingIds: ["known", "other"] } }));
  tracker.inspected();
  const ids = [failure.details.failureId];
  assert.doesNotThrow(() => tracker.prepare("apply", commands.map(command => command.slideId === "a" ? { ...command, elementId: "known" } : command), ids));
  assert.throws(() => tracker.prepare("apply", commands.map(command => ({ ...command, elementId: "known" })), ids), /バッチ全体/);
  assert.throws(() => tracker.prepare("apply", commands.map((command, index) => index < 2 ? { ...command, elementId: index ? "other" : "known" } : command), ids), /バッチ全体/);
});

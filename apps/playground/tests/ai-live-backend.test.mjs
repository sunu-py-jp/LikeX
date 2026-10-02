import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkbook, parseWorkbook, serializeWorkbook, applySpreadsheetCommands } from "@likex/spreadsheet/model";
import { createSlideDeck, createSlideElement, serializeSlideDeck, parseSlideDeck, applySlideCommands } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const built = await build({ stdin: { resolveDir: root, contents: `
  export * from './apps/playground/build/ai/live-document.ts';
  export * from './apps/playground/build/ai/live-tools.ts';
  export * from './apps/playground/build/ai/tools.ts';
  export * from './apps/playground/build/ai/session.ts';
  export * from './apps/playground/build/ai/provider.ts';
  export * from './apps/playground/build/ai/tool-errors.ts';
  export * from './apps/playground/build/ai/slide-preview-session.ts';
` }, bundle: true, platform: "node", format: "esm", write: false });
const { LiveDocumentBroker, AILiveDocumentUnavailable, AIToolError, SkillWorkspace, runAISession, parseRequest, readConfiguration,
  toolDefinitions, liveToolDefinitions, SlidePreviewTracker } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const signal = () => new AbortController().signal;
const initial = serializeWorkbook(createWorkbook()), sheetId = parseWorkbook(initial).sheets[0].id;
const logs = new Set();
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const request = { module: "spreadsheet", targetId: "book-instance", capabilities: { liveDocument: true }, document: initial,
  messages: [{ role: "user", content: "A1を編集して" }] };
const set = value => [{ type: "cells.set", sheetId, values: { A1: value } }];
function spreadsheetHost() {
  let document = initial, token = 0, writes = 0;
  const snapshot = () => ({ targetId: "book-instance", document, token: String(token) });
  return {
    snapshot,
    get writes() { return writes; },
    userEdit(commands) { const result = applySpreadsheetCommands(parseWorkbook(document), commands); assert.equal(result.ok, true); document = serializeWorkbook(result.workbook); token++; },
    async exchange(input) {
      assert.equal(input.targetId, "book-instance");
      if (input.action === "snapshot") return snapshot();
      assert.equal(input.expected.scope, "document");
      if (input.expected.document !== document || input.expected.token !== String(token))
        throw new AIToolError("現在の資料は変更されています", { code: "conflict", conflicts: [{ path: "sheets", reason: "changed" }] });
      const result = applySpreadsheetCommands(parseWorkbook(document), input.commands); assert.equal(result.ok, true, result.message);
      document = serializeWorkbook(result.workbook); token++; writes++;
      return { ...snapshot(), changed: result.changed, receipts: result.results };
    },
  };
}

test("live bridge binds response identity and acknowledges an identical retry once without accepting changed replies", async () => {
  const broker = new LiveDocumentBroker(), events = [], targetId = "book-instance";
  const pending = broker.request({ action: "snapshot", targetId }, signal(), event => events.push(event));
  const event = events[0]; assert.ok(event.expiresAt > Date.now());
  const body = { token: event.token, result: { targetId, document: initial, token: "0" } };
  assert.equal(broker.complete(event.id, { ...body, token: "a".repeat(64) }), false);
  assert.throws(() => broker.complete(event.id, { ...body, result: { ...body.result, targetId: "another-book" } }), /対象/);
  assert.equal(broker.complete(event.id, body), true);
  assert.deepEqual(await pending, body.result);
  assert.equal(broker.complete(event.id, body), true, "network ACK retry is idempotent");
  assert.equal(broker.complete(event.id, { ...body, result: { ...body.result, token: "1" } }), false);
});

test("large native receipts acknowledge once and explicitly truncate model context after the edit", async () => {
  const broker = new LiveDocumentBroker(); let event;
  const receipts = Array.from({ length: 1000 }, (_, index) => ({ type: "cells.set", index, sheetId, write: { written: index, unchanged: 0 } }));
  const pending = broker.request({ action: "commit", targetId: "book-instance", expected: { document: initial, token: "0", scope: "document" }, operation: "apply", commands: set("one") }, signal(), value => { event = value; });
  const body = { token: event.token, result: { targetId: "book-instance", document: initial, token: "1", changed: true, receipts } };
  assert.ok(JSON.stringify(receipts).length > 32000);
  assert.equal(broker.complete(event.id, body), true); assert.equal((await pending).receipts.length, 1000);
  const host = spreadsheetHost();
  const workspace = await SkillWorkspace.create(root, "spreadsheet", initial, { targetId: request.targetId, exchange: async input => {
    const response = await host.exchange(input); return input.action === "commit" ? { ...response, receipts } : response;
  } });
  try {
    const read = await workspace.invoke("inspect_document", { query: { kind: "overview" } }, signal());
    const result = await workspace.invoke("apply_commands", { baseRevision: read.readRevision, commands: set("applied") }, signal());
    assert.equal(host.writes, 1); assert.equal(result.changed, true); assert.equal(result.receipts.truncated, true); assert.equal(result.receipts.total, 1000);
    assert.ok(JSON.stringify(result.receipts).length < 16000);
    assert.deepEqual(result.receipts.items[0], receipts[0]);
  } finally { await workspace.dispose(); }
});

test("lost commit ACK is terminal and cancelled/expired operations never accept late replies", async () => {
  const broker = new LiveDocumentBroker(10); let event;
  const input = { action: "commit", targetId: "book-instance", expected: { document: initial, token: "0", scope: "document" }, operation: "apply", commands: set("one") };
  await assert.rejects(broker.request(input, signal(), value => { event = value; }), AILiveDocumentUnavailable);
  const result = { targetId: input.targetId, document: initial, token: "1", changed: true };
  assert.equal(broker.complete(event.id, { token: event.token, result }), false);
  const controller = new AbortController();
  const promise = broker.request(input, controller.signal, value => { event = value; });
  const rejected = assert.rejects(promise, { name: "AbortError" }); controller.abort(); await rejected;
  assert.equal(broker.complete(event.id, { token: event.token, result }), false);
});

test("conflict response is recoverable but readonly and ambiguous host failures stop the run", async () => {
  const broker = new LiveDocumentBroker(); let event;
  for (const code of ["conflict", "read_only", "unavailable"]) {
    const pending = broker.request({ action: "snapshot", targetId: "book-instance" }, signal(), value => { event = value; });
    const rejected = assert.rejects(pending, error => code === "conflict" ? error instanceof AIToolError && error.details.code === code : error instanceof AILiveDocumentUnavailable);
    assert.equal(broker.complete(event.id, { token: event.token, error: { code, message: "host rejection", conflicts: [] } }), true);
    await rejected;
  }
});

test("live tools require explicit immutable read revisions and omit full-document replacement", () => {
  assert.deepEqual(parseRequest(request).capabilities, { liveDocument: true });
  assert.throws(() => parseRequest({ ...request, targetId: undefined }));
  for (const kind of ["spreadsheet", "slide"]) {
    const definitions = liveToolDefinitions(toolDefinitions(kind, root));
    assert.equal(definitions.some(tool => tool.name === "create_document"), false);
    for (const tool of definitions.filter(tool => ["apply_commands", "update_slide_text", "format_slide_elements", "add_svg_image", "update_svg_image"].includes(tool.name)))
      assert.ok(tool.parameters.required.includes("baseRevision"));
  }
});

test("writes preserve the chosen read baseline despite newer unrelated reads, require reread after conflict, and remain applied after cancellation", async () => {
  const host = spreadsheetHost(), workspace = await SkillWorkspace.create(root, "spreadsheet", initial, { targetId: request.targetId, exchange: host.exchange });
  try {
    const first = await workspace.invoke("inspect_document", { query: { kind: "range", sheetId, range: "A1" } }, signal());
    host.userEdit([{ type: "cells.set", sheetId, values: { B2: "human" } }]);
    const newer = await workspace.invoke("inspect_document", { query: { kind: "overview" } }, signal());
    assert.notEqual(first.readRevision, newer.readRevision);
    await assert.rejects(workspace.invoke("apply_commands", { commands: set("AI"), baseRevision: first.readRevision }, signal()), error => error.details?.code === "conflict");
    assert.equal(host.writes, 0); assert.equal(workspace.unresolvedLiveConflict, true);
    await assert.rejects(workspace.invoke("apply_commands", { commands: set("AI"), baseRevision: newer.readRevision }, signal()), error => error.details?.code === "invalid_read_revision");
    const refreshed = await workspace.invoke("inspect_document", { query: { kind: "range", sheetId, range: "A1:B2" } }, signal());
    assert.equal(refreshed.selection.rows[1][1].value, "human");
    const write = await workspace.invoke("apply_commands", { commands: set("AI"), baseRevision: refreshed.readRevision }, signal());
    assert.equal(write.changed, true); assert.ok(write.readRevision); assert.equal(workspace.unresolvedLiveConflict, false);
    assert.equal(host.writes, 1); assert.equal(parseWorkbook(host.snapshot().document).sheets[0].cells.A1.value, "AI");
    assert.equal(parseWorkbook(host.snapshot().document).sheets[0].cells.B2.value, "human");
    const stopped = new AbortController(); stopped.abort();
    await assert.rejects(workspace.result(stopped.signal), { name: "AbortError" });
    assert.equal(parseWorkbook(host.snapshot().document).sheets[0].cells.A1.value, "AI");
    await assert.rejects(workspace.invoke("create_document", {}, signal()), error => error.details?.code === "unsupported_live_reset");
  } finally { await workspace.dispose(); }
});

test("live sheet additions use exactly the host-created IDs in the result and following commands", async () => {
  const host = spreadsheetHost(), workspace = await SkillWorkspace.create(root, "spreadsheet", initial, { targetId: request.targetId, exchange: host.exchange });
  try {
    const read = await workspace.invoke("inspect_document", { query: { kind: "list" } }, signal());
    const write = await workspace.invoke("apply_commands", { baseRevision: read.readRevision, commands: [{ type: "sheets.add", name: "Actual generated sheet" }] }, signal());
    const added = parseWorkbook(host.snapshot().document).sheets.find(sheet => sheet.name === "Actual generated sheet");
    assert.ok(added); assert.ok(write.summary.sheets.some(sheet => sheet.id === added.id));
    await workspace.invoke("apply_commands", { baseRevision: write.readRevision, commands: [{ type: "cells.set", sheetId: added.id, values: { A1: "generated target" } }] }, signal());
    assert.equal(parseWorkbook(host.snapshot().document).sheets.find(sheet => sheet.id === added.id).cells.A1.value, "generated target");
    assert.equal(host.writes, 2);
    const final = await workspace.result(signal()); assert.equal(final.incremental, true); assert.equal(final.changed, true);
  } finally { await workspace.dispose(); }
});

test("live dry runs validate without committing and single-page slide policy still rejects multi-page writes", async () => {
  const host = spreadsheetHost(), workspace = await SkillWorkspace.create(root, "spreadsheet", initial, { targetId: request.targetId, exchange: host.exchange });
  try {
    const read = await workspace.invoke("inspect_document", { query: { kind: "overview" } }, signal());
    const dry = await workspace.invoke("apply_commands", { baseRevision: read.readRevision, commands: set("dry"), dryRun: true }, signal());
    assert.equal(dry.changed, true); assert.equal(host.writes, 0); assert.equal(host.snapshot().document, initial);
  } finally { await workspace.dispose(); }
  const document = serializeSlideDeck(createSlideDeck({ slides: ["one", "two"].map(id => ({ id, name: id, background: "#ffffff", notes: "", elements: [] })) }));
  let commits = 0;
  const slide = await SkillWorkspace.create(root, "slide", document, { targetId: "deck", exchange: async event => {
    if (event.action === "commit") commits++;
    return { targetId: "deck", document, token: "one", changed: false };
  } });
  try {
    const read = await slide.invoke("inspect_document", { query: { kind: "list" } }, signal());
    await assert.rejects(slide.invoke("apply_commands", { baseRevision: read.readRevision, commands: ["one", "two"].map(slideId => ({ type: "slide.update", slideId, patch: { name: "changed" } })) }, signal()),
      error => error.details?.code === "slide_page_limit");
    assert.equal(commits, 0);
  } finally { await slide.dispose(); }
});

test("live preview tracking ignores human-only pages but detects later changes to an AI-edited page", () => {
  const deck = createSlideDeck({ slides: ["one", "two"].map(id => ({ id, name: id, background: "#ffffff", notes: "", elements: [createSlideElement({ id: `${id}-title`, type: "text", text: id })] })) });
  const source = serializeSlideDeck(deck), tracker = new SlidePreviewTracker(source, true);
  const user = serializeSlideDeck(applySlideCommands(deck, { type: "slide.update", slideId: "two", patch: { name: "Human" } }).deck);
  assert.deepEqual(tracker.pending(user), []);
  const edited = serializeSlideDeck(applySlideCommands(parseSlideDeck(user), { type: "slide.update", slideId: "one", patch: { name: "AI" } }).deck);
  tracker.recordChanges(user, edited); assert.deepEqual(tracker.pending(edited), ["one"]);
  const preview = tracker.prepare(edited, "one"); tracker.confirm(edited, "one", preview.revision); assert.deepEqual(tracker.pending(edited), []);
  const userAgain = serializeSlideDeck(applySlideCommands(parseSlideDeck(edited), { type: "slide.update", slideId: "one", patch: { notes: "Later human note" } }).deck);
  assert.deepEqual(tracker.pending(userAgain), ["one"]);
});

test("Responses live session applies a write before the next model turn and never stages a final overwrite", async () => {
  const host = spreadsheetHost(), events = []; let turn = 0;
  const response = output => new Response(JSON.stringify({ status: "completed", output }));
  await runAISession({ repository: root, config: readConfiguration({ OPENAI_API_KEY: "test-only" }), request, signal: signal(), liveDocument: host.exchange,
    emit(event) { events.push(event); if (event.type === "run") logs.add(event.id); },
    async fetcher(_url, init) {
      const body = JSON.parse(init.body);
      assert.match(body.instructions, /LIVE conditional/);
      if (turn++ === 0) return response([{ type: "function_call", id: "fc-edit", call_id: "edit", name: "apply_commands", arguments: JSON.stringify({ commands: set("immediate"), dryRun: false, resolvesFailureIds: [], baseRevision: "read-1" }) }]);
      assert.equal(parseWorkbook(host.snapshot().document).sheets[0].cells.A1.value, "immediate");
      assert.equal(events.some(event => event.type === "result"), false);
      return response([{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "反映しました", annotations: [] }] }]);
    },
  });
  const result = events.at(-1); assert.equal(result.type, "result"); assert.equal(result.incremental, true); assert.equal(result.changed, true); assert.equal(host.writes, 1);
  const log = await readFile(path.join(root, ".likex-ai/runs", `${events.find(event => event.type === "run").id}.jsonl`), "utf8");
  assert.match(log, /baseRevision/);
});

test("provider failure after an acknowledged edit retains the applied live document", async () => {
  const host = spreadsheetHost(), events = []; let turn = 0;
  await assert.rejects(runAISession({ repository: root, config: readConfiguration({ OPENAI_API_KEY: "test-only" }), request, signal: signal(), liveDocument: host.exchange,
    emit(event) { events.push(event); if (event.type === "run") logs.add(event.id); },
    async fetcher() {
      if (turn++ === 0) return new Response(JSON.stringify({ status: "completed", output: [{ type: "function_call", id: "fc-kept", call_id: "kept", name: "apply_commands",
        arguments: JSON.stringify({ commands: set("retained"), dryRun: false, resolvesFailureIds: [], baseRevision: "read-1" }) }] }));
      return new Response("bad request", { status: 400 });
    },
  }), /HTTP 400/);
  assert.equal(parseWorkbook(host.snapshot().document).sheets[0].cells.A1.value, "retained");
  assert.equal(host.writes, 1); assert.equal(events.some(event => event.type === "result"), false);
});

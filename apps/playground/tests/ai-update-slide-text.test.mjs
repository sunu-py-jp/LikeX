import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSlideDeck, createSlideElement, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/provider.ts'; export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/tool-definitions.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { runAISession, readConfiguration, SkillWorkspace, toolDefinitions, scriptArguments } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const source = serializeSlideDeck(createSlideDeck({ title: "Metadata title", slides: [{ id: "page", name: "List label", notes: "Keep notes", background: "#ffffff", elements: [
  createSlideElement({ id: "title", type: "text", text: "Before", x: 70, y: 90, fontSize: 42, color: "#112233" }),
  createSlideElement({ id: "shape", type: "shape", text: "Shape before", x: 120, y: 260, fill: "#123456", textColor: "#ffffff" }),
  createSlideElement({ id: "image", type: "image", src: imageUrl, x: 800, y: 120 }),
] }] }));
const signal = () => new AbortController().signal;
const input = (updates = [{ elementId: "title", text: "After" }], overrides = {}) => ({ slideId: "page", updates, dryRun: false, resolvesFailureIds: [], ...overrides });
const inspect = workspace => workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "page", includeData: true, elementId: null } }, signal());
const invoke = (workspace, args = input(), abortSignal = signal()) => workspace.invoke("update_slide_text", args, abortSignal);
const invalid = error => error.details?.code === "invalid_argument";

test("update_slide_text is a narrow Slide-only strict tool with bounded text updates", () => {
  const tool = toolDefinitions("slide", root).find(item => item.name === "update_slide_text");
  assert.ok(tool);
  assert.equal(tool.strict, true);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual([...tool.parameters.required].sort(), ["dryRun", "resolvesFailureIds", "slideId", "updates"]);
  assert.equal(tool.parameters.properties.updates.minItems, 1);
  assert.equal(tool.parameters.properties.updates.maxItems, 1000);
  assert.equal(tool.parameters.properties.updates.items.additionalProperties, false);
  assert.deepEqual([...tool.parameters.properties.updates.items.required].sort(), ["elementId", "text"]);
  assert.equal(toolDefinitions("spreadsheet", root).some(item => item.name === "update_slide_text"), false);
  assert.throws(() => scriptArguments("spreadsheet", "update_slide_text", input()), error => error.details?.code === "unknown_tool");
});

test("text-only translation preserves empty and Unicode text without exposing geometry fields", () => {
  const updates = [{ elementId: "title", text: "𰻞𰻞麵\n改行" }, { elementId: "shape", text: "" }];
  assert.deepEqual(scriptArguments("slide", "update_slide_text", input(updates)), { operation: "apply", commands: updates.map(({ elementId, text }) => ({ type: "element.update", slideId: "page", elementId, patch: { text } })), dryRun: false });
  const thousand = Array.from({ length: 1000 }, (_, index) => ({ elementId: `element-${index}`, text: "" }));
  assert.equal(scriptArguments("slide", "update_slide_text", input(thousand)).commands.length, 1000);
  const bad = [
    { ...input(), unknown: true }, { ...input(), slideId: null }, { ...input(), slideId: "" }, { ...input(), slideId: 12 },
    { ...input(), updates: null }, { ...input(), updates: [] }, { ...input(), updates: [...thousand, thousand[0]] },
    input([null]), input([{ elementId: null, text: "After" }]), input([{ elementId: "", text: "After" }]),
    input([{ elementId: "title" }]), input([{ text: "After" }]), input([{ elementId: "title", text: null }]), input([{ elementId: "title", text: 1 }]),
    input([{ elementId: "title", text: "After", fontSize: 0 }]), input(undefined, { dryRun: null }), input(undefined, { dryRun: "false" }),
    input(undefined, { resolvesFailureIds: null }), input(undefined, { resolvesFailureIds: [1] }),
    ...["slideId", "updates", "dryRun", "resolvesFailureIds"].map(key => { const args = input(); delete args[key]; return args; }),
  ];
  for (const args of bad) assert.throws(() => scriptArguments("slide", "update_slide_text", args), invalid, JSON.stringify(args));
});

test("text and shape labels update together while presentation metadata and formatting stay intact", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const result = await invoke(workspace, input([{ elementId: "title", text: "Visible heading" }, { elementId: "shape", text: "" }]));
    assert.equal(result.changed, true);
    const expected = structuredClone(parseSlideDeck(source));
    expected.slides[0].elements.find(element => element.id === "title").text = "Visible heading";
    expected.slides[0].elements.find(element => element.id === "shape").text = "";
    assert.deepEqual(parseSlideDeck(await readFile(workspace.file, "utf8")), expected);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("native validation rejects image text edits atomically, including preceding valid text updates", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await assert.rejects(invoke(workspace, input([{ elementId: "title", text: "Must not be applied" }, { elementId: "image", text: "Invalid image text" }])), error => !!error.details?.failureId);
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal(workspace.unresolvedWrites.length, 1);
    await assert.rejects(workspace.result(signal()), /失敗した編集/);
  } finally { await workspace.dispose(); }
});

test("unknown IDs use the shared failure ledger and a refreshed whole corrected batch resolves them", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source); let failureId;
  try {
    await assert.rejects(invoke(workspace, input([{ elementId: "missing", text: "After" }, { elementId: "shape", text: "Shape after" }])), error => {
      assert.equal(error.details.code, "unknown_id");
      failureId = error.details.failureId;
      assert.ok(failureId);
      return true;
    });
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await inspect(workspace);
    await invoke(workspace, input([{ elementId: "title", text: "After" }, { elementId: "shape", text: "Shape after" }], { resolvesFailureIds: [failureId] }));
    assert.deepEqual(workspace.unresolvedWrites, []);
    const result = await workspace.result(signal());
    assert.equal(result.changed, true);
    assert.equal(parseSlideDeck(result.document).slides[0].elements.find(element => element.id === "shape").text, "Shape after");
  } finally { await workspace.dispose(); }
});

test("dry runs do not stage text changes and no-op counts are shared with apply_commands", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await invoke(workspace, input(undefined, { dryRun: true }));
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.deepEqual(workspace.unresolvedWrites, []);
    const unchanged = input([{ elementId: "title", text: "Before" }]);
    assert.equal((await invoke(workspace, unchanged)).noChange.repeatCount, 1);
    const commands = [{ type: "element.update", slideId: "page", elementId: "title", patch: { text: "Before" } }];
    assert.equal((await workspace.invoke("apply_commands", { commands, dryRun: false, resolvesFailureIds: [] }, signal())).noChange.repeatCount, 2);
    await inspect(workspace);
    await assert.rejects(invoke(workspace, unchanged), error => error.details?.code === "repeated_no_change");
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal(await readFile(workspace.file, "utf8"), source);
  } finally { await workspace.dispose(); }
});

test("an already-cancelled text update cannot alter the document or add a failed write", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source), controller = new AbortController();
  try {
    controller.abort();
    await assert.rejects(invoke(workspace, input(), controller.signal), error => error.name === "AbortError");
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

const config = readConfiguration({ OPENAI_API_KEY: "test-key-not-real" });
const request = { module: "slide", document: source, capabilities: { slidePreview: true }, messages: [{ role: "user", content: "見出しを変更して" }] };
const logs = new Set();
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const emitTo = events => event => { events.push(event); if (event.type === "run") logs.add(event.id); };
const response = (...output) => new Response(JSON.stringify({ status: "completed", output }));
const tool = (name, args, id = name) => response({ id: `fc-${id}`, type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed" });
const answer = () => response({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "見出しを変更しました。", annotations: [] }] });
const previewResult = { slideId: "page", width: 1280, height: 720, imageUrl, diagnostics: [] };

test("session text updates require a fresh page preview before publishing", async () => {
  const events = []; let turn = 0, renders = 0, assertionError;
  try {
    await runAISession({ repository: root, config, request, signal: signal(), emit: emitTo(events),
      preview: async value => {
        assert.equal(parseSlideDeck(value.document).slides[0].elements.find(element => element.id === "title").text, "After");
        renders++; return previewResult;
      },
      fetcher: async (_url, init) => {
        try {
          const body = JSON.parse(init.body);
          assert.ok(body.tools.some(item => item.name === "update_slide_text"));
          if (++turn === 1) return tool("update_slide_text", input());
          if (turn === 2) return answer();
          if (turn === 3) {
            assert.equal(events.some(event => event.type === "result"), false);
            assert.match(body.input.at(-1).content, /Required host validation.*page/);
            return tool("preview_slide", { slideId: "page" });
          }
          assert.equal(turn, 4);
          return answer();
        } catch (error) { assertionError = error; throw error; }
      },
    });
  } catch (error) { throw assertionError ?? error; }
  assert.equal(renders, 1);
  const result = events.find(event => event.type === "result");
  assert.equal(result.changed, true);
  assert.equal(parseSlideDeck(result.document).slides[0].elements.find(element => element.id === "title").text, "After");
});

test("cancelling the preview of a text-only update never publishes its staged document", async () => {
  const events = [], controller = new AbortController(); let turn = 0;
  await assert.rejects(runAISession({ repository: root, config, request, signal: controller.signal, emit: emitTo(events),
    preview: async () => { controller.abort(); return previewResult; },
    fetcher: async () => turn++ === 0 ? tool("update_slide_text", input()) : tool("preview_slide", { slideId: "page" }),
  }), error => error.name === "AbortError");
  assert.equal(events.some(event => event.type === "result"), false);
});

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
  createSlideElement({ id: "title", type: "text", text: "Visible title", x: 70, y: 90, fontSize: 42, bold: true, italic: true, color: "#112233" }),
  createSlideElement({ id: "shape", type: "shape", text: "Shape label", x: 120, y: 260, fill: "#123456", textColor: "#ffffff" }),
  createSlideElement({ id: "image", type: "image", src: imageUrl, x: 800, y: 120 }),
  createSlideElement({ id: "line", type: "shape", shape: "line", x: 300, y: 400, width: 200, height: 1, stroke: "#112233" }),
] }] }));
const fields = ["fontFamily", "fontSize", "bold", "italic", "textColor", "align", "verticalAlign", "fill", "stroke", "strokeWidth", "opacity", "startArrow", "endArrow"];
const format = overrides => ({ ...Object.fromEntries(fields.map(key => [key, null])), ...overrides });
const input = (style = {}, elementIds = ["title"], overrides = {}) => ({ slideId: "page", elementIds, format: format(style), dryRun: false, resolvesFailureIds: [], ...overrides });
const signal = () => new AbortController().signal;
const invoke = (workspace, args, abortSignal = signal()) => workspace.invoke("format_slide_elements", args, abortSignal);
const inspect = workspace => workspace.invoke("inspect_document", { query: { kind: "slide", slideId: "page", includeData: true, elementId: null } }, signal());
const read = async workspace => parseSlideDeck(await readFile(workspace.file, "utf8"));
const element = (deck, id) => deck.slides[0].elements.find(item => item.id === id);

test("format_slide_elements advertises a closed Slide-only schema without content or geometry edits", () => {
  const tool = toolDefinitions("slide", root).find(item => item.name === "format_slide_elements");
  assert.ok(tool);
  assert.equal(tool.strict, true);
  assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual([...tool.parameters.required].sort(), ["dryRun", "elementIds", "format", "resolvesFailureIds", "slideId"]);
  const style = tool.parameters.properties.format;
  assert.equal(style.additionalProperties, false);
  assert.deepEqual([...style.required].sort(), [...fields].sort());
  for (const field of fields) assert.ok(style.properties[field].anyOf.some(option => option.type === "null"), field);
  assert.equal(tool.parameters.properties.elementIds.minItems, 1);
  assert.equal(tool.parameters.properties.elementIds.maxItems, 1000);
  assert.equal(toolDefinitions("spreadsheet", root).some(item => item.name === "format_slide_elements"), false);
  assert.throws(() => scriptArguments("spreadsheet", "format_slide_elements", input()), error => error.details?.code === "unknown_tool");
});

test("format inputs enforce finite bounds, complete nullable fields, unique targets and no extra properties", () => {
  const bad = [
    input({}, []), input({}, ["title", "title"]), input({}, [null]), input({}, [""]), input({}, [1]),
    input({}, Array.from({ length: 1001 }, (_, index) => `id-${index}`)),
    input({}, ["title"], { slideId: null }), input({}, ["title"], { slideId: "" }), input({}, ["title"], { extra: true }),
    input({}, ["title"], { dryRun: null }), input({}, ["title"], { resolvesFailureIds: null }), input({}, ["title"], { resolvesFailureIds: [1] }),
    input({}, ["title"], { format: null }),
    ...["text", "x", "y", "width", "height", "rotation", "color"].map(key => input({ [key]: key === "text" ? "Changed" : 20 })),
    ...[0, 1001, NaN, Infinity, "12"].map(fontSize => input({ fontSize })),
    ...[-0.1, 1.1, NaN, Infinity].map(opacity => input({ opacity })),
    ...[-1, 101, NaN, Infinity].map(strokeWidth => input({ strokeWidth })),
    input({ startArrow: "invalid" }), input({ endArrow: 1 }), input({ bold: 0 }), input({ italic: "false" }), input({ align: "justify" }), input({ verticalAlign: "center" }), input({ fontFamily: 42 }),
    ...fields.map(key => { const args = input(); delete args.format[key]; return args; }),
    ...["slideId", "elementIds", "format", "dryRun", "resolvesFailureIds"].map(key => { const args = input(); delete args[key]; return args; }),
  ];
  for (const args of bad) assert.throws(() => scriptArguments("slide", "format_slide_elements", args), error => error.details?.code === "invalid_argument", JSON.stringify(args));
  assert.equal(scriptArguments("slide", "format_slide_elements", input({}, Array.from({ length: 1000 }, (_, index) => `id-${index}`))).commands.length, 1000);
  const result = scriptArguments("slide", "format_slide_elements", input({ bold: false, opacity: 0, strokeWidth: 0 }));
  assert.deepEqual(result.commands[0].patch, { bold: false, strokeWidth: 0, opacity: 0 });
});

test("shared formatting maps textColor by element type and preserves all content, layout and metadata", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const style = { fontSize: 48, textColor: "#aabbcc", fill: "#ddeeff", opacity: 0.75 };
    assert.equal((await invoke(workspace, input(style, ["title", "shape"]))).changed, true);
    const expected = structuredClone(parseSlideDeck(source));
    Object.assign(element(expected, "title"), { fontSize: 48, color: "#aabbcc", fill: "#ddeeff", opacity: 0.75 });
    Object.assign(element(expected, "shape"), style);
    assert.deepEqual(await read(workspace), expected);
  } finally { await workspace.dispose(); }
});

test("type-specific formats retain false and zero, and null leaves existing values unchanged", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await invoke(workspace, input({ fontFamily: "Arial", bold: false, italic: false, align: "right", verticalAlign: "bottom", opacity: 0 }));
    await invoke(workspace, input({ stroke: "#000000", strokeWidth: 0, fill: "transparent" }, ["shape"]));
    await invoke(workspace, input({ opacity: 0 }, ["image"]));
    const expected = structuredClone(parseSlideDeck(source));
    Object.assign(element(expected, "title"), { fontFamily: "Arial", bold: false, italic: false, align: "right", verticalAlign: "bottom", opacity: 0 });
    Object.assign(element(expected, "shape"), { stroke: "#000000", strokeWidth: 0, fill: "transparent" });
    element(expected, "image").opacity = 0;
    assert.deepEqual(await read(workspace), expected);
  } finally { await workspace.dispose(); }
});

test("unsupported mixed selections and native color errors reject the entire format batch", async () => {
  for (const [style, ids, code] of [
    [{ bold: false }, ["title", "shape"], "unsupported_format"],
    [{ fontFamily: "Arial" }, ["title", "shape"], "unsupported_format"],
    [{ italic: false }, ["title", "shape"], "unsupported_format"],
    [{ align: "right" }, ["title", "shape"], "unsupported_format"],
    [{ verticalAlign: "bottom" }, ["title", "shape"], "unsupported_format"],
    [{ fontSize: 48 }, ["title", "image"], "unsupported_format"],
    [{ fill: "#ffffff" }, ["shape", "line"], "unsupported_format"],
    [{ endArrow: "triangle" }, ["shape", "line"], "unsupported_format"],
    [{ fontSize: 48 }, ["line"], "unsupported_format"],
    [{ strokeWidth: 0 }, ["shape", "title"], "unsupported_format"],
    [{ textColor: "not-a-color" }, ["title", "shape"], null],
  ]) {
    const workspace = await SkillWorkspace.create(root, "slide", source);
    try {
      const args = input(style, ids);
      await assert.rejects(invoke(workspace, args), error => { assert.ok(error.details?.failureId); if (code) assert.equal(error.details.code, code); return true; });
      assert.equal(await readFile(workspace.file, "utf8"), source);
      await assert.rejects(invoke(workspace, args), error => error.details?.code === "repeated_failed_write");
      assert.equal(await readFile(workspace.file, "utf8"), source);
    } finally { await workspace.dispose(); }
  }
});

test("format failure recovery retains logical fields across ID lookup and rejects partial field repairs", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source); let failureId;
  const style = { textColor: "#abcdef", fontSize: 48 };
  try {
    await assert.rejects(invoke(workspace, input(style, ["missing", "shape"])), error => { assert.equal(error.details.code, "unknown_id"); failureId = error.details.failureId; return !!failureId; });
    await inspect(workspace);
    await assert.rejects(invoke(workspace, input({ fontSize: 48 }, ["title", "shape"], { resolvesFailureIds: [failureId] })), error => error.details?.code === "incomplete_write_recovery");
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await invoke(workspace, input(style, ["title", "shape"], { resolvesFailureIds: [failureId] }));
    assert.deepEqual(workspace.unresolvedWrites, []);
    const result = await workspace.result(signal()), deck = parseSlideDeck(result.document);
    assert.equal(element(deck, "title").color, "#abcdef");
    assert.equal(element(deck, "shape").textColor, "#abcdef");
    assert.equal(element(deck, "title").fontSize, 48);
    assert.equal(element(deck, "shape").fontSize, 48);
  } finally { await workspace.dispose(); }
});

test("all-null formatting is a shared empty-patch no-op and dry runs do not mutate or reset the guard", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const first = await invoke(workspace, input());
    assert.equal(first.noChange.code, "empty_patch");
    assert.equal(first.noChange.repeatCount, 1);
    const dry = await invoke(workspace, input({ fontSize: 60 }, ["title"], { dryRun: true }));
    assert.equal(dry.noChange, undefined);
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal((await workspace.invoke("apply_commands", { commands: [{ type: "element.update", slideId: "page", elementId: "title", patch: {} }], dryRun: false, resolvesFailureIds: [] }, signal())).noChange.repeatCount, 2);
    await inspect(workspace);
    await assert.rejects(invoke(workspace, input()), error => error.details?.code === "repeated_no_change");
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal(await readFile(workspace.file, "utf8"), source);
  } finally { await workspace.dispose(); }
});

test("an aborted format call does not change the document or create a failed write", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source), controller = new AbortController();
  try {
    controller.abort();
    await assert.rejects(invoke(workspace, input({ fontSize: 60 }), controller.signal), error => error.name === "AbortError");
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

const config = readConfiguration({ OPENAI_API_KEY: "test-key-not-real" });
const request = { module: "slide", document: source, capabilities: { slidePreview: true }, messages: [{ role: "user", content: "見出しを48ポイントにして" }] };
const logs = new Set();
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const emitTo = events => event => { events.push(event); if (event.type === "run") logs.add(event.id); };
const response = (...output) => new Response(JSON.stringify({ status: "completed", output }));
const tool = (name, args, id = name) => response({ id: `fc-${id}`, type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed" });
const answer = () => response({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "書式を変更しました。", annotations: [] }] });
const previewResult = { slideId: "page", width: 1280, height: 720, imageUrl, diagnostics: [] };

test("formatting preserves the session's current-preview requirement before publishing", async () => {
  const events = []; let turn = 0, renders = 0, assertionError;
  try {
    await runAISession({ repository: root, config, request, signal: signal(), emit: emitTo(events),
      preview: async value => { assert.equal(element(parseSlideDeck(value.document), "title").fontSize, 48); renders++; return previewResult; },
      fetcher: async (_url, init) => {
        try {
          const body = JSON.parse(init.body);
          assert.ok(body.tools.some(item => item.name === "format_slide_elements"));
          if (++turn === 1) return tool("format_slide_elements", input({ fontSize: 48 }));
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
  assert.equal(element(parseSlideDeck(events.find(event => event.type === "result").document), "title").fontSize, 48);
});

test("cancelling a format preview does not publish staged styling", async () => {
  const events = [], controller = new AbortController(); let turn = 0;
  await assert.rejects(runAISession({ repository: root, config, request, signal: controller.signal, emit: emitTo(events),
    preview: async () => { controller.abort(); return previewResult; },
    fetcher: async () => turn++ === 0 ? tool("format_slide_elements", input({ fontSize: 48 })) : tool("preview_slide", { slideId: "page" }),
  }), error => error.name === "AbortError");
  assert.equal(events.some(event => event.type === "result"), false);
});


test("line formatting changes independent end markers without changing endpoints or nearby shapes", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await invoke(workspace, input({ startArrow: "oval", endArrow: "openArrow", strokeWidth: 3 }, ["line"]));
    const expected = structuredClone(parseSlideDeck(source));
    Object.assign(element(expected, "line"), { startArrow: "oval", endArrow: "openArrow", strokeWidth: 3 });
    assert.deepEqual(await read(workspace), expected);
    await invoke(workspace, input({ startArrow: "none", endArrow: "none" }, ["line"]));
    assert.equal(element(await read(workspace), "line").endArrow, "none");
  } finally { await workspace.dispose(); }
});

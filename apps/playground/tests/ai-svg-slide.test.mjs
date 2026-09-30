import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSlideDeck, createSlideElement, createSlideSvgSource, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/provider.ts'; export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/tool-definitions.ts'; export * from './apps/playground/build/ai/prompts.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { runAISession, readConfiguration, SkillWorkspace, toolDefinitions, scriptArguments, defaultAIInstructions } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const signal = () => new AbortController().signal;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220"><defs><linearGradient id="growth"><stop offset="0%" stop-color="#a8f06c"/><stop offset="100%" stop-color="#148468"/></linearGradient></defs><path d="M 12 192 C 110 200 180 8 342 24 L 342 208 L 12 208 Z" fill="url(#growth)"/><circle cx="342" cy="24" r="10" fill="#17271b"/></svg>';
const source = serializeSlideDeck(createSlideDeck({ title: "自由な構図", width: 1280, height: 720, slides: ["one", "two"].map(id => ({ id, name: id, notes: "Keep notes", background: "#ffffff", elements: [createSlideElement({ id: `${id}-title`, type: "text", text: "成果を次の成長へ", x: 54, y: 46, width: 670, height: 130, fontSize: 60 })] })) }));
const input = (overrides = {}) => ({ slideId: "one", elementId: "growth-art", svg, x: 590, y: 194, width: 610, height: 374, name: "成長の曲線", alt: "右肩上がりの抽象的な曲線。実績値ではありません。", dryRun: false, resolvesFailureIds: [], ...overrides });
const updateInput = (overrides = {}) => ({ slideId: "one", elementId: "growth-art", svg: svg.replace("#a8f06c", "#d1f6ac"), dryRun: false, resolvesFailureIds: [], ...overrides });
const invoke = (workspace, args = input(), abortSignal = signal()) => workspace.invoke("add_svg_image", args, abortSignal);
const inspect = workspace => workspace.invoke("inspect_document", { query: { kind: "list" } }, signal());

test("SVG authoring exposes a narrow strict tool without a fixed design catalog or composition command", () => {
  const tools = toolDefinitions("slide", root), tool = tools.find(item => item.name === "add_svg_image");
  assert.ok(tool); assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
  assert.deepEqual([...tool.parameters.required].sort(), ["alt", "dryRun", "elementId", "height", "name", "resolvesFailureIds", "slideId", "svg", "width", "x", "y"]);
  assert.equal(tool.parameters.properties.svg.maxLength, 256000);
  const update = tools.find(item => item.name === "update_svg_image");
  assert.equal(update.strict, true); assert.equal(update.parameters.additionalProperties, false);
  assert.deepEqual([...update.parameters.required].sort(), ["dryRun", "elementId", "resolvesFailureIds", "slideId", "svg"]);
  assert.deepEqual(scriptArguments("slide", "update_svg_image", updateInput()), { operation: "apply", dryRun: false, commands: [{ type: "element.update", slideId: "one", elementId: "growth-art", patch: { src: createSlideSvgSource(updateInput().svg) } }] });
  assert.throws(() => scriptArguments("slide", "update_svg_image", { ...updateInput(), x: 100 }), error => error.details?.code === "invalid_argument");
  assert.equal(toolDefinitions("spreadsheet", root).some(item => item.name === "add_svg_image"), false);
  assert.equal(toolDefinitions("spreadsheet", root).some(item => item.name === "update_svg_image"), false);
  assert.ok(!tools.some(item => ["compose_slide", "get_slide_designs"].includes(item.name)));
  assert.doesNotMatch(JSON.stringify(tools), /slide\.compose|SlideComposition/);
  for (const name of ["compose_slide", "get_slide_designs"]) assert.throws(() => scriptArguments("slide", name, {}), error => error.details?.code === "unknown_tool");
  const bad = [input({ unexpected: true }), input({ slideId: ["one", "two"] }), input({ elementId: "" }), input({ width: 0 }), input({ height: -1 }), input({ svg: "" }), input({ svg: "x".repeat(256001) }), input({ x: Infinity }), input({ y: "2" }), input({ dryRun: null }), input({ resolvesFailureIds: null }), ...Object.keys(input()).map(key => { const value = input(); delete value[key]; return value; })];
  for (const args of bad) assert.throws(() => scriptArguments("slide", "add_svg_image", args), error => error.details?.code === "invalid_argument");
});

test("raw SVG revisions preserve image identity, placement and formatting and share no-change guards", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await invoke(workspace);
    const before = parseSlideDeck(await readFile(workspace.file, "utf8"));
    await workspace.invoke("update_svg_image", updateInput({ dryRun: true }), signal());
    assert.deepEqual(parseSlideDeck(await readFile(workspace.file, "utf8")), before);
    await workspace.invoke("update_svg_image", updateInput(), signal());
    const expected = structuredClone(before); expected.slides[0].elements[1].src = createSlideSvgSource(updateInput().svg);
    assert.deepEqual(parseSlideDeck(await readFile(workspace.file, "utf8")), expected);
    for (let count = 1; count <= 2; count++) assert.equal((await workspace.invoke("update_svg_image", updateInput(), signal())).noChange.repeatCount, count);
    await assert.rejects(workspace.invoke("update_svg_image", updateInput(), signal()), error => error.details?.code === "repeated_no_change");
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("SVG revision rejects non-image targets and requires fresh inspection to repair unknown image IDs", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    await assert.rejects(workspace.invoke("update_svg_image", updateInput({ elementId: "one-title" }), signal()), error => !!error.details?.failureId);
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal(workspace.unresolvedMutationError, true);
  } finally { await workspace.dispose(); }
  const repair = await SkillWorkspace.create(root, "slide", source); let failureId;
  try {
    await invoke(repair);
    const before = await readFile(repair.file, "utf8");
    await assert.rejects(repair.invoke("update_svg_image", updateInput({ elementId: "missing" }), signal()), error => { assert.equal(error.details?.code, "unknown_id"); failureId = error.details.failureId; return !!failureId; });
    await assert.rejects(repair.invoke("update_svg_image", updateInput({ resolvesFailureIds: [failureId] }), signal()), error => error.details?.code === "write_recovery_requires_inspection");
    assert.equal(await readFile(repair.file, "utf8"), before);
    await inspect(repair);
    await repair.invoke("update_svg_image", updateInput({ resolvesFailureIds: [failureId] }), signal());
    assert.deepEqual(repair.unresolvedWrites, []);
    assert.equal(parseSlideDeck(await readFile(repair.file, "utf8")).slides[0].elements[1].src, createSlideSvgSource(updateInput().svg));
  } finally { await repair.dispose(); }
});

test("raw markup uses the native SVG validator and preserves the author's exact geometry and native text", async () => {
  const args = scriptArguments("slide", "add_svg_image", input());
  assert.deepEqual(args, { operation: "apply", dryRun: false, commands: [{ type: "element.add", slideId: "one", element: { type: "image", id: "growth-art", src: createSlideSvgSource(svg), x: 590, y: 194, width: 610, height: 374, name: "成長の曲線", alt: input().alt } }] });
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const dry = await invoke(workspace, input({ dryRun: true }));
    assert.equal(dry.dryRun, true); assert.equal(await readFile(workspace.file, "utf8"), source);
    const result = await invoke(workspace); assert.equal(result.changed, true);
    const deck = parseSlideDeck(await readFile(workspace.file, "utf8")), before = parseSlideDeck(source);
    assert.deepEqual(deck.slides[1], before.slides[1]);
    assert.deepEqual(deck.slides[0].elements[0], before.slides[0].elements[0]);
    assert.equal(deck.slides[0].notes, "Keep notes");
    const graphic = deck.slides[0].elements[1];
    assert.equal(graphic.type, "image"); assert.equal(graphic.src, createSlideSvgSource(svg));
    assert.deepEqual([graphic.x, graphic.y, graphic.width, graphic.height], [590, 194, 610, 374]);
    assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

test("unsafe SVG rejects atomically, remains unresolved, and can be repaired only on its original page", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source); let failureId;
  try {
    const unsafe = input({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><script>alert(1)</script></svg>' });
    await assert.rejects(invoke(workspace, unsafe), error => { assert.equal(error.details?.code, "invalid_argument"); assert.equal(error.details.path, "add_svg_image.svg"); failureId = error.details.failureId; return !!failureId; });
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await assert.rejects(workspace.result(signal()), error => error.details?.code === "unresolved_writes");
    await assert.rejects(invoke(workspace, unsafe), error => error.details?.code === "repeated_failed_write");
    await assert.rejects(invoke(workspace, input({ slideId: "two", resolvesFailureIds: [failureId] })), error => error.details?.code === "incomplete_write_recovery");
    await invoke(workspace, input({ resolvesFailureIds: [failureId] }));
    assert.deepEqual(workspace.unresolvedWrites, []);
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("SVG creation cannot correct a mistyped page until a fresh inspection", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source); let failureId;
  try {
    await assert.rejects(invoke(workspace, input({ slideId: "mistyped" })), error => { assert.equal(error.details?.code, "unknown_id"); failureId = error.details.failureId; return !!failureId; });
    await assert.rejects(invoke(workspace, input({ resolvesFailureIds: [failureId] })), error => error.details?.code === "write_recovery_requires_inspection");
    await inspect(workspace);
    await invoke(workspace, input({ resolvesFailureIds: [failureId] }));
    assert.equal(workspace.unresolvedMutationError, false);
  } finally { await workspace.dispose(); }
});

test("native SVG image batches retain the one-page policy and repair page groups separately", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const commands = ["one", "two"].map(slideId => scriptArguments("slide", "add_svg_image", input({ slideId, elementId: `${slideId}-art` })).commands[0]);
    let groups;
    await assert.rejects(workspace.invoke("apply_commands", { commands, dryRun: false, resolvesFailureIds: [] }, signal()), error => { assert.equal(error.details?.code, "slide_page_limit"); groups = error.details.unresolvedFailures; return true; });
    assert.equal(await readFile(workspace.file, "utf8"), source); assert.equal(groups.length, 2);
    for (const group of groups) await workspace.invoke("apply_commands", { commands: group.commandIndexes.map(index => commands[index]), dryRun: false, resolvesFailureIds: [group.failureId] }, signal());
    assert.equal(workspace.unresolvedMutationError, false);
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("complete freeform replacement preserves supplied element geometry and semantic no-change guards", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const elements = [createSlideElement({ type: "text", id: "oversized-number", text: "42%", fontSize: 184, x: 18, y: 164, width: 430, height: 250, color: "#165647" }), createSlideElement({ type: "image", id: "growth-art", src: createSlideSvgSource(svg), x: 542, y: 62, width: 681, height: 568, rotation: -8 })];
    const args = { commands: [{ type: "slide.replaceContent", slideId: "one", elements }], dryRun: false, resolvesFailureIds: [] };
    await workspace.invoke("apply_commands", args, signal());
    const deck = parseSlideDeck(await readFile(workspace.file, "utf8"));
    assert.deepEqual(deck.slides[0].elements, elements); assert.deepEqual(deck.slides[1], parseSlideDeck(source).slides[1]);
    for (let count = 1; count <= 2; count++) assert.equal((await workspace.invoke("apply_commands", args, signal())).noChange.repeatCount, count);
    await assert.rejects(workspace.invoke("apply_commands", args, signal()), error => error.details?.code === "repeated_no_change");
  } finally { await workspace.dispose(); }
});

test("an already-cancelled SVG insertion cannot stage an image or add a failed write", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source), controller = new AbortController();
  try {
    controller.abort();
    await assert.rejects(invoke(workspace, input(), controller.signal), error => error.name === "AbortError");
    assert.equal(await readFile(workspace.file, "utf8"), source); assert.deepEqual(workspace.unresolvedWrites, []);
  } finally { await workspace.dispose(); }
});

const config = readConfiguration({ OPENAI_API_KEY: "test-key-not-real" });
const request = { module: "slide", document: source, capabilities: { slidePreview: true }, messages: [{ role: "user", content: "成長のイラストを追加して" }] };
const logs = new Set();
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const emitTo = events => event => { events.push(event); if (event.type === "run") logs.add(event.id); };
const response = (...output) => new Response(JSON.stringify({ status: "completed", output }));
const tool = (name, args) => response({ id: `fc-${name}`, type: "function_call", call_id: name, name, arguments: JSON.stringify(args), status: "completed" });
const answer = () => response({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "図解を追加しました。", annotations: [] }] });
const previewResult = { slideId: "one", width: 1280, height: 720, imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", diagnostics: [] };

test("SVG insertion requires a current page preview before publishing the ordinary editable image", async () => {
  const events = []; let turn = 0, renders = 0, assertionError;
  try {
    await runAISession({ repository: root, config, request, signal: signal(), emit: emitTo(events),
      preview: async value => { assert.equal(parseSlideDeck(value.document).slides[0].elements[1].src, createSlideSvgSource(svg)); renders++; return previewResult; },
      fetcher: async (_url, init) => {
        try {
          const body = JSON.parse(init.body); assert.ok(body.tools.some(item => item.name === "add_svg_image"));
          if (++turn === 1) return tool("add_svg_image", input());
          if (turn === 2) return answer();
          if (turn === 3) { assert.equal(events.some(event => event.type === "result"), false); assert.match(body.input.at(-1).content, /Required host validation.*one/); return tool("preview_slide", { slideId: "one" }); }
          assert.equal(turn, 4); return answer();
        } catch (error) { assertionError = error; throw error; }
      },
    });
  } catch (error) { throw assertionError ?? error; }
  assert.equal(renders, 1);
  const result = events.find(event => event.type === "result"); assert.equal(result.changed, true);
  assert.equal(parseSlideDeck(result.document).slides[0].elements[1].src, createSlideSvgSource(svg));
});

test("cancelling an SVG preview never publishes the staged artwork", async () => {
  const events = [], controller = new AbortController(); let turn = 0;
  await assert.rejects(runAISession({ repository: root, config, request, signal: controller.signal, emit: emitTo(events),
    preview: async () => { controller.abort(); return previewResult; },
    fetcher: async () => turn++ === 0 ? tool("add_svg_image", input()) : tool("preview_slide", { slideId: "one" }),
  }), error => error.name === "AbortError");
  assert.equal(events.some(event => event.type === "result"), false);
});

test("host requests original layouts and actual visual review while retaining master and content boundaries", () => {
  const instructions = defaultAIInstructions("slide");
  assert.match(instructions, /arbitrary element geometry/); assert.match(instructions, /add_svg_image/);
  assert.match(instructions, /editable native text/); assert.match(instructions, /do not detach/);
  assert.match(instructions, /preview_slide.*EACH changed page/); assert.match(instructions, /balanced negative space/);
  assert.doesNotMatch(instructions, /compose_slide|get_slide_designs|composition\.md|ONE preset/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applySlideCommands, createSlideDeck, createSlideElement, getSlideCompositionLayouts, getSlideCompositionPresets, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/tools.ts'; export * from './apps/playground/build/ai/tool-definitions.ts'; export * from './apps/playground/build/ai/command-schema.ts'; export * from './apps/playground/build/ai/prompts.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { SkillWorkspace, toolDefinitions, scriptArguments, commandSchemas, commandVariant, normalizeCommands, validateSchema, defaultAIInstructions } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const signal = () => new AbortController().signal;
const source = serializeSlideDeck(createSlideDeck({ title: "Keep document", width: 1280, height: 720, slides: ["one", "two"].map(id => ({ id, name: `Keep ${id}`, notes: "Keep notes", background: "#ffffff", elements: [createSlideElement({ id: `${id}-text`, type: "text", text: "Original", x: 80, y: 80 })] })) }));
const composition = (overrides = {}) => ({ kind: "features", title: "必要な判断を一画面に", eyebrow: null, subtitle: null, footer: null,
  items: [{ title: "検知", body: "異常を一覧で確認する" }, { title: "判断", body: "影響と根拠を確認する" }, { title: "承認", body: "承認者が実行を決める" }], ...overrides });
const input = (overrides = {}) => ({ slideId: "one", composition: composition(), preset: "executive", notes: null, dryRun: false, resolvesFailureIds: [], ...overrides });
const invoke = (workspace, args, abortSignal = signal()) => workspace.invoke("compose_slide", args, abortSignal);
const inspect = workspace => workspace.invoke("inspect_document", { query: { kind: "list" } }, signal());

test("compose tools expose the generated strict native shape and only its reachable definitions", () => {
  const tools = toolDefinitions("slide", root), tool = tools.find(item => item.name === "compose_slide");
  assert.ok(tools.some(item => item.name === "get_slide_designs"));
  assert.equal(tool.strict, true);
  assert.deepEqual([...tool.parameters.required].sort(), ["composition", "dryRun", "notes", "preset", "resolvesFailureIds", "slideId"]);
  assert.equal(tool.parameters.additionalProperties, false);
  const native = commandVariant(commandSchemas(root, "slide").strict, "slide.compose");
  for (const key of ["slideId", "composition", "preset", "notes"]) assert.deepEqual(tool.parameters.properties[key], native.properties[key]);
  assert.ok(!("SlideCommand" in tool.parameters.$defs), "do not repeat the entire native command catalog for one tool");
  assert.ok(JSON.stringify(tool.parameters).length < 18000);
  validateSchema(input(), tool.parameters);
  const args = scriptArguments("slide", "compose_slide", input(), root);
  const [command] = normalizeCommands(root, "slide", args.commands);
  assert.deepEqual(command, { type: "slide.compose", slideId: "one", preset: "executive", composition: { kind: "features", title: "必要な判断を一画面に", items: composition().items } });
  assert.equal(toolDefinitions("spreadsheet", root).some(item => ["compose_slide", "get_slide_designs"].includes(item.name)), false);
  for (const bad of [input({ slideId: ["one", "two"] }), input({ commands: [] }), input({ preset: "unknown" }), input({ composition: composition({ surprise: true }) }), input({ dryRun: null }), input({ resolvesFailureIds: null }), (() => { const args = input(); delete args.notes; return args; })()]) {
    assert.throws(() => scriptArguments("slide", "compose_slide", bad, root), error => error.details?.code === "invalid_argument");
  }
});

test("design catalog is compact, read-only, and shares public preset and layout limits", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const catalog = await workspace.invoke("get_slide_designs", {}, signal());
    assert.deepEqual(catalog.presets, getSlideCompositionPresets());
    assert.deepEqual(catalog.compositions, getSlideCompositionLayouts());
    assert.equal(catalog.compositions.length, 6);
    assert.ok(JSON.stringify(catalog).length < 8000);
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal(workspace.unresolvedMutationError, false);
    await assert.rejects(workspace.invoke("get_slide_designs", { slideId: "one" }, signal()));
  } finally { await workspace.dispose(); }
});

test("composition executes via the native command, retaining metadata and other pages; dry runs do not stage", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const dry = await invoke(workspace, input({ dryRun: true }));
    assert.equal(dry.dryRun, true);
    assert.equal(await readFile(workspace.file, "utf8"), source);
    const result = await invoke(workspace, input());
    assert.equal(result.ok, true); assert.equal(result.changed, true); assert.equal(result.commandCount, 1);
    const document = parseSlideDeck(await readFile(workspace.file, "utf8"));
    const [command] = normalizeCommands(root, "slide", scriptArguments("slide", "compose_slide", input(), root).commands);
    assert.deepEqual(document, applySlideCommands(parseSlideDeck(source), command).deck);
    assert.deepEqual(document.slides[1], parseSlideDeck(source).slides[1]);
    assert.equal(document.slides[0].name, "Keep one"); assert.equal(document.slides[0].notes, "Keep notes");
    assert.ok(document.slides[0].elements.some(element => element.text === composition().title));
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("one-page restriction also covers native compositions and repairs each rejected page group", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const commands = ["one", "two"].map(slideId => normalizeCommands(root, "slide", scriptArguments("slide", "compose_slide", input({ slideId }), root).commands)[0]);
    let groups;
    await assert.rejects(workspace.invoke("apply_commands", { commands, dryRun: false, resolvesFailureIds: [] }, signal()), error => { assert.equal(error.details?.code, "slide_page_limit"); groups = error.details.unresolvedFailures; return true; });
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal(groups.length, 2);
    for (const group of groups) await workspace.invoke("apply_commands", { commands: group.commandIndexes.map(index => commands[index]), dryRun: false, resolvesFailureIds: [group.failureId] }, signal());
    assert.equal(workspace.unresolvedMutationError, false);
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("an over-dense composition stages nothing, blocks completion, and allows a complete corrected retry", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    let failureId;
    const excessive = input({ composition: composition({ title: "長い見出し".repeat(100) }) });
    await assert.rejects(invoke(workspace, excessive), error => { failureId = error.details?.failureId; assert.match(error.message, /composition|文字|長|上限/); return !!failureId; });
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await assert.rejects(workspace.result(signal()), error => error.details?.code === "unresolved_writes");
    await assert.rejects(invoke(workspace, excessive), error => error.details?.code === "repeated_failed_write");
    await assert.rejects(invoke(workspace, input({ composition: composition({ items: composition().items.slice(0, 2) }), resolvesFailureIds: [failureId] })), error => error.details?.code === "incomplete_write_recovery");
    await invoke(workspace, input({ resolvesFailureIds: [failureId] }));
    assert.equal(workspace.unresolvedMutationError, false);
    assert.equal((await workspace.result(signal())).changed, true);
  } finally { await workspace.dispose(); }
});

test("a composition rejected by inherited artwork can be repaired with a full custom page while retaining notes", async () => {
  const customSource = serializeSlideDeck(createSlideDeck({ width: 1280, height: 720,
    masters: [{ id: "master", name: "Master", background: "#ffffff", elements: [createSlideElement({ id: "center-art", type: "shape", x: 520, y: 240, width: 220, height: 180, fill: "#173f5f" })] }],
    layouts: [{ id: "layout", masterId: "master", name: "Layout", elements: [], placeholders: [] }],
    slides: [{ id: "one", name: "Keep", notes: "Old notes", background: "#ffffff", elements: [], layoutId: "layout", inheritBackground: true }],
  }));
  const workspace = await SkillWorkspace.create(root, "slide", customSource);
  try {
    let failureId;
    await assert.rejects(invoke(workspace, input({ notes: "Required speaker notes" })), error => { assert.match(error.message, /マスター/); failureId = error.details?.failureId; return !!failureId; });
    const command = { type: "slide.replaceContent", slideId: "one", elements: [createSlideElement({ id: "custom-heading", type: "text", text: composition().title, x: 60, y: 60, width: 1000, height: 100 })] };
    await assert.rejects(workspace.invoke("apply_commands", { commands: [command], dryRun: false, resolvesFailureIds: [failureId] }, signal()), error => error.details?.code === "incomplete_write_recovery");
    await workspace.invoke("apply_commands", { commands: [{ ...command, notes: "Required speaker notes" }], dryRun: false, resolvesFailureIds: [failureId] }, signal());
    const deck = parseSlideDeck(await readFile(workspace.file, "utf8"));
    assert.equal(deck.slides[0].layoutId, "layout"); assert.equal(deck.slides[0].notes, "Required speaker notes");
    assert.equal(workspace.unresolvedMutationError, false);
  } finally { await workspace.dispose(); }
});

test("unknown page recovery requires a fresh inspection and permits the same complete composition", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    let failureId;
    await assert.rejects(invoke(workspace, input({ slideId: "mistyped" })), error => { assert.equal(error.details?.code, "unknown_id"); failureId = error.details.failureId; return !!failureId; });
    await assert.rejects(invoke(workspace, input({ resolvesFailureIds: [failureId] })), error => error.details?.code === "write_recovery_requires_inspection");
    await workspace.invoke("get_slide_designs", {}, signal());
    await assert.rejects(invoke(workspace, input({ resolvesFailureIds: [failureId] })), error => error.details?.code === "write_recovery_requires_inspection");
    await inspect(workspace);
    await invoke(workspace, input({ resolvesFailureIds: [failureId] }));
    assert.equal(workspace.unresolvedMutationError, false);
  } finally { await workspace.dispose(); }
});

test("measured density repairs keep all valid items, while a genuine count-cap error permits count correction", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    let failureId;
    const items = composition().items.map((item, index) => index === 0 ? { ...item, body: "確認\n".repeat(35) } : item);
    await assert.rejects(invoke(workspace, input({ composition: composition({ items }) })), error => { assert.match(error.message, /行は領域に収まりません/); failureId = error.details?.failureId; return !!failureId; });
    await assert.rejects(invoke(workspace, input({ composition: composition({ items: composition().items.slice(0, 2) }), resolvesFailureIds: [failureId] })), error => error.details?.code === "incomplete_write_recovery");
    assert.equal(await readFile(workspace.file, "utf8"), source);
    await invoke(workspace, input({ resolvesFailureIds: [failureId] }));
    assert.equal(workspace.unresolvedMutationError, false);
    const tooMany = Array.from({ length: 5 }, (_, index) => ({ title: `項目${index}`, body: "確認する" }));
    await assert.rejects(invoke(workspace, input({ composition: composition({ items: tooMany }) })), error => { failureId = error.details?.failureId; return !!failureId; });
    await invoke(workspace, input({ composition: composition({ items: tooMany.slice(0, 4) }), resolvesFailureIds: [failureId] }));
    assert.equal(workspace.unresolvedMutationError, false);
  } finally { await workspace.dispose(); }
});

test("compose inherits cancellation and semantic no-change repetition guards", async () => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(invoke(workspace, input(), controller.signal), error => error.name === "AbortError");
    assert.equal(await readFile(workspace.file, "utf8"), source);
    assert.equal(workspace.unresolvedMutationError, false);
    await invoke(workspace, input());
    for (let count = 1; count <= 2; count++) assert.equal((await invoke(workspace, input())).noChange.repeatCount, count);
    await assert.rejects(invoke(workspace, input()), error => error.code === "repeated_no_change" || error.details?.code === "repeated_no_change");
  } finally { await workspace.dispose(); }
});

test("host directs full-page creation through composition while protecting incremental edits and master reuse", () => {
  const instructions = defaultAIInstructions("slide");
  assert.match(instructions, /get_slide_designs/); assert.match(instructions, /compact deck plan/);
  assert.match(instructions, /ONE preset/); assert.match(instructions, /never use it for a small edit/);
  assert.match(instructions, /do not detach/); assert.match(instructions, /Japanese\/CJK-aware/);
  assert.match(instructions, /preview_slide.*EACH changed page/);
});

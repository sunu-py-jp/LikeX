import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applySlideCommands, createSlideDeck, createSlideElement, serializeSlideDeck, parseSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: `export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/provider.ts'; export * from './apps/playground/build/ai/slide-preview-session.ts';` }, bundle: true, platform: "node", format: "esm", write: false });
const { runAISession, parseRequest, readConfiguration, SlidePreviewTracker, boundPreviewContext } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const config = readConfiguration({ OPENAI_API_KEY: "test-key-not-real" });
const initial = serializeSlideDeck(createSlideDeck({ slides: [
  { id: "one", name: "One", notes: "", background: "#ffffff", elements: [] },
  { id: "two", name: "Two", notes: "", background: "#ffffff", elements: [] },
] }));
const change = (source, update) => { const data = JSON.parse(source); update(data); return JSON.stringify(data); };
const request = (capabilities = { slidePreview: true }) => ({ module: "slide", document: initial, messages: [{ role: "user", content: "1枚目を編集して" }], ...(capabilities ? { capabilities } : {}) });
const png = "data:image/png;base64,TEST_PREVIEW_IMAGE_BYTES";
const result = slideId => ({ slideId, width: 1280, height: 720, imageUrl: png, diagnostics: [] });
const response = (...output) => new Response(JSON.stringify({ status: "completed", output }));
const answer = () => response({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "確認して反映しました。", annotations: [] }] });
const tool = (name, args, id = name) => response({ id: `fc-${id}`, type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed" });
const edit = () => tool("apply_commands", { commands: [{ type: "slide.update", slideId: "one", patch: { name: "Edited" } }], dryRun: false, resolvesFailureIds: [] });
const logs = new Set();
const emitTo = events => event => { events.push(event); if (event.type === "run") logs.add(event.id); };
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });

test("preview tracker requires current edited pages only, isolates pages, and rejects stale revisions", () => {
  const tracker = new SlidePreviewTracker(initial);
  assert.deepEqual(tracker.pending(initial), []);
  const changed = change(initial, deck => { deck.slides[0].name = "Changed"; });
  assert.deepEqual(tracker.pending(changed), ["one"]);
  const prepared = tracker.prepare(changed, "one");
  assert.deepEqual(parseSlideDeck(prepared.document).slides.map(page => page.id), ["one"]);
  assert.equal(parseSlideDeck(prepared.document).width, parseSlideDeck(initial).width);
  assert.throws(() => tracker.prepare(changed, "missing"), /見つかりません/);
  const changedAgain = change(changed, deck => { deck.slides[0].notes = "New note"; });
  assert.throws(() => tracker.confirm(changedAgain, "one", prepared.revision), /変更されました/);
  tracker.confirm(changed, "one", prepared.revision);
  assert.deepEqual(tracker.pending(changed), []);
  assert.deepEqual(tracker.pending(changedAgain), ["one"]);
  const more = change(changed, deck => { deck.slides.push({ ...deck.slides[1], id: "three" }); });
  assert.deepEqual(tracker.pending(more), ["three"]);
  assert.deepEqual(tracker.pending(change(more, deck => { deck.slides = deck.slides.filter(page => page.id === "two"); })), []);
  assert.deepEqual(tracker.pending(initial), []);
  assert.deepEqual(tracker.pending(change(initial, deck => { deck.width += 10; })), ["one", "two"]);
});

test("preview tracking ignores native key/position order and rotation normalization while retaining actual visual changes", () => {
  const canonical = serializeSlideDeck(createSlideDeck({ slides: ["one", "two"].map(id => ({ id, name: id, notes: "", background: "#ffffff", elements: [
    createSlideElement({ id: `${id}-a`, type: "text", text: "A", x: 300, y: 200 }),
    createSlideElement({ id: `${id}-b`, type: "text", text: "B", x: 40, y: 80 }),
  ] })) }));
  const source = JSON.parse(canonical);
  // Both changes are valid native representation differences, not drawing-order changes.
  source.slides = source.slides.map(page => Object.fromEntries(Object.entries({ ...page, elements: page.elements.toReversed() }).reverse()));
  source.slides[1].elements[0].rotation = 209.99999999999997;
  const original = JSON.stringify(source), tracker = new SlidePreviewTracker(original);
  const normalized = serializeSlideDeck(parseSlideDeck(original));
  assert.deepEqual(tracker.pending(normalized), []);
  const target = serializeSlideDeck(applySlideCommands(parseSlideDeck(original), { type: "slide.update", slideId: "one", patch: { name: "Edited" } }).deck);
  assert.deepEqual(tracker.pending(target), ["one"]);
  const prepared = tracker.prepare(target, "one");
  const restyledKeys = change(target, data => { data.slides = data.slides.map(page => Object.fromEntries(Object.entries(page).reverse())); });
  tracker.confirm(restyledKeys, "one", prepared.revision);
  assert.deepEqual(tracker.pending(restyledKeys), []);
  const tinyMove = serializeSlideDeck(applySlideCommands(parseSlideDeck(target), { type: "element.update", slideId: "two", elementId: "two-a", patch: { x: 300.000001 } }).deck);
  assert.deepEqual(tracker.pending(tinyMove), ["two"], "normalization must not round away intentional sub-pixel edits");
  const stacking = serializeSlideDeck(applySlideCommands(parseSlideDeck(target), { type: "element.order", slideId: "two", elementIds: ["two-a"], direction: "front" }).deck);
  assert.deepEqual(tracker.pending(stacking), ["two"], "semantic stack order remains part of the reviewed revision");
});

test("context keeps six newest images and all text diagnostics without counting image bytes as text", () => {
  const input = Array.from({ length: 8 }, (_, index) => ({ type: "function_call_output", call_id: `image-${index}`, output: [
    { type: "input_text", text: `diagnostic-${index}` }, { type: "input_image", image_url: "data:image/png;base64," + "x".repeat(500000), detail: "high" },
  ] }));
  const size = boundPreviewContext(input);
  assert.ok(size < 4000);
  assert.deepEqual(input.map(item => item.output.length), [1, 1, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(input.map(item => item.output[0].text), Array.from({ length: 8 }, (_, index) => `diagnostic-${index}`));
});

test("capability is a narrow host contract and is unavailable for spreadsheets", () => {
  assert.deepEqual(parseRequest(request()).capabilities, { slidePreview: true });
  for (const capabilities of [{ slidePreview: false }, { slidePreview: true, arbitrary: true }, {}, []])
    assert.throws(() => parseRequest({ ...request(), capabilities }));
  assert.throws(() => parseRequest({ ...request(), module: "spreadsheet" }));
});

test("session requires edited page preview, feeds image to Responses and never persists raster bytes", async () => {
  const events = []; let turn = 0, renders = 0;
  await runAISession({ repository: root, config, request: request(), signal: new AbortController().signal, emit: emitTo(events),
    preview: async (input, signal) => { assert.equal(signal.aborted, false); assert.equal(input.slideId, "one"); const deck = parseSlideDeck(input.document); assert.equal(deck.slides.length, 1); assert.equal(deck.slides[0].name, "Edited"); renders++; return result("one"); },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body); assert.ok(body.tools.some(item => item.name === "preview_slide"));
      if (turn++ === 0) return edit();
      if (turn === 2) return answer(); // A premature final response must not commit.
      if (turn === 3) { assert.match(body.input.at(-1).content, /Required host validation.*one/); assert.equal(events.some(item => item.type === "result"), false); return tool("preview_slide", { slideId: "one" }); }
      const output = body.input.find(item => item.type === "function_call_output" && item.call_id === "preview_slide");
      assert.equal(output.output[1].type, "input_image"); assert.equal(output.output[1].image_url, png);
      assert.deepEqual(JSON.parse(output.output[0].text).diagnostics, []); return answer();
    },
  });
  assert.equal(turn, 4); assert.equal(renders, 1);
  assert.equal(parseSlideDeck(events.find(item => item.type === "result").document).slides[0].name, "Edited");
  const run = events.find(item => item.type === "run");
  assert.equal((await readFile(path.join(root, ".likex-ai/runs", `${run.id}.jsonl`), "utf8")).includes("TEST_PREVIEW_IMAGE_BYTES"), false);
  assert.equal(JSON.stringify(events).includes("TEST_PREVIEW_IMAGE_BYTES"), false);
});

test("session without browser capability never advertises or claims image review", async () => {
  let turn = 0;
  await runAISession({ repository: root, config, request: request(null), signal: new AbortController().signal, emit: emitTo([]),
    preview: async () => { assert.fail("preview should not be called"); },
    fetcher: async (_url, init) => { const body = JSON.parse(init.body); assert.equal(body.tools.some(item => item.name === "preview_slide"), false); assert.match(body.instructions, /Image preview is not available/); return turn++ === 0 ? edit() : answer(); },
  });
});

test("aborting an in-flight image review prevents staged edits from reaching the editor", async () => {
  let turn = 0; const controller = new AbortController(), events = [];
  await assert.rejects(runAISession({ repository: root, config, request: request(), signal: controller.signal, emit: emitTo(events),
    preview: async () => { controller.abort(); return result("one"); },
    fetcher: async () => turn++ === 0 ? edit() : tool("preview_slide", { slideId: "one" }),
  }), error => error.name === "AbortError");
  assert.equal(events.some(item => item.type === "result"), false);
});

test("seven preview calls in one model response cannot mark an unseen evicted image as reviewed", async () => {
  const ids = Array.from({ length: 7 }, (_, index) => `page-${index + 1}`);
  const document = serializeSlideDeck(createSlideDeck({ width: 1280, height: 720, slides: ids.map(id => ({ id, name: id, notes: "", background: "#ffffff", elements: [] })) }));
  const events = [], rendered = [], seenByModel = new Set(); let turn = 0;
  const functionCall = (name, args, id) => ({ id: `fc-${id}`, type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed" });
  await runAISession({ repository: root, config, request: { ...request(), document }, signal: new AbortController().signal, emit: emitTo(events),
    preview: async input => { rendered.push(input.slideId); return { ...result(input.slideId), imageUrl: `${png}_${input.slideId}` }; },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body), imageOutputs = body.input.filter(item => item.type === "function_call_output" && Array.isArray(item.output) && item.output.some(part => part.type === "input_image"));
      for (const output of imageOutputs) seenByModel.add(JSON.parse(output.output.find(part => part.type === "input_text").text).slideId);
      assert.ok(imageOutputs.length <= 6);
      if (turn++ === 0) return response(...ids.map(id => functionCall("apply_commands", {
        commands: [{ type: "slide.update", slideId: id, patch: { name: `${id} edited` } }], dryRun: false, resolvesFailureIds: [],
      }, `edit-${id}`)));
      if (turn === 2) return response(...ids.map(id => functionCall("preview_slide", { slideId: id }, `preview-${id}`)));
      if (turn === 3) {
        assert.deepEqual(rendered, ids.slice(0, 6));
        assert.deepEqual([...seenByModel], ids.slice(0, 6));
        const rejected = body.input.find(item => item.type === "function_call_output" && item.call_id === "preview-page-7");
        assert.match(JSON.parse(rejected.output).error, /6枚まで/);
        return answer(); // Missing page must still block the premature final answer.
      }
      if (turn === 4) {
        assert.equal(events.some(item => item.type === "result"), false);
        assert.match(body.input.at(-1).content, /Required host validation.*page-7/);
        return tool("preview_slide", { slideId: "page-7" }, "preview-last");
      }
      assert.equal(turn, 5);
      assert.deepEqual([...seenByModel], ids);
      return answer();
    },
  });
  assert.deepEqual(rendered, ids);
  assert.equal(events.filter(event => event.type === "tool" && event.call.name === "preview_slide" && event.call.status === "error").length, 1);
  assert.equal(events.find(event => event.type === "result").changed, true);
});

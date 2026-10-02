import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement, createRef } from "react";
import { create } from "react-test-renderer";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({
  absWorkingDir: root,
  stdin: { contents: `
    export * from './apps/playground/src/ai/ai-editors';
    export { applyAIResult, assertLiveDocumentSize } from './apps/playground/src/ai/ai-document';
    export { Spreadsheet, serializeWorkbook, parseWorkbook } from './packages/spreadsheet/src/index';
    export { useSlideEditor } from './packages/slide/src/state/use-slide-editor';
    export { createSlideDeck, createSlideElement, serializeSlideDeck, parseSlideDeck } from './packages/slide/src/model';
  `, resolveDir: root },
  alias: {
    "@likex/spreadsheet/model": `${root}/packages/spreadsheet/src/model-entry.ts`,
    "@likex/spreadsheet": `${root}/packages/spreadsheet/src/index.ts`,
    "@likex/slide": `${root}/packages/slide/src/index.ts`,
  },
  bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic",
  plugins: [{ name: "shared-react", setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet, serializeWorkbook, parseWorkbook, useSlideEditor, createSlideDeck, createSlideElement,
  serializeSlideDeck, parseSlideDeck, createSpreadsheetAIAdapter, createSlideAIAdapter, applyAIResult, assertLiveDocumentSize } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`,
);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = callback => act(async () => { await callback(); });
const signal = () => new AbortController().signal;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const book = value => ({ sheets: [{ id: "main", name: "Main", rowCount: 10, columnCount: 5, cells: { A1: { value } } }] });
const setCell = value => ({ type: "cells.set", sheetId: "main", values: { A1: value } });
const applyResult = (adapter, snapshot, document, operationSignal = signal()) =>
  applyAIResult(adapter, snapshot, { type: "result", document, changed: true }, operationSignal, () => true);

async function mountSheet(t, overrides = {}) {
  const ref = createRef(); let renderer, revision = 0, saves = 0;
  const props = { ref, initialWorkbook: book("before"), onSave() { saves++; }, onEvent(event) {
    if (event.type === "change" || event.type === "unsaved-changes") revision++;
  }, ...overrides };
  await change(() => { renderer = create(createElement(Spreadsheet, props)); });
  t.after(() => change(() => renderer.unmount()));
  return { ref, get root() { return renderer.root; }, get saves() { return saves; },
    adapter: createSpreadsheetAIAdapter(() => ref.current, () => revision) };
}

const animatedDeck = () => createSlideDeck({ title: "Before", slides: [{ id: "page", name: "Page", notes: "", background: "#fff",
  elements: [createSlideElement({ id: "box", type: "shape", x: 10 })],
  animations: [{ id: "move", trigger: { type: "click" }, animation: { type: "tween", elementId: "box", durationMs: 500,
    easing: "linear", to: { x: 500 } } }],
}] });

async function mountSlide(t, overrides = {}) {
  const ref = createRef(); let renderer, editor, revision = 0, saves = 0;
  const props = { ref, initialDeck: animatedDeck(), onSave() { saves++; }, onChange() { revision++; }, ...overrides };
  function Probe() { editor = useSlideEditor(props); return null; }
  await change(() => { renderer = create(createElement(Probe)); });
  t.after(() => change(() => renderer.unmount()));
  return { ref, get editor() { return editor; }, get saves() { return saves; },
    adapter: createSlideAIAdapter(() => ref.current, () => revision) };
}

test("Spreadsheet AI applies to the current dirty workbook as one undoable edit without saving", async t => {
  const app = await mountSheet(t);
  await change(() => app.ref.current.execute(setCell("local draft")));
  let snapshot;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  assert.equal(parseWorkbook(snapshot.document).sheets[0].cells.A1.value, "local draft");
  assert.equal(snapshot.documentTitle, "Spreadsheet");
  const expected = serializeWorkbook(book("AI result"));
  await change(() => applyResult(app.adapter, snapshot, expected));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "AI result");
  assert.equal(app.saves, 0);
  await change(async () => assert.equal(await app.ref.current.undo(), true));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "local draft");
});

test("Spreadsheet AI snapshots use the title explicitly supplied by the host", async t => {
  const app = await mountSheet(t, { title: "月次売上ブック" });
  const adapter = createSpreadsheetAIAdapter(() => app.ref.current, () => 0, { title: "月次売上ブック" });
  let snapshot;
  await change(async () => { snapshot = await adapter.snapshot(signal()); });
  assert.equal(snapshot.documentTitle, "月次売上ブック");
  assert.equal(parseWorkbook(snapshot.document).sheets[0].name, "Main");
  assert.equal(Object.hasOwn(parseWorkbook(snapshot.document), "title"), false);
});

test("Spreadsheet AI refuses a snapshot with unfinished cell input", async t => {
  const app = await mountSheet(t);
  await change(() => app.root.findByProps({ "aria-label": "A1の値" }).props.onChange({ target: { value: "unfinished" } }));
  await change(() => assert.rejects(app.adapter.snapshot(signal()), /確定/));
  assert.equal(app.root.findByProps({ "aria-label": "A1の値" }).props.value, "unfinished");
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "before");
});

test("Spreadsheet AI rejects stale results and preserves edits typed during the request", async t => {
  const app = await mountSheet(t); let snapshot;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  await change(() => app.root.findByProps({ "aria-label": "A1の値" }).props.onChange({ target: { value: "typed later" } }));
  await change(() => assert.rejects(applyResult(app.adapter, snapshot, serializeWorkbook(book("AI result")))));
  assert.equal(app.root.findByProps({ "aria-label": "A1の値" }).props.value, "typed later");
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "before");
});

test("Spreadsheet AI cancellation while edit permission waits never applies its result", async t => {
  const permission = deferred(), app = await mountSheet(t, { onEditRequest: () => permission.promise });
  let snapshot, outcome;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  const controller = new AbortController();
  await change(() => { outcome = applyResult(app.adapter, snapshot, serializeWorkbook(book("AI result")), controller.signal).catch(error => error); });
  await change(() => controller.abort());
  assert.equal((await outcome).name, "AbortError");
  await change(() => permission.resolve(true));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "before");
  assert.equal(app.ref.current.getHistoryState().canUndo, false);
});

test("Slide AI native snapshots and undo preserve original animation values and definitions", async t => {
  const app = await mountSlide(t); let snapshot;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  const source = parseSlideDeck(snapshot.document);
  assert.equal(snapshot.documentTitle, "Before");
  assert.equal(source.slides[0].elements[0].x, 10);
  assert.equal(source.slides[0].animations[0].animation.to.x, 500);
  const expected = serializeSlideDeck({ ...source, title: "AI title" });
  await change(() => applyResult(app.adapter, snapshot, expected));
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).title, "AI title");
  let updatedSnapshot;
  await change(async () => { updatedSnapshot = await app.adapter.snapshot(signal()); });
  assert.equal(updatedSnapshot.documentTitle, "AI title");
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).slides[0].elements[0].x, 10);
  assert.equal(app.ref.current.getAnimations("page")[0].animation.to.x, 500);
  assert.equal(app.saves, 0);
  await change(async () => assert.equal(await app.ref.current.undo(), true));
  assert.equal(serializeSlideDeck(app.ref.current.getDeck({ includeAnimations: true })), snapshot.document);
});

test("Slide AI refuses an import silently denied by the public handle", async t => {
  const app = await mountSlide(t, { onEditRequest: () => false }); let snapshot;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  const expected = serializeSlideDeck({ ...parseSlideDeck(snapshot.document), title: "AI title" });
  await change(() => assert.rejects(applyResult(app.adapter, snapshot, expected)));
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).title, "Before");
  assert.equal(app.editor.canUndo, false);
});

test("Slide AI checks again after the editor flushes text entered during the request", async t => {
  const app = await mountSlide(t); let snapshot;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  let pending = true;
  app.editor.registerInputFlush(() => {
    if (pending) { pending = false; void app.editor.execute({ type: "deck.rename", title: "typed later" }); }
  }, () => pending);
  const expected = serializeSlideDeck({ ...parseSlideDeck(snapshot.document), title: "AI title" });
  await change(() => assert.rejects(applyResult(app.adapter, snapshot, expected)));
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).title, "typed later");
  await change(async () => assert.equal(await app.ref.current.undo(), true));
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).title, "Before");
});

test("Slide AI cancellation while edit permission waits never overwrites the deck", async t => {
  const permission = deferred(), app = await mountSlide(t, { onEditRequest: () => permission.promise });
  let snapshot, outcome;
  await change(async () => { snapshot = await app.adapter.snapshot(signal()); });
  const expected = serializeSlideDeck({ ...parseSlideDeck(snapshot.document), title: "AI title" });
  const controller = new AbortController();
  await change(() => { outcome = applyResult(app.adapter, snapshot, expected, controller.signal).catch(error => error); });
  await change(() => { controller.abort(); permission.resolve(true); });
  assert.ok((await outcome) instanceof Error);
  assert.equal(app.ref.current.getDeck({ includeAnimations: true }).title, "Before");
  assert.equal(app.editor.canUndo, false);
});

const liveRead = adapter => adapter.live({ targetId: "editor", action: "snapshot" }, signal());
const liveWrite = (adapter, snapshot, commands, scope = "targets", operationSignal = signal()) => adapter.live({
  targetId: "editor", action: "commit", operation: "apply", expected: { document: snapshot.document, token: snapshot.token, scope }, commands,
}, operationSignal);

test("live Spreadsheet edits preserve unrelated user changes and each batch has its own Undo", async t => {
  const app = await mountSheet(t); let before, result;
  await change(async () => { before = await liveRead(app.adapter); });
  await change(() => app.ref.current.execute({ type: "cells.set", sheetId: "main", values: { B1: "user" } }));
  await change(async () => { result = await liveWrite(app.adapter, before, [setCell("AI one")]); });
  assert.equal(result.changed, true);
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.B1.value, "user");
  await change(() => liveWrite(app.adapter, result, [setCell("AI two")]));
  await change(() => app.ref.current.undo());
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "AI one");
  await change(() => app.ref.current.undo());
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "before");
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.B1.value, "user");
  assert.equal(app.saves, 0);
});

test("live Spreadsheet conflicts reject the entire batch and protect reasoning source changes", async t => {
  const app = await mountSheet(t); let before;
  await change(async () => { before = await liveRead(app.adapter); });
  await change(() => app.ref.current.execute(setCell("user")));
  await change(() => assert.rejects(liveWrite(app.adapter, before, [
    { type: "cells.set", sheetId: "main", values: { B1: "must not apply" } }, setCell("AI"),
  ]), error => error.code === "conflict"));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.B1, undefined);
  await change(() => assert.rejects(liveWrite(app.adapter, before, [
    { type: "cells.set", sheetId: "main", values: { B1: "calculated from stale A1" } },
  ], "document"), error => error.code === "conflict"));
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "user");
});

test("live Spreadsheet writes cancelled during permission do not apply after permission resolves", async t => {
  const permission = deferred(), app = await mountSheet(t, { onEditRequest: () => permission.promise });
  let before, pending;
  await change(async () => { before = await liveRead(app.adapter); });
  const controller = new AbortController();
  await change(() => { pending = liveWrite(app.adapter, before, [setCell("late")], "document", controller.signal).catch(error => error); });
  await change(() => { controller.abort(); permission.resolve(true); });
  assert.ok((await pending) instanceof Error);
  assert.equal(app.ref.current.getWorkbook().sheets[0].cells.A1.value, "before");
});

test("live Slide writes preserve another field, then stale same-field writes report conflict", async t => {
  const app = await mountSlide(t); let before, result;
  await change(async () => { before = await liveRead(app.adapter); });
  await change(() => app.ref.current.execute({ type: "slide.update", slideId: "page", patch: { notes: "user notes" } }));
  await change(async () => { result = await liveWrite(app.adapter, before, [{ type: "deck.rename", title: "AI title" }]); });
  assert.equal(result.changed, true);
  assert.equal(app.ref.current.getDeck().slides[0].notes, "user notes");
  await change(() => assert.rejects(liveWrite(app.adapter, before, [{ type: "deck.rename", title: "stale" }]), error => error.code === "conflict"));
  assert.equal(app.ref.current.getDeck().title, "AI title");
  await change(() => app.ref.current.undo());
  assert.equal(app.ref.current.getDeck().title, "Before");
  assert.equal(app.ref.current.getDeck().slides[0].notes, "user notes");
});

test("live Slide generated IDs are those applied to the visible document", async t => {
  const app = await mountSlide(t); let before, result;
  await change(async () => { before = await liveRead(app.adapter); });
  await change(async () => { result = await liveWrite(app.adapter, before, [{ type: "slide.duplicate", slideId: "page" }], "document"); });
  const deck = app.ref.current.getDeck();
  assert.equal(deck.slides.length, 2);
  assert.equal(result.receipts.slideId, deck.slides[1].id);
  assert.equal(parseSlideDeck(result.document).slides[1].elements[0].id, deck.slides[1].elements[0].id);
});

for (const action of ["initial snapshot", "live snapshot"]) {
  test(`Slide AI cancels ${action} promptly while a user-owned export remains pending`, { timeout: 1000 }, async () => {
    const pending = deferred(), userOperation = new AbortController(), controller = new AbortController();
    let exports = 0, cancellations = 0, snapshotReads = 0;
    const cancelUserOperation = () => { cancellations++; userOperation.abort(); };
    const handle = {
      exportNative() { exports++; return pending.promise; },
      cancel: cancelUserOperation, endEdit: cancelUserOperation, cancelEditRequest: cancelUserOperation,
      getMutationSnapshot() { snapshotReads++; throw new Error("A cancelled read must not resume"); },
      getSelection() { snapshotReads++; throw new Error("A cancelled read must not resume"); },
    };
    const adapter = createSlideAIAdapter(() => handle, () => 0);
    const outcome = (action === "initial snapshot" ? adapter.snapshot(controller.signal)
      : adapter.live({ targetId: "editor", action: "snapshot" }, controller.signal)).catch(error => error);
    assert.equal(exports, 1);
    controller.abort(new DOMException("Stopped by user", "AbortError"));
    assert.equal((await outcome).name, "AbortError");
    assert.equal(cancellations, 0);
    assert.equal(userOperation.signal.aborted, false);
    // The pending operation belongs to the editor and may finish independently.
    pending.resolve(new Blob([serializeSlideDeck(animatedDeck())]));
    await Promise.resolve(); await Promise.resolve();
    assert.equal(snapshotReads, 0);
    assert.equal(cancellations, 0);
  });
}

test("live document size validation uses the UTF-8 byte limit, including its exact boundary", () => {
  const limit = 8 * 1024 * 1024;
  assert.doesNotThrow(() => assertLiveDocumentSize("a".repeat(limit)));
  for (const document of ["a".repeat(limit + 1), "あ".repeat(Math.floor(limit / 3) + 1)])
    assert.throws(() => assertLiveDocumentSize(document), error => error.code === "write_failed" && /8 MiB/.test(error.message));
});

test("live Spreadsheet rejects an oversized result before calling the editor commit API", async () => {
  const value = "x".repeat(100_000);
  const initialDocument = serializeWorkbook({ sheets: [{ id: "main", name: "Main", rowCount: 100, columnCount: 1,
    cells: Object.fromEntries(Array.from({ length: 83 }, (_, index) => [`A${index + 1}`, { value }])) }] });
  assert.ok(Buffer.byteLength(initialDocument) < 8 * 1024 * 1024);
  const workbook = parseWorkbook(initialDocument), token = { sessionId: "size-test", structureRevision: 0 };
  let commits = 0;
  const handle = {
    getMutationSnapshot: () => ({ workbook, token }),
    async batchAsync() { commits++; return { ok: true, changed: true, results: [] }; },
  };
  const adapter = createSpreadsheetAIAdapter(() => handle, () => 0);
  await assert.rejects(liveWrite(adapter, { document: initialDocument, token: JSON.stringify(token) }, [
    { type: "cells.set", sheetId: "main", values: { A84: value } },
  ], "document"), error => error.code === "write_failed" && /8 MiB/.test(error.message));
  assert.equal(commits, 0);
  assert.equal(workbook.sheets[0].cells.A84, undefined);
  assert.equal(serializeWorkbook(workbook), initialDocument);
});

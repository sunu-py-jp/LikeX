import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { create } from "react-test-renderer";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({ stdin: { contents: `export {default as Demo} from './apps/playground/src/explorer-lazy-loading-demo'; export * from './apps/playground/src/demo/lazy-folder-server'; export {createDraftSnapshot, applyAction, getSavePayload} from './packages/explorer/src/model-entry';`, resolveDir: root }, bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "explorer-boundary", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^@likex\/explorer\/model$/ }, () => ({ path: `${root}packages/explorer/src/model-entry.ts` }));
    builder.onResolve({ filter: /^@likex\/explorer$/ }, () => ({ path: "explorer", namespace: "demo-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "demo-boundary" }, () => ({ resolveDir: root, contents: `import {createElement} from 'react'; export default props=>createElement('demo-explorer',props);` }));
  } }],
});
const { Demo, createLazyFolderServer, lazyDemoSalesId, lazySearchExample, lazySearchPageExample, waitForLazyFolder, createDraftSnapshot, applyAction, getSavePayload } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const withScope = (baseline, draft) => ({ ...getSavePayload(baseline, draft), scope: { kind: "partial", loadedFolderIds: ["root"] } });
const searchConditions = { matchCase: false, wholeName: false, useRegex: false };
async function searchBatches(server, query, conditions = searchConditions) {
  const batches = [];
  for await (const batch of server.search(query, conditions, new AbortController().signal, () => Promise.resolve())) batches.push(batch);
  return batches;
}

test("lazy server keeps a valid full tree but returns only requested direct children", () => {
  const server = createLazyFolderServer();
  assert.equal(server.count(), 2576);
  assert.equal(server.initialEntries.length, 1);
  assert.equal(server.initialEntries[0].id, lazyDemoSalesId);
  assert.doesNotThrow(() => createDraftSnapshot(server.initialEntries));
  assert.doesNotThrow(() => createDraftSnapshot(server.snapshot()));
  assert.equal(server.list("root").length, 4);
  assert.equal(server.list(lazyDemoSalesId).length, 2);
  assert.equal(server.list(`${lazyDemoSalesId}-2026`).length, 2);
  assert.equal(server.list(`${lazyDemoSalesId}-2026-shinonome`).length, 320);
  assert.deepEqual(server.list("lazy-empty"), []);
  assert.throws(() => server.list("lazy-readme"), /フォルダ/);
  const copy = server.list("root"); copy[0].name = "host changed";
  assert.notEqual(server.list("root")[0].name, "host changed");
});

test("partial save updates cached files without removing unseen server descendants", async () => {
  const server = createLazyFolderServer(), baseline = createDraftSnapshot(server.list("root"));
  const draft = applyAction(baseline, { action: "rename", ids: ["lazy-readme"], name: "確認済み.md" });
  const payload = withScope(baseline, draft), hidden = server.list(`${lazyDemoSalesId}-2026-shinonome`);
  const cached = server.save(payload);
  assert.equal(cached.length, 4);
  assert.equal(server.count(), 2576);
  assert.equal(server.list("root").find(entry => entry.id === "lazy-readme").name, "確認済み.md");
  assert.deepEqual(server.list(`${lazyDemoSalesId}-2026-shinonome`), hidden);
  assert.match(await (await server.readFile("lazy-readme")).text(), /フォルダ単位/);
  assert.throws(() => server.save({ entries: [], changes: { created: [], updated: [], deleted: [] } }), /部分キャッシュ/);
});

test("partial save creates and deletes by explicit changes and persists local bodies", async () => {
  const server = createLazyFolderServer(), baseline = createDraftSnapshot(server.list("root")), local = new File(["new body"], "追加.md", { type: "text/markdown" });
  const existing = baseline.entries.find(entry => entry.id === "lazy-readme");
  const added = { ...existing, id: "added", name: local.name, size: local.size, source: { kind: "local", file: local } };
  const draft = createDraftSnapshot([...baseline.entries.filter(entry => entry.id !== existing.id), added]);
  const cached = server.save(withScope(baseline, draft));
  assert.equal(server.count(), 2576);
  assert.equal(server.list("root").some(entry => entry.id === existing.id), false);
  const committed = cached.find(entry => entry.id === added.id);
  assert.equal(committed.source.kind, "existing");
  assert.equal(await (await server.readFile(committed.source.id)).text(), "new body");
  assert.equal(server.list(`${lazyDemoSalesId}-2026-shinonome`).length, 320);
});

test("server validates changes atomically before deleting a folder with unseen children", () => {
  const server = createLazyFolderServer(), before = server.snapshot(), rootEntries = server.list("root"), sales = rootEntries.find(entry => entry.id === lazyDemoSalesId);
  assert.throws(() => server.save({ entries: rootEntries.filter(entry => entry.id !== sales.id), changes: { created: [], updated: [], deleted: [sales] }, scope: { kind: "partial", loadedFolderIds: ["root"] } }));
  assert.deepEqual(server.snapshot(), before);
});

test("replacing a file body leaves a previously saved copy's body intact", async () => {
  const server = createLazyFolderServer();
  let baseline = createDraftSnapshot(server.list("root"));
  const original = baseline.entries.find(entry => entry.id === "lazy-readme");
  const first = { ...original, source: { kind: "local", file: new File(["first"], original.name) } };
  server.save(withScope(baseline, createDraftSnapshot(baseline.entries.map(entry => entry.id === original.id ? first : entry))));
  baseline = createDraftSnapshot(server.list("root"));
  const saved = baseline.entries.find(entry => entry.id === original.id), copy = { ...saved, id: "copied", name: "控え.md" };
  server.save(withScope(baseline, createDraftSnapshot([...baseline.entries, copy])));
  baseline = createDraftSnapshot(server.list("root"));
  const changed = { ...saved, source: { kind: "local", file: new File(["second"], saved.name) } };
  const cached = server.save(withScope(baseline, createDraftSnapshot(baseline.entries.map(entry => entry.id === saved.id ? changed : entry))));
  assert.equal(await (await server.readFile(cached.find(entry => entry.id === copy.id).source.id)).text(), "first");
  assert.equal(await (await server.readFile(cached.find(entry => entry.id === saved.id).source.id)).text(), "second");
});

test("lazy latency uses a cancellable timer without real sleeps", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController(); let done = false;
  const pending = waitForLazyFolder(controller.signal).then(() => { done = true; });
  t.mock.timers.tick(349); await Promise.resolve(); assert.equal(done, false);
  t.mock.timers.tick(1); await pending; assert.equal(done, true);
  const cancelled = new AbortController(), reason = new Error("closed"), waiting = waitForLazyFolder(cancelled.signal);
  cancelled.abort(reason); await assert.rejects(waiting, error => error === reason);
  assert.throws(() => waitForLazyFolder(cancelled.signal), error => error === reason);
});

test("whole-server search returns eight uncached development hits with only their deduplicated ancestors", async () => {
  const server = createLazyFolderServer(), batches = await searchBatches(server, lazySearchExample, { ...searchConditions, useRegex: true });
  assert.equal(batches.length, 4);
  assert.ok(batches.every(batch => batch.hits.length === 2));
  const hits = batches.flatMap(batch => batch.hits), received = batches.flatMap(batch => batch.entries);
  assert.equal(hits.length, 8); assert.ok(hits.every(hit => hit.entryId.startsWith("lazy-development-")));
  assert.equal(received.length, 15); assert.equal(new Set(received.map(entry => entry.id)).size, 15);
  assert.ok(hits.every(hit => received.some(entry => entry.id === hit.entryId)));
  assert.ok(received.filter(entry => entry.kind === "file").every(entry => hits.some(hit => hit.entryId === entry.id)));
  const cached = new Map(server.list("root").map(entry => [entry.id, entry]));
  for (const batch of batches) {
    for (const entry of batch.entries) cached.set(entry.id, entry);
    assert.doesNotThrow(() => createDraftSnapshot([...cached.values()]));
  }
  assert.equal(cached.size, 18); assert.equal(server.count(), 2576);
  assert.ok(hits.every(hit => Object.keys(hit).length === 1 && typeof hit.entryId === "string"));
  received[0].name = "client mutation";
  assert.equal(server.list("root").find(entry => entry.id === "lazy-development").name, "開発資料");
});

test("server search follows case, whole-name and regex conditions and searches names rather than paths", async () => {
  const server = createLazyFolderServer();
  const insensitive = await searchBatches(server, "001_機能仕様.MD", { ...searchConditions, wholeName: true });
  assert.equal(insensitive.flatMap(batch => batch.hits).length, 4);
  assert.deepEqual(await searchBatches(server, "001_機能仕様.MD", { ...searchConditions, matchCase: true, wholeName: true }), []);
  assert.deepEqual(await searchBatches(server, "001_機能仕様", { ...searchConditions, wholeName: true }), []);
  assert.deepEqual(await searchBatches(server, "開発資料/"), []);
  assert.deepEqual(await searchBatches(server, " "), []);
  await assert.rejects(searchBatches(server, "(", { ...searchConditions, useRegex: true }));
  const folders = (await searchBatches(server, "東雲製作所")).flatMap(batch => batch.hits);
  assert.equal(folders.length, 4);
  assert.equal(server.list(folders[0].entryId).length, 320);
});

test("cancelling whole-server search prevents the next metadata batch from being yielded", async () => {
  const server = createLazyFolderServer(), controller = new AbortController(), gates = [];
  const stream = server.search(lazySearchExample, { ...searchConditions, useRegex: true }, controller.signal, () => new Promise(resolve => gates.push(resolve)));
  const first = stream.next(); gates.shift()();
  assert.equal((await first).value.hits.length, 2);
  const next = stream.next(), reason = new Error("query changed");
  controller.abort(reason); gates.shift()();
  await assert.rejects(next, error => error === reason);
  assert.equal((await stream.next()).done, true);
});

test("paged server returns 1280 ranked hits in requested pages and stops with a null cursor", async () => {
  const server = createLazyFolderServer(), signal = new AbortController().signal, cached = new Map(server.list("root").map(entry => [entry.id, entry]));
  const ids = [], counts = []; let cursor = null;
  do {
    const page = await server.searchPage({ query: lazySearchPageExample, conditions: searchConditions, cursor, limit: 100 }, signal, () => Promise.resolve());
    counts.push(page.hits.length); ids.push(...page.hits.map(hit => hit.entryId));
    for (const entry of page.entries) cached.set(entry.id, entry);
    assert.doesNotThrow(() => createDraftSnapshot([...cached.values()]));
    assert.ok(page.entries.filter(entry => entry.kind === "file").every(entry => page.hits.some(hit => hit.entryId === entry.id)));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(counts, [...Array(12).fill(100), 80]);
  assert.equal(new Set(ids).size, 1280);
  assert.deepEqual(ids, server.snapshot().filter(entry => entry.name.includes(lazySearchPageExample)).map(entry => entry.id));
  assert.equal(cached.size, 1290);
});

test("page cursors retain the initial ranking across edits and reject changed search conditions", async () => {
  const server = createLazyFolderServer(), signal = new AbortController().signal, wait = () => Promise.resolve();
  const request = { query: lazySearchPageExample, conditions: searchConditions, cursor: null, limit: 100 };
  const first = await server.searchPage(request, signal, wait), next = { ...request, cursor: first.nextCursor };
  const second = await server.searchPage(next, signal, wait);
  const baseline = createDraftSnapshot(server.snapshot()), draft = applyAction(baseline, { action: "rename", ids: [second.hits[0].entryId], name: "検索対象外.md" });
  server.save(withScope(baseline, draft));
  const retried = await server.searchPage(next, signal, wait);
  assert.deepEqual(retried.hits, second.hits);
  assert.deepEqual(retried.entries, second.entries);
  await assert.rejects(server.searchPage({ ...next, query: "商談記録" }, signal, wait), /続きが見つかりません/);
  await assert.rejects(server.searchPage({ ...next, cursor: "unknown" }, signal, wait), /続きが見つかりません/);
  const noMatches = await server.searchPage({ ...request, query: "存在しない名前" }, signal, wait);
  assert.deepEqual(noMatches, { hits: [], entries: [], nextCursor: null });
});

test("cancelling a page request prevents returning its metadata", async () => {
  const server = createLazyFolderServer(), controller = new AbortController(); let release;
  const pending = server.searchPage({ query: lazySearchPageExample, conditions: searchConditions, cursor: null, limit: 100 }, controller.signal, () => new Promise(resolve => { release = resolve; }));
  const reason = new Error("new query"); controller.abort(reason); release();
  await assert.rejects(pending, error => error === reason);
});

test("demo wires partial loading, navigation events and cached entry counts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renderer;
  await act(async () => { renderer = create(createElement(Demo)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const component = () => renderer.root.findByType("demo-explorer");
  assert.equal(component().props.initialEntries.length, 1);
  assert.deepEqual(component().props.folderLoading, { initialLoadedFolderIds: [] });
  let pending, entries;
  await act(async () => { pending = component().props.onLoadFolder({ folderId: "root", path: "/" }, { signal: new AbortController().signal }); });
  assert.match(JSON.stringify(renderer.toJSON()), /取得中/);
  await act(async () => { t.mock.timers.tick(350); entries = await pending; });
  assert.equal(entries.length, 4);
  await act(async () => {
    component().props.onEvent({ type: "folder-load", status: "success", folderId: "root", path: "/", addedCount: 3 });
    component().props.onEvent({ type: "navigate", location: { kind: "folder", id: lazyDemoSalesId, path: "/営業資料", name: "営業資料" } });
  });
  const numbers = renderer.root.findByProps({ className: "lazy-folder-stats" }).findAllByType("strong");
  assert.equal(numbers[0].props.children, 4);
  assert.match(JSON.stringify(renderer.toJSON()), /navigate → \/営業資料/);
  await act(async () => component().props.onEvent({ type: "search-hydrate", addedCount: 14 }));
  assert.equal(renderer.root.findByProps({ className: "lazy-folder-stats" }).findAllByType("strong")[0].props.children, 18);
});

test("demo examples use injected search UI and a small page updates received-hit and metadata counts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renderer, controls;
  await act(async () => { renderer = create(createElement(Demo)); });
  const component = () => renderer.root.findByType("demo-explorer"), changes = [];
  await act(async () => { controls = create(component().props.renderSearch({ defaultInput: createElement("input", { "aria-label": "keyword" }), defaultOptions: createElement("button", null, "options"), setConditions: value => changes.push(value), setQuery: value => changes.push(value) })); });
  t.after(async () => { await act(async () => { renderer.unmount(); controls.unmount(); }); });
  const example = controls.root.findAllByType("button").find(button => button.props.children === "例：未取得の開発資料8件");
  await act(async () => example.props.onClick());
  assert.deepEqual(changes, [{ useRegex: true, wholeName: false, matchCase: false }, lazySearchExample]);
  assert.match(JSON.stringify(controls.toJSON()), /全件（未取得含む）/);
  assert.equal(component().props.search.pageSize, 100);
  let pending, page;
  await act(async () => { pending = component().props.onSearchRequest({ query: lazySearchExample, conditions: { ...searchConditions, useRegex: true }, entries: component().props.initialEntries, cursor: null, limit: 100 }, { signal: new AbortController().signal }); });
  await act(async () => { t.mock.timers.tick(350); page = await pending; });
  assert.equal(page.hits.length, 8); assert.equal(page.nextCursor, null);
  const summary = renderer.root.findByProps({ "aria-label": "全件検索の状態" }).findByProps({ role: "status" });
  assert.deepEqual(summary.findByType("strong").props.children, [8, " 件ヒット"]);
  assert.ok(summary.props.children.includes(15)); assert.ok(summary.props.children.includes("完了"));
});

test("demo requests 100 additional hits, retains counts on failure and retries the same cursor", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let renderer;
  await act(async () => { renderer = create(createElement(Demo)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const component = () => renderer.root.findByType("demo-explorer"), signal = new AbortController().signal;
  const request = { query: lazySearchPageExample, conditions: searchConditions, entries: component().props.initialEntries, cursor: null, limit: 100 };
  const summary = () => renderer.root.findByProps({ "aria-label": "全件検索の状態" }).findByProps({ role: "status" });
  let pending, page;
  await act(async () => { pending = component().props.onSearchRequest(request, { signal }); });
  await act(async () => { t.mock.timers.tick(350); page = await pending; });
  assert.deepEqual(summary().findByType("strong").props.children, [100, " 件ヒット"]);
  request.cursor = page.nextCursor;
  await act(async () => renderer.root.findByType("input").props.onChange({ target: { checked: true } }));
  await act(async () => { pending = component().props.onSearchRequest(request, { signal }); });
  await act(async () => { const rejected = assert.rejects(pending, /デモ用の追加取得エラー/); t.mock.timers.tick(350); await rejected; });
  assert.deepEqual(summary().findByType("strong").props.children, [100, " 件ヒット"]);
  assert.ok(summary().props.children.includes("失敗"));
  assert.equal(renderer.root.findByType("input").props.checked, false);
  await act(async () => { pending = component().props.onSearchRequest(request, { signal }); });
  await act(async () => { t.mock.timers.tick(350); page = await pending; });
  assert.equal(page.hits.length, 100);
  assert.deepEqual(summary().findByType("strong").props.children, [200, " 件ヒット"]);
  assert.ok(summary().props.children.includes(3));
});

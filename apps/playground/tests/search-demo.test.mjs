import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const output = await build({ stdin: { contents: `export {default as ExplorerDemo} from './apps/playground/src/explorer-search-demo'; export {default as SpreadsheetDemo} from './apps/playground/src/spreadsheet-search-demo'; export * from './apps/playground/src/demo/search-demo'; export * from './apps/playground/src/demo/search-samples'; export * from './apps/playground/src/demo/meeting-search'; export * from './apps/playground/src/demo/meeting-search-ui'; export {resolveExplorerSearchHits} from './packages/explorer/src/model-entry'; export {createDraftSnapshot} from './packages/explorer/src/model/draft'; export {normalizeWorkbook} from './packages/spreadsheet/src/model/index';`, resolveDir: root },
  bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "component-boundary", setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^@likex\/(explorer|spreadsheet)$/ }, ({ path }) => ({ path, namespace: "demo-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "demo-boundary" }, ({ path }) => ({ resolveDir: root, contents: `import {createElement} from 'react'; export default props=>createElement('${path.endsWith("explorer") ? "demo-explorer" : "demo-spreadsheet"}',props); ${path.endsWith("spreadsheet") ? `export {createWorkbook} from './packages/spreadsheet/src/model/index'; export {findSpreadsheetCells} from './packages/spreadsheet/src/model/editing/search';` : ""}` }));
  } }],
});
const { ExplorerDemo, SpreadsheetDemo, SearchDemoControl, searchDemoPattern, createSearchEntries, createSearchWorkbook, createDraftSnapshot, normalizeWorkbook, createMeetingSearchEntries, meetingSearchExample, meetingSearchFile, searchMeetingMinutes, streamMeetingSearchResults, waitForMeetingSearchResult, resolveExplorerSearchHits, renderMeetingSearchResult } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function mount(t, component) {
  let renderer; await act(async () => { renderer = create(h(component)); });
  t.after(async () => { await act(async () => renderer.unmount()); }); return renderer;
}

test("generated pattern escapes punctuation instead of interpreting user text as regex operators", () => {
  assert.equal(searchDemoPattern("C++"), "/C\\+\\+/i");
  assert.equal(searchDemoPattern("v1.2", true, true), "/^v1\\.2$/");
  assert.equal(searchDemoPattern("[a]/b"), "/\\[a\\]\\/b/i");
  assert.equal(searchDemoPattern(""), "（未入力）");
});

test("Explorer host handler uses current entries, case/full-name conditions and literal punctuation", async t => {
  const renderer = await mount(t, ExplorerDemo), component = () => renderer.root.findByType("demo-explorer");
  const run = async (query, matchCase = false, wholeName = false, entries = component().props.initialEntries) => {
    let ids; await act(async () => { ids = await component().props.onSearchRequest({ entries, query, conditions: { matchCase, wholeName, useRegex: false } }, { signal: new AbortController().signal }); });
    return entries.filter(entry => ids.includes(entry.id)).map(entry => entry.name);
  };
  assert.deepEqual(await run("Report"), ["Report.txt", "report.txt", "Report-final.txt", "REPORT.txt"]);
  assert.deepEqual(await run("Report", true), ["Report.txt", "Report-final.txt"]);
  assert.deepEqual(await run("Report.txt", true, true), ["Report.txt"]);
  assert.deepEqual(await run("C++"), ["C++.txt", "C++ 入門.txt"]);
  assert.deepEqual(await run("v1.2"), ["v1.2.txt"]);
  const draft = component().props.initialEntries.map((entry, i) => i ? entry : { ...entry, name: "新しい下書き.txt" });
  assert.deepEqual(await run("新しい下書き", false, false, draft), ["新しい下書き.txt"]);
  assert.equal(renderer.root.findByProps({ role: "status" }).findByType("code").props.children, "/新しい下書き/i");
  await act(async () => renderer.root.findByProps({ value: "submit", type: "radio" }).props.onChange());
  assert.equal(component().props.search.trigger, "submit");
  assert.equal(component().props.search.debounceMs, 180);
});

test("Spreadsheet host handler respects sheet/workbook scope and exact/case-sensitive matches", async t => {
  const renderer = await mount(t, SpreadsheetDemo), component = () => renderer.root.findByType("demo-spreadsheet");
  const run = async (text, matchCase = false, wholeCell = false, sheetId) => {
    let matches; await act(async () => { matches = await component().props.onSearchRequest({ workbook: component().props.initialWorkbook, query: { text, matchCase, wholeCell }, sheetId, scope: sheetId ? "sheet" : "workbook" }, { signal: new AbortController().signal }); }); return matches;
  };
  assert.equal((await run("Report")).length, 5);
  assert.equal((await run("Report", false, true)).length, 4);
  assert.equal((await run("Report", true, true)).length, 2);
  const current = await run("Report", true, true, "names");
  assert.deepEqual(current.map(match => [match.sheetId, match.address]), [["names", "A2"]]);
  assert.equal((await run("C++")).length, 3);
  assert.equal((await run("v1.2")).length, 1);
  await act(async () => renderer.root.findByProps({ value: "submit", type: "radio" }).props.onChange());
  assert.equal(component().props.search.trigger, "submit");
});

test("custom input preserves Explorer IME/Enter/ref bindings while condition controls update the public contract", async t => {
  const renderer = await mount(t, ExplorerDemo), { renderSearch } = renderer.root.findByType("demo-explorer").props;
  const changes = [], events = [], ref = { current: null }, inputProps = { ref, value: "C++", onCompositionStart: () => events.push("composition"), onKeyDown: () => events.push("enter") };
  let custom; await act(async () => { custom = create(renderSearch({ query: "C++", conditions: { matchCase: false, wholeName: false, useRegex: false }, inputProps, error: "検索エラー", setConditions: value => changes.push(value), submit: () => events.push("submit"), clear: () => events.push("clear") })); });
  t.after(async () => { await act(async () => custom.unmount()); });
  const input = custom.root.findByProps({ "aria-label": "検索する文字列" });
  assert.equal(custom.root.findByProps({ role: "alert" }).props.children, "検索エラー");
  assert.equal(input.props.ref, ref); input.props.onCompositionStart(); input.props.onKeyDown({ key: "Enter" });
  await act(async () => { custom.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }); custom.root.findByProps({ value: "partial" }).props.onChange({ target: { value: "whole" } }); });
  assert.deepEqual(changes, [{ matchCase: true }, { wholeName: true }]);
  assert.deepEqual(events, ["composition", "enter"]);
});

test("custom search panel keeps empty submissions disabled", async t => {
  let renderer; await act(async () => { renderer = create(h(SearchDemoControl, { input: h("input"), text: "", matchCase: false, wholeText: false, useRegex: false, onMatchCase() {}, onWholeText() {}, onUseRegex() {}, submit() {}, clear() {} })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.ok(renderer.root.findAllByType("button").every(button => button.props.disabled));
});


test("both demos execute raw regex and surface malformed patterns through the public handler", async t => {
  for (const [Demo, name] of [[ExplorerDemo, "demo-explorer"], [SpreadsheetDemo, "demo-spreadsheet"]]) {
    const renderer = await mount(t, Demo), component = renderer.root.findByType(name), explorer = name === "demo-explorer";
    const query = text => explorer ? { entries: component.props.initialEntries, query: text, conditions: { matchCase: true, wholeName: false, useRegex: true } }
      : { workbook: component.props.initialWorkbook, query: { text, matchCase: true, useRegex: true }, scope: "sheet", sheetId: "names" };
    let matches; await act(async () => { matches = await component.props.onSearchRequest(query("^Report"), { signal: new AbortController().signal }); });
    assert.equal(matches.length, 2);
    assert.throws(() => component.props.onSearchRequest(query("("), { signal: new AbortController().signal }), /正規表現/);
  }
  assert.equal(searchDemoPattern("Report|売上", false, true, true), "/^(?:Report|売上)$/i");
});

test("custom regex mode preserves conditions and delegates Spreadsheet errors to its dialog", async t => {
  const renderer = await mount(t, SpreadsheetDemo), component = () => renderer.root.findByType("demo-spreadsheet"), changes = [];
  const context = { defaultInput: h("input", { value: "(", readOnly: true }), query: { text: "(", useRegex: true, matchCase: true, wholeCell: true, lookIn: "values" }, scope: "sheet", disabled: false, error: "正規表現が正しくありません", searching: false, setQuery: value => changes.push(value), setScope() {}, submit() {}, clear() {}, mode: "find" };
  let custom; await act(async () => { custom = create(component().props.renderSearch(context)); });
  t.after(async () => { await act(async () => custom.unmount()); });
  assert.equal(custom.root.findAllByProps({ role: "alert" }).length, 0);
  await act(async () => custom.root.findByProps({ "aria-label": "検索の入力方式" }).props.onChange({ target: { value: "literal" } }));
  assert.deepEqual(changes, [{ ...context.query, useRegex: false }]);
  await act(async () => custom.root.findByProps({ "aria-label": "検索を実行するタイミング" }).props.onChange({ target: { value: "submit" } }));
  assert.equal(component().props.search.trigger, "submit");
});


test("both fixture models pass the actual libraries' initialization validation", () => {
  const entries = createSearchEntries(), snapshot = createDraftSnapshot(entries);
  assert.equal(snapshot.entries.length, entries.length);
  assert.equal(snapshot.entries.filter(entry => entry.kind === "file").length, 11);
  const workbook = normalizeWorkbook(createSearchWorkbook());
  assert.equal(workbook.sheets.length, 2);
  assert.equal(workbook.sheets[0].cells.A2.value, "Report");
});


test("meeting search returns valid rich hits using customer, meeting date and body rather than file dates", () => {
  const entries = createMeetingSearchEntries(); assert.equal(createDraftSnapshot(entries).entries.length, 6);
  const { keyword, ...filters } = meetingSearchExample;
  const hits = searchMeetingMinutes(entries, keyword, filters);
  assert.deepEqual(hits.map(hit => hit.entryId), ["meeting-shinonome-0926", "meeting-shinonome-0912"]);
  assert.deepEqual(resolveExplorerSearchHits(hits, entries), hits);
  const september = hits.find(hit => hit.entryId === "meeting-shinonome-0912");
  assert.equal(september.metadata.meetingDate, "2026-09-12");
  assert.equal(entries.find(entry => entry.id === september.entryId).updatedAt.slice(0,10), "2026-10-03");
  const august = entries.find(entry => entry.id === "meeting-shinonome-0828");
  assert.equal(august.updatedAt.slice(0,10), "2026-09-17");
  assert.ok(!hits.some(hit => hit.entryId === august.id));
  assert.ok(hits.every(hit => hit.metadata.customerName === "東雲製作所" && hit.snippet.includes("料金改定") && hit.reason.includes("本文")));
  assert.ok(meetingSearchFile(september.entryId).includes(september.snippet));
  assert.ok(!entries.some(entry => entry.name.includes("料金改定")), "body hits do not require filename hits");
  assert.equal(searchMeetingMinutes(entries, "", filters).length, 0);
  assert.equal(searchMeetingMinutes(entries.filter(entry => entry.id !== september.entryId), keyword, filters).length, 1);
});

test("meeting filters reject invalid and reversed dates and use inclusive day boundaries", () => {
  const entries = createMeetingSearchEntries();
  assert.equal(searchMeetingMinutes(entries, "料金改定", { customerName: "東雲製作所", dateFrom: "2026-09-12", dateTo: "2026-09-12" }).length, 1);
  for (const filters of [{ dateFrom: "2026-09-30", dateTo: "2026-09-01" }, { dateFrom: "2026-02-31" }, { dateTo: "2026-99-01" }])
    assert.throws(() => searchMeetingMinutes(entries, "料金改定", filters), /会議日/);
});

test("meeting demo passes host filters through search.params and preserves the standard literal/regex mode", async t => {
  const renderer = await mount(t, ExplorerDemo), component = () => renderer.root.findByType("demo-explorer");
  assert.equal(component().props.renderSearchResult, undefined);
  const button = renderer.root.findAllByType("button").find(button => button.props.children === "議事録の本文");
  await act(async () => button.props.onClick());
  assert.equal(component().props.search.params.mode, "minutes");
  assert.equal(component().props.search.resultDetailsHeight, 192);
  const calls = []; let custom;
  const context = { query: "", trigger: "submit", inputProps: { value: "", readOnly: true }, setQuery: value => calls.push(value), submit() {}, clear() {}, searching: false, error: null };
  await act(async () => { custom = create(component().props.renderSearch(context)); });
  t.after(async () => { await act(async () => custom.unmount()); });
  await act(async () => custom.root.findAllByType("button").find(button => String(button.props.children).startsWith("例を入力")).props.onClick());
  assert.deepEqual(calls, ["料金改定"]);
  assert.deepEqual(component().props.search.params, { mode: "minutes", customerName: "東雲製作所", dateFrom: "2026-09-01", dateTo: "2026-09-30", incremental: true });
  const incremental = custom.root.findByProps({ type: "checkbox" });
  assert.equal(incremental.props.checked, true);
  await act(async () => incremental.props.onChange({ target: { checked: false } }));
  assert.equal(component().props.search.params.incremental, false);
  let hits; await act(async () => { hits = await component().props.onSearchRequest({ entries: component().props.initialEntries, query: "料金改定", params: component().props.search.params }, { signal: new AbortController().signal }); });
  assert.equal(hits.length, 2); assert.ok(hits.every(hit => typeof hit === "object" && hit.snippet));
  assert.equal(component().props.renderSearchResult, renderMeetingSearchResult);
});

test("custom meeting result displays meeting date and file update independently and leaves filename hits at the default", async t => {
  const entries = createMeetingSearchEntries(), hit = searchMeetingMinutes(entries, "料金改定", meetingSearchExample).at(-1), entry = entries.find(entry => entry.id === hit.entryId);
  let renderer; await act(async () => { renderer = create(renderMeetingSearchResult({ entry, hit, query: "料金改定", view: "details", selected: false, defaultContent: h("span", null, "default") })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.equal(renderer.root.findByType("time").props.dateTime, "2026-09-12");
  const text = JSON.stringify(renderer.toJSON());
  assert.match(text, /2026-10-03/); assert.match(text, /東雲製作所/); assert.match(text, /料金改定/);
  assert.equal(renderMeetingSearchResult({ entry, hit: { entryId: entry.id } }), undefined);
});

test("meeting stream yields one new hit per gate and ignores a completed wait after cancellation", async () => {
  const hits = searchMeetingMinutes(createMeetingSearchEntries(), "料金改定", meetingSearchExample);
  const controller = new AbortController(), gates = [];
  const stream = streamMeetingSearchResults(hits, controller.signal, signal => {
    assert.equal(signal, controller.signal);
    return new Promise(resolve => gates.push(resolve));
  });
  const first = stream.next();
  assert.equal(gates.length, 1);
  gates.shift()();
  assert.deepEqual(await first, { value: [hits[0]], done: false });
  const second = stream.next(), reason = new Error("superseded");
  assert.equal(gates.length, 1);
  controller.abort(reason);
  gates.shift()();
  await assert.rejects(second, error => error === reason);
  assert.equal((await stream.next()).done, true);
  await assert.rejects(streamMeetingSearchResults(hits, controller.signal).next(), error => error === reason);
});

test("meeting demo delay settles on its timer and cancels immediately without wall-clock sleeps", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  let completed = false;
  const pending = waitForMeetingSearchResult(controller.signal).then(() => { completed = true; });
  t.mock.timers.tick(649); await Promise.resolve();
  assert.equal(completed, false);
  t.mock.timers.tick(1); await pending;
  assert.equal(completed, true);
  const cancelled = new AbortController(), reason = new Error("closed");
  const waiting = waitForMeetingSearchResult(cancelled.signal);
  cancelled.abort(reason);
  await assert.rejects(waiting, error => error === reason);
  t.mock.timers.tick(650);
  assert.throws(() => waitForMeetingSearchResult(cancelled.signal), error => error === reason);
});

test("meeting handler defaults to incremental batches and updates the received count until complete", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const renderer = await mount(t, ExplorerDemo), component = () => renderer.root.findByType("demo-explorer");
  await act(async () => renderer.root.findAllByType("button").find(button => button.props.children === "議事録の本文").props.onClick());
  const { keyword, ...filters } = meetingSearchExample;
  let stream;
  await act(async () => { stream = component().props.onSearchRequest({ entries: component().props.initialEntries, query: keyword, params: { ...component().props.search.params, ...filters } }, { signal: new AbortController().signal }); });
  assert.equal(typeof stream[Symbol.asyncIterator], "function");
  const count = () => renderer.root.findByProps({ className: "search-demo-count" }).props.children[0];
  assert.equal(count(), 0);
  const received = [];
  for (const expected of [1, 2]) {
    const pending = stream.next(); let result;
    await act(async () => { t.mock.timers.tick(650); result = await pending; });
    assert.equal(result.done, false); assert.equal(result.value.length, 1);
    received.push(...result.value);
    assert.equal(count(), expected);
  }
  assert.equal((await stream.next()).done, true);
  assert.deepEqual(received.map(hit => hit.entryId), ["meeting-shinonome-0926", "meeting-shinonome-0912"]);
});

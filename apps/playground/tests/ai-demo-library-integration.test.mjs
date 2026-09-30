import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { act, createElement as h } from "react";
import { create } from "react-test-renderer";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const editorMock = kind => {
  const path = `${root}/packages/${kind}/src/model-entry.ts`;
  const isSlide = kind === "slide", initial = isSlide ? "initialDeck" : "initialWorkbook", serialize = isSlide ? "serializeSlideDeck" : "serializeWorkbook";
  return `import {createElement as h,useState,useImperativeHandle} from 'react'; import * as model from ${JSON.stringify(path)}; export * from ${JSON.stringify(path)};
    export default function Editor(props) {
      const [document,setDocument]=useState(props.${initial}), [instance]=useState(()=>++globalThis.__demoIntegration.sequence);
      const handle={${isSlide ? "getDeck" : "getWorkbook"}:()=>document,getSelection:()=>({${isSlide ? "slideId:document.slides[0].id,elementIds:[]" : "sheetId:document.sheets[0].id"}}),
        exportNative:async()=>new Blob([model.${serialize}(document)]),save:async()=>{const saved=await props.onSave(document);setDocument(saved);props.${isSlide ? "onDirtyChange" : "onUnsavedChangesChange"}?.(false);return true;}};
      useImperativeHandle(props.ref,()=>handle);
      return h('test-native-editor',{...props,ref:undefined,document,instance,replace(next){setDocument(next);props.onChange?.(next);props.onEvent?.({type:'change'});props.${isSlide ? "onDirtyChange" : "onUnsavedChangesChange"}?.(true);}});
    }`;
};
const output = await build({ stdin: { contents: `export {default as SlideAIDemo} from './apps/playground/src/slide-ai-demo'; export {default as SpreadsheetAIDemo} from './apps/playground/src/spreadsheet-ai-demo'; export * as slide from './packages/slide/src/model-entry'; export * as sheet from './packages/spreadsheet/src/model-entry';`, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false, jsx: "automatic", plugins: [{ name: "integration-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\.css$/ }, () => ({ path: "empty-style", namespace: "integration" }));
    builder.onResolve({ filter: /^@likex\/(slide|spreadsheet)$/ }, ({ path }) => ({ path, namespace: "integration" }));
    builder.onResolve({ filter: /\/(ai-workspace|demo-document-editor|demo-document-store|component-theme)$/ }, ({ path }) => ({ path: path.split("/").at(-1), namespace: "integration" }));
    builder.onResolve({ filter: /\/demo-document-library$/ }, ({ importer }) => importer.endsWith("-ai-demo.tsx") ? { path: "library", namespace: "integration" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "integration" }, ({ path }) => ({ loader: "js", resolveDir: root, contents:
      path.startsWith("@likex/") ? editorMock(path.split("/").at(-1)) : path === "empty-style" ? "" : path === "component-theme" ? "export const getDemoComponentTheme=colorMode=>({colorMode});"
      : path === "demo-document-store" ? "export const demoDocumentStore={list:(...args)=>globalThis.__demoIntegration.store.list(...args),get:(...args)=>globalThis.__demoIntegration.store.get(...args),create:(...args)=>globalThis.__demoIntegration.store.create(...args),save:(...args)=>globalThis.__demoIntegration.store.save(...args)};"
      : path === "library" ? `import {createElement as h} from 'react';import {DemoDocumentLibrary as Actual} from ${JSON.stringify(`${root}/apps/playground/src/ai/demo-document-library.tsx`)};export const DemoDocumentLibrary=props=>h(globalThis.__demoIntegration.realLibrary?Actual:'test-library',props);`
      : path === "demo-document-editor" ? "import {createElement as h} from 'react';export const DemoDocumentEditor=props=>h('test-editor-frame',props);"
      : "import {createElement as h,useState} from 'react';export function AIWorkspace(props){const [instance]=useState(()=>++globalThis.__demoIntegration.sequence),[messages,setMessages]=useState([]);return h('test-workspace',{...props,instance,messages,append:message=>setMessages(previous=>[...previous,message])});}" }));
  } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + "\n//# sourceURL=ai-demo-library-integration.js").toString("base64")}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = callback => act(async () => { await callback(); });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const config = {
  slide: { Component: m.SlideAIDemo, parse: m.slide.parseSlideDeck, serialize: m.slide.serializeSlideDeck, items: document => document.slides },
  spreadsheet: { Component: m.SpreadsheetAIDemo, parse: m.sheet.parseWorkbook, serialize: m.sheet.serializeWorkbook, items: document => document.sheets },
};
async function mount(t, kind, realLibrary = false) {
  const state = { sequence: 0, realLibrary, records: new Map(), saves: [], wait: undefined, store: {
    async list(kind) { return [...state.records.values()].filter(record => record.kind === kind).map(record => { const summary = structuredClone(record); delete summary.document; return summary; }); },
    async get(id) { return structuredClone(state.records.get(id)); },
    async create(input) { const result = { ...input, id: `doc-${state.records.size + 1}`, revision: 1, createdAt: 10, updatedAt: 10 }; state.records.set(result.id, result); return structuredClone(result); },
    async save(input) { state.saves.push(structuredClone(input)); if (state.wait) await state.wait.promise;
      const current = state.records.get(input.id); if (current.revision !== input.expectedRevision) throw new Error("別のタブで資料が更新されています。上書きしていません。");
      const fields = { ...input }; delete fields.expectedRevision;
      const next = { ...current, ...fields, revision: current.revision + 1, updatedAt: current.updatedAt + 1 };
      state.records.set(next.id, next); return structuredClone(next);
    },
  } };
  globalThis.__demoIntegration = state;
  let renderer; await change(() => { renderer = create(h(config[kind].Component)); });
  t.after(() => change(() => renderer.unmount()));
  const find = type => renderer.root.findByType(type);
  return { state, renderer, find, async createRecord(title, source = "blank") {
    const generated = await find("test-library").props.createDocument(title, source);
    return state.store.create({ kind, title, ...generated });
  }, async open(record) { await change(() => find("test-library").props.onOpen(record)); },
  async back() { await change(() => find("test-editor-frame").props.onBack()); } };
}

for (const kind of Object.keys(config)) {
  test(`${kind}: opens on the document library and blank/sample factories produce valid native documents`, async t => {
    const app = await mount(t, kind), library = app.find("test-library");
    assert.equal(library.props.kind, kind); assert.equal(app.renderer.root.findAllByType("test-native-editor").length, 0);
    const blank = await app.createRecord("空白の資料"), sample = await app.createRecord("サンプルの資料", "sample");
    const empty = config[kind].parse(blank.document), full = config[kind].parse(sample.document);
    assert.equal(blank.itemCount, config[kind].items(empty).length); assert.equal(sample.itemCount, config[kind].items(full).length);
    assert.equal(blank.itemCount, 1); assert.ok(sample.itemCount > 1);
    if (kind === "slide") { assert.equal(empty.title, blank.title); assert.equal(full.title, sample.title); assert.equal(empty.slides[0].elements.length, 0); }
    else assert.equal(Object.keys(empty.sheets[0].cells).length, 0);
    assert.equal(config[kind].serialize(full), sample.document);
  });

  test(`${kind}: saves the edited native contents and actual item count only after persistence commits`, async t => {
    const app = await mount(t, kind), record = await app.createRecord("保存前"); await app.open(record);
    const current = app.find("test-native-editor").props.document;
    const edited = kind === "slide" ? m.slide.applySlideCommands(current, [{ type: "deck.rename", title: "保存するタイトル" }, { type: "slide.add" }]).deck
      : m.sheet.applySpreadsheetCommands(current, [{ type: "sheets.add", name: "追加シート" }]).workbook;
    await change(() => app.find("test-native-editor").props.replace(edited));
    assert.equal(app.find("test-editor-frame").props.dirty, true);
    const wait = deferred(); app.state.wait = wait; let pending, settled = false;
    await change(() => { pending = app.find("test-editor-frame").props.onSave().then(value => { settled = true; return value; }); });
    assert.equal(settled, false); assert.equal(app.find("test-editor-frame").props.busy, true); assert.equal(app.state.records.get(record.id).revision, 1);
    await change(async () => { wait.resolve(); assert.equal(await pending, true); });
    const saved = app.state.records.get(record.id);
    assert.equal(saved.revision, 2); assert.equal(saved.document, config[kind].serialize(edited)); assert.equal(saved.itemCount, 2);
    assert.equal(saved.title, kind === "slide" ? "保存するタイトル" : record.title);
    assert.equal(app.find("test-editor-frame").props.title, saved.title); assert.equal(app.find("test-editor-frame").props.dirty, false);
    await change(() => app.find("test-editor-frame").props.onSave());
    assert.deepEqual(app.state.saves.map(input => input.expectedRevision), [1, 2]);
  });

  test(`${kind}: returning and opening another document resets editor host, chat and adapter revision`, async t => {
    const app = await mount(t, kind), one = await app.createRecord("資料1"), two = await app.createRecord("資料2", "sample");
    await app.open(one); const previous = app.find("test-workspace").props, editorInstance = app.find("test-native-editor").props.instance;
    await change(() => { previous.append("previous chat"); app.find("test-native-editor").props.replace(app.find("test-native-editor").props.document); });
    assert.ok(previous.adapter.readCurrent().revision > 0);
    await app.back(); assert.equal(app.renderer.root.findAllByType("test-workspace").length, 0); assert.throws(() => previous.adapter.readCurrent(), /閉じられました/);
    await app.open(two); const next = app.find("test-workspace").props;
    assert.notEqual(next.instance, previous.instance); assert.notEqual(next.adapter, previous.adapter); assert.notEqual(app.find("test-native-editor").props.instance, editorInstance);
    assert.deepEqual(next.messages, []); assert.equal(next.adapter.readCurrent().revision, 0);
    assert.equal(next.adapter.readCurrent().document, two.document);
    const snapshot = await next.adapter.snapshot(new AbortController().signal); assert.equal(snapshot.documentTitle, two.title);
    await app.back(); await app.open(two); assert.notEqual(app.find("test-workspace").props.instance, next.instance);
  });

  test(`${kind}: conflicting saves preserve the newer stored record, dirty state and expected revision`, async t => {
    const app = await mount(t, kind), record = await app.createRecord("競合前"); await app.open(record);
    const content = app.find("test-native-editor").props.document;
    await change(() => app.find("test-native-editor").props.replace(content));
    const wait = deferred(); app.state.wait = wait; let pending;
    await change(() => { pending = app.find("test-editor-frame").props.onSave().catch(error => error); });
    const newer = { ...record, title: "別のタブの更新", revision: 2, updatedAt: 20 }; app.state.records.set(record.id, newer);
    await change(async () => { wait.resolve(); assert.match((await pending).message, /別のタブ.*上書きしていません/); });
    assert.deepEqual(app.state.records.get(record.id), newer); assert.equal(app.find("test-editor-frame").props.title, record.title);
    assert.equal(app.find("test-editor-frame").props.dirty, true); assert.equal(app.find("test-editor-frame").props.busy, false);
    await change(() => assert.rejects(app.find("test-editor-frame").props.onSave(), /別のタブ/));
    assert.deepEqual(app.state.saves.map(input => input.expectedRevision), [1, 1]);
  });

  test(`${kind}: invalid saved native data stays on the real library and surfaces its parse failure`, async t => {
    const app = await mount(t, kind, true);
    app.state.records.set("bad", { id: "bad", kind, title: "破損資料", document: "not json", itemCount: 1, revision: 1, createdAt: 10, updatedAt: 10 });
    await change(() => app.renderer.root.findByProps({ "aria-label": "一覧を更新" }).props.onClick());
    await change(() => app.renderer.root.findByProps({ "aria-label": "破損資料を開く" }).props.onClick());
    assert.equal(app.renderer.root.findAllByType("test-native-editor").length, 0);
    const alerts = app.renderer.root.findAllByProps({ role: "alert" }); assert.equal(alerts.length, 1);
    let expected; try { config[kind].parse("not json"); } catch (error) { expected = error.message; }
    assert.ok(expected); assert.equal(alerts[0].findByType("p").children.join(""), expected);
    assert.equal(app.state.records.size, 1);
  });
}

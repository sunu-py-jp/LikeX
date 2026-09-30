import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

const output = await build({ stdin: { contents: `export {DemoDocumentLibrary} from './src/ai/demo-document-library';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.css': 'empty' },
  plugins: [{ name: 'react-and-storage', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /\/demo-document-store$/ }, () => ({ path: 'storage', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const demoDocumentStore = new Proxy({}, {get:(_object,key)=>(...args)=>globalThis.__demoDocumentStore[key](...args)});', loader: 'js' }));
  } }] });
const { DemoDocumentLibrary } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=demo-document-library-tests.js').toString('base64')}`);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const change = callback => act(async () => { await callback(); });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const summary = (id = 'saved', kind = 'slide', extra = {}) => ({ id, kind, title: `${id}の資料`, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, revision: 1, itemCount: 3, ...extra });
async function mount(t, supplied = {}, customStore = {}) {
  const calls = { list: [], get: [], create: [], generate: [], open: [] }, records = new Map();
  globalThis.__demoDocumentStore = {
    async list(kind) { calls.list.push(kind); return []; },
    async get(id) { calls.get.push(id); return records.get(id); },
    async create(input) { calls.create.push(input); const record = { ...summary(`new-${calls.create.length}`, input.kind), ...input }; records.set(record.id, record); return record; },
    ...customStore,
  };
  const originalFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => { callback(); return 0; };
  t.after(() => { globalThis.requestAnimationFrame = originalFrame; });
  let props = { kind: 'slide', label: 'スライド', colorMode: 'light', async createDocument(title, source) { calls.generate.push({ title, source }); return { document: 'serialized-native', itemCount: 1 }; }, onOpen(record) { calls.open.push(record); }, ...supplied };
  let renderer, closed = false;
  await change(() => { renderer = create(h(DemoDocumentLibrary, props)); });
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { renderer, calls, records, unmount, async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(DemoDocumentLibrary, props))); } };
}
const control = (app, name) => app.renderer.root.findByProps({ 'aria-label': name });
const cards = app => app.renderer.root.findAllByProps({ className: 'demo-document-card' });
const tile = (app, source = 'blank', label = 'スライド', currentTarget = { focus() {} }) => change(() => control(app, `${source === 'blank' ? '空白' : 'サンプル'}の${label}を作成`).props.onClick({ currentTarget }));
const titleInput = app => app.renderer.root.findByProps({ required: true });
const submit = app => change(() => app.renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
const retry = (app, text = 'もう一度試す') => change(() => app.renderer.root.findAllByType('button').find(button => button.children.includes(text)).props.onClick());

test('landing reads only metadata, shows local storage hint and offers templates without auto-seeding or a title form', async t => {
  const app = await mount(t);
  assert.deepEqual(app.calls.list, ['slide']); assert.equal(app.calls.get.length, 0); assert.equal(app.calls.create.length, 0);
  assert.equal(app.renderer.root.findAllByType('form').length, 0);
  assert.equal(app.renderer.root.findByProps({ className: 'demo-document-save-hint' }).children.join(''), 'このブラウザーに保存されます。');
  assert.ok(app.renderer.root.findByProps({ className: 'demo-document-empty' }).children.some(child => typeof child === 'object' && child.children.includes('保存した資料はまだありません。')));
  assert.equal(control(app, '空白のスライドを作成').props.disabled, false); assert.equal(control(app, 'サンプルのスライドを作成').props.disabled, false);
});

test('blank/sample creation uses a compact dialog, validates the title, persists before opening and submits once', async t => {
  const wait = deferred(), generated = deferred(); let persistCalls = 0;
  const app = await mount(t, { createDocument: async (title, source) => { app.calls.generate.push({ title, source }); return generated.promise; } }, {
    async create(input) { persistCalls++; app.calls.create.push(input); return wait.promise; },
  });
  await tile(app, 'sample'); assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 1);
  await change(() => titleInput(app).props.onChange({ target: { value: '  ' } })); await submit(app);
  assert.equal(app.calls.generate.length, 0); assert.equal(titleInput(app).props['aria-invalid'], true);
  await change(() => titleInput(app).props.onChange({ target: { value: '  営業提案  ' } }));
  await submit(app); await submit(app);
  assert.deepEqual(app.calls.generate, [{ title: '営業提案', source: 'sample' }]);
  assert.equal(titleInput(app).props.disabled, true); assert.equal(control(app, '作成をキャンセル').props.disabled, true);
  assert.equal(app.calls.open.length, 0); assert.equal(persistCalls, 0);
  await change(() => generated.resolve({ document: 'generated', itemCount: 4 }));
  assert.equal(persistCalls, 1); assert.equal(app.calls.open.length, 0);
  assert.deepEqual(app.calls.create[0], { kind: 'slide', title: '営業提案', document: 'generated', itemCount: 4 });
  const saved = { ...summary('created'), title: '営業提案', document: 'generated', itemCount: 4 };
  await change(() => wait.resolve(saved)); assert.deepEqual(app.calls.open, [saved]);
});

test('existing records open through get only; list presentation, sorting, title search and view toggle are local', async t => {
  const rows = [summary('older', 'spreadsheet', { title: '売上報告', updatedAt: 10 }), summary('newer', 'spreadsheet', { title: 'ＡＷＳ設計', updatedAt: 20 })];
  const full = { ...rows[0], document: 'workbook' }; let getCalls = 0;
  const app = await mount(t, { kind: 'spreadsheet', label: 'スプレッドシート' }, { async list() { return rows; }, async get(id) { getCalls++; assert.equal(id, 'older'); return full; } });
  assert.equal(app.renderer.root.findByProps({ className: 'demo-document-records is-list' }).type, 'ul');
  assert.deepEqual(cards(app).map(card => card.props['aria-label']), ['ＡＷＳ設計を開く', '売上報告を開く']);
  assert.ok(app.renderer.root.findAllByProps({ className: 'demo-document-item-count' }).every(node => node.children.join('') === '3 シート'));
  await change(() => control(app, '保存した資料を検索').props.onChange({ target: { value: 'aws' } }));
  assert.equal(cards(app).length, 1); assert.equal(getCalls, 0);
  await change(() => control(app, '保存した資料を検索').props.onChange({ target: { value: 'not-found' } }));
  assert.equal(cards(app).length, 0); assert.match(JSON.stringify(app.renderer.toJSON()), /一致する資料がありません/);
  await change(() => control(app, '保存した資料を検索').props.onChange({ target: { value: '' } }));
  await change(() => control(app, '資料の並び順').props.onChange({ target: { value: 'title' } }));
  assert.deepEqual(cards(app).map(card => card.props['aria-label']), [...rows].sort((a, b) => a.title.localeCompare(b.title, 'ja-JP')).map(row => `${row.title}を開く`));
  await change(() => control(app, 'カード表示に切り替え').props.onClick());
  assert.equal(app.renderer.root.findByProps({ className: 'demo-document-records is-cards' }).type, 'ul');
  await change(() => control(app, '売上報告を開く').props.onClick()); assert.deepEqual(app.calls.open, [full]);
  assert.equal(getCalls, 1); assert.equal(app.calls.generate.length, 0); assert.equal(app.calls.create.length, 0);
});

test('list failure can be retried and storage failure never opens an unsaved generated document', async t => {
  let lists = 0, creates = 0;
  const app = await mount(t, {}, { async list() { if (++lists === 1) throw new Error('保存領域を読み込めません。'); return []; }, async create(input) { if (++creates === 1) throw new Error('保存容量が不足しています。'); return { ...summary('saved'), ...input }; } });
  assert.match(JSON.stringify(app.renderer.toJSON()), /保存領域を読み込めません/);
  await retry(app, '一覧を再読み込み'); assert.equal(lists, 2);
  await tile(app); await submit(app); assert.equal(app.calls.open.length, 0); assert.match(JSON.stringify(app.renderer.toJSON()), /保存容量が不足/);
  await retry(app); assert.equal(creates, 2); assert.equal(app.calls.open.length, 1);
});

test('host rejection after successful persistence retries the saved ID without creating a duplicate', async t => {
  let opens = 0; const app = await mount(t, { onOpen(record) { app.calls.open.push(record); if (++opens === 1) throw new Error('ファイルを読み込めません。'); } });
  await tile(app); await submit(app); assert.equal(app.calls.create.length, 1);
  await retry(app); assert.equal(app.calls.create.length, 1); assert.equal(app.calls.generate.length, 1);
  assert.deepEqual(app.calls.get, ['new-1']); assert.equal(opens, 2);
});

test('missing or wrong-kind records show errors without opening and can refresh the list', async t => {
  const app = await mount(t, {}, { async list() { return [summary()]; }, async get() { return undefined; } });
  await change(() => control(app, 'savedの資料を開く').props.onClick()); assert.equal(app.calls.open.length, 0);
  assert.match(JSON.stringify(app.renderer.toJSON()), /資料が見つかりません/);
  globalThis.__demoDocumentStore.get = async () => ({ ...summary('wrong', 'spreadsheet'), document: '{}' });
  await retry(app); assert.equal(app.calls.open.length, 0); assert.match(JSON.stringify(app.renderer.toJSON()), /資料の種類が一致しません/);
  await change(() => control(app, '一覧を更新').props.onClick()); assert.equal(app.renderer.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('unmounting during generation avoids persistence; unmounting during commit discards late opening', async t => {
  for (const stage of ['generate', 'commit']) await t.test(stage, async child => {
    const wait = deferred(); let createCalls = 0;
    const app = await mount(child, { async createDocument() { return stage === 'generate' ? wait.promise : { document: 'native', itemCount: 1 }; } }, {
      async create(input) { createCalls++; return wait.promise.then(() => ({ ...summary('new'), ...input })); },
    });
    await tile(app); await submit(app); await app.unmount();
    await change(() => wait.resolve({ document: 'native', itemCount: 1 }));
    assert.equal(createCalls, stage === 'generate' ? 0 : 1); assert.equal(app.calls.open.length, 0);
  });
});

test('changing kind discards stale list and open results and resets creation mode/title', async t => {
  const oldList = deferred(), oldOpen = deferred();
  const app = await mount(t, {}, { async list(kind) { return kind === 'slide' ? oldList.promise : [summary('book', 'spreadsheet')]; }, async get() { return oldOpen.promise; } });
  await app.update({ kind: 'spreadsheet', label: 'スプレッドシート' });
  await change(() => oldList.resolve([summary('stale')]));
  assert.deepEqual(cards(app).map(card => card.props['aria-label']), ['bookの資料を開く']);
  await change(() => control(app, 'bookの資料を開く').props.onClick());
  await app.update({ kind: 'slide', label: 'スライド' });
  await change(() => oldOpen.resolve({ ...summary('book', 'spreadsheet'), document: 'native' }));
  assert.equal(app.calls.open.length, 0);
  await tile(app); assert.equal(titleInput(app).props.value, '新しいスライド');
});

test('dialog traps keyboard focus, closes with Escape and restores its originating template button', async t => {
  let focused = 0; const app = await mount(t); await tile(app, 'blank', 'スライド', { focus() { focused++; } });
  const dialog = () => app.renderer.root.findByProps({ role: 'dialog' });
  const first = { focus() { focused += 10; } }, last = { focus() { focused += 100; } }; let prevented = false;
  const currentTarget = { querySelectorAll() { return [first, last]; }, ownerDocument: { activeElement: last } };
  await change(() => dialog().props.onKeyDown({ key: 'Tab', shiftKey: false, currentTarget, preventDefault() { prevented = true; } }));
  assert.equal(prevented, true); assert.equal(focused, 10);
  currentTarget.ownerDocument.activeElement = first;
  await change(() => dialog().props.onKeyDown({ key: 'Tab', shiftKey: true, currentTarget, preventDefault() {} })); assert.equal(focused, 110);
  await change(() => dialog().props.onKeyDown({ key: 'Escape', preventDefault() {} }));
  assert.equal(focused, 111); assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});

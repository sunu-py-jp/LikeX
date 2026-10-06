import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
export { useDocumentEditor } from './src/state/use-document-editor.ts';
export { createDocumentSession } from './src/session/create-document-session.ts';
export { createDocument, serializeDocument, parseDocument, executeDocumentCommands, getDocumentText, getDocumentPage } from './src/model/index.ts';
export { exportDocumentDocx } from './src/io/index.ts';
export { resolveDocumentFeatures, assertDocumentFeatures } from './src/state/document-features.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { useDocumentEditor, createDocumentSession, createDocument, serializeDocument, parseDocument, executeDocumentCommands, getDocumentText, getDocumentPage, exportDocumentDocx, resolveDocumentFeatures, assertDocumentFeatures } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=likex-document-editor-tests.js').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rename = title => ({ type: 'document.update', title });
const base = () => createDocument({ id: 'document', title: 'Original', content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: 'Alpha beta' }] }] } });
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
async function mount(t, supplied = {}) {
  let editor, renderer, unmounted = false;
  let props = { initialDocument: base(), onSave() {}, ...supplied };
  function Probe() { editor = useDocumentEditor(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { get editor() { return editor; }, unmount, async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); } };
}

test('session saves retain undo/redo history and restore the complete original selection', () => {
  const session = createDocumentSession(base());
  assert.ok(Object.isFrozen(session.getSnapshot())); assert.ok(Object.isFrozen(session.getSnapshot().selection));
  session.select({ from: 2, to: 8 });
  session.execute({ type: 'mark.set', from: 2, to: 8, mark: 'strong' });
  session.markSaved();
  assert.equal(session.getSnapshot().dirty, false); assert.equal(session.getSnapshot().canUndo, true);
  session.select({ from: 1, to: 1 }); session.undo();
  assert.deepEqual(session.getSnapshot().selection, { from: 2, to: 8 });
  assert.equal(session.getSnapshot().dirty, true); assert.equal(session.getSnapshot().canRedo, true);
  session.redo(); assert.equal(session.getSnapshot().dirty, false);
  assert.deepEqual(session.getSnapshot().selection, { from: 1, to: 1 });
  session.execute(rename('Later')); session.discard();
  assert.equal(session.getSnapshot().document.title, 'Original');
  assert.deepEqual(session.getSnapshot().selection, { from: 2, to: 8 });
});

test('session history groups typing, no-ops retain redo, and subscriber errors cannot turn commits into failures', () => {
  const session = createDocumentSession(base()); let notifications = 0;
  session.subscribe(() => { throw new Error('observer'); }); session.subscribe(() => notifications++);
  session.execute({ type: 'text.insert', from: 1, text: 'X' }, { historyGroup: 'typing' });
  session.execute({ type: 'text.insert', from: 2, text: 'Y' }, { historyGroup: 'typing' });
  assert.equal(getDocumentText(session.getSnapshot().document), 'XYAlpha beta');
  session.undo(); assert.equal(getDocumentText(session.getSnapshot().document), 'Alpha beta'); assert.equal(session.getSnapshot().canUndo, false);
  session.execute(rename('Original')); assert.equal(session.getSnapshot().canRedo, true);
  session.redo(); assert.equal(getDocumentText(session.getSnapshot().document), 'XYAlpha beta');
  assert.ok(notifications >= 4);
  assert.throws(() => { session.getSnapshot().selection.from = 9; }, TypeError);
});

test('omitted onSave and explicit read-only prevent edits, permission requests and history changes', async t => {
  for (const options of [{ onSave: undefined }, { readOnly: true }]) {
    let requests = 0; const ref = { current: null }, events = [];
    const app = await mount(t, { ...options, ref, onEditRequest: () => { requests++; return true; }, onEvent: event => events.push(event) });
    const original = app.editor.document;
    await change(async () => {
      assert.equal(await ref.current.execute(rename('Blocked')), null);
      assert.equal(await ref.current.undo(), false); assert.equal(await ref.current.redo(), false); assert.equal(await ref.current.save(), false);
      await ref.current.importNative(serializeDocument(createDocument()));
      ref.current.discard();
    });
    assert.equal(app.editor.document, original); assert.equal(requests, 0); assert.equal(app.editor.dirty, false);
    assert.deepEqual(events, []);
  }
});

test('invalid and unchanged commands do not request edit permission', async t => {
  let requests = 0; const app = await mount(t, { onEditRequest: () => { requests++; return true; } });
  await change(async () => {
    assert.equal(await app.editor.execute(rename('Original')), null);
    assert.equal(await app.editor.execute({ type: 'text.insert', from: 900, text: 'No' }), null);
  });
  assert.equal(requests, 0); assert.equal(app.editor.canUndo, false);
});

test('ordinary model/GUI commits happen synchronously before their Promise is awaited', async t => {
  const app = await mount(t); let pending;
  await change(() => {
    pending = app.editor.execute(rename('Synchronous'));
    assert.equal(app.editor.session.getSnapshot().document.title, 'Synchronous');
  });
  assert.ok(await pending); assert.equal(app.editor.document.title, 'Synchronous');
});

test('denied or throwing edit permissions leave content untouched and end requesting mode', async t => {
  for (const rejection of ['deny', 'throw']) {
    const events = [], decision = deferred();
    const app = await mount(t, { onEditRequest: () => decision.promise, onEvent: event => events.push(event) });
    let pending; await change(() => { pending = app.editor.execute(rename('Denied')); });
    assert.equal(app.editor.busy, 'permission'); assert.equal(app.editor.dirty, false);
    await change(async () => { if (rejection === 'deny') decision.resolve(false); else decision.reject(new Error('Lock unavailable')); assert.equal(await pending, null); });
    assert.equal(app.editor.document.title, 'Original'); assert.equal(app.editor.busy, null);
    assert.deepEqual(events.filter(event => event.type === 'edit-mode').map(event => event.mode), ['requesting', 'view']);
    assert.match(app.editor.notice.text, rejection === 'deny' ? /他のユーザー/ : /Lock unavailable/);
  }
});

test('read-only, feature changes, discard and unmount cancel pending permission without late changes/events', async t => {
  for (const reason of ['readonly', 'features', 'discard', 'unmount']) {
    const decision = deferred(), events = []; let context;
    const app = await mount(t, { onEditRequest: (_request, value) => { context = value; return decision.promise; }, onEvent: event => events.push(event) });
    let pending; await change(() => { pending = app.editor.execute({ type: 'text.insert', from: 1, text: 'Late' }); });
    if (reason === 'readonly') { await app.update({ readOnly: true }); await app.update({ readOnly: false }); }
    else if (reason === 'features') { await app.update({ features: { text: false } }); await app.update({ features: { text: true } }); }
    else if (reason === 'discard') await change(() => app.editor.discard());
    else await app.unmount();
    assert.equal(context.signal.aborted, true); const previousEvents = events.length;
    await change(async () => { decision.resolve(true); assert.equal(await pending, null); });
    assert.equal(getDocumentText(app.editor.document), 'Alpha beta'); assert.equal(events.length, previousEvents);
  }
});

test('a cancelled permission cannot release the busy reservation of a newer permission', async t => {
  const first = deferred(), second = deferred(); let calls = 0;
  const app = await mount(t, { onEditRequest: () => ++calls === 1 ? first.promise : second.promise });
  let one, two;
  await change(() => { one = app.editor.execute(rename('First')); });
  await app.update({ readOnly: true }); await app.update({ readOnly: false });
  await change(() => { two = app.editor.execute(rename('Second')); });
  await change(async () => { first.resolve(true); assert.equal(await one, null); });
  assert.equal(app.editor.busy, 'permission');
  await change(async () => { second.resolve(true); assert.ok(await two); });
  assert.equal(app.editor.document.title, 'Second'); assert.equal(app.editor.busy, null);
});

test('save before-check denial and server errors retain unsaved state/history', async t => {
  let saves = 0; const events = [];
  const app = await mount(t, { onBeforeSave: () => false, onSave: () => { saves++; throw new Error('Storage failed'); }, onEvent: event => events.push(event) });
  await change(() => app.editor.execute(rename('Changed')));
  await change(async () => assert.equal(await app.editor.save(), false));
  assert.equal(saves, 0); assert.equal(app.editor.dirty, true);
  assert.equal(events.at(-1).phase, 'cancelled');
  await app.update({ onBeforeSave: () => true });
  await change(async () => assert.equal(await app.editor.save(), false));
  assert.equal(saves, 1); assert.equal(app.editor.dirty, true); assert.equal(app.editor.canUndo, true);
  assert.match(app.editor.notice.text, /Storage failed/);
});

test('save reconciliation notifies the host and does not discard edit history or selection', async t => {
  const ref = { current: null }, changes = [], events = [];
  const app = await mount(t, { ref, onChange: document => changes.push(document), onEvent: event => events.push(event), onSave: document => ({ ...document, title: 'Server title' }) });
  await change(() => app.editor.select({ from: 2, to: 7 }));
  await change(() => app.editor.execute(rename('Local title')));
  await change(async () => assert.equal(await ref.current.save(), true));
  assert.equal(app.editor.document.title, 'Server title'); assert.equal(app.editor.dirty, false);
  assert.deepEqual(app.editor.selection, { from: 2, to: 7 });
  assert.deepEqual(changes.map(document => document.title), ['Local title', 'Server title']);
  assert.ok(events.some(event => event.type === 'change' && event.source === 'save'));
  await change(() => ref.current.undo()); assert.equal(app.editor.document.title, 'Local title');
  await change(() => ref.current.undo()); assert.equal(app.editor.document.title, 'Original');
  await change(() => ref.current.redo()); await change(() => ref.current.redo());
  assert.equal(app.editor.document.title, 'Server title'); assert.equal(app.editor.dirty, false);
});

test('stale save completion after readonly or unmount has no state or event effects', async t => {
  for (const reason of ['readonly', 'unmount']) {
    const result = deferred(), events = [];
    const app = await mount(t, { onSave: () => result.promise, onEvent: event => events.push(event) });
    await change(() => app.editor.execute(rename('Unsaved')));
    let pending; await change(() => { pending = app.editor.save(); });
    if (reason === 'readonly') await app.update({ readOnly: true }); else await app.unmount();
    const count = events.length;
    await change(async () => { result.resolve({ ...app.editor.document, title: 'Late server' }); assert.equal(await pending, false); });
    assert.equal(app.editor.document.title, 'Unsaved'); assert.equal(app.editor.dirty, true); assert.equal(events.length, count);
  }
});

test('disabled history is rechecked if a previous saved edit needs a new async permission', async t => {
  const app = await mount(t);
  await change(() => app.editor.execute(rename('Saved'))); await change(() => app.editor.save());
  const permission = deferred(); await app.update({ onEditRequest: () => permission.promise });
  let pending; await change(() => { pending = app.editor.history('undo'); });
  await app.update({ features: { history: false } });
  await change(async () => { permission.resolve(true); assert.equal(await pending, false); });
  assert.equal(app.editor.document.title, 'Saved'); assert.equal(app.editor.dirty, false);
});

test('native imports reserve the operation, ignore stale reads and retain old history on rejection', async t => {
  const incoming = serializeDocument(createDocument({ title: 'Imported' }));
  const reading = deferred(), events = [];
  const blob = new Blob([incoming]); blob.text = () => reading.promise;
  const app = await mount(t, { onEvent: event => events.push(event) });
  await change(() => app.editor.execute(rename('Before import')));
  let pending; await change(() => { pending = app.editor.importFile(blob, 'dcon'); });
  assert.equal(app.editor.busy, 'import');
  await change(async () => assert.equal(await app.editor.execute(rename('During import')), null));
  await app.update({ features: { import: false } });
  const count = events.length;
  await change(async () => { reading.resolve(incoming); await pending; });
  assert.equal(app.editor.document.title, 'Before import'); assert.equal(app.editor.canUndo, true); assert.equal(events.length, count);
});

test('read-only exports do not acquire permission and detached handles cannot export after unmount', async t => {
  let permissions = 0; const ref = { current: null };
  const app = await mount(t, { ref, onSave: undefined, onEditRequest: () => { permissions++; return false; } });
  let blob; await change(async () => { blob = await ref.current.exportNative(); });
  assert.equal(parseDocument(await blob.text()).title, 'Original'); assert.equal(permissions, 0);
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
  const handle = ref.current; await app.unmount();
  await assert.rejects(handle.exportNative(), /書き出し/);
});

test('feature guards cover semantic APIs, low-level alignment, image movement, and import batch trailing commands', () => {
  assert.equal(resolveDocumentFeatures({ images: undefined }).images, true);
  const original = base();
  const verify = (before, command, feature) => { const after = executeDocumentCommands(before, command).document; assert.throws(() => assertDocumentFeatures(before, after, [command], resolveDocumentFeatures({ [feature]: false })), /無効/); };
  verify(original, { type: 'transaction.apply', steps: [{ stepType: 'attr', pos: 0, attr: 'align', value: 'center' }] }, 'formatting');
  const pictured = executeDocumentCommands(original, { type: 'image.insert', at: 12, src: pixel }).document;
  const image = pictured.content.content.find(node => node.type === 'image');
  verify(pictured, { type: 'image.update', id: image.attrs.id, width: 100 }, 'images');
  const moved = { type: 'transaction.apply', steps: [ { stepType: 'replace', from: 12, to: 13 }, { stepType: 'replace', from: 0, to: 0, slice: { content: [image] } } ] };
  verify(pictured, moved, 'images');
  const batch = [{ type: 'document.replace', document: original }, { type: 'transaction.apply', steps: [{ stepType: 'attr', pos: 0, attr: 'align', value: 'right' }] }];
  assert.throws(() => assertDocumentFeatures(original, executeDocumentCommands(original, batch).document, batch, resolveDocumentFeatures({ formatting: false })), /無効/);
  const insert = { type: 'text.insert', from: 1, text: 'Allowed' };
  assert.doesNotThrow(() => assertDocumentFeatures(original, executeDocumentCommands(original, insert).document, [insert], resolveDocumentFeatures({ formatting: false, images: false })));
});

test('shape insertion and updates follow permission, disabled-feature, read-only and undo paths', async t => {
  const denied = await mount(t, { onEditRequest: () => false });
  await change(async () => assert.equal(await denied.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow' }), null));
  assert.equal(denied.editor.document.content.content.some(node => node.type === 'shape'), false);
  const app = await mount(t);
  await change(() => app.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow', text: 'Review' }));
  const shape = app.editor.document.content.content.find(node => node.type === 'shape'); assert.ok(shape);
  await change(() => app.editor.execute({ type: 'shape.update', id: shape.attrs.id, text: 'Approve' }));
  assert.equal(app.editor.document.content.content[0].attrs.text, 'Approve');
  await change(() => app.editor.history('undo')); assert.equal(app.editor.document.content.content[0].attrs.text, 'Review');
  await app.update({ features: { shapes: false } });
  for (const command of [{ type: 'shape.insert', at: 0, preset: 'rect' }, { type: 'shape.update', id: shape.attrs.id, text: 'Bad' }, { type: 'block.delete', id: shape.attrs.id }, { type: 'transaction.apply', steps: [{ stepType: 'replace', from: 0, to: 1 }] }]) await change(async () => assert.equal(await app.editor.execute(command), null));
  assert.equal(app.editor.document.content.content[0].attrs.text, 'Review');
  await app.update({ features: { shapes: true }, readOnly: true });
  await change(async () => assert.equal(await app.editor.execute({ type: 'shape.update', id: shape.attrs.id, text: 'Bad' }), null));
});

test('shape text and visual edits honor their respective feature flags through commands and raw steps', async t => {
  const initial = createDocument({ content: { type: 'doc', content: [{ type: 'shape', attrs: { id: 'approval', preset: 'bentArrow', text: 'Original' } }] } });
  for (const [feature, patch] of [['text', { text: 'Changed' }], ['formatting', { fill: '#ff0000', fontSize: 32 }], ['formatting', { width: 300, rotation: 30 }]]) {
    const app = await mount(t, { initialDocument: initial, features: { [feature]: false } });
    const command = { type: 'shape.update', id: 'approval', ...patch };
    await change(async () => assert.equal(await app.editor.execute(command), null));
    const original = app.editor.document.content.content[0];
    const raw = { stepType: 'replace', from: 0, to: 1, slice: { content: [{ ...original, attrs: { ...original.attrs, ...patch } }] } };
    await change(async () => assert.equal(await app.editor.execute({ type: 'transaction.apply', steps: [raw] }), null));
    assert.equal(app.editor.document, initial); assert.equal(app.editor.canUndo, false);
  }
  const noText = await mount(t, { features: { text: false } });
  await change(async () => assert.equal(await noText.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow', text: 'Blocked text' }), null));
  await change(async () => assert.ok(await noText.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow' })));
  const noFormat = await mount(t, { features: { formatting: false } });
  await change(async () => assert.equal(await noFormat.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow', fill: '#ff0000' }), null));
  await change(async () => assert.ok(await noFormat.editor.execute({ type: 'shape.insert', at: 0, preset: 'bentArrow', text: 'Allowed text' })));
  const node = noFormat.editor.document.content.content.find(node => node.type === 'shape');
  await change(async () => assert.ok(await noFormat.editor.execute({ type: 'shape.update', id: node.attrs.id, text: 'Updated text' })));
});

const paged = () => createDocument({ title: 'Two pages', content: { type: 'doc', content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'First page' }] }, { type: 'page_break' },
  { type: 'paragraph', content: [{ type: 'text', text: 'Second page' }] },
] } });

test('initial page and imperative page navigation work read-only without permission, dirty state or history', async t => {
  const document = paged(), ref = { current: null }, events = []; let requests = 0;
  const app = await mount(t, { initialDocument: document, initialPageNumber: 2, onSave: undefined, ref,
    onEditRequest() { requests++; return true; }, onEvent: event => events.push(event) });
  assert.deepEqual(ref.current.getSelection(), { from: getDocumentPage(document, 2).from, to: getDocumentPage(document, 2).from });
  assert.equal(app.editor.pageReveal.document, document);
  await app.update({ initialPageNumber: 1 }); assert.equal(ref.current.getSelection().from, getDocumentPage(document, 2).from);
  await change(() => assert.equal(ref.current.goToPage(1), true));
  assert.deepEqual(ref.current.getSelection(), { from: 0, to: 0 });
  for (const invalid of [0, 1.5, NaN, '2', 3]) await change(() => assert.equal(ref.current.goToPage(invalid), false));
  assert.deepEqual(ref.current.getSelection(), { from: 0, to: 0 });
  assert.equal(app.editor.notice.kind, 'error');
  await change(() => assert.equal(ref.current.goToPage(2), true)); assert.equal(app.editor.notice, null);
  assert.equal(app.editor.document, document); assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
  assert.equal(requests, 0); assert.deepEqual(events, []);
  const handle = ref.current; await app.unmount(); assert.equal(handle.goToPage(1), false);
});

test('an invalid initial page retains its document and can recover through the handle', async t => {
  const document = paged(), app = await mount(t, { initialDocument: document, initialPageNumber: 3 });
  assert.equal(app.editor.document, document); assert.equal(app.editor.notice.kind, 'error'); assert.equal(app.editor.pageReveal, null);
  await change(() => assert.equal(app.editor.goToPage(2), true)); assert.equal(app.editor.notice, null);
});

test('import page targets validate before publication and commit content and selection atomically', async t => {
  const document = paged(), position = getDocumentPage(document, 2).from, ref = { current: null }, selections = []; let requests = 0;
  const app = await mount(t, { ref, onEditRequest() { requests++; return true; }, onChange() { selections.push(ref.current.getSelection()); } });
  const old = app.editor.document, originalSelection = ref.current.getSelection();
  for (const pageNumber of [0, 1.5, NaN, '2', 3]) await change(() => ref.current.importNative(serializeDocument(document), { pageNumber }));
  assert.equal(app.editor.document, old); assert.deepEqual(ref.current.getSelection(), originalSelection); assert.equal(app.editor.canUndo, false);
  assert.equal(requests, 0); assert.deepEqual(selections, []);
  await change(() => ref.current.importNative(serializeDocument(document), { pageNumber: 2 }));
  assert.equal(app.editor.document.title, document.title); assert.deepEqual(selections, [{ from: position, to: position }]);
  assert.equal(app.editor.pageReveal.document, app.editor.document); assert.equal(requests, 1);
  await change(() => ref.current.undo()); assert.equal(app.editor.document, old); assert.deepEqual(ref.current.getSelection(), originalSelection);
  await change(() => ref.current.redo()); assert.equal(ref.current.getSelection().from, position);
});

test('DOCX target validation preserves the old draft on failure and selects the imported explicit page', async t => {
  const { blob } = await exportDocumentDocx(paged()), ref = { current: null }, app = await mount(t, { ref });
  const before = app.editor.document;
  await change(() => ref.current.importDocx(blob, { pageNumber: 3 }));
  assert.equal(app.editor.document, before); assert.equal(app.editor.canUndo, false); assert.match(app.editor.notice.text, /3ページ目/);
  await change(() => ref.current.importDocx(blob, { pageNumber: 2 }));
  assert.equal(ref.current.getSelection().from, getDocumentPage(app.editor.document, 2).from);
  assert.ok(getDocumentText(app.editor.document).includes('Second page'));
});

test('import target options are snapshotted and stale imports cannot navigate', async t => {
  for (const reason of ['mutation', 'readonly', 'features', 'unmount']) {
    const data = deferred(), ref = { current: null }, app = await mount(t, { ref }), before = app.editor.document;
    class DelayedBlob extends Blob { text() { return data.promise; } }
    const options = { pageNumber: 2 }; let pending;
    await change(() => { pending = ref.current.importNative(new DelayedBlob(['pending']), options); });
    options.pageNumber = 1;
    if (reason === 'readonly') { await app.update({ readOnly: true }); await app.update({ readOnly: false }); }
    if (reason === 'features') { await app.update({ features: { import: false } }); await app.update({ features: { import: true } }); }
    if (reason === 'unmount') await app.unmount();
    await change(async () => { data.resolve(serializeDocument(paged())); await pending; });
    if (reason === 'mutation') assert.equal(app.editor.selection.from, getDocumentPage(app.editor.document, 2).from);
    else { assert.equal(app.editor.document, before); assert.equal(app.editor.pageReveal, null); assert.equal(app.editor.canUndo, false); }
  }
});

test('same-document import can navigate without edits, while denied import cannot reveal another page', async t => {
  const document = paged(), app = await mount(t, { initialDocument: document, onEditRequest: () => false });
  await change(() => app.editor.importFile(serializeDocument(document), 'dcon', { pageNumber: 2 }));
  assert.equal(app.editor.selection.from, getDocumentPage(document, 2).from); assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
  await change(() => app.editor.goToPage(1));
  await change(() => app.editor.importFile(serializeDocument(executeDocumentCommands(document, rename('Other')).document), 'dcon', { pageNumber: 2 }));
  assert.equal(app.editor.document, document); assert.equal(app.editor.selection.from, 0); assert.equal(app.editor.pageReveal.position, 0);
});

test('import completion preserves a newer host navigation from the change notification', async t => {
  for (const navigation of ['page', 'selection']) {
    const document = paged(), ref = { current: null }, selections = [];
    const app = await mount(t, { ref, onChange() {
      selections.push(ref.current.getSelection());
      if (navigation === 'page') assert.equal(ref.current.goToPage(1), true);
      else ref.current.select({ from: 0, to: 0 });
      assert.equal(ref.current.getSelection().from, 0);
    } });
    await change(() => ref.current.importNative(serializeDocument(document), { pageNumber: 2 }));
    const position = getDocumentPage(document, 2).from;
    assert.deepEqual(selections, [{ from: position, to: position }]);
    assert.deepEqual(ref.current.getSelection(), { from: 0, to: 0 });
    assert.equal(app.editor.pageReveal?.position ?? 0, 0);
    assert.equal(app.editor.document.title, document.title); assert.equal(app.editor.canUndo, true);
  }
});

test('same-document import does not defer selection past a newer host navigation', async t => {
  const document = paged(), ref = { current: null }, app = await mount(t, { ref, initialDocument: document });
  await change(async () => {
    const pending = ref.current.importNative(serializeDocument(document), { pageNumber: 2 });
    ref.current.goToPage(1);
    await pending;
  });
  assert.deepEqual(ref.current.getSelection(), { from: 0, to: 0 }); assert.equal(app.editor.pageReveal.position, 0);
  assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false);
});

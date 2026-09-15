import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, message) {
  const deadline = performance.now() + 1000;
  while (!predicate() && performance.now() < deadline) await change(() => wait(5));
  assert.ok(predicate(), message);
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind,
  extension: kind === 'file' ? name.split('.').at(-1).toLowerCase() : '', size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 });
const initial = [entry('folder', 'Folder', 'root', 'folder'), entry('existing', 'Existing.txt')];
const file = (name, path = '', bytes = 'new') => {
  const result = new File([bytes], name, { type: 'text/plain' });
  if (path) Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
};
function fakeDocument() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    querySelectorAll: () => [], getElementById: () => null,
    dispatch(type, event) { return change(() => { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); }); },
  };
}
async function mount(t, supplied = {}) {
  let latest, renderer, children = true, closed = false;
  const events = [], requests = [], saves = [], panes = new Map(), snapshots = [];
  const documents = new Map(['main', 'child'].map(id => [id, fakeDocument()]));
  const roots = new Map(['main', 'child'].map(id => {
    const root = { tagName: 'DIV', isContentEditable: false, parentElement: null, closest: () => null };
    root.contains = target => target === root;
    return [id, root];
  }));
  let props = { initialEntries: initial, onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event),
    onEditRequest: request => { requests.push(request); return true; }, ...supplied };
  function Pane({ options, workspace, id }) {
    const pane = useExplorerViewController(options, workspace, id, documents.get(id));
    pane.workspaceRef.current = roots.get(id);
    panes.set(id, pane);
    snapshots.push({ id, pane });
    return null;
  }
  function Probe({ options }) {
    const workspace = useExplorerWorkspace(options); latest = workspace;
    useLayoutEffect(() => { const child = workspace.tabs.forWindow('child'); if (!child.tabs.length) child.addTab(); }, [workspace.tabs]);
    return ['main', ...(children ? ['child'] : [])].map(id => h(Pane, { key: id, options, workspace, id }));
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get main() { return panes.get('main'); }, get child() { return panes.get('child'); }, get workspace() { return latest; },
    events, requests, saves, snapshots, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async closeChild() { children = false; await change(() => renderer.update(tree())); },
    async drop(directory, parent = 'root', id = 'main') {
      const data = { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => directory, getAsFile: () => null }], types: ['Files'], getData: () => '' };
      await change(() => panes.get(id).drop({ dataTransfer: data, preventDefault() {}, stopPropagation() {} }, parent));
    },
    async paste(directory, id = 'main') {
      const data = { files: [], items: [{ kind: 'file', webkitGetAsEntry: () => directory, getAsFile: () => null }], types: ['Files'], getData: () => '' };
      const event = { target: roots.get(id), clipboardData: data, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      await documents.get(id).dispatch('paste', event);
      assert.equal(event.defaultPrevented, true);
    },
  };
}
function directory(name, children) {
  return { name, isDirectory: true, isFile: false, createReader() {
    let read = false;
    return { readEntries(resolve) { resolve(read ? [] : children); read = true; } };
  } };
}
const fileEntry = value => ({ name: value.name, isDirectory: false, isFile: true, file: resolve => resolve(value) });
function delayedFile(name = 'Last.txt') {
  let resolve, reject;
  return { entry: { name, isDirectory: false, isFile: true, file(done, fail) { resolve = done; reject = fail; } },
    get started() { return typeof resolve === 'function'; },
    complete() { assert.ok(resolve); resolve(file(name)); }, fail() { assert.ok(reject); reject(Error('Permission denied')); } };
}

// Display-only metadata is intentionally separate from visible/selected draft entries.
const previews = pane => pane.pendingImportEntries.map(item => item.entry);
const uploadChanges = app => app.events.filter(event => event.type === 'change' && event.action === 'upload');

test('a discovered native file is grouped inside its root folder before the next callback and rolls back on read failure', async t => {
  const app = await mount(t), before = app.main.entries, delayed = delayedFile();
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'first file should be displayed while the next native read is pending');
  assert.equal(previews(app.main).length, 1);
  assert.equal(previews(app.main)[0].name, 'Batch');
  assert.equal(previews(app.main)[0].kind, 'folder');
  assert.ok(app.main.importingEntryIds.has(previews(app.main)[0].id));
  assert.equal(app.main.entries, before);
  assert.deepEqual(app.main.visible.map(item => item.id), ['folder', 'existing']);
  assert.equal(app.main.dirty, false);
  assert.equal(app.requests.length, 0);
  assert.equal(uploadChanges(app).length, 0);
  await change(() => delayed.fail());
  await eventually(() => app.main.notification?.kind === 'error', 'native read failure should finish the import');
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries, before);
  assert.equal(app.main.notification.kind, 'error');
  await change(() => wait(100));
  assert.equal(previews(app.main).length, 0, 'a queued publication cannot revive the failed preview');
});

test('provisional files stay at the captured folder when navigating and commit there atomically', async t => {
  const app = await mount(t), before = app.main.entries, delayed = delayedFile();
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'discovered file should be displayed before navigation');
  const first = previews(app.main)[0];
  assert.ok(first);
  await change(() => app.main.navigate('folder'));
  assert.equal(previews(app.main).length, 0);
  await change(() => app.main.navigate('root'));
  assert.equal(previews(app.main)[0].id, first.id);
  assert.equal(app.main.entries, before);
  await change(() => delayed.complete());
  await eventually(() => uploadChanges(app).length === 1, 'completed discovery should commit one upload');
  assert.equal(previews(app.main).length, 0);
  const batch = app.main.entries.find(item => item.name === 'Batch');
  assert.equal(batch.parent, 'root');
  assert.equal(app.main.entries.filter(item => item.parent === batch.id).length, 2);
  assert.equal(uploadChanges(app).length, 1);
  assert.equal(app.saves.length, 0);
});

test('a large picker batch is displayed while edit permission is pending without becoming saved data', async t => {
  const permission = deferred();
  const app = await mount(t, { onEditRequest: () => permission.promise }), before = app.main.entries;
  const files = Array.from({ length: 600 }, (_, index) => file(`new-${index}.txt`, `Batch/new-${index}.txt`));
  let pending;
  await change(() => { pending = app.main.addLocalFiles(files, 'folder', 'root'); });
  await eventually(() => app.main.editMode === 'requesting', 'picker preparation should reach the edit permission request');
  assert.equal(app.main.editMode, 'requesting');
  assert.deepEqual(previews(app.main).map(item => [item.name, item.kind]), [['Batch', 'folder']]);
  const batch = previews(app.main)[0];
  await change(() => app.main.openPendingImportFolder(batch.id));
  assert.equal(previews(app.main).length, 600);
  assert.ok(previews(app.main).every(item => item.parent === batch.id && item.kind === 'file'));
  await change(() => app.main.navigate('root'));
  assert.equal(app.main.entries, before);
  assert.equal(app.main.dirty, false);
  assert.equal(app.main.visible.length, before.length);
  assert.equal(uploadChanges(app).length, 0);
  assert.equal(app.saves.length, 0);
  await change(() => permission.resolve(false));
  await change(() => pending);
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries, before);
  assert.equal(uploadChanges(app).length, 0);
});

test('overwrite confirmation leaves the existing file intact and clears skipped provisional files', async t => {
  const app = await mount(t), before = app.main.entries;
  await change(() => app.main.addLocalFiles([file('Existing.txt'), file('New.txt')]));
  assert.ok(app.main.uploadPrompt);
  assert.ok(previews(app.main).some(item => item.name === 'New.txt'));
  assert.equal(app.main.entries, before);
  assert.equal(app.main.entries.find(item => item.id === 'existing').source.kind, 'existing');
  await change(() => app.main.answerUploadConflict('skip', false));
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries.find(item => item.id === 'existing').source.kind, 'existing');
  assert.equal(app.main.entries.find(item => item.name === 'New.txt').source.kind, 'local');
  assert.equal(uploadChanges(app).length, 1);
});

test('save cancels provisional discovery and never includes it in the save payload', async t => {
  const app = await mount(t), delayed = delayedFile();
  await change(() => app.main.act('favorite', ['existing']));
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'discovered file should be displayed before saving');
  assert.equal(previews(app.main).length, 1);
  await change(() => app.workspace.draft.save());
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.saves.length, 1);
  assert.deepEqual(app.saves[0].entries.map(item => item.id), ['folder', 'existing']);
  assert.deepEqual(app.saves[0].changes.created, []);
  await change(() => delayed.complete());
  await change(() => wait(100));
  assert.equal(previews(app.main).length, 0);
  assert.equal(uploadChanges(app).length, 0);
});

for (const reason of ['discard', 'readonly', 'feature', 'unmount']) test(`${reason} removes provisional native imports and ignores late file callbacks`, async t => {
  const app = await mount(t), before = app.main.entries, delayed = delayedFile();
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]), 'child');
  await eventually(() => previews(app.child).length === 1 && delayed.started, 'child preview should exist before invalidation');
  assert.equal(previews(app.child).length, 1);
  if (reason === 'discard') await change(() => app.workspace.draft.discard());
  if (reason === 'readonly') await app.update({ readOnly: true });
  if (reason === 'feature') await app.update({ features: { uploadFolders: false } });
  if (reason === 'unmount') await app.closeChild();
  if (reason !== 'unmount') assert.equal(previews(app.child).length, 0);
  await change(() => delayed.complete());
  await change(() => wait(100));
  assert.equal(app.main.entries, before);
  assert.equal(uploadChanges(app).length, 0);
  assert.equal(app.requests.length, 0);
});

test('a failed default-abort validation clears every provisional file without acquiring edit permission', async t => {
  const app = await mount(t, { upload: { allowedExtensions: ['.txt'] } }), before = app.main.entries;
  const delayed = delayedFile('Blocked.exe');
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'accepted file should be displayed before the invalid file is discovered');
  assert.equal(previews(app.main).length, 1);
  await change(() => delayed.complete());
  await eventually(() => app.main.notification?.kind === 'error', 'invalid extension should finish validation with an error');
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries, before);
  assert.equal(app.main.notification.kind, 'error');
  assert.equal(app.requests.length, 0);
  assert.equal(uploadChanges(app).length, 0);
});

test('native discovery merges existing folders without duplicate rows and keeps overwrite data intact', async t => {
  const app = await mount(t, { initialEntries: [entry('batch', 'Batch', 'root', 'folder'), entry('e', 'Existing.txt', 'batch')] });
  const before = app.main.entries, delayed = delayedFile('Existing.txt');
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => app.main.importingEntryIds.has('batch') && delayed.started, 'existing parent should indicate pending descendants');
  assert.deepEqual(previews(app.main), []);
  assert.equal(app.main.navigationEntries.filter(item => item.parent === 'root' && item.name === 'Batch').length, 1);
  await change(() => app.main.navigate('batch'));
  assert.deepEqual(previews(app.main).map(item => item.name), ['First.txt']);
  const firstId = previews(app.main)[0].id;
  await change(() => delayed.complete());
  await eventually(() => app.main.uploadPrompt !== null, 'completed discovery should reach overwrite confirmation');
  assert.equal(app.main.uploadPrompt.conflict.existing.id, 'e');
  assert.deepEqual(previews(app.main).map(item => item.name), ['First.txt']);
  assert.equal(previews(app.main)[0].id, firstId);
  assert.ok(app.main.importingEntryIds.has('e'));
  assert.ok(app.main.importingEntryIds.has('batch'));
  assert.equal(app.main.entries, before);
  await change(() => app.main.cancelUpload());
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.importingEntryIds.size, 0);
  assert.equal(app.main.currentParent, 'batch');
  assert.equal(app.main.entries, before);
});

test('two panes own independent provisional imports and cancellation cannot clear the other preview', async t => {
  const app = await mount(t), mainLast = delayedFile('MainLast.txt'), childLast = delayedFile('ChildLast.txt');
  await app.paste(directory('MainBatch', [fileEntry(file('MainFirst.txt')), mainLast.entry]));
  await app.paste(directory('ChildBatch', [fileEntry(file('ChildFirst.txt')), childLast.entry]), 'child');
  await eventually(() => previews(app.main).length === 1 && previews(app.child).length === 1 && mainLast.started && childLast.started,
    'both panes should display discoveries while their next native reads are pending');
  assert.deepEqual(previews(app.main).map(item => item.name), ['MainBatch']);
  assert.deepEqual(previews(app.child).map(item => item.name), ['ChildBatch']);
  await change(() => app.main.cancelUpload());
  assert.equal(previews(app.main).length, 0);
  assert.equal(previews(app.child).length, 1);
  await change(() => mainLast.complete());
  await change(() => childLast.complete());
  await eventually(() => uploadChanges(app).length === 1, 'the remaining child import should finish its atomic commit');
  assert.equal(previews(app.main).length, 0);
  assert.equal(previews(app.child).length, 0);
  assert.equal(app.main.entries.some(item => item.name === 'MainBatch'), false);
  assert.equal(app.main.entries.filter(item => item.source?.kind === 'local').length, 2);
  assert.equal(uploadChanges(app).length, 1);
});

test('skipping a duplicate incoming name retains the accepted first file in the pending preview', async t => {
  const permission = deferred(), app = await mount(t, { onEditRequest: () => permission.promise });
  const first = file('New.txt', '', 'first'), last = file('New.txt', '', 'last version');
  await change(() => app.main.addLocalFiles([first, last]));
  assert.ok(app.main.uploadPrompt);
  let pending;
  await change(() => { pending = app.main.answerUploadConflict('skip', false); });
  assert.equal(app.main.editMode, 'requesting');
  assert.equal(previews(app.main).length, 1);
  assert.equal(previews(app.main)[0].size, first.size);
  await change(() => permission.resolve(true));
  await change(() => pending);
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries.find(item => item.name === 'New.txt').source.file, first);
});

for (const method of ['paste', 'drop']) test(`nested native ${method} can be browsed during discovery and stays in the resolved folder after commit`, async t => {
  const app = await mount(t), before = app.main.entries, delayed = delayedFile('Second.txt');
  const source = directory('Batch', [directory('Nested', [fileEntry(file('First.txt')), delayed.entry])]);
  await app[method](source);
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'root folder should appear before the second file is read');
  const batch = previews(app.main)[0];
  assert.equal(batch.name, 'Batch');
  assert.equal(batch.kind, 'folder');
  assert.deepEqual(app.child.navigationEntries, before, 'the other window has no provisional folders');
  assert.equal(app.child.importingEntryIds.size, 0);
  await change(() => app.main.openPendingImportFolder(batch.id));
  const nested = previews(app.main)[0];
  assert.equal(nested.name, 'Nested');
  assert.equal(nested.parent, batch.id);
  assert.ok(app.main.importingEntryIds.has(batch.id));
  assert.ok(app.main.importingEntryIds.has(nested.id));
  await change(() => app.main.openPendingImportFolder(nested.id));
  assert.equal(app.main.addressPath, '/Batch/Nested');
  assert.deepEqual(previews(app.main).map(item => item.name), ['First.txt']);
  assert.ok(app.main.importingEntryIds.has(previews(app.main)[0].id));
  assert.equal(app.main.currentParent, nested.id);
  assert.equal(app.main.dirty, false);
  assert.equal(app.main.entries, before);
  assert.deepEqual(app.main.selected, []);
  assert.equal(JSON.stringify(app.events).includes('import-preview:'), false, 'temporary identifiers never escape through external events');
  assert.equal(uploadChanges(app).length, 0);
  const progress = app.main.notification;
  assert.ok(progress, 'discovery progress stays visible during folder navigation');
  await change(() => delayed.complete());
  await eventually(() => uploadChanges(app).length === 1, 'native discovery should commit exactly once');
  const realBatch = app.main.entries.find(item => item.name === 'Batch');
  const realNested = app.main.entries.find(item => item.name === 'Nested');
  assert.equal(realNested.parent, realBatch.id);
  assert.equal(app.main.currentParent, realNested.id, 'current folder reconciles by path to the committed ID');
  assert.equal(app.main.addressPath, '/Batch/Nested');
  assert.deepEqual(app.main.visible.map(item => item.name), ['First.txt', 'Second.txt']);
  assert.deepEqual(previews(app.main), []);
  assert.equal(app.main.importingEntryIds.size, 0);
  assert.equal(JSON.stringify(app.events).includes('import-preview:'), false);
  assert.equal(app.main.entries, app.child.entries, 'committed entries are shared with the other pane');
});

for (const outcome of ['cancel', 'failure']) test(`browsing a provisional descendant returns to the nearest existing folder on ${outcome}`, async t => {
  const app = await mount(t, { initialEntries: [entry('batch', 'Batch', 'root', 'folder'), entry('kept', 'Kept.txt', 'batch')] });
  const before = app.main.entries, delayed = delayedFile();
  await app.paste(directory('Batch', [directory('Nested', [fileEntry(file('First.txt')), delayed.entry])]));
  await eventually(() => delayed.started && app.main.importingEntryIds.has('batch'), 'existing destination should be marked while a descendant is read');
  await change(() => app.main.navigate('batch'));
  const nested = previews(app.main)[0];
  assert.equal(nested.name, 'Nested');
  await change(() => app.main.openPendingImportFolder(nested.id));
  assert.equal(app.main.currentParent, nested.id);
  if (outcome === 'cancel') await change(() => app.main.cancelUpload());
  else await change(() => delayed.fail());
  await eventually(() => app.main.currentParent === 'batch', 'navigation should return to the nearest surviving ancestor');
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.importingEntryIds.size, 0);
  assert.equal(app.main.entries, before);
  assert.deepEqual(app.main.visible.map(item => item.name), ['Kept.txt']);
  assert.equal(app.main.addressPath, '/Batch');
  if (outcome === 'cancel') await change(() => delayed.complete());
  await change(() => wait(100));
  assert.equal(previews(app.main).length, 0);
  assert.equal(uploadChanges(app).length, 0);
});

for (const outcome of ['commit', 'cancel']) test(`inactive tabs and navigation history reconcile provisional folders after ${outcome}`, async t => {
  const app = await mount(t), delayed = delayedFile();
  await app.paste(directory('Batch', [directory('Nested', [fileEntry(file('First.txt')), delayed.entry])]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'provisional hierarchy should be available');
  const batch = previews(app.main)[0];
  await change(() => app.main.openPendingImportFolder(batch.id));
  const nested = previews(app.main)[0];
  await change(() => app.main.openPendingImportFolder(nested.id));
  const firstTabId = app.main.activeTabId;
  await change(() => app.main.addTab());
  assert.equal(app.main.currentParent, 'root');
  await change(() => app.main.openPendingImportFolder(batch.id));
  assert.equal(app.main.currentParent, batch.id);
  if (outcome === 'commit') {
    await change(() => delayed.complete());
    await eventually(() => uploadChanges(app).length === 1, 'background import should commit while another tab is active');
  } else await change(() => app.main.cancelUpload());
  const realBatch = app.main.entries.find(item => item.name === 'Batch');
  const realNested = app.main.entries.find(item => item.name === 'Nested');
  assert.equal(app.main.currentParent, outcome === 'commit' ? realBatch.id : 'root');
  const windowTabs = app.workspace.tabs.forWindow('main').tabs;
  assert.equal(JSON.stringify(windowTabs).includes('import-preview:'), false, 'inactive tabs, history and expanded nodes release temporary IDs');
  await change(() => app.main.selectTab(firstTabId));
  assert.equal(app.main.currentParent, outcome === 'commit' ? realNested.id : 'root');
  await change(() => app.main.travel(-1));
  assert.equal(app.main.currentParent, outcome === 'commit' ? realBatch.id : 'root');
  await change(() => app.main.travel(1));
  assert.equal(app.main.currentParent, outcome === 'commit' ? realNested.id : 'root');
  assert.equal(JSON.stringify(app.events).includes('import-preview:'), false);
  if (outcome === 'cancel') await change(() => delayed.complete());
});

for (const navigation of ['provisional-folder', 'new-tab']) test(`an import awaiting edit permission survives navigation to ${navigation}`, async t => {
  let requests = 0;
  const permission = deferred(), app = await mount(t, { onEditRequest: () => { requests++; return permission.promise; } });
  let pending;
  await change(() => { pending = app.main.addLocalFiles([
    file('First.txt', 'Batch/Nested/First.txt'), file('Second.txt', 'Batch/Nested/Second.txt'),
  ], 'folder', 'root'); });
  assert.equal(app.main.editMode, 'requesting');
  assert.equal(requests, 1);
  assert.equal(uploadChanges(app).length, 0);
  const batch = previews(app.main)[0];
  assert.equal(batch.name, 'Batch');
  if (navigation === 'provisional-folder') {
    await change(() => app.main.openPendingImportFolder(batch.id));
    await change(() => app.main.openPendingImportFolder(previews(app.main)[0].id));
    assert.equal(app.main.addressPath, '/Batch/Nested');
  } else await change(() => app.main.addTab());
  assert.equal(app.main.editMode, 'requesting', 'browsing leaves the captured import authorization active');
  await change(() => permission.resolve(true));
  await change(() => pending);
  assert.equal(uploadChanges(app).length, 1, 'authorized import commits to its captured destination after browsing');
  const realBatch = app.main.entries.find(item => item.name === 'Batch');
  const realNested = app.main.entries.find(item => item.name === 'Nested');
  assert.equal(realBatch.parent, 'root');
  assert.equal(realNested.parent, realBatch.id);
  assert.deepEqual(app.main.entries.filter(item => item.parent === realNested.id).map(item => item.name), ['First.txt', 'Second.txt']);
  assert.equal(app.main.currentParent, navigation === 'provisional-folder' ? realNested.id : 'root');
  assert.equal(app.main.importingEntryIds.size, 0);
  assert.equal(requests, 1);
});

for (const outcome of ['commit', 'cancel']) test(`tab detachment waits for provisional history to resolve on ${outcome}`, async t => {
  const app = await mount(t), delayed = delayedFile();
  const firstTabId = app.main.activeTabId;
  await change(() => app.main.addTab());
  const importTabId = app.main.activeTabId;
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'provisional directory should become available');
  assert.equal(app.main.canDetachTab(importTabId), true, 'a tab with only committed locations can still detach');
  await change(() => app.main.openPendingImportFolder(previews(app.main)[0].id));
  assert.equal(app.main.canDetachTab(importTabId), false);
  assert.equal(app.main.detachTab(importTabId), false, 'the action guard must reject a provisional tab before opening a window');
  await change(() => app.main.navigate('root'));
  assert.equal(app.main.canDetachTab(importTabId), false, 'provisional history also belongs to the originating pane');
  await change(() => app.main.selectTab(firstTabId));
  assert.equal(app.main.canDetachTab(importTabId), false, 'inactive tabs receive the same guard');
  assert.equal(app.main.canDetachTab(firstTabId), true);
  if (outcome === 'commit') {
    await change(() => delayed.complete());
    await eventually(() => uploadChanges(app).length === 1, 'import should commit');
  } else await change(() => app.main.cancelUpload());
  assert.equal(app.main.canDetachTab(importTabId), true, 'remapping releases the tab without retaining temporary history IDs');
  if (outcome === 'cancel') await change(() => delayed.complete());
});

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

test('a discovered file is visible before the next native file callback and rolls back on read failure', async t => {
  const app = await mount(t), before = app.main.entries, delayed = delayedFile();
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'first file should be displayed while the next native read is pending');
  assert.equal(previews(app.main).length, 1);
  assert.equal(previews(app.main)[0].name, 'First.txt');
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
  assert.equal(previews(app.main).length, 600);
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

test('directory discovery hands its preview to overwrite confirmation without publishing a partial folder', async t => {
  const app = await mount(t, { initialEntries: [entry('batch', 'Batch', 'root', 'folder'), entry('e', 'Existing.txt', 'batch')] });
  const before = app.main.entries, delayed = delayedFile('Existing.txt');
  await app.paste(directory('Batch', [fileEntry(file('First.txt')), delayed.entry]));
  await eventually(() => previews(app.main).length === 1 && delayed.started, 'first discovery should be displayed before the conflicting file arrives');
  const firstId = previews(app.main)[0].id;
  await change(() => delayed.complete());
  await eventually(() => app.main.uploadPrompt !== null, 'completed discovery should reach overwrite confirmation');
  assert.equal(app.main.uploadPrompt.conflict.existing.id, 'e');
  assert.equal(previews(app.main).length, 2);
  assert.equal(previews(app.main).find(item => item.name === 'First.txt').id, firstId);
  assert.equal(app.main.entries, before);
  await change(() => app.main.cancelUpload());
  assert.equal(previews(app.main).length, 0);
  assert.equal(app.main.entries, before);
});

test('two panes own independent provisional imports and cancellation cannot clear the other preview', async t => {
  const app = await mount(t), mainLast = delayedFile('MainLast.txt'), childLast = delayedFile('ChildLast.txt');
  await app.paste(directory('MainBatch', [fileEntry(file('MainFirst.txt')), mainLast.entry]));
  await app.paste(directory('ChildBatch', [fileEntry(file('ChildFirst.txt')), childLast.entry]), 'child');
  await eventually(() => previews(app.main).length === 1 && previews(app.child).length === 1 && mainLast.started && childLast.started,
    'both panes should display discoveries while their next native reads are pending');
  assert.deepEqual(previews(app.main).map(item => item.name), ['MainFirst.txt']);
  assert.deepEqual(previews(app.child).map(item => item.name), ['ChildFirst.txt']);
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

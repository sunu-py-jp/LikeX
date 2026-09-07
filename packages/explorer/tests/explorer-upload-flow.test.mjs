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
`, resolveDir: packageRoot, sourcefile: 'explorer-upload-flow.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-upload-flow.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.split('.').at(-1).toLowerCase() : '',
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 });
const initial = [entry('folder', '資料', 'root', 'folder'), entry('a', 'A.txt', 'folder'), entry('b', 'B.txt', 'folder'), entry('c', 'C.txt', 'folder')];
const file = (name, path = '', bytes = 'replacement') => {
  const result = new File([bytes], name, { type: 'text/plain' });
  if (path) Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
};
async function mount(t, supplied = {}) {
  let latest, renderer, children = true;
  const events = [], requests = [], saves = [];
  let props = { initialEntries: initial, onSave: payload => { saves.push(payload); },
    onEvent: event => events.push(event), onEditRequest: request => { requests.push(request); return true; }, ...supplied };
  const panes = new Map();
  function Pane({ options, workspace, id }) { panes.set(id, useExplorerViewController(options, workspace, id, null)); return null; }
  function Probe({ options }) {
    const workspace = useExplorerWorkspace(options); latest = workspace;
    useLayoutEffect(() => { const child = workspace.tabs.forWindow('child'); if (!child.tabs.length) child.addTab(); }, [workspace.tabs]);
    return ['main', ...(children ? ['child'] : [])].map(id => h(Pane, { key: id, options, workspace, id }));
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  return { get main() { return panes.get('main'); }, get child() { return panes.get('child'); }, get workspace() { return latest; },
    events, requests, saves,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async closeChild() { children = false; await change(() => renderer.update(tree())); },
  };
}

test('folder merge prompts individually, preserves extra files and commits one atomic shared change', async t => {
  const app = await mount(t), before = app.main.entries;
  const a = file('A.txt', '資料/A.txt'), c = file('C.txt', '資料/C.txt'), d = file('D.txt', '資料/D.txt');
  await change(() => app.child.addLocalFiles([a, c, d], 'folder', 'root'));
  assert.equal(app.child.uploadPrompt.conflict.existing.id, 'a');
  assert.equal(app.child.uploadPrompt.conflictIndex, 1); assert.equal(app.child.uploadPrompt.conflictCount, 2); assert.equal(app.main.uploadPrompt, null);
  assert.equal(app.main.entries, before); assert.equal(app.requests.length, 0);
  await change(() => app.child.answerUploadConflict('overwrite', false));
  assert.equal(app.child.uploadPrompt.conflict.existing.id, 'c');
  assert.equal(app.child.uploadPrompt.conflictIndex, 2); assert.equal(app.child.uploadPrompt.conflictCount, 2); assert.equal(app.main.entries, before);
  await change(() => app.child.answerUploadConflict('skip', false));
  assert.equal(app.child.uploadPrompt, null); assert.equal(app.main.entries, app.child.entries);
  const byId = new Map(app.main.entries.map(item => [item.id, item]));
  assert.equal(byId.get('a').source.file, a); assert.equal(byId.get('a').updatedAt, initial[1].updatedAt);
  assert.deepEqual(byId.get('b'), initial[2]); assert.deepEqual(byId.get('c'), initial[3]);
  assert.equal(app.main.entries.find(item => item.name === 'D.txt').source.file, d);
  assert.equal(app.requests.length, 1); assert.equal(app.requests[0].windowId, 'child');
  assert.equal(app.events.filter(event => event.type === 'change').length, 1); assert.equal(app.saves.length, 0);
});

for (const action of ['overwrite', 'skip']) test(`apply-all ${action} affects conflicts only and resets on the next batch`, async t => {
  const app = await mount(t);
  const a = file('A.txt'), c = file('C.txt'), d = file('D.txt');
  await change(() => app.main.addLocalFiles([a, c, d], 'file', 'folder'));
  await change(() => app.main.answerUploadConflict(action, true));
  assert.equal(app.main.uploadPrompt, null);
  assert.equal(app.main.entries.find(item => item.name === 'D.txt').source.file, d);
  assert.equal(app.main.entries.find(item => item.id === 'c').source.kind, action === 'overwrite' ? 'local' : 'existing');
  await change(() => app.main.addLocalFiles([file('A.txt')], 'file', 'folder'));
  assert.equal(app.main.uploadPrompt.conflict.existing.id, 'a');
});

test('all conflict skips and cancellation require no edit permission and leave the draft clean', async t => {
  const app = await mount(t), before = app.main.entries;
  await change(() => app.main.addLocalFiles([file('A.txt'), file('C.txt')], 'file', 'folder'));
  await change(() => app.main.answerUploadConflict('skip', true));
  assert.equal(app.main.entries, before); assert.equal(app.requests.length, 0); assert.equal(app.main.dirty, false);
  await change(() => app.main.addLocalFiles([file('New.txt'), file('A.txt')], 'file', 'folder'));
  await change(() => app.main.cancelUpload());
  assert.equal(app.main.uploadPrompt, null); assert.equal(app.main.entries, before); assert.equal(app.requests.length, 0);
});

test('refreshed contents during authorization require new confirmation and do not apply old apply-all', async t => {
  const waiting = deferred();
  const app = await mount(t, { onEditRequest: () => waiting.promise });
  const replacement = file('A.txt');
  await change(() => app.main.addLocalFiles([replacement, file('C.txt')], 'file', 'folder'));
  let result;
  await change(() => { result = app.main.answerUploadConflict('overwrite', true); });
  assert.equal(app.main.uploadApplying, true);
  const refreshed = initial.map(item => item.id === 'a' ? { ...item, source: { kind: 'existing', id: 'new-revision' } } : item);
  await change(() => waiting.resolve({ allowed: true, entries: refreshed }));
  await result;
  assert.equal(app.main.uploadPrompt.conflict.existing.source.id, 'new-revision'); assert.equal(app.main.dirty, false);
  await change(() => app.main.answerUploadConflict('skip', false));
  // The old answer for C remains valid because its version is unchanged.
  assert.equal(app.main.uploadPrompt, null); assert.equal(app.main.entries.find(item => item.id === 'a').source.id, 'new-revision');
  assert.equal(app.main.entries.find(item => item.id === 'c').source.kind, 'local');
});

test('a conflicting file changed by another view is confirmed again', async t => {
  const app = await mount(t);
  await change(() => app.main.addLocalFiles([file('A.txt')], 'file', 'folder'));
  await change(() => app.child.act('favorite', ['a']));
  await change(() => app.main.answerUploadConflict('overwrite', true));
  assert.equal(app.main.uploadPrompt.conflict.existing.favorite, 1);
  assert.equal(app.main.entries.find(item => item.id === 'a').source.kind, 'existing');
  await change(() => app.main.answerUploadConflict('overwrite', false));
  assert.equal(app.main.uploadPrompt, null); assert.equal(app.main.entries.find(item => item.id === 'a').favorite, 1);
});

for (const reason of ['readonly', 'feature', 'save', 'discard', 'unmount']) test(`pending child confirmation is invalidated by ${reason}`, async t => {
  const app = await mount(t), before = app.main.entries;
  await change(() => app.child.addLocalFiles([file('A.txt')], 'file', 'folder'));
  const retained = app.child.answerUploadConflict;
  if (reason === 'readonly') await app.update({ readOnly: true });
  if (reason === 'feature') await app.update({ features: { uploadFiles: false } });
  if (reason === 'save') await change(() => app.workspace.draft.save());
  if (reason === 'discard') await change(() => app.workspace.draft.discard());
  if (reason === 'unmount') await app.closeChild();
  await change(() => retained('overwrite', true));
  assert.equal(app.main.entries, before); assert.equal(app.requests.length, 0);
});

test('duplicate incoming names complete within one batch with stable newly assigned IDs', async t => {
  const app = await mount(t), first = file('New.txt'), last = file('New.txt', '', 'last');
  await change(() => app.main.addLocalFiles([first, last], 'file', 'folder'));
  const id = app.main.uploadPrompt.conflict.existing.id;
  await change(() => app.main.answerUploadConflict('overwrite', true));
  assert.equal(app.main.uploadPrompt, null);
  const added = app.main.entries.filter(item => item.name === 'New.txt');
  assert.equal(added.length, 1); assert.equal(added[0].id, id); assert.equal(added[0].source.file, last);
});


test('a single conflict counts only the duplicate, excluding new and invalid files', async t => {
  const app = await mount(t, { upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  await change(() => app.main.addLocalFiles([file('A.txt'), file('New.txt'), file('invalid.exe')], 'file', 'folder'));
  assert.equal(app.main.uploadPrompt.conflictIndex, 1); assert.equal(app.main.uploadPrompt.conflictCount, 1);
});

test('mixed file/directory imports recheck both feature permissions during a conflict', async t => {
  const app = await mount(t);
  await change(() => app.main.addLocalFiles([file('A.txt', '資料/A.txt'), file('Root.txt')], 'folder', 'root'));
  assert.ok(app.main.uploadPrompt);
  const retained = app.main.answerUploadConflict;
  await app.update({ features: { uploadFiles: false, uploadFolders: true } });
  await change(() => retained('overwrite', true));
  assert.equal(app.main.uploadPrompt, null); assert.equal(app.main.dirty, false); assert.equal(app.requests.length, 0);
});

import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
    export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    export { FAVORITES, RECENT } from './src/state/view-state.ts';
  `, resolveDir: packageRoot, sourcefile: 'explorer-native-clipboard.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerWorkspace, useExplorerViewController, FAVORITES, RECENT } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-native-clipboard.mjs').toString('base64')}`
);
const change = async action => { await act(async () => { await action(); }); };
const entry = (id, name, parent = 'root', kind = 'file') => ({
  id, name, parent, kind, size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '',
  source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0,
});
const initialEntries = () => [entry('folder', '資料', 'root', 'folder'), entry('alpha', 'Alpha.txt')];
const file = (name = 'clipboard.txt', content = 'clip') => new File([content], name, { type: 'text/plain' });
const newEntries = pane => pane.entries.filter(e => !['folder', 'alpha'].includes(e.id));

function fakeDocument() {
  const listeners = new Map();
  const menus = [];
  return {
    listeners, menus,
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    querySelectorAll() { return menus; }, getElementById: () => null,
    async dispatch(type, event) { await change(() => { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); }); },
  };
}
const element = (parent = null, extra = {}) => ({
  tagName: 'DIV', isContentEditable: false, parentElement: parent, closest: () => null, ...extra,
});
function rootElement() {
  const root = element();
  root.contains = target => { for (let node = target; node; node = node.parentElement) if (node === root) return true; return false; };
  return root;
}
async function mount(t, supplied = {}, { shared = false, document = fakeDocument() } = {}) {
  const root = rootElement(), childRoot = rootElement(), childDocument = fakeDocument();
  const events = [], saves = [], reads = [], panes = new Map();
  let workspace, renderer, closed = false;
  let props = { initialEntries: initialEntries(), onSave: value => { saves.push(value); },
    onEvent: event => { events.push(event); }, readFile: id => { reads.push(id); throw Error('Unexpected file read'); }, ...supplied };
  function Pane({ options, workspace, windowId, ownerDocument, host }) {
    const controller = useExplorerViewController(options, workspace, windowId, ownerDocument);
    controller.workspaceRef.current = host;
    panes.set(windowId, controller);
    return null;
  }
  function Probe({ options }) {
    const currentWorkspace = useExplorerWorkspace(options);
    workspace = currentWorkspace;
    useLayoutEffect(() => {
      const child = currentWorkspace.tabs.forWindow('child');
      if (shared && !child.tabs.length) child.addTab();
    }, [currentWorkspace.tabs]);
    return [h(Pane, { key: 'main', options, workspace, windowId: 'main', ownerDocument: document, host: root }),
      ...(shared ? [h(Pane, { key: 'child', options, workspace, windowId: 'child', ownerDocument: childDocument, host: childRoot })] : [])];
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  events.length = 0;
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return {
    get current() { return panes.get('main'); }, get child() { return panes.get('child'); }, get workspace() { return workspace; },
    root, childRoot, document, childDocument, events, saves, reads, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async key(key, modifiers = {}, windowId = 'main') {
      const event = { target: windowId === 'main' ? root : childRoot, key, ctrlKey: false, metaKey: false, altKey: false,
        isComposing: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...modifiers };
      await (windowId === 'main' ? document : childDocument).dispatch('keydown', event);
      return event;
    },
    async native(type, options = {}, windowId = 'main') {
      const data = new Map([['old-os-format', 'old']]);
      const event = { type, target: windowId === 'main' ? root : childRoot, defaultPrevented: false,
        clipboardData: { files: [], items: [], clearData() { data.clear(); }, setData(key, value) { data.set(key, value); }, getData: key => data.get(key) ?? '' },
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...options };
      await (windowId === 'main' ? document : childDocument).dispatch(type, event);
      return { event, data };
    },
    async paste(files = [], options = {}, windowId = 'main') {
      const event = { target: windowId === 'main' ? root : childRoot, defaultPrevented: false,
        clipboardData: { files, items: files.map(value => ({ kind: 'file', getAsFile: () => value })), getData: () => '' },
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...options };
      await (windowId === 'main' ? document : childDocument).dispatch('paste', event);
      return event;
    },
  };
}

test('Ctrl/Cmd+V leaves keydown native and stages clipboard Files once when paste arrives', async t => {
  const hook = await mount(t);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  const before = hook.current.entries;
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    const event = await hook.key('v', modifiers);
    assert.equal(event.defaultPrevented, false);
    assert.equal(hook.current.entries, before);
  }
  const pasted = file();
  const event = await hook.paste([pasted]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(newEntries(hook.current).length, 1, 'files and matching DataTransfer.items are not imported twice');
  assert.equal(newEntries(hook.current)[0].name, 'clipboard.txt');
  assert.equal(newEntries(hook.current)[0].source.file, pasted);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 1);
  assert.equal(hook.events.find(e => e.type === 'change').action, 'upload');
  assert.equal(hook.current.dirty, true);
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
});

test('clipboard Files take priority over pending internal cuts without moving the cut entries', async t => {
  const hook = await mount(t);
  await change(() => hook.current.copyToClipboard('move', ['alpha']));
  await change(() => hook.current.navigate('folder'));
  const pasted = file('from-os.txt');
  await hook.paste([pasted]);
  assert.equal(hook.current.entries.find(e => e.id === 'alpha').parent, 'root');
  assert.equal(newEntries(hook.current)[0].parent, 'folder');
  assert.equal(newEntries(hook.current)[0].source.file, pasted);
  assert.ok(hook.events.filter(e => e.type === 'change').every(e => e.action === 'upload'));
});

test('native paste without Files falls back to internal copy or cut only when available', async t => {
  const hook = await mount(t);
  const untouched = await hook.paste([], { clipboardData: { files: [], items: [], getData: () => 'plain text' } });
  assert.equal(untouched.defaultPrevented, false);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  await change(() => hook.current.navigate('folder'));
  assert.equal((await hook.paste()).defaultPrevented, true);
  assert.equal(newEntries(hook.current)[0].parent, 'folder');
  assert.equal(newEntries(hook.current)[0].source.id, 'content-alpha');
  await change(() => hook.current.act('rename', [newEntries(hook.current)[0].id], { name: 'Copied.txt' }));
  await change(() => hook.current.copyToClipboard('move', ['alpha']));
  await hook.paste();
  assert.equal(hook.current.entries.find(e => e.id === 'alpha').parent, 'folder');
  assert.equal(hook.current.clipboard, null);
});

test('File items work when clipboardData.files is empty and text items are ignored', async t => {
  const hook = await mount(t);
  const pasted = file('screenshot.png');
  const data = { files: [], items: [
    { kind: 'string', getAsFile: () => { throw Error('Do not read text as a file'); } },
    { kind: 'file', getAsFile: () => pasted },
  ], getData: () => '' };
  assert.equal((await hook.paste([], { clipboardData: data })).defaultPrevented, true);
  assert.equal(newEntries(hook.current).length, 1);
  assert.equal(newEntries(hook.current)[0].source.file, pasted);
});

test('an unavailable File item rejects the complete payload without dropping it or pasting internal copies', async t => {
  const hook = await mount(t);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  const before = hook.current.entries;
  const data = { files: [], items: [
    { kind: 'file', getAsFile: () => file('valid.txt') },
    { kind: 'file', getAsFile: () => null },
  ], types: ['Files'] };
  assert.equal((await hook.paste([], { clipboardData: data })).defaultPrevented, true);
  assert.equal(hook.current.entries, before);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification.kind, 'error');
});

test('OS Files can be pasted with internal copy and move disabled, but uploadFiles disables them', async t => {
  const hook = await mount(t, { features: { copy: false, move: false } });
  assert.equal(hook.current.canPaste, false);
  await hook.paste([file('native.txt')]);
  assert.equal(newEntries(hook.current)[0].name, 'native.txt');
  await hook.update({ features: { uploadFiles: false } });
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  const before = hook.current.entries;
  assert.equal((await hook.paste([file('blocked.txt')])).defaultPrevented, true);
  assert.equal(hook.current.entries, before, 'disabled native imports do not fall back to a different internal operation');
});

test('pasting into an open folder uses currentParent even when another folder is merely selected', async t => {
  const hook = await mount(t);
  await change(() => hook.current.setSelected(['folder']));
  await hook.paste([file('at-root.txt')]);
  assert.equal(newEntries(hook.current)[0].parent, 'root');
  await change(() => hook.current.navigate('folder'));
  await hook.paste([file('in-folder.txt')]);
  assert.equal(newEntries(hook.current).find(e => e.name === 'in-folder.txt').parent, 'folder');
});

test('native Files use the same atomic upload restrictions and latest options, without an internal fallback on rejection', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 } });
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  const before = hook.current.entries;
  const event = await hook.paste([file('good.txt'), file('bad.exe', 'too-large')]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  const rejections = hook.events.filter(e => e.type === 'upload');
  assert.equal(rejections.length, 1); assert.equal(rejections[0].attemptedCount, 2);
  assert.deepEqual(rejections[0].rejections[0].reasons.map(e => e.code), ['extension-not-allowed', 'file-too-large']);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
  await hook.update({ upload: { allowedExtensions: ['.exe'], maxFileSizeBytes: 9 } });
  await hook.paste([file('bad.exe', 'too-large')]);
  assert.equal(newEntries(hook.current)[0].name, 'bad.exe');
});

test('outside, prevented, form and editable targets retain their native paste behavior', async t => {
  const hook = await mount(t);
  const before = hook.current.entries;
  const targets = [element(), null,
    ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => element(hook.root, { tagName })),
    element(hook.root, { isContentEditable: true }),
  ];
  for (const target of targets) {
    const event = await hook.paste([file()], { target });
    assert.equal(event.defaultPrevented, false);
    assert.equal(hook.current.entries, before);
  }
  await hook.paste([file()], { defaultPrevented: true });
  assert.equal(hook.current.entries, before);
  const valid = await hook.paste([file()], { target: element(hook.root) });
  assert.equal(valid.defaultPrevented, true);
  assert.equal(newEntries(hook.current).length, 1);
});

test('rename, owned menus, modal, preview and details block paste without consuming it', async t => {
  const hook = await mount(t);
  const before = hook.current.entries;
  const guards = [
    [() => hook.current.startRename(['alpha']), () => hook.current.cancelRename()],
    [() => hook.current.showModal('create'), () => hook.current.setModal(null)],
    [() => hook.current.openEntry(hook.current.entries.find(e => e.id === 'alpha')), () => hook.current.setPreviewId(null)],
    [() => hook.current.setDetailId('alpha'), () => hook.current.setDetailId(null)],
  ];
  for (const [open, close] of guards) {
    await change(open);
    assert.equal((await hook.paste([file()])).defaultPrevented, false);
    assert.equal(hook.current.entries, before);
    await change(close);
  }
  hook.document.menus.push({ getAttribute: () => hook.current.instanceId });
  assert.equal((await hook.paste([file()])).defaultPrevented, false);
  assert.equal(hook.current.entries, before);
  hook.document.menus.length = 0;
  hook.document.menus.push({ getAttribute: () => 'another-explorer' });
  assert.equal((await hook.paste([file()])).defaultPrevented, true);
  assert.equal(newEntries(hook.current).length, 1);
});

test('special locations and a pending save reject native pastes without dirty or save side effects', async t => {
  let finishSave;
  const pending = new Promise(resolve => { finishSave = resolve; });
  const hook = await mount(t, { onSave: () => pending });
  const before = hook.current.entries;
  for (const location of [FAVORITES, RECENT]) {
    await change(() => hook.current.navigate(location));
    assert.equal((await hook.paste([file()])).defaultPrevented, false);
    assert.equal(hook.current.entries, before);
  }
  await change(() => hook.current.navigate('root'));
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Changed.txt' }));
  let saving;
  await change(() => { saving = hook.current.saveChanges(); });
  assert.equal(hook.current.busy, true);
  const during = hook.current.entries;
  assert.equal((await hook.paste([file()])).defaultPrevented, false);
  assert.equal(hook.current.entries, during);
  await change(async () => { finishSave(); await saving; });
  assert.equal(hook.current.dirty, false);
});

test('two embedded Explorers on one document paste only into the event target instance', async t => {
  const document = fakeDocument();
  const first = await mount(t, {}, { document });
  const second = await mount(t, {}, { document });
  assert.equal(document.listeners.get('paste').size, 2);
  await first.paste([file('first.txt')]);
  assert.equal(newEntries(first.current).length, 1);
  assert.equal(newEntries(second.current).length, 0);
  await second.paste([file('second.txt')]);
  assert.equal(newEntries(first.current).length, 1);
  assert.equal(newEntries(second.current).length, 1);
  await first.unmount(); await second.unmount();
  assert.ok([...document.listeners.values()].every(set => set.size === 0));
});

test('a child document uses its own paste listener and shares staged Files with its parent workspace', async t => {
  const hook = await mount(t, {}, { shared: true });
  assert.equal(hook.document.listeners.get('paste').size, 1);
  assert.equal(hook.childDocument.listeners.get('paste').size, 1);
  await change(() => hook.child.navigate('folder'));
  const pasted = file('from-child.txt');
  await hook.paste([pasted], {}, 'child');
  assert.equal(newEntries(hook.current).length, 1);
  assert.equal(newEntries(hook.current)[0].parent, 'folder');
  assert.equal(newEntries(hook.current)[0].source.file, pasted);
  assert.equal(hook.current.entries, hook.child.entries);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 1);
  await hook.unmount();
  assert.ok([...hook.document.listeners.values(), ...hook.childDocument.listeners.values()].every(set => set.size === 0));
});

test('native copy and cut replace OS clipboard formats with selected virtual paths', async t => {
  const hook = await mount(t);
  await change(() => hook.current.setSelected(['folder', 'alpha']));
  for (const [key, type, action] of [['c', 'copy', 'copy'], ['x', 'cut', 'move']]) {
    assert.equal((await hook.key(key, { ctrlKey: true })).defaultPrevented, false);
    const { event, data } = await hook.native(type);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual([...data], [['text/plain', '/資料\n/Alpha.txt']]);
    assert.deepEqual(hook.current.clipboard, { action, ids: ['folder', 'alpha'] });
  }
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []);
  await hook.update({ features: { copy: false, move: false } });
  assert.equal((await hook.native('copy')).event.defaultPrevented, false);
  assert.equal((await hook.native('cut')).event.defaultPrevented, false);
});

test('native clipboard commands leave text selections and unrelated nested Explorers untouched', async t => {
  const hook = await mount(t);
  await change(() => hook.current.setSelected(['alpha']));
  const input = element(hook.root, { tagName: 'INPUT' });
  assert.equal((await hook.native('copy', { target: input })).event.defaultPrevented, false);
  assert.equal((await hook.native('cut', { target: element(hook.root, { isContentEditable: true }) })).event.defaultPrevented, false);
  assert.equal(hook.current.clipboard, null);
  const nestedRoot = rootElement(); nestedRoot.parentElement = hook.root;
  const nestedTarget = element(nestedRoot, { closest: selector => selector === '[data-explorer-root]' ? nestedRoot : null });
  assert.equal((await hook.paste([file()], { target: nestedTarget })).defaultPrevented, false);
  assert.equal(hook.current.dirty, false);
});

test('UI copy writes paths through its owner window clipboard and failures preserve internal paste', async t => {
  const calls = [], document = fakeDocument();
  document.defaultView = { navigator: { clipboard: { async writeText(text) { calls.push(text); throw Error('Clipboard permission denied'); } } } };
  const hook = await mount(t, {}, { document });
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  assert.deepEqual(calls, ['/Alpha.txt']);
  assert.deepEqual(hook.current.clipboard, { action: 'copy', ids: ['alpha'] });
  assert.match(hook.current.notification.description, /画面内.*貼り付け/);
  await change(() => hook.current.navigate('folder'));
  await change(() => hook.current.paste());
  assert.equal(newEntries(hook.current)[0].parent, 'folder');
});

test('a late OS clipboard failure does not overwrite a newer operation notification', async t => {
  const document = fakeDocument();
  let rejectWrite;
  document.defaultView = { navigator: { clipboard: { writeText: () => new Promise((_, reject) => { rejectWrite = reject; }) } } };
  const hook = await mount(t, {}, { document });
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  await change(() => hook.current.addLocalFiles([file()]));
  const success = hook.current.notification;
  assert.equal(success.kind, 'success');
  await change(() => rejectWrite(Error('Permission request failed later')));
  assert.equal(hook.current.notification, success);
});

test('unavailable File payloads never paste stale internal copies', async t => {
  const hook = await mount(t);
  await change(() => hook.current.copyToClipboard('copy', ['alpha']));
  const before = hook.current.entries;
  const unavailable = await hook.paste([], { clipboardData: { files: [], items: [{ kind: 'file', getAsFile: () => null }], types: ['Files'] } });
  assert.equal(unavailable.defaultPrevented, true);
  assert.equal(hook.current.entries, before);
  assert.match(hook.current.notification.message, /取得できません/);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
});

const browserFileEntry = value => ({ name: value.name, isFile: true, isDirectory: false, file: resolve => resolve(value) });
function browserDirectory(name, children = [], batchSize = 100) {
  const stats = { calls: 0 };
  return { name, isFile: false, isDirectory: true, stats, createReader() {
    let offset = 0;
    return { readEntries(resolve) { stats.calls++; const batch = children.slice(offset, offset + batchSize); offset += batchSize; resolve(batch); } };
  } };
}
function directoryClipboard(roots, files = []) {
  return { files, types: ['Files'], items: [
    ...roots.map(root => ({ kind: 'file', webkitGetAsEntry: () => root, getAsFile: () => null })),
    ...files.map(value => ({ kind: 'file', getAsFile: () => value })),
  ] };
}
function delayedDirectory(name = 'Waiting') {
  let finish, fail;
  const directory = { name, isDirectory: true, isFile: false, createReader() {
    let requested = false;
    return { readEntries(resolve, reject) { if (requested) return resolve([]); requested = true; finish = resolve; fail = reject; } };
  } };
  return { directory, complete(children = [browserFileEntry(file('late.txt'))]) { assert.ok(finish); finish(children); },
    fail(error) { assert.ok(fail); fail(error); } };
}
const pathsFor = entries => {
  const byId = new Map(entries.map(e => [e.id, e]));
  const path = e => e.parent === 'root' ? '/' + e.name : path(byId.get(e.parent)) + '/' + e.name;
  return entries.map(path);
};

test('native folder paste drains 101+ entries, preserves hierarchy and ignores empty folders in one atomic change', async t => {
  const hook = await mount(t);
  const many = Array.from({ length: 105 }, (_, index) => browserFileEntry(file(`file-${index}.txt`)));
  const nested = browserDirectory('Nested', many);
  const root = browserDirectory('Batch', [nested, browserDirectory('Empty')]);
  const event = await hook.paste([], { clipboardData: directoryClipboard([root]) });
  assert.equal(event.defaultPrevented, true);
  const paths = pathsFor(hook.current.entries);
  assert.ok(paths.includes('/Batch/Nested/file-104.txt'));
  assert.equal(hook.current.entries.filter(e => e.kind === 'file').length, 106);
  assert.equal(nested.stats.calls, 3);
  assert.equal(paths.includes('/Batch/Empty'), false);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 1);
  assert.equal(hook.events.find(e => e.type === 'change').action, 'upload');
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
});

test('folder-only clipboard imports use uploadFolders independently of internal copy, move and uploadFiles', async t => {
  const hook = await mount(t, { features: { copy: false, move: false, uploadFiles: false, uploadFolders: true } });
  const root = browserDirectory('Folder', [browserFileEntry(file())]);
  assert.equal((await hook.paste([], { clipboardData: directoryClipboard([root]) })).defaultPrevented, true);
  assert.ok(pathsFor(hook.current.entries).includes('/Folder/clipboard.txt'));
  assert.equal(hook.current.clipboard, null);
});

test('mixed root files and folders require both upload feature gates without partial imports', async t => {
  for (const [uploadFiles, uploadFolders] of [[false, true], [true, false], [false, false], [true, true]]) {
    await t.test(`${uploadFiles}/${uploadFolders}`, async subtest => {
      const hook = await mount(subtest, { features: { uploadFiles, uploadFolders } });
      const root = browserDirectory('Batch', [browserFileEntry(file('nested.txt'))]);
      const event = await hook.paste([], { clipboardData: directoryClipboard([root], [file('root.txt')]) });
      assert.equal(event.defaultPrevented, uploadFiles || uploadFolders);
      if (uploadFiles && uploadFolders) {
        const paths = pathsFor(hook.current.entries);
        assert.ok(paths.includes('/Batch/nested.txt')); assert.ok(paths.includes('/root.txt'));
      } else {
        assert.equal(hook.current.dirty, false); assert.equal(newEntries(hook.current).length, 0);
        assert.equal(root.stats.calls, 0, 'disabled imports are not enumerated');
      }
    });
  }
});

test('empty-only folder paste is a no-op with an explanatory notice', async t => {
  const hook = await mount(t);
  const before = hook.current.entries;
  await hook.paste([], { clipboardData: directoryClipboard([browserDirectory('Empty', [browserDirectory('Nested')])]) });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification.kind, 'info');
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
});

test('all folder contents are validated together and an invalid descendant rejects valid files and folders too', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 } });
  const before = hook.current.entries;
  const root = browserDirectory('Batch', [browserFileEntry(file('good.txt')), browserDirectory('Sub', [browserFileEntry(file('bad.exe', 'oversized'))])]);
  await hook.paste([], { clipboardData: directoryClipboard([root]) });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  const rejected = hook.events.filter(e => e.type === 'upload');
  assert.equal(rejected.length, 1); assert.equal(rejected[0].attemptedCount, 2);
  assert.equal(rejected[0].rejections[0].relativePath, 'Batch/Sub/bad.exe');
  assert.deepEqual(rejected[0].rejections[0].reasons.map(e => e.code), ['extension-not-allowed', 'file-too-large']);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
});

test('a directory read error leaves earlier enumerated files and folders out of the draft', async t => {
  const hook = await mount(t);
  const before = hook.current.entries;
  const bad = { name: 'bad.txt', isFile: true, isDirectory: false, file(resolve, reject) { reject(Error('Permission denied')); } };
  await hook.paste([], { clipboardData: directoryClipboard([browserDirectory('Batch', [browserFileEntry(file('good.txt')), bad])]) });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification.kind, 'error');
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
});

test('navigation during asynchronous enumeration keeps the original paste destination', async t => {
  const hook = await mount(t);
  await change(() => hook.current.navigate('folder'));
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await change(() => hook.current.navigate('root'));
  await change(() => delayed.complete());
  assert.equal(hook.current.location, 'root');
  assert.ok(pathsFor(hook.current.entries).includes('/資料/Waiting/late.txt'));
  assert.equal(hook.events.filter(e => e.type === 'change').length, 1);
});

test('deleting the original destination during enumeration reports an error and adds no imported content', async t => {
  const hook = await mount(t);
  await change(() => hook.current.navigate('folder'));
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await change(() => hook.current.act('delete', ['folder']));
  await change(() => delayed.complete());
  assert.equal(newEntries(hook.current).length, 0);
  assert.equal(hook.current.notification.kind, 'error');
  assert.equal(hook.events.filter(e => e.type === 'change' && e.action === 'upload').length, 0);
});

test('a newer file paste supersedes only that pane’s pending directory import', async t => {
  const hook = await mount(t, {}, { shared: true });
  const parent = delayedDirectory('ParentBatch'), child = delayedDirectory('ChildBatch');
  await hook.paste([], { clipboardData: directoryClipboard([parent.directory]) });
  await hook.paste([], { clipboardData: directoryClipboard([child.directory]) }, 'child');
  await hook.paste([file('newest.txt')]);
  await change(() => { parent.complete(); child.complete(); });
  const paths = pathsFor(hook.current.entries);
  assert.ok(paths.includes('/newest.txt')); assert.ok(paths.includes('/ChildBatch/late.txt'));
  assert.equal(paths.includes('/ParentBatch'), false);
  assert.equal(hook.current.entries, hook.child.entries);
});

test('disabling a required upload feature cancels an in-flight folder import even if it is later re-enabled', async t => {
  const hook = await mount(t);
  const delayed = delayedDirectory(); const before = hook.current.entries;
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await hook.update({ features: { uploadFolders: false } });
  await hook.update({ features: { uploadFolders: true } });
  await change(() => delayed.complete());
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
});

test('discard cancels pending imports in every pane without restoring them after later callbacks', async t => {
  const hook = await mount(t, {}, { shared: true });
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Changed.txt' }));
  const first = delayedDirectory('MainBatch'), second = delayedDirectory('ChildBatch');
  await hook.paste([], { clipboardData: directoryClipboard([first.directory]) });
  await hook.paste([], { clipboardData: directoryClipboard([second.directory]) }, 'child');
  await change(() => hook.workspace.draft.discard());
  await change(() => { first.complete(); second.complete(); });
  assert.equal(hook.current.dirty, false); assert.equal(newEntries(hook.current).length, 0);
  assert.equal(hook.current.entries.find(e => e.id === 'alpha').name, 'Alpha.txt');
});

test('save cancels pending imports across panes and persists only the already-staged draft', async t => {
  const hook = await mount(t, {}, { shared: true });
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Changed.txt' }));
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) }, 'child');
  await change(() => hook.workspace.draft.save());
  await change(() => delayed.complete());
  assert.equal(hook.saves.length, 1);
  assert.equal(hook.saves[0].entries.length, 2);
  assert.equal(newEntries(hook.current).length, 0); assert.equal(hook.current.dirty, false);
});

test('unmount aborts pending directory work and suppresses late events', async t => {
  const hook = await mount(t);
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  const eventCount = hook.events.length;
  await hook.unmount();
  await change(() => delayed.complete());
  assert.equal(hook.events.length, eventCount);
  assert.equal(newEntries(hook.current).length, 0);
});

test('upload restriction changes during enumeration are checked before the final atomic commit', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'] } });
  const delayed = delayedDirectory(); const before = hook.current.entries;
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await hook.update({ upload: { allowedExtensions: ['.pdf'] } });
  await change(() => delayed.complete());
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.events.filter(e => e.type === 'upload').length, 1);
});

test('disabling file uploads leaves a folder-only import running but cancels a mixed import', async t => {
  for (const mixed of [false, true]) {
    await t.test(mixed ? 'mixed files and folders' : 'folder only', async subtest => {
      const hook = await mount(subtest);
      const delayed = delayedDirectory();
      await hook.paste([], { clipboardData: directoryClipboard([delayed.directory], mixed ? [file('root.txt')] : []) });
      await hook.update({ features: { uploadFiles: false } });
      await change(() => delayed.complete());
      assert.equal(hook.current.dirty, !mixed);
      assert.equal(pathsFor(hook.current.entries).includes('/Waiting/late.txt'), !mixed);
      assert.equal(pathsFor(hook.current.entries).includes('/root.txt'), false);
    });
  }
});

test('a rejected newer File paste still supersedes the old folder import and its notice remains visible', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'] } });
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await hook.paste([file('blocked.exe')]);
  const notice = hook.current.notification;
  assert.equal(notice.kind, 'error');
  await change(() => delayed.complete());
  assert.equal(hook.current.dirty, false); assert.equal(newEntries(hook.current).length, 0);
  assert.equal(hook.current.notification, notice);
  assert.equal(hook.events.filter(event => event.type === 'upload' && event.status === 'rejected').length, 1);
});

test('folder paste skips restricted descendants after enumeration and shares only accepted paths across panes', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip' } }, { shared: true });
  const rootFile = file('root.txt');
  const batch = browserDirectory('Batch', [browserFileEntry(file('good.txt')),
    browserDirectory('Rejected', [browserFileEntry(file('bad.exe')), browserFileEntry(file('large.txt', 'oversized'))])]);
  await hook.paste([], { clipboardData: directoryClipboard([batch], [rootFile]) }, 'child');
  assert.equal(hook.current.entries, hook.child.entries);
  const paths = pathsFor(hook.current.entries);
  assert.ok(paths.includes('/Batch/good.txt')); assert.ok(paths.includes('/root.txt'));
  assert.equal(paths.some(path => path.includes('/Rejected')), false);
  assert.equal(hook.current.entries.find(entry => entry.name === 'root.txt').source.file, rootFile);
  const relevant = hook.events.filter(event => event.type === 'upload' || event.type === 'change');
  assert.deepEqual(relevant.map(event => event.type), ['change', 'upload']);
  assert.equal(relevant[1].status, 'skipped'); assert.equal(relevant[1].attemptedCount, 4); assert.equal(relevant[1].addedCount, 2);
  assert.match(hook.child.notification.message, /2ファイルを追加.*2ファイルを除外/);
});

test('a folder read failure stays atomic under skip and does not reclassify unreadable files as skipped', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  const before = hook.current.entries;
  const broken = { name: 'unreadable.txt', isFile: true, isDirectory: false, file(resolve, reject) { reject(Error('Permission denied')); } };
  const batch = browserDirectory('Batch', [browserFileEntry(file('good.txt')), browserFileEntry(file('bad.exe')), broken]);
  await hook.paste([], { clipboardData: directoryClipboard([batch]) });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification.kind, 'error');
  assert.equal(hook.events.filter(event => event.type === 'upload' || event.type === 'change').length, 0);
});

test('all-skipped folder paste is a no-op and a behavior change during read applies to the final batch', async t => {
  const hook = await mount(t, { upload: { allowedExtensions: ['.pdf'] } });
  const before = hook.current.entries;
  const delayed = delayedDirectory();
  await hook.paste([], { clipboardData: directoryClipboard([delayed.directory]) });
  await hook.update({ upload: { allowedExtensions: ['.pdf'], invalidFileBehavior: 'skip' } });
  await change(() => delayed.complete());
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.events.filter(event => event.type === 'change').length, 0);
  const event = hook.events.find(event => event.type === 'upload');
  assert.equal(event.status, 'skipped'); assert.equal(event.addedCount, 0); assert.equal(event.attemptedCount, 1);
  assert.match(hook.current.notification.message, /1ファイルを除外/);
});

test('read-only Explorers ignore native file, folder, copy, cut and editing keyboard operations', async t => {
  const hook = await mount(t, { readOnly: true });
  await change(() => hook.current.setSelected(['alpha']));
  const before = hook.current.entries;
  const folder = browserDirectory('Batch', [browserFileEntry(file())]);
  const filePaste = await hook.paste([file()]);
  const folderPaste = await hook.paste([], { clipboardData: directoryClipboard([folder]) });
  assert.equal(filePaste.defaultPrevented, false); assert.equal(folderPaste.defaultPrevented, false);
  assert.equal(folder.stats.calls, 0);
  for (const action of ['copy', 'cut']) assert.equal((await hook.native(action)).event.defaultPrevented, false);
  for (const key of ['Delete', 'F2']) await hook.key(key);
  await hook.key('s', { ctrlKey: true });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.renamingEntryId, null); assert.equal(hook.current.modal, null);
  assert.equal(hook.events.filter(event => ['change', 'upload', 'save', 'clipboard'].includes(event.type)).length, 0);
});

test('enabling read-only aborts in-flight folder pastes across all windows without reviving them after re-enabling edits', async t => {
  for (const patch of [{ readOnly: true }, { onSave: undefined, readOnly: false }]) await t.test(Object.hasOwn(patch, 'onSave') ? 'save handler removed' : 'explicit mode', async subtest => {
    const hook = await mount(subtest, {}, { shared: true });
    await change(() => hook.current.act('rename', ['alpha'], { name: 'AlreadyEdited.txt' }));
    const before = hook.current.entries;
    const main = delayedDirectory('MainBatch'), child = delayedDirectory('ChildBatch');
    await hook.paste([], { clipboardData: directoryClipboard([main.directory]) });
    await hook.paste([], { clipboardData: directoryClipboard([child.directory]) }, 'child');
    const eventCount = hook.events.filter(event => event.type !== 'edit-mode').length;
    await hook.update(patch);
    assert.equal(hook.current.readOnly, true); assert.equal(hook.child.readOnly, true);
    await hook.update({ onSave() {}, readOnly: false });
    await change(() => { main.complete(); child.complete(); });
    assert.equal(hook.current.entries, before); assert.equal(hook.child.entries, before);
    assert.equal(hook.current.dirty, true); assert.equal(hook.events.filter(event => event.type !== 'edit-mode').length, eventCount);
    assert.equal(newEntries(hook.current).length, 0);
  });
});

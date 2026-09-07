import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise the real controller while sharing the renderer's React instance.
const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { resolveExplorerOptions } from './src/model/config.ts';
      export { useExplorerController } from './src/state/use-explorer-controller.ts';
      export { FAVORITES, RECENT } from './src/state/view-state.ts';
    `,
    resolveDir: packageRoot,
    sourcefile: 'test-explorer-options.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [{
    name: 'external-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react-test-renderer|lucide-react)(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const { resolveExplorerOptions, useExplorerController, FAVORITES, RECENT } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);

const featureNames = [
  'favorites', 'recent', 'createFolder', 'createFile', 'uploadFiles', 'uploadFolders', 'copy', 'move',
  'rename', 'delete', 'preview', 'download', 'details', 'search', 'sort', 'tabs', 'pathInput', 'detachTabs', 'resizeSidebar',
];
const allFeatures = enabled => Object.fromEntries(featureNames.map(name => [name, enabled]));
const entry = (id, name, size = 4, kind = 'file', mime = 'text/plain') => ({
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.split('.').at(-1).toLowerCase() : '',
  id, parent: 'root', name, kind, size: kind === 'folder' ? 0 : size, mime,
  createdAt: '2026-09-05T23:00:00.000Z', updatedAt: '2026-09-05T23:00:00.000Z',
  favorite: id === 'alpha' ? 1 : 0,
  source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
});
const initialEntries = () => [
  entry('target', 'Target', 0, 'folder', ''),
  entry('alpha', 'Alpha.txt', 20),
  entry('beta', 'Beta.txt', 10),
  entry('photo', 'Photo.png', 30, 'file', 'image/png'),
];
const byId = (hook, id) => hook.current.entries.find(item => item.id === id);
const visibleIds = hook => hook.current.visible.map(item => item.id);

async function mountController(t, supplied = {}) {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set();
  const nativeListeners = new Map([
    ["copy", new Set()], ["cut", new Set()], ["paste", new Set()],
  ]);
  const element = { tagName: 'DIV', isContentEditable: false, closest: () => null };
  element.contains = target => target === element;
  const effects = { filePicker: 0, folderPicker: 0, searchFocus: 0, rowFocus: 0, anchors: 0 };
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (type, handler) => { if (type === 'keydown') listeners.add(handler); nativeListeners.get(type)?.add(handler); },
      removeEventListener: (type, handler) => { if (type === 'keydown') listeners.delete(handler); nativeListeners.get(type)?.delete(handler); },
      querySelectorAll: () => [],
      getElementById: () => ({ focus: () => { effects.rowFocus++; } }),
      createElement: () => { effects.anchors++; throw new Error('Unexpected download'); },
    },
  });
  let latest;
  let renderer;
  let props = { initialEntries: initialEntries(), onSave: () => {}, ...supplied };
  function Probe({ options }) {
    latest = useExplorerController(options);
    return null;
  }
  t.after(async () => {
    try {
      if (renderer) await act(async () => { renderer.unmount(); });
      assert.equal(listeners.size, 0, 'controller removes its keydown listener');
      assert.ok([...nativeListeners.values()].every(set => set.size === 0), 'controller removes its native clipboard listeners');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else delete globalThis.document;
    }
  });
  await act(async () => { renderer = create(createElement(Probe, { options: props })); });
  latest.workspaceRef.current = element;
  latest.fileInput.current = { click: () => { effects.filePicker++; } };
  latest.folderInput.current = { click: () => { effects.folderPicker++; } };
  latest.searchInput.current = { focus: () => { effects.searchFocus++; } };
  return {
    get current() { return latest; },
    effects,
    element,
    async update(patch) {
      props = { ...props, ...patch };
      await act(async () => { renderer.update(createElement(Probe, { options: props })); });
    },
    async key(key, modifiers = {}) {
      const event = {
        target: element, key, ctrlKey: false, metaKey: false, altKey: false,
        isComposing: false, defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        ...modifiers,
      };
      await act(async () => { for (const listener of [...listeners]) listener(event); });
      const nativeType = ({ c: 'copy', x: 'cut', v: 'paste' })[key.toLowerCase()];
      if (nativeType && !event.defaultPrevented && (event.ctrlKey || event.metaKey)) {
        const clipboardEvent = { type: nativeType, target: element, defaultPrevented: false,
          clipboardData: { files: [], items: [], getData: () => '', clearData() {}, setData() {} },
          preventDefault() { this.defaultPrevented = true; }, stopPropagation() {},
        };
        await act(async () => { for (const listener of [...nativeListeners.get(nativeType)]) listener(clipboardEvent); });
      }
      return event;
    },
  };
}

function dragEvent({ ctrlKey = false, files = [] } = {}) {
  const data = new Map();
  return {
    ctrlKey, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    dataTransfer: {
      get types() { return [...data.keys(), ...(files.length ? ['Files'] : [])]; },
      files, effectAllowed: 'uninitialized', dropEffect: 'none',
      setData: (type, value) => data.set(type, value),
      getData: type => data.get(type) ?? '',
    },
  };
}

test('listing keeps folder, favorites, recent and global search scopes with effective selection', async t => {
  const initial = [
    { ...entry('target', 'Target', 0, 'folder'), favorite: 1 },
    { ...entry('alpha', 'Alpha.json', 20), updatedAt: '2026-09-01T00:00:00Z' },
    { ...entry('beta', 'Beta.csv', 10), updatedAt: '2026-09-02T00:00:00Z' },
    { ...entry('child', 'Child.txt', 5), parent: 'target', updatedAt: '2026-09-03T00:00:00Z' },
  ];
  const hook = await mountController(t, { initialEntries: initial });
  assert.deepEqual(visibleIds(hook), ['target', 'alpha', 'beta']);
  await act(async () => { hook.current.setSort({ key: 'extension', asc: true }); });
  assert.deepEqual(visibleIds(hook), ['target', 'beta', 'alpha']);
  await act(async () => { hook.current.setSelected(['alpha', 'child', 'alpha', 'missing', 'beta']); });
  assert.deepEqual(hook.current.selected, ['alpha', 'beta']);
  assert.deepEqual(hook.current.selectedEntries.map(item => item.id), ['beta', 'alpha']);
  await act(async () => { hook.current.navigate(FAVORITES); });
  assert.deepEqual(visibleIds(hook), ['target', 'alpha']);
  await act(async () => { hook.current.setQuery('child'); });
  assert.deepEqual(visibleIds(hook), ['child'], 'name searches include other folders regardless of the current special location');
  await act(async () => { hook.current.navigate(RECENT); hook.current.setSort({ key: 'size', asc: false }); });
  assert.deepEqual(visibleIds(hook), ['child', 'beta', 'alpha'], 'recent always uses descending modification time and excludes folders');
  await act(async () => { hook.current.setSelected(['child', 'beta']); });
  await hook.update({ selection: { mode: 'single' } });
  assert.deepEqual(hook.current.selected, ['child']);
  await hook.update({ selection: { mode: 'none' } });
  assert.deepEqual(hook.current.selected, []);
  assert.deepEqual(hook.current.selectedEntries, []);
  assert.equal(hook.current.dirty, false);
});

async function hoverWithProtectedData(hook, drag, parent) {
  // Browsers expose drag types during dragover, but only reveal the payload on drop.
  const readData = drag.dataTransfer.getData;
  drag.dataTransfer.getData = () => '';
  try {
    await act(async () => { hook.current.allowDrop(drag, parent); });
  } finally {
    drag.dataTransfer.getData = readData;
  }
}

test('omitted options preserve every feature, multiple selection and the eight existing views', () => {
  assert.deepEqual(resolveExplorerOptions(), {
    readOnly: false,
    features: allFeatures(true),
    selection: { mode: 'multiple', checkboxes: true },
    ui: { sidebar: true, contextMenu: true, rowActions: true, thumbnails: true },
    view: {
      allowedModes: ['extra-large', 'large', 'medium', 'small', 'list', 'details', 'tiles', 'content'],
      defaultMode: 'details',
    },
  });
  const first = resolveExplorerOptions({
    features: { copy: false }, selection: { mode: 'none' }, ui: { sidebar: false },
  });
  assert.deepEqual(first.features, { ...allFeatures(true), copy: false });
  assert.deepEqual(first.ui, { sidebar: false, contextMenu: true, rowActions: true, thumbnails: true });
  assert.deepEqual(first.selection, { mode: 'none', checkboxes: false });
  assert.equal(resolveExplorerOptions().features.copy, true, 'one instance cannot alter defaults');
});

test('restricted views require a nonempty valid list and a default within that list', () => {
  const supplied = Object.freeze(['large', 'large', 'list']);
  assert.deepEqual(resolveExplorerOptions({ view: { allowedModes: supplied } }).view, {
    allowedModes: ['large', 'list'], defaultMode: 'large',
  });
  assert.deepEqual(supplied, ['large', 'large', 'list']);
  assert.equal(resolveExplorerOptions({ view: { allowedModes: ['large', 'details'] } }).view.defaultMode, 'details');
  assert.equal(resolveExplorerOptions({ view: { allowedModes: ['large', 'list'], defaultMode: 'list' } }).view.defaultMode, 'list');
  assert.throws(() => resolveExplorerOptions({ view: { allowedModes: [] } }), /view\.allowedModes/);
  assert.throws(() => resolveExplorerOptions({ view: { allowedModes: ['unknown'] } }), /view\.allowedModes/);
  assert.throws(() => resolveExplorerOptions({ view: { allowedModes: ['large'], defaultMode: 'details' } }), /view\.defaultMode/);
});

test('disabling copy preserves keyboard cut and paste, while Ctrl-drag cannot copy or silently move', async t => {
  const hook = await mountController(t, { features: { copy: false, move: true } });
  await act(async () => { hook.current.setSelected(['alpha']); });
  await hook.key('c', { ctrlKey: true });
  assert.equal(hook.current.clipboard, null);
  await hook.key('x', { ctrlKey: true });
  assert.deepEqual(hook.current.clipboard, { action: 'move', ids: ['alpha'] });
  await act(async () => { hook.current.navigate('target'); });
  assert.equal(hook.current.canPaste, true);
  assert.equal((await hook.key('v', { ctrlKey: true })).defaultPrevented, false);
  assert.equal(byId(hook, 'alpha').parent, 'target');
  assert.equal(hook.current.entries.length, 4);
  assert.equal(hook.current.clipboard, null);

  const drag = dragEvent({ ctrlKey: true });
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'alpha')); });
  assert.equal(drag.dataTransfer.effectAllowed, 'move');
  await act(async () => { hook.current.allowDrop(drag, 'root'); });
  assert.equal(drag.dataTransfer.dropEffect, 'none');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.equal(byId(hook, 'alpha').parent, 'target');
  assert.equal(hook.current.entries.length, 4);
  drag.ctrlKey = false;
  await act(async () => { hook.current.allowDrop(drag, 'root'); });
  assert.equal(drag.dataTransfer.dropEffect, 'move');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.equal(byId(hook, 'alpha').parent, 'root');
});

test('disabling move preserves copy/paste and disabling the clipboard action makes paste inert', async t => {
  const hook = await mountController(t, { features: { copy: true, move: false } });
  await act(async () => { hook.current.setSelected(['alpha']); });
  await hook.key('x', { ctrlKey: true });
  assert.equal(hook.current.clipboard, null);
  await hook.key('c', { ctrlKey: true });
  await act(async () => { hook.current.navigate('target'); });
  assert.equal((await hook.key('v', { ctrlKey: true })).defaultPrevented, false);
  assert.equal(byId(hook, 'alpha').parent, 'root');
  const copy = hook.current.entries.find(item => item.parent === 'target');
  assert.notEqual(copy.id, 'alpha');
  assert.deepEqual(copy.source, byId(hook, 'alpha').source);
  const entries = hook.current.entries;
  await hook.update({ features: { copy: false, move: false } });
  assert.equal(hook.current.clipboard, null);
  assert.equal(hook.current.canPaste, false);
  assert.equal(hook.current.canDrag, false);
  assert.equal((await hook.key('v', { ctrlKey: true })).defaultPrevented, false);
  await act(async () => { hook.current.paste(); });
  const drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, copy); });
  assert.equal(drag.defaultPrevented, true);
  assert.deepEqual(drag.dataTransfer.types, []);
  assert.deepEqual(hook.current.entries, entries);
});

test('disabled mutation, modal and keyboard routes cannot change the draft', async t => {
  const hook = await mountController(t, { features: allFeatures(false) });
  const entries = hook.current.entries;
  await act(async () => { hook.current.setSelected(['alpha']); });
  for (const action of ['create', 'rename', 'copy', 'move', 'delete', 'favorite']) {
    await act(async () => {
      assert.equal(hook.current.act(action, ['alpha'], { name: 'Changed', parent: 'target' }), false);
    });
  }
  for (const type of ['create', 'copy', 'move', 'delete']) {
    await act(async () => { hook.current.showModal(type, ['alpha']); });
    assert.equal(hook.current.modal, null);
    await act(async () => { hook.current.setModal({ type, ids: ['alpha'] }); });
    assert.equal(hook.current.modal, null, 'raw modal state is also guarded before submission');
    await act(async () => { hook.current.submitModal(); });
  }
  for (const key of ['c', 'x', 'v', 'f', 'k']) await hook.key(key, { ctrlKey: true });
  for (const key of ['F2', 'Delete', 'Enter']) await hook.key(key);
  await act(async () => {
    hook.current.copyToClipboard('copy', ['alpha']);
    hook.current.copyToClipboard('move', ['alpha']);
    hook.current.startRename(['alpha']);
    hook.current.openEntry(byId(hook, 'alpha'));
    hook.current.setDetailId('alpha');
  });
  assert.equal(hook.current.clipboard, null);
  assert.equal(hook.current.modal, null);
  assert.equal(hook.current.renamingEntryId, null);
  assert.equal(hook.current.preview, undefined);
  assert.equal(hook.current.details, undefined);
  assert.equal(hook.effects.searchFocus, 0);
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.current.entries, entries);
  await act(async () => { hook.current.openEntry(byId(hook, 'target')); });
  assert.equal(hook.current.location, 'target', 'folder navigation remains available');
  await act(async () => { hook.current.showModal('help'); });
  assert.equal(hook.current.modal.type, 'help');
});

test('workspace shortcuts ignore IME, extra modifiers, editing targets and other instances', async t => {
  const hook = await mountController(t);
  await act(async () => { hook.current.setSelected(['alpha']); });
  for (const modifier of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { altKey: true }]) {
    for (const key of ['F2', 'Delete', 'Enter', 'Escape']) {
      assert.equal((await hook.key(key, modifier)).defaultPrevented, false);
    }
    assert.equal((await hook.key('f', { ctrlKey: true, ...modifier })).defaultPrevented, false);
    assert.equal((await hook.key('a', { metaKey: true, ...modifier })).defaultPrevented, false);
  }
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.equal((await hook.key('F2', modifier)).defaultPrevented, false);
    assert.equal((await hook.key('Delete', modifier)).defaultPrevented, false);
  }
  assert.equal((await hook.key('f', { ctrlKey: true, metaKey: true })).defaultPrevented, false);
  assert.equal((await hook.key('F2', { target: { ...hook.element } })).defaultPrevented, false, 'outside targets are untouched');
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
    hook.element.tagName = tagName;
    assert.equal((await hook.key('a', { ctrlKey: true })).defaultPrevented, false);
    assert.equal((await hook.key('Delete')).defaultPrevented, false);
  }
  hook.element.tagName = 'DIV';
  hook.element.isContentEditable = true;
  assert.equal((await hook.key('s', { metaKey: true })).defaultPrevented, false);
  hook.element.isContentEditable = false;
  hook.element.closest = selector => selector === '[data-explorer-root]' ? {} : null;
  assert.equal((await hook.key('F2')).defaultPrevented, false, 'nested Explorer owns its commands');
  hook.element.closest = () => null;
  await hook.key('F2', { defaultPrevented: true });
  assert.equal(hook.current.renamingEntryId, null);
  assert.equal(hook.current.modal, null);
  assert.equal(hook.current.preview, undefined);
  assert.deepEqual(hook.current.selected, ['alpha']);
  assert.equal(hook.effects.searchFocus, 0);
  for (const [key, modifier] of [['F', { ctrlKey: true }], ['k', { metaKey: true }]]) {
    assert.equal((await hook.key(key, modifier)).defaultPrevented, true);
  }
  assert.equal(hook.effects.searchFocus, 2);
});

test('Mac delete requires Command, respects tab focus and policy, and opens the normal confirmation', async t => {
  const hook = await mountController(t);
  await act(async () => { hook.current.setSelected(['alpha']); });
  assert.equal((await hook.key('Backspace')).defaultPrevented, false);
  assert.equal((await hook.key('Backspace', { ctrlKey: true })).defaultPrevented, false);
  hook.element.closest = selector => selector === '[role="tablist"]' ? {} : null;
  assert.equal((await hook.key('Backspace', { metaKey: true })).defaultPrevented, false);
  assert.equal((await hook.key('F2')).defaultPrevented, false);
  hook.element.closest = () => null;
  assert.equal((await hook.key('Backspace', { metaKey: true })).defaultPrevented, true);
  assert.equal(hook.current.modal.type, 'delete');
  assert.equal(hook.current.dirty, false, 'the shortcut only opens confirmation');
  await act(async () => { hook.current.setModal(null); });
  await hook.update({ features: { delete: false } });
  assert.equal((await hook.key('Backspace', { metaKey: true })).defaultPrevented, false);
  await hook.update({ features: {}, onSave: undefined });
  assert.equal((await hook.key('Backspace', { metaKey: true })).defaultPrevented, false);
  assert.equal((await hook.key('s', { metaKey: true })).defaultPrevented, false);
  assert.equal(hook.current.modal, null);
  await hook.update({ selection: { mode: 'single' } });
  assert.equal((await hook.key('a', { metaKey: true })).defaultPrevented, false);
});

test('F5 refreshes only an available idle workspace and repeated commands do not restart work', async t => {
  let refreshCalls = 0, finishRefresh;
  const hook = await mountController(t);
  assert.equal((await hook.key('F5')).defaultPrevented, false, 'without onRefresh the browser owns F5');
  await hook.update({ onRefresh: () => { refreshCalls++; return new Promise(resolve => { finishRefresh = resolve; }); } });
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { isComposing: true }, { keyCode: 229 }]) {
    assert.equal((await hook.key('F5', modifiers)).defaultPrevented, false);
  }
  hook.element.tagName = 'INPUT';
  assert.equal((await hook.key('F5')).defaultPrevented, false);
  hook.element.tagName = 'DIV';
  assert.equal((await hook.key('F5', { repeat: true })).defaultPrevented, true);
  assert.equal(refreshCalls, 0);
  assert.equal((await hook.key('F5')).defaultPrevented, true);
  assert.equal(refreshCalls, 1);
  assert.equal(hook.current.refreshing, true);
  assert.equal((await hook.key('F5')).defaultPrevented, true, 'busy refresh does not reload the browser');
  assert.equal(refreshCalls, 1);
  await act(async () => { finishRefresh(initialEntries()); });
  assert.equal(hook.current.refreshing, false);
  await act(async () => { hook.current.showModal('help'); });
  assert.equal((await hook.key('F5')).defaultPrevented, false, 'a modal owns keyboard input');
  assert.equal(refreshCalls, 1);
  await act(async () => { hook.current.setModal(null); });
  for (const key of ['r', 'l', 't', 'w']) {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }])
      assert.equal((await hook.key(key, modifier)).defaultPrevented, false, 'browser shortcuts remain native');
  }
  await hook.update({ onSave: undefined, onRefresh: () => { refreshCalls++; return initialEntries(); } });
  assert.equal((await hook.key('F5')).defaultPrevented, true, 'readonly allows reload');
  assert.equal(refreshCalls, 2);
});

test('Ctrl and Command save use the same edit-session condition as the Save button', async t => {
  let saveCalls = 0, finishSave;
  const hook = await mountController(t, { onSave: () => { saveCalls++; return new Promise(resolve => { finishSave = resolve; }); } });
  assert.equal((await hook.key('s', { ctrlKey: true })).defaultPrevented, true);
  assert.equal(saveCalls, 0, 'a pristine workspace does not save');
  await act(async () => { hook.current.act('rename', ['alpha'], { name: 'Changed.txt' }); });
  assert.equal(hook.current.dirty, true);
  assert.equal((await hook.key('s', { ctrlKey: true, shiftKey: true })).defaultPrevented, false);
  assert.equal((await hook.key('s', { metaKey: true, repeat: true })).defaultPrevented, true);
  assert.equal(saveCalls, 0);
  assert.equal((await hook.key('s', { metaKey: true })).defaultPrevented, true);
  assert.equal(saveCalls, 1);
  assert.equal(hook.current.saving, true);
  await hook.key('s', { ctrlKey: true });
  assert.equal(saveCalls, 1);
  await act(async () => { finishSave(); });
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.act('move', ['alpha'], { parent: 'target' }); });
  await act(async () => { hook.current.act('move', ['alpha'], { parent: 'root' }); });
  assert.equal(hook.current.dirty, false, 'moving back exactly restores the saved snapshot');
  assert.equal(hook.current.editMode, 'edit', 'the acquired edit session remains active');
  assert.equal((await hook.key('s', { ctrlKey: true })).defaultPrevented, true);
  assert.equal(saveCalls, 1, 'ending an empty edit session does not persist unchanged data');
  assert.equal(hook.current.editMode, 'view', 'the shortcut finishes the session just like Save');
});

test('focused rows ignore composition and modified opening without swallowing arrow navigation', async t => {
  const hook = await mountController(t);
  const row = { target: hook.element, currentTarget: hook.element,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, defaultPrevented: false };
  for (const modifier of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { ctrlKey: true }, { shiftKey: true }]) {
    const event = { ...row, key: 'Enter', ...modifier };
    await act(async () => { hook.current.rowKey(event, byId(hook, 'target')); });
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(hook.current.location, 'root');
  await act(async () => { hook.current.rowKey({ ...row, key: 'ArrowDown' }, byId(hook, 'target')); });
  assert.deepEqual(hook.current.selected, ['alpha']);
  assert.equal(hook.effects.rowFocus, 1);
  await act(async () => { hook.current.rowKey({ ...row, key: 'Enter' }, byId(hook, 'target')); });
  assert.equal(hook.current.location, 'target');
});

test('inline rename starts from F2 and commits only local metadata until saving', async t => {
  const saves = [];
  let reads = 0;
  const hook = await mountController(t, {
    onSave: payload => { saves.push(payload); },
    readFile: async () => { reads++; return new Blob(['stored']); },
  });
  const original = byId(hook, 'alpha');
  await act(async () => { hook.current.setSelected(['alpha']); });
  await hook.key('F2');
  assert.equal(hook.current.renamingEntryId, 'alpha');
  assert.equal(hook.current.renameValue, 'Alpha');
  assert.equal(hook.current.renameExtension, '.txt');
  assert.equal(hook.current.renameError, '');
  assert.equal(hook.current.modal, null);
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.setRenameValue('Renamed'); });
  assert.deepEqual(byId(hook, 'alpha'), original, 'typing does not update the draft');
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.equal(byId(hook, 'alpha').name, 'Renamed.txt');
  const { name: originalName, updatedAt: originalUpdatedAt, ...originalContent } = original;
  const { name: renamedName, updatedAt: renamedUpdatedAt, ...renamedContent } = byId(hook, 'alpha');
  assert.notEqual(renamedName, originalName);
  assert.notEqual(renamedUpdatedAt, originalUpdatedAt);
  assert.deepEqual(renamedContent, originalContent, 'ID, content reference and other metadata remain intact');
  assert.equal(hook.current.dirty, true);
  assert.equal(saves.length, 0);
  assert.equal(reads, 0);
  await act(async () => { await hook.current.saveChanges(); });
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].changes.updated.map(item => item.id), ['alpha']);
  assert.deepEqual(saves[0].changes.created, []);
  assert.deepEqual(saves[0].changes.deleted, []);
  assert.equal(saves[0].entries.find(item => item.id === 'alpha').name, 'Renamed.txt');
  assert.equal(hook.current.dirty, false);
});

test('inline rename keeps editing with an error for duplicate or invalid names and allows correction', async t => {
  const hook = await mountController(t);
  const original = hook.current.entries;
  await act(async () => { hook.current.startRename(['alpha']); });
  for (const name of ['Beta', 'bad/name', '', '   ']) {
    await act(async () => { hook.current.setRenameValue(name); });
    await act(async () => { assert.equal(hook.current.commitRename(), false); });
    assert.equal(hook.current.renamingEntryId, 'alpha');
    assert.equal(hook.current.renameValue, name);
    assert.ok(hook.current.renameError.length > 0);
    assert.deepEqual(hook.current.entries, original);
    assert.equal(hook.current.dirty, false);
  }
  await act(async () => { hook.current.setRenameValue('Corrected'); });
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.equal(byId(hook, 'alpha').name, 'Corrected.txt');
});

test('cancelling inline rename and committing the unchanged name leave the draft untouched', async t => {
  const hook = await mountController(t);
  const original = hook.current.entries;
  await act(async () => { hook.current.startRename(['alpha']); });
  await act(async () => { hook.current.setRenameValue('Cancelled'); });
  // The inline input's Escape handler uses cancelRename without committing its value.
  await act(async () => { hook.current.cancelRename(); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.deepEqual(hook.current.entries, original);
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.startRename(['alpha']); });
  assert.equal(hook.current.renameValue, 'Alpha');
  assert.equal(hook.current.renameExtension, '.txt');
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.deepEqual(hook.current.entries, original);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification, null);
});

test('inline rename preserves the final extension and its case while folders remain fully editable', async t => {
  const hook = await mountController(t, { initialEntries: [
    entry('archive', 'bundle.tar.GZ'),
    entry('double-dot', 'draft..TXT'),
    entry('space', 'draft .TXT'),
    entry('directory', 'Folder.old', 0, 'folder', ''),
  ] });
  await act(async () => { hook.current.startRename(['archive']); });
  assert.equal(hook.current.renameValue, 'bundle.tar');
  assert.equal(hook.current.renameExtension, '.GZ');
  await act(async () => { hook.current.setRenameValue('renamed.v2'); });
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(byId(hook, 'archive').name, 'renamed.v2.GZ');
  await act(async () => { hook.current.startRename(['double-dot']); });
  assert.equal(hook.current.renameValue, 'draft.');
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(byId(hook, 'double-dot').name, 'draft..TXT', 'unchanged valid names remain valid');
  await act(async () => { hook.current.startRename(['space']); });
  assert.equal(hook.current.renameValue, 'draft ');
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(byId(hook, 'space').name, 'draft .TXT', 'spaces within a filename are preserved');
  await act(async () => { hook.current.startRename(['directory']); });
  assert.equal(hook.current.renameValue, 'Folder.old');
  assert.equal(hook.current.renameExtension, '');
  await act(async () => { hook.current.setRenameValue('Folder.pdf'); });
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(byId(hook, 'directory').name, 'Folder.pdf');
});

test('inline rename cannot add an extension to extensionless files, including dotfiles', async t => {
  const hook = await mountController(t, { initialEntries: [
    entry('readme', 'README'), entry('dotfile', '.env'),
  ] });
  for (const [id, value, changed] of [['readme', 'README.pdf', 'DOCUMENT'], ['dotfile', '.env.local', '.config']]) {
    const original = byId(hook, id);
    await act(async () => { hook.current.startRename([id]); });
    assert.equal(hook.current.renameValue, original.name);
    assert.equal(hook.current.renameExtension, '');
    await act(async () => { hook.current.setRenameValue(value); });
    await act(async () => { assert.equal(hook.current.commitRename(), false); });
    assert.match(hook.current.renameError, /拡張子/);
    assert.deepEqual(byId(hook, id), original);
    await act(async () => { hook.current.setRenameValue(changed); });
    await act(async () => { assert.equal(hook.current.commitRename(), true); });
    assert.equal(byId(hook, id).name, changed);
  }
});

test('disabling rename prevents both starting an editor and committing one already open', async t => {
  const hook = await mountController(t);
  await act(async () => { hook.current.startRename(['alpha']); });
  await act(async () => { hook.current.setRenameValue('Changed'); });
  assert.equal(hook.current.renamingEntryId, 'alpha');
  await hook.update({ features: { rename: false } });
  assert.equal(hook.current.renamingEntryId, null);
  await act(async () => { assert.equal(hook.current.commitRename(), false); });
  await act(async () => { hook.current.startRename(['beta']); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.equal(byId(hook, 'alpha').name, 'Alpha.txt');
  assert.equal(byId(hook, 'beta').name, 'Beta.txt');
  assert.equal(hook.current.dirty, false);
});

test('an explicit entry can be renamed from a row action when selection is disabled', async t => {
  const hook = await mountController(t, { selection: { mode: 'none', checkboxes: false } });
  await act(async () => { hook.current.startRename(['alpha']); });
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.renamingEntryId, 'alpha');
  await act(async () => { hook.current.setRenameValue('Row action'); });
  await act(async () => { assert.equal(hook.current.commitRename(), true); });
  assert.equal(byId(hook, 'alpha').name, 'Row action.txt');
  assert.deepEqual(hook.current.selected, []);
});

test('folder navigation and adding, switching or closing a tab cancel uncommitted rename text', async t => {
  const hook = await mountController(t);
  const original = hook.current.entries;
  const firstTab = hook.current.activeTabId;
  const begin = async () => {
    await act(async () => { hook.current.startRename(['alpha']); });
    await act(async () => { hook.current.setRenameValue('Abandoned'); });
    assert.equal(hook.current.renamingEntryId, 'alpha');
  };
  await begin();
  await act(async () => { hook.current.navigate('target'); });
  assert.equal(hook.current.renamingEntryId, null);
  await act(async () => { hook.current.navigate('root'); });
  await begin();
  await act(async () => { hook.current.addTab(); });
  assert.equal(hook.current.renamingEntryId, null);
  await begin();
  await act(async () => { hook.current.selectTab(firstTab); });
  assert.equal(hook.current.renamingEntryId, null);
  await begin();
  await act(async () => { hook.current.closeTab(firstTab); });
  assert.equal(hook.current.renamingEntryId, null);
  assert.deepEqual(hook.current.entries, original);
  assert.equal(hook.current.dirty, false);
});

test('file uploads and folder uploads independently gate pickers, additions and external file drops', async t => {
  const hook = await mountController(t, { features: { uploadFiles: true, uploadFolders: false } });
  const file = new File(['plain'], 'plain.txt', { type: 'text/plain' });
  const nested = new File(['nested'], 'nested.txt', { type: 'text/plain' });
  Object.defineProperty(nested, 'webkitRelativePath', { value: 'Uploaded/nested.txt' });
  await act(async () => {
    hook.current.chooseFiles();
    hook.current.chooseFiles(true);
    hook.current.addLocalFiles([nested], 'folder');
    hook.current.addLocalFiles([nested]);
  });
  assert.equal(hook.effects.filePicker, 1);
  assert.equal(hook.effects.folderPicker, 0);
  assert.equal(hook.current.dirty, false, 'a relative path cannot bypass the folder-upload setting');
  const drop = dragEvent({ files: [file] });
  await act(async () => { hook.current.allowDrop(drop, 'root'); });
  assert.equal(drop.dataTransfer.dropEffect, 'copy');
  await act(async () => { hook.current.drop(drop, 'root'); });
  assert.equal(hook.current.entries.find(item => item.name === 'plain.txt').source.file, file);

  await hook.update({ features: { uploadFiles: false, uploadFolders: true, createFolder: false } });
  const beforeFolder = hook.current.entries.length;
  await act(async () => {
    hook.current.chooseFiles();
    hook.current.chooseFiles(true);
    hook.current.addLocalFiles([new File(['blocked'], 'blocked.txt')]);
    hook.current.addLocalFiles([file], 'file', 'target');
    hook.current.drop(drop, 'target');
  });
  assert.equal(hook.effects.filePicker, 1);
  assert.equal(hook.effects.folderPicker, 1);
  assert.equal(hook.current.entries.length, beforeFolder);
  await act(async () => { hook.current.allowDrop(drop, 'root'); });
  assert.equal(drop.dataTransfer.dropEffect, 'none');
  await act(async () => { hook.current.addLocalFiles([nested], 'folder'); });
  const folder = hook.current.entries.find(item => item.name === 'Uploaded');
  const added = hook.current.entries.find(item => item.name === 'nested.txt');
  assert.equal(folder.kind, 'folder', 'uploading a directory does not depend on the new-folder command');
  assert.equal(added.parent, folder.id);
  assert.equal(added.source.file, nested);
});

test('hiding checkboxes retains multiple selection by Ctrl, Shift and Ctrl+A', async t => {
  const hook = await mountController(t, { selection: { mode: 'multiple', checkboxes: false } });
  assert.equal(hook.current.selectionOptions.checkboxes, false);
  await act(async () => { hook.current.selectEntry(byId(hook, 'alpha'), {}); });
  await act(async () => { hook.current.selectEntry(byId(hook, 'photo'), { ctrlKey: true }); });
  assert.deepEqual(hook.current.selected, ['alpha', 'photo']);
  await act(async () => { hook.current.selectEntry(byId(hook, 'alpha'), {}); });
  await act(async () => { hook.current.selectEntry(byId(hook, 'photo'), { shiftKey: true }); });
  assert.deepEqual(hook.current.selected, ['alpha', 'beta', 'photo']);
  await hook.key('a', { ctrlKey: true });
  assert.deepEqual(hook.current.selected, visibleIds(hook));
});

test('switching to single or none immediately restricts all selection paths without blocking folder opening', async t => {
  const hook = await mountController(t);
  await hook.key('a', { ctrlKey: true });
  await hook.update({ selection: { mode: 'single', checkboxes: false } });
  assert.deepEqual(hook.current.selected, ['target']);
  await act(async () => { hook.current.selectEntry(byId(hook, 'alpha'), { ctrlKey: true, shiftKey: true }); });
  await act(async () => { hook.current.selectEntry(byId(hook, 'beta'), { ctrlKey: true }); });
  assert.deepEqual(hook.current.selected, ['beta']);
  await act(async () => { hook.current.toggleSelect('photo'); });
  assert.deepEqual(hook.current.selected, ['photo']);
  await act(async () => { hook.current.toggleSelect('photo'); });
  assert.deepEqual(hook.current.selected, []);
  await act(async () => { hook.current.setSelected(['alpha', 'beta']); });
  await hook.key('a', { ctrlKey: true });
  assert.deepEqual(hook.current.selected, ['alpha']);

  await hook.update({ selection: { mode: 'none', checkboxes: true } });
  assert.deepEqual(hook.current.selectionOptions, { mode: 'none', checkboxes: false });
  assert.deepEqual(hook.current.selected, []);
  await act(async () => {
    hook.current.setSelected(['alpha', 'beta']);
    hook.current.toggleSelect('alpha');
    hook.current.selectEntry(byId(hook, 'beta'), { shiftKey: true, ctrlKey: true });
  });
  await hook.key('a', { ctrlKey: true });
  const row = { target: hook.element, currentTarget: hook.element, preventDefault() {}, stopPropagation() {} };
  await act(async () => { hook.current.rowKey({ ...row, key: 'ArrowDown' }, byId(hook, 'target')); });
  assert.equal(hook.effects.rowFocus, 1);
  assert.deepEqual(hook.current.selected, []);
  await act(async () => { hook.current.rowKey({ ...row, key: 'Enter' }, byId(hook, 'target')); });
  assert.equal(hook.current.location, 'target');
  assert.deepEqual(hook.current.selected, []);
});

test('live options remove search, sort, disallowed view and preview effects while retaining draft edits', async t => {
  const hook = await mountController(t);
  assert.equal(Object.hasOwn(hook.current, 'filter'), false);
  assert.equal(Object.hasOwn(hook.current, 'setFilter'), false);
  await act(async () => { hook.current.act('rename', ['beta'], { name: 'Zeta.txt' }); });
  await act(async () => {
    hook.current.setQuery('txt');
    hook.current.setSort({ key: 'size', asc: true });
    hook.current.changeView('content');
    hook.current.openEntry(byId(hook, 'alpha'));
    hook.current.setDetailId('alpha');
  });
  assert.deepEqual(visibleIds(hook), ['beta', 'alpha']);
  assert.equal(hook.current.preview.id, 'alpha');
  assert.equal(hook.current.details.id, 'alpha');
  assert.equal(hook.current.view, 'content');
  await hook.update({
    features: { search: false, sort: false, preview: false, details: false },
    view: { allowedModes: ['large'], defaultMode: 'large' },
  });
  assert.equal(hook.current.query, '');
  assert.deepEqual(hook.current.sort, { key: 'name', asc: true });
  assert.deepEqual(visibleIds(hook), ['target', 'alpha', 'photo', 'beta']);
  assert.equal(hook.current.view, 'large');
  assert.equal(hook.current.preview, undefined);
  assert.equal(hook.current.details, undefined);
  assert.equal(hook.current.dirty, true);
  assert.equal(byId(hook, 'beta').name, 'Zeta.txt');
  await act(async () => {
    hook.current.setQuery('missing');
    hook.current.sortBy('size');
    hook.current.changeView('details');
    hook.current.changeCompact(true);
    hook.current.openEntry(byId(hook, 'alpha'));
    hook.current.setPreviewId('photo');
  });
  assert.equal(hook.current.query, '');
  assert.deepEqual(hook.current.sort, { key: 'name', asc: true });
  assert.equal(hook.current.view, 'large');
  assert.equal(hook.current.compact, false);
  assert.equal(hook.current.preview, undefined);
  await act(async () => { hook.current.addTab(); });
  assert.equal(hook.current.view, 'large', 'new tabs use the currently allowed default');
});

test('disabled special locations, tabs and path input cannot be reentered through controller routes', async t => {
  const hook = await mountController(t);
  const first = hook.current.activeTabId;
  await act(async () => { hook.current.addTab(); });
  const active = hook.current.activeTabId;
  await act(async () => { hook.current.navigate(FAVORITES); });
  assert.deepEqual(visibleIds(hook), ['alpha']);
  await hook.update({ features: { favorites: false, recent: false, tabs: false, pathInput: false } });
  assert.equal(hook.current.location, 'root');
  assert.deepEqual(hook.current.tabs.map(tab => tab.id), [active]);
  await act(async () => {
    hook.current.navigate(FAVORITES);
    hook.current.navigate(RECENT);
    hook.current.navigatePath('/Target');
    hook.current.addTab();
    hook.current.selectTab(first);
    hook.current.closeTab(active);
  });
  assert.equal(hook.current.location, 'root');
  assert.equal(hook.current.activeTabId, active);
  assert.deepEqual(hook.current.tabs.map(tab => tab.id), [active]);
});

test('UI visibility settings do not disable commands, and save/discard remain available after features change', async t => {
  const saves = [];
  const hook = await mountController(t, {
    onSave: payload => { saves.push(payload); },
    ui: { sidebar: false, contextMenu: false, rowActions: false, thumbnails: false },
  });
  assert.ok(Object.values(hook.current.uiOptions).every(value => value === false));
  await act(async () => { assert.equal(hook.current.act('rename', ['alpha'], { name: 'Saved.txt' }), true); });
  await hook.update({ features: allFeatures(false) });
  await hook.key('s', { ctrlKey: true });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].entries.find(item => item.id === 'alpha').name, 'Saved.txt');
  assert.equal(hook.current.dirty, false);
  await hook.update({ features: { rename: true } });
  await act(async () => { hook.current.act('rename', ['alpha'], { name: 'Unsaved.txt' }); });
  await hook.update({ features: allFeatures(false) });
  await act(async () => { hook.current.showModal('discard'); });
  assert.equal(hook.current.modal.type, 'discard');
  await act(async () => { hook.current.submitModal(); });
  assert.equal(byId(hook, 'alpha').name, 'Saved.txt');
  assert.equal(hook.current.dirty, false);
  assert.equal(saves.length, 1);
});

test('preview defaults to the built-in viewer and double-click triggering when no callback is supplied', async t => {
  let reads = 0;
  const hook = await mountController(t, {
    readFile: async () => { reads++; return new Blob(['stored']); },
  });
  assert.equal(hook.current.previewTrigger, 'doubleClick');
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.equal(hook.current.preview.id, 'alpha');
  assert.equal(reads, 0, 'opening the controller viewer does not eagerly read content');
  assert.equal(hook.current.dirty, false);
  await hook.update({ previewTrigger: 'click' });
  assert.equal(hook.current.previewTrigger, 'click');
  await hook.update({ previewTrigger: undefined });
  assert.equal(hook.current.previewTrigger, 'doubleClick');
});

test('custom preview receives every file field, extension and root-relative path without reading or saving', async t => {
  const requests = [];
  let reads = 0;
  let saves = 0;
  const hook = await mountController(t, {
    rootLabel: 'ホストのストレージ',
    onPreviewRequest: async request => { requests.push(request); },
    readFile: async () => { reads++; return new Blob(['stored']); },
    onSave: () => { saves++; },
  });
  const file = byId(hook, 'alpha');
  await act(async () => { hook.current.openEntry(file); });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { ...file, kind: 'file', path: '/Alpha.txt', extension: 'txt' });
  assert.notEqual(requests[0], file);
  assert.notEqual(requests[0].source, file.source, 'the host receives its own source object');
  assert.equal(hook.current.preview, undefined);
  assert.equal(reads, 0);
  assert.equal(saves, 0);
  assert.equal(hook.current.dirty, false);
  await act(async () => { hook.current.openEntry(byId(hook, 'target')); });
  assert.equal(hook.current.location, 'target');
  assert.equal(requests.length, 1, 'folders only navigate');
});

test('preview extensions are lowercase without a dot and distinguish dotfiles from suffixes', async t => {
  const cases = [
    ['Report.XLSX', 'xlsx'],
    ['README', ''],
    ['.env', ''],
    ['.config.json', 'json'],
    ['archive.tar.gz', 'gz'],
  ];
  const requests = [];
  const hook = await mountController(t, {
    initialEntries: cases.map(([name], index) => entry(`extension-${index}`, name)),
    onPreviewRequest: request => { requests.push(request); },
  });
  for (let index = 0; index < cases.length; index++) {
    await act(async () => { hook.current.openEntry(byId(hook, `extension-${index}`)); });
    assert.equal(requests[index].extension, cases[index][1], cases[index][0]);
    assert.equal(requests[index].path, `/${cases[index][0]}`);
  }
});

test('preview uses the current unsaved hierarchy and name while retaining the original content ID', async t => {
  const requests = [];
  let saves = 0;
  const hook = await mountController(t, {
    initialEntries: [
      ...initialEntries(),
      { ...entry('nested', '設計稿', 0, 'folder', ''), parent: 'target' },
    ],
    rootLabel: '表示専用のルート名',
    onPreviewRequest: request => { requests.push(request); },
    onSave: () => { saves++; },
  });
  await act(async () => { hook.current.act('rename', ['target'], { name: '記事' }); });
  await act(async () => { hook.current.act('move', ['alpha'], { parent: 'nested' }); });
  await act(async () => { hook.current.act('rename', ['alpha'], { name: 'test.PDF' }); });
  await act(async () => { hook.current.navigate(FAVORITES); });
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.deepEqual(requests[0], {
    ...byId(hook, 'alpha'), path: '/記事/設計稿/test.PDF', extension: 'pdf',
  });
  assert.equal(requests[0].id, 'alpha');
  assert.deepEqual(requests[0].source, { kind: 'existing', id: 'content-alpha' });
  assert.equal(hook.current.dirty, true);
  assert.equal(saves, 0);
  assert.equal(hook.current.preview, undefined);
});

test('preview of an unsaved local upload preserves the File while reporting its draft location and name', async t => {
  const localFile = new File(['local content'], 'original.txt', { type: 'text/plain' });
  const requests = [];
  const hook = await mountController(t, {
    onPreviewRequest: request => { requests.push(request); },
    readFile: () => { throw new Error('A custom preview must not read the host storage'); },
  });
  await act(async () => { hook.current.addLocalFiles([localFile]); });
  const uploaded = hook.current.entries.find(item => item.source?.kind === 'local');
  await act(async () => { hook.current.act('move', [uploaded.id], { parent: 'target' }); });
  await act(async () => { hook.current.act('rename', [uploaded.id], { name: 'Renamed.TXT' }); });
  await act(async () => { hook.current.openEntry(byId(hook, uploaded.id)); });
  assert.deepEqual(requests[0], {
    ...byId(hook, uploaded.id), path: '/Target/Renamed.TXT', extension: 'txt',
  });
  assert.equal(requests[0].source.kind, 'local');
  assert.equal(requests[0].source.file, localFile);
  assert.notEqual(requests[0].source, byId(hook, uploaded.id).source);
  assert.equal(await requests[0].source.file.text(), 'local content');
  assert.equal(localFile.name, 'original.txt');
  assert.equal(hook.current.preview, undefined);
});

test('host attempts to rewrite preview payload fields and source cannot mutate the draft', async t => {
  const original = initialEntries();
  const hook = await mountController(t, {
    initialEntries: original,
    onPreviewRequest: request => {
      // Reflect.set tolerates either a frozen request or a mutable defensive copy.
      Reflect.set(request.source, 'id', 'host-replacement-content');
      Reflect.set(request, 'name', 'Host.txt');
      Reflect.set(request, 'parent', 'target');
      Reflect.set(request, 'favorite', 0);
      Reflect.set(request, 'source', null);
      Reflect.set(request, 'path', '/host-only');
    },
  });
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.deepEqual(hook.current.entries, original);
  assert.deepEqual(byId(hook, 'alpha').source, { kind: 'existing', id: 'content-alpha' });
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification, null);
});

test('preview feature changes guard callback, keyboard and row actions while folder navigation stays available', async t => {
  const requests = [];
  const hook = await mountController(t, {
    onPreviewRequest: request => { requests.push(request); },
  });
  const row = {
    target: hook.element, currentTarget: hook.element,
    preventDefault() {}, stopPropagation() {},
  };
  await act(async () => { hook.current.setSelected(['alpha']); });
  await hook.key('Enter');
  await hook.key(' ');
  for (const key of ['Enter', ' ']) {
    await act(async () => { hook.current.rowKey({ ...row, key }, byId(hook, 'alpha')); });
  }
  // The context and row menus use the same explicit openEntry route.
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.equal(requests.length, 5);
  assert.ok(requests.every(request => request.id === 'alpha'));
  assert.equal(hook.current.preview, undefined);
  await hook.update({ features: { preview: false } });
  await hook.key('Enter');
  await hook.key(' ');
  for (const key of ['Enter', ' ']) {
    await act(async () => { hook.current.rowKey({ ...row, key }, byId(hook, 'alpha')); });
  }
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.equal(requests.length, 5);
  assert.equal(hook.current.preview, undefined);
  await act(async () => { hook.current.openEntry(byId(hook, 'target')); });
  assert.equal(hook.current.location, 'target');
  assert.equal(requests.length, 5);
  await hook.update({ features: { preview: true } });
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  assert.equal(requests.length, 6);
});

test('changing or removing the preview callback takes effect on the next request', async t => {
  const first = [];
  const second = [];
  const hook = await mountController(t, {
    onPreviewRequest: request => { first.push(request); },
  });
  await act(async () => { hook.current.openEntry(byId(hook, 'alpha')); });
  await hook.update({
    previewTrigger: 'click',
    onPreviewRequest: request => { second.push(request); },
  });
  await act(async () => { hook.current.openEntry(byId(hook, 'beta')); });
  assert.deepEqual(first.map(request => request.id), ['alpha']);
  assert.deepEqual(second.map(request => request.id), ['beta']);
  assert.equal(hook.current.previewTrigger, 'click');
  assert.equal(hook.current.preview, undefined);
  await hook.update({ onPreviewRequest: undefined });
  await act(async () => { hook.current.openEntry(byId(hook, 'photo')); });
  assert.equal(hook.current.preview.id, 'photo');
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
});

test('synchronous and asynchronous preview callback failures become notifications without unhandled rejections', async t => {
  const hook = await mountController(t, {
    onPreviewRequest: () => { throw new Error('sync preview failure'); },
  });
  const original = hook.current.entries;
  await act(async () => {
    assert.doesNotThrow(() => { hook.current.openEntry(byId(hook, 'alpha')); });
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(hook.current.notification.kind, 'error');
  assert.match(JSON.stringify(hook.current.notification), /sync preview failure/);
  assert.equal(hook.current.preview, undefined);
  await hook.update({
    onPreviewRequest: async () => {
      await Promise.resolve();
      throw new Error('async preview failure');
    },
  });
  await act(async () => {
    // UI event handlers do not await this call; the controller must catch rejection.
    hook.current.openEntry(byId(hook, 'alpha'));
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(hook.current.notification.kind, 'error');
  assert.match(JSON.stringify(hook.current.notification), /async preview failure/);
  assert.equal(hook.current.preview, undefined);
  assert.deepEqual(hook.current.entries, original);
  assert.equal(hook.current.dirty, false);
});

test('download disabled prevents content reads, including when preview remains enabled', async t => {
  let reads = 0;
  const hook = await mountController(t, {
    features: { download: false, preview: true },
    readFile: async () => { reads++; return new Blob(['stored']); },
  });
  await act(async () => {
    hook.current.openEntry(byId(hook, 'alpha'));
    await hook.current.download(byId(hook, 'alpha'));
  });
  assert.equal(hook.current.preview.id, 'alpha');
  assert.equal(reads, 0);
  assert.equal(hook.effects.anchors, 0);
});

test('disabling download during an in-flight content read prevents the later browser download', async t => {
  let resolveRead;
  let reads = 0;
  const content = new Promise(resolve => { resolveRead = resolve; });
  const hook = await mountController(t, {
    readFile: () => { reads++; return content; },
  });
  const createURL = t.mock.method(URL, 'createObjectURL', () => { throw new Error('Unexpected download URL'); });
  const pending = hook.current.download(byId(hook, 'alpha'));
  assert.equal(reads, 1);
  await hook.update({ features: { download: false } });
  await act(async () => {
    resolveRead(new Blob(['stored']));
    await pending;
  });
  assert.equal(createURL.mock.callCount(), 0);
  assert.equal(hook.effects.anchors, 0);
  assert.equal(hook.current.notification, null);
});

test('moving into the current parent clears the drop highlight and leaves draft and notification unchanged', async t => {
  const hook = await mountController(t);
  const before = { entries: hook.current.entries, dirty: hook.current.dirty, notification: hook.current.notification };
  const drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'alpha')); });
  await hoverWithProtectedData(hook, drag, 'target');
  assert.equal(hook.current.dragOver, 'target');
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, null);
  assert.equal(drag.dataTransfer.dropEffect, 'none');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.deepEqual(hook.current.entries, before.entries);
  assert.equal(hook.current.dirty, before.dirty);
  assert.equal(hook.current.notification, before.notification);
});

test('dragging without selection still rejects the current parent and allows a different parent', async t => {
  const hook = await mountController(t, { selection: { mode: 'none' } });
  const drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'alpha')); });
  assert.deepEqual(hook.current.selected, []);
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, null);
  assert.equal(drag.dataTransfer.dropEffect, 'none');
  await hoverWithProtectedData(hook, drag, 'target');
  assert.equal(hook.current.dragOver, 'target');
  assert.equal(drag.dataTransfer.dropEffect, 'move');
  await act(async () => { hook.current.drop(drag, 'target'); });
  assert.equal(byId(hook, 'alpha').parent, 'target');
  assert.equal(hook.current.entries.length, 4);
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.notification.kind, 'success');
  assert.equal(hook.current.notification.message, '移動しました');
  assert.equal(hook.current.dragOver, null);
});

test('Ctrl-drag into the current parent still highlights the destination and creates a copy', async t => {
  const hook = await mountController(t);
  const original = byId(hook, 'alpha');
  const drag = dragEvent({ ctrlKey: true });
  await act(async () => { hook.current.startDrag(drag, original); });
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, 'root');
  assert.equal(drag.dataTransfer.dropEffect, 'copy');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.deepEqual(byId(hook, 'alpha'), original);
  const copy = hook.current.entries.find(item => item.name === 'Alpha (2).txt');
  assert.ok(copy);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.parent, 'root');
  assert.deepEqual(copy.source, original.source);
  assert.equal(hook.current.entries.length, 5);
  assert.equal(hook.current.notification.message, 'コピーしました');
});

test('multiple selection rejects unchanged roots but allows moves with a root from another parent', async t => {
  const entries = initialEntries().map(item => item.id === 'beta' ? { ...item, parent: 'target' } : item);
  const hook = await mountController(t, { initialEntries: entries });
  // Siblings already in the destination have nothing to move.
  await act(async () => { hook.current.setSelected(['alpha', 'photo']); });
  let drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'alpha')); });
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, null);
  assert.equal(drag.dataTransfer.dropEffect, 'none');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification, null);

  // A selected descendant travels with its parent, so it does not make this a real move.
  await act(async () => { hook.current.setQuery('t'); });
  await act(async () => { hook.current.setSelected(['target', 'beta']); });
  assert.deepEqual(hook.current.selected, ['target', 'beta']);
  drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'target')); });
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, null);
  assert.equal(drag.dataTransfer.dropEffect, 'none');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.deepEqual(hook.current.entries, entries);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.notification, null);

  // Unrelated selected files can have different parents in search results.
  await act(async () => { hook.current.setSelected(['alpha', 'beta']); });
  drag = dragEvent();
  await act(async () => { hook.current.startDrag(drag, byId(hook, 'alpha')); });
  await hoverWithProtectedData(hook, drag, 'root');
  assert.equal(hook.current.dragOver, 'root');
  assert.equal(drag.dataTransfer.dropEffect, 'move');
  await act(async () => { hook.current.drop(drag, 'root'); });
  assert.equal(byId(hook, 'alpha').parent, 'root');
  assert.equal(byId(hook, 'beta').parent, 'root');
  assert.equal(hook.current.entries.length, 4);
  assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.notification.message, '移動しました');
});

import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
    export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
    export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    export { resolveExplorerOptions } from './src/model/config.ts';
    export { FAVORITES } from './src/state/view-state.ts';
    export { default as Explorer } from './src/explorer.tsx';
  `, resolveDir: packageRoot, sourcefile: 'explorer-readonly-contract.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-with-transparent-menu-primitives', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'readonly-test' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'readonly-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'readonly-test' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
      ? 'export const createPortal = children => children;'
      : `import { createElement, cloneElement, isValidElement } from 'react';
        function family(kind) {
          return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
            'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
            ({ children, open, asChild, ...props }) => {
              if (part === 'Root' && ['dialog', 'alert'].includes(kind) && open === false) return null;
              if (['Root', 'Provider', 'Portal'].includes(part)) return children;
              if (asChild && isValidElement(children)) return cloneElement(children, props);
              return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
            }
          ]));
        }
        export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
          Dialog = family('dialog'), AlertDialog = family('alert');`,
    }));
  } }],
});
const { useExplorerDraft, useExplorerWorkspace, useExplorerViewController, resolveExplorerOptions, FAVORITES, Explorer } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-readonly-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const readonlyError = /読み取り専用のため変更できません/;
const entry = (id, name, kind = 'file') => ({ id, parent: 'root', name, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: id === 'alpha' ? 1 : 0 });
const initialEntries = () => [entry('folder', '資料', 'folder'), entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt')];
const file = () => new File(['local'], 'local.txt');
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

async function mount(t, supplied = {}, kind = 'draft') {
  let latest, renderer;
  const events = [], saves = [], dirty = [];
  let props = { initialEntries: initialEntries(), onEvent: event => { if (event.type !== 'edit-mode') events.push(event); }, onDirtyChange: value => dirty.push(value), ...supplied };
  function Views({ options }) {
    const workspace = useExplorerWorkspace(options);
    const main = useExplorerViewController(options, workspace, 'main', null);
    const child = useExplorerViewController(options, workspace, 'child', null);
    useLayoutEffect(() => { const child = workspace.tabs.forWindow('child'); if (!child.tabs.length) child.addTab(); }, [workspace.tabs]);
    latest = { workspace, main, child };
    return null;
  }
  function Draft({ options }) { latest = useExplorerDraft(options); return null; }
  const tree = () => h(StrictMode, null, kind === 'ui' ? h(Explorer, props) : h(kind === 'draft' ? Draft : Views, { options: props }));
  await change(() => { renderer = create(tree()); });
  events.length = 0;
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return latest; }, get root() { return renderer.root; }, events, saves, dirty,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); } };
}

test('omitting onSave makes the hook read-only even when readOnly is explicitly false', async t => {
  for (const readOnly of [undefined, false, true]) await t.test(String(readOnly), async subtest => {
    const hook = await mount(subtest, { readOnly });
    assert.equal(hook.current.readOnly, true);
    const before = hook.current.entries;
    await change(() => {
      assert.throws(() => hook.current.apply({ action: 'rename', ids: ['alpha'], name: 'Changed.txt' }), readonlyError);
      assert.throws(() => hook.current.add([file()], 'root'), readonlyError);
      assert.throws(() => hook.current.discard(), readonlyError);
    });
    await change(async () => assert.equal(await hook.current.save(), false));
    assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
    assert.deepEqual(hook.events, []); assert.ok(hook.dirty.every(value => value === false));
  });
});

test('explicit read-only overrides an available save handler and every model mutation', async t => {
  let calls = 0;
  const hook = await mount(t, { readOnly: true, onSave() { calls++; } });
  for (const action of ['create', 'rename', 'move', 'copy', 'delete', 'favorite']) {
    await change(() => assert.throws(() => hook.current.apply({ action, ids: ['alpha'], name: 'New', parent: 'folder' }), readonlyError));
  }
  await change(async () => assert.equal(await hook.current.save(), false));
  assert.equal(calls, 0); assert.deepEqual(hook.events, []);
});

test('retained mutation callbacks use the latest policy and resume only when both permissions permit editing', async t => {
  const hook = await mount(t, { onSave() {} });
  const { apply, add, discard, save } = hook.current;
  await change(() => apply({ action: 'rename', ids: ['alpha'], name: 'Changed.txt' }));
  const before = hook.current.entries;
  await hook.update({ readOnly: true });
  await change(() => {
    assert.throws(() => apply({ action: 'delete', ids: ['alpha'] }), readonlyError);
    assert.throws(() => add([file()], 'root'), readonlyError);
    assert.throws(() => discard(), readonlyError);
  });
  const eventCount = hook.events.length;
  await change(async () => assert.equal(await save(), false));
  assert.equal(hook.events.length, eventCount); assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true);
  await hook.update({ readOnly: false, onSave: undefined });
  await change(() => assert.throws(() => add([file()], 'root'), readonlyError));
  let saved = 0;
  await hook.update({ onSave() { saved++; } });
  assert.equal(hook.current.readOnly, false);
  await change(() => add([file()], 'root'));
  await change(async () => assert.equal(await save(), true));
  assert.equal(saved, 1); assert.equal(hook.current.dirty, false);
});

test('read-only transitions preserve an existing dirty draft and save error until an authorized operation clears them', async t => {
  const hook = await mount(t, { onSave() { throw Error('Storage unavailable'); } });
  await change(() => hook.current.add([file()], 'root'));
  await change(() => hook.current.save());
  const before = hook.current.entries;
  const eventCount = hook.events.length;
  await hook.update({ readOnly: true });
  await hook.update({ onSave: undefined, readOnly: false });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.saveError, 'Storage unavailable'); assert.equal(hook.events.length, eventCount);
  await hook.update({ onSave() {} });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.saveError, 'Storage unavailable');
  await change(() => hook.current.discard());
  assert.equal(hook.current.dirty, false); assert.equal(hook.current.saveError, null);
});

test('save uses the latest host handler while an already-started save may finish after read-only is enabled', async t => {
  const pending = deferred();
  const calls = [];
  const hook = await mount(t, { onSave() { calls.push('old'); } });
  const save = hook.current.save;
  await change(() => hook.current.add([file()], 'root'));
  await hook.update({ onSave() { calls.push('new'); return pending.promise; } });
  let completion;
  await change(() => { completion = save(); });
  assert.deepEqual(calls, ['new']); assert.equal(hook.current.saving, true);
  await hook.update({ readOnly: true, onSave: undefined });
  await change(async () => assert.equal(await save(), false));
  const persisted = hook.current.entries.map(item => ({ ...item, name: item.id === 'alpha' ? 'Server.txt' : item.name }));
  await change(async () => { pending.resolve(persisted); assert.equal(await completion, true); });
  assert.equal(hook.current.readOnly, true); assert.equal(hook.current.saving, false); assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.entries.find(item => item.id === 'alpha').name, 'Server.txt');
  assert.deepEqual(hook.events.filter(event => event.type === 'save').map(event => event.status), ['start', 'success']);
});

test('a save failure that arrives after read-only is enabled preserves the unsaved draft and its error', async t => {
  const pending = deferred();
  const hook = await mount(t, { onSave: () => pending.promise });
  await change(() => hook.current.add([file()], 'root'));
  const before = hook.current.entries;
  let completion;
  await change(() => { completion = hook.current.save(); });
  await hook.update({ readOnly: true });
  await change(async () => { pending.reject(Error('Failed after transition')); assert.equal(await completion, false); });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.saveError, 'Failed after transition');
});

test('read-only options override the eight writing features while retaining viewing and favorites visibility', () => {
  const writing = ['createFile', 'createFolder', 'uploadFiles', 'uploadFolders', 'copy', 'move', 'rename', 'delete'];
  const supplied = Object.freeze(Object.fromEntries(writing.map(name => [name, true])));
  const options = resolveExplorerOptions({ readOnly: true, features: supplied });
  assert.equal(options.readOnly, true);
  for (const name of writing) assert.equal(options.features[name], false, name);
  for (const name of ['favorites', 'recent', 'preview', 'download', 'details', 'search', 'sort', 'tabs', 'detachTabs', 'pathInput', 'resizeSidebar']) {
    assert.equal(options.features[name], true, name);
  }
  assert.ok(Object.values(supplied).every(Boolean));
  assert.equal(resolveExplorerOptions().readOnly, false);
  assert.equal(resolveExplorerOptions({ readOnly: true, features: { favorites: false } }).features.favorites, false);
});

test('read-only controllers keep selection, navigation, tabs, previews and details while suppressing mutation routes in both panes', async t => {
  const previews = [];
  const hook = await mount(t, { onPreview: value => previews.push(value) }, 'views');
  const { main, child } = hook.current;
  assert.equal(main.readOnly, true); assert.equal(child.readOnly, true);
  assert.equal(main.canEditFavorites, false); assert.equal(main.features.favorites, true);
  assert.equal(main.canDrag, false); assert.equal(main.canPaste, false);
  const before = main.entries;
  await change(() => hook.current.main.setSelected(['alpha', 'beta']));
  assert.deepEqual(hook.current.main.selected, ['alpha', 'beta']);
  await change(() => hook.current.child.navigate(FAVORITES));
  assert.deepEqual(hook.current.child.visible.map(item => item.id), ['alpha']);
  for (const action of ['create', 'rename', 'copy', 'move', 'delete', 'favorite']) {
    await change(() => assert.equal(hook.current.main.act(action, ['alpha'], { name: 'Changed.txt', parent: 'folder' }), false));
  }
  for (const type of ['create', 'copy', 'move', 'delete', 'discard']) {
    await change(() => hook.current.main.showModal(type, ['alpha']));
    assert.equal(hook.current.main.modal, null);
  }
  await change(() => hook.current.main.startRename(['alpha']));
  assert.equal(hook.current.main.renamingEntryId, null);
  await change(() => hook.current.main.copyToClipboard('copy', ['alpha']));
  await change(() => hook.current.main.addLocalFiles([file()]));
  await change(() => hook.current.main.paste());
  await change(() => hook.current.main.saveChanges());
  assert.equal(hook.current.main.entries, before); assert.equal(hook.current.main.clipboard, null);
  assert.equal(hook.current.child.entries, before);
  await change(() => hook.current.main.navigate('folder'));
  assert.equal(hook.current.main.currentParent, 'folder');
  const count = hook.current.workspace.tabs.forWindow('main').tabs.length;
  await change(() => hook.current.workspace.tabs.forWindow('main').addTab());
  assert.equal(hook.current.workspace.tabs.forWindow('main').tabs.length, count + 1);
  await change(() => hook.current.main.setPreviewId('alpha'));
  assert.equal(hook.current.main.preview.id, 'alpha');
  await change(() => hook.current.main.setDetailId('alpha'));
  assert.equal(hook.current.main.details.id, 'alpha');
  assert.equal(hook.events.some(event => ['change', 'save', 'upload', 'clipboard'].includes(event.type)), false);
});

test('read-only transitions cancel pending UI edits and clear shared clipboard and drag state without changing the draft', async t => {
  const hook = await mount(t, { onSave() {} }, 'views');
  await change(() => hook.current.main.act('rename', ['alpha'], { name: 'Dirty.txt' }));
  await change(() => hook.current.main.startRename(['alpha']));
  await change(() => hook.current.child.showModal('delete', ['beta']));
  await change(() => hook.current.main.copyToClipboard('move', ['alpha']));
  hook.current.workspace.draggedIds.current = ['alpha'];
  const before = hook.current.main.entries;
  assert.equal(hook.current.main.renamingEntryId, 'alpha'); assert.equal(hook.current.child.modal.type, 'delete');
  await hook.update({ readOnly: true });
  assert.equal(hook.current.main.renamingEntryId, null); assert.equal(hook.current.child.modal, null);
  assert.equal(hook.current.workspace.clipboard, null); assert.equal(hook.current.workspace.draggedIds.current, null);
  assert.equal(hook.current.main.entries, before); assert.equal(hook.current.child.entries, before); assert.equal(hook.current.main.dirty, true);
  await hook.update({ readOnly: false });
  assert.equal(hook.current.main.renamingEntryId, null); assert.equal(hook.current.child.modal, null);
  assert.equal(hook.current.main.clipboard, null); assert.equal(hook.current.main.canPaste, false);
});

function textOf(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('');
  return value?.children ? textOf(value.children) : '';
}
const renderedText = hook => hook.root.findAll(node => typeof node.type === 'string').map(node => textOf(node)).join('\n');

test('the complete read-only Explorer hides editing buttons, menus and upload inputs but keeps reading controls and favorite state', async t => {
  const hook = await mount(t, {}, 'ui');
  const text = renderedText(hook);
  assert.match(text, /読み取り専用/); assert.match(text, /お気に入り/); assert.match(text, /ダウンロード/);
  for (const label of ['切り取り', 'コピー先を選択', '名前を変更', 'お気に入りから外す', 'お気に入りに追加', '変更を破棄', 'フォルダを追加', 'ファイルを追加']) {
    assert.equal(text.includes(label), false, label);
  }
  assert.equal(hook.root.findAll(node => node.type === 'input' && node.props.type === 'file').length, 0);
  assert.equal(hook.root.findAll(node => node.type === 'button' && textOf(node) === '保存').length, 0);
  assert.ok(hook.root.findAll(node => node.props.role === 'tab').length >= 1);
  assert.ok(hook.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox').length > 0);
  const favoriteButtons = hook.root.findAll(node => typeof node.type === 'string' && /お気に入り.*(?:切り替え|追加|外す)/.test(node.props['aria-label'] ?? ''));
  assert.equal(favoriteButtons.length, 0);
  await hook.update({ onSave() {}, readOnly: false });
  assert.ok(hook.root.findAll(node => node.type === 'input' && node.props.type === 'file').length > 0);
  assert.ok(hook.root.findAll(node => node.type === 'button' && textOf(node) === '保存').length > 0);
});

test('every read-only view retains a static favorite marker without editable favorite controls or forced checkbox space', async t => {
  for (const mode of ['extra-large', 'large', 'medium', 'small', 'list', 'details', 'tiles', 'content']) {
    await t.test(mode, async subtest => {
      const hook = await mount(subtest, { selection: { checkboxes: false }, view: { defaultMode: mode } }, 'ui');
      const stars = hook.root.findAll(node => node.type === 'svg' && node.props['aria-label'] === 'お気に入り登録済み');
      assert.ok(stars.length > 0);
      assert.ok(stars.every(node => node.props.role === 'img'));
      const buttons = hook.root.findAll(node => node.type === 'button' && /お気に入り.*(?:切り替え|追加|外す)/.test(node.props['aria-label'] ?? ''));
      assert.equal(buttons.length, 0);
      assert.equal(hook.root.findAll(node => node.type === 'input' && node.props.type === 'checkbox').length, 0);
    });
  }
});

test('child layout effects cannot use retained hook callbacks to edit during the commit that enables read-only', async t => {
  for (const policy of ['explicit', 'missing-save']) await t.test(policy, async subtest => {
  let latest, retained, renderer;
  const errors = [], saved = [], events = [], saveResults = [];
  function Child({ readOnly }) {
    useLayoutEffect(() => {
      if (!readOnly) return;
      for (const run of [
        () => retained.apply({ action: 'rename', ids: ['alpha'], name: 'Illegal.txt' }),
        () => retained.add([file()], 'root'),
        () => retained.discard(),
      ]) {
        try { run(); } catch (error) { errors.push(error); }
      }
      void retained.save().then(result => saveResults.push(result));
    }, [readOnly]);
    return null;
  }
  function Parent({ readOnly }) {
    latest = useExplorerDraft({ initialEntries: initialEntries(), readOnly: policy === 'explicit' && readOnly,
      onSave: policy === 'missing-save' && readOnly ? undefined : payload => { saved.push(payload); }, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); } });
    retained ??= latest;
    return h(Child, { readOnly });
  }
  const tree = readOnly => h(StrictMode, null, h(Parent, { readOnly }));
  await change(() => { renderer = create(tree(false)); });
  subtest.after(() => change(() => renderer.unmount()));
  await change(() => latest.apply({ action: 'rename', ids: ['alpha'], name: 'AlreadyDirty.txt' }));
  const before = latest.entries, beforeEvents = events.length;
  await change(() => renderer.update(tree(true)));
  assert.equal(errors.length, 3); assert.ok(errors.every(error => readonlyError.test(error.message)));
  assert.deepEqual(saveResults, [false]); assert.deepEqual(saved, []);
  assert.equal(latest.entries, before); assert.equal(latest.dirty, true); assert.equal(events.length, beforeEvents);
  });
});

test('retained save invoked in a child layout effect uses the new host callback from that commit', async t => {
  let latest, retained, renderer;
  const calls = [], results = [];
  function Child({ version }) {
    useLayoutEffect(() => { if (version) void retained.save().then(value => results.push(value)); }, [version]);
    return null;
  }
  function Parent({ version }) {
    latest = useExplorerDraft({ initialEntries: initialEntries(), onSave() { calls.push(version); } });
    retained ??= latest;
    return h(Child, { version });
  }
  const tree = version => h(StrictMode, null, h(Parent, { version }));
  await change(() => { renderer = create(tree(0)); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => latest.add([file()], 'root'));
  await change(() => renderer.update(tree(1)));
  assert.deepEqual(calls, [1]); assert.deepEqual(results, [true]); assert.equal(latest.dirty, false);
});

test('an uncommitted suspended render does not leak its read-only policy into the still-visible editable draft', async t => {
  let renderer, setReadOnly, retained;
  const never = new Promise(() => {}), attempts = [], events = [];
  function Child({ readOnly, entries }) {
    if (readOnly) { attempts.push(true); throw never; }
    return h('span', { 'data-committed-readonly': false }, entries.length);
  }
  function Parent() {
    const [readOnly, updateReadOnly] = useState(false);
    setReadOnly = updateReadOnly;
    const draft = useExplorerDraft({ initialEntries: initialEntries(), readOnly, onSave() {}, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); } });
    retained ??= draft;
    return h(Child, { readOnly, entries: draft.entries });
  }
  await change(() => { renderer = create(h(StrictMode, null, h(Suspense, { fallback: h('i', null, 'Loading') }, h(Parent)))); });
  t.after(() => change(() => renderer.unmount()));
  await change(() => startTransition(() => setReadOnly(true)));
  assert.ok(attempts.length > 0, 'the prospective read-only render was attempted');
  assert.equal(renderer.root.findByType('span').props['data-committed-readonly'], false);
  await change(() => retained.apply({ action: 'rename', ids: ['alpha'], name: 'StillEditable.txt' }));
  assert.equal(events.filter(event => event.type === 'change').length, 1);
  assert.equal(renderer.root.findByType('span').props['data-committed-readonly'], false);
});

test('an uncommitted editable render cannot enable retained clipboard actions in the visible read-only controller', async t => {
  let renderer, setReadOnly, retained, workspace;
  const never = new Promise(() => {}), attempts = [], events = [], writes = [];
  const ownerDocument = { addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [],
    defaultView: { navigator: { clipboard: { writeText: async value => { writes.push(value); } } } } };
  function Child({ readOnly }) {
    if (!readOnly) { attempts.push(true); throw never; }
    return h('span', { 'data-committed-readonly': true }, 'Read only');
  }
  function Parent() {
    const [readOnly, updateReadOnly] = useState(true);
    setReadOnly = updateReadOnly;
    const props = { initialEntries: initialEntries(), readOnly, onSave() {}, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); } };
    workspace = useExplorerWorkspace(props);
    const controller = useExplorerViewController(props, workspace, 'main', ownerDocument);
    retained ??= controller;
    return h(Child, { readOnly });
  }
  await change(() => { renderer = create(h(StrictMode, null, h(Suspense, { fallback: h('i', null, 'Loading') }, h(Parent)))); });
  t.after(() => change(() => renderer.unmount()));
  events.length = 0;
  await change(() => startTransition(() => setReadOnly(false)));
  assert.ok(attempts.length > 0);
  assert.equal(renderer.root.findByType('span').props['data-committed-readonly'], true);
  await change(() => retained.copyToClipboard('copy', ['alpha']));
  await change(() => retained.copyToClipboard('move', ['alpha']));
  assert.equal(workspace.clipboard, null); assert.deepEqual(writes, []);
  assert.equal(events.filter(event => event.type === 'clipboard' || event.type === 'change').length, 0);
});

import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `export { default as Explorer } from './src/explorer.tsx';
    export { useExplorerController } from './src/state/use-explorer-controller.ts';
    export { ExplorerProvider } from './src/state/explorer-context.tsx';
    export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
    export { ExplorerBackgroundMenu } from './src/ui/explorer-background-menu.tsx';`, resolveDir: packageRoot },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'transparent-menu-primitives', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'menu-order' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'menu-order' }));
    builder.onLoad({ filter: /.*/, namespace: 'menu-order' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
      ? 'export const createPortal = children => children;'
      : `import { createElement, cloneElement, isValidElement } from 'react';
        function family(kind) {
          return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
            'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
            ({ children, asChild, ...props }) => {
              if (part === 'Root' && ['dialog', 'alert'].includes(kind) && props.open === false) return null;
              if (['Provider', 'Portal'].includes(part)) return children;
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
const { Explorer, useExplorerController, ExplorerProvider, ExplorerSidebar, ExplorerBackgroundMenu } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const file = { id: 'alpha', parent: 'root', name: 'Alpha.txt', kind: 'file', size: 4, mime: 'text/plain',
  source: { kind: 'existing', id: 'alpha' }, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', favorite: 0 };
const customItems = [
  { id: 'first', label: 'AIに指示', onSelect() {} },
  { id: 'second', label: '外部サービスを開く', onSelect() {} },
];
const noEntryBuiltins = Object.fromEntries(['preview', 'details', 'copy', 'move', 'rename', 'favorites', 'download', 'delete'].map(key => [key, false]));
const tokens = menu => menu.findAll(node => ['mock-context-item', 'mock-context-separator'].includes(node.type))
  .map(node => node.type === 'mock-context-separator' ? '|' : node.children.filter(child => typeof child === 'string').join(''));

async function mount(t, supplied = {}) {
  let renderer;
  await act(async () => { renderer = create(h(Explorer, {
    initialEntries: [file], onSave() {}, ui: { rowActions: false }, getContextMenuItems: () => customItems, ...supplied,
  })); });
  t.after(() => act(() => renderer.unmount()));
  const entryRoot = renderer.root.findAllByType('mock-context-root').find(node => {
    const content = node.findAllByType('mock-context-content');
    return content.length === 1 && !content[0].props['data-explorer-background-menu'];
  });
  assert.ok(entryRoot, 'the file has a context menu');
  await act(async () => entryRoot.props.onOpenChange(true));
  return { renderer, entryRoot, menu: entryRoot.findByType('mock-context-content') };
}

test('custom entry actions retain provider order immediately above the delete group', async t => {
  const view = await mount(t);
  assert.deepEqual(tokens(view.menu), [
    '開く', '詳細を表示', '|', 'コピー', '切り取り', '移動先を選択', 'コピー先を選択', '名前を変更',
    'お気に入りに追加', 'ダウンロード', '|', 'AIに指示', '外部サービスを開く', '|', '削除',
  ]);
});

test('disabled deletion and read-only entry menus end with custom actions and no trailing separator', async t => {
  for (const options of [{ features: { delete: false } }, { readOnly: true }]) {
    await t.test(JSON.stringify(options), async subtest => {
      const view = await mount(subtest, options);
      const labels = tokens(view.menu);
      assert.equal(labels.includes('削除'), false);
      assert.deepEqual(labels.slice(-3), ['|', 'AIに指示', '外部サービスを開く']);
    });
  }
});

test('custom-only menus have no separators and custom plus delete menus have one', async t => {
  for (const allowDelete of [false, true]) await t.test(String(allowDelete), async subtest => {
    const view = await mount(subtest, { features: { ...noEntryBuiltins, delete: allowDelete } });
    assert.deepEqual(tokens(view.menu), ['AIに指示', '外部サービスを開く', ...(allowDelete ? ['|', '削除'] : [])]);
  });
});

test('empty custom providers preserve built-in groups without a blank menu group', async t => {
  const view = await mount(t, { getContextMenuItems: () => [], features: { ...noEntryBuiltins, preview: true, delete: true } });
  assert.deepEqual(tokens(view.menu), ['開く', '|', '削除']);
});

test('background custom actions remain after create and upload groups', async t => {
  const view = await mount(t);
  const backgroundRoot = view.renderer.root.findAllByType('mock-context-root').find(node =>
    node.findAllByType('mock-context-content').some(content => content.props['data-explorer-background-menu']));
  await act(async () => backgroundRoot.props.onOpenChange(true));
  const menu = backgroundRoot.findAllByType('mock-context-content').find(content => content.props['data-explorer-background-menu']);
  assert.deepEqual(tokens(menu), [
    '新しいファイル', '新しいフォルダ', '|', 'ファイルをアップロード', 'フォルダをアップロード', '|', '貼り付け', '|', 'AIに指示', '外部サービスを開く',
  ]);
});


async function mountSurfaces(t, supplied = {}) {
  const folder = { ...file, id: 'folder', name: '資料', kind: 'folder', mime: '', size: 0, source: null };
  let current, renderer, props = { initialEntries: [file, folder], onSave() {}, ...supplied };
  function Probe() {
    current = useExplorerController(props);
    return h(ExplorerProvider, { value: current }, h(ExplorerSidebar),
      h(ExplorerBackgroundMenu, null, h('div', { 'data-test-background': true })));
  }
  await act(async () => { renderer = create(h(Probe)); });
  t.after(() => act(() => renderer.unmount()));
  const menuRoot = predicate => renderer.root.findAllByType('mock-context-root').find(predicate);
  return { renderer, get current() { return current; },
    background: () => menuRoot(node => node.findAllByType('mock-context-content').some(content => content.props['data-explorer-background-menu'])),
    folder: () => menuRoot(node => node.findAll(node => node.type === 'div' && node.props['data-explorer-tree-entry'] === 'folder').length > 0),
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(h(Probe))); },
  };
}
const item = (menu, label) => menu.findAllByType('mock-context-item').find(node =>
  node.children.filter(child => typeof child === 'string').join('') === label);

test('background paste works with move enabled and copy/create/upload disabled, preserving the opened destination', async t => {
  const view = await mountSurfaces(t, { features: { copy: false, createFile: false, createFolder: false, uploadFiles: false, uploadFolders: false } });
  assert.deepEqual(tokens(view.background()), ['貼り付け']);
  assert.equal(item(view.background(), '貼り付け').props.disabled, true);
  await act(async () => view.current.copyToClipboard('move', ['alpha']));
  await act(async () => view.current.navigate('folder'));
  await act(async () => view.background().props.onOpenChange(true));
  const paste = item(view.background(), '貼り付け').props.onSelect;
  assert.equal(item(view.background(), '貼り付け').props.disabled, false);
  await act(async () => view.current.navigate('root'));
  await act(async () => paste());
  assert.equal(view.current.entries.find(entry => entry.id === 'alpha').parent, 'folder');
  assert.equal(view.current.clipboard, null);
});

test('a removed paste destination does not redirect to the current folder', async t => {
  const view = await mountSurfaces(t);
  await act(async () => view.current.copyToClipboard('copy', ['alpha']));
  await act(async () => view.current.navigate('folder'));
  await act(async () => view.background().props.onOpenChange(true));
  const paste = item(view.background(), '貼り付け').props.onSelect;
  await act(async () => view.current.navigate('root'));
  await act(async () => view.current.act('delete', ['folder']));
  await act(async () => paste());
  assert.deepEqual(view.current.entries.map(entry => entry.id), ['alpha']);
});

test('sidebar builtins and custom menus target only the clicked folder and rename within the tree', async t => {
  const contexts = [];
  const view = await mountSurfaces(t, { getContextMenuItems: context => { contexts.push(context); return customItems; } });
  await act(async () => view.current.setSelected(['alpha', 'folder']));
  await act(async () => view.folder().props.onOpenChange(true));
  assert.deepEqual(contexts.at(-1).selectedEntries.map(entry => entry.id), ['folder']);
  await act(async () => item(view.folder(), 'コピー').props.onSelect());
  assert.deepEqual(view.current.clipboard.ids, ['folder']);
  await act(async () => view.current.navigate('folder'));
  await act(async () => view.folder().props.onOpenChange(true));
  await act(async () => item(view.folder(), '名前を変更').props.onSelect());
  assert.equal(view.current.renameSource, 'tree');
  const input = view.renderer.root.findAllByType('input').find(node => node.props['data-explorer-rename-input'] === 'folder');
  assert.ok(input, 'a folder outside the current listing remains editable in the sidebar');
  await act(async () => input.props.onChange({ target: { value: '改名した資料' } }));
  await act(async () => input.props.onBlur());
  assert.equal(view.current.entries.find(entry => entry.id === 'folder').name, '改名した資料');
  assert.equal(view.current.location, 'folder');
});

test('sidebar rename and background paste honor current edit permissions and hidden features', async t => {
  const view = await mountSurfaces(t, { onEditRequest: () => false });
  await act(async () => view.folder().props.onOpenChange(true));
  await act(async () => item(view.folder(), '名前を変更').props.onSelect());
  await act(async () => view.current.setRenameValue('禁止された変更'));
  await act(async () => assert.equal(await view.current.commitRename('folder'), false));
  assert.equal(view.current.entries.find(entry => entry.id === 'folder').name, '資料');
  await act(async () => view.current.cancelRename());
  await act(async () => view.current.copyToClipboard('move', ['alpha']));
  await act(async () => view.current.navigate('folder'));
  await act(async () => view.background().props.onOpenChange(true));
  await act(async () => item(view.background(), '貼り付け').props.onSelect());
  assert.equal(view.current.entries.find(entry => entry.id === 'alpha').parent, 'root');
  await view.update({ readOnly: true });
  assert.equal(item(view.folder(), '名前を変更'), undefined);
  assert.equal(view.background(), undefined);
});

test('editable controls and selected text retain native context actions on both surfaces', async t => {
  const view = await mountSurfaces(t);
  const targets = [view.renderer.root.find(node => node.type === 'div' && node.props['data-test-background']),
    view.renderer.root.find(node => node.type === 'div' && node.props['data-explorer-tree-entry'] === 'folder')];
  for (const target of targets) for (const native of ['input', 'selection', 'none']) {
    let stopped = false;
    const event = { target: { closest: () => native === 'input' ? {} : null,
      ownerDocument: { getSelection: () => ({ isCollapsed: native !== 'selection' }) } },
      stopPropagation() { stopped = true; }, preventDefault() { assert.fail('native context menu must not be prevented'); } };
    target.props.onContextMenuCapture(event);
    assert.equal(stopped, native !== 'none');
  }
});

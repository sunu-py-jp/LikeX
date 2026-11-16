import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { ExplorerHeader } from './src/ui/explorer-header.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
  export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-rename-kind-ui.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'rename-kind-ui' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'rename-kind-ui' }));
    builder.onLoad({ filter: /.*/, namespace: 'rename-kind-ui' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
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
const { useExplorerController, ExplorerProvider, ExplorerHeader, ExplorerFileList, ExplorerSidebar } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-rename-kind-ui.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const file = { id: 'file', name: 'Readme.txt', parent: 'root', kind: 'file', size: 4, mime: 'text/plain',
  source: { kind: 'existing', id: 'body' }, createdAt: '2026-11-14T00:00:00Z', updatedAt: '2026-11-14T00:00:00Z', favorite: 0 };
const folder = { ...file, id: 'folder', name: 'Documents', kind: 'folder', source: null, mime: '', size: 0 };

async function mount(t, supplied = {}) {
  let controller, renderer;
  let props = { initialEntries: [file, folder], onSave() {}, ui: { thumbnails: false }, ...supplied };
  function App() {
    controller = useExplorerController(props);
    return h(ExplorerProvider, { value: controller }, h(ExplorerHeader), h(ExplorerSidebar), h(ExplorerFileList));
  }
  await change(() => { renderer = create(h(StrictMode, null, h(App))); });
  t.after(async () => { await change(() => renderer.unmount()); });
  return { get current() { return controller; }, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(StrictMode, null, h(App)))); },
  };
}

const renameButtons = view => view.root.findAll(node => node.type === 'button' && node.props['aria-label'] === '名前の変更');
const row = (view, id) => view.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === id)[0];
const contextMenu = (view, id, tree = false) => {
  let node = view.root.findAll(child => typeof child.type === 'string' &&
    child.props[tree ? 'data-explorer-tree-entry' : 'data-explorer-entry-id'] === id)[0];
  while (node && node.type !== 'mock-context-root') node = node.parent;
  return node;
};
const rowMenu = (view, name) => view.root.findAllByType('mock-dropdown-root').find(node =>
  node.findAll(child => child.type === 'button' && child.props['aria-label'] === `${name}の操作`).length > 0);
const renameItems = menu => menu.findAll(node => node.type === (menu.type === 'mock-context-root' ? 'mock-context-item' : 'mock-dropdown-item') &&
  node.children.filter(child => typeof child === 'string').join('') === '名前を変更');
const click = () => ({ button: 0, detail: 1, target: { closest: () => null }, ctrlKey: false, metaKey: false, shiftKey: false });

test('toolbar follows the selected entry kind, including mixed selection and read-only priority', async t => {
  const view = await mount(t, { features: { renameFolders: false } });
  assert.equal(renameButtons(view).length, 1);
  assert.equal(renameButtons(view)[0].props.disabled, true, 'no selection keeps the available operation disabled');
  await change(() => view.current.setSelected(['folder']));
  assert.equal(renameButtons(view).length, 0, 'a disabled folder has no rename toolbar button');
  await change(() => view.current.setSelected(['file']));
  assert.equal(renameButtons(view)[0].props.disabled, false);
  await change(() => view.current.setSelected(['file', 'folder']));
  assert.equal(renameButtons(view)[0].props.disabled, true, 'mixed selection cannot start inline rename');
  await view.update({ features: { renameFiles: false } });
  await change(() => view.current.setSelected(['file']));
  assert.equal(renameButtons(view).length, 0);
  await change(() => view.current.setSelected(['folder']));
  assert.equal(renameButtons(view)[0].props.disabled, false);
  await change(() => renameButtons(view)[0].props.onClick());
  assert.equal(view.current.renamingEntryId, 'folder');
  assert.equal(view.root.findAllByProps({ 'data-explorer-rename-input': 'folder' }).length, 1);
  await view.update({ readOnly: true });
  assert.equal(renameButtons(view).length, 0);
  assert.equal(view.root.findAllByProps({ 'data-explorer-rename-input': 'folder' }).length, 0);
});

test('list, row-action and tree menus independently hide the disabled kind and retain the allowed kind', async t => {
  const view = await mount(t, { features: { renameFolders: false } });
  for (const menu of [contextMenu(view, 'folder'), contextMenu(view, 'folder', true), rowMenu(view, folder.name)]) {
    assert.ok(menu);
    assert.equal(renameItems(menu).length, 0);
  }
  for (const menu of [contextMenu(view, 'file'), rowMenu(view, file.name)]) assert.equal(renameItems(menu).length, 1);
  await view.update({ features: { renameFiles: false } });
  for (const menu of [contextMenu(view, 'file'), rowMenu(view, file.name)]) assert.equal(renameItems(menu).length, 0);
  for (const menu of [contextMenu(view, 'folder'), contextMenu(view, 'folder', true), rowMenu(view, folder.name)])
    assert.equal(renameItems(menu).length, 1);
  await change(() => renameItems(contextMenu(view, 'folder', true))[0].props.onSelect());
  assert.equal(view.current.renamingEntryId, 'folder');
  assert.equal(view.current.renameSource, 'tree', 'tree rename uses the same per-kind feature policy');
  await view.update({ features: { rename: false, renameFiles: true, renameFolders: true } });
  assert.equal(view.root.findAllByProps({ 'data-explorer-rename-input': 'folder' }).length, 0);
  for (const menu of [contextMenu(view, 'file'), contextMenu(view, 'folder'), contextMenu(view, 'folder', true)])
    assert.equal(renameItems(menu).length, 0, 'the master switch hides both kinds');
});

test('second-click rename starts only for the enabled kind without changing folder navigation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = await mount(t, { features: { renameFolders: false } });
  await change(() => view.current.setSelected(['folder']));
  await change(() => row(view, 'folder').props.onClick(click()));
  await change(() => t.mock.timers.tick(400));
  assert.equal(view.current.renamingEntryId, null);
  assert.equal(view.current.location, 'root');
  await change(() => view.current.setSelected(['file']));
  await change(() => row(view, 'file').props.onClick(click()));
  await change(() => t.mock.timers.tick(399));
  assert.equal(view.current.renamingEntryId, null);
  await change(() => t.mock.timers.tick(1));
  assert.equal(view.current.renamingEntryId, 'file');
  await change(() => view.current.cancelRename());
  await change(() => row(view, 'folder').props.onDoubleClick({ ...click(), detail: 2 }));
  assert.equal(view.current.location, 'folder', 'disabling rename still allows opening a folder');
});

test('changing kind flags cancels a pending click even if rename is reenabled before the delay ends', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const view = await mount(t);
  for (const [id, flag] of [['file', 'renameFiles'], ['folder', 'renameFolders']]) {
    await change(() => view.current.setSelected([id]));
    await change(() => row(view, id).props.onClick(click()));
    await change(() => t.mock.timers.tick(100));
    await view.update({ features: { [flag]: false } });
    await view.update({ features: { [flag]: true } });
    await change(() => t.mock.timers.tick(400));
    assert.equal(view.current.renamingEntryId, null, `${id}: the old gesture cannot reopen an editor`);
    await change(() => row(view, id).props.onClick(click()));
    await change(() => t.mock.timers.tick(400));
    assert.equal(view.current.renamingEntryId, id, `${id}: a new gesture uses the restored setting`);
    await change(() => view.current.cancelRename());
  }
  assert.equal(view.current.dirty, false);
});

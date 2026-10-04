import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { resolveExplorerOptions } from './src/model/config.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { ExplorerHeader } from './src/ui/explorer-header.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
  export { ExplorerStatusBar } from './src/ui/explorer-status-bar.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-selection-kind.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'search-flow' }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'search-flow' }));
  builder.onLoad({ filter: /.*/, namespace: 'search-flow' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
    ? 'export const createPortal = children => children;'
    : `import { createElement, cloneElement, isValidElement } from 'react';
      function family(kind) {
        return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
          'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
          ({ children, open, asChild, ...props }) => {
            if (part === 'Root' && ['dialog', 'alert'].includes(kind) && open === false) return null;
            if (['Provider', 'Portal'].includes(part) || (part === 'Root' && kind !== 'context')) return children;
            if (asChild && isValidElement(children)) return cloneElement(children, props);
            return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
          }
        ]));
      }
      export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
        Dialog = family('dialog'), AlertDialog = family('alert');`,
  }));
} }] });
const { resolveExplorerOptions, useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerHeader, ExplorerFileList, ExplorerStatusBar } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-selection-kind.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt'), entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested.txt', 'folder')];

async function mount(t, supplied = {}, initialInteraction) {
  let workspace, renderer, closed = false, child = false;
  const views = new Map();
  const events = [], ref = createRef();
  let interaction = initialInteraction;
  let props = { ref, initialEntries: initialEntries(), onSave() {}, onEvent: event => events.push(event), ...supplied };
  function Pane({ options, id }) {
    const controller = useExplorerViewController(options, workspace, id, null, interaction);
    views.set(id, controller);
    return id === 'main' ? h(ExplorerProvider, { value: controller },
      h(ExplorerHeader), h(ExplorerFileList), h(ExplorerStatusBar)) : null;
  }
  function App() {
    workspace = useExplorerWorkspace(props);
    return h(StrictMode, null, h(Pane, { options: props, id: 'main' }),
      child ? h(Pane, { options: props, id: 'child' }) : null);
  }
  await change(() => { renderer = create(h(App)); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { ref, get current() { return views.get('main'); }, get child() { return views.get('child'); },
    get workspace() { return workspace; }, get root() { return renderer.root; }, events, unmount,
    async update(patch, nextInteraction = interaction) { props = { ...props, ...patch }; interaction = nextInteraction; await change(() => renderer.update(h(App))); },
    async showChild() { child = true; await change(() => renderer.update(h(App))); },
  };
}

const getEntry = (hook, id) => hook.current.entries.find(entry => entry.id === id);
const getRow = (hook, id) => hook.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === id)[0];
const mouse = (extra = {}) => ({ button: 0, detail: 1, target: { closest: () => null }, ...extra });
const key = (name, extra = {}) => {
  const target = {};
  return { key: name, target, currentTarget: target, preventDefault() {}, stopPropagation() {}, ...extra };
};

test('selection kind defaults to both and filters initial and changing selections without editing entries', async t => {
  assert.equal(resolveExplorerOptions().selection.kind, 'both');
  const hook = await mount(t, { selectedFile: 'alpha', selection: { kind: 'folder' } });
  assert.deepEqual(hook.current.selected, []);
  await change(() => hook.current.setSelected(['folder', 'alpha']));
  assert.deepEqual(hook.current.selected, ['folder']);
  await hook.update({ selection: { kind: 'file' } });
  assert.deepEqual(hook.current.selected, []);
  await change(() => hook.current.setSelected(['folder', 'beta', 'alpha']));
  assert.deepEqual(hook.current.selected, ['beta', 'alpha']);
  await hook.update({ selection: { kind: 'file', mode: 'single' } });
  assert.deepEqual(hook.current.selected, ['beta']);
  assert.equal(hook.current.dirty, false);
});

test('file-only click, toggle, Shift and select-all ignore folders while retaining folder navigation', async t => {
  const hook = await mount(t, { selection: { kind: 'file' }, onSearchRequest: () => ['alpha', 'folder', 'beta'] });
  await change(() => hook.current.selectEntry(getEntry(hook, 'alpha'), mouse()));
  await change(() => hook.current.selectEntry(getEntry(hook, 'folder'), mouse({ ctrlKey: true })));
  await change(() => hook.current.toggleSelect('folder'));
  assert.deepEqual(hook.current.selected, ['alpha']);
  const folderBox = hook.root.findByProps({ 'aria-label': 'Folderを選択' });
  assert.equal(folderBox.props.disabled, true);
  assert.equal(hook.root.findByProps({ 'aria-label': 'Alpha.txtを選択' }).props.disabled, false);
  await change(() => hook.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.onChange({ target: { checked: true } }));
  assert.deepEqual(hook.current.selected, ['alpha', 'beta']);
  assert.equal(hook.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.checked, true);
  await change(() => hook.current.setQuery('ranked'));
  await change(() => hook.current.selectEntry(getEntry(hook, 'alpha'), mouse()));
  await change(() => hook.current.selectEntry(getEntry(hook, 'beta'), mouse({ shiftKey: true })));
  assert.deepEqual(hook.current.selected, ['alpha', 'beta']);
  await change(() => getRow(hook, 'folder').props.onDoubleClick(mouse({ detail: 2 })));
  assert.equal(hook.current.location, 'folder');
  assert.deepEqual(hook.current.selected, []);
});

test('folder-only selections disable file checkboxes in details and cards and still navigate with Enter', async t => {
  const hook = await mount(t, { selection: { kind: 'folder' } });
  await change(() => hook.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.onChange({ target: { checked: true } }));
  assert.deepEqual(hook.current.selected, ['folder']);
  assert.equal(hook.root.findByProps({ 'aria-label': 'Alpha.txtを選択' }).props.disabled, true);
  await change(() => hook.current.changeView('large'));
  assert.equal(hook.root.findByProps({ 'aria-label': 'Alpha.txtを選択' }).props.disabled, true);
  assert.equal(hook.root.findByProps({ 'aria-label': 'Folderを選択' }).props.disabled, false);
  await change(() => hook.current.rowKey(key('Enter'), getEntry(hook, 'folder')));
  assert.equal(hook.current.location, 'folder');
  await change(() => hook.current.changeView('details'));
  assert.equal(hook.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.disabled, true);
});

test('host selection rejects wrong-kind batches atomically while preview and containing-folder stay browseable', async t => {
  const previews = [];
  const hook = await mount(t, { selection: { kind: 'folder' }, onPreviewRequest: request => previews.push(request.id) });
  await change(() => assert.equal(hook.ref.current.selectEntries([{ id: 'folder' }]).ok, true));
  const snapshot = () => ({ location: hook.current.location, selected: [...hook.current.selected], history: [...hook.current.history] });
  const before = snapshot();
  for (const invoke of [
    () => hook.ref.current.selectFiles([{ id: 'nested' }]),
    () => hook.ref.current.showFile({ id: 'nested' }),
    () => hook.ref.current.selectEntries([{ id: 'folder' }, { id: 'alpha' }]),
  ]) {
    await change(() => assert.equal(invoke().code, 'selection-kind'));
    assert.deepEqual(snapshot(), before);
  }
  await change(() => assert.equal(hook.ref.current.previewFile({ id: 'nested' }).ok, true));
  assert.equal(hook.current.location, 'folder');
  assert.deepEqual(hook.current.selected, []);
  assert.deepEqual(previews, ['nested']);
  await change(() => hook.ref.current.openContainingFolder({ id: 'alpha' }));
  assert.equal(hook.current.location, 'root');
  assert.deepEqual(hook.current.selected, []);
  assert.equal(hook.current.revealRequest.id, 'alpha');
  await hook.update({ selection: { kind: 'file' } });
  await change(() => assert.equal(hook.ref.current.selectEntries([{ id: 'alpha' }]).ok, true));
  await change(() => assert.equal(hook.ref.current.selectEntries([{ id: 'folder' }, { id: 'alpha' }]).code, 'selection-kind'));
  assert.deepEqual(hook.current.selected, ['alpha']);
});

test('picker file activation uses double-click and Enter even when preview is disabled or denied', async t => {
  const activated = [], permissions = [], previews = [];
  const hook = await mount(t, { readOnly: true, selection: { kind: 'file' }, previewTrigger: 'click', features: { preview: false },
    getEntryPermissions: entry => { permissions.push(entry.id); return { preview: false }; },
    onPreviewRequest: request => previews.push(request.id),
  }, { onFileActivate: id => activated.push(id) });
  assert.equal(hook.current.fileActivationEnabled, true);
  await change(() => getRow(hook, 'alpha').props.onClick(mouse()));
  assert.deepEqual(activated, []);
  await change(() => getRow(hook, 'alpha').props.onDoubleClick(mouse({ detail: 2 })));
  await change(() => hook.current.rowKey(key('Enter'), getEntry(hook, 'beta')));
  assert.deepEqual(activated, ['alpha', 'beta']);
  assert.deepEqual(permissions, []);
  assert.deepEqual(previews, []);
  await hook.update({ selection: { kind: 'folder' } });
  await change(() => hook.current.openEntry(getEntry(hook, 'alpha')));
  assert.deepEqual(activated, ['alpha', 'beta']);
  await change(() => hook.current.openEntry(getEntry(hook, 'folder')));
  assert.equal(hook.current.location, 'folder');
});

test('explicit and initial previews never activate the picker, and retained activation uses the current callback', async t => {
  const activated = [], previews = [];
  const hook = await mount(t, { selectedFile: 'alpha', selectedFileMode: 'preview', selection: { kind: 'file' },
    onPreviewRequest: request => previews.push(request.id),
  }, { onFileActivate: id => activated.push(`old:${id}`) });
  assert.deepEqual(previews, ['alpha']);
  assert.deepEqual(activated, []);
  const retained = hook.current.openEntry;
  await hook.update({}, { onFileActivate: id => activated.push(`new:${id}`) });
  await change(() => retained(getEntry(hook, 'alpha')));
  assert.deepEqual(activated, ['new:alpha']);
  await change(() => hook.ref.current.previewFile({ id: 'beta' }));
  assert.deepEqual(previews, ['alpha', 'beta']);
  assert.deepEqual(activated, ['new:alpha']);
  const oldEntry = getEntry(hook, 'alpha');
  await hook.unmount();
  retained(oldEntry);
  assert.deepEqual(activated, ['new:alpha']);
});

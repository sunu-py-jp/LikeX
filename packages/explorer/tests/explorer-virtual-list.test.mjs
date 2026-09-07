import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, memo, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export * from './src/model/virtual-list.ts';
  export * from './src/state/explorer-context.tsx';
  export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
  export { useExplorerController } from './src/state/use-explorer-controller.ts';
`, resolveDir: packageRoot, sourcefile: 'test-virtual-explorer.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { explorerListLayout, explorerListRange, explorerListCell, explorerListScrollTarget,
  ExplorerProvider, useExplorerSelector, createExplorerStore, ExplorerFileList, useExplorerController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const viewport = { width: 1000, height: 600, top: 0, left: 0, lineHeight: 21 };
const modes = ['details', 'extra-large', 'large', 'medium', 'small', 'list', 'tiles', 'content'];
const change = async callback => { await act(async () => { await callback(); }); };

function assertNamespacedExplorerClasses(root) {
  for (const node of root.findAll(node => typeof node.type === 'string' && typeof node.props.className === 'string')) {
    for (const token of node.props.className.trim().split(/\s+/).filter(Boolean)) {
      assert.ok(token.startsWith('lxe:') || token === 'lucide' || token.startsWith('lucide-'),
        `Unprefixed rendered class on ${node.type}: ${token}`);
    }
  }
}

test('all eight modes bound DOM ranges, expose the last item and keep sparse interaction owners', () => {
  for (const mode of modes) {
    const layout = explorerListLayout(10000, mode, false, false, true, viewport);
    const first = explorerListRange(layout, viewport);
    assert(first.length < 150, `${mode} first range is bounded`);
    assert.equal(first[0], 0);
    const last = explorerListCell(layout, 9999);
    const scrolled = { ...viewport, top: Math.max(0, last.top - 200), left: Math.max(0, last.left - 200) };
    const end = explorerListRange(layout, scrolled, [0, 8888]);
    assert(end.includes(9999), `${mode} can reach its last item`);
    assert(end.includes(0) && end.includes(8888), `${mode} retains focus/menu owners`);
    assert(end.length < 170, `${mode} never mounts the gap to a pinned item`);
    const target = explorerListScrollTarget(layout, viewport, 9999);
    assert(mode === 'list' ? target.left > 0 : target.top > 0);
  }
});

test('grid column count follows resized width; list wraps vertically then scrolls horizontally', () => {
  for (const mode of ['extra-large', 'large', 'medium', 'small', 'tiles']) {
    const wide = explorerListLayout(10000, mode, false, false, true, viewport);
    const narrow = explorerListLayout(10000, mode, false, false, true, { ...viewport, width: 380 });
    assert(wide.columns > narrow.columns, mode);
    assert(narrow.height > wide.height, mode);
  }
  const list = explorerListLayout(10000, 'list', false, false, true, viewport);
  assert.equal(explorerListCell(list, list.rows - 1).left, explorerListCell(list, 0).left);
  assert(explorerListCell(list, list.rows).left > explorerListCell(list, 0).left);
  assert.equal(explorerListCell(list, list.rows).top, explorerListCell(list, 0).top);
  assert(explorerListLayout(10000, 'details', true, true, true, viewport).rowHeight > 28);
});

test('selectors avoid unrelated rerenders while stable operations call the latest controller', async t => {
  const counts = { name: 0, selection: 0 };
  const Name = memo(function Name() { const info = useExplorerSelector(value => ({ name: value.renameValue })); counts.name++; return h('span', null, info.name); });
  const Selection = memo(function Selection() { const info = useExplorerSelector(value => ({ selected: value.selected })); counts.selection++; return h('p', null, info.selected.length); });
  let value = { renameValue: '', selected: [], action: () => 1 };
  const children = h('div', null, h(Name), h(Selection));
  let renderer;
  await change(() => { renderer = create(h(ExplorerProvider, { value }, children)); });
  t.after(async () => { await change(() => renderer.unmount()); });
  const before = { ...counts };
  value = { ...value, renameValue: 'a' };
  await change(() => renderer.update(h(ExplorerProvider, { value }, children)));
  assert.equal(counts.name, before.name + 1);
  assert.equal(counts.selection, before.selection);
  const reader = () => Promise.resolve(new Blob());
  const store = createExplorerStore({ ...value, readFile: reader });
  const operation = store.getSnapshot().action;
  store.publish({ ...value, action: () => 2, readFile: reader });
  assert.equal(store.getSnapshot().action, operation);
  assert.equal(operation(), 2);
  assert.equal(store.getSnapshot().readFile, reader, 'host reader identity remains observable');
});

function entries(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `file-${index}`, parent: 'root', name: `${String(index).padStart(5, '0')}.txt`,
    kind: 'file', mime: 'text/plain', size: 1, favorite: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', source: { kind: 'existing', id: `content-${index}` } }));
}

async function mountList(t, mode, count = 10000, renderIcon) {
  let controller, renderer;
  const listeners = new Map();
  const renameControls = new Map();
  const focused = [];
  const owner = { getComputedStyle: () => ({ lineHeight: '21px' }), addEventListener() {}, removeEventListener() {} };
  const scroll = { clientWidth: 1000, clientHeight: 600, scrollTop: 0, scrollLeft: 0, ownerDocument: { defaultView: owner },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); },
    querySelectorAll() { return Array.from({ length: count }, (_, index) => ({ dataset: { explorerEntryId: `file-${index}` }, focus: () => focused.push(`file-${index}`) })); } };
  const props = { initialEntries: entries(count), onSave: async () => {}, view: { defaultMode: mode },
    ui: { thumbnails: false, contextMenu: false, rowActions: false }, features: { favorites: false }, renderIcon };
  function App() { controller = useExplorerController(props); return h(ExplorerProvider, { value: controller }, h(ExplorerFileList)); }
  await change(() => { renderer = create(h(StrictMode, null, h(App)), { createNodeMock(element) {
    if (element.props['data-explorer-virtualized']) return scroll;
    if (element.props['data-explorer-rename-input']) {
      const id = element.props['data-explorer-rename-input'];
      if (!renameControls.has(id)) renameControls.set(id, {
        tagName: element.type === 'textarea' ? 'TEXTAREA' : 'INPUT', ownerDocument: scroll.ownerDocument,
        style: {}, get scrollHeight() { return Math.max(24, Math.ceil(controller.renameValue.length / 15) * 20); },
        dataset: {}, focus() {}, setSelectionRange() {},
      });
      const control = renameControls.get(id);
      control.dataset.renameSelectionEnd = element.props['data-rename-selection-end'];
      return control;
    }
    return null;
  } }); });
  t.after(async () => { await change(() => renderer.unmount()); });
  return { get controller() { return controller; }, get root() { return renderer.root; }, scroll, focused,
    rows: () => renderer.root.findAll(node => node.props['data-explorer-entry'] === true && typeof node.type === 'string'),
    async scrollTo(top, left = 0) { scroll.scrollTop = top; scroll.scrollLeft = left; await change(() => listeners.get('scroll')?.()); },
  };
}

for (const mode of modes) test(`${mode}: real FileList renders only its window and reaches the final entry`, async t => {
  const list = await mountList(t, mode);
  assertNamespacedExplorerClasses(list.root);
  assert(list.rows().length < 160);
  assert.equal(list.rows()[0].props['data-explorer-entry-id'], 'file-0');
  await list.scrollTo(mode === 'list' ? 0 : 10000000, mode === 'list' ? 10000000 : 0);
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-9999'));
  assert(list.rows().length < 170);
  assertNamespacedExplorerClasses(list.root);
});

for (const mode of modes) test(`${mode}: conditional item helpers namespace selection, cut opacity and drag highlighting`, async t => {
  const list = await mountList(t, mode, 3);
  const row = id => list.rows().find(node => node.props['data-explorer-entry-id'] === id);
  const classes = id => row(id).props.className.split(/\s+/);
  assert.ok(classes('file-0').includes('lxe:hover:bg-[var(--explorer-hover)]'));
  assert.ok(classes('file-0').includes('lxe:focus-visible:outline-[var(--explorer-accent)]'));
  await change(() => list.controller.setSelected(['file-0']));
  assert.ok(classes('file-0').includes('lxe:bg-[var(--explorer-selection)]'));
  await change(() => list.controller.copyToClipboard('move', ['file-0']));
  assert.ok(classes('file-0').includes('lxe:opacity-45'));
  assert.ok(!classes('file-1').includes('lxe:opacity-45'));
  await change(() => list.controller.act('create', [], { name: 'Destination' }));
  const folder = list.controller.entries.find(entry => entry.kind === 'folder');
  await change(() => list.controller.setDragOver(folder.id));
  assert.ok(classes(folder.id).includes('lxe:outline-[var(--explorer-accent)]'));
  assert.ok(classes(folder.id).includes('lxe:bg-[var(--explorer-selection)]'));
  assertNamespacedExplorerClasses(list.root);
});

test('small lists retain every item; large-list rename and keyboard focus retain offscreen rows', async t => {
  const small = await mountList(t, 'details', 80);
  assert.equal(small.rows().length, 80);
  assert.equal(small.controller.focusEntryRef.current, null);
  let icons = 0;
  const list = await mountList(t, 'details', 10000, () => { icons++; return h('svg'); });
  await change(() => list.controller.focusEntryRef.current('file-9000'));
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-9000'));
  assert.equal(list.focused.at(-1), 'file-9000');
  await change(() => list.controller.startRename(['file-9000']));
  assert.equal(list.root.findAllByProps({ 'data-explorer-rename-input': 'file-9000' }).length, 1);
  await list.scrollTo(0);
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-9000'), 'scrolling does not unmount the active editor');
  assert(list.rows().length < 170);
  icons = 0;
  await change(() => list.controller.setRenameValue('new name'));
  assert.equal(icons, 0, 'typing in one name does not rerender unrelated icons');
  await change(() => list.controller.commitRename('file-9000'));
  assert(list.controller.entries.some(entry => entry.id === 'file-9000' && entry.name === 'new name.txt'));
});

for (const mode of ['details', 'extra-large', 'large', 'medium']) test(`${mode}: rename edits only the basename and retains keyboard, IME and blur behavior`, async t => {
  const list = await mountList(t, mode, 10);
  const editor = () => list.root.findByProps({ 'data-explorer-rename-input': 'file-0' });
  const key = (name, extra = {}) => ({ key: name, nativeEvent: {}, stopPropagation() {}, preventDefault() {}, ...extra });
  await change(() => list.controller.startRename(['file-0']));
  assert.equal(editor().props.value, '00000');
  assert.equal(editor().props['data-rename-selection-end'], 5);
  const extension = list.root.findByProps({ 'data-explorer-rename-extension': 'file-0' });
  assert.equal(extension.type, 'span', 'the extension is text, not an editable control');
  assert.equal(extension.children.at(-1), '.txt');
  assert.match(editor().props['aria-describedby'], /rename-extension/);
  assert.equal(editor().type, mode === 'details' ? 'input' : 'textarea');
  const newBase = '長いファイル名の変更でも元の拡張子を保持して複数行で編集を続けられます';
  await change(() => editor().props.onChange({ target: { value: newBase } }));
  assert.equal(editor().props.value, newBase);
  if (mode !== 'details') {
    assert(Number.parseFloat(editor().instance.style.height) > 24, 'multiline editors continue autosizing');
    assert(editor().parent.parent.props.className.includes('absolute'), 'the editor remains outside row layout');
  }
  await change(() => editor().props.onCompositionStart());
  await change(() => editor().props.onKeyDown(key('Enter')));
  assert.equal(list.controller.renamingEntryId, 'file-0', 'IME confirmation does not finish rename');
  await change(() => editor().props.onCompositionEnd());
  await change(() => editor().props.onKeyDown(key('Enter', { nativeEvent: { isComposing: true } })));
  assert.equal(list.controller.renamingEntryId, 'file-0');
  for (const name of ['Enter', 'Escape']) {
    for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }]) {
      await change(() => editor().props.onKeyDown(key(name, extra)));
      assert.equal(list.controller.renamingEntryId, 'file-0', 'composition must not commit or cancel a filename');
      assert.equal(editor().props.value, newBase);
    }
  }
  await change(() => editor().props.onKeyDown(key('Enter')));
  assert.equal(list.controller.renamingEntryId, null);
  assert.equal(list.controller.entries.find(entry => entry.id === 'file-0').name, `${newBase}.txt`);
  await change(() => list.controller.startRename(['file-0']));
  await change(() => editor().props.onChange({ target: { value: '取消' } }));
  await change(() => editor().props.onKeyDown(key('Escape')));
  assert.equal(list.controller.entries.find(entry => entry.id === 'file-0').name, `${newBase}.txt`);
  await change(() => list.controller.startRename(['file-0']));
  await change(() => editor().props.onChange({ target: { value: 'blurで保存' } }));
  await change(() => editor().props.onBlur());
  assert.equal(list.controller.entries.find(entry => entry.id === 'file-0').name, 'blurで保存.txt');
});

test('drag, focus and context-menu owners survive scrolling without retaining intervening rows', async t => {
  const list = await mountList(t, 'large');
  const section = () => list.root.findByProps({ 'aria-label': 'ファイル一覧' });
  const target = id => ({ closest: () => ({ dataset: { explorerEntryId: id } }) });
  await change(() => section().props.onDragStartCapture({ target: target('file-0') }));
  await list.scrollTo(10000000);
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  await change(() => section().props.onDragEndCapture());
  assert(!list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  await list.scrollTo(0);
  const entryContext = list.root.findAll(node => node.type?.name === 'EntryContext')[0];
  await change(() => entryContext.props.onOpenChange(true));
  await list.scrollTo(10000000);
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  await change(() => entryContext.props.onOpenChange(false));
  assert(!list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  await list.scrollTo(0);
  await change(() => section().props.onFocusCapture({ target: target('file-0') }));
  await list.scrollTo(10000000);
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  await change(() => section().props.onBlurCapture({ relatedTarget: null }));
  assert(!list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-0'));
  assert(list.rows().length < 100);
});

test('select all and arrow navigation address the full result set beyond mounted rows', async t => {
  const list = await mountList(t, 'details');
  await change(() => list.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.onChange({ target: { checked: true } }));
  assert.equal(list.controller.selected.length, 10000);
  await list.scrollTo(10000000);
  assert.equal(list.controller.selected.length, 10000);
  assert.equal(list.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' }).props.checked, true);
  await change(() => list.controller.rowKey({ key: 'ArrowUp', preventDefault() {} }, list.controller.entries[9999]));
  assert.deepEqual(list.controller.selected, ['file-9998']);
  assert.equal(list.focused.at(-1), 'file-9998');
  assert(list.rows().some(row => row.props['data-explorer-entry-id'] === 'file-9998'));
});

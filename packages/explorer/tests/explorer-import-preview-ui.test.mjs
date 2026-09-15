import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  absWorkingDir: packageRoot,
  stdin: {
    contents: `export { ExplorerFileList } from './src/ui/explorer-file-list.tsx';
      export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
      export { ExplorerStatusBar } from './src/ui/explorer-status-bar.tsx';
      export { ExplorerContext } from './src/state/explorer-context.tsx';`,
    resolveDir: packageRoot,
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-ui-dependencies', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({
      path: import.meta.resolve(path), external: true,
    }));
  } }],
});
const { ExplorerFileList, ExplorerSidebar, ExplorerStatusBar, ExplorerContext } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const modes = ['details', 'extra-large', 'large', 'medium', 'small', 'list', 'tiles', 'content'];
const entry = (id, name) => ({ id, name, parent: 'root', kind: 'file', extension: name.split('.').at(-1),
  size: 123, mime: 'text/plain', source: null, favorite: 0,
  createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z' });
const real = entry('real-id', '保存済み.txt');
const pending = index => ({ entry: entry(`temporary-${index}`, `${index}.png`), relativePath: `追加フォルダ/画像/${index}.png` });
const noop = () => {};
function context(overrides = {}) {
  return {
    rootLabel: 'ファイル', entries: [real], visible: [real], pendingImportEntries: [pending(1)],
    processingEntryIds: new Set(), navigationEntries: undefined, openPendingImportFolder: noop,
    selected: [real.id], selectedSet: new Set([real.id]), activeTabId: 'tab', focusEntryRef: { current: null },
    workspaceRef: { current: null }, clipboard: null, disabled: false, busy: false,
    view: 'details', compact: false, query: '', searchPending: false, searchError: null,
    retrySearch: noop, canSort: true, location: 'root', special: false, currentParent: 'root',
    dragOver: null, externalDrag: false, readFile: noop, displayedSort: { key: 'name', asc: true },
    setSelected: noop, setDragOver: noop, setExternalDrag: noop, chooseFiles: noop, allowDrop: noop, drop: noop,
    rowKey: noop, startDrag: noop, selectEntry: noop, openEntry: noop, toggleSelect: noop,
    entryId: id => `entry-${id}`, act: noop, showModal: noop, sortBy: noop,
    features: { rename: true, search: true, favorites: true, recent: true, move: true, preview: true, copy: true,
      download: true, delete: true, details: true, uploadFiles: true, uploadFolders: true, createFolder: true },
    selectionOptions: { mode: 'multiple', checkboxes: true },
    uiOptions: { rowActions: false, contextMenu: false, thumbnails: true },
    canDrag: true, renamingEntryId: null, previewTrigger: 'click', canEditFavorites: false,
    startRename: noop, modal: null, preview: null, details: null, expanded: [],
    setExpanded: noop, navigate: noop, fileCount: 1, totalSize: 123, mobileOpen: false, setOpenMobile: noop,
    instanceId: 'explorer-preview',
    ...overrides,
  };
}
const element = value => h(ExplorerContext.Provider, { value }, h(ExplorerFileList));
const hosts = renderer => renderer.root.findAll(node => typeof node.type === 'string');
const pendingNodes = renderer => hosts(renderer).filter(node => node.props['data-explorer-pending-import']);
const visibleText = node => typeof node === 'string' ? node : node.children.map(visibleText).join('');
async function mount(t, value) {
  let renderer;
  await act(() => { renderer = create(element(value)); });
  t.after(() => act(() => renderer.unmount()));
  return renderer;
}

test('all display modes show non-interactive pending files without invoking public entry callbacks', async t => {
  for (const view of modes) await t.test(view, async subtest => {
    const iconIds = [];
    let reads = 0;
    const renderer = await mount(subtest, context({ view,
      renderIcon: ({ entry }) => { iconIds.push(entry.id); return null; },
      readFile: () => { reads++; throw new Error('pending files must not be read'); },
    }));
    const [row] = pendingNodes(renderer);
    assert.ok(row);
    assert.match(visibleText(row), /1\.png/);
    assert.equal(row.findByProps({ title: '追加フォルダ/画像/1.png' }).children.join(''), '1.png');
    assert.equal(visibleText(row).includes('取り込み中'), false);
    assert.equal(row.findAllByProps({ 'data-explorer-processing-icon': true }).length, 1);
    assert.equal(row.props.draggable, false);
    assert.equal(row.props.tabIndex, undefined);
    assert.equal(row.props['data-explorer-entry-id'], undefined);
    assert.equal(row.props['aria-selected'], undefined);
    assert.equal(row.findAllByType('input').length, 0);
    assert.equal(row.findAllByType('button').length, 0);
    assert.equal(row.findAllByType('img').length, 0);
    assert.equal(row.findAllByProps({ 'data-explorer-entry-name': row.props['data-explorer-pending-import'] }).length, 0);
    assert.ok(row.findAllByType('svg').some(svg => /animate-spin/.test(svg.props.className ?? '')));
    assert.deepEqual([...new Set(iconIds)], [real.id]);
    assert.equal(reads, 0);
    assert.equal(renderer.root.findByType('section').props['aria-busy'], true);
    const realRow = hosts(renderer).find(node => node.props['data-explorer-entry-id'] === real.id);
    assert.equal(realRow.props[view === 'details' ? 'aria-selected' : 'aria-pressed'], true);
  });
});

test('select all targets committed entries and pending interactions cannot clear selection or open menus', async t => {
  const selections = [];
  const renderer = await mount(t, context({ setSelected: ids => selections.push(ids) }));
  const selectAll = renderer.root.findByProps({ 'aria-label': '表示中の項目をすべて選択' });
  await act(() => selectAll.props.onChange({ target: { checked: true } }));
  assert.deepEqual(selections, [[real.id]]);
  const [row] = pendingNodes(renderer);
  for (const action of ['onClick', 'onDoubleClick', 'onPointerDown', 'onContextMenu', 'onDragStart']) {
    let stopped = false, prevented = false;
    await act(() => row.props[action]({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } }));
    assert.equal(stopped, true, action);
    assert.equal(prevented, ['onContextMenu', 'onDragStart'].includes(action), action);
  }
  assert.deepEqual(selections, [[real.id]]);
});

test('pending batches remain virtualized in every view and complete table row count includes them', async t => {
  for (const view of modes) await t.test(view, async subtest => {
    const renderer = await mount(subtest, context({ view,
      pendingImportEntries: Array.from({ length: 2000 }, (_, index) => pending(index)),
    }));
    assert.ok(hosts(renderer).some(node => node.props['data-explorer-virtualized'] === true));
    assert.ok(pendingNodes(renderer).length > 0);
    assert.ok(pendingNodes(renderer).length < 200, 'offscreen pending files stay unmounted');
    if (view === 'details') assert.equal(renderer.root.findByType('table').props['aria-rowcount'], 2002);
  });
});

test('clearing an aborted batch restores the empty folder and preview paths remain plain text', async t => {
  const value = context({ entries: [], visible: [], pendingImportEntries: [{
    ...pending(0), relativePath: '<img src=x onerror=alert(1)>/0.png',
  }] });
  const renderer = await mount(t, value);
  assert.equal(visibleText(pendingNodes(renderer)[0]).includes('<img'), false);
  assert.equal(pendingNodes(renderer)[0].findByProps({ title: '<img src=x onerror=alert(1)>/0.png' }).children.join(''), '0.png');
  assert.equal(renderer.root.findAllByType('img').length, 0);
  assert.equal(hosts(renderer).some(node => node.props.dangerouslySetInnerHTML), false);
  assert.equal(visibleText(renderer.root).includes('このフォルダは空です'), false);
  await act(() => renderer.update(element({ ...value, pendingImportEntries: [] })));
  assert.equal(pendingNodes(renderer).length, 0);
  assert.match(visibleText(renderer.root), /このフォルダは空です/);
  assert.equal(renderer.root.findByType('section').props['aria-busy'], false);
});

test('a long folder path cannot replace the primary filename in any view', async t => {
  const parent = Array.from({ length: 15 }, (_, index) => `長いフォルダ名-${index}`).join('/');
  const preview = { entry: entry('temporary-long-path', '確認用画像.png'), relativePath: `${parent}/確認用画像.png` };
  for (const view of modes) await t.test(view, async subtest => {
    const renderer = await mount(subtest, context({ view, pendingImportEntries: [preview] }));
    const [row] = pendingNodes(renderer);
    const name = row.findByProps({ title: preview.relativePath });
    assert.deepEqual(name.children, ['確認用画像.png']);
    assert.ok(!visibleText(name).includes(parent));
    assert.match(name.props.className, /truncate|line-clamp/);
    assert.equal(visibleText(row).includes('取り込み中'), false);
    assert.equal(row.findAllByProps({ 'data-explorer-processing-icon': true }).length, 1);
  });
});

test('folder-only uploads accept external drops on folders and background, while uploads off accept neither', async t => {
  const folder = { ...entry('destination', '保存先'), kind: 'folder', extension: undefined };
  for (const uploadFolders of [true, false]) await t.test(`uploadFolders=${uploadFolders}`, async subtest => {
    const calls = [];
    const value = context({ entries: [folder], visible: [folder], pendingImportEntries: [], canDrag: false,
      features: { ...context().features, uploadFiles: false, uploadFolders },
      externalDrag: true,
      allowDrop: (_event, parent) => calls.push(['hover', parent]),
      drop: (_event, parent) => calls.push(['drop', parent]),
      setExternalDrag: value => calls.push(['external', value]),
    });
    const renderer = await mount(subtest, value);
    const background = hosts(renderer).find(node => node.type === 'div' && node.props.onDrop);
    const row = hosts(renderer).find(node => node.props['data-explorer-entry-id'] === folder.id);
    const event = { dataTransfer: { types: ['Files'] } };
    await act(() => {
      row.props.onDragOver?.(event);
      row.props.onDrop?.(event);
      background.props.onDragOver(event);
      background.props.onDrop(event);
    });
    assert.deepEqual(calls, uploadFolders
      ? [['hover', folder.id], ['drop', folder.id], ['hover', 'root'], ['external', true], ['drop', 'root']]
      : []);
    assert.equal(visibleText(renderer.root).includes('ここにドロップして追加'), uploadFolders);
    if (!uploadFolders) {
      assert.equal(row.props.onDragOver, undefined);
      assert.equal(row.props.onDrop, undefined);
    }
  });
});


test('temporary folders can open in every display mode without becoming mutation targets', async t => {
  const folder = { entry: { ...entry('temporary-folder', '追加フォルダ'), kind: 'folder', extension: '', size: 0 }, relativePath: '追加フォルダ' };
  for (const view of modes) await t.test(view, async subtest => {
    const opened = [], selected = [], iconIds = [];
    const renderer = await mount(subtest, context({ view, pendingImportEntries: [folder],
      openPendingImportFolder: id => opened.push(id), setSelected: ids => selected.push(ids),
      renderIcon: ({ entry }) => { iconIds.push(entry.id); return null; },
    }));
    const [row] = pendingNodes(renderer);
    assert.equal(row.props.tabIndex, 0);
    assert.equal(row.props.draggable, false);
    const event = { preventDefault: noop, stopPropagation: noop };
    await act(() => {
      row.props.onClick(event);
      row.props.onDoubleClick(event);
      row.props.onKeyDown({ ...event, key: 'Enter' });
      row.props.onKeyDown({ ...event, key: ' ' });
      row.props.onKeyDown({ ...event, key: 'Delete' });
    });
    assert.deepEqual(opened, Array(3).fill(folder.entry.id));
    assert.deepEqual(selected, []);
    assert.ok(!iconIds.includes(folder.entry.id));
    assert.equal(row.findAllByType('input').length, 0);
    assert.equal(row.findAllByType('button').length, 0);
    for (const action of ['onDrop', 'onDragOver', 'onContextMenu']) {
      let stopped = false, prevented = false;
      await act(() => row.props[action]({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } }));
      assert.ok(stopped && prevented);
    }
  });
});

test('real folder and file icons retain custom overrides with one centered busy indicator', async t => {
  const folder = { ...entry('real-folder', '既存フォルダ'), kind: 'folder', extension: '' };
  const file = { ...real, source: null };
  for (const view of ['details', 'large', 'small']) await t.test(view, async subtest => {
    const items = [folder, file];
    const renderer = await mount(subtest, context({ view, entries: items, visible: items, pendingImportEntries: [],
      processingEntryIds: new Set(items.map(item => item.id)),
      renderIcon: ({ entry }) => h('span', { 'data-custom-icon': entry.id }, entry.id),
    }));
    assert.equal(renderer.root.findAllByProps({ 'data-explorer-processing-icon': true }).length, 2);
    for (const item of items) {
      assert.equal(renderer.root.findAllByProps({ 'data-custom-icon': item.id }).length, 1);
      assert.equal(hosts(renderer).filter(node => node.props['data-explorer-entry-id'] === item.id).length, 1);
    }
    assert.equal(visibleText(renderer.root).includes('取り込み中'), false);
  });
});

test('the tree shows temporary hierarchy with ancestor indicators and prevents temporary drops or host icon callbacks', async t => {
  const folder = { ...entry('real-folder', '既存フォルダ'), kind: 'folder', extension: '' };
  const pendingFolder = { ...entry('temporary-folder', '追加フォルダ'), kind: 'folder', extension: '', parent: folder.id };
  const opened = [], navigated = [], icons = [], drops = [];
  const value = context({ entries: [folder], navigationEntries: [folder, pendingFolder],
    processingEntryIds: new Set(['root', folder.id, pendingFolder.id]), expanded: ['root', folder.id],
    openPendingImportFolder: id => opened.push(id), navigate: id => navigated.push(id),
    renderIcon: ({ entry }) => { icons.push(entry.id); return null; },
    drop: (_event, id) => drops.push(id), allowDrop: (_event, id) => drops.push(id),
  });
  let renderer;
  await act(() => { renderer = create(h(ExplorerContext.Provider, { value }, h(ExplorerSidebar))); });
  t.after(() => act(() => renderer.unmount()));
  const row = renderer.root.findByProps({ 'data-explorer-pending-folder': pendingFolder.id });
  const open = row.findAllByType('button').find(button => button.props['aria-current'] !== undefined || visibleText(button).includes(pendingFolder.name));
  await act(() => open.props.onClick());
  assert.deepEqual(opened, [pendingFolder.id]);
  assert.deepEqual(navigated, []);
  assert.deepEqual([...new Set(icons)], [folder.id]);
  assert.equal(renderer.root.findAllByProps({ 'data-explorer-processing-icon': true }).length, 4);
  assert.equal(visibleText(renderer.root).includes('取り込み中'), false);
  for (const action of ['onDrop', 'onDragOver', 'onContextMenu']) {
    let prevented = false, stopped = false;
    await act(() => row.props[action]({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
    assert.ok(prevented && stopped);
  }
  assert.deepEqual(drops, []);
});

test('status bar does not repeat import labels or introduce an extra status area', async t => {
  const value = context({ pendingImportEntries: [pending(1)], selected: [], selectedEntries: [],
    allowedViewModes: ['details'], customContextMenuState: { phase: 'idle' } });
  let renderer;
  await act(() => { renderer = create(h(ExplorerContext.Provider, { value }, h(ExplorerStatusBar))); });
  t.after(() => act(() => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('footer').length, 1);
  assert.equal(visibleText(renderer.root), '2 個の項目');
});


test('a temporary folder hides background creation, upload, and custom menus while keeping navigation available', async t => {
  let customCalls = 0;
  const drops = [];
  const value = context({ entries: [], visible: [], pendingImportEntries: [], provisionalLocation: true,
    currentParent: 'temporary-folder', location: 'temporary-folder', externalDrag: true,
    uiOptions: { ...context().uiOptions, contextMenu: true }, hasCustomContextMenu: true,
    getCustomContextMenu: () => { customCalls++; throw new Error('temporary destination must not reach the host'); },
    drop: (_event, id) => drops.push(id), allowDrop: (_event, id) => drops.push(id),
  });
  const renderer = await mount(t, value);
  assert.equal(visibleText(renderer.root), '');
  assert.equal(renderer.root.findAllByType('button').length, 0);
  const background = hosts(renderer).find(node => node.type === 'div' && node.props.onDrop);
  for (const types of [['Files'], ['application/x-explorer']]) {
    await act(() => {
      background.props.onDragOver({ dataTransfer: { types } });
      background.props.onDrop({ dataTransfer: { types } });
    });
  }
  assert.deepEqual(drops, []);
  assert.equal(customCalls, 0);
});

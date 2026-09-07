import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: `
      export { FileIcon, FileThumbnail } from './src/ui/explorer-file-icon.tsx';
      export { ExplorerContext, ExplorerProvider } from './src/state/explorer-context.tsx';
      export { ExplorerTabs } from './src/ui/explorer-tabs.tsx';
      export { ExplorerSidebar } from './src/ui/explorer-sidebar.tsx';
      export { resolveExplorerOptions } from './src/model/config.ts';
      export { fileIconStyle } from './src/model/file-icon-style.ts';
      export { ExplorerThemeContext, explorerThemeStyle } from './src/ui/explorer-theme.tsx';
    `,
    resolveDir: packageRoot, sourcefile: 'test-explorer-icons.tsx',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{
    name: 'shared-react-instance',
    setup(builder) {
      builder.onResolve({ filter: /^(react|react-dom|react-test-renderer|lucide-react|radix-ui)(\/.*)?$/ }, ({ path }) => ({
        path: import.meta.resolve(path), external: true,
      }));
    },
  }],
});
const { FileIcon, FileThumbnail, ExplorerContext, ExplorerProvider, ExplorerTabs, ExplorerSidebar, resolveExplorerOptions,
  fileIconStyle, ExplorerThemeContext, explorerThemeStyle } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
);

const folder = {
  id: 'docs', parent: 'root', name: '資料', kind: 'folder', size: 0, mime: '',
  createdAt: '2026-09-06T01:00:00Z', updatedAt: '2026-09-06T01:00:00Z', favorite: 0, source: null,
};
const file = {
  ...folder, id: 'plan', parent: 'docs', name: '計画.PDF', kind: 'file', size: 123,
  mime: 'application/pdf', favorite: 1, source: { kind: 'existing', id: 'original-content-id' },
};
const picture = { ...file, id: 'photo', name: '写真.png', mime: 'image/png' };
const options = resolveExplorerOptions();
const baseContext = {
  uiOptions: { ...options.ui, contextMenu: false },
  entries: [folder, file, picture], selected: ['plan'], expanded: ['docs'],
  ...options,
  // Options initializes a different default view; this context represents the current view.
  view: 'large',
};
const iconFamilies = [
  ['#3e7359', '#87af99', ['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'xla', 'xlam']],
  ['#a05d5d', '#c89595', ['pdf']],
  ['#496f94', '#8da9c4', ['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm']],
  ['#806794', '#b5a1cb', ['json', 'csv', 'tsv', 'xml', 'yaml', 'yml']],
  ['#946538', '#c8a07e', ['ppt', 'pptx', 'pptm', 'pot', 'potx', 'potm', 'pps', 'ppsx', 'ppsm']],
  ['#637182', '#a0aab7', ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'eot']],
  ['#80694f', '#c3ae92', ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lzh']],
];
const textIconFamily = ['#7b8794', '#aeb8c5', ['txt', 'md']];
const change = async callback => { await act(async () => { await callback(); }); };
async function mount(t, node, context = baseContext) {
  let renderer;
  let currentNode = node;
  let currentContext = context;
  const element = () => currentContext === null ? currentNode : h(ExplorerContext.Provider, { value: currentContext }, currentNode);
  let closed = false;
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  await change(() => { renderer = create(element()); });
  return {
    get root() { return renderer.root; },
    json: () => renderer.toJSON(), unmount,
    async update({ node = currentNode, context = currentContext }) {
      currentNode = node; currentContext = context;
      await change(() => renderer.update(element()));
    },
  };
}

test('omitting renderIcon preserves standalone and contextual default icons', async t => {
  const standalone = await mount(t, h(FileIcon, { entry: folder }), null);
  const contextual = await mount(t, h(FileIcon, { entry: folder }));
  assert.deepEqual(contextual.json(), standalone.json());
  assert.match(standalone.json().props.className, /explorer-folder/);
  assert.equal(standalone.root.findAllByType('svg').length, 1);
});

test('recognized extensions display their own uppercase label and requested color', async t => {
  const view = await mount(t, h(FileIcon, { entry: file }));
  for (const [ink, , extensions] of [...iconFamilies, textIconFamily]) {
    for (const extension of extensions) {
      await view.update({ node: h(FileIcon, { entry: { ...file, name: `File.${extension.toUpperCase()}`, extension: 'stale' } }) });
      const svg = view.root.findByType('svg');
      const labels = view.root.findAllByType('text');
      assert.equal(svg.props['data-explorer-file-extension'], extension.toUpperCase());
      assert.equal(svg.props['aria-hidden'], 'true');
      assert.equal(svg.props.focusable, 'false');
      assert.equal(view.root.findAllByType('rect').length, 0, 'the icon has no solid extension badge');
      assert.equal(labels.at(-1).props.fill, ink, extension);
      assert.deepEqual(labels.map(node => node.children.join('')), [extension.toUpperCase()]);
      assert.equal(fileIconStyle(extension.toUpperCase()).label, extension.toUpperCase());
    }
  }
});

test('font extensions display only the extension at either size', async t => {
  const view = await mount(t, h(FileIcon, { entry: file }));
  for (const extension of ['ttf', 'otf', 'woff', 'woff2', 'ttc', 'eot']) {
    for (const large of [false, true]) {
      await view.update({ node: h(FileIcon, { entry: { ...file, name: `Font.${extension}` }, large }) });
      assert.deepEqual(view.root.findAllByType('text').map(node => node.children.join('')), [extension.toUpperCase()]);
      assert.equal(view.root.findByType('svg').props.viewBox, '0 0 40 48');
      assert.match(view.json().props.className, large ? /size-20/ : /w-5/);
      assert.equal(view.json().props['aria-hidden'], 'true');
    }
  }
});

test('unrecognized files keep a white generic paper icon and folders stay yellow', async t => {
  const view = await mount(t, h(FileIcon, { entry: { ...file, name: 'Readme' } }));
  const generic = view.json();
  const genericPaths = view.root.findAllByType('path').map(node => node.props);
  assert.equal(genericPaths[0].fill, '#ffffff');
  await view.update({ node: h(FileIcon, { entry: file }) });
  assert.equal(view.root.findByType('svg').props.viewBox, generic.children[0].props.viewBox);
  assert.deepEqual(view.root.findAllByType('path').map(node => ({ d: node.props.d, strokeWidth: node.props.strokeWidth })),
    genericPaths.map(({ d, strokeWidth }) => ({ d, strokeWidth })), 'generic and labeled files share the same outline');
  for (const [name, mime] of [['Photo.png', 'image/png'], ['Code.ts', 'text/typescript'],
    ['Unknown.bin', 'application/octet-stream'], ['Video.mp4', 'video/mp4'], ['Readme', 'text/plain'], ['.env', 'text/plain']]) {
    await view.update({ node: h(FileIcon, { entry: { ...file, name, mime } }) });
    assert.deepEqual(view.json(), generic, name);
    assert.equal(view.root.findAllByType('text').length, 0);
  }
  await view.update({ node: h(FileIcon, { entry: { ...folder, name: 'フォルダ.pdf', extension: 'pdf' } }) });
  assert.match(view.root.findByType('svg').props.className, /\blucide-folder\b/);
  assert.match(view.json().props.className, /explorer-folder/);
  assert.equal(view.root.findAllByType('text').length, 0);
  assert.notDeepEqual(view.json(), generic);
});

test('light and dark defaults use theme-matched paper and high contrast extension labels', async t => {
  const withTheme = (name, mode) => h(ExplorerThemeContext.Provider, { value: explorerThemeStyle({}, mode) },
    h(FileIcon, { entry: { ...file, name } }));
  const view = await mount(t, withTheme('Unknown.bin', 'dark'));
  const luminance = hex => {
    const channels = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const [mode, paper, neutral] of [['light', '#ffffff', '#7b8794'], ['dark', '#252525', '#aeb8c5']]) {
    await view.update({ node: withTheme('Unknown.bin', mode) });
    assert.equal(view.root.findAllByType('path')[0].props.fill, paper);
    assert.equal(view.json().props.style.color, neutral);
    for (const extension of textIconFamily[2]) {
      await view.update({ node: withTheme(`File.${extension}`, mode) });
      assert.equal(view.root.findByType('text').children.join(''), extension.toUpperCase());
      assert.equal(view.root.findByType('text').props.fill, neutral, 'text files retain the existing neutral color');
      assert.equal(view.root.findAllByType('path')[0].props.fill, paper);
      assert.equal(view.root.findAllByType('rect').length, 0);
    }
    for (const [lightInk, darkInk, extensions] of iconFamilies) {
      for (const extension of extensions) {
        await view.update({ node: withTheme(`File.${extension}`, mode) });
        const label = view.root.findAllByType('text').at(-1);
        const background = view.root.findAllByType('path')[0].props.fill;
        assert.equal(label.props.fill, mode === 'dark' ? darkInk : lightInk);
        assert.equal(background, paper);
        assert.equal(view.root.findAllByType('rect').length, 0);
        const a = luminance(label.props.fill);
        const b = luminance(background);
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        assert(contrast >= 4.5, `${mode} ${extension}: ${contrast}`);
      }
    }
  }
});

test('icon context exposes isolated current metadata, location and UI state', async t => {
  const calls = [];
  const view = await mount(t, h(FileIcon, { entry: file }), {
    ...baseContext,
    renderIcon(context) {
      calls.push(context);
      return h('svg', { 'data-custom': context.entry.extension, style: { color: '#123456', fill: 'none' } });
    },
  });
  const info = calls[0];
  assert.equal(info.location, 'list');
  assert.equal(info.view, 'large');
  assert.equal(info.selected, true);
  assert.equal(info.expanded, false);
  assert.equal(info.entry.path, '/資料/計画.PDF');
  assert.equal(info.entry.extension, 'pdf');
  assert.equal(info.entry.mime, 'application/pdf');
  assert.equal(info.entry.size, 123);
  assert.notEqual(info.entry, file);
  assert.notEqual(info.entry.source, file.source);
  info.entry.name = 'Host edit';
  info.entry.source.id = 'Host edit';
  assert.equal(file.name, '計画.PDF');
  assert.equal(file.source.id, 'original-content-id');
  assert.equal(view.root.findByType('svg').props['data-custom'], 'pdf');
  assert.equal(view.root.findAllByType('text').length, 0, 'custom rendering does not inherit the built-in extension badge');
  assert.doesNotMatch(view.json().props.className, /explorer-folder|text-\[|fill-/);
  assert.equal(view.json().props['aria-hidden'], 'true');
  assert.match(view.json().props.className, /pointer-events-none/);
});

test('fallback values and explicit hiding remain distinct and renderer updates are current', async t => {
  const node = h(FileIcon, { entry: folder });
  const view = await mount(t, node);
  const original = view.json();
  for (const renderIcon of [() => null, () => undefined, ({ defaultIcon }) => defaultIcon]) {
    await view.update({ context: { ...baseContext, renderIcon } });
    assert.deepEqual(view.json(), original);
  }
  await view.update({ context: { ...baseContext, renderIcon: () => false } });
  assert.equal(view.json().children, null);
  assert.match(view.json().props.className, /inline-flex/);
  await view.update({ context: { ...baseContext, renderIcon: () => h('img', { src: '/icons/folder.svg', alt: '' }) } });
  assert.equal(view.root.findByType('img').props.src, '/icons/folder.svg');
  await view.update({ context: baseContext });
  assert.deepEqual(view.json(), original);
});

test('defaultIcon can be decorated without invoking the renderer recursively', async t => {
  let calls = 0;
  const view = await mount(t, h(FileIcon, { entry: folder }), {
    ...baseContext,
    renderIcon: ({ defaultIcon }) => {
      calls++;
      return h('span', null, defaultIcon, h('span', { 'data-badge': true }, '!'));
    },
  });
  assert.equal(calls, 1);
  assert.equal(view.root.findAllByType('svg').length, 1);
  assert.equal(view.root.findAllByProps({ 'data-badge': true }).length, 1);
});

test('defaultIcon props cannot expose mutable draft entries or content references', async t => {
  const localFile = { ...file, source: { ...file.source } };
  const context = {
    ...baseContext, entries: [folder, localFile],
    renderIcon: ({ defaultIcon }) => {
      defaultIcon.props.entry.name = 'Host edit';
      defaultIcon.props.entry.source.id = 'Host edit';
      return false;
    },
  };
  for (const Component of [FileIcon, FileThumbnail]) {
    await mount(t, h(Component, { entry: localFile }), context);
    assert.equal(localFile.name, '計画.PDF');
    assert.equal(localFile.source.id, 'original-content-id');
  }
});

test('explicit location state takes precedence over list selection and tree expansion', async t => {
  const calls = [];
  await mount(t, h(FileIcon, { entry: folder, location: 'destination', selected: true, expanded: false }), {
    ...baseContext, renderIcon: context => { calls.push(context); return null; },
  });
  assert.equal(calls[0].entry.extension, '');
  assert.equal(calls[0].entry.path, '/資料');
  assert.equal(calls[0].location, 'destination');
  assert.equal(calls[0].selected, true);
  assert.equal(calls[0].expanded, false);
});

test('memoized icons ignore parent rerenders and unrelated selection while their own selection stays current', async t => {
  const calls = [];
  const selected = [];
  selected.includes = () => { throw Error('The indexed selection should be used'); };
  const renderIcon = info => { calls.push(info.selected); return h('svg', { 'data-selected': info.selected }); };
  let context = { ...baseContext, selected, selectedSet: new Set(), renderIcon };
  let renderer;
  const element = () => h(ExplorerProvider, { value: context }, h(FileIcon, { entry: file }));
  await change(() => { renderer = create(element()); });
  t.after(async () => { await change(() => renderer.unmount()); });
  assert.deepEqual(calls, [false]);
  context = { ...context, renameValue: 'typing' };
  await change(() => renderer.update(element()));
  context = { ...context, selectedSet: new Set(['photo']) };
  await change(() => renderer.update(element()));
  assert.deepEqual(calls, [false]);
  context = { ...context, selectedSet: new Set(['plan']) };
  await change(() => renderer.update(element()));
  assert.deepEqual(calls, [false, true]);
});

test('custom image icons do not read thumbnail content and switching releases fallback URLs', async t => {
  let reads = 0;
  const allocated = [];
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', () => { const url = `blob:icon-${allocated.length}`; allocated.push(url); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  const readFile = async id => { reads++; assert.equal(id, picture.source.id); return new Blob(['image']); };
  const node = h(FileThumbnail, { entry: picture, readFile });
  const custom = { ...baseContext, renderIcon: () => h('svg', { 'data-custom': 'photo' }) };
  const view = await mount(t, node, custom);
  assert.equal(reads, 0);
  assert.deepEqual(allocated, []);
  await view.update({ context: { ...baseContext, renderIcon: () => false } });
  assert.equal(reads, 0);
  await view.update({ context: { ...baseContext, renderIcon: () => null } });
  assert.equal(reads, 1);
  assert.equal(view.root.findByType('img').props.src, allocated[0]);
  await view.update({ context: { ...baseContext, selected: ['photo'] } });
  assert.equal(reads, 1, 'an unrelated parent render does not reload the same thumbnail');
  await view.update({ context: custom });
  assert.deepEqual(revoked, allocated);
  await view.update({ context: { ...baseContext, renderIcon: ({ defaultIcon }) => h('span', null, defaultIcon) } });
  assert.equal(reads, 1, 'decorating the fallback reuses its cached content');
  assert.equal(allocated.length, 2, 'the remounted fallback owns a fresh URL after the previous one was released');
  await view.unmount();
  assert.deepEqual(revoked, allocated);
});

test('pending and failed thumbnail reads never reenter renderIcon or allocate after removal', async t => {
  const allocated = [];
  t.mock.method(URL, 'createObjectURL', () => { allocated.push(true); return 'blob:late'; });
  let resolve;
  let calls = 0;
  const context = { ...baseContext, renderIcon: () => { calls++; return null; } };
  const view = await mount(t, h(FileThumbnail, {
    entry: picture, readFile: () => new Promise(done => { resolve = done; }),
  }), context);
  assert.equal(calls, 1);
  await view.update({ context: { ...baseContext, renderIcon: () => false } });
  await change(() => resolve(new Blob(['late'])));
  assert.deepEqual(allocated, []);
  calls = 0;
  await view.update({ context, node: h(FileThumbnail, { entry: picture, readFile: async () => { throw new Error('Unavailable'); } }) });
  assert.equal(calls, 1);
  assert.equal(view.root.findAllByType('svg').length, 1, 'read failure keeps the generic file icon');
});

test('tree and tab integrations customize actual folders and preserve virtual root icons', async t => {
  const calls = [];
  const context = {
    ...baseContext,
    renderIcon: info => { calls.push(info); return h('svg', { 'data-location': info.location }); },
    tabs: [{ id: 'root-tab', title: 'ファイル' }, { id: 'folder-tab', title: '資料' }],
    tabLocations: { 'root-tab': 'root', 'folder-tab': 'docs' }, activeTabId: 'folder-tab',
    expanded: ['root', 'docs'],
    instanceId: 'icons', mobileOpen: false, location: 'docs', rootLabel: 'ファイル',
    totalSize: 246, fileCount: 2, workspaceRef: { current: null },
  };
  const view = await mount(t, h('div', null, h(ExplorerTabs), h(ExplorerSidebar)), context);
  assert.deepEqual(calls.map(({ entry, location, selected, expanded }) => ({ id: entry.id, location, selected, expanded })), [
    { id: 'docs', location: 'tab', selected: true, expanded: true },
    { id: 'docs', location: 'tree', selected: true, expanded: true },
  ]);
  assert.equal(view.root.findAllByProps({ 'data-location': 'tab' }).length, 1);
  assert.equal(view.root.findAllByProps({ 'data-location': 'tree' }).length, 1);
  calls.length = 0;
  await view.update({ context: { ...context, activeTabId: 'root-tab', location: 'root', expanded: ['root'] } });
  assert.deepEqual(calls.map(({ selected, expanded }) => [selected, expanded]), [[false, false], [false, false]]);
});

test('folder tree exposes a labeled root above folders and preserves expansion when collapsed', async t => {
  const nested = { ...folder, id: 'nested', parent: 'docs', name: '内側' };
  const navigations = [];
  let expanded = ['root', 'docs'];
  let context = {
    ...baseContext, entries: [folder, nested, file], expanded,
    instanceId: 'root-tree', mobileOpen: false, location: 'docs', rootLabel: 'ストレージ',
    totalSize: 123, fileCount: 1, workspaceRef: { current: null },
    navigate: id => navigations.push(id),
    setExpanded: update => { expanded = update(expanded); },
  };
  const view = await mount(t, h(ExplorerSidebar), context);
  const rootButton = () => view.root.findByProps({ 'aria-label': `${context.rootLabel}（ルート）` });
  const tree = () => view.root.findByProps({ 'aria-label': 'フォルダ一覧' });
  const folderButton = name => tree().findAllByType('span').find(node => node.children.join('') === name)?.parent;
  assert.equal(rootButton().props.title, '/');
  assert.equal(rootButton().props['aria-current'], undefined);
  assert.equal(rootButton().parent.props.style.paddingLeft, 10);
  assert.equal(folderButton('資料').parent.props.style.paddingLeft, 24);
  assert.equal(folderButton('内側').parent.props.style.paddingLeft, 38);
  assert.equal(rootButton().findAllByType('svg').length, 1);
  assert.match(rootButton().findByType('svg').props.className, /lucide-hard-drive/);
  await change(() => rootButton().props.onClick());
  assert.deepEqual(navigations, ['root']);
  context = { ...context, location: 'root', rootLabel: '共有ファイル' };
  await view.update({ context });
  assert.equal(rootButton().props['aria-current'], 'page');
  assert.equal(view.root.findAllByProps({ 'aria-label': 'ストレージ（ルート）' }).length, 0);
  assert.equal(rootButton().findByType('span').children.join(''), '共有ファイル');

  const collapse = view.root.findByProps({ 'aria-label': '共有ファイル（ルート）を折りたたむ' });
  assert.equal(collapse.props['aria-expanded'], true);
  await change(() => collapse.props.onClick());
  context = { ...context, expanded };
  await view.update({ context });
  assert.deepEqual(expanded, ['docs'], 'collapsing root retains nested folder preferences');
  assert.equal(folderButton('資料'), undefined);
  assert.equal(folderButton('内側'), undefined);
  assert.equal(rootButton().props['aria-current'], 'page');
  const expand = view.root.findByProps({ 'aria-label': '共有ファイル（ルート）を展開' });
  assert.equal(expand.props['aria-expanded'], false);
  await change(() => expand.props.onClick());
  context = { ...context, expanded };
  await view.update({ context });
  assert.ok(folderButton('資料'));
  assert.ok(folderButton('内側'), 'expanding root restores the already open nested folders');
  assert.equal(tree().findAllByType('button').filter(button => button.props.title === '/').length, 1);
});

test('empty folder tree keeps its virtual root and delegates root drop policy to the controller', async t => {
  const navigations = [];
  const drops = [];
  const overs = [];
  const leaves = [];
  const icons = [];
  let context = {
    ...baseContext, entries: [], expanded: ['root'],
    instanceId: 'empty-tree', mobileOpen: false, location: 'root', rootLabel: 'ファイル',
    totalSize: 0, fileCount: 0, workspaceRef: { current: null },
    navigate: id => navigations.push(id), renderIcon: info => { icons.push(info); return null; },
    allowDrop: (event, id) => overs.push([event, id]),
    drop: (event, id) => drops.push([event, id]), setDragOver: id => leaves.push(id),
  };
  const view = await mount(t, h(ExplorerSidebar), context);
  const rootButton = () => view.root.findByProps({ 'aria-label': 'ファイル（ルート）' });
  assert.equal(rootButton().props['aria-current'], 'page');
  const expander = view.root.findByProps({ 'aria-label': 'ファイル（ルート）を折りたたむ' });
  assert.equal(expander.props.tabIndex, -1);
  assert.equal(expander.props['aria-expanded'], undefined);
  assert.match(expander.props.className, /invisible/);
  assert.deepEqual(icons, [], 'the virtual root does not pass a synthetic Entry to renderIcon');
  await change(() => rootButton().props.onClick());
  assert.deepEqual(navigations, ['root']);
  const dragEvent = { dataTransfer: { types: ['Files'] } };
  await change(() => rootButton().parent.props.onDragOver(dragEvent));
  assert.deepEqual(overs, [[dragEvent, 'root']]);
  context = { ...context, dragOver: 'root' };
  await view.update({ context });
  assert.match(rootButton().parent.props.className, /outline-\[var\(--explorer-accent\)\]/);
  await change(() => rootButton().parent.props.onDrop(dragEvent));
  await change(() => rootButton().parent.props.onDragLeave());
  assert.deepEqual(drops, [[dragEvent, 'root']]);
  assert.deepEqual(leaves, [null]);
  assert.deepEqual(icons, []);
});

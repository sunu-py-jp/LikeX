import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { applyAction, createDraftSnapshot, getSavePayload } from './src/model/draft.ts';
  export { ExplorerUploadValidationError } from './src/model/upload.ts';
  export { resolveExplorerOptions } from './src/model/config.ts';
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { useExplorerController } from './src/state/use-explorer-controller.ts';
  export { default as Explorer } from './src/explorer.tsx';
  export { FAVORITES, RECENT } from './src/state/view-state.ts';
`, resolveDir: packageRoot, sourcefile: 'explorer-create-contract.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'create-test' }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'create-test' }));
  builder.onLoad({ filter: /.*/, namespace: 'create-test' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
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
const { applyAction, createDraftSnapshot, getSavePayload, ExplorerUploadValidationError, resolveExplorerOptions,
  useExplorerDraft, useExplorerController, Explorer, FAVORITES, RECENT } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-create-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, name, kind = 'folder', parent = 'root') => ({ id, name, kind, parent, size: kind === 'file' ? 4 : 0,
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.split('.').at(-1).toLowerCase() : '',
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('folder', '資料'), entry('alpha', 'Alpha.txt', 'file')];
const creationLabels = ['新しいファイル', '新しいフォルダ', 'ファイルをアップロード', 'フォルダをアップロード'];
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');
const creationItems = root => root.findAllByType('mock-context-item').filter(item => creationLabels.includes(textOf(item)));
function hostPath(node) {
  const path = [];
  for (let current = node; current; current = current.parent) if (typeof current.type === 'string') path.push(current);
  return path;
}
function eventTarget(node) {
  return { closest(selector) {
    return hostPath(node).find(host => selector.split(',').some(part => {
      const attribute = /^\[([^=\]]+)(?:=['"]?([^'"\]]+)['"]?)?\]$/.exec(part.trim());
      return attribute ? Object.hasOwn(host.props, attribute[1]) && (attribute[2] === undefined || host.props[attribute[1]] === attribute[2])
        : host.type === part.trim();
    })) ?? null;
  } };
}

async function mount(t, supplied = {}, kind = 'draft') {
  let latest, renderer, closed = false;
  const events = [], saves = [], pickers = [];
  let props = { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event), ...supplied };
  function Draft({ options }) { latest = useExplorerDraft(options); return null; }
  function Controller({ options }) { latest = useExplorerController(options); return null; }
  const tree = () => h(StrictMode, null, kind === 'ui' ? h(Explorer, props) : h(kind === 'draft' ? Draft : Controller, { options: props }));
  await change(() => { renderer = create(tree(), { createNodeMock(element) {
    if (element.type === 'input' && element.props.type === 'file') {
      const node = { value: '', click() { pickers.push(element.props.webkitdirectory !== undefined ? 'folder' : 'file'); } };
      return node;
    }
    return null;
  } }); });
  events.length = 0;
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return latest; }, get root() { return renderer.root; }, events, saves, pickers, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async begin(callback) { let result; await change(() => { result = callback(); }); return { result }; },
  };
}

// Keyboard UI contract: actual controls, menus, help and address editing.
async function openKeyboardHelp(ui) {
  const item = ui.root.findAllByType('mock-dropdown-item').find(node => textOf(node) === 'キーボードショートカット');
  assert.ok(item);
  await change(() => item.props.onSelect());
}

const keyboardHelpRows = ui => Object.fromEntries(ui.root.findAllByType('kbd').map(key => [
  textOf(key.parent.findByType('span')), textOf(key),
]));

test('keyboard UI uses matching shortcut labels and accessible keys in header, context menus and help', async t => {
  const ui = await mount(t, { onRefresh: () => initialEntries() }, 'ui');
  const contracts = [
    ['コピー', 'コピー', 'Ctrl / ⌘ + C', 'Control+C Meta+C'],
    ['切り取り', '切り取り', 'Ctrl / ⌘ + X', 'Control+X Meta+X'],
    ['名前の変更', '名前を変更', 'F2', 'F2'],
    ['削除', '削除', 'Delete / ⌘ + Backspace', 'Delete Meta+Backspace'],
  ];
  for (const [headerLabel, menuLabel, hint, keys] of contracts) {
    const button = ui.root.findAllByType('button').find(node => node.props['aria-label'] === headerLabel);
    assert.ok(button, headerLabel);
    assert.equal(button.props['aria-keyshortcuts'], keys);
    assert.ok(ui.root.findAllByType('mock-tooltip-content').some(node => textOf(node) === `${headerLabel} · ${hint}`));
    const items = ui.root.findAllByType('mock-context-item').filter(node => textOf(node) === `${menuLabel}${hint}`);
    assert.ok(items.length > 0, menuLabel);
    assert.ok(items.every(node => node.props['aria-keyshortcuts'] === keys));
  }
  const paste = ui.root.findAllByType('button').find(node => node.props['aria-label'] === '貼り付け');
  assert.equal(paste.props['aria-keyshortcuts'], 'Control+V Meta+V');
  assert.ok(ui.root.findAllByType('mock-tooltip-content').some(node => textOf(node) === '貼り付け · Ctrl / ⌘ + V'));
  const openItems = ui.root.findAllByType('mock-context-item').filter(node => textOf(node) === '開くEnter / Space');
  assert.ok(openItems.length > 0);
  assert.ok(openItems.every(node => node.props['aria-keyshortcuts'] === 'Enter Space'));
  const refresh = ui.root.findAllByType('button').find(node => node.props['aria-label'] === '更新');
  assert.equal(refresh.props['aria-keyshortcuts'], 'F5');
  assert.equal(ui.root.findAllByType('input').find(node => node.props['aria-label'] === 'すべてのフォルダからファイル名で検索').props['aria-keyshortcuts'],
    'Control+F Meta+F Control+K Meta+K');
  assert.equal(ui.root.findAllByType('button').find(node => textOf(node) === '保存').props['aria-keyshortcuts'], 'Control+S Meta+S');
  await openKeyboardHelp(ui);
  assert.deepEqual(keyboardHelpRows(ui), {
    '変更を保存': 'Ctrl / ⌘ + S', '最新の内容に更新': 'F5', 'ファイルを検索': 'Ctrl / ⌘ + F / K',
    'すべて選択': 'Ctrl / ⌘ + A', 'コピー': 'Ctrl / ⌘ + C', '切り取り': 'Ctrl / ⌘ + X',
    '貼り付け': 'Ctrl / ⌘ + V', '名前を変更': 'F2', 'ファイル・フォルダを開く': 'Enter / Space',
    '削除': 'Delete / ⌘ + Backspace', '選択・切り取りを解除': 'Esc', '上のフォルダへ': 'Alt + ↑',
    '前のフォルダへ戻る': 'Alt + ←', '次のフォルダへ進む': 'Alt + →',
  });
});

test('keyboard help reflects upload-only paste, disabled features and explicit or implicit read-only mode', async t => {
  const noClipboardOrUpload = { copy: false, move: false, uploadFiles: false, uploadFolders: false };
  for (const source of ['copy', 'move', 'uploadFiles', 'uploadFolders']) await t.test(source, async child => {
    const ui = await mount(child, { features: { ...noClipboardOrUpload, [source]: true } }, 'ui');
    await openKeyboardHelp(ui);
    assert.equal(keyboardHelpRows(ui)['貼り付け'], 'Ctrl / ⌘ + V', `${source} still permits pasting`);
  });
  await t.test('disabled routes', async child => {
    const ui = await mount(child, { selection: { mode: 'none' }, features: {
      ...noClipboardOrUpload, rename: false, delete: false, search: false, preview: false,
    } }, 'ui');
    await openKeyboardHelp(ui);
    const rows = keyboardHelpRows(ui);
    for (const label of ['貼り付け', 'コピー', '切り取り', '名前を変更', '削除', 'ファイルを検索', 'すべて選択', 'ファイル・フォルダを開く'])
      assert.equal(Object.hasOwn(rows, label), false, label);
    assert.equal(rows['フォルダを開く'], 'Enter / Space');
    assert.equal(rows['変更を保存'], 'Ctrl / ⌘ + S');
  });
  for (const props of [{ readOnly: true }, { onSave: undefined }]) await t.test(Object.hasOwn(props, 'readOnly') ? 'explicit read-only' : 'no save callback', async child => {
    const ui = await mount(child, props, 'ui');
    await openKeyboardHelp(ui);
    const rows = keyboardHelpRows(ui);
    for (const label of ['変更を保存', '貼り付け', 'コピー', '切り取り', '名前を変更', '削除'])
      assert.equal(Object.hasOwn(rows, label), false, label);
    assert.equal(rows['ファイルを検索'], 'Ctrl / ⌘ + F / K');
    assert.equal(rows['すべて選択'], 'Ctrl / ⌘ + A');
    assert.equal(rows['ファイル・フォルダを開く'], 'Enter / Space');
  });
});

test('refresh shortcut is advertised only while an onRefresh callback exists, including read-only help', async t => {
  const ui = await mount(t, { readOnly: true }, 'ui');
  await openKeyboardHelp(ui);
  const refreshButtons = () => ui.root.findAllByType('button').filter(node => node.props['aria-label'] === '更新');
  assert.equal(Object.hasOwn(keyboardHelpRows(ui), '最新の内容に更新'), false);
  assert.equal(refreshButtons().length, 0);
  await ui.update({ onRefresh: () => initialEntries() });
  assert.equal(keyboardHelpRows(ui)['最新の内容に更新'], 'F5');
  assert.equal(refreshButtons()[0].props['aria-keyshortcuts'], 'F5');
  await ui.update({ onRefresh: undefined });
  assert.equal(Object.hasOwn(keyboardHelpRows(ui), '最新の内容に更新'), false);
  assert.equal(refreshButtons().length, 0);
});

test('address editing leaves IME confirmation and cancellation alone, then normal Escape cancels without navigation', async t => {
  const ui = await mount(t, {}, 'ui');
  const start = ui.root.findAllByType('button').find(node => node.props['aria-label'] === 'パスを入力');
  await change(() => start.props.onClick());
  const input = () => ui.root.findByProps({ 'aria-label': 'フォルダのパス' });
  await change(() => input().props.onChange({ target: { value: '/資料' } }));
  const before = [...ui.events];
  for (const key of ['Enter', 'Escape']) {
    for (const modifiers of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }, { defaultPrevented: true }]) {
      const event = { key, nativeEvent: {}, defaultPrevented: false, stopped: false, ...modifiers,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      await change(() => input().props.onKeyDown(event));
      assert.equal(input().props.value, '/資料');
      assert.equal(event.stopped, false);
      assert.equal(event.defaultPrevented, modifiers.defaultPrevented === true, `${key} remains native during composition`);
      assert.deepEqual(ui.events, before);
    }
  }
  const escape = { key: 'Escape', nativeEvent: {}, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
  await change(() => input().props.onKeyDown(escape));
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'フォルダのパス' }).length, 0);
  assert.equal(escape.defaultPrevented, true); assert.equal(escape.stopped, true);
  assert.deepEqual(ui.events, before);
  assert.ok(ui.root.findAllByType('button').some(node => node.props['aria-label'] === 'パスを入力'));
});
// End keyboard UI contract.

test('createFile produces a zero-byte local File and leaves persistence to the save payload', async () => {
  const baseline = createDraftSnapshot(initialEntries());
  const created = applyAction(baseline, { action: 'createFile' });
  const file = created.entries.at(-1);
  assert.equal(file.name, '新しいファイル.txt'); assert.equal(file.parent, 'root'); assert.equal(file.kind, 'file');
  assert.equal(file.size, 0); assert.equal(file.mime, 'text/plain'); assert.equal(file.source.kind, 'local');
  assert.ok(file.source.file instanceof File); assert.equal(file.source.file.name, file.name); assert.equal(file.source.file.size, 0);
  assert.equal(await file.source.file.text(), '');
  assert.deepEqual(baseline.entries, initialEntries());
  const payload = getSavePayload(baseline, created);
  assert.equal(payload.changes.created.length, 1); assert.equal(payload.changes.created[0].source.file, file.source.file);
});

test('explicit filenames and destinations are supported with correct MIME and collision rejection', () => {
  for (const [name, mime] of [['NOTE.TXT', 'text/plain'], ['Data.json', 'application/octet-stream'], ['README', 'application/octet-stream']]) {
    const baseline = createDraftSnapshot(initialEntries());
    const next = applyAction(baseline, { action: 'createFile', parent: 'folder', name });
    assert.equal(next.entries.at(-1).name, name); assert.equal(next.entries.at(-1).source.file.name, name);
    assert.equal(next.entries.at(-1).mime, mime); assert.equal(next.entries.at(-1).parent, 'folder');
    assert.throws(() => applyAction(next, { action: 'createFile', parent: 'folder', name }));
    assert.equal(next.entries.length, 3);
  }
  for (const name of ['', '../bad.txt', 'bad/name.txt', null]) assert.throws(() => applyAction(createDraftSnapshot([]), { action: 'createFile', name }));
  for (const parent of ['missing', 'alpha']) assert.throws(() => applyAction(createDraftSnapshot(initialEntries()), { action: 'createFile', parent }));
});

test('new files obey upload suffix and size policy, and a single rejected creation is never silently skipped', () => {
  const baseline = createDraftSnapshot(initialEntries());
  const accepted = applyAction(baseline, { action: 'createFile', name: 'Allowed.TXT' }, { allowedExtensions: ['.txt'], maxFileSizeBytes: 0 });
  assert.equal(accepted.entries.at(-1).size, 0);
  for (const invalidFileBehavior of ['reject-batch', 'skip']) {
    assert.throws(() => applyAction(baseline, { action: 'createFile', name: 'Rejected.exe' }, { allowedExtensions: ['.txt'], invalidFileBehavior }), ExplorerUploadValidationError);
    assert.throws(() => applyAction(baseline, { action: 'createFile' }, { allowedExtensions: [], invalidFileBehavior }), ExplorerUploadValidationError);
  }
  assert.throws(() => applyAction(baseline, { action: 'createFile' }, { maxFileSizeBytes: -1 }));
  assert.deepEqual(baseline.entries, initialEntries());
});

test('createFile defaults on, is independent of uploadFiles, and is forced off by read-only', () => {
  assert.equal(resolveExplorerOptions().features.createFile, true);
  assert.equal(resolveExplorerOptions({ features: { uploadFiles: false } }).features.createFile, true);
  assert.equal(resolveExplorerOptions({ features: { createFile: false } }).features.uploadFiles, true);
  assert.equal(resolveExplorerOptions({ readOnly: true, features: { createFile: true } }).features.createFile, false);
});

test('the hook creates locally, emits a createFile change, and saves the original empty File only on save', async t => {
  const hook = await mount(t);
  await change(() => hook.current.apply({ action: 'createFile', name: 'Empty.txt', parent: 'folder' }));
  const file = hook.current.entries.at(-1).source.file;
  assert.equal(hook.current.dirty, true); assert.deepEqual(hook.saves, []);
  const changes = hook.events.filter(event => event.type === 'change');
  assert.equal(changes.length, 1); assert.equal(changes[0].action, 'createFile');
  assert.equal(changes[0].changes.created[0].path, '/資料/Empty.txt'); assert.equal(changes[0].changes.created[0].source.file, file);
  await change(async () => assert.equal(await hook.current.save(), true));
  assert.equal(hook.saves.length, 1); assert.equal(hook.saves[0].changes.created[0].source.file, file);
  assert.equal(hook.current.dirty, false);
});

test('failed creation preserves existing dirty data and save errors and emits no change or upload event', async t => {
  const hook = await mount(t, { onSave() { throw Error('Not saved'); }, upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  await change(() => hook.current.apply({ action: 'createFile', name: 'Keep.txt' }));
  await change(() => hook.current.save());
  const before = hook.current.entries, eventCount = hook.events.length;
  await change(() => assert.throws(() => hook.current.apply({ action: 'createFile', name: 'Rejected.exe' }), ExplorerUploadValidationError));
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true); assert.equal(hook.current.saveError, 'Not saved');
  assert.equal(hook.events.length, eventCount);
  await hook.update({ upload: { allowedExtensions: ['.exe'] } });
  await change(() => hook.current.apply({ action: 'createFile', name: 'Allowed.exe' }));
  assert.equal(hook.current.entries.at(-1).name, 'Allowed.exe');
});

test('new-file controllers honor feature gates and read-only without disabling ordinary uploads', async t => {
  const disabled = await mount(t, { features: { createFile: false } }, 'controller');
  await change(() => assert.equal(disabled.current.act('createFile', [], { name: 'Blocked.txt' }), false));
  assert.equal(disabled.current.dirty, false);
  await change(() => disabled.current.addLocalFiles([new File(['upload'], 'Uploaded.txt')]));
  assert.equal(disabled.current.entries.at(-1).name, 'Uploaded.txt');
  const allowed = await mount(t, { features: { uploadFiles: false } }, 'controller');
  await change(() => assert.equal(allowed.current.act('createFile', [], { name: 'Created.txt' }), true));
  assert.equal(allowed.current.entries.at(-1).name, 'Created.txt');
  for (const props of [{ readOnly: true }, { onSave: undefined }]) {
    const readonly = await mount(t, props, 'controller');
    await change(() => assert.equal(readonly.current.act('createFile', [], { name: 'Blocked.txt' }), false));
    assert.equal(readonly.current.dirty, false); assert.equal(readonly.current.features.createFile, false);
  }
});

test('new file creation obtains permission once, waits without a staged entry, and honors rejection', async t => {
  for (const allowed of [false, true]) await t.test(String(allowed), async subtest => {
    const pending = deferred(), requests = [];
    const hook = await mount(subtest, { onEditRequest(request) { requests.push(request); return pending.promise; } }, 'controller');
    const first = await hook.begin(() => hook.current.act('createFile', [], { name: 'Waiting.txt', parent: 'folder' }));
    assert.equal(hook.current.entries.length, 2); assert.equal(hook.current.dirty, false); assert.equal(requests[0].action, 'createFile');
    await change(async () => { pending.resolve(allowed); assert.equal(await first.result, allowed); });
    assert.equal(hook.current.entries.length, allowed ? 3 : 2); assert.equal(hook.current.dirty, allowed);
    if (allowed) assert.equal(hook.current.entries.at(-1).parent, 'folder');
    assert.equal(requests.length, 1);
  });
});

test('new-file modal uses the default filename and supports a supplied name before creation', async t => {
  const hook = await mount(t, {}, 'controller');
  await change(() => hook.current.navigate('folder'));
  await change(() => hook.current.showModal('createFile', []));
  assert.equal(hook.current.modal.type, 'createFile'); assert.equal(hook.current.name, '新しいファイル.txt');
  await change(() => hook.current.setName('Specified.md'));
  await change(() => hook.current.submitModal());
  const file = hook.current.entries.at(-1);
  assert.equal(file.name, 'Specified.md'); assert.equal(file.parent, 'folder'); assert.equal(file.source.file.size, 0);
  assert.equal(hook.current.modal, null);
});

test('blank-space context menu offers all four additions without toolbar/tree creation controls or entry-menu duplicates', async t => {
  const ui = await mount(t, {}, 'ui');
  assert.deepEqual(creationItems(ui.root).map(textOf).sort(), [...creationLabels].sort());
  const toolbar = ui.root.findByProps({ 'aria-label': 'ファイル操作' });
  assert.equal(toolbar.findAllByType('button').some(button => textOf(button).includes('新規作成')), false);
  const tree = ui.root.findByProps({ 'aria-label': 'エクスプローラーのナビゲーション' });
  assert.equal(tree.findAllByType('button').some(button => /フォルダを追加|新しいフォルダ/.test(button.props['aria-label'] ?? textOf(button))), false);
  const menus = ui.root.findAllByType('mock-context-content');
  const additions = menus.filter(menu => creationItems(menu).length > 0);
  assert.equal(additions.length, 1, 'only the blank-space context menu contains creation items');
});

test('each creation context item disappears with its own feature, and contextMenu=false or read-only removes all four', async t => {
  for (const [feature, label] of [['createFile', '新しいファイル'], ['createFolder', '新しいフォルダ'], ['uploadFiles', 'ファイルをアップロード'], ['uploadFolders', 'フォルダをアップロード']]) {
    const ui = await mount(t, { features: { [feature]: false } }, 'ui');
    assert.deepEqual(creationItems(ui.root).map(textOf).sort(), creationLabels.filter(value => value !== label).sort());
  }
  for (const props of [{ ui: { contextMenu: false } }, { readOnly: true }, { onSave: undefined }]) {
    const ui = await mount(t, props, 'ui');
    assert.equal(creationItems(ui.root).length, 0);
  }
});

test('special favorites and recent locations offer no blank-space creation actions', async t => {
  for (const label of ['お気に入り', '最近更新した項目']) {
    const ui = await mount(t, {}, 'ui');
    const navigation = ui.root.findByProps({ 'aria-label': 'ファイルの場所' });
    const button = navigation.findAllByType('button').find(node => textOf(node) === label);
    await change(() => button.props.onClick());
    assert.equal(creationItems(ui.root).length, 0);
  }
});

test('special controller locations do not offer create-file or create-folder modals', async t => {
  const hook = await mount(t, {}, 'controller');
  for (const location of [FAVORITES, RECENT]) {
    await change(() => hook.current.navigate(location));
    for (const type of ['create', 'createFile']) await change(() => hook.current.showModal(type, []));
    assert.equal(hook.current.modal, null); assert.equal(hook.current.dirty, false);
  }
});

test('entry right-click preserves its own selection and suppresses the outer blank-space menu, while empty space is accepted', async t => {
  const ui = await mount(t, {}, 'ui');
  const row = ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === 'alpha')[0];
  const path = hostPath(row);
  const outer = path.find(node => node.type === 'div' && node.props.onContextMenu && node.props.className?.includes('overflow-auto'));
  assert.ok(outer);
  const event = { target: eventTarget(row), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  await change(() => { for (const host of path) host.props.onContextMenu?.(event); });
  assert.equal(event.defaultPrevented, true, 'the outer Radix trigger must not open for an entry target');
  assert.deepEqual(ui.events.filter(event => event.type === 'selection').at(-1).ids, ['alpha']);
  const blank = { target: eventTarget(outer), defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  await change(() => outer.props.onContextMenu(blank));
  assert.equal(blank.defaultPrevented, false);
  assert.deepEqual(ui.events.filter(event => event.type === 'selection').at(-1).ids, []);
});

test('blank-space create items submit into the displayed folder through the actual dialog', async t => {
  for (const [label, name, action] of [['新しいファイル', 'Menu.txt', 'createFile'], ['新しいフォルダ', 'Menu folder', 'create']]) {
    const ui = await mount(t, {}, 'ui');
    const navigation = ui.root.findByProps({ 'aria-label': 'エクスプローラーのナビゲーション' });
    await change(() => navigation.findAllByType('button').find(button => textOf(button) === '資料').props.onClick());
    await change(() => creationItems(ui.root).find(item => textOf(item) === label).props.onSelect());
    const fieldLabel = ui.root.findAllByType('label').find(item => textOf(item) === (action === 'createFile' ? 'ファイル名' : 'フォルダ名'));
    assert.ok(fieldLabel);
    const input = ui.root.findByProps({ id: fieldLabel.props.htmlFor });
    await change(() => input.props.onChange({ target: { value: name } }));
    await change(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {}, stopPropagation() {} }));
    const added = ui.events.find(event => event.type === 'change' && event.action === action).changes.created[0];
    assert.equal(added.parent, 'folder'); assert.equal(added.path, `/資料/${name}`);
    assert.deepEqual(ui.saves, []);
  }
});

test('creation feature changes invalidate an open create-file dialog and its retained submit callback', async t => {
  const hook = await mount(t, {}, 'controller');
  await change(() => hook.current.showModal('createFile'));
  const submit = hook.current.submitModal;
  await hook.update({ features: { createFile: false } });
  assert.equal(hook.current.modal, null);
  await change(() => submit());
  assert.equal(hook.current.entries.length, 2); assert.equal(hook.current.dirty, false);
});

test('file and folder pickers add into the folder captured when the chooser opened even after navigation', async t => {
  for (const source of ['file', 'folder']) await t.test(source, async subtest => {
    const hook = await mount(subtest, {}, 'controller');
    let opened = 0;
    hook.current.fileInput.current = { click() { opened++; } };
    hook.current.folderInput.current = { click() { opened++; } };
    await change(() => hook.current.navigate('folder'));
    await change(() => hook.current.chooseFiles(source === 'folder'));
    await change(() => hook.current.navigate('root'));
    const file = new File(['picked'], 'Picked.txt');
    if (source === 'folder') Object.defineProperty(file, 'webkitRelativePath', { value: 'Batch/Picked.txt' });
    await change(() => hook.current.acceptChosenFiles([file], source));
    assert.equal(opened, 1);
    const added = hook.current.entries.find(item => item.source?.kind === 'local');
    assert.equal(added.source.file, file);
    assert.equal(source === 'file' ? added.parent : hook.current.entries.find(item => item.id === added.parent).parent, 'folder');
  });
});

test('a cancelled picker cannot stage stale browser selections after save, discard, endEdit, read-only, feature disable or unmount', async t => {
  for (const finish of ['save', 'discard', 'endEdit', 'readOnly', 'feature', 'cancel', 'unmount']) await t.test(finish, async subtest => {
    const hook = await mount(subtest, {}, 'controller');
    hook.current.fileInput.current = { click() {} };
    await change(() => hook.current.chooseFiles());
    if (finish === 'save') await change(() => hook.current.saveChanges());
    if (finish === 'discard') { await change(() => hook.current.showModal('discard')); await change(() => hook.current.submitModal()); }
    if (finish === 'endEdit') await change(() => hook.current.endEditing());
    if (finish === 'readOnly') await hook.update({ readOnly: true });
    if (finish === 'feature') await hook.update({ features: { uploadFiles: false } });
    if (finish === 'cancel') await change(() => hook.current.cancelFilePicker('file'));
    if (finish === 'unmount') await hook.unmount();
    else await hook.update({ readOnly: false, features: { uploadFiles: true } });
    await change(() => hook.current.acceptChosenFiles([new File(['stale'], 'Stale.txt')]));
    assert.equal(hook.current.entries.length, 2); assert.equal(hook.current.dirty, false);
  });
});

test('actual blank-space upload items and file-input change handlers preserve the chosen folder across navigation', async t => {
  for (const source of ['file', 'folder']) await t.test(source, async subtest => {
    const ui = await mount(subtest, {}, 'ui');
    const navigation = () => ui.root.findByProps({ 'aria-label': 'エクスプローラーのナビゲーション' });
    await change(() => navigation().findAllByType('button').find(button => textOf(button) === '資料').props.onClick());
    await change(() => creationItems(ui.root).find(item => textOf(item) === (source === 'file' ? 'ファイルをアップロード' : 'フォルダをアップロード')).props.onSelect());
    assert.deepEqual(ui.pickers, [source]);
    await change(() => navigation().findAllByType('button').find(button => textOf(button) === 'ファイル').props.onClick());
    const file = new File(['picked'], 'Connected.txt');
    if (source === 'folder') Object.defineProperty(file, 'webkitRelativePath', { value: 'Batch/Connected.txt' });
    const target = { files: [file], value: 'fake-path' };
    const input = ui.root.findByProps({ 'aria-label': source === 'file' ? '追加するファイル' : '追加するフォルダ' });
    await change(() => input.props.onChange({ target }));
    const added = ui.events.find(event => event.type === 'change' && event.action === 'upload').changes.created;
    assert.equal(added.find(item => item.kind === 'file').path, source === 'file' ? '/資料/Connected.txt' : '/資料/Batch/Connected.txt');
    assert.equal(added.find(item => item.kind === 'file').source.file, file); assert.equal(target.value, '');
  });
});

test('actual rename input requests permission only on commit, becomes read-only while waiting and allows Escape cancellation', async t => {
  const pending = deferred(), calls = [];
  const ui = await mount(t, { onEditRequest(request, context) { calls.push({ request, context }); return pending.promise; } }, 'ui');
  const row = ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === 'alpha')[0];
  let menu = row;
  while (menu && menu.type !== 'mock-context-root') menu = menu.parent;
  assert.ok(menu);
  await change(() => menu.findAllByType('mock-context-item').find(item => textOf(item).startsWith('名前を変更')).props.onSelect());
  const input = () => ui.root.findByProps({ 'data-explorer-rename-input': 'alpha' });
  assert.equal(input().props.value, 'Alpha'); assert.equal(input().props.readOnly, false); assert.equal(calls.length, 0);
  await change(() => input().props.onChange({ target: { value: 'Requested' } }));
  const key = value => ({ key: value, nativeEvent: {}, preventDefault() {}, stopPropagation() {} });
  await change(() => input().props.onKeyDown(key('Enter')));
  assert.equal(calls.length, 1); assert.equal(input().props.readOnly, true); assert.equal(input().props.value, 'Requested');
  await change(() => { input().props.onKeyDown(key('Enter')); input().props.onBlur(); });
  assert.equal(calls.length, 1, 'Enter and blur cannot submit twice during a pending permission decision');
  assert.equal(ui.root.findAllByType('button').some(button => textOf(button) === '編集を終了'), false);
  await change(() => input().props.onKeyDown(key('Escape')));
  assert.equal(calls[0].context.signal.aborted, true);
  await change(() => pending.resolve(true));
  assert.equal(ui.root.findAllByProps({ 'data-explorer-rename-input': 'alpha' }).length, 0);
  assert.equal(ui.events.filter(event => event.type === 'change').length, 0);
});

test('the actual toolbar keeps Save and omits an end-edit button before and after a permitted change', async t => {
  let calls = 0;
  const ui = await mount(t, { onEditRequest() { calls++; return true; } }, 'ui');
  const toolbar = () => ui.root.findByProps({ 'aria-label': 'ファイル操作' });
  const assertControls = saveDisabled => {
    assert.equal(toolbar().findAllByType('button').some(button => textOf(button) === '編集を終了'), false);
    const save = toolbar().findAllByType('button').find(button => textOf(button) === '保存');
    assert.ok(save);
    assert.equal(save.props.disabled, saveDisabled);
    assert.doesNotMatch(textOf(ui.root), /閲覧中|編集中|未保存の変更/);
  };
  assertControls(true);
  await change(() => creationItems(ui.root).find(item => textOf(item) === '新しいファイル').props.onSelect());
  assert.equal(calls, 0);
  await change(() => ui.root.findByType('form').props.onSubmit({ preventDefault() {}, stopPropagation() {} }));
  assert.equal(calls, 1); assert.equal(ui.events.filter(event => event.type === 'change').length, 1);
  assertControls(false);
});

test('the actual view omits file-kind controls, the kind column and title bar while search and sorting still include all files', async t => {
  const ui = await mount(t, { initialEntries: [entry('folder', '資料'), entry('alpha', 'Zulu.txt', 'file'),
    { ...entry('photo', 'Alpha.png', 'file'), mime: 'image/png' }] }, 'ui');
  const rows = () => ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id']).map(node => node.props['data-explorer-entry-id']);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'ファイル種類で絞り込み' }).length, 0);
  assert.equal(ui.root.findAllByType('option').some(node => textOf(node) === 'すべての種類'), false);
  assert.deepEqual(rows(), ['folder', 'photo', 'alpha']);
  assert.equal(ui.root.findAllByType('th').some(node => textOf(node) === '種類'), false);
  const list = () => ui.root.findByProps({ 'aria-label': 'ファイル一覧' });
  const assertNoTitleBar = () => assert.equal(list().children.some(node => typeof node === 'object' && node.type === 'div' && node.props.className?.split(' ').includes('lxe:h-10')), false);
  assertNoTitleBar();
  const search = () => ui.root.findByProps({ 'aria-label': 'すべてのフォルダからファイル名で検索' });
  await change(() => search().props.onChange({ target: { value: '.txt' } }));
  assert.deepEqual(rows(), ['alpha']);
  assertNoTitleBar();
  assert.equal(list().findAllByType('span').some(node => textOf(node) === '「.txt」の検索結果'), false);
  await change(() => search().props.onChange({ target: { value: '' } }));
  const order = ui.root.findAllByType('mock-dropdown-radiogroup').find(node => node.props.value === 'asc');
  await change(() => order.props.onValueChange('desc'));
  assert.deepEqual(rows(), ['folder', 'alpha', 'photo']);
  const views = ui.events.filter(event => event.type === 'view');
  assert.ok(views.length >= 3); assert.ok(views.every(event => !Object.hasOwn(event, 'filter')));
  assert.deepEqual(views.at(-1).sort, { key: 'name', asc: false });
});

test('extension column sits between modified date and size, sorts by extension and leaves folders blank', async t => {
  const ui = await mount(t, { initialEntries: [entry('folder', 'Folder.With.Dot'),
    entry('json', 'A.JSON', 'file'), entry('word', 'B.docx', 'file'), entry('plain', 'README', 'file')] }, 'ui');
  const headers = ui.root.findAllByType('th').map(textOf);
  assert.deepEqual(headers.filter(Boolean), ['名前', '更新日時', '拡張子', 'サイズ', '操作']);
  const row = id => ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === id)[0];
  const extensionCell = id => row(id).findAllByType('td')[3];
  assert.equal(textOf(extensionCell('json')), 'json');
  assert.equal(textOf(extensionCell('word')), 'docx');
  assert.equal(textOf(extensionCell('plain')), '');
  assert.equal(textOf(extensionCell('folder')), '');
  const header = ui.root.findAllByType('th').find(node => textOf(node) === '拡張子');
  await change(() => header.findByType('button').props.onClick());
  assert.deepEqual(ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id']).map(node => node.props['data-explorer-entry-id']), ['folder', 'plain', 'word', 'json']);
  assert.deepEqual(ui.events.filter(event => event.type === 'view').at(-1).sort, { key: 'extension', asc: true });
});

test('recent files have no folder-name subtitle while ordinary search keeps location context', async t => {
  const ui = await mount(t, { initialEntries: [entry('folder', 'ドキュメント'), entry('alpha', 'A.pdf', 'file', 'folder')] }, 'ui');
  const select = name => ui.root.findAllByType('button').find(node => textOf(node) === name);
  const row = () => ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === 'alpha')[0];
  await change(() => select('最近更新した項目').props.onClick());
  assert.equal(row().findAllByType('small').length, 0);
  const search = () => ui.root.findByProps({ 'aria-label': 'すべてのフォルダからファイル名で検索' });
  await change(() => search().props.onChange({ target: { value: 'A.pdf' } }));
  assert.equal(row().findAllByType('small').length, 0);
  await change(() => select('ファイル').props.onClick());
  await change(() => search().props.onChange({ target: { value: 'A.pdf' } }));
  assert.equal(textOf(row().findByType('small')), 'ドキュメント');
});

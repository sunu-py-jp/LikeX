import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { ExplorerPicker, ExplorerPickerDialog } from './src/explorer-picker.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-picker-ui.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
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
            if (['Provider', 'Portal'].includes(part) || (part === 'Root' && !['context', 'dialog'].includes(kind))) return children;
            if (asChild && isValidElement(children)) return cloneElement(children, props);
            return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
          }
        ]));
      }
      export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
        Dialog = family('dialog'), AlertDialog = family('alert');`,
  }));
} }] });
const { ExplorerPicker, ExplorerPickerDialog } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-picker-ui.mjs').toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-10-04T00:00:00.000Z', updatedAt: '2026-10-04T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt'),
  entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested.txt', 'folder')];
const textOf = node => typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('');
const row = (ui, id) => ui.root.findAll(node => typeof node.type === 'string' && node.props['data-explorer-entry-id'] === id)[0];
const button = (ui, label = '選択') => ui.root.findAllByType('button').find(node => textOf(node) === label);
const mouse = (extra = {}) => ({ target: { closest: () => null }, button: 0, detail: 1,
  preventDefault() {}, stopPropagation() {}, ...extra });
const keyEvent = (key, extra = {}) => { const target = { closest: () => null }; return {
  target, currentTarget: target, key, preventDefault() {}, stopPropagation() {}, ...extra,
}; };

async function mount(t, supplied = {}, dialog = false) {
  let renderer, closed = false;
  const ref = { current: null }, confirmed = [], selected = [], cancelled = [], changes = [], events = [];
  let props = { initialEntries: initialEntries(), ref,
    onConfirm: (items, context) => { confirmed.push({ items, signal: context.signal }); },
    onSelectionChange: items => selected.push(items), onCancel: () => cancelled.push(true),
    onEvent: event => events.push(event),
    ...(dialog ? { open: true, onOpenChange: open => changes.push(open) } : {}), ...supplied };
  const tree = () => h(StrictMode, null, h(dialog ? ExplorerPickerDialog : ExplorerPicker, props));
  await change(() => { renderer = create(tree()); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { ref, confirmed, selected, cancelled, changes, events, get root() { return renderer.root; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); } };
}

test('click selects without confirming and the explicit confirmation returns file metadata', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.selected, [[]]);
  assert.equal(button(ui).props.disabled, true);
  await change(() => row(ui, 'alpha').props.onClick(mouse()));
  assert.deepEqual(ui.selected.at(-1).map(item => item.id), ['alpha']);
  assert.equal(ui.confirmed.length, 0);
  assert.equal(button(ui).props.disabled, false);
  await change(() => button(ui).props.onClick());
  assert.equal(ui.confirmed.length, 1);
  assert.equal(ui.confirmed[0].items[0].path, '/Alpha.txt');
  assert.equal(ui.confirmed[0].signal.aborted, false);
  assert.equal(ui.events.some(event => event.type === 'change' || event.type === 'save'), false);
});

test('host footer messages update without resetting selection or triggering picker actions', async t => {
  for (const dialog of [false, true]) await t.test(dialog ? 'dialog' : 'embedded', async t => {
    const ui = await mount(t, { footerMessage: '<b>共有する資料を選択してください</b>' }, dialog);
    const message = () => ui.root.findByProps({ 'data-explorer-picker-message': true });
    assert.deepEqual(message().children, ['<b>共有する資料を選択してください</b>'], 'strings remain literal text');
    await change(() => row(ui, 'alpha').props.onClick(mouse()));
    let helpOpened = 0;
    await ui.update({ footerMessage: h('div', null,
      h('span', null, '共有範囲を確認してください。'),
      h('button', { type: 'button', onClick: () => { helpOpened++; } }, '共有の説明')) });
    await change(() => message().findByType('button').props.onClick());
    assert.equal(helpOpened, 1);
    assert.deepEqual(ui.selected.at(-1).map(item => item.id), ['alpha']);
    assert.equal(ui.confirmed.length, 0);
    assert.equal(ui.cancelled.length, 0);
    assert.equal(button(ui).props.disabled, false);
    await ui.update({ footerMessage: null });
    assert.equal(ui.root.findAllByProps({ 'data-explorer-picker-message': true }).length, 0);
    await change(() => button(ui).props.onClick());
    assert.deepEqual(ui.confirmed.at(-1).items.map(item => item.id), ['alpha']);
  });
});

test('folder picker can confirm the virtual root and the currently open nested folder', async t => {
  const ui = await mount(t, { kind: 'folder', rootLabel: '共有資料' });
  await change(() => button(ui, '現在のフォルダを選択').props.onClick());
  assert.deepEqual(ui.confirmed[0].items, [{ kind: 'root', id: 'root', path: '/', name: '共有資料' }]);
  await change(() => row(ui, 'folder').props.onDoubleClick(mouse({ detail: 2 })));
  assert.equal(ui.confirmed.length, 1, 'opening a folder never confirms it');
  await change(async () => assert.equal(await ui.ref.current.selectCurrentFolder(), true));
  assert.equal(ui.confirmed[1].items[0].kind, 'folder');
  assert.equal(ui.confirmed[1].items[0].id, 'folder');
  assert.equal(ui.confirmed[1].items[0].path, '/Folder');
});

test('file double-click and Enter use confirmation while folder Enter only navigates', async t => {
  const ui = await mount(t);
  await change(() => row(ui, 'alpha').props.onDoubleClick(mouse({ detail: 2 })));
  assert.deepEqual(ui.confirmed.map(call => call.items[0].id), ['alpha']);
  await change(() => row(ui, 'beta').props.onKeyDown(keyEvent('Enter')));
  assert.deepEqual(ui.confirmed.map(call => call.items[0].id), ['alpha', 'beta']);
  await change(() => row(ui, 'folder').props.onKeyDown(keyEvent('Enter')));
  assert.equal(ui.confirmed.length, 2);
  assert.ok(row(ui, 'nested'));
  assert.equal(row(ui, 'alpha'), undefined);
});

test('initial IDs are observed once and ref confirmation uses the same single, multiple and kind rules', async t => {
  const ui = await mount(t, { multiple: true, initialSelectedIds: ['alpha', 'beta'] });
  assert.deepEqual(ui.selected.at(-1).map(item => item.id), ['alpha', 'beta']);
  assert.equal(ui.confirmed.length, 0);
  await ui.update({ initialSelectedIds: ['folder'] });
  assert.deepEqual(ui.selected.at(-1).map(item => item.id), ['alpha', 'beta']);
  await change(async () => assert.equal(await ui.ref.current.confirm(), true));
  assert.deepEqual(ui.confirmed[0].items.map(item => item.id), ['alpha', 'beta']);
  await change(() => assert.equal(ui.ref.current.selectEntries([{ id: 'folder' }]).ok, false));
  await change(() => assert.equal(ui.ref.current.navigate('/Folder').ok, true));
  await change(() => assert.equal(ui.ref.current.selectFiles([{ id: 'nested' }]).ok, true));
  await change(async () => assert.equal(await ui.ref.current.confirm(), true));
  assert.equal(ui.confirmed[1].items[0].path, '/Folder/Nested.txt');
  assert.equal(await ui.ref.current.selectCurrentFolder(), false);
  const invalid = await mount(t, { initialSelectedIds: ['alpha', 'beta'] });
  assert.deepEqual(invalid.selected.at(-1), []);
  assert.equal(button(invalid).props.disabled, true);
  assert.ok(invalid.root.findAllByProps({ role: 'alert' }).length > 0);
  const mixed = await mount(t, { kind: 'both', multiple: true, initialSelectedIds: ['folder', 'alpha'] });
  await change(async () => assert.equal(await mixed.ref.current.confirm(), true));
  assert.deepEqual(mixed.confirmed[0].items.map(item => item.kind), ['folder', 'file']);
});

test('async rejection retains the selected items, suppresses duplicate confirmation and allows retry', async t => {
  const pending = deferred();
  const calls = [];
  let completion;
  const ui = await mount(t, { initialSelectedIds: ['alpha'], onConfirm(items, { signal }) {
    calls.push({ items, signal }); return calls.length === 1 ? pending.promise : undefined;
  } }, true);
  await change(() => { completion = ui.ref.current.confirm(); });
  assert.equal(calls.length, 1);
  assert.equal(button(ui).props.disabled, true);
  assert.ok(textOf(ui.root).includes('選択を確定しています'));
  await change(async () => assert.equal(await ui.ref.current.confirm(), false));
  assert.equal(calls.length, 1);
  await change(async () => { pending.reject(new Error('保存先で拒否されました')); assert.equal(await completion, false); });
  assert.deepEqual(ui.changes, []);
  assert.deepEqual(ui.selected.at(-1).map(item => item.id), ['alpha']);
  assert.equal(button(ui).props.disabled, false);
  assert.ok(ui.root.findAllByProps({ role: 'alert' }).some(node => textOf(node).includes('保存先で拒否されました')));
  await change(async () => assert.equal(await ui.ref.current.confirm(), true));
  assert.equal(calls.length, 2);
  assert.deepEqual(ui.changes, [false]);
});

test('dialog cancellation aborts a pending request and ignores its later success', async t => {
  const pending = deferred();
  let signal, completion;
  const ui = await mount(t, { initialSelectedIds: ['alpha'], onConfirm(_, context) { signal = context.signal; return pending.promise; } }, true);
  await change(() => { completion = ui.ref.current.confirm(); });
  assert.equal(signal.aborted, false);
  await change(() => button(ui, 'キャンセル').props.onClick());
  assert.equal(signal.aborted, true);
  assert.deepEqual(ui.cancelled, [true]);
  assert.deepEqual(ui.changes, [false]);
  await change(async () => { pending.resolve(); assert.equal(await completion, false); });
  assert.deepEqual(ui.changes, [false], 'late completion must not close the dialog a second time');
});

test('unmount aborts pending confirmation and captured handles cannot act on the closed picker', async t => {
  const pending = deferred();
  let signal, completion;
  const ui = await mount(t, { initialSelectedIds: ['alpha'], onConfirm(_, context) { signal = context.signal; return pending.promise; } }, true);
  const handle = ui.ref.current;
  await change(() => { completion = handle.confirm(); });
  await ui.unmount();
  assert.equal(signal.aborted, true);
  assert.equal(ui.ref.current, null);
  assert.equal(await handle.confirm(), false);
  assert.equal(await handle.selectCurrentFolder(), false);
  handle.cancel();
  assert.deepEqual(ui.cancelled, []);
  pending.resolve();
  assert.equal(await completion, false);
  assert.deepEqual(ui.changes, []);
});

test('navigation or selection changes abort old confirmation without a stale dialog close', async t => {
  const requests = [];
  let first, second;
  const ui = await mount(t, { initialSelectedIds: ['alpha'], onConfirm(items, { signal }) {
    const pending = deferred(); requests.push({ ...pending, signal, items }); return pending.promise;
  } }, true);
  await change(() => { first = ui.ref.current.confirm(); });
  await change(() => assert.equal(ui.ref.current.navigate('/Folder').ok, true));
  assert.equal(requests[0].signal.aborted, true);
  await change(() => assert.equal(ui.ref.current.selectFiles([{ id: 'nested' }]).ok, true));
  await change(() => { second = ui.ref.current.confirm(); });
  assert.equal(requests[1].signal.aborted, false);
  await change(async () => { requests[0].resolve(); assert.equal(await first, false); });
  assert.deepEqual(ui.changes, []);
  assert.equal(button(ui).props.disabled, true, 'old completion must not clear the newer pending request');
  await change(async () => { requests[1].resolve(); assert.equal(await second, true); });
  assert.deepEqual(ui.changes, [false]);
  assert.equal(requests[1].items[0].path, '/Folder/Nested.txt');
});

test('Enter activation keeps its own async request alive through the row-selection update', async t => {
  const pending = deferred();
  let signal;
  const ui = await mount(t, { onConfirm(_, context) { signal = context.signal; return pending.promise; } }, true);
  await change(() => row(ui, 'alpha').props.onKeyDown(keyEvent('Enter')));
  assert.ok(signal);
  assert.equal(signal.aborted, false, 'the selection caused by activation belongs to the same confirmation');
  assert.equal(button(ui).props.disabled, true);
  await change(() => pending.resolve());
  assert.deepEqual(ui.changes, [false]);
});

test('dialog dismissal uses cancellation and reopening creates a fresh picker session', async t => {
  const ui = await mount(t, { dialogTitle: '添付ファイルを選択', confirmLabel: '添付', cancelLabel: '閉じる' }, true);
  assert.ok(textOf(ui.root).includes('添付ファイルを選択'));
  assert.ok(button(ui, '添付'));
  assert.ok(button(ui, '閉じる'));
  await change(() => row(ui, 'alpha').props.onClick(mouse()));
  await change(() => ui.root.findByType('mock-dialog-root').props.onOpenChange(false));
  assert.deepEqual(ui.cancelled, [true]);
  assert.deepEqual(ui.changes, [false]);
  await ui.update({ open: false });
  assert.equal(ui.ref.current, null);
  assert.equal(ui.root.findAll(node => Object.hasOwn(node.props, 'data-explorer-picker-footer')).length, 0);
  await ui.update({ open: true });
  assert.ok(ui.ref.current);
  assert.deepEqual(ui.selected.at(-1), []);
  assert.equal(button(ui, '添付').props.disabled, true);
});

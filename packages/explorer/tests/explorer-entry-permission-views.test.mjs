import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
    export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  `, resolveDir: packageRoot, sourcefile: 'explorer-entry-permission-views.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerWorkspace, useExplorerViewController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`,
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const entry = (id, parent = 'root', kind = 'file') => ({
  id, parent, kind, name: kind === 'file' ? `${id}.txt` : id,
  size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '',
  source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', favorite: 0,
});
const initialEntries = () => [entry('folder', 'root', 'folder'), entry('child', 'folder'), entry('alpha'), entry('beta')];
function fakeDocument() {
  const writes = [], anchors = [];
  return { writes, anchors, defaultView: Object.assign(new EventTarget(), {
    closed: false, navigator: { clipboard: { writeText: async text => { writes.push(text); } } },
  }), addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], getElementById: () => null,
    body: { appendChild() {} }, createElement() {
      const anchor = { click() { anchors.push(this); }, remove() {} }; return anchor;
    },
  };
}
async function mount(t, supplied = {}, shared = false) {
  const events = [], reads = [], panes = new Map(), document = fakeDocument(), popupDocument = fakeDocument(), ref = createRef();
  let props = { ref, initialEntries: initialEntries(), onSave: () => {},
    readFile: async id => { reads.push(id); return new Blob(['text']); },
    onEvent: event => { events.push(event); }, ...supplied };
  let workspace, renderer;
  function Pane({ options, workspace, windowId, ownerDocument }) {
    panes.set(windowId, useExplorerViewController(options, workspace, windowId, ownerDocument));
    return null;
  }
  function Probe({ options }) {
    workspace = useExplorerWorkspace(options);
    useLayoutEffect(() => {
      if (shared && !workspace.tabs.forWindow('popup').tabs.length) workspace.tabs.forWindow('popup').addTab();
    }, []);
    return [h(Pane, { key: 'main', options, workspace, windowId: 'main', ownerDocument: document }),
      ...(shared ? [h(Pane, { key: 'popup', options, workspace, windowId: 'popup', ownerDocument: popupDocument })] : [])];
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  return { events, reads, document, popupDocument, ref,
    get current() { return panes.get('main'); }, get popup() { return panes.get('popup'); }, get workspace() { return workspace; },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
  };
}
const denial = message => ({ allowed: false, message });

test('read-only initial and ref previews deny before events, external requests, or internal dialogs', async t => {
  for (const external of [false, true]) await t.test(external ? 'external' : 'built-in', async t => {
    const requests = [];
    const hook = await mount(t, { onSave: undefined, selectedFile: 'child', selectedFileMode: 'preview',
      getEntryPermissions: target => target.id === 'folder' ? { preview: denial('親フォルダを確認してください') } : {},
      ...(external ? { onPreviewRequest: request => { requests.push(request); } } : {}),
    });
    assert.equal(hook.current.readOnly, true);
    assert.equal(hook.current.preview, undefined);
    assert.equal(hook.current.notification.message, '親フォルダを確認してください');
    assert.deepEqual(hook.events.filter(event => event.type === 'preview'), []);
    assert.deepEqual(requests, []); assert.deepEqual(hook.reads, []);
    await change(() => {
      assert.deepEqual(hook.ref.current.previewFile({ id: 'child' }), {
        ok: false, code: 'permission-denied', message: '親フォルダを確認してください',
      });
    });
    assert.deepEqual(requests, []);
  });
});

test('retained main and popup preview callbacks use current policy and keep permitted callbacks synchronous', async t => {
  const requests = [];
  const hook = await mount(t, { onPreviewRequest: request => { requests.push(request.id); } }, true);
  const heldMain = hook.current.openEntry, heldPopup = hook.popup.openEntry;
  const alpha = hook.current.entries.find(item => item.id === 'alpha');
  await hook.update({ getEntryPermissions: () => ({ preview: denial('現在はプレビューできません') }) });
  await change(() => { heldMain(alpha); heldPopup(alpha); });
  assert.deepEqual(requests, []);
  assert.equal(hook.current.notification.message, '現在はプレビューできません');
  assert.equal(hook.popup.notification.message, '現在はプレビューできません');
  await hook.update({ getEntryPermissions: () => ({ preview: true }) });
  await change(() => {
    heldMain(alpha);
    assert.deepEqual(requests, ['alpha'], 'external window.open may run in the original user activation');
  });
  assert.equal(hook.current.dirty, false);
});

test('denied multi-entry clipboard operations preserve internal and native clipboards without success events', async t => {
  const hook = await mount(t, {}, true);
  await change(() => assert.equal(hook.current.copyToClipboard('copy', ['alpha']), true));
  const clipboard = hook.workspace.getClipboard();
  const writes = [...hook.document.writes], previousEvents = hook.events.filter(event => event.type === 'clipboard');
  const held = hook.popup.copyToClipboard;
  await hook.update({ getEntryPermissions: target => target.id === 'child'
    ? { copy: denial('コピー禁止'), move: denial('切り取り禁止') } : {} });
  const native = new Map([['old-os-format', 'preserve']]);
  const transfer = { clearData: () => native.clear(), setData: (key, value) => native.set(key, value) };
  await change(() => {
    assert.equal(held('copy', ['beta', 'folder'], transfer), false);
    assert.equal(hook.current.copyToClipboard('move', ['folder']), false);
  });
  assert.equal(hook.workspace.getClipboard(), clipboard);
  assert.deepEqual(native, new Map([['old-os-format', 'preserve']]));
  assert.deepEqual(hook.document.writes, writes); assert.deepEqual(hook.popupDocument.writes, []);
  assert.deepEqual(hook.events.filter(event => event.type === 'clipboard'), previousEvents);
  assert.equal(hook.current.notification.message, '切り取り禁止');
  assert.equal(hook.popup.notification.message, 'コピー禁止');
  assert.equal(hook.current.dirty, false);
});

test('read-only folder downloads reject denied descendants before host callbacks or body reads', async t => {
  for (const external of [false, true]) await t.test(external ? 'external' : 'built-in', async t => {
    const requests = [];
    const hook = await mount(t, { onSave: undefined,
      getEntryPermissions: target => target.id === 'child' ? { download: denial('文書の取得は禁止されています') } : {},
      ...(external ? { onDownloadRequest: request => { requests.push(request); return { status: 'completed' }; } } : {}),
    });
    await change(async () => assert.equal(await hook.ref.current.download({ id: 'folder' }), false));
    assert.deepEqual(requests, []); assert.deepEqual(hook.reads, []); assert.deepEqual(hook.document.anchors, []);
    assert.deepEqual(hook.events.filter(event => event.type === 'download'), []);
    assert.equal(hook.current.notification.message, '文書の取得は禁止されています');
    assert.equal(hook.current.dirty, false);
  });
});

test('retained download callbacks use current policy and permitted read-only downloads still run', async t => {
  const requests = [];
  const hook = await mount(t, { onSave: undefined,
    onDownloadRequest: request => { requests.push(request.id); return { status: 'completed' }; },
  }, true);
  const held = hook.popup.download;
  await hook.update({ getEntryPermissions: () => ({ download: denial('一時停止中') }) });
  await change(async () => assert.equal(await held({ id: 'alpha' }), false));
  assert.deepEqual(requests, []); assert.equal(hook.popup.notification.message, '一時停止中');
  await hook.update({ getEntryPermissions: () => ({ download: true }) });
  await change(async () => assert.equal(await held({ id: 'alpha' }), true));
  assert.deepEqual(requests, ['alpha']); assert.equal(hook.current.dirty, false);
});

test('revoking a download during a body read prevents browser handoff and success notification', async t => {
  const pending = deferred(), reads = [];
  const hook = await mount(t, { readFile: id => { reads.push(id); return pending.promise; } });
  let completion;
  await change(() => { completion = hook.current.download({ id: 'alpha' }); });
  assert.deepEqual(reads, ['body-alpha']);
  await hook.update({ getEntryPermissions: () => ({ download: denial('取得の許可が終了しました') }) });
  await change(async () => {
    pending.resolve(new Blob(['text']));
    assert.equal(await completion, false);
  });
  assert.deepEqual(hook.document.anchors, []);
  assert.equal(hook.current.notification.kind, 'error');
  assert.equal(hook.current.notification.description, '取得の許可が終了しました');
  assert.ok(hook.events.filter(event => event.type === 'download').every(event => event.status !== 'success'));
});

test('captured custom menu readers recheck preview permission before and after asynchronous reads', async t => {
  const pending = deferred(), reads = [];
  const hook = await mount(t, { getContextMenuItems: () => [], readFile: id => { reads.push(id); return pending.promise; } });
  const menu = hook.current.getCustomContextMenu(hook.current.entries.find(item => item.id === 'alpha'));
  let content;
  await change(() => { content = menu.context.readFile('alpha'); });
  await hook.update({ getEntryPermissions: () => ({ preview: denial('本文の閲覧は禁止されています') }) });
  await assert.rejects(menu.context.readFile('alpha'), /本文の閲覧は禁止されています/);
  const failure = assert.rejects(content, /本文の閲覧は禁止されています/);
  pending.resolve(new Blob(['text']));
  await failure;
  assert.deepEqual(reads, ['body-alpha']);
});

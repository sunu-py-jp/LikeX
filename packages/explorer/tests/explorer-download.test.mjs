import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { createDownloadManager } from './src/state/download-manager.ts';
`, resolveDir: packageRoot, sourcefile: 'explorer-download-contract.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-instance', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useExplorerWorkspace, useExplorerViewController, createDownloadManager } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-download-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('folder', '資料', 'root', 'folder'), entry('alpha', 'Alpha.txt'), entry('beta', 'Beta.txt'),
  entry('nested', 'Nested', 'folder', 'folder'), entry('child', 'Child.txt', 'nested'), entry('empty', 'Empty', 'folder', 'folder')];

function fakeDocument() {
  const listeners = new Map(), anchors = [];
  return { listeners, anchors, defaultView: Object.assign(new EventTarget(), { closed: false }), body: { appendChild() {} },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }, querySelectorAll: () => [], getElementById: () => null,
    createElement(tag) { assert.equal(tag, 'a'); const anchor = { href: '', download: '', clicks: 0, removed: false,
      click() { this.clicks++; }, remove() { this.removed = true; } }; anchors.push(anchor); return anchor; },
  };
}

async function mount(t, supplied = {}, { shared = false } = {}) {
  const events = [], saves = [], reads = [], panes = new Map();
  const document = fakeDocument(), childDocument = fakeDocument();
  let workspace, renderer, closed = false, showChild = shared, afterChildClose;
  let props = { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); },
    onEvent: event => events.push(event), readFile: id => { reads.push(id); throw Error('Unexpected file read'); }, ...supplied };
  function Pane({ options, workspace, windowId, ownerDocument }) {
    panes.set(windowId, useExplorerViewController(options, workspace, windowId, ownerDocument));
    return null;
  }
  function AfterClose() {
    useLayoutEffect(() => { afterChildClose?.(); }, []);
    return null;
  }
  function Probe({ options }) {
    const current = useExplorerWorkspace(options);
    workspace = current;
    useLayoutEffect(() => { const child = current.tabs.forWindow('child'); if (shared && !child.tabs.length) child.addTab(); }, [current.tabs]);
    return [h(Pane, { key: 'main', options, workspace: current, windowId: 'main', ownerDocument: document }),
      ...(showChild ? [h(Pane, { key: 'child', options, workspace: current, windowId: 'child', ownerDocument: childDocument })]
        : afterChildClose ? [h(AfterClose, { key: 'after-close' })] : [])];
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  events.length = 0;
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return panes.get('main'); }, get child() { return panes.get('child'); }, get workspace() { return workspace; },
    document, childDocument, events, saves, reads, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
    async removeChild(afterClose) { showChild = false; afterChildClose = afterClose; await change(() => renderer.update(tree())); },
    async start(id = 'alpha', windowId = 'main') {
      let promise;
      await change(() => { const pane = panes.get(windowId); promise = pane.download(pane.entries.find(item => item.id === id)); });
      return { promise };
    },
  };
}
const eventsOf = (hook, type = 'download') => hook.events.filter(event => event.type === type);
async function settleSoon(promise) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Cancelled download did not settle promptly')), 100); })]); }
  finally { clearTimeout(timer); }
}

test('an external request is invoked once per gesture in StrictMode and reports an explicit handed-off result', async t => {
  const calls = [];
  const hook = await mount(t, { onDownloadRequest(request, context) { calls.push({ request, context }); return { status: 'handed-off', message: 'Browser download requested' }; } });
  assert.equal(calls.length, 0);
  const before = hook.current.entries;
  const run = await hook.start(); await change(() => run.promise);
  assert.equal(calls.length, 1);
  const { request, context } = calls[0];
  assert.equal(request.id, 'alpha'); assert.equal(request.path, '/Alpha.txt'); assert.equal(request.extension, 'txt');
  assert.equal(context.ownerDocument, hook.document); assert.equal(context.windowId, 'main');
  assert.equal(typeof context.requestId, 'string'); assert.ok(context.requestId.length > 0); assert.equal(context.signal.aborted, false);
  assert.equal(context.items.length, 1); assert.equal(context.items[0].archivePath, 'Alpha.txt');
  const events = eventsOf(hook);
  assert.deepEqual(events.map(event => event.status), ['start', 'success']);
  assert.ok(events.every(event => event.requestId === context.requestId && event.external === true));
  assert.deepEqual(events[1].result, { status: 'handed-off', message: 'Browser download requested' });
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []); assert.equal(hook.document.anchors.length, 0);
});

test('progress can skip stages, repeats only changed messages, rejects backward stages and stays separate from legacy statuses', async t => {
  let context;
  const pending = deferred();
  const hook = await mount(t, { onDownloadRequest(request, value) { context = value; return pending.promise; } });
  const run = await hook.start();
  const before = eventsOf(hook, 'download-progress').length;
  await change(() => {
    context.reportProgress({ phase: 'preparing', message: 'Building archive' });
    context.reportProgress({ phase: 'preparing', message: 'Building archive' });
    context.reportProgress({ phase: 'accepted', message: 'Outdated' });
    context.reportProgress({ phase: 'preparing', message: 'Still building' });
    context.reportProgress({ phase: 'transferring', message: 'Writing file' });
    context.reportProgress({ phase: 'ready', message: 'Outdated ready' });
  });
  const progress = eventsOf(hook, 'download-progress').slice(before);
  assert.deepEqual(progress.map(event => event.progress), [
    { phase: 'preparing', message: 'Building archive' }, { phase: 'preparing', message: 'Still building' }, { phase: 'transferring', message: 'Writing file' },
  ]);
  assert.ok(progress.every(event => event.requestId === context.requestId));
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start']);
  await change(async () => { pending.resolve({ status: 'completed', message: 'Host confirmed completion' }); await run.promise; });
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start', 'success']);
  assert.equal(eventsOf(hook).at(-1).result.status, 'completed');
  const count = hook.events.length;
  await change(() => context.reportProgress({ phase: 'transferring', message: 'Too late' }));
  assert.equal(hook.events.length, count);
});

test('external synchronous failures, rejected promises and invalid results never fall back to built-in reads or ZIP', async t => {
  const cases = [
    () => { throw Error('Authentication rejected'); }, () => Promise.reject(Error('Function failed')),
    () => undefined, async () => undefined, () => null, () => ({ status: 'ready' }),
  ];
  for (const [index, onDownloadRequest] of cases.entries()) await t.test(String(index), async subtest => {
    const hook = await mount(subtest, { onDownloadRequest });
    const run = await hook.start('folder'); await change(() => run.promise);
    assert.deepEqual(eventsOf(hook).map(event => event.status), ['start', 'error']);
    assert.equal(typeof eventsOf(hook).at(-1).message, 'string');
    assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []); assert.equal(hook.document.anchors.length, 0);
    assert.equal(hook.current.dirty, false);
  });
});

test('explicit cancellation and AbortError produce cancellation rather than success or error', async t => {
  for (const onDownloadRequest of [() => ({ status: 'cancelled', message: 'User dismissed the picker' }),
    () => Promise.reject(new DOMException('User cancelled', 'AbortError'))]) await t.test(String(onDownloadRequest), async subtest => {
    const hook = await mount(subtest, { onDownloadRequest });
    const run = await hook.start(); await change(() => run.promise);
    assert.deepEqual(eventsOf(hook).map(event => event.status), ['start']);
    const cancellations = eventsOf(hook, 'download-cancelled');
    assert.equal(cancellations.length, 1); assert.equal(cancellations[0].reason, 'cancelled');
    assert.equal(hook.document.anchors.length, 0);
  });
});

test('the same entry is deduplicated across parent and popup while different entries can proceed concurrently', async t => {
  const calls = [];
  const hook = await mount(t, { onDownloadRequest(request, context) { const pending = deferred(); calls.push({ request, context, pending }); return pending.promise; } }, { shared: true });
  const main = await hook.start('alpha');
  const duplicate = await hook.start('alpha', 'child'); await settleSoon(duplicate.promise);
  const child = await hook.start('beta', 'child');
  assert.equal(calls.length, 2); assert.notEqual(calls[0].context.requestId, calls[1].context.requestId);
  assert.equal(calls[1].context.ownerDocument, hook.childDocument); assert.equal(calls[1].context.windowId, 'child');
  assert.equal(eventsOf(hook).find(event => event.request.id === 'beta').windowId, 'child');
  await change(async () => { calls[0].pending.resolve({ status: 'handed-off' }); calls[1].pending.resolve({ status: 'completed' }); await Promise.all([main.promise, child.promise]); });
  assert.equal(eventsOf(hook).filter(event => event.status === 'success').length, 2);
  assert.equal(hook.current.entries, hook.child.entries);
});

test('disabling downloads immediately aborts and releases a pending request, and old callbacks cannot disturb its retry', async t => {
  const calls = [];
  const hook = await mount(t, { onDownloadRequest(request, context) { const pending = deferred(); calls.push({ context, pending }); return pending.promise; } });
  const first = await hook.start();
  await hook.update({ features: { download: false } });
  assert.equal(calls[0].context.signal.aborted, true); await settleSoon(first.promise);
  assert.equal(eventsOf(hook, 'download-cancelled').at(-1).reason, 'disabled');
  assert.equal(hook.current.notification, null, 'disabling download hides its own progress notice');
  await hook.update({ features: { download: true } });
  const second = await hook.start();
  assert.notEqual(calls[0].context.requestId, calls[1].context.requestId);
  const count = hook.events.length;
  await change(() => { calls[0].context.reportProgress({ phase: 'ready', message: 'Old request' }); calls[0].pending.resolve({ status: 'completed' }); });
  assert.equal(hook.events.length, count);
  const duplicate = await hook.start(); await settleSoon(duplicate.promise);
  assert.equal(calls.length, 2, 'late completion did not clear the active retry');
  await change(async () => { calls[1].pending.resolve({ status: 'handed-off' }); await second.promise; });
  assert.equal(eventsOf(hook).filter(event => event.status === 'success').length, 1);
});

test('closing a popup aborts only that window’s requests and releases their promises', async t => {
  const calls = [];
  const hook = await mount(t, { onDownloadRequest(request, context) { const pending = deferred(); calls.push({ request, context, pending }); return pending.promise; } }, { shared: true });
  const main = await hook.start('alpha'), child = await hook.start('beta', 'child');
  await hook.removeChild();
  assert.equal(calls[0].context.signal.aborted, false); assert.equal(calls[1].context.signal.aborted, true);
  await settleSoon(child.promise);
  assert.equal(eventsOf(hook, 'download-cancelled').at(-1).reason, 'window-closed');
  const count = hook.events.length;
  await change(() => { calls[1].context.reportProgress({ phase: 'ready' }); calls[1].pending.reject(Error('Late popup failure')); });
  assert.equal(hook.events.length, count);
  await change(async () => { calls[0].pending.resolve({ status: 'completed' }); await main.promise; });
  assert.equal(eventsOf(hook).filter(event => event.status === 'success').length, 1);
});

test('a retained popup callback cannot begin work from another component’s closing-commit layout effect', async t => {
  let calls = 0;
  const hook = await mount(t, { onDownloadRequest() { calls++; return { status: 'completed' }; } }, { shared: true });
  const heldDownload = hook.child.download;
  const attempts = [];
  await hook.removeChild(() => { attempts.push(heldDownload({ id: 'alpha' })); });
  await change(() => Promise.all(attempts));
  assert.ok(attempts.length > 0); assert.equal(calls, 0);
  assert.equal(eventsOf(hook).length, 0); assert.equal(eventsOf(hook, 'download-cancelled').length, 0);
});

test('native popup pagehide cancels pending work before React cleanup and a closed document rejects new work', async t => {
  const pending = deferred();
  let context, calls = 0;
  const hook = await mount(t, { onDownloadRequest(request, value) { context = value; calls++; return pending.promise; } }, { shared: true });
  const run = await hook.start('beta', 'child');
  await change(() => { hook.childDocument.defaultView.closed = true; hook.childDocument.defaultView.dispatchEvent(new Event('pagehide')); });
  assert.equal(context.signal.aborted, true); await settleSoon(run.promise);
  assert.equal(eventsOf(hook, 'download-cancelled').at(-1).reason, 'window-closed');
  const next = await hook.start('alpha', 'child'); await settleSoon(next.promise);
  assert.equal(calls, 1);
});

test('cancellation blocks synchronous reentrant requests and nested cancellation, then permits later reuse', () => {
  for (const method of ['cancelWindow', 'cancelAll']) {
    const manager = createDownloadManager();
    const first = manager.begin('alpha', 'main'), second = manager.begin('beta', 'child');
    const attempts = [];
    first.signal.addEventListener('abort', () => {
      assert.equal(first.isActive(), false);
      attempts.push(manager.begin('alpha', 'main'), manager.begin('gamma', 'main'), manager.begin('delta', 'child'));
      manager.cancelAll('nested');
      attempts.push(manager.begin('epsilon', 'main'));
    });
    second.signal.addEventListener('abort', () => { attempts.push(manager.begin('zeta', 'child')); });
    if (method === 'cancelWindow') manager.cancelWindow('main', 'window-closed');
    else manager.cancelAll('unmounted');
    assert.deepEqual(attempts, [null, null, null, null, null]);
    assert.equal(first.signal.aborted, true); assert.equal(second.signal.aborted, true);
    const retry = manager.begin('alpha', 'main');
    assert.ok(retry); assert.notEqual(retry.requestId, first.requestId);
    assert.equal(first.finish(), false); assert.equal(retry.isActive(), true);
    assert.equal(retry.finish(), true); assert.equal(retry.finish(), false);
  }
});

test('a successful observer may start a retry immediately without the previous request clearing its lock', async t => {
  const pending = deferred(), observed = [];
  let calls = 0, hook, retry;
  hook = await mount(t, { onDownloadRequest() { calls++; return calls === 1 ? { status: 'completed' } : pending.promise; },
    onEvent(event) {
      observed.push(event);
      if (event.type === 'download' && event.status === 'success' && !retry) retry = hook.current.download({ id: 'alpha' });
    } });
  const first = await hook.start(); await change(() => first.promise);
  assert.equal(calls, 2); assert.ok(retry);
  const duplicate = await hook.start(); await settleSoon(duplicate.promise);
  assert.equal(calls, 2);
  await change(async () => { pending.resolve({ status: 'completed' }); await retry; });
  assert.deepEqual(observed.filter(event => event.type === 'download').map(event => event.status), ['start', 'success', 'start', 'success']);
});

test('workspace unmount aborts outstanding requests and late settlements produce no further notifications', async t => {
  let context;
  const pending = deferred();
  const hook = await mount(t, { onDownloadRequest(request, value) { context = value; return pending.promise; } });
  const run = await hook.start();
  await hook.unmount(); assert.equal(context.signal.aborted, true); await settleSoon(run.promise);
  assert.equal(eventsOf(hook, 'download-cancelled').length, 1);
  assert.equal(eventsOf(hook, 'download-cancelled')[0].reason, 'unmounted');
  const count = hook.events.length;
  await change(() => { context.reportProgress({ phase: 'transferring' }); pending.resolve({ status: 'completed' }); });
  assert.equal(hook.events.length, count);
});

test('built-in ZIP cancellation stops further file reads after close, disable or unmount', async t => {
  for (const reason of ['window-closed', 'disabled', 'unmounted']) await t.test(reason, async t => {
    const pending = deferred(), reads = [];
    const hook = await mount(t, {
      initialEntries: [entry('folder', 'Folder', 'root', 'folder'), entry('one', 'One.txt', 'folder'), entry('two', 'Two.txt', 'folder')],
      readFile(id) { reads.push(id); return id === 'content-one' ? pending.promise : Promise.resolve(new Blob(['later'])); },
    });
    const run = await hook.start('folder');
    assert.deepEqual(reads, ['content-one']);
    if (reason === 'unmounted') await hook.unmount();
    else if (reason === 'disabled') await hook.update({ features: { download: false } });
    else await change(() => hook.document.defaultView.dispatchEvent(new Event('pagehide')));
    await settleSoon(run.promise);
    assert.equal(eventsOf(hook, 'download-cancelled')[0].reason, reason);
    await change(() => pending.resolve(new Blob(['first'])));
    assert.deepEqual(reads, ['content-one'], 'cancelled ZIP work must not continue to later files');
    assert.equal(hook.document.anchors.length, 0);
    assert.deepEqual(eventsOf(hook).map(event => event.status), ['start']);
  });
});

test('read-only mode does not cancel downloads, and an absent save handler still permits external requests', async t => {
  let context;
  const pending = deferred();
  const hook = await mount(t, { onSave: undefined, onDownloadRequest(request, value) { context = value; return pending.promise; } });
  const run = await hook.start(); assert.equal(hook.current.readOnly, true);
  await hook.update({ readOnly: true }); assert.equal(context.signal.aborted, false);
  await change(async () => { pending.resolve({ status: 'completed' }); await run.promise; });
  assert.equal(eventsOf(hook).at(-1).status, 'success'); assert.equal(eventsOf(hook, 'download-cancelled').length, 0);
});

test('callback replacement affects only new requests while current observers receive later lifecycle events', async t => {
  const pending = deferred(), calls = [], newerEvents = [];
  let firstContext;
  const hook = await mount(t, { onDownloadRequest(request, context) { firstContext = context; calls.push('old'); return pending.promise; } });
  const first = await hook.start();
  await hook.update({ onDownloadRequest() { calls.push('new'); return { status: 'handed-off' }; }, onEvent: event => newerEvents.push(event) });
  await change(() => firstContext.reportProgress({ phase: 'preparing' }));
  await change(async () => { pending.resolve({ status: 'completed' }); await first.promise; });
  assert.deepEqual(calls, ['old']);
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start']);
  assert.equal(newerEvents.find(event => event.type === 'download' && event.status === 'success').result.status, 'completed');
  const second = await hook.start(); await change(() => second.promise);
  assert.deepEqual(calls, ['old', 'new']);
});

test('folder manifests capture unsaved adds, moves, names and empty folders, and stay fixed while the draft changes', async t => {
  const calls = [], pending = deferred();
  const hook = await mount(t, { onDownloadRequest(request, context) { calls.push({ request, context }); return pending.promise; } });
  const local = new File(['local bytes'], 'Local.bin');
  Object.defineProperty(local, 'webkitRelativePath', { value: 'NewFolder/Local.bin' });
  await change(() => {
    hook.workspace.draft.apply({ action: 'rename', ids: ['folder'], name: '編集済み資料' });
    hook.workspace.draft.apply({ action: 'rename', ids: ['child'], name: '改名.TXT' });
    hook.workspace.draft.apply({ action: 'move', ids: ['alpha'], parent: 'folder' });
    hook.workspace.draft.add([local], 'folder');
  });
  const run = await hook.start('folder');
  const { request, context } = calls[0];
  assert.equal(request.name, '編集済み資料'); assert.equal(request.path, '/編集済み資料');
  assert.deepEqual(context.items.map(item => item.archivePath).sort(), ['編集済み資料/', '編集済み資料/Alpha.txt', '編集済み資料/Empty/',
    '編集済み資料/Nested/', '編集済み資料/Nested/改名.TXT', '編集済み資料/NewFolder/', '編集済み資料/NewFolder/Local.bin'].sort());
  assert.equal(context.items.some(item => item.id === 'beta'), false);
  assert.equal(context.items.find(item => item.id === 'child').source.id, 'content-child');
  assert.equal(context.items.find(item => item.name === 'Local.bin').source.file, local);
  assert.equal(context.items.find(item => item.id === 'child').extension, 'txt');
  assert.notEqual(context.items[0], request); assert.notEqual(context.items, hook.current.entries);
  const capturedPaths = context.items.map(item => item.path);
  await change(() => { hook.workspace.draft.apply({ action: 'delete', ids: ['child'] }); hook.workspace.draft.apply({ action: 'rename', ids: ['folder'], name: 'Later' }); });
  assert.deepEqual(context.items.map(item => item.path), capturedPaths); assert.equal(request.name, '編集済み資料');
  await change(async () => { pending.resolve({ status: 'handed-off' }); await run.promise; });
  assert.equal(eventsOf(hook).at(-1).request.name, '編集済み資料');
  assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []); assert.equal(hook.document.anchors.length, 0);
});

test('observer and handler metadata edits or observer errors cannot change the draft, later payloads or progress ordering', async t => {
  const observed = [], originalPayloads = [], calls = [];
  const attempt = callback => { try { callback(); } catch { /* Readonly snapshots may also be frozen. */ } };
  const hook = await mount(t, {
    onEvent(event) {
      observed.push(event);
      if (event.request) originalPayloads.push({ name: event.request.name, source: event.request.source.id,
        ...(event.progress ? { phase: event.progress.phase } : {}) });
      if (event.type === 'download') {
        attempt(() => { event.request.name = 'Observer.txt'; });
        attempt(() => { event.request.source.id = 'observer-body'; });
      }
      if (event.type === 'download-progress') attempt(() => { event.progress.phase = 'transferring'; });
      throw Error('Observer failure');
    },
    onDownloadRequest(request, context) {
      calls.push({ name: request.name, source: request.source.id, item: context.items[0].name });
      attempt(() => { request.name = 'Handler.txt'; });
      attempt(() => { context.items[0].source.id = 'handler-body'; });
      context.reportProgress({ phase: 'preparing', message: 'One' });
      context.reportProgress({ phase: 'preparing', message: 'Two' });
      return { status: 'completed' };
    },
  });
  const before = hook.current.entries;
  const run = await hook.start(); await change(() => run.promise);
  assert.deepEqual(calls, [{ name: 'Alpha.txt', source: 'content-alpha', item: 'Alpha.txt' }]);
  assert.equal(hook.current.entries, before); assert.equal(hook.current.entries.find(item => item.id === 'alpha').source.id, 'content-alpha');
  assert.equal(observed.filter(event => event.type === 'download-progress').length, 2);
  assert.deepEqual(observed.filter(event => event.type === 'download').map(event => event.status), ['start', 'success']);
  assert.deepEqual(originalPayloads, [
    { name: 'Alpha.txt', source: 'content-alpha' },
    { name: 'Alpha.txt', source: 'content-alpha', phase: 'preparing' },
    { name: 'Alpha.txt', source: 'content-alpha', phase: 'preparing' },
    { name: 'Alpha.txt', source: 'content-alpha' },
  ]);
});

test('parent result and progress objects are copied and only public fields reach lifecycle events', async t => {
  const progress = { phase: 'ready', message: 'Available', privateToken: 'progress-secret' };
  const result = { status: 'handed-off', message: 'Requested', url: 'https://storage.invalid/private-token' };
  const hook = await mount(t, { onDownloadRequest(request, context) {
    context.reportProgress(progress);
    progress.phase = 'accepted'; progress.message = 'Changed after reporting';
    return result;
  } });
  const run = await hook.start(); await change(() => run.promise);
  const emittedProgress = eventsOf(hook, 'download-progress')[0].progress;
  const emittedResult = eventsOf(hook).at(-1).result;
  assert.deepEqual(emittedProgress, { phase: 'ready', message: 'Available' });
  assert.deepEqual(emittedResult, { status: 'handed-off', message: 'Requested' });
  assert.notEqual(emittedProgress, progress); assert.notEqual(emittedResult, result);
  result.status = 'cancelled'; result.message = 'Changed after completion';
  assert.equal(emittedResult.status, 'handed-off'); assert.equal(emittedResult.message, 'Requested');
});

test('invalid progress from a running handler produces an error and leaves no active entry lock', async t => {
  const hook = await mount(t, { onDownloadRequest(request, context) {
    context.reportProgress({ phase: 'finished', message: 'Invalid lifecycle stage' });
    return { status: 'completed' };
  } });
  const first = await hook.start(); await change(() => first.promise);
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start', 'error']);
  assert.equal(eventsOf(hook, 'download-progress').length, 0);
  await hook.update({ onDownloadRequest: () => ({ status: 'completed' }) });
  const retry = await hook.start(); await change(() => retry.promise);
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start', 'error', 'start', 'success']);
});

test('older downloads cannot replace newer progress or unrelated operation notices', async t => {
  const calls = [];
  const hook = await mount(t, { onDownloadRequest(request, context) { const pending = deferred(); calls.push({ context, pending }); return pending.promise; } });
  const first = await hook.start('alpha'), second = await hook.start('beta');
  await change(() => calls[1].context.reportProgress({ phase: 'preparing', message: 'Current download' }));
  const newest = hook.current.notification;
  await change(async () => { calls[0].pending.reject(Error('Old download failed')); await first.promise; });
  assert.equal(hook.current.notification, newest);
  const other = { kind: 'error', message: 'Another operation needs attention' };
  await change(() => hook.current.setNotification(other));
  await change(() => calls[1].context.reportProgress({ phase: 'ready', message: 'Ready now' }));
  assert.equal(hook.current.notification, other);
  await change(async () => { calls[1].pending.resolve({ status: 'completed' }); await second.promise; });
  assert.equal(hook.current.notification, other);
});

test('built-in file and ZIP downloads retain their legacy statuses and now carry request identity and external=false', async t => {
  const blobs = [];
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return `blob:test-${blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const hook = await mount(t, { readFile: async () => new Blob(['content']) });
  for (const id of ['alpha', 'folder']) { const run = await hook.start(id); await change(() => run.promise); }
  assert.deepEqual(eventsOf(hook).map(event => event.status), ['start', 'success', 'start', 'success']);
  assert.ok(eventsOf(hook).every(event => event.external === false && typeof event.requestId === 'string'));
  assert.equal(hook.document.anchors[0].download, 'Alpha.txt'); assert.equal(hook.document.anchors[1].download, '資料.zip');
  assert.equal(blobs[1].type, 'application/zip');
  assert.ok(eventsOf(hook).filter(event => event.status === 'success').every(event => event.result.status === 'handed-off'));
});

test('a disabled download feature has no external side effects or lifecycle events', async t => {
  let calls = 0;
  const hook = await mount(t, { features: { download: false }, onDownloadRequest() { calls++; return { status: 'completed' }; } });
  const run = await hook.start(); await change(() => run.promise);
  assert.equal(calls, 0); assert.deepEqual(hook.events, []); assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []);
});

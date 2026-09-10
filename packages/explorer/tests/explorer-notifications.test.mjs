import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { createExplorerNotificationStore } from './src/model/notifications.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
`, resolveDir: packageRoot, sourcefile: 'explorer-notifications.ts' },
bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { createExplorerNotificationStore, useExplorerWorkspace } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };

function storeFor(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = createExplorerNotificationStore();
  store.activate();
  t.after(() => store.dispose());
  return store;
}

test('host messages receive distinct IDs, update in place, and replace optional fields', t => {
  const store = storeFor(t);
  const first = store.notify({ kind: 'info', message: '開始', description: '準備', hint: '説明', persistent: true });
  const second = store.notify({ kind: 'error', message: '失敗' });
  assert.notEqual(first, second);
  assert.deepEqual(store.getSnapshot().map(message => message.id), [first, second]);
  store.notify({ id: first, kind: 'success', message: '完了' });
  assert.deepEqual(store.getSnapshot().map(message => message.id), [first, second]);
  assert.equal(store.getSnapshot()[0].kind, 'success');
  assert.equal(store.getSnapshot()[0].description, undefined);
  assert.equal(store.getSnapshot()[0].hint, undefined);
  assert.equal(store.getSnapshot()[0].persistent, undefined);
});

test('each message expires independently and updating restarts its five-second timeout', t => {
  const store = storeFor(t);
  store.notify({ id: 'first', kind: 'info', message: 'first' });
  t.mock.timers.tick(2000);
  store.notify({ id: 'second', kind: 'info', message: 'second' });
  t.mock.timers.tick(2000);
  store.notify({ id: 'first', kind: 'success', message: 'updated' });
  t.mock.timers.tick(1000);
  assert.equal(store.getSnapshot().length, 2, 'the first timer no longer dismisses an updated message');
  t.mock.timers.tick(2000);
  assert.deepEqual(store.getSnapshot().map(message => message.id), ['first']);
  t.mock.timers.tick(1999);
  assert.equal(store.getSnapshot().length, 1);
  t.mock.timers.tick(1);
  assert.equal(store.getSnapshot().length, 0);
});

test('persistent messages cancel prior expiry and keep their full file result list', t => {
  const store = storeFor(t);
  store.notify({ id: 'batch', kind: 'info', message: 'アップロード中' });
  t.mock.timers.tick(4000);
  const details = Array.from({ length: 300 }, (_, index) => ({ message: `資料${index}.pdf`, kind: 'error' }));
  store.notify({ id: 'batch', kind: 'error', message: '300件を確認してください', details, persistent: true });
  t.mock.timers.tick(60_000);
  assert.equal(store.getSnapshot().length, 1);
  assert.equal(store.getSnapshot()[0].details.length, 300);
});

test('progress remains visible, normalizes percentages, and terminal replacement starts expiry', t => {
  const store = storeFor(t);
  for (const [value, expected] of [[-1, 0], [135, 100], [2.5, 2.5], [NaN, undefined], [Infinity, undefined]]) {
    store.notify({ id: 'upload', kind: 'progress', message: '送信中', progress: value, persistent: false });
    assert.equal(store.getSnapshot()[0].progress, expected);
  }
  t.mock.timers.tick(60_000);
  assert.equal(store.getSnapshot().length, 1);
  store.notify({ id: 'upload', kind: 'success', message: '送信完了' });
  assert.equal(store.getSnapshot()[0].progress, undefined);
  t.mock.timers.tick(4999);
  assert.equal(store.getSnapshot().length, 1);
  t.mock.timers.tick(1);
  assert.equal(store.getSnapshot().length, 0);
});

test('notification and detail inputs are copied and snapshots cannot be mutated', t => {
  const store = storeFor(t);
  const detail = { message: '<script>filename</script>', kind: 'success', description: 'uploaded' };
  const details = [detail];
  const input = { kind: 'success', message: '完了', details };
  store.notify(input);
  detail.message = 'changed';
  details.push({ message: 'extra' });
  input.message = 'changed';
  const snapshot = store.getSnapshot();
  assert.equal(snapshot[0].message, '完了');
  assert.equal(snapshot[0].details.length, 1);
  assert.equal(snapshot[0].details[0].message, '<script>filename</script>', 'text is retained verbatim for React to escape');
  assert.throws(() => { snapshot[0].details[0].message = 'mutated'; }, TypeError);
  assert.throws(() => { snapshot.push(snapshot[0]); }, TypeError);
});

test('the workspace retains at most fifty notifications and evicts the oldest insertion', t => {
  const store = storeFor(t);
  for (let index = 0; index < 50; index++) store.notify({ id: String(index), kind: 'info', message: String(index) });
  store.notify({ id: '0', kind: 'success', message: 'updated oldest' });
  store.notify({ id: '50', kind: 'info', message: 'newest', persistent: true });
  assert.equal(store.getSnapshot().length, 50);
  assert.equal(store.getSnapshot()[0].id, '1');
  assert.equal(store.getSnapshot().at(-1).id, '50');
  t.mock.timers.tick(5000);
  assert.deepEqual(store.getSnapshot().map(message => message.id), ['50']);
});

test('dismiss and clear release timers and do not emit changes for unknown or empty messages', t => {
  const store = storeFor(t);
  let changes = 0;
  const unsubscribe = store.subscribe(() => { changes++; });
  store.dismiss('missing');
  store.clear();
  assert.equal(changes, 0);
  store.notify({ id: 'one', kind: 'success', message: 'one' });
  store.notify({ id: 'two', kind: 'success', message: 'two' });
  store.dismiss('one');
  assert.deepEqual(store.getSnapshot().map(message => message.id), ['two']);
  store.clear();
  assert.equal(changes, 4);
  t.mock.timers.tick(5000);
  assert.equal(changes, 4);
  unsubscribe();
});

test('the host notification revision only changes when a message is sent or updated', t => {
  const store = storeFor(t);
  assert.equal(store.getRevision(), 0);
  store.notify({ id: 'job', kind: 'info', message: 'start' });
  assert.equal(store.getRevision(), 1);
  store.notify({ id: 'job', kind: 'success', message: 'done' });
  assert.equal(store.getRevision(), 2);
  t.mock.timers.tick(5000);
  store.dismiss('job');
  store.clear();
  assert.equal(store.getRevision(), 2);
  store.dispose();
  store.notify({ kind: 'error', message: 'late' });
  assert.equal(store.getRevision(), 2);
});

test('disposal clears retained data and ignores late asynchronous completion', t => {
  const store = storeFor(t);
  let changes = 0;
  store.subscribe(() => { changes++; });
  store.notify({ id: 'pending', kind: 'progress', message: '待機中' });
  store.dispose();
  assert.equal(store.getSnapshot().length, 0);
  assert.equal(store.notify({ id: 'pending', kind: 'success', message: '完了' }), 'pending');
  store.dismiss('pending');
  store.clear();
  t.mock.timers.tick(60_000);
  assert.equal(changes, 1);
  assert.equal(store.getSnapshot().length, 0);
  store.activate();
  store.notify({ kind: 'info', message: '次のマウント' });
  assert.equal(store.getSnapshot().length, 1);
});

test('distinct workspaces do not share messages even when the host uses identical IDs', t => {
  const first = storeFor(t);
  const second = createExplorerNotificationStore();
  second.activate();
  t.after(() => second.dispose());
  first.notify({ id: 'job', kind: 'info', message: 'first' });
  second.notify({ id: 'job', kind: 'info', message: 'second' });
  first.dismiss('job');
  assert.equal(first.getSnapshot().length, 0);
  assert.equal(second.getSnapshot()[0].message, 'second');
});

async function mountWorkspace(t, { initialize } = {}) {
  const ref = createRef();
  let workspace, renderer;
  function Probe() {
    workspace = useExplorerWorkspace({ initialEntries: [], ref });
    return null;
  }
  function Parent() {
    useLayoutEffect(() => { initialize?.(ref.current); }, []);
    return h(Probe);
  }
  await change(() => { renderer = create(h(StrictMode, null, h(Parent))); });
  let closed = false;
  const unmount = async () => { if (!closed) { closed = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { ref, get workspace() { return workspace; }, unmount };
}

test('React ref exposes a stable shared notification API through workspace rerenders', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hook = await mountWorkspace(t);
  const handle = hook.ref.current;
  let id;
  await change(() => { id = handle.notify({ kind: 'progress', message: 'Preparing' }); });
  assert.equal(hook.ref.current, handle);
  assert.equal(hook.workspace.notifications.messages[0].id, id);
  assert.equal(hook.workspace.draft.dirty, false);
  await change(() => handle.notify({ id, kind: 'success', message: 'Uploaded', details: [{ kind: 'success', message: '資料.pdf' }] }));
  assert.equal(hook.workspace.notifications.messages.length, 1);
  assert.equal(hook.workspace.notifications.messages[0].kind, 'success');
  await change(() => hook.workspace.notifications.dismiss(id));
  assert.equal(hook.workspace.notifications.messages.length, 0);
  await change(() => handle.notify({ kind: 'info', message: 'Another' }));
  await change(() => handle.clearNotifications());
  assert.equal(hook.workspace.notifications.messages.length, 0);
  await change(() => handle.notify({ kind: 'success', message: 'Expires' }));
  await change(() => t.mock.timers.tick(5000));
  assert.equal(hook.workspace.notifications.messages.length, 0);
  await hook.unmount();
  assert.equal(hook.ref.current, null);
  await change(() => handle.notify({ kind: 'error', message: 'Late completion' }));
});

test('parent layout effects can send notifications and StrictMode does not duplicate initial messages', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hook = await mountWorkspace(t, { initialize: handle => handle.notify({ kind: 'info', message: 'Ready' }) });
  assert.equal(hook.workspace.notifications.messages.length, 1);
  assert.equal(hook.workspace.notifications.messages[0].message, 'Ready');
  await change(() => t.mock.timers.tick(5000));
  assert.equal(hook.workspace.notifications.messages.length, 0);
});

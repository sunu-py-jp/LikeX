import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false });
const { createContextMenuExecutor, resolveContextMenuItems } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const item = onSelect => ({ id: 'custom', label: 'カスタム処理', onSelect });
function fixture(extra = {}) {
  const changes = [], events = [], states = [];
  let revision = 1;
  const executor = createContextMenuExecutor({ getRevision: () => revision,
    apply: (change, _context, _operation, guard) => {
      assert.equal(guard.isCurrent(), true);
      changes.push(change); revision++;
    }, onStateChange: state => states.push(state), onEvent: event => events.push(event), ...extra });
  return { executor, changes, events, states, edit: () => { revision++; } };
}

test('provider evaluates only on demand, isolates menu definitions and accepts conditional empty menus', () => {
  const source = item(() => undefined);
  let calls = 0;
  const provider = target => { calls++; return target.file ? [source] : []; };
  assert.deepEqual(resolveContextMenuItems(provider, { file: false }), []);
  const items = resolveContextMenuItems(provider, { file: true });
  source.label = 'changed';
  assert.equal(items[0].label, 'カスタム処理');
  assert.equal(calls, 2);
  assert.ok(Object.isFrozen(items));
  assert.ok(Object.isFrozen(items[0]));
  assert.throws(() => resolveContextMenuItems(() => [source, source], {}));
  assert.throws(() => resolveContextMenuItems(() => Promise.resolve([]), {}));
  assert.deepEqual(resolveContextMenuItems(undefined, {}), []);
});

test('default block mode prevents concurrent runs and remains blocked until the result is applied', async () => {
  const f = fixture(); const wait = deferred(); let signal;
  const running = f.executor.run(item((_context, operation) => { signal = operation.signal; return wait.promise; }), { target: 'A1' });
  assert.equal(f.executor.getState().phase, 'preparing');
  assert.equal(f.executor.getState().blocksChanges, true);
  assert.equal(await f.executor.run(item(() => undefined), {}), 'busy');
  wait.resolve({ change: ['A1', 'SUM'] });
  assert.equal(await running, 'success');
  assert.deepEqual(f.changes, [['A1', 'SUM']]);
  assert.equal(f.executor.getState().blocksChanges, false);
  assert.equal(signal.aborted, true);
  assert.deepEqual(f.events.map(e => e.status), ['start', 'success']);
  assert.equal(f.states.find(s => s.phase === 'applying').blocksChanges, true);
});

test('reject-if-changed discards a late result while allowing edits during preparation', async () => {
  const f = fixture(); const wait = deferred();
  const running = f.executor.run(item(() => wait.promise), {}, 'reject-if-changed');
  assert.equal(f.executor.getState().blocksChanges, false);
  f.edit(); wait.resolve({ change: 'obsolete' });
  assert.equal(await running, 'failed');
  assert.deepEqual(f.changes, []);
  assert.match(f.executor.getState().error, /変更/);
});

test('block also refuses results when an external replacement bypassed local input blocking', async () => {
  const f = fixture(); const wait = deferred();
  const running = f.executor.run(item(() => wait.promise), {}, 'block');
  f.edit(); wait.resolve({ change: 'obsolete' });
  assert.equal(await running, 'failed');
  assert.deepEqual(f.changes, []);
});

test('confirm always waits for consent and applies against the confirmed revision', async () => {
  const f = fixture();
  assert.equal(await f.executor.run(item(() => ({ change: 'formula', description: 'A1へ数式を挿入' })), {}, 'confirm'), 'confirmation-required');
  assert.equal(f.executor.getState().phase, 'confirming');
  assert.equal(f.executor.getState().blocksChanges, false);
  assert.deepEqual(f.changes, []);
  f.edit();
  assert.equal(await f.executor.confirm(), 'success');
  assert.deepEqual(f.changes, ['formula']);
  assert.deepEqual(f.events.map(e => e.status), ['start', 'confirmation-required', 'success']);
  assert.equal(await f.executor.confirm(), 'busy');
});

test('confirm refuses a lost or structurally changed target even with user consent', async () => {
  let targetExists = true;
  const f = fixture({ validateTarget: () => { if (!targetExists) throw new Error('target removed'); } });
  await f.executor.run(item(() => ({ change: 'formula' })), {}, 'confirm');
  targetExists = false;
  assert.equal(await f.executor.confirm(), 'failed');
  assert.deepEqual(f.changes, []);
});

test('the apply guard rechecks revisions after an asynchronous editing permission', async () => {
  const lease = deferred(); let applied = false;
  const f = fixture({ apply: async (_change, _context, _operation, guard) => {
    await lease.promise;
    if (!guard.isCurrent()) throw new Error('stale after lease');
    applied = true;
  } });
  await f.executor.run(item(() => ({ change: 'formula' })), {}, 'confirm');
  const applying = f.executor.confirm();
  assert.equal(f.executor.getState().blocksChanges, true);
  f.edit(); lease.resolve();
  assert.equal(await applying, 'failed');
  assert.equal(applied, false);
});

test('cancel finishes promptly even when the host ignores AbortSignal; late results never apply', async () => {
  const f = fixture(); const wait = deferred();
  const running = f.executor.run(item(() => wait.promise), {});
  f.executor.cancel();
  assert.equal(await running, 'cancelled');
  assert.equal(f.executor.getState().blocksChanges, false);
  assert.equal(await f.executor.run(item(() => ({ change: 'new' })), {}), 'success');
  wait.resolve({ change: 'old' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.changes, ['new']);
  assert.deepEqual(f.events.map(e => e.status), ['start', 'cancelled', 'start', 'success']);
});

test('cancel while applying invalidates the guard and releases the operation', async () => {
  const wait = deferred(); let wasCurrent;
  const f = fixture({ apply: async (_change, _context, _operation, guard) => {
    await wait.promise; wasCurrent = guard.isCurrent();
  } });
  const running = f.executor.run(item(() => ({ change: 'value' })), {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.executor.getState().phase, 'applying');
  f.executor.cancel();
  assert.equal(await running, 'cancelled');
  wait.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(wasCurrent, false);
});

test('external-only actions finish without confirmation; null is not a valid change plan', async () => {
  const f = fixture();
  assert.equal(await f.executor.run(item(() => undefined), {}, 'confirm'), 'success');
  assert.equal(await f.executor.run(item(() => null), {}), 'failed');
  assert.deepEqual(f.changes, []);
});

test('host dialog cancellation uses AbortError without reporting a completed or failed action', async () => {
  const f = fixture();
  assert.equal(await f.executor.run(item(() => { throw new DOMException('cancelled dialog', 'AbortError'); }), {}), 'cancelled');
  assert.deepEqual(f.events.map(e => e.status), ['start', 'cancelled']);
  assert.deepEqual(f.changes, []);
  assert.equal(f.executor.getState().error, null);
});

test('disabled items, unavailable owners and disposed executors never invoke host handlers', async () => {
  let calls = 0; const action = item(() => { calls++; });
  const f = fixture();
  assert.equal(await f.executor.run({ ...action, disabled: true }, {}), 'busy');
  assert.equal(await fixture({ canRun: () => false }).executor.run(action, {}), 'busy');
  f.executor.dispose();
  assert.equal(await f.executor.run(action, {}), 'busy');
  assert.equal(calls, 0);
});

test('errors clear the busy state and observers cannot turn success into failure', async () => {
  const f = fixture({ onEvent: () => Promise.reject(new Error('observer')), onStateChange: () => { throw new Error('observer'); } });
  assert.equal(await f.executor.run(item(() => { throw new Error('host failed'); }), {}), 'failed');
  assert.equal(f.executor.getState().blocksChanges, false);
  assert.equal(f.executor.getState().error, 'host failed');
  assert.equal(await f.executor.run(item(() => ({ change: 'ok' })), {}), 'success');
  assert.deepEqual(f.changes, ['ok']);
  await new Promise(resolve => setImmediate(resolve));
});

test('prepareChange isolates mutable host plans before waiting for confirmation', async () => {
  const source = ['A1'];
  const f = fixture({ prepareChange: value => Object.freeze([...value]) });
  await f.executor.run(item(() => ({ change: source })), {}, 'confirm');
  source[0] = 'B2';
  assert.equal(await f.executor.confirm(), 'success');
  assert.deepEqual(f.changes, [['A1']]);
});

test('synchronous cancellation from an observer does not start host processing', async () => {
  let calls = 0; let executor;
  executor = createContextMenuExecutor({ getRevision: () => 0, apply() {},
    onStateChange: state => { if (state.phase === 'preparing') executor.cancel(); } });
  assert.equal(await executor.run(item(() => { calls++; }), {}), 'cancelled');
  assert.equal(calls, 0);
});

test('completion cleanup cannot cancel a subsequent job started by an observer', async () => {
  let executor; let cleanupAttempt; let nextRun; let first = true;
  const next = item(() => ({ change: 'next' }));
  const events = [];
  executor = createContextMenuExecutor({ getRevision: () => 0, apply() {},
    onStateChange: state => {
      if (state.phase === 'idle' && first) cleanupAttempt = executor.run(next, {});
    },
    onEvent: event => {
      events.push(event.status);
      if (event.status === 'success' && first) { first = false; nextRun = executor.run(next, {}); }
    },
  });
  assert.equal(await executor.run(item((_context, { signal }) => {
    signal.addEventListener('abort', () => executor.cancel(), { once: true });
  }), {}), 'success');
  assert.equal(await cleanupAttempt, 'busy');
  assert.equal(await nextRun, 'success');
  assert.deepEqual(events, ['start', 'success', 'start', 'success']);
});

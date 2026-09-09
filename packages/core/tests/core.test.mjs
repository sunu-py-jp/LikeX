import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false });
const { notifyHost, resolveFeatureFlags, chainResult, isPromiseLike, createUnsavedChangesGuard } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('core imports and initializes without React or browser globals', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.doesNotThrow(() => createUnsavedChangesGuard().register(null)());
});

test('notifications preserve arguments and isolate synchronous and async observer failures', async () => {
  const events = [];
  notifyHost((...args) => events.push(args), { type: 'saved' }, 3);
  assert.deepEqual(events, [[{ type: 'saved' }, 3]]);
  assert.doesNotThrow(() => notifyHost(() => { throw new Error('observer'); }));
  assert.doesNotThrow(() => notifyHost(() => Promise.reject(new Error('observer'))));
  notifyHost(undefined, 'ignored');
  await new Promise(resolve => setImmediate(resolve));
});

test('feature resolution preserves defaults and does not mutate caller objects or expose unknown keys', () => {
  const defaults = Object.freeze({ edit: true, history: false });
  const overrides = Object.freeze({ edit: false, history: undefined, unknown: true });
  assert.deepEqual(resolveFeatureFlags(defaults, overrides), { edit: false, history: false });
  assert.deepEqual(resolveFeatureFlags(defaults), defaults);
  assert.notEqual(resolveFeatureFlags(defaults), defaults);
});

test('continuations remain synchronous unless either operation needs a Promise', async () => {
  assert.equal(chainResult(3, value => value * 2), 6);
  assert.equal(await chainResult(Promise.resolve(3), value => value * 2), 6);
  assert.equal(await chainResult(3, async value => value * 2), 6);
  assert.equal(isPromiseLike(null), false);
  assert.equal(isPromiseLike({ then: false }), false);
  assert.equal(isPromiseLike(Promise.resolve()), true);
  assert.equal(await chainResult({ then(resolve) { resolve(4); } }, value => value + 1), 5);
});

test('continuations preserve rejection and do not hide callback failures', async () => {
  const cause = new Error('validation failed');
  let called = false;
  await assert.rejects(chainResult(Promise.reject(cause), () => { called = true; }), cause);
  assert.equal(called, false);
  assert.throws(() => chainResult(true, () => { throw cause; }), cause);
  await assert.rejects(chainResult(Promise.resolve(true), () => { throw cause; }), cause);
});

test('browser guards share registrations and attach only while dirty', () => {
  const listeners = new Set();
  const view = { addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn), confirm: () => true };
  const guard = createUnsavedChangesGuard();
  const releaseFirst = guard.register(view), releaseSecond = guard.register(view);
  assert.equal(listeners.size, 0);
  guard.setActive(true);
  assert.equal(listeners.size, 1);
  const event = { preventDefault() { this.cancelled = true; } };
  for (const listener of listeners) listener(event);
  assert.equal(event.cancelled, true);
  assert.equal(event.returnValue, '');
  releaseFirst(); releaseFirst();
  assert.equal(listeners.size, 1);
  releaseSecond();
  assert.equal(listeners.size, 0);
});

test('explicit close text belongs to the host and an unavailable confirmation denies closing', () => {
  const guard = createUnsavedChangesGuard({ closeMessage: 'Discard this draft?' });
  const messages = [];
  const view = { confirm: message => { messages.push(message); return false; } };
  assert.equal(guard.confirmClose(view), true);
  guard.setActive(true);
  assert.equal(guard.confirmClose(view), false);
  assert.deepEqual(messages, ['Discard this draft?']);
  assert.equal(guard.confirmClose({ confirm() { throw new Error('closed'); } }), false);
});

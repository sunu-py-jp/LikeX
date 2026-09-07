import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { createUnsavedChangesGuard } = await importTypeScript('../src/model/unsaved-changes.ts');

function mockWindow() {
  const listeners = new Set();
  const confirmations = [];
  return {
    listeners, confirmations,
    addEventListener(type, listener) { assert.equal(type, 'beforeunload'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'beforeunload'); listeners.delete(listener); },
    confirm(message) { confirmations.push(message); return true; },
    beforeUnload() {
      const event = { defaultPrevented: false, returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
      for (const listener of [...listeners]) listener(event);
      return event;
    },
  };
}

test('the native unload warning exists only while the workspace has unsaved changes', () => {
  const guard = createUnsavedChangesGuard();
  const window = mockWindow();
  const unregister = guard.register(window);
  assert.equal(window.listeners.size, 0);
  assert.equal(window.beforeUnload().defaultPrevented, false);
  guard.setActive(true);
  guard.setActive(true);
  assert.equal(window.listeners.size, 1);
  const event = window.beforeUnload();
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, '');
  assert.deepEqual(window.confirmations, [], 'native closing uses the browser confirmation, not window.confirm');
  guard.setActive(false);
  assert.equal(window.listeners.size, 0);
  assert.equal(window.beforeUnload().defaultPrevented, false);
  guard.setActive(true);
  assert.equal(window.listeners.size, 1);
  unregister();
  assert.equal(window.listeners.size, 0);
});

test('parent, child and newly registered grandchild windows share the current warning state', () => {
  const guard = createUnsavedChangesGuard();
  const windows = [mockWindow(), mockWindow(), mockWindow()];
  const unregister = windows.slice(0, 2).map(window => guard.register(window));
  guard.setActive(true);
  unregister.push(guard.register(windows[2]));
  assert.ok(windows.every(window => window.listeners.size === 1 && window.beforeUnload().defaultPrevented));
  guard.setActive(false);
  assert.ok(windows.every(window => window.listeners.size === 0));
  unregister.forEach(dispose => dispose());
});

test('registrations in one window are reference counted and cleanup is idempotent', () => {
  const guard = createUnsavedChangesGuard();
  const window = mockWindow();
  guard.setActive(true);
  const first = guard.register(window);
  const second = guard.register(window);
  assert.equal(window.listeners.size, 1);
  first();
  first();
  assert.equal(window.listeners.size, 1);
  assert.equal(window.beforeUnload().defaultPrevented, true);
  second();
  assert.equal(window.listeners.size, 0);
  guard.setActive(false);
  guard.setActive(true);
  assert.equal(window.listeners.size, 0, 'released windows are not re-registered by later edits');
  const third = guard.register(window);
  assert.equal(window.listeners.size, 1);
  second();
  assert.equal(window.listeners.size, 1, 'an old cleanup cannot release a later registration');
  third();
});

test('independent workspaces in one window cannot remove each other\'s protection', () => {
  const first = createUnsavedChangesGuard();
  const second = createUnsavedChangesGuard();
  const window = mockWindow();
  const releaseFirst = first.register(window);
  const releaseSecond = second.register(window);
  first.setActive(true);
  second.setActive(true);
  assert.equal(window.listeners.size, 2);
  first.setActive(false);
  releaseFirst();
  assert.equal(window.listeners.size, 1);
  assert.equal(window.beforeUnload().defaultPrevented, true);
  releaseSecond();
  assert.equal(window.listeners.size, 0);
});

test('missing windows are safe for SSR and repeated registration cleanup', () => {
  const guard = createUnsavedChangesGuard();
  const releaseNull = guard.register(null);
  const releaseUndefined = guard.register(undefined);
  guard.setActive(true);
  releaseNull(); releaseNull(); releaseUndefined();
  guard.setActive(false);
});

test('programmatic closing asks only when dirty and clearly states the shared draft is retained', () => {
  const guard = createUnsavedChangesGuard();
  const window = mockWindow();
  assert.equal(guard.confirmClose(window), true);
  assert.deepEqual(window.confirmations, []);
  guard.setActive(true);
  assert.equal(guard.confirmClose(window), true);
  assert.deepEqual(window.confirmations, ['未保存の変更があります。このウィンドウを閉じますか？\n変更は親画面に保持されます。']);
  window.confirm = () => false;
  assert.equal(guard.confirmClose(window), false);
  guard.setActive(false);
  assert.equal(guard.confirmClose(window), true);
});

test('a refused or unavailable programmatic close confirmation retains the unload protection', () => {
  const guard = createUnsavedChangesGuard();
  const window = mockWindow();
  const release = guard.register(window);
  guard.setActive(true);
  window.confirm = () => { throw new Error('Dialog unavailable'); };
  assert.equal(guard.confirmClose(window), false);
  assert.equal(window.beforeUnload().defaultPrevented, true);
  delete window.confirm;
  assert.equal(guard.confirmClose(window), false);
  assert.equal(window.beforeUnload().defaultPrevented, true);
  release();
});

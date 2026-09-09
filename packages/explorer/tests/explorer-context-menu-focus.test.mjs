import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { useMenuActionHandoff } from './src/ui/use-menu-action-handoff.ts';
    export { ExplorerDomContext } from './src/ui/explorer-dom-context.tsx';
  `, resolveDir: packageRoot, sourcefile: 'context-menu-focus.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useMenuActionHandoff, ExplorerDomContext } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t) {
  let current, renderer;
  const log = [];
  const document = { activeElement: null, defaultView: { closed: false } };
  const trigger = { isConnected: true, matches: () => false, focus() { log.push('trigger'); document.activeElement = this; } };
  const container = { focus() { log.push('container'); document.activeElement = this; } };
  document.activeElement = trigger;
  function Probe() { current = useMenuActionHandoff(); return null; }
  await act(async () => { renderer = create(h(StrictMode, null,
    h(ExplorerDomContext.Provider, { value: { document, dialogContainer: container } }, h(Probe)))); });
  const unmount = () => act(() => renderer.unmount());
  t.after(unmount);
  return { get current() { return current; }, document, trigger, container, log, unmount };
}

test('host dialog starts after menu scope disposal and keeps its input focus', async t => {
  const hook = await mount(t);
  const input = { focus() { hook.log.push('dialog input'); hook.document.activeElement = this; } };
  let released = false;
  hook.current.onOpenChange(true);
  hook.current.defer(() => {
    assert.equal(released, true, 'host cannot open while the old menu focus trap is active');
    input.focus();
  });
  const close = new Event('closeAutoFocus', { cancelable: true });
  hook.current.onCloseAutoFocus(close);
  assert.equal(close.defaultPrevented, true);
  assert.deepEqual(hook.log, [], 'selecting a menu item does not execute the host action yet');
  // Radix releases the focus scope after dispatching the close event.
  released = true;
  await Promise.resolve();
  assert.deepEqual(hook.log, ['trigger', 'dialog input']);
  assert.equal(hook.document.activeElement, input);
});

test('an external action without a dialog returns focus to its original trigger', async t => {
  const hook = await mount(t);
  hook.current.onOpenChange(true);
  hook.current.defer(() => hook.log.push('action'));
  hook.current.onCloseAutoFocus(new Event('closeAutoFocus', { cancelable: true }));
  await Promise.resolve();
  assert.deepEqual(hook.log, ['trigger', 'action']);
  assert.equal(hook.document.activeElement, hook.trigger);
});

test('ordinary and rename menu closure keeps its own default focus behavior', async t => {
  const hook = await mount(t);
  hook.current.onOpenChange(true);
  const event = new Event('closeAutoFocus', { cancelable: true });
  hook.current.onCloseAutoFocus(event);
  await Promise.resolve();
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(hook.log, []);
});

test('unmount before queued handoff prevents the host action from starting', async t => {
  const hook = await mount(t);
  hook.current.onOpenChange(true);
  hook.current.defer(() => hook.log.push('unexpected action'));
  act(() => {
    hook.current.onCloseAutoFocus(new Event('closeAutoFocus', { cancelable: true }));
    hook.unmount();
  });
  await Promise.resolve();
  assert.deepEqual(hook.log, []);
});

test('reopening a menu invalidates a previous queued action', async t => {
  const hook = await mount(t);
  hook.current.onOpenChange(true);
  hook.current.defer(() => hook.log.push('unexpected action'));
  hook.current.onCloseAutoFocus(new Event('closeAutoFocus', { cancelable: true }));
  hook.current.onOpenChange(true);
  await Promise.resolve();
  assert.deepEqual(hook.log, []);
});

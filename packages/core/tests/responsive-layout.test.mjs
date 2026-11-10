import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolveResponsiveLayout, MOBILE_LAYOUT_BREAKPOINT } from '../src/responsive-layout.ts';

const bundle = await build({ entryPoints: [new URL('../src/browser/responsive-layout.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { observeResponsiveLayout } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('auto follows component CSS pixels, with deterministic server/hidden fallback and explicit overrides', () => {
  assert.equal(MOBILE_LAYOUT_BREAKPOINT, 720);
  for (const width of [320, 390, 719]) assert.equal(resolveResponsiveLayout(undefined, width), 'mobile');
  for (const width of [0, -1, NaN, Infinity, 720, 1200]) assert.equal(resolveResponsiveLayout('auto', width), 'desktop');
  assert.equal(resolveResponsiveLayout('desktop', 320), 'desktop');
  assert.equal(resolveResponsiveLayout('mobile', 1200), 'mobile');
});

test('observer tracks parent resizing, notifies only transitions, and ignores queued work after disposal', () => {
  const calls = []; let callback, disconnected = 0, observed;
  const view = { ResizeObserver: class { constructor(cb) { callback = cb; } observe(el) { observed = el; } disconnect() { disconnected++; } } };
  const el = { clientWidth: 390, ownerDocument: { defaultView: view } };
  const dispose = observeResponsiveLayout(el, 'auto', value => calls.push(value));
  assert.equal(observed, el); assert.deepEqual(calls, ['mobile']);
  el.clientWidth = 600; callback(); assert.equal(calls.length, 1);
  el.clientWidth = 720; callback(); assert.deepEqual(calls, ['mobile', 'desktop']);
  el.clientWidth = 390; callback(); assert.deepEqual(calls, ['mobile', 'desktop', 'mobile']);
  dispose(); el.clientWidth = 1000; callback(); assert.equal(calls.length, 3); assert.equal(disconnected, 1);
});

test('forced layout needs no observation; fallback resize listener is removed on disposal', () => {
  const calls = []; let resize, removed;
  const view = { addEventListener(name, cb) { assert.equal(name, 'resize'); resize = cb; }, removeEventListener(name, cb) { assert.equal(name, 'resize'); removed = cb; } };
  const el = { clientWidth: 390, ownerDocument: { defaultView: view } };
  observeResponsiveLayout(el, 'desktop', v => calls.push(v))(); assert.equal(resize, undefined);
  const dispose = observeResponsiveLayout(el, undefined, v => calls.push(v));
  el.clientWidth = 800; resize(); dispose();
  assert.equal(removed, resize); assert.deepEqual(calls, ['desktop', 'mobile', 'desktop']);
});

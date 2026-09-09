import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ entryPoints: [new URL('../src/ui/spreadsheet-context-menu.tsx', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetContextMenu } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, { height = 80, disabled = false } = {}) {
  let renderer, closed = 0;
  const listeners = new Map(), focusCalls = [];
  const listen = { addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type) { listeners.delete(type); } };
  const view = { ...listen, innerWidth: 480, innerHeight: 300 };
  const document = { ...listen, defaultView: view, activeElement: null };
  const region = { ownerDocument: document, clientLeft: 2, clientTop: 3, clientWidth: 496, clientHeight: 294,
    scrollTop: 0, scrollLeft: 0, getBoundingClientRect: () => ({ left: 10, top: 20, right: 510, bottom: 320 }) };
  const buttons = [0, 1].map(index => ({ offsetTop: 4 + index * 100, offsetHeight: 28,
    focus(options) { focusCalls.push({ index, options }); document.activeElement = this; } }));
  const menu = { style: {}, scrollTop: 0,
    get offsetWidth() { return Math.min(260, parseFloat(this.style.maxWidth)); },
    get offsetHeight() { return Math.min(height, parseFloat(this.style.maxHeight)); },
    get clientHeight() { return this.offsetHeight - 2; },
    querySelector: () => disabled ? null : buttons[0], querySelectorAll: () => disabled ? [] : buttons,
    contains: node => node === menu || buttons.includes(node),
    focus(options) { focusCalls.push({ index: 'menu', options }); document.activeElement = this; },
  };
  const controller = { menu: { context: { target: { kind: 'sheet', sheetId: 'main' } }, items: [], deleteSheet: { disabled },
    x: 499, y: 319, returnFocus: null }, state: { phase: 'idle', error: null }, closeMenu() { closed++; }, deleteSheet() {} };
  await act(async () => { renderer = create(createElement(SpreadsheetContextMenu, { controller, root: { current: region } }), {
    createNodeMock: element => element.props.className === 'lxs-context-menu' ? menu : null,
  }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { menu, region, buttons, focusCalls, get closed() { return closed; }, get root() { return renderer.root; },
    fire(type, target) { listeners.get(type)?.({ target }); } };
}

test('footer menus fit inside the viewport with border offsets and an inset, without scrolling the page on focus', async t => {
  const ui = await mount(t);
  const origin = { x: 12, y: 23 };
  assert.equal(origin.x + parseFloat(ui.menu.style.left) + ui.menu.offsetWidth, 476);
  assert.equal(origin.y + parseFloat(ui.menu.style.top) + ui.menu.offsetHeight, 296);
  assert.deepEqual(ui.focusCalls, [{ index: 0, options: { preventScroll: true } }]);
  assert.equal(ui.closed, 0);
});

test('long menus apply their height limit before placement and scrolling inside the menu keeps it open', async t => {
  const ui = await mount(t, { height: 900 });
  assert.equal(ui.menu.style.maxHeight, '269px');
  assert.equal(ui.menu.style.top, '4px');
  ui.fire('scroll', ui.menu);
  ui.fire('scroll', ui.buttons[0]);
  assert.equal(ui.closed, 0);
  ui.fire('scroll', ui.region);
  assert.equal(ui.closed, 1, 'scrolling the surrounding spreadsheet closes an anchored menu');
});

test('keyboard navigation scrolls only the menu and an entirely disabled menu remains keyboard dismissible', async t => {
  const ui = await mount(t);
  ui.root.findByProps({ role: 'menu' }).props.onKeyDown({ key: 'End', target: ui.buttons[0], preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(ui.focusCalls.at(-1), { index: 1, options: { preventScroll: true } });
  assert.equal(ui.menu.scrollTop, 54);
  ui.fire('scroll', ui.menu);
  assert.equal(ui.closed, 0);

  const disabled = await mount(t, { disabled: true });
  assert.deepEqual(disabled.focusCalls, [{ index: 'menu', options: { preventScroll: true } }]);
  disabled.root.findByProps({ role: 'menu' }).props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(disabled.closed, 1);
});

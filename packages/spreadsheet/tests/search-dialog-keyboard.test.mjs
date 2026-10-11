import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `export {useSpreadsheet} from './src/state/use-spreadsheet';
  export {SpreadsheetSearchDialog} from './src/ui/spreadsheet-search-dialog';`, resolveDir: new URL('../', import.meta.url).pathname },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'react-and-portals', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    // Keep the real floating window, including its event isolation and focus lifecycle.
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'inline-portal' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-portal' }, () => ({ contents: 'export const createPortal = children => children;', loader: 'js' }));
  } }] });
const { useSpreadsheet, SpreadsheetSearchDialog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
async function mount(t, overrides = {}) {
  let controller, renderer, focused = 0;
  const initialWorkbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 5, columnCount: 5, cells: { A1: { value: 'Alpha' } } }] };
  const input = { focus() { focused++; ownerDocument.activeElement = input; }, closest() { return null; }, tabIndex: 0 };
  const previous = { isConnected: true, focus() {} };
  const computed = { font: '13px sans-serif', fontFamily: 'sans-serif', fontSize: '13px', lineHeight: '18px', colorScheme: 'light',
    color: '#252a29', direction: 'ltr', length: 0, getPropertyValue() { return ''; }, *[Symbol.iterator]() {} };
  const view = { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {}, getComputedStyle() { return computed; },
    MutationObserver: class { observe() {} disconnect() {} } };
  const ownerDocument = { activeElement: previous, defaultView: view, body: {}, documentElement: { clientWidth: 1400, clientHeight: 900 } };
  const region = { ownerDocument, clientWidth: 960, clientHeight: 700, getAttribute() { return 'light'; },
    getBoundingClientRect() { return { left: 40, top: 50, right: 1000, bottom: 750, width: 960, height: 700 }; } };
  const panel = { ownerDocument, contains(node) { return node === input; }, querySelector() { return input; }, querySelectorAll() { return [input]; }, focus() {} };
  function Probe() {
    controller = useSpreadsheet({ initialWorkbook, initialSearchOpen: true, initialSearchQuery: 'Alpha', onSave() {}, ...overrides });
    const { mode, focus } = controller.searchPanel;
    return mode ? h(SpreadsheetSearchDialog, { key: `${mode}-${focus}`, controller, initialMode: mode, onClose: controller.closeSearch }) : null;
  }
  await act(async () => { renderer = create(h(Probe), { createNodeMock(element) {
    if (element.type === 'span' && element.props.hidden) return { closest() { return region; } };
    if (element.props.role === 'dialog') return panel;
    if (element.type === 'input' && element.props.value === controller.searchPanel.query) return input;
    return null;
  } }); });
  t.after(() => act(async () => renderer.unmount()));
  return { get c() { return controller; }, get root() { return renderer.root; }, get focused() { return focused; }, input,
    async key(key = 'f', overrides = {}) {
      const event = { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, nativeEvent: {}, target: input,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...overrides };
      await act(async () => renderer.root.findByProps({ role: 'dialog' }).props.onKeyDown(event));
      return event;
    },
  };
}

test('Ctrl/Cmd+F inside the real modeless search window refocuses search and prevents the browser search', async t => {
  const app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden' });
  const source = app.c.getWorkbook();
  assert.equal(app.root.findByProps({ role: 'dialog' }).props['aria-modal'], 'false');
  assert.equal(app.root.findAll(node => typeof node.props.className === 'string' && node.props.className.includes('lxs-dialog-backdrop')).length, 0);
  for (const modifiers of [{}, { ctrlKey: false, metaKey: true }]) {
    const focus = app.focused, revision = app.c.searchPanel.focus;
    // The dialog receives the shortcut from fields, result buttons and its footer alike.
    const event = await app.key('f', { ...modifiers, target: { tagName: 'BUTTON' } });
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.equal(app.c.searchPanel.focus, revision + 1); assert.ok(app.focused > focus);
    assert.equal(app.c.searchPanel.query, 'Alpha'); assert.equal(app.c.searchPanel.mode, 'find');
    assert.equal(app.c.getWorkbook(), source); assert.equal(app.c.canUndo, false); assert.equal(app.c.dirty, false);
  }
});

test('dialog find shortcut leaves other modifier chords, IME and already handled events alone', async t => {
  const app = await mount(t), before = app.c.searchPanel;
  for (const extra of [{ ctrlKey: false }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
    const event = await app.key('f', extra);
    assert.notEqual(event.defaultPrevented, true); assert.deepEqual(app.c.searchPanel, before);
  }
  await app.key('f', { defaultPrevented: true }); assert.deepEqual(app.c.searchPanel, before);
});

test('finding from replace uses the shared open API, preserves text and isolates window shortcuts', async t => {
  const app = await mount(t);
  await act(async () => app.c.openReplace()); assert.equal(app.c.searchPanel.mode, 'replace');
  assert.equal((await app.key()).defaultPrevented, true);
  assert.equal(app.c.searchPanel.mode, 'find'); assert.equal(app.c.searchPanel.query, 'Alpha');
  assert.equal((await app.key('s')).defaultPrevented, true, 'the search input does not trigger a sheet save');
  const escape = await app.key('Escape', { ctrlKey: false });
  assert.equal(escape.defaultPrevented, true); assert.equal(app.c.searchPanel.mode, null);
});

test('modeless search lets Tab leave the window and IME Escape does not dismiss it', async t => {
  const app = await mount(t);
  for (const shiftKey of [false, true]) {
    const event = await app.key('Tab', { ctrlKey: false, shiftKey });
    assert.notEqual(event.defaultPrevented, true, 'Tab is not trapped in the floating window');
  }
  for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }]) {
    const event = await app.key('Escape', { ctrlKey: false, ...extra });
    assert.notEqual(event.defaultPrevented, true); assert.equal(app.c.searchPanel.mode, 'find');
  }
  assert.equal((await app.key('Escape', { ctrlKey: false })).defaultPrevented, true);
  assert.equal(app.c.searchPanel.mode, null);
});

test('separate spreadsheet search windows keep their commands and clipboard events isolated', async t => {
  const first = await mount(t), second = await mount(t, { initialSearchQuery: 'Second workbook query' });
  const firstSource = first.c.getWorkbook(), secondSource = second.c.getWorkbook();
  const panel = first.root.findByProps({ role: 'dialog' });
  for (const name of ['onCopy', 'onCut', 'onPaste', 'onContextMenu', 'onPointerDown']) {
    const event = { target: first.input, stopPropagation() { this.stopped = true; } };
    panel.props[name](event);
    assert.equal(event.stopped, true, `${name} must not bubble through the portal into the sheet`);
  }
  await first.key('f');
  assert.equal(first.c.searchPanel.query, 'Alpha'); assert.equal(second.c.searchPanel.query, 'Second workbook query');
  await first.key('Escape', { ctrlKey: false });
  assert.equal(first.c.searchPanel.mode, null); assert.equal(second.c.searchPanel.mode, 'find');
  assert.equal(first.c.getWorkbook(), firstSource); assert.equal(second.c.getWorkbook(), secondSource);
});

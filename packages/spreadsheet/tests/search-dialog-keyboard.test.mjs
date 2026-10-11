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
    // Keep the real dialog, including its event isolation and focus lifecycle.
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'inline-portal' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-portal' }, () => ({ contents: 'export const createPortal = children => children;', loader: 'js' }));
  } }] });
const { useSpreadsheet, SpreadsheetSearchDialog } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
async function mount(t, overrides = {}) {
  let controller, renderer, focused = 0;
  const initialWorkbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 5, columnCount: 5, cells: { A1: { value: 'Alpha' } } }] };
  const input = { focus() { focused++; }, closest() { return null; }, tabIndex: 0 };
  const region = {}, previous = { isConnected: true, focus() {} };
  const panel = { ownerDocument: { activeElement: previous }, querySelector() { return input; }, querySelectorAll() { return [input]; }, focus() {} };
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
      await act(async () => renderer.root.findByProps({ className: 'lxs-dialog-backdrop lxs-form-dialog-backdrop' }).props.onKeyDown(event));
      return event;
    },
  };
}

test('Ctrl/Cmd+F inside the real search dialog refocuses search and prevents the browser search', async t => {
  const app = await mount(t, { readOnly: true, initialRibbonDisplayMode: 'hidden' });
  const source = app.c.getWorkbook();
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

test('finding from replace uses the shared open API and preserves text, while modal save and Escape guards remain intact', async t => {
  const app = await mount(t);
  await act(async () => app.c.openReplace()); assert.equal(app.c.searchPanel.mode, 'replace');
  assert.equal((await app.key()).defaultPrevented, true);
  assert.equal(app.c.searchPanel.mode, 'find'); assert.equal(app.c.searchPanel.query, 'Alpha');
  assert.equal((await app.key('s')).defaultPrevented, true, 'the modal still prevents save shortcuts');
  const escape = await app.key('Escape', { ctrlKey: false });
  assert.equal(escape.defaultPrevented, true); assert.equal(app.c.searchPanel.mode, null);
});

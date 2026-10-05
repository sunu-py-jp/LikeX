import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `
  export { default as Spreadsheet } from './src/spreadsheet';
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { SpreadsheetToolbar } from './src/ui/spreadsheet-toolbar';
  export { useNamedRangeManager } from './src/ui/named-ranges/use-named-range-manager';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'ribbon-toolbar-test.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    // Keep the dialog's real fields and command logic without requiring portals.
    builder.onResolve({ filter: /\/spreadsheet-dialog$/ }, () => ({ path: 'dialog', namespace: 'inline-dialog' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-dialog' }, () => ({ contents:
      'import {createElement} from "react"; export const SpreadsheetDialog = ({children,actions,title}) => createElement("div",{role:"dialog","aria-label":title},children,actions);', loader: 'js' }));
  } }] });
const { Spreadsheet, useSpreadsheet, SpreadsheetToolbar, useNamedRangeManager } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function visible(node) {
  for (let current = node; current; current = current.parent) {
    if (current.props.hidden || current.props['aria-hidden'] === true || current.props.style?.display === 'none') return false;
  }
  return true;
}
function event(key, extra = {}) {
  return { key, nativeEvent: {}, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
}
async function mount(t, overrides = {}) {
  let c, renderer, focused = null;
  let props = { initialWorkbook: { sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 10, columnCount: 10,
    cells: { A1: { value: 'Original' } } }] }, onSave: () => {}, ...overrides };
  const listeners = new Map();
  const document = {
    addEventListener(type, callback) { const callbacks = listeners.get(type) ?? new Set(); callbacks.add(callback); listeners.set(type, callbacks); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const nodeMock = element => {
    if (element.props.role === 'tab' || element.props['aria-label'] === 'リボンを表示') {
      return { ownerDocument: document, focus() { focused = element.props['aria-label'] ?? element.props.children; } };
    }
    if (element.props.className?.includes('lxs-ribbon-container')) {
      return { ownerDocument: document, contains: target => target?.inside === true };
    }
    return null;
  };
  function Probe() {
    c = useSpreadsheet(props);
    const namedRangeManager = useNamedRangeManager(c);
    return createElement(SpreadsheetToolbar, { controller: c, namedRangeManager, clipboard: { copy() {}, paste() {} } });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: nodeMock }); });
  t.after(async () => {
    try { await act(async () => renderer.unmount()); }
    finally { if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document; }
  });
  return {
    get c() { return c; }, get root() { return renderer.root; }, get focused() { return focused; },
    tab(label) { return renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.join('') === label); },
    visibleTabs() { return renderer.root.findAllByProps({ role: 'tab' }).filter(visible).map(node => node.children.join('')); },
    visiblePanels() { return renderer.root.findAllByProps({ role: 'tabpanel' }).filter(visible); },
    visibleLabel(label) { return renderer.root.findAllByProps({ 'aria-label': label }).filter(node => typeof node.type === 'string' && visible(node)); },
    async clickTab(label) { await act(async () => this.tab(label).props.onClick()); },
    async display(value) { await act(async () => renderer.root.findByProps({ 'aria-label': 'リボンの表示' }).props.onChange({ currentTarget: { value }, target: { value } })); },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
    async documentEvent(type, data) { await act(async () => { for (const listener of [...listeners.get(type) ?? []]) listener(data); }); },
    async key(key, extra = {}) { await act(async () => renderer.root.findByProps({ role: 'tablist' }).props.onKeyDown(event(key, extra))); },
  };
}

test('ribbon defaults to expanded and offers the three interactive display modes', async t => {
  const ui = await mount(t);
  assert.deepEqual(ui.visibleTabs(), ['ファイル', 'ホーム', '挿入', 'データ']);
  assert.equal(ui.visiblePanels().length, 1);
  assert.equal(ui.visibleLabel('シートの編集').length, 1);
  const mode = ui.root.findByProps({ 'aria-label': 'リボンの表示' });
  assert.equal(mode.props.value, 'expanded');
  assert.deepEqual(mode.findAllByType('option').map(option => option.props.value), ['expanded', 'tabs', 'autoHide']);
});

test('tabs mode opens the chosen panel temporarily and preserves the workbook', async t => {
  const changes = [];
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs', onRibbonDisplayModeChange: value => changes.push(value) });
  const workbook = ui.c.workbook;
  assert.equal(ui.visibleTabs().length, 4);
  assert.equal(ui.visiblePanels().length, 0);
  await ui.clickTab('挿入');
  assert.equal(ui.visibleLabel('シートへの挿入').length, 1);
  assert.equal(ui.visiblePanels().length, 1);
  await ui.clickTab('ホーム');
  assert.equal(ui.visibleLabel('シートの編集').length, 1);
  await ui.documentEvent('pointerdown', { target: { inside: false } });
  assert.equal(ui.visiblePanels().length, 0);
  assert.equal(ui.c.ribbonDisplayMode, 'tabs');
  assert.equal(ui.c.workbook, workbook);
  assert.equal(ui.c.dirty, false);
  assert.deepEqual(changes, []);
});

test('auto-hide starts with a reveal control and returns to the hidden header after an outside click', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'autoHide' });
  assert.equal(ui.visibleTabs().length, 0);
  assert.equal(ui.visiblePanels().length, 0);
  const reveal = ui.visibleLabel('リボンを表示');
  assert.equal(reveal.length, 1);
  await act(async () => reveal[0].props.onClick());
  assert.equal(ui.visibleTabs().length, 4);
  assert.equal(ui.visiblePanels().length, 1);
  await ui.documentEvent('pointerdown', { target: { inside: true } });
  assert.equal(ui.visiblePanels().length, 1);
  await ui.documentEvent('pointerdown', { target: { inside: false } });
  assert.equal(ui.visibleTabs().length, 0);
  assert.equal(ui.visiblePanels().length, 0);
  assert.equal(ui.visibleLabel('リボンを表示').length, 1);
});

test('fully hidden mode omits tabs, commands and the reveal control from initial display', async t => {
  const ui = await mount(t, { ribbonDisplayMode: 'hidden' });
  assert.equal(ui.visibleTabs().length, 0);
  assert.equal(ui.visiblePanels().length, 0);
  assert.equal(ui.visibleLabel('リボンを表示').length, 0);
  assert.equal(ui.visibleLabel('リボンの表示').length, 0);
  await ui.update({ ribbonDisplayMode: 'expanded' });
  assert.equal(ui.visibleTabs().length, 4);
  assert.equal(ui.visiblePanels().length, 1);
});

test('left/right and edge keys select and reveal tabs in collapsed modes', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  await ui.key('ArrowRight');
  assert.equal(ui.tab('挿入').props['aria-selected'], true);
  assert.equal(ui.visibleLabel('シートへの挿入').length, 1);
  assert.equal(ui.focused, '挿入');
  await ui.key('End');
  assert.equal(ui.tab('データ').props['aria-selected'], true);
  await ui.key('ArrowRight');
  assert.equal(ui.tab('ファイル').props['aria-selected'], true);
  await ui.key('ArrowLeft');
  assert.equal(ui.tab('データ').props['aria-selected'], true);
  await ui.key('Home');
  assert.equal(ui.tab('ファイル').props['aria-selected'], true);
});

test('tab double-click and the display selector change only presentation state', async t => {
  const changes = [];
  const ui = await mount(t, { onRibbonDisplayModeChange: value => changes.push(value) });
  const workbook = ui.c.workbook;
  await act(async () => ui.tab('ホーム').props.onDoubleClick(event('')));
  assert.equal(ui.c.ribbonDisplayMode, 'tabs');
  assert.equal(ui.visiblePanels().length, 0);
  await act(async () => ui.tab('ホーム').props.onDoubleClick(event('')));
  assert.equal(ui.c.ribbonDisplayMode, 'expanded');
  assert.equal(ui.visiblePanels().length, 1);
  await ui.display('autoHide');
  assert.equal(ui.c.ribbonDisplayMode, 'autoHide');
  assert.equal(ui.visibleTabs().length, 0);
  assert.deepEqual(changes, ['tabs', 'expanded', 'autoHide']);
  assert.equal(ui.c.workbook, workbook);
  assert.equal(ui.c.canUndo, false);
});

test('host controlled mode requests changes without overriding the supplied display mode', async t => {
  const changes = [];
  const ui = await mount(t, { ribbonDisplayMode: 'tabs', onRibbonDisplayModeChange: value => changes.push(value) });
  await ui.display('expanded');
  assert.deepEqual(changes, ['expanded']);
  assert.equal(ui.c.ribbonDisplayMode, 'tabs');
  assert.equal(ui.visiblePanels().length, 0);
  await ui.update({ ribbonDisplayMode: 'expanded' });
  assert.equal(ui.visiblePanels().length, 1);
});

test('changing ribbon visibility preserves an unfinished cell editor', async t => {
  const ui = await mount(t);
  const workbook = ui.c.workbook;
  await act(async () => ui.c.beginEdit({ row: 0, column: 0 }, 'Unfinished value'));
  for (const ribbonDisplayMode of ['tabs', 'autoHide', 'hidden', 'expanded']) {
    await ui.update({ ribbonDisplayMode });
    assert.equal(ui.c.editing.value, 'Unfinished value');
    assert.equal(ui.c.workbook, workbook);
  }
});

test('host hiding and restoring the ribbon preserves a format dialog and its draft', async t => {
  const ui = await mount(t);
  await act(async () => ui.root.findByProps({ 'aria-label': 'セルの書式設定' }).props.onClick());
  const dialog = () => ui.root.findByProps({ role: 'dialog', 'aria-label': 'セルの書式' });
  await act(async () => dialog().findAllByType('select')[0].props.onChange({ currentTarget: { value: 'alignment' } }));
  await act(async () => ui.root.findByProps({ 'aria-label': '文字の表示' }).props.onChange({ currentTarget: { value: 'shrink' } }));
  for (const ribbonDisplayMode of ['tabs', 'autoHide', 'hidden', 'expanded']) {
    await ui.update({ ribbonDisplayMode });
    assert.equal(dialog().findByProps({ 'aria-label': '文字の表示' }).props.value, 'shrink');
  }
  await act(async () => dialog().findAllByType('button').find(node => node.children.join('') === '適用').props.onClick());
  assert.equal(ui.c.activeSheet.cells.A1.format.shrinkToFit, true);
  assert.equal(ui.root.findAllByProps({ role: 'dialog' }).length, 0);
});

async function mountSpreadsheet(t, supplied = {}) {
  let renderer;
  const ref = createRef();
  let props = { ref, initialWorkbook: { sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 3, columnCount: 3,
    cells: { A1: { value: 'Original' } } }] }, onSave() {}, ...supplied };
  await act(async () => { renderer = create(createElement(Spreadsheet, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); },
    async shortcut(extra = {}) {
      const keyboard = event('F1', { ctrlKey: true, target: { closest: () => null }, ...extra });
      await act(async () => renderer.root.findByProps({ role: 'region' }).props.onKeyDown(keyboard));
      return keyboard;
    },
  };
}

test('Ctrl+F1 toggles the public ribbon mode without changing the workbook', async t => {
  const changes = [];
  const ui = await mountSpreadsheet(t, { onRibbonDisplayModeChange: value => changes.push(value) });
  const workbook = ui.ref.current.getWorkbook();
  for (const expected of ['tabs', 'expanded']) {
    assert.equal((await ui.shortcut()).defaultPrevented, true);
    assert.equal(ui.ref.current.getRibbonDisplayMode(), expected);
  }
  await act(async () => ui.ref.current.setRibbonDisplayMode('autoHide'));
  await ui.shortcut();
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  assert.deepEqual(changes, ['tabs', 'expanded', 'autoHide', 'expanded']);
  assert.equal(ui.ref.current.getWorkbook(), workbook);
  assert.equal(ui.ref.current.getHistoryState().canUndo, false);
});

test('Ctrl+F1 cannot reveal a fully hidden or host-locked ribbon', async t => {
  const ui = await mountSpreadsheet(t, { initialRibbonDisplayMode: 'hidden' });
  await ui.shortcut();
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'hidden');
  await ui.update({ ribbonDisplayMode: 'tabs' });
  await ui.shortcut();
  assert.equal(ui.ref.current.getRibbonDisplayMode(), 'tabs');
  for (const extra of [{ ctrlKey: false }, { altKey: true }, { nativeEvent: { isComposing: true } }]) {
    await ui.update({ ribbonDisplayMode: undefined });
    await act(async () => ui.ref.current.setRibbonDisplayMode('expanded'));
    await ui.shortcut(extra);
    assert.equal(ui.ref.current.getRibbonDisplayMode(), 'expanded');
  }
});

test('hiding the ribbon does not cancel a format edit awaiting host permission', async t => {
  let resolvePermission;
  const ui = await mount(t, { onEditRequest: () => new Promise(resolve => { resolvePermission = resolve; }) });
  await act(async () => ui.root.findByProps({ 'aria-label': 'セルの書式設定' }).props.onClick());
  const dialog = () => ui.root.findByProps({ role: 'dialog', 'aria-label': 'セルの書式' });
  await act(async () => dialog().findAllByType('select')[0].props.onChange({ currentTarget: { value: 'alignment' } }));
  await act(async () => ui.root.findByProps({ 'aria-label': '文字の表示' }).props.onChange({ currentTarget: { value: 'wrap' } }));
  await act(async () => dialog().findAllByType('button').find(node => node.children.join('') === '適用').props.onClick());
  assert.equal(ui.c.requesting, true);
  await ui.update({ ribbonDisplayMode: 'hidden' });
  assert.equal(ui.c.requesting, true);
  await act(async () => resolvePermission(true));
  assert.equal(ui.c.activeSheet.cells.A1.format.wrap, true);
  assert.equal(ui.c.canUndo, true);
});

for (const mode of ['tabs', 'autoHide']) test(`Escape closes the ${mode} overlay and restores keyboard focus`, async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: mode });
  if (mode === 'autoHide') await act(async () => ui.visibleLabel('リボンを表示')[0].props.onClick());
  await ui.clickTab('挿入');
  assert.equal(ui.visiblePanels().length, 1);
  const escape = event('Escape');
  await act(async () => ui.root.findByProps({ className: 'lxs-ribbon-container' }).props.onKeyDown(escape));
  assert.equal(escape.defaultPrevented, true);
  assert.equal(ui.visiblePanels().length, 0);
  assert.equal(ui.c.ribbonDisplayMode, mode);
  assert.equal(ui.focused, mode === 'autoHide' ? 'リボンを表示' : '挿入');
});

test('moving keyboard focus out of a temporary ribbon closes it without changing its active tab', async t => {
  const ui = await mount(t, { initialRibbonDisplayMode: 'tabs' });
  await ui.clickTab('挿入');
  await ui.documentEvent('focusin', { target: { inside: true } });
  assert.equal(ui.visiblePanels().length, 1);
  await ui.documentEvent('focusin', { target: { inside: false } });
  assert.equal(ui.visiblePanels().length, 0);
  await ui.update({ ribbonDisplayMode: 'hidden' });
  await ui.update({ ribbonDisplayMode: 'expanded' });
  assert.equal(ui.tab('挿入').props['aria-selected'], true);
  assert.equal(ui.visibleLabel('シートへの挿入').length, 1);
});

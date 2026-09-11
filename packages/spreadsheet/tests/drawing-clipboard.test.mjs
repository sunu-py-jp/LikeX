import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, Fragment } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `export * from './src/model';
export * from './src/session/create-spreadsheet-session';
export * from './src/state/use-spreadsheet'; export * from './src/state/use-spreadsheet-clipboard';
export * from './src/ui/spreadsheet-toolbar'; export * from './src/ui/spreadsheet-drawings';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'drawing-clipboard.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const m = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const anchor = { row: 1, column: 1, offsetX: 5, offsetY: 7 };
const shape = { id: 'shape', type: 'shape', shape: 'ellipse', anchor, width: 100, height: 70, fill: '#ffffff', stroke: '#217346', strokeWidth: 2, text: 'snapshot', bold: true };
const textBox = { id: 'text', type: 'text', anchor, width: 150, height: 80, text: 'text snapshot', color: 'currentColor', background: 'transparent', fontSize: 16 };
const image = { id: 'image', type: 'image', resourceId: 'resource', anchor, width: 40, height: 50, alt: 'image snapshot' };
const resource = { name: 'test.png', mimeType: 'image/png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=' };
const book = () => ({ sheets: [
  { id: 'one', name: 'One', rowCount: 20, columnCount: 10, cells: { A1: { value: 'cell' } }, drawings: [shape, textBox, image] },
  { id: 'two', name: 'Two', rowCount: 20, columnCount: 10, cells: {} },
], resources: { images: { resource } } });
const draws = (book, sheetId = 'one') => book.sheets.find(sheet => sheet.id === sheetId).drawings ?? [];
function clipboardEvent(initial = {}, target = null) {
  const data = new Map(Object.entries(initial));
  return { target, prevented: false, preventDefault() { this.prevented = true; }, clipboardData: {
    getData: type => data.get(type) ?? '', setData: (type, value) => data.set(type, value), get types() { return [...data.keys()]; },
  } };
}
function mockGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
async function mount(t, overrides = {}, renderToolbar = false, focusEnvironment) {
  let current, renderer, props = { initialWorkbook: book(), onSave: () => {}, ...overrides };
  function Probe() {
    const c = m.useSpreadsheet(props), clipboard = m.useSpreadsheetClipboard(c); current = { ...c, clipboard };
    return createElement(Fragment, null,
      renderToolbar ? createElement(m.SpreadsheetToolbar, { controller: c, clipboard }) : null,
      focusEnvironment ? createElement(m.SpreadsheetDrawings, { controller: c, geometry: {
        columnOffsets: Array.from({length: 11}, (_, i) => 48 + i * 100), rowOffsets: Array.from({length: 21}, (_, i) => 28 + i * 28),
      } }) : null);
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: element =>
    focusEnvironment && element.props.className === 'lxs-drawing-layer' ? {
      get ownerDocument() { return { activeElement: focusEnvironment.active }; },
      closest: () => ({ contains: () => focusEnvironment.within }),
      querySelectorAll: () => current.activeSheet.drawings.map(drawing => ({ dataset: { lxsDrawing: drawing.id }, focus: () => focusEnvironment.focuses.push(drawing.id) })),
    } : null,
  }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { get c() { return current; }, get root() { return renderer.root; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); } };
}

test('public drawing snapshots survive source mutation and paste each kind with new IDs, placement and history', () => {
  const input = book(), session = m.createSpreadsheetSession(input);
  for (const drawing of [shape, textBox, image]) {
    const payload = m.copySpreadsheetDrawing(input, 'one', drawing.id);
    assert.equal(Object.isFrozen(payload.drawing.anchor), true);
    const parsed = JSON.parse(JSON.stringify(payload));
    const result = session.execute({ type: 'drawings.paste', sheetId: 'two', payload: parsed, anchor: { row: 3, column: 4 } });
    assert.equal(result.ok, true); assert.equal(result.results[0].type, 'drawings.paste');
    assert.ok(result.results[0].placement.nextRow > 3);
    const copy = draws(session.getWorkbook(), 'two').at(-1);
    assert.notEqual(copy.id, drawing.id); assert.deepEqual(copy.anchor, { row: 3, column: 4, offsetX: 0, offsetY: 0 });
    assert.equal(copy.width, drawing.width); assert.equal(copy.height, drawing.height);
    if (drawing.type === 'image') assert.equal(copy.resourceId, 'resource');
    else assert.equal(copy.text, drawing.text);
    assert.equal(session.undo(), true); assert.equal(draws(session.getWorkbook(), 'two').some(item => item.id === copy.id), false);
    assert.equal(session.redo(), true);
  }
  const payload = m.copySpreadsheetDrawing(input, 'one', 'shape');
  input.sheets[0].drawings[0] = { ...shape, text: 'changed later' };
  assert.equal(payload.drawing.text, 'snapshot');
  const result = session.execute({ type: 'drawings.paste', sheetId: 'one', payload });
  assert.equal(result.ok, true); assert.equal(draws(session.getWorkbook()).at(-1).anchor.offsetX, 21);
});

test('image copy reuses bytes in the same workbook and restores an independently captured resource after deletion', () => {
  const session = m.createSpreadsheetSession(book());
  const payload = m.copySpreadsheetDrawing(session.getWorkbook(), 'one', 'image');
  const first = session.execute({ type: 'drawings.paste', sheetId: 'two', payload });
  assert.equal(first.ok, true); assert.equal(first.results[0].resourceId, 'resource');
  assert.equal(Object.keys(session.getWorkbook().resources.images).length, 1);
  const other = m.createSpreadsheetSession({ sheets: [{ id: 'blank', name: 'Blank', rowCount: 8, columnCount: 8, cells: {} }] });
  assert.equal(other.execute({ type: 'drawings.paste', sheetId: 'blank', payload }).ok, true);
  const copy = draws(other.getWorkbook(), 'blank')[0];
  assert.notEqual(copy.resourceId, 'resource'); assert.equal(other.getWorkbook().resources.images[copy.resourceId].dataUrl, resource.dataUrl);
  session.execute({ type: 'drawings.delete', sheetId: 'one', drawingId: 'image' });
  session.execute({ type: 'drawings.delete', sheetId: 'two', drawingId: first.results[0].drawingId });
  assert.equal(session.getWorkbook().resources, undefined);
  assert.equal(session.execute({ type: 'drawings.paste', sheetId: 'one', payload }).ok, true);
  assert.equal(Object.values(session.getWorkbook().resources.images)[0].dataUrl, resource.dataUrl);
});

test('headless paste enforces paste and drawing permissions, validates untrusted snapshots and rejects atomically', () => {
  const payload = m.copySpreadsheetDrawing(book(), 'one', 'shape');
  for (const feature of ['paste', 'clipboard', 'shapes']) {
    const session = m.createSpreadsheetSession(book(), { features: { [feature]: false } });
    assert.equal(session.execute({ type: 'drawings.paste', sheetId: 'one', payload }).code, 'FEATURE_DISABLED');
  }
  assert.throws(() => m.copySpreadsheetDrawing(book(), 'one', 'shape', { features: { copy: false } }));
  assert.throws(() => m.copySpreadsheetDrawing(book(), 'one', 'shape', { features: { shapes: false } }));
  const session = m.createSpreadsheetSession(book()), before = session.getWorkbook();
  for (const command of [
    { type: 'drawings.paste', sheetId: 'one', payload: { drawing: { ...shape, fill: 'url(https://example.com)' } } },
    { type: 'drawings.paste', sheetId: 'one', payload, anchor: { row: 9999, column: 0 } },
    { type: 'drawings.paste', sheetId: 'one', payload: { drawing: image } },
    { type: 'drawings.paste', sheetId: 'one', payload: { ...payload, unknown: true } },
  ]) {
    assert.equal(session.batch([{ type: 'cells.set', sheetId: 'one', values: { A1: 'must not commit' } }, command]).ok, false);
    assert.equal(session.getWorkbook(), before);
  }
});

test('native drawing clipboard pastes the captured content at offsets and cells across sheets, one Undo per paste', async t => {
  const events = [], ui = await mount(t, { onEvent: event => events.push(event) });
  await act(async () => ui.c.selectDrawing('shape'));
  const copied = clipboardEvent();
  await act(async () => ui.c.clipboard.onCopy(copied));
  await act(async () => ui.c.executeCommand({ type: 'shapes.update', sheetId: 'one', drawingId: 'shape', patch: { text: 'changed' } }));
  await act(async () => ui.c.clipboard.onPaste(copied));
  const first = ui.c.selectedDrawing;
  assert.equal(first.text, 'snapshot'); assert.equal(first.anchor.offsetX, 21);
  await act(async () => ui.c.clipboard.onPaste(copied));
  assert.equal(ui.c.selectedDrawing.anchor.offsetX, 37);
  await act(async () => ui.c.undo()); assert.equal(draws(ui.c.workbook).length, 4);
  await act(async () => ui.c.switchSheet('two'));
  await act(async () => ui.c.select({ row: 6, column: 2 }));
  await act(async () => ui.c.clipboard.onPaste(copied));
  assert.deepEqual(ui.c.selectedDrawing.anchor, { row: 6, column: 2, offsetX: 0, offsetY: 0 });
  assert.deepEqual(events.filter(event => event.type === 'clipboard').map(event => event.action), ['copy', 'paste', 'paste', 'paste']);
  assert.equal(events.filter(event => event.type === 'clipboard').at(-1).drawingId, ui.c.selectedDrawingId);
});

test('cell copy replaces a drawing clipboard snapshot and external text never overwrites a selected drawing', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectDrawing('text'));
  const object = clipboardEvent(); await act(async () => ui.c.clipboard.onCopy(object));
  await act(async () => ui.c.select({ row: 0, column: 0 }));
  const cells = clipboardEvent(); await act(async () => ui.c.clipboard.onCopy(cells));
  await act(async () => ui.c.select({ row: 1, column: 0 }));
  await act(async () => ui.c.clipboard.onPaste(cells));
  assert.equal(ui.c.activeSheet.cells.A2.value, 'cell'); assert.equal(draws(ui.c.workbook).length, 3);
  await act(async () => ui.c.selectDrawing('text'));
  const before = ui.c.workbook;
  await act(async () => ui.c.clipboard.onPaste(clipboardEvent({ 'text/plain': 'external' })));
  assert.equal(ui.c.workbook, before);
});

test('readonly allows drawing copy but prevents paste; native text editors keep all shortcuts', async t => {
  const ui = await mount(t, { onSave: undefined });
  await act(async () => ui.c.selectDrawing('text'));
  const copied = clipboardEvent(); await act(async () => ui.c.clipboard.onCopy(copied));
  assert.equal(copied.clipboardData.getData('text/plain'), 'text snapshot');
  const before = ui.c.workbook; await act(async () => ui.c.clipboard.onPaste(copied)); assert.equal(ui.c.workbook, before);
  const target = { closest: () => ({ classList: { contains: () => false } }) };
  for (const method of ['onCopy', 'onCut', 'onPaste']) {
    const event = clipboardEvent({ 'text/plain': 'native text' }, target);
    await act(async () => ui.c.clipboard[method](event)); assert.equal(event.prevented, false);
  }
});

for (const revoke of ['paste', 'shapes', 'selection']) test(`pending drawing paste is cancelled when ${revoke} changes`, async t => {
  const permission = deferred(), ui = await mount(t, { onEditRequest: () => permission.promise });
  await act(async () => ui.c.selectDrawing('shape'));
  const copied = clipboardEvent(); await act(async () => ui.c.clipboard.onCopy(copied));
  const before = ui.c.workbook; await act(async () => ui.c.clipboard.onPaste(copied));
  if (revoke === 'selection') await act(async () => ui.c.select({ row: 2, column: 2 }));
  else { await ui.update({ features: { [revoke]: false } }); await ui.update({ features: {} }); }
  await act(async () => permission.resolve(true)); assert.equal(ui.c.workbook, before);
});

test('ribbon copy/paste share the drawing clipboard token and explicit context-menu selections choose cell anchors', async t => {
  let clipboardItems;
  mockGlobal(t, 'ClipboardItem', class { constructor(values) { this.values = values; } });
  mockGlobal(t, 'navigator', { clipboard: { writeText: async () => {}, readText: async () => '',
    write: async items => { clipboardItems = items; },
    read: async () => clipboardItems.map(item => ({ types: Object.keys(item.values), getType: async type => item.values[type] })),
  } });
  const ui = await mount(t, {}, true);
  const button = name => ui.root.findAllByType('button').find(item => item.props['aria-label'] === name);
  await act(async () => ui.c.selectDrawing('image'));
  assert.equal(button('コピー').props.disabled, false); assert.equal(button('貼り付け').props.disabled, false);
  await act(async () => button('コピー').props.onClick());
  await act(async () => button('貼り付け').props.onClick());
  assert.equal(ui.c.selectedDrawing.type, 'image'); assert.notEqual(ui.c.selectedDrawingId, 'image');
  const selection = { sheetId: 'one', anchor: { row: 7, column: 5 }, focus: { row: 7, column: 5 } };
  await act(async () => ui.c.clipboard.paste('all', selection));
  assert.deepEqual(ui.c.selectedDrawing.anchor, { row: 7, column: 5, offsetX: 0, offsetY: 0 });
  const cellSelection = { sheetId: 'one', anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
  await act(async () => ui.c.clipboard.copy(false, cellSelection));
  await act(async () => ui.c.clipboard.paste('all', selection));
  assert.equal(ui.c.activeSheet.cells.F8.value, 'cell');
});


test('pasting moves focus to the new drawing for repeated shortcuts without stealing from text controls or another component', async t => {
  const environment = { active: { closest: () => null }, within: true, focuses: [] };
  const ui = await mount(t, {}, false, environment);
  await act(async () => ui.c.selectDrawing('shape'));
  assert.equal(environment.focuses.at(-1), 'shape');
  const copied = clipboardEvent(); await act(async () => ui.c.clipboard.onCopy(copied));
  await act(async () => ui.c.clipboard.onPaste(copied));
  assert.equal(environment.focuses.at(-1), ui.c.selectedDrawingId);
  const count = environment.focuses.length;
  environment.active = { closest: () => ({ classList: { contains: () => false } }) };
  await act(async () => ui.c.selectDrawing('text'));
  assert.equal(environment.focuses.length, count, 'a native text/property editor keeps its focus');
  environment.active = { closest: () => null }; environment.within = false;
  await act(async () => ui.c.selectDrawing('image'));
  assert.equal(environment.focuses.length, count, 'a different component keeps its focus');
});

for (const [label, content] of [
  ['unclosed quotes and tabs', '"unclosed\tquote\n<&literal>'],
  ['more lines than the cell clipboard permits', 'line\n'.repeat(10_001)],
]) test(`drawing clipboard keeps ${label} as literal text in native and ribbon copy`, async t => {
  let items;
  mockGlobal(t, 'ClipboardItem', class { constructor(values) { this.values = values; } });
  mockGlobal(t, 'navigator', { clipboard: { writeText: async () => {}, readText: async () => '',
    write: async values => { items = values; },
    read: async () => items.map(item => ({ types: Object.keys(item.values), getType: async type => item.values[type] })),
  } });
  const initialWorkbook = book();
  initialWorkbook.sheets[0].drawings = [{ ...textBox, text: content }];
  const ui = await mount(t, { initialWorkbook });
  await act(async () => ui.c.selectDrawing('text'));
  const copied = clipboardEvent();
  await act(async () => ui.c.clipboard.onCopy(copied));
  assert.equal(ui.c.error, null);
  assert.equal(copied.clipboardData.getData('text/plain'), content);
  const html = copied.clipboardData.getData('text/html');
  assert.ok(html.startsWith('<pre data-likex-spreadsheet='));
  assert.equal(html.includes('<&literal>'), false, 'HTML markup in labels must remain escaped text');
  await act(async () => ui.c.clipboard.onPaste(copied));
  assert.equal(ui.c.selectedDrawing.text, content);
  await act(async () => ui.c.clipboard.copy());
  assert.equal(ui.c.error, null);
  assert.equal(await items[0].values['text/plain'].text(), content);
  assert.ok((await items[0].values['text/html'].text()).startsWith('<pre data-likex-spreadsheet='));
  await act(async () => ui.c.clipboard.paste());
  assert.equal(ui.c.selectedDrawing.text, content);
  assert.equal(draws(ui.c.workbook).length, 3);
});

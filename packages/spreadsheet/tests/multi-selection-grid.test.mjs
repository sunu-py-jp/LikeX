import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/ui/spreadsheet-grid";', resolveDir: packageRoot, sourcefile: 'multi-selection-grid-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, SpreadsheetGrid } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
function event(overrides = {}) { return { button: 0, buttons: 1, pointerId: 1, detail: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, nativeEvent: {}, preventDefault() {}, stopPropagation() {}, ...overrides }; }
async function mount(t, options = {}) {
  let c, renderer;
  const documentListeners = new Map(), windowListeners = new Map();
  const document = {
    activeElement: null,
    addEventListener: (name, handler) => documentListeners.set(name, handler),
    removeEventListener: name => documentListeners.delete(name),
    defaultView: { addEventListener: (name, handler) => windowListeners.set(name, handler), removeEventListener: name => windowListeners.delete(name) },
  };
  function node() { return { ownerDocument: document, closest: () => null, focus() { document.activeElement = this; }, select() {}, contains: element => element?.ownerDocument === document, scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000 }; }
  const target = node();
  function Probe() {
    c = useSpreadsheet({ initialWorkbook: { sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8, cells: { B2: { value: 'kept' } } }] }, onSave() {}, ...options });
    return createElement(SpreadsheetGrid, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const cell = address => renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['aria-label'].split(' ')[0] === address);
  const header = (kind, name) => renderer.root.findAllByProps({ role: kind === 'row' ? 'rowheader' : 'columnheader' }).flatMap(item => item.findAllByType('button')).find(button => button.children.join('') === String(name));
  const pointer = overrides => event({ currentTarget: target, ...overrides });
  return {
    get c() { return c; }, get root() { return renderer.root; }, cell, header,
    selected: () => renderer.root.findAllByProps({ role: 'gridcell' }).filter(item => item.props['aria-selected']).map(item => item.props['aria-label'].split(' ')[0]),
    async down(element, modifiers = {}) { await act(async () => element.props.onPointerDown(pointer(modifiers))); },
    async enter(element, modifiers = {}) { await act(async () => element.props.onPointerEnter(pointer(modifiers))); },
    async up() { await act(async () => documentListeners.get('pointerup')?.(pointer({ buttons: 0 }))); },
    async cancel() { await act(async () => documentListeners.get('pointercancel')?.(pointer({ buttons: 0 }))); },
    async blur() { await act(async () => windowListeners.get('blur')?.()); },
    async click(address, modifiers = {}) { await this.down(cell(address), modifiers); await this.up(); },
    async headerClick(kind, name, modifiers = {}) { await this.down(header(kind, name), modifiers); await this.up(); },
    async key(key, modifiers = {}) { await act(async () => renderer.root.findAllByType('input').find(input => input.props.className === 'lxs-cell-input').props.onKeyDown(event({ key, ...modifiers }))); },
  };
}

test('Cmd-drag adds a separate rectangle without selecting the gap and highlights only participating headers', async t => {
  const ui = await mount(t);
  await ui.down(ui.cell('A1')); await ui.enter(ui.cell('B2')); await ui.up();
  await ui.down(ui.cell('D4'), { metaKey: true }); await ui.enter(ui.cell('E5')); await ui.up();
  assert.deepEqual(ui.selected(), ['A1', 'B1', 'A2', 'B2', 'D4', 'E4', 'D5', 'E5']);
  assert.equal(ui.cell('C3').props['aria-selected'], false);
  assert.match(ui.header('column', 'D').parent.props.className, /lxs-header-selected/);
  assert.doesNotMatch(ui.header('column', 'C').parent.props.className, /lxs-header-selected/);
  assert.match(ui.header('row', '5').parent.props.className, /lxs-header-selected/);
  assert.doesNotMatch(ui.header('row', '3').parent.props.className, /lxs-header-selected/);
});

test('Ctrl-click removes one selected cell on release; cancelled clicks do not remove it', async t => {
  const ui = await mount(t);
  await ui.down(ui.cell('A1')); await ui.enter(ui.cell('C3')); await ui.up();
  await ui.down(ui.cell('B2'), { ctrlKey: true });
  assert.equal(ui.cell('B2').props['aria-selected'], true);
  await ui.cancel();
  assert.equal(ui.selected().length, 9);
  await ui.click('B2', { ctrlKey: true });
  assert.equal(ui.selected().length, 8);
  assert.equal(ui.cell('B2').props['aria-selected'], false);
  assert.equal(ui.c.activeSheet.cells.B2.value, 'kept');
  await ui.click('H8'); await ui.click('H8', { ctrlKey: true });
  assert.deepEqual(ui.selected(), ['H8']);
});

test('Ctrl-drag starting inside an existing selection adds a range instead of toggling its start cell', async t => {
  const ui = await mount(t);
  await ui.down(ui.cell('A1')); await ui.enter(ui.cell('C3')); await ui.up();
  await ui.down(ui.cell('B2'), { ctrlKey: true }); await ui.enter(ui.cell('E5')); await ui.up();
  assert.equal(ui.selected().length, 21);
  assert.equal(ui.cell('B2').props['aria-selected'], true);
  assert.equal(ui.cell('E5').props['aria-selected'], true);
  assert.equal(ui.cell('D1').props['aria-selected'], false);
});

test('Shift extends the active range while ordinary arrows collapse to one cell', async t => {
  const ui = await mount(t);
  await ui.click('A1'); await ui.click('D4', { ctrlKey: true });
  await ui.click('F6', { shiftKey: true, ctrlKey: true });
  assert.equal(ui.selected().length, 10);
  assert.equal(ui.cell('A1').props['aria-selected'], true);
  assert.equal(ui.cell('C3').props['aria-selected'], false);
  await ui.key('ArrowRight', { shiftKey: true });
  assert.equal(ui.selected().length, 13);
  await ui.key('ArrowDown');
  assert.deepEqual(ui.selected(), ['G7']);
});

test('row headers support separate rows, Shift extension, deselection, and contiguous dragging', async t => {
  const ui = await mount(t);
  await ui.headerClick('row', '1'); await ui.headerClick('row', '4', { metaKey: true });
  assert.equal(ui.selected().length, 16);
  assert.equal(ui.cell('A2').props['aria-selected'], false);
  await ui.headerClick('row', '6', { shiftKey: true });
  assert.equal(ui.selected().length, 32);
  await ui.headerClick('row', '5', { metaKey: true });
  assert.equal(ui.selected().length, 24);
  assert.equal(ui.cell('H5').props['aria-selected'], false);
  await ui.down(ui.header('row', '2')); await ui.enter(ui.header('row', '4')); await ui.up();
  assert.equal(ui.selected().length, 24);
  assert.equal(ui.cell('H2').props['aria-selected'], true);
  assert.equal(ui.cell('A1').props['aria-selected'], false);
});

test('column headers support separate columns, Shift extension, and Ctrl-drag from a selected column', async t => {
  const ui = await mount(t);
  await ui.headerClick('column', 'A'); await ui.headerClick('column', 'D', { ctrlKey: true });
  assert.equal(ui.selected().length, 16);
  await ui.headerClick('column', 'F', { shiftKey: true });
  assert.equal(ui.selected().length, 32);
  await ui.down(ui.header('column', 'D'), { ctrlKey: true }); await ui.enter(ui.header('column', 'G')); await ui.up();
  assert.equal(ui.selected().length, 40);
  assert.equal(ui.cell('C8').props['aria-selected'], false);
  await ui.headerClick('column', 'E', { ctrlKey: true });
  assert.equal(ui.selected().length, 32);
  assert.equal(ui.cell('E1').props['aria-selected'], false);
});

test('pointer up, pointer cancellation, window blur, and released-pointer reentry stop extending the selection', async t => {
  const ui = await mount(t);
  for (const finish of [() => ui.up(), () => ui.cancel(), () => ui.blur(), () => ui.enter(ui.cell('B2'), { buttons: 0 })]) {
    await ui.down(ui.cell('A1')); await finish(); await ui.enter(ui.cell('C3'));
    assert.deepEqual(ui.selected(), ['A1']);
  }
});

test('corner and keyboard select-all remain available in readonly mode', async t => {
  const ui = await mount(t, { readOnly: true });
  await act(async () => ui.root.findByProps({ 'aria-label': 'すべてのセルを選択' }).props.onClick());
  assert.equal(ui.selected().length, 64);
  await ui.click('B2'); await ui.key('a', { metaKey: true });
  assert.equal(ui.selected().length, 64);
  await ui.key('Delete');
  assert.equal(ui.c.activeSheet.cells.B2.value, 'kept');
});

test('keyboard header activation supports additive selection and the following pointer click is not applied twice', async t => {
  const ui = await mount(t);
  await act(async () => ui.header('column', 'A').props.onClick(event({ detail: 0 })));
  await act(async () => ui.header('column', 'D').props.onClick(event({ detail: 0, metaKey: true })));
  assert.equal(ui.selected().length, 16);
  await ui.headerClick('column', 'D', { metaKey: true });
  await act(async () => ui.header('column', 'D').props.onClick(event({ detail: 1, metaKey: true })));
  assert.equal(ui.selected().length, 8);
  assert.equal(ui.cell('D1').props['aria-selected'], false);
});

const limitGestures = [
  { kind: 'cell', anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 }, origin: 'A1', outside: 'H8', next: 'G7', last: 'F6' },
  { kind: 'row', anchor: { row: 0, column: 7 }, focus: { row: 0, column: 0 }, origin: '1', outside: '8', next: '7', last: '6' },
  { kind: 'column', anchor: { row: 7, column: 0 }, focus: { row: 0, column: 0 }, origin: 'A', outside: 'H', next: 'G', last: 'F' },
];
async function fillRangeLimit(ui, gesture) {
  await act(async () => {
    for (let index = 0; index < 128; index++) {
      assert.equal(ui.c.selectRange(gesture.anchor, gesture.focus, index > 0), true);
    }
  });
  assert.equal(ui.c.selection.ranges.length, 128);
}
const gestureTarget = (ui, gesture, value) => gesture.kind === 'cell' ? ui.cell(value) : ui.header(gesture.kind, value);

test('rejected Ctrl-drag addition leaves previous ranges unchanged for cells, rows, and columns', async t => {
  for (const gesture of limitGestures) {
    const ui = await mount(t);
    await fillRangeLimit(ui, gesture);
    const before = ui.c.selection, workbook = ui.c.workbook;
    await ui.down(gestureTarget(ui, gesture, gesture.outside), { ctrlKey: true });
    assert.match(ui.c.error, /128/);
    await ui.enter(gestureTarget(ui, gesture, gesture.next));
    await ui.enter(gestureTarget(ui, gesture, gesture.last));
    await ui.up();
    assert.equal(ui.c.selection, before, gesture.kind);
    assert.equal(ui.c.workbook, workbook);
  }
});

test('rejected Ctrl-drag from an already selected target does not extend or deselect previous ranges', async t => {
  for (const gesture of limitGestures) {
    const ui = await mount(t);
    await fillRangeLimit(ui, gesture);
    const before = ui.c.selection, workbook = ui.c.workbook;
    await ui.down(gestureTarget(ui, gesture, gesture.origin), { ctrlKey: true });
    await ui.enter(gestureTarget(ui, gesture, gesture.next));
    assert.match(ui.c.error, /128/);
    await ui.enter(gestureTarget(ui, gesture, gesture.last));
    await ui.up();
    assert.equal(ui.c.selection, before, gesture.kind);
    assert.equal(ui.c.workbook, workbook);
  }
});

test('selection commands report rejection without replacing the previous selection', async t => {
  const ui = await mount(t);
  await fillRangeLimit(ui, limitGestures[0]);
  const before = ui.c.selection;
  await act(async () => {
    assert.equal(ui.c.select({ row: 7, column: 7 }, false, true), false);
    assert.equal(ui.c.selectRange({ row: 6, column: 6 }, { row: 7, column: 7 }, true), false);
    assert.equal(ui.c.toggleSelection({ row: 7, column: 7 }), false);
  });
  assert.equal(ui.c.selection, before);
  await act(async () => { assert.equal(ui.c.select({ row: 7, column: 7 }), true); });
  assert.deepEqual(ui.selected(), ['H8']);
});

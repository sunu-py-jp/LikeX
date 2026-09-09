import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({
  stdin: { contents: 'export * from "./src/state/use-spreadsheet"; export * from "./src/ui/spreadsheet-grid"; export { setCellValue, mergeCells, unmergeCells } from "./src/model";', resolveDir: packageRoot, sourcefile: 'merged-selection-grid-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { useSpreadsheet, SpreadsheetGrid, selectedAddresses, selectionBounds, isCellSelected, setCellValue, mergeCells, unmergeCells } =
  await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const merged = { top: 1, left: 1, bottom: 2, right: 3 };
const position = (row, column) => ({ row, column });
const event = (overrides = {}) => ({ button: 0, buttons: 1, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
  nativeEvent: {}, preventDefault() {}, stopPropagation() {}, ...overrides });
async function mount(t, options = {}) {
  let c, renderer;
  const listeners = new Map();
  const document = { activeElement: null, addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name), defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = () => ({ ownerDocument: document, style: {}, scrollHeight: 18, closest: () => null, focus() { document.activeElement = this; }, select() {}, setSelectionRange() {},
    contains: element => element?.ownerDocument === document, scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000 });
  const target = node();
  const sheet = { id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8, cells: { B2: { value: 'Merged value' } }, merges: [merged], ...options.sheet };
  function Probe() {
    c = useSpreadsheet({ initialWorkbook: { sheets: [sheet, { id: 'two', name: 'Sheet2', rowCount: 8, columnCount: 8, cells: {}, merges: [{ top: 0, left: 0, bottom: 1, right: 1 }] }] },
      onSave() {}, ...options.props });
    return createElement(SpreadsheetGrid, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const cell = address => renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['aria-label'].split(' ')[0] === address);
  return { get c() { return c; }, get root() { return renderer.root; }, cell,
    async run(callback) { await act(async () => callback(c)); },
    async down(address, modifiers = {}) { await act(async () => cell(address).props.onPointerDown(event({ currentTarget: target, ...modifiers }))); },
    async enter(address, modifiers = {}) { await act(async () => cell(address).props.onPointerEnter(event({ currentTarget: target, ...modifiers }))); },
    async up() { await act(async () => listeners.get('pointerup')?.(event({ buttons: 0 }))); },
    async click(address, modifiers = {}) { await this.down(address, modifiers); await this.up(); },
    async key(key, modifiers = {}) { await act(async () => renderer.root.findAllByType('textarea').find(input => input.props.className === 'lxs-cell-input').props.onKeyDown(event({ key, ...modifiers }))); },
  };
}

test('merged anchor spans actual resized rows/columns, with covered cells absent from accessibility and input', async t => {
  const ui = await mount(t, { sheet: { columnWidths: { 1: 120, 2: 80, 3: 140 }, rowHeights: { 1: 40, 2: 32 } } });
  assert.equal(ui.cell('B2').props['aria-colspan'], 3);
  assert.equal(ui.cell('B2').props['aria-rowspan'], 2);
  assert.equal(ui.cell('B2').props.style.width, 340);
  assert.equal(ui.cell('B2').props.style.height, 72);
  assert.equal(ui.cell('C2'), undefined);
  assert.equal(ui.cell('D3'), undefined);
  assert.equal(ui.cell('E2').props['aria-colindex'], 6);
  await ui.click('B2');
  assert.equal(ui.root.findByProps({ 'aria-label': 'B2の値' }).props.value, 'Merged value');
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  assert.deepEqual(selectionBounds(ui.c.selection), merged);
});

test('covered-cell selection, reverse range closure, and callback payload retain geometry and editable focus', async t => {
  const notices = [];
  const ui = await mount(t, { props: { onSelectionChange: selected => notices.push(selected) } });
  await ui.run(c => c.select(position(2, 3)));
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  assert.deepEqual(selectionBounds(ui.c.selection), merged);
  assert.equal(selectedAddresses(ui.c.selection).length, 6);
  assert.deepEqual(notices.at(-1).focus, position(1, 1));
  assert.deepEqual(notices.at(-1).ranges[0].focus, position(2, 3));
  notices.at(-1).focus.column = 7;
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  await ui.run(c => c.selectRange(position(4, 4), position(2, 2)));
  assert.deepEqual(ui.c.selection.anchor, position(4, 4));
  assert.deepEqual(ui.c.selection.ranges[0].focus, position(1, 1));
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 1, left: 1, bottom: 4, right: 4 });
  await ui.run(c => c.select(position(3, 3), true));
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 3, left: 3, bottom: 4, right: 4 });
});

test('drag/Shift selection expands recursively across intersecting merges and retains separate ranges', async t => {
  const ui = await mount(t, { sheet: { merges: [merged, { top: 3, left: 0, bottom: 3, right: 2 }] } });
  await ui.down('B2'); await ui.enter('E5'); await ui.up();
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 1, left: 0, bottom: 4, right: 4 });
  await ui.click('H8', { metaKey: true });
  assert.equal(ui.c.selection.ranges.length, 2);
  await ui.key('ArrowLeft', { shiftKey: true });
  assert.equal(selectedAddresses(ui.c.selection).length, 22);
  assert.equal(isCellSelected(ui.c.selection, position(6, 6)), false);
  assert.equal(isCellSelected(ui.c.selection, position(7, 6)), true);
});

test('Ctrl-click toggles the whole merged cell and the final merged cell cannot become a hidden partial selection', async t => {
  const ui = await mount(t);
  await ui.run(c => c.selectRange(position(0, 0), position(4, 4)));
  await ui.click('B2', { ctrlKey: true });
  assert.equal(selectedAddresses(ui.c.selection).length, 19);
  for (let row = 1; row <= 2; row++) for (let column = 1; column <= 3; column++) assert.equal(isCellSelected(ui.c.selection, position(row, column)), false);
  await ui.click('H8', { ctrlKey: true });
  assert.equal(selectedAddresses(ui.c.selection).length, 20);
  assert.equal(isCellSelected(ui.c.selection, position(1, 1)), false);
  await ui.click('B2'); await ui.click('B2', { metaKey: true });
  assert.deepEqual(selectionBounds(ui.c.selection), merged);
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
});

test('subtracting another cell never reselects it when selection fragments cross a merge', async t => {
  const ui = await mount(t, { sheet: { cells: { A2: { value: 'Merged' } }, merges: [{ top: 1, left: 0, bottom: 3, right: 1 }] } });
  await ui.run(c => c.selectRange(position(0, 0), position(5, 5)));
  await ui.click('E3', { ctrlKey: true });
  assert.equal(selectedAddresses(ui.c.selection).length, 35);
  assert.equal(isCellSelected(ui.c.selection, position(2, 4)), false);
  await ui.click('H8', { ctrlKey: true });
  assert.equal(selectedAddresses(ui.c.selection).length, 36);
  await ui.run(c => c.apply(wb => setCellValue(wb, 'one', 'F6', 'changed')));
  assert.equal(selectedAddresses(ui.c.selection).length, 36);
  assert.equal(isCellSelected(ui.c.selection, position(2, 4)), false);
});

test('arrows, Tab and Enter skip covered cells in both directions', async t => {
  const ui = await mount(t);
  const cases = [['ArrowRight', {}, position(1, 4)], ['ArrowDown', {}, position(3, 1)],
    ['ArrowLeft', {}, position(1, 0)], ['ArrowUp', {}, position(0, 1)], ['Tab', {}, position(1, 4)],
    ['Tab', { shiftKey: true }, position(1, 0)], ['Enter', {}, position(3, 1)], ['Enter', { shiftKey: true }, position(0, 1)]];
  for (const [key, modifiers, expected] of cases) {
    await ui.click('B2'); await ui.key(key, modifiers);
    assert.deepEqual(ui.c.selection.focus, expected, key);
  }
  await ui.click('E3'); await ui.key('ArrowLeft');
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  await ui.key('ArrowRight', { shiftKey: true });
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 1, left: 1, bottom: 2, right: 4 });
});

test('Tab wrapping skips a merge covering every column without trapping focus', async t => {
  const ui = await mount(t, { sheet: { cells: { A1: { value: 'Full width' } }, columnCount: 3, merges: [{ top: 0, left: 0, bottom: 2, right: 2 }] } });
  await ui.key('Tab');
  assert.deepEqual(ui.c.selection.focus, position(3, 0));
  await ui.key('Tab', { shiftKey: true });
  assert.deepEqual(ui.c.selection.focus, position(0, 0));
});

test('merge anchor remains rendered when a tall merge begins above the virtualized viewport', async t => {
  const ui = await mount(t, { sheet: { cells: { A1: { value: 'Tall merge' } }, rowCount: 120, merges: [{ top: 0, left: 0, bottom: 39, right: 1 }] } });
  await ui.run(c => c.select(position(100, 3)));
  await act(async () => ui.root.findByProps({ className: 'lxs-grid-scroll' }).props.onScroll({ currentTarget: { scrollTop: 700, clientHeight: 280 } }));
  assert.equal(ui.cell('A1').props['aria-rowspan'], 40);
  assert.equal(ui.cell('A1').props.style.height, 1120);
  assert.equal(ui.cell('A25'), undefined);
  assert.ok(ui.cell('C25'));
  assert.ok(ui.cell('D101'));
});

test('editing a covered position writes only the anchor, and clear plus Undo preserve merge geometry', async t => {
  const ui = await mount(t);
  await ui.run(c => c.select(position(2, 3)));
  await ui.run(c => c.beginEdit(position(2, 3), 'Edited anchor'));
  assert.deepEqual(ui.c.editing.position, position(1, 1));
  await ui.run(c => c.commitEdit());
  assert.equal(ui.c.activeSheet.cells.B2.value, 'Edited anchor');
  assert.equal(ui.c.activeSheet.cells.D3, undefined);
  await ui.key('Delete');
  assert.equal(ui.c.activeSheet.cells.B2?.value ?? '', '');
  assert.deepEqual(ui.c.activeSheet.merges, [merged]);
  await ui.run(c => c.undo());
  assert.equal(ui.c.activeSheet.cells.B2.value, 'Edited anchor');
  assert.deepEqual(ui.c.activeSheet.merges, [merged]);
});

test('initial, switch, history and saved selection normalize to visible merged anchors', async t => {
  const originMerge = { top: 0, left: 0, bottom: 1, right: 2 };
  const ui = await mount(t, { sheet: { cells: { A1: { value: 'Original' } }, merges: [originMerge] } });
  assert.deepEqual(selectionBounds(ui.c.selection), originMerge);
  await ui.run(c => c.switchSheet('two'));
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 0, left: 0, bottom: 1, right: 1 });
  await ui.run(c => c.switchSheet('one'));
  await ui.run(c => c.apply(wb => setCellValue(wb, 'one', 'A1', 'changed')));
  await ui.run(c => c.undo());
  assert.deepEqual(selectionBounds(ui.c.selection), originMerge);
  await ui.run(c => c.redo());
  await ui.run(c => c.save());
  assert.deepEqual(selectionBounds(ui.c.selection), originMerge);
  assert.deepEqual(ui.c.selection.focus, position(0, 0));
});

test('read-only and merge feature off keep existing merged cells visible without hidden editing', async t => {
  const ui = await mount(t, { props: { readOnly: true, features: { mergeCells: false } } });
  assert.equal(ui.c.features.mergeCells, false);
  await ui.click('B2');
  assert.equal(ui.cell('B2').props['aria-colspan'], 3);
  assert.equal(ui.root.findByProps({ 'aria-label': 'B2の値' }).props.readOnly, true);
  await ui.key('Delete');
  assert.equal(ui.c.activeSheet.cells.B2.value, 'Merged value');
  await ui.run(c => c.beginEdit(position(2, 3), 'blocked'));
  assert.equal(ui.c.editing, null);
});

test('applying a new merge expands a partly selected range before publishing workbook changes', async t => {
  const ui = await mount(t, { sheet: { cells: {}, merges: [] } });
  await ui.run(c => c.select(position(2, 2)));
  await ui.run(c => c.apply(wb => mergeCells(wb, 'one', merged)));
  for (let row = 1; row <= 2; row++) for (let column = 1; column <= 3; column++) assert.equal(isCellSelected(ui.c.selection, position(row, column)), true);
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
});


test('unmerge and subsequent edits retain the visible active anchor inside the selected rectangle', async t => {
  const ui = await mount(t);
  await ui.click('B2');
  await ui.run(c => c.apply(wb => unmergeCells(wb, 'one', merged)));
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  assert.deepEqual(selectionBounds(ui.c.selection), merged);
  assert.ok(ui.cell('D3'));
  await ui.run(c => c.apply(wb => setCellValue(wb, 'one', 'B2', 'Still active')));
  assert.deepEqual(ui.c.selection.focus, position(1, 1));
  assert.equal(ui.root.findByProps({ 'aria-label': 'B2の値' }).props.value, 'Still active');
});

test('whole row and column selections expand around merges while retaining the requested active header cell', async t => {
  const ui = await mount(t);
  await ui.run(c => c.selectRange(position(1, 7), position(1, 0)));
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 1, left: 0, bottom: 2, right: 7 });
  assert.deepEqual(ui.c.selection.focus, position(1, 0));
  await ui.run(c => c.selectRange(position(7, 2), position(0, 2)));
  assert.deepEqual(selectionBounds(ui.c.selection), { top: 0, left: 1, bottom: 7, right: 3 });
  assert.deepEqual(ui.c.selection.focus, position(0, 2));
  await ui.key('ArrowRight');
  assert.deepEqual(ui.c.selection.focus, position(0, 3));
});

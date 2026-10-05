import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: `
  export { SpreadsheetGrid } from './src/ui/spreadsheet-grid';
  export { useSpreadsheet } from './src/state/use-spreadsheet';
  export { rowTextOverflowLimits, cellTextOverflow } from './src/ui/grid/cell-text-layout';
  export { columnGeometry, visibleMergedCells } from './src/ui/grid/grid-geometry';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
plugins: [{ name: 'react', setup(builder) {
  builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { SpreadsheetGrid, useSpreadsheet, rowTextOverflowLimits, cellTextOverflow, columnGeometry, visibleMergedCells } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

const longText = '幅を超える長い文字列は隣の空白セルにも続けて表示されます';
const sheet = (cells = {}, extra = {}) => ({ id: 's', name: 'Overflow', rowCount: 8, columnCount: 6,
  columnWidths: { 0: 80, 1: 120, 2: 50, 3: 100, 4: 150, 5: 60 }, cells, ...extra });
function layout(source, row = 0, { checkboxes = true, editingColumn, preview } = {}) {
  const { columnOffsets } = columnGeometry(source, preview);
  const limits = rowTextOverflowLimits(source, row, columnOffsets, visibleMergedCells(source, [row]), checkboxes, editingColumn);
  return (column, format, ...options) => cellTextOverflow(column, options.length ? options[0] : longText, format, columnOffsets, limits, options[1] ?? false);
}

test('stored empty-string formulas and whitespace block spill while styled empty cells permit it', () => {
  const source = sheet({ B1: { value: longText }, C1: { value: '', format: { background: '#ff0000', wrap: true } }, E1: { value: '=""' }, F1: { value: ' ' } });
  assert.deepEqual(layout(source)(1), { before: 0, after: 150 }, 'C and D are available until the formula in E');
  assert.deepEqual(layout(source)(4, { align: 'left' }, 'displayed formula result'), { before: 0, after: 0 }, 'a literal space in F still occupies the cell');
});

test('left, right and center retain their source origin and stop independently at row boundaries', () => {
  const overflow = layout(sheet({ B1: { value: 'left blocker' }, D1: { value: longText } }));
  assert.deepEqual(overflow(3), { before: 0, after: 210 });
  assert.deepEqual(overflow(3, { align: 'right' }), { before: 50, after: 0 });
  assert.deepEqual(overflow(3, { align: 'center' }), { before: 50, after: 210 });
  const empty = layout(sheet());
  assert.deepEqual(empty(0, { align: 'right' }), { before: 0, after: 0 }, 'left edge stops at A, not the row header');
  assert.deepEqual(empty(5), { before: 0, after: 0 }, 'last column never expands the sheet');
});

test('resizing neighboring columns changes spill space using logical column offsets', () => {
  const source = sheet({ B1: { value: 'blocker' }, D1: { value: longText } });
  assert.deepEqual(layout(source, 0, { preview: { column: 2, value: 90 } })(3, { align: 'center' }), { before: 90, after: 210 });
  assert.deepEqual(layout(source, 0, { preview: { column: 4, value: 190 } })(3, { align: 'center' }), { before: 50, after: 250 });
});

test('merged anchors and covered cells form barriers even below the anchor row', () => {
  const source = sheet({ B2: { value: longText }, E2: { value: longText } }, { merges: [{ top: 0, left: 2, bottom: 1, right: 3 }] });
  const overflow = layout(source, 1);
  assert.deepEqual(overflow(1), { before: 0, after: 0 }, 'covered C2 stops text from B2');
  assert.deepEqual(overflow(4, { align: 'right' }), { before: 0, after: 0 }, 'covered D2 stops text from E2');
  assert.deepEqual(layout(source)(2, undefined, longText, true), { before: 0, after: 0 }, 'merged sources stay inside their own rectangle');
});

test('visible empty checkboxes and live blank editors block spill without treating disabled controls as data', () => {
  const source = sheet({ B1: { value: longText }, C1: { value: '', validation: { type: 'checkbox' } } });
  assert.deepEqual(layout(source)(1), { before: 0, after: 0 });
  assert.deepEqual(layout(source, 0, { checkboxes: false })(1), { before: 0, after: 360 });
  assert.deepEqual(layout(source, 0, { checkboxes: false, editingColumn: 3 })(1), { before: 0, after: 50 });
});

test('numbers, booleans, empty values, wrapping and shrinking remain confined', () => {
  const overflow = layout(sheet());
  for (const value of [123456789, true, false, '', undefined]) assert.deepEqual(overflow(1, undefined, value), { before: 0, after: 0 });
  for (const format of [{ wrap: true }, { shrinkToFit: true }, { wrap: true, shrinkToFit: true }])
    assert.deepEqual(overflow(1, format), { before: 0, after: 0 });
  assert.deepEqual(overflow(1, { numberFormat: 'text' }, '00123456789'), { before: 0, after: 360 });
});

const event = (extra = {}) => ({ button: 0, buttons: 1, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
  nativeEvent: {}, preventDefault() {}, stopPropagation() {}, ...extra });
async function mount(t, source, options = {}) {
  let c, renderer;
  const inputs = new Map(), listeners = new Map();
  const document = { activeElement: null, addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name), defaultView: { addEventListener() {}, removeEventListener() {} } };
  function node(element = {}) {
    const label = element.props?.['aria-label'];
    if (element.type === 'textarea' && inputs.has(label)) return inputs.get(label);
    const result = { ownerDocument: document, style: {}, scrollHeight: 18, clientHeight: 480, clientWidth: 1000, scrollTop: 0, scrollLeft: 0,
      addEventListener() {}, removeEventListener() {}, closest: () => null, focus() { document.activeElement = this; },
      contains: target => target?.ownerDocument === document, selectionStart: 0, selectionEnd: 0,
      setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
      setPointerCapture() {}, releasePointerCapture() {}, getBoundingClientRect: () => ({ top: 0, left: 0, width: 120, right: 120, bottom: 28 }),
      get value() { return c.editing?.value ?? element.props?.value ?? ''; } };
    if (element.type === 'textarea') inputs.set(label, result);
    return result;
  }
  function Probe() {
    c = useSpreadsheet({ initialWorkbook: { sheets: [source] }, onSave() {}, ...options });
    return createElement(SpreadsheetGrid, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const cell = (row, column) => renderer.root.findByProps({ role: 'gridcell', 'data-lxs-row': row, 'data-lxs-column': column });
  const text = (row, column) => cell(row, column).findAll(item => item.type === 'span' && /(?:^| )lxs-cell-text(?: |$)/.test(item.props.className ?? ''));
  const input = () => renderer.root.findByProps({ className: 'lxs-cell-input' });
  return { get c() { return c; }, renderer, cell, text, input,
    async select(row, column) { await act(async () => c.select({ row, column })); },
    async command(command) { let result; await act(async () => { result = await c.executeCommand({ sheetId: source.id, ...command }); }); assert.equal(result.ok, true); },
    async key(key) { await act(async () => input().props.onKeyDown(event({ key, currentTarget: inputs.get(input().props['aria-label']) }))); },
    async click(row, column) {
      const target = node();
      await act(async () => cell(row, column).props.onPointerDown(event({ currentTarget: target, target })));
      await act(async () => listeners.get('pointerup')?.(event({ buttons: 0 })));
    },
  };
}
const spillWidth = (ui, row, column) => ui.text(row, column)[0]?.props.style?.width;

test('active passive text keeps a focusable textarea, then yields to the editor and reappears on cancel', async t => {
  const ui = await mount(t, sheet({ A1: { value: longText } }));
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
  assert.equal(ui.text(0, 0)[0].props['aria-hidden'], true);
  assert.equal(ui.input().props['data-passive'], true);
  assert.equal(ui.input().props.value, longText);
  await ui.key('F2');
  assert.equal(ui.text(0, 0).length, 0);
  assert.equal(ui.input().props['data-passive'], undefined);
  assert.equal(ui.input().props['data-editing'], true);
  assert.equal(ui.input().props.value, longText);
  await ui.key('Escape');
  assert.equal(ui.input().props['data-passive'], true);
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
  await ui.click(0, 1);
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 1 }, 'the neighboring cell remains a selection target');
  assert.equal(ui.c.editing, null);
  assert.equal(ui.text(0, 0)[0].props['aria-hidden'], undefined);
});

test('neighbor edits, clearing and Undo immediately update visible spill bounds', async t => {
  const ui = await mount(t, sheet({ A1: { value: longText }, C1: { value: '', format: { background: '#ffff00' } } }));
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
  await ui.command({ type: 'cells.set', values: { C1: '=""' } });
  assert.equal(ui.c.calculated.s.C1, '');
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 120px)');
  await ui.command({ type: 'cells.set', values: { B1: ' ' } });
  assert.equal(spillWidth(ui, 0, 0), undefined, 'literal whitespace blocks the immediately adjacent cell');
  await ui.command({ type: 'cells.clear', range: 'B1:C1', mode: 'values' });
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
  assert.equal(ui.c.activeSheet.cells.C1.format.background, '#ffff00', 'clearing values retains the empty styled neighbor');
  await act(async () => ui.c.undo());
  assert.equal(spillWidth(ui, 0, 0), undefined);
  await act(async () => ui.c.redo());
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
});

test('text formulas and text-format literals spill while numeric, boolean, error and merged cells stay confined', async t => {
  const ui = await mount(t, sheet({
    A1: { value: `="${longText}"` }, A2: { value: '12345678901234567890', format: { numberFormat: 'text' } },
    A3: { value: '#REF! long literal', format: { numberFormat: 'text' } }, A4: { value: '123456789' },
    A5: { value: 'TRUE' }, A6: { value: '=1/0' }, A7: { value: longText },
  }, { merges: [{ top: 6, left: 0, bottom: 6, right: 1 }] }));
  for (const row of [0, 1, 2]) assert.equal(spillWidth(ui, row, 0), 'calc(100% + 480px)');
  for (const row of [3, 4, 5, 6]) assert.equal(spillWidth(ui, row, 0), undefined);
});

test('wrapping wins over shrinking and either mode confines both passive and focused text', async t => {
  const ui = await mount(t, sheet({ A1: { value: longText, format: { wrap: true, shrinkToFit: true } }, A2: { value: longText, format: { shrinkToFit: true } } }));
  assert.equal(ui.text(0, 0)[0].props.className, 'lxs-cell-text');
  assert.match(ui.cell(0, 0).props.className, /lxs-cell-wrap/);
  assert.equal(spillWidth(ui, 0, 0), undefined);
  assert.equal(ui.text(1, 0)[0].props.className, 'lxs-cell-text lxs-cell-text-shrink');
  await ui.select(1, 0);
  assert.equal(ui.text(1, 0)[0].props['aria-hidden'], true);
  assert.equal(ui.input().props['data-passive'], true);
  assert.equal(spillWidth(ui, 1, 0), undefined);
});

test('checkbox feature flags control whether a blank validation cell blocks neighboring text', async t => {
  const source = sheet({ A1: { value: longText }, B1: { value: '', validation: { type: 'checkbox' } } });
  const enabled = await mount(t, source);
  assert.equal(spillWidth(enabled, 0, 0), undefined);
  for (const features of [{ checkboxes: false }, { dataValidation: false }]) {
    const disabled = await mount(t, source, { features });
    assert.equal(spillWidth(disabled, 0, 0), 'calc(100% + 480px)');
  }
});

test('blank live editors stop an earlier cell until edit cancellation, and column resizing updates its width', async t => {
  const ui = await mount(t, sheet({ A1: { value: longText } }));
  await ui.select(0, 2);
  await ui.key('F2');
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 120px)');
  await ui.key('Escape');
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
  await ui.command({ type: 'columns.resize', column: 1, width: 200 });
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 560px)');
  await act(async () => ui.c.undo());
  assert.equal(spillWidth(ui, 0, 0), 'calc(100% + 480px)');
});

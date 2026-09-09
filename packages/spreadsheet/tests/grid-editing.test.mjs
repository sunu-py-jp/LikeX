import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ stdin: { contents: 'export { SpreadsheetGrid } from "./src/ui/spreadsheet-grid"; export { useSpreadsheet } from "./src/state/use-spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'grid-editing-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SpreadsheetGrid, useSpreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
function event(overrides = {}) {
  return { button: 0, buttons: 1, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    nativeEvent: {}, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...overrides };
}
async function mount(t, options = {}) {
  let c, renderer;
  const listeners = new Map(), inputs = new Map();
  const document = { activeElement: null, addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => listeners.delete(name), defaultView: { addEventListener() {}, removeEventListener() {} } };
  function node(element) {
    const label = element?.props?.['aria-label'];
    if (element?.type === 'textarea' && inputs.has(label)) return inputs.get(label);
    const result = { ownerDocument: document, style: {}, scrollHeight: 18, closest: () => null, scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000,
      focus() { document.activeElement = this; }, contains: target => target?.ownerDocument === document,
      selectCalls: 0, ranges: [], selectionStart: 0, selectionEnd: 0,
      select() { this.selectCalls++; this.selectionStart = 0; this.selectionEnd = this.value.length; },
      setSelectionRange(start, end) { this.ranges.push([start, end]); this.selectionStart = start; this.selectionEnd = end; },
      get value() { return c.editing?.value ?? element?.props?.value ?? ''; },
    };
    if (element?.type === 'textarea') inputs.set(label, result);
    return result;
  }
  const target = node();
  function Probe() {
    c = useSpreadsheet({ initialWorkbook: { sheets: [{ id: 'main', name: 'Main', rowCount: 5, columnCount: 5,
      cells: { A1: { value: 'initial' }, B2: { value: 'abcdef' }, C3: { value: '=1+2' } } }] }, onSave() {}, ...options });
    return createElement(SpreadsheetGrid, { controller: c });
  }
  await act(async () => { renderer = create(createElement(Probe), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const cell = address => renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['aria-label'].split(' ')[0] === address);
  const input = () => renderer.root.findByProps({ className: 'lxs-cell-input' });
  return { get c() { return c; }, document, cell, input,
    inputNode: () => inputs.get(input().props['aria-label']),
    async click(address, { inputTarget = false, ...modifiers } = {}) {
      const pointer = event({ currentTarget: target, target: inputTarget ? inputs.get(`${address}の値`) : target, ...modifiers });
      await act(async () => cell(address).props.onPointerDown(pointer));
      await act(async () => listeners.get('pointerup')?.(event({ buttons: 0 })));
      return pointer;
    },
    async key(key, modifiers = {}) { const press = event({ key, ...modifiers }); await act(async () => input().props.onKeyDown(press)); return press; },
    async change(value) { await act(async () => input().props.onChange({ target: { value } })); },
    async compose() { await act(async () => input().props.onCompositionStart()); },
  };
}

test('a first cell click only selects without highlighting its text, and the next click leaves native caret placement intact', async t => {
  const ui = await mount(t);
  assert.equal(ui.document.activeElement, null);
  const first = await ui.click('A1', { inputTarget: true });
  assert.equal(first.prevented, true);
  assert.equal(ui.c.editing, null, 'an initially selected cell still needs focus before a later click starts editing');
  await ui.click('B2');
  const input = ui.inputNode();
  assert.deepEqual(ui.c.selection.focus, { row: 1, column: 1 });
  assert.equal(ui.c.editing, null);
  assert.equal(input.selectCalls, 0);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 0]);
  await act(async () => ui.input().props.onFocus({ currentTarget: input }));
  assert.equal(input.selectCalls, 0);
  input.selectionStart = 3; input.selectionEnd = 3;
  const previousRanges = input.ranges.length;
  const second = await ui.click('B2', { inputTarget: true });
  assert.equal(second.prevented, false);
  assert.equal(ui.c.editing.value, 'abcdef');
  assert.equal(input.ranges.length, previousRanges, 'entering pointer edit does not override the browser cursor');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 3]);
  const editing = ui.c.editing;
  await act(async () => ui.input().props.onFocus({ currentTarget: input }));
  await ui.click('B2', { inputTarget: true });
  await act(async () => ui.cell('B2').props.onDoubleClick());
  assert.strictEqual(ui.c.editing, editing, 'further clicks and double-click do not restart an existing editor');
  assert.equal(input.ranges.length, previousRanges);
});

test('returning focus to a selected input selects first and only a following click edits', async t => {
  const ui = await mount(t);
  await ui.click('B2');
  ui.document.activeElement = {};
  assert.equal((await ui.click('B2', { inputTarget: true })).prevented, true);
  assert.equal(ui.c.editing, null);
  assert.equal((await ui.click('B2', { inputTarget: true })).prevented, false);
  assert.equal(ui.c.editing.value, 'abcdef');
});

test('modifier clicks and clicks within a selected range retain cell selection gestures instead of entering text editing', async t => {
  const ui = await mount(t);
  await ui.click('A1');
  await ui.click('C3', { shiftKey: true });
  const range = ui.c.selection.ranges;
  await ui.click('C3', { inputTarget: true, shiftKey: true });
  assert.equal(ui.c.editing, null);
  assert.deepEqual(ui.c.selection.ranges, range);
  await ui.click('C3', { inputTarget: true });
  assert.equal(ui.c.editing, null, 'clicking the active cell in a range collapses the range first');
  assert.deepEqual(ui.c.selection.ranges, [{ anchor: { row: 2, column: 2 }, focus: { row: 2, column: 2 } }]);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal((await ui.click('C3', { inputTarget: true, [modifier]: true })).prevented, true);
    assert.equal(ui.c.editing, null, modifier);
  }
});

test('F2 edits the original value at its end while ordinary typing replaces the selected cell', async t => {
  const ui = await mount(t);
  await ui.click('C3');
  assert.equal(ui.input().props.value, '3');
  const input = ui.inputNode();
  assert.equal((await ui.key('F2')).prevented, true);
  assert.equal(ui.c.editing.value, '=1+2');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [4, 4]);
  const editing = ui.c.editing;
  input.selectionStart = 2; input.selectionEnd = 2;
  await ui.key('F2');
  assert.strictEqual(ui.c.editing, editing);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [2, 2]);
  await ui.key('Escape');
  assert.equal(ui.c.editing, null);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 0]);
  assert.equal((await ui.key('Q', { shiftKey: true })).prevented, true);
  assert.equal(ui.c.editing.value, 'Q');
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 1]);
  assert.equal((await ui.key('x')).prevented, false, 'subsequent typing is left to the native editor');
  await ui.change('Qx');
  await ui.key('Enter');
  assert.equal(ui.c.activeSheet.cells.C3.value, 'Qx');
  assert.equal(input.selectCalls, 0);
});

test('IME replaces a selected cell from an empty draft and preserves text when composition begins inside an editor', async t => {
  const ui = await mount(t);
  await ui.click('B2');
  await ui.key('Process', { keyCode: 229 });
  assert.equal(ui.c.editing, null);
  await ui.compose();
  assert.equal(ui.c.editing.value, '');
  await ui.change('日本語');
  const editing = ui.c.editing;
  await ui.key('Enter', { nativeEvent: { isComposing: true } });
  assert.strictEqual(ui.c.editing, editing);
  await ui.compose();
  assert.strictEqual(ui.c.editing, editing, 'composition inside an editor does not clear the existing draft');
  await ui.key('Enter');
  assert.equal(ui.c.activeSheet.cells.B2.value, '日本語');
});

test('text input without a plain keydown replaces a selected cell but inserts normally inside an editor', async t => {
  const ui = await mount(t);
  await ui.click('B2');
  await ui.key('x', { altKey: true });
  assert.equal(ui.c.editing, null);
  const input = event({ data: '∑' });
  await act(async () => ui.input().props.onBeforeInput(input));
  assert.equal(input.prevented, true);
  assert.equal(ui.c.editing.value, '∑');
  const next = event({ data: 'x' });
  await act(async () => ui.input().props.onBeforeInput(next));
  assert.equal(next.prevented, false, 'an active editor keeps native cursor insertion');
  await ui.change('∑x');
  await ui.key('Enter');
  assert.equal(ui.c.activeSheet.cells.B2.value, '∑x');
});

test('readonly cells stay selectable and reject repeated clicks, F2, typing, and IME editing', async t => {
  const ui = await mount(t, { readOnly: true });
  await ui.click('B2');
  const input = ui.inputNode();
  assert.equal(ui.input().props.readOnly, true);
  await ui.click('B2', { inputTarget: true });
  await ui.key('F2');
  await ui.key('x');
  await ui.compose();
  assert.equal(ui.c.editing, null);
  assert.equal(ui.c.activeSheet.cells.B2.value, 'abcdef');
  assert.equal(input.selectCalls, 0);
});

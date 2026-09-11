import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  stdin: { contents: 'export { default as Spreadsheet } from "./src/spreadsheet";',
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'history-grid-test.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'same-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, options = {}) {
  let renderer, section, sectionProps, activeInput, gridScroller;
  const drawings = new Map();
  const nodes = new WeakMap();
  const document = { activeElement: null, addEventListener() {}, removeEventListener() {},
    defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = element => {
    if (nodes.has(element.props)) return nodes.get(element.props);
    const drawingId = element.props['data-lxs-drawing'];
    const inGrid = ['lxs-cell-input', 'lxs-grid-scroll'].includes(element.props.className) || !!drawingId;
    const result = { ownerDocument: document, addEventListener() {}, removeEventListener() {}, style: {}, scrollHeight: 18, label: element.props['aria-label'], insideSpreadsheet: true,
      dataset: { lxsDrawing: drawingId },
      focus() {
        if (document.activeElement !== this) {
          sectionProps?.onBlurCapture?.({ currentTarget: section, relatedTarget: this });
          document.activeElement = this;
          sectionProps?.onFocusCapture?.({ target: this });
        }
      }, select() {}, setSelectionRange() {},
      contains: target => !!target?.insideSpreadsheet && (element.type === 'section' || target === result ||
        (element.props.className === 'lxs-grid-scroll' && target.inGrid)),
      inGrid, gridOwner: gridScroller, closest: selector => selector === '.lxs-grid-scroll' && inGrid ? result : null,
      querySelector: selector => selector === '.lxs-cell-input' ? activeInput : null,
      querySelectorAll: selector => selector === '[data-lxs-drawing]' ? renderer.root.findAllByType('div')
        .filter(div => div.props['data-lxs-drawing']).map(div => div.instance) : [],
      scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000 };
    if (element.type === 'section') { section = result; sectionProps = element.props; }
    if (element.props.className === 'lxs-cell-input') activeInput = result;
    if (element.props.className === 'lxs-grid-scroll') { gridScroller = result; if (activeInput) activeInput.gridOwner = result; }
    if (drawingId) drawings.set(drawingId, result);
    nodes.set(element.props, result);
    return result;
  };
  await act(async () => { renderer = create(createElement(StrictMode, null, createElement(Spreadsheet, {
    initialWorkbook: { sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8,
      cells: { A1: { value: 'baseline' } } }] }, onSave() {}, ...options,
  })), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const controller = () => renderer.root.findAll(instance => instance.props.controller?.undo)[0].props.controller;
  return {
    get c() { return controller(); },
    value(address) { return controller().activeSheet.cells[address]?.value; },
    async edit(row, column, value) {
      await act(async () => { controller().select({ row, column }); controller().beginEdit({ row, column }, value); });
      await act(async () => { assert.equal(await controller().commitEdit(), true); controller().requestGridFocus(); });
    },
    async key(key, modifiers) {
      let prevented = false;
      await act(async () => renderer.root.findAllByType('textarea').find(input => input.props.className === 'lxs-cell-input')
        .props.onKeyDown({ key, nativeEvent: {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
          preventDefault() { prevented = true; }, ...modifiers }));
      assert.equal(prevented, true);
    },
    async pasteText(text) {
      await act(async () => renderer.root.findByType('section').props.onPaste({ target: activeInput, preventDefault() {}, clipboardData: {
        types: ['text/plain'], getData: type => type === 'text/plain' ? text : '',
      } }));
    },
    assertGridFocus(address) {
      assert.equal(document.activeElement === activeInput, true, 'keyboard focus must belong to the replacement grid input');
      if (address) {
        assert.equal(document.activeElement.label, `${address}の値`, 'actual DOM focus must point to the changed cell');
        const renderedInput = renderer.root.findAllByType('textarea').find(input => input.props.className === 'lxs-cell-input');
        assert.equal(renderedInput.props['aria-label'], `${address}の値`);
      }
    },
    async focusCell(row, column) {
      await act(async () => { controller().select({ row, column }); controller().requestGridFocus(); });
    },
    async focusDrawing(id) {
      await act(async () => {
        controller().selectDrawing(id);
        renderer.root.findAllByType('div').find(div => div.props['data-lxs-drawing'] === id).instance.focus();
      });
    },
    async drawingKey(key, modifiers = {}) {
      let prevented = false;
      await act(async () => renderer.root.findByType('section').props.onKeyDown({ key, nativeEvent: {},
        target: drawings.get(controller().selectedDrawingId), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        preventDefault() { prevented = true; }, ...modifiers }));
      assert.equal(prevented, true);
    },
    assertDrawingFocus(id) {
      assert.equal(document.activeElement, drawings.get(id), 'keyboard focus must stay on the replacement drawing');
      assert.match(renderer.root.findAllByType('div').find(div => div.props['data-lxs-drawing'] === id).props.className, /lxs-drawing-selected/);
    },
    focusOutside() {
      const outside = { closest: () => null };
      sectionProps.onBlurCapture({ currentTarget: section, relatedTarget: outside });
      document.activeElement = outside;
      return outside;
    },
    activeElement: () => document.activeElement,
  };
}

test('successive keyboard Undo and Redo move selection and actual DOM focus to each changed cell', async t => {
  const ui = await mount(t);
  await ui.edit(1, 1, 'first');
  await ui.edit(2, 2, 'second');
  await ui.edit(3, 3, 'third');
  for (const [undo, redo] of [
    [{ key: 'z', metaKey: true }, { key: 'z', metaKey: true, shiftKey: true }],
    [{ key: 'z', ctrlKey: true }, { key: 'y', ctrlKey: true }],
  ]) {
    await ui.focusCell(6, 6);
    for (const [address, row, column] of [['D4', 3, 3], ['C3', 2, 2], ['B2', 1, 1]]) {
      await ui.key(undo.key, undo);
      assert.equal(ui.value(address), undefined);
      assert.equal(ui.c.editing, null);
      assert.deepEqual(ui.c.selection.focus, { row, column });
      ui.assertGridFocus(address);
    }
    assert.equal(ui.c.canUndo, false);
    assert.equal(ui.c.canRedo, true);
    assert.equal(ui.c.dirty, false);
    await ui.focusCell(7, 7);
    for (const [address, value, row, column] of [['B2', 'first', 1, 1], ['C3', 'second', 2, 2], ['D4', 'third', 3, 3]]) {
      await ui.key(redo.key, redo);
      assert.equal(ui.value(address), value);
      assert.deepEqual(ui.c.selection.focus, { row, column });
      ui.assertGridFocus(address);
    }
    assert.equal(ui.c.canUndo, true);
    assert.equal(ui.c.canRedo, false);
  }
});

test('rapid history calls use the latest snapshots without ending or reacquiring edit permission', async t => {
  const events = [];
  let requests = 0, permission;
  const ui = await mount(t, { onEditRequest(_request, context) { requests++; permission = context; return true; },
    onEvent: event => { if (event.type === 'change') events.push([event.source, event.workbook.sheets[0].cells.A1.value]); } });
  for (const value of ['first', 'second', 'third']) await ui.edit(0, 0, value);
  const { undo, redo } = ui.c;
  await act(async () => { assert.equal(undo(), true); assert.equal(undo(), true); assert.equal(undo(), true); assert.equal(undo(), false); });
  assert.equal(ui.value('A1'), 'baseline');
  await act(async () => { assert.equal(redo(), true); assert.equal(redo(), true); assert.equal(redo(), true); assert.equal(redo(), false); });
  assert.equal(ui.value('A1'), 'third');
  assert.equal(requests, 1);
  assert.equal(permission.signal.aborted, false);
  assert.equal(ui.c.editMode, 'edit');
  assert.deepEqual(events.slice(3), [['undo', 'second'], ['undo', 'first'], ['undo', 'baseline'],
    ['redo', 'first'], ['redo', 'second'], ['redo', 'third']]);
});

test('history does not take focus from a control outside the grid', async t => {
  const ui = await mount(t);
  await ui.edit(1, 1, 'changed');
  await ui.focusCell(7, 7);
  const outside = ui.focusOutside();
  await act(async () => assert.equal(ui.c.undo(), true));
  assert.equal(ui.activeElement(), outside);
  assert.deepEqual(ui.c.selection.focus, { row: 1, column: 1 });
  await act(async () => assert.equal(ui.c.redo(), true));
  assert.equal(ui.activeElement(), outside);
  assert.deepEqual(ui.c.selection.focus, { row: 1, column: 1 });
});

test('imperative paste history selects its changed cell instead of subsequently selected disjoint ranges', async t => {
  const ui = await mount(t);
  const focus = { row: 4, column: 5 };
  await act(async () => assert.equal((await ui.c.externalExecute({ type: 'cells.paste', sheetId: 'one', target: focus,
    mode: 'values', payload: { values: [['pasted']] } })).ok, true));
  assert.equal(ui.value('F5'), 'pasted');
  for (const direction of ['undo', 'redo']) {
    await ui.focusCell(7, 7);
    await act(async () => {
      ui.c.selectRange({ row: 0, column: 0 }, { row: 1, column: 2 });
      ui.c.selectRange({ row: 6, column: 6 }, { row: 7, column: 7 }, true);
    });
    assert.equal(ui.c.selection.ranges.length, 2);
    await act(async () => assert.equal(await ui.c[direction](), true));
    assert.deepEqual(ui.c.selection.focus, focus);
    assert.deepEqual(ui.c.selection.ranges, [{ anchor: focus, focus }]);
    assert.equal(ui.value('F5'), direction === 'undo' ? undefined : 'pasted');
    ui.assertGridFocus('F5');
  }
});

// Selection ranges may be coalesced or reordered to place the active range last.
function selectedCells(selection) {
  const cells = new Set();
  for (const range of selection.ranges) {
    for (let row = Math.min(range.anchor.row, range.focus.row); row <= Math.max(range.anchor.row, range.focus.row); row++) {
      for (let column = Math.min(range.anchor.column, range.focus.column); column <= Math.max(range.anchor.column, range.focus.column); column++) {
        cells.add(`${row}:${column}`);
      }
    }
  }
  return [...cells].sort();
}

test('imperative multi-cell history selects changed cells when no GUI selection was captured', async t => {
  const ui = await mount(t);
  await act(async () => assert.equal((await ui.c.externalExecute({ type: 'cells.set', sheetId: 'one',
    values: { F6: 'third', B2: 'first', D4: 'second', A1: 'baseline' } })).ok, true));
  for (const direction of ['undo', 'redo']) {
    await ui.focusCell(7, 7);
    await act(async () => {
      ui.c.selectRange({ row: 0, column: 0 }, { row: 0, column: 2 });
      ui.c.selectRange({ row: 7, column: 0 }, { row: 7, column: 3 }, true);
    });
    await act(async () => assert.equal(await ui.c[direction](), true));
    assert.deepEqual(selectedCells(ui.c.selection), ['1:1', '3:3', '5:5']);
    assert.deepEqual(ui.c.selection.focus, { row: 1, column: 1 });
    assert.equal(ui.value('A1'), 'baseline', 'an unchanged command entry must not become a history target');
    ui.assertGridFocus('B2');
  }
});

const historyWorkbook = cells => ({ sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8,
  cells: Object.fromEntries(Object.entries(cells).map(([address, value]) => [address, { value }])) }] });

test('GUI Delete history restores the original rectangle including unchanged blanks and its active cursor', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({ B2: 'first', D4: 'second' }) });
  await ui.focusCell(1, 1);
  await act(async () => { ui.c.selectRange({ row: 1, column: 1 }, { row: 5, column: 5 }); ui.c.requestGridFocus(); });
  const original = structuredClone(ui.c.selection);
  await ui.key('Delete');
  assert.equal(ui.c.getHistoryState().undoCount, 1);
  for (let cycle = 0; cycle < 2; cycle++) for (const [key, restored] of [['z', true], ['y', false]]) {
    await ui.focusCell(7, 7);
    await ui.key(key, { ctrlKey: true });
    assert.deepEqual(ui.c.selection, original, 'history keeps the full user-selected range rather than sparse changed cells');
    assert.equal(selectedCells(ui.c.selection).length, 25);
    assert.equal(ui.value('B2'), restored ? 'first' : undefined);
    assert.equal(ui.value('D4'), restored ? 'second' : undefined);
    assert.equal(ui.value('F6'), undefined, 'an unchanged blank remains part of the restored selection');
    ui.assertGridFocus('F6');
  }
});

test('GUI multi-range history preserves each range, orientation and active range without selecting the gaps', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({ B2: 'first', G7: 'second', E5: 'untouched gap' }) });
  await ui.focusCell(1, 1);
  await act(async () => {
    ui.c.selectRange({ row: 1, column: 1 }, { row: 3, column: 3 });
    ui.c.selectRange({ row: 6, column: 6 }, { row: 5, column: 5 }, true);
    ui.c.requestGridFocus();
  });
  const original = structuredClone(ui.c.selection);
  await ui.key('Delete');
  for (const key of ['z', 'y']) {
    await ui.focusCell(0, 7);
    await ui.key(key, { ctrlKey: true });
    assert.deepEqual(ui.c.selection, original);
    assert.equal(selectedCells(ui.c.selection).length, 13);
    assert.equal(selectedCells(ui.c.selection).includes('4:4'), false);
    assert.equal(ui.value('E5'), 'untouched gap');
    ui.assertGridFocus('F6');
  }
});

test('GUI column history retains header kind and all selected rows even when only two values changed', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({ C2: 'first', D7: 'second' }) });
  await ui.focusCell(0, 2);
  await act(async () => { ui.c.selectAxisRange('column', 2, 3); ui.c.requestGridFocus(); });
  const original = structuredClone(ui.c.selection);
  assert.equal(original.ranges[0].kind, 'column');
  await ui.key('Delete');
  for (const key of ['z', 'y']) {
    await ui.focusCell(7, 7);
    await ui.key(key, { ctrlKey: true });
    assert.deepEqual(ui.c.selection, original);
    assert.equal(selectedCells(ui.c.selection).length, 16);
    ui.assertGridFocus('D1');
  }
});

test('GUI paste history restores the complete transfer rectangle including blank cells, not the previous destination selection', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({}) });
  await ui.focusCell(3, 3);
  await act(async () => { ui.c.selectRange({ row: 3, column: 3 }, { row: 5, column: 5 }); ui.c.requestGridFocus(); });
  await ui.pasteText('first\t\r\n\tlast');
  assert.equal(ui.c.error, null);
  const transferred = structuredClone(ui.c.selection);
  assert.deepEqual(transferred.ranges, [{ anchor: { row: 3, column: 3 }, focus: { row: 4, column: 4 } }]);
  assert.deepEqual(transferred.focus, { row: 3, column: 3 });
  for (const key of ['z', 'y']) {
    await ui.focusCell(7, 7);
    await ui.key(key, { ctrlKey: true });
    assert.deepEqual(ui.c.selection, transferred);
    assert.equal(selectedCells(ui.c.selection).length, 4);
    assert.equal(ui.value('D4'), key === 'z' ? undefined : 'first');
    assert.equal(ui.value('E5'), key === 'z' ? undefined : 'last');
    ui.assertGridFocus('D4');
  }
});

test('GUI paste expansion history clamps its restored cursor temporarily without shrinking the saved transfer range', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({}) });
  await ui.focusCell(7, 7);
  await ui.pasteText('first\t\r\n\tlast');
  assert.equal(ui.c.error, null);
  const transferred = structuredClone(ui.c.selection);
  assert.deepEqual(transferred.ranges, [{ anchor: { row: 7, column: 7 }, focus: { row: 8, column: 8 } }]);
  assert.equal(ui.c.activeSheet.rowCount, 9);
  assert.equal(ui.c.activeSheet.columnCount, 9);
  for (let cycle = 0; cycle < 2; cycle++) {
    await ui.focusCell(0, 0);
    await ui.key('z', { ctrlKey: true });
    assert.equal(ui.c.activeSheet.rowCount, 8);
    assert.equal(ui.c.activeSheet.columnCount, 8);
    assert.deepEqual(ui.c.selection.ranges, [{ anchor: { row: 7, column: 7 }, focus: { row: 7, column: 7 } }]);
    assert.deepEqual(ui.c.selection.focus, { row: 7, column: 7 });
    assert.equal(ui.value('H8'), undefined);
    ui.assertGridFocus('H8');
    await ui.focusCell(1, 1);
    await ui.key('y', { ctrlKey: true });
    assert.equal(ui.c.activeSheet.rowCount, 9);
    assert.equal(ui.c.activeSheet.columnCount, 9);
    assert.deepEqual(ui.c.selection, transferred, 'Redo restores the original 2×2 metadata after Undo clamped the visible range');
    assert.equal(ui.value('H8'), 'first');
    assert.equal(ui.value('I9'), 'last');
    ui.assertGridFocus('H8');
  }
});

test('GUI history ignores no-op selections and keeps operation ranges paired through Redo and a new branch', async t => {
  const ui = await mount(t, { initialWorkbook: historyWorkbook({ B2: 'first', F6: 'second', H8: 'branch' }) });
  const originals = [];
  for (const [start, end] of [[{ row: 1, column: 1 }, { row: 3, column: 3 }], [{ row: 4, column: 4 }, { row: 6, column: 6 }]]) {
    await act(async () => { ui.c.selectRange(start, end); ui.c.requestGridFocus(); });
    originals.push(structuredClone(ui.c.selection));
    await ui.key('Delete');
  }
  await ui.focusCell(7, 0);
  await ui.key('Delete');
  assert.equal(ui.c.getHistoryState().undoCount, 2, 'clearing a blank cell does not record its selection');
  await ui.key('z', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, originals[1]);
  await ui.focusCell(7, 0);
  await ui.key('Delete');
  assert.equal(ui.c.getHistoryState().redoCount, 1, 'a no-op must not clear the Redo branch');
  await ui.key('y', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, originals[1]);
  await ui.key('z', { ctrlKey: true });
  await ui.focusCell(7, 7);
  const branch = structuredClone(ui.c.selection);
  await ui.key('Delete');
  assert.equal(ui.c.getHistoryState().redoCount, 0);
  await ui.focusCell(0, 0);
  await ui.key('z', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, branch);
  await ui.focusCell(0, 7);
  await ui.key('z', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, originals[0]);
  assert.equal(ui.value('B2'), 'first');
  assert.equal(ui.value('F6'), 'second');
  assert.equal(ui.value('H8'), 'branch');
});

test('GUI structural history restores its selected rows on Undo and safely clamps them on Redo', async t => {
  const ui = await mount(t);
  await act(async () => ui.c.selectAxisRange('row', 4, 7));
  const original = structuredClone(ui.c.selection);
  await act(async () => assert.equal((await ui.c.executeCommand({ type: 'rows.delete', sheetId: 'one', index: 4, count: 4 })).ok, true));
  await ui.focusCell(0, 0);
  await ui.key('z', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, original);
  await ui.focusCell(1, 1);
  await ui.key('y', { ctrlKey: true });
  assert.deepEqual(ui.c.selection.ranges, [{ kind: 'row', anchor: { row: 3, column: 7 }, focus: { row: 3, column: 0 } }]);
  assert.deepEqual(ui.c.selection.focus, { row: 3, column: 0 });
  assert.equal(ui.c.activeSheet.rowCount, 4);
});

test('GUI history captures selection before asynchronous editing permission and subsequent navigation', async t => {
  let grant;
  const permission = new Promise(resolve => { grant = resolve; });
  const ui = await mount(t, { initialWorkbook: historyWorkbook({ B2: 'original' }), onEditRequest: () => permission });
  await act(async () => { ui.c.selectRange({ row: 1, column: 1 }, { row: 3, column: 3 }); ui.c.requestGridFocus(); });
  const original = structuredClone(ui.c.selection);
  await ui.key('Delete');
  assert.equal(ui.c.requesting, true);
  await ui.focusCell(7, 7);
  await act(async () => grant(true));
  assert.equal(ui.value('B2'), undefined);
  await ui.key('z', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, original);
  ui.assertGridFocus('D4');
  await ui.focusCell(0, 0);
  await ui.key('y', { ctrlKey: true });
  assert.deepEqual(ui.c.selection, original);
});

test('history of a cell edited on an inactive sheet navigates to that sheet and focuses its changed cell', async t => {
  const ui = await mount(t, { initialWorkbook: { sheets: [
    { id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8, cells: { A1: { value: 'baseline' } } },
    { id: 'two', name: 'Sheet2', rowCount: 8, columnCount: 8, cells: {} },
  ] } });
  await ui.focusCell(6, 6);
  await act(async () => assert.equal((await ui.c.externalExecuteAsync({ type: 'cells.set', sheetId: 'two', values: { C3: 'remote sheet' } })).ok, true));
  assert.equal(ui.c.activeSheet.id, 'one');
  for (const [key, modifiers, value] of [['z', { ctrlKey: true }, undefined], ['y', { ctrlKey: true }, 'remote sheet']]) {
    await act(async () => ui.c.selectCellInSheet('one', { row: 6, column: 6 }));
    await ui.focusCell(6, 6);
    await ui.key(key, modifiers);
    assert.equal(ui.c.activeSheet.id, 'two');
    assert.equal(ui.c.selection.sheetId, 'two');
    assert.deepEqual(ui.c.selection.focus, { row: 2, column: 2 });
    assert.equal(ui.value('C3'), value);
    ui.assertGridFocus('C3');
  }
});

test('drawing history targets the changed object, its anchor on removal, and the restored object on Redo', async t => {
  const ui = await mount(t);
  let drawingId;
  await act(async () => {
    const result = await ui.c.externalExecute({ type: 'shapes.insert', sheetId: 'one', shape: 'rectangle',
      anchor: { row: 1, column: 1 }, width: 120, height: 60 });
    assert.equal(result.ok, true);
    drawingId = result.results[0].drawingId;
  });
  await ui.focusDrawing(drawingId);
  await act(async () => assert.equal((await ui.c.executeCommand({ type: 'shapes.update', sheetId: 'one', drawingId,
    patch: { width: 180 } })).ok, true));
  for (const [undo, redo] of [
    [{ key: 'z', ctrlKey: true }, { key: 'y', ctrlKey: true }],
    [{ key: 'z', metaKey: true }, { key: 'z', metaKey: true, shiftKey: true }],
  ]) {
    await ui.focusCell(7, 7);
    await ui.key(undo.key, undo);
    assert.equal(ui.c.selectedDrawingId, drawingId);
    assert.equal(ui.c.selectedDrawing.width, 120);
    ui.assertDrawingFocus(drawingId);
    await ui.drawingKey(redo.key, redo);
    assert.equal(ui.c.selectedDrawingId, drawingId);
    assert.equal(ui.c.selectedDrawing.width, 180);
    ui.assertDrawingFocus(drawingId);
  }
  await ui.drawingKey('z', { ctrlKey: true });
  await ui.drawingKey('z', { ctrlKey: true });
  assert.equal(ui.c.selectedDrawingId, null, 'Undo insertion clears a target which no longer exists');
  assert.deepEqual(ui.c.selection.focus, { row: 1, column: 1 });
  ui.assertGridFocus('B2');
  await ui.key('y', { ctrlKey: true });
  assert.equal(ui.c.selectedDrawingId, drawingId, 'Redo selects the restored drawing');
  ui.assertDrawingFocus(drawingId);
});

test('imperative structural history clamps the current active cell when Undo or Redo shrinks rows and columns', async t => {
  const ui = await mount(t);
  await act(async () => assert.equal((await ui.c.externalBatch([
    { type: 'rows.delete', sheetId: 'one', index: 4, count: 4 },
    { type: 'columns.delete', sheetId: 'one', index: 4, count: 4 },
  ])).ok, true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => ui.c.select({ row: 7, column: 7 }));
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.deepEqual(ui.c.selection.focus, { row: 3, column: 3 });
  await act(async () => assert.equal((await ui.c.externalBatch([
    { type: 'rows.insert', sheetId: 'one', index: 4, count: 4 },
    { type: 'columns.insert', sheetId: 'one', index: 4, count: 4 },
  ])).ok, true));
  await act(async () => ui.c.select({ row: 7, column: 7 }));
  await act(async () => assert.equal(await ui.c.undo(), true));
  const focus = { row: 3, column: 3 };
  assert.deepEqual(ui.c.selection.ranges, [{ anchor: focus, focus }]);
});

test('imperative structural history clamps current disjoint ranges without losing valid cells', async t => {
  const ui = await mount(t);
  await act(async () => assert.equal((await ui.c.externalBatch([
    { type: 'rows.delete', sheetId: 'one', index: 4, count: 4 },
    { type: 'columns.delete', sheetId: 'one', index: 4, count: 4 },
  ])).ok, true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => {
    ui.c.selectRange({ row: 0, column: 0 }, { row: 1, column: 1 });
    ui.c.selectRange({ row: 7, column: 7 }, { row: 2, column: 2 }, true);
  });
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.deepEqual(ui.c.selection.ranges, [
    { anchor: { row: 0, column: 0 }, focus: { row: 1, column: 1 } },
    { anchor: { row: 3, column: 3 }, focus: { row: 2, column: 2 } },
  ]);
  assert.deepEqual(ui.c.selection.focus, { row: 2, column: 2 });
});

test('Undo can restore merged cells with the maximum number of disjoint ranges', async t => {
  const merges = Array.from({ length: 128 }, (_, row) => ({ top: row, bottom: row, left: 0, right: 1 }));
  const ui = await mount(t, { initialWorkbook: { sheets: [{ id: 'one', name: 'Sheet1', rowCount: 128, columnCount: 4, cells: {}, merges }] } });
  await act(async () => assert.equal((await ui.c.externalExecute({ type: 'cells.unmerge', sheetId: 'one',
    range: { top: 0, bottom: 127, left: 0, right: 3 } })).ok, true));
  await act(async () => {
    for (let row = 0; row < 128; row++) assert.equal(ui.c.select({ row, column: 0 }, false, row !== 0), true);
  });
  assert.equal(ui.c.selection.ranges.length, 128);
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.equal(ui.c.activeSheet.merges.length, 128);
  assert.equal(ui.c.selection.ranges.length, 128);
  for (const [row, range] of ui.c.selection.ranges.entries()) {
    assert.deepEqual(range, { anchor: { row, column: 0 }, focus: { row, column: 1 } });
  }
  assert.deepEqual(ui.c.selection.focus, { row: 127, column: 0 });
});

test('history selects a valid fallback cell when Undo or Redo removes the active sheet', async t => {
  const ui = await mount(t);
  let copiedId;
  await act(async () => {
    const result = await ui.c.externalExecute({ type: 'sheets.duplicate', sheetId: 'one' });
    assert.equal(result.ok, true);
    copiedId = result.results[0].sheetId;
  });
  await act(async () => ui.c.selectCellInSheet(copiedId, { row: 4, column: 5 }));
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.equal(ui.c.selection.sheetId, 'one');
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
  await act(async () => assert.equal(await ui.c.redo(), true));
  await act(async () => assert.equal((await ui.c.externalExecute({ type: 'sheets.delete', sheetId: copiedId })).ok, true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => ui.c.selectCellInSheet(copiedId, { row: 4, column: 5 }));
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.equal(ui.c.selection.sheetId, 'one');
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
});

test('GUI sheet deletion restores its saved selection on Undo and falls back to the first sheet when Redo removes that target', async t => {
  const ui = await mount(t, { initialWorkbook: { sheets: ['one', 'two', 'three'].map(id => ({
    id, name: id, rowCount: 8, columnCount: 8, cells: {},
  })) } });
  await act(async () => ui.c.switchSheet('two'));
  await ui.focusCell(2, 2);
  await act(async () => { ui.c.selectRange({ row: 2, column: 2 }, { row: 5, column: 5 }); ui.c.requestGridFocus(); });
  const original = structuredClone(ui.c.selection);
  await act(async () => assert.equal((await ui.c.executeCommand({ type: 'sheets.delete', sheetId: 'two' })).ok, true));
  assert.equal(ui.c.workbook.sheets.some(sheet => sheet.id === 'two'), false);
  for (let cycle = 0; cycle < 2; cycle++) {
    await act(async () => ui.c.switchSheet('three'));
    await ui.focusCell(7, 7);
    await ui.key('z', { ctrlKey: true });
    assert.equal(ui.c.activeSheet.id, 'two');
    assert.deepEqual(ui.c.selection, original);
    ui.assertGridFocus('F6');
    await act(async () => ui.c.switchSheet('three'));
    await ui.focusCell(6, 6);
    await ui.key('y', { ctrlKey: true });
    assert.equal(ui.c.workbook.sheets.some(sheet => sheet.id === 'two'), false);
    assert.equal(ui.c.activeSheet.id, 'one');
    assert.deepEqual(ui.c.selection, { sheetId: 'one', anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 },
      ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }] });
    ui.assertGridFocus('A1');
  }
});

test('saving still resets the selected cell after history keeps its position', async t => {
  const ui = await mount(t);
  await ui.edit(4, 5, 'changed');
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.deepEqual(ui.c.selection.focus, { row: 4, column: 5 });
  await act(async () => assert.equal(await ui.c.save(), true));
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
});

test('refresh and discard reset explicit drawing and range selections after history targets changed cells', async t => {
  const initialWorkbook = { sheets: [{ id: 'one', name: 'Sheet1', rowCount: 8, columnCount: 8, cells: {}, drawings: [{
    id: 'box', type: 'shape', shape: 'rectangle', anchor: { row: 1, column: 1, offsetX: 0, offsetY: 0 },
    width: 120, height: 60, fill: '#ffffff', stroke: '#217346', strokeWidth: 2,
  }] }] };
  const ui = await mount(t, { initialWorkbook, onRefresh: () => initialWorkbook });
  for (const operation of ['discard', 'refresh']) {
    await act(async () => assert.equal((await ui.c.executeCommand({ type: 'cells.set', sheetId: 'one', values: { A1: 'changed' } })).ok, true));
    await act(async () => {
      ui.c.selectRange({ row: 2, column: 2 }, { row: 3, column: 3 });
      ui.c.selectRange({ row: 4, column: 4 }, { row: 5, column: 5 }, true);
      ui.c.selectDrawing('box');
    });
    await act(async () => assert.equal(await ui.c.undo(), true));
    await act(async () => assert.equal(await ui.c.redo(), true));
    assert.equal(ui.c.selectedDrawingId, null);
    assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
    await act(async () => {
      ui.c.selectRange({ row: 2, column: 2 }, { row: 3, column: 3 });
      ui.c.selectRange({ row: 4, column: 4 }, { row: 5, column: 5 }, true);
      ui.c.selectDrawing('box');
    });
    assert.equal(ui.c.selectedDrawingId, 'box');
    assert.equal(ui.c.selection.ranges.length, 2);
    await act(async () => assert.equal(await ui.c[operation]({ discardChanges: true }), true));
    assert.equal(ui.c.selectedDrawingId, null);
    assert.deepEqual(ui.c.selection.ranges, [{ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }]);
  }
});

test('history shortcuts retain their entries while a context-menu operation blocks mutations', async t => {
  const ui = await mount(t);
  await ui.edit(0, 0, 'first');
  await ui.edit(0, 0, 'second');
  await act(async () => ui.c.setContextMenuLock({}));
  await ui.key('z', { metaKey: true });
  assert.equal(ui.value('A1'), 'second');
  assert.equal(ui.c.canUndo, true);
  await act(async () => ui.c.setContextMenuLock(null));
  await ui.key('z', { metaKey: true });
  await ui.key('z', { metaKey: true });
  assert.equal(ui.value('A1'), 'baseline');
  await act(async () => ui.c.setContextMenuLock({}));
  await ui.key('z', { metaKey: true, shiftKey: true });
  assert.equal(ui.value('A1'), 'baseline');
  assert.equal(ui.c.canRedo, true);
  await act(async () => ui.c.setContextMenuLock(null));
  await ui.key('z', { metaKey: true, shiftKey: true });
  await ui.key('z', { metaKey: true, shiftKey: true });
  assert.equal(ui.value('A1'), 'second');
});

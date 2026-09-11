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
    const result = { ownerDocument: document, style: {}, scrollHeight: 18, label: element.props['aria-label'], insideSpreadsheet: true,
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
    assertGridFocus() {
      assert.equal(document.activeElement === activeInput, true, 'keyboard focus must belong to the replacement grid input');
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

test('successive keyboard Undo and Redo traverse every committed cell and retain grid focus', async t => {
  const ui = await mount(t);
  await ui.edit(1, 1, 'first');
  await ui.edit(2, 2, 'second');
  await ui.edit(3, 3, 'third');
  for (const [undo, redo] of [
    [{ key: 'z', metaKey: true }, { key: 'z', metaKey: true, shiftKey: true }],
    [{ key: 'z', ctrlKey: true }, { key: 'y', ctrlKey: true }],
  ]) {
    for (const address of ['D4', 'C3', 'B2']) {
      await ui.key(undo.key, undo);
      assert.equal(ui.value(address), undefined);
      assert.equal(ui.c.editing, null);
      ui.assertGridFocus();
    }
    assert.equal(ui.c.canUndo, false);
    assert.equal(ui.c.canRedo, true);
    assert.equal(ui.c.dirty, false);
    for (const [address, value] of [['B2', 'first'], ['C3', 'second'], ['D4', 'third']]) {
      await ui.key(redo.key, redo);
      assert.equal(ui.value(address), value);
      ui.assertGridFocus();
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
  const outside = ui.focusOutside();
  await act(async () => assert.equal(ui.c.undo(), true));
  assert.equal(ui.activeElement(), outside);
  await act(async () => assert.equal(ui.c.redo(), true));
  assert.equal(ui.activeElement(), outside);
});

test('paste Undo and Redo retain the active cell and every disjoint selection range', async t => {
  const ui = await mount(t);
  const focus = { row: 4, column: 5 };
  await act(async () => {
    ui.c.select(focus);
    assert.equal((await ui.c.executeCommand({ type: 'cells.paste', sheetId: 'one', target: focus,
      mode: 'values', payload: { values: [['pasted']] } })).ok, true);
  });
  assert.equal(ui.value('F5'), 'pasted');
  for (const direction of ['undo', 'redo']) {
    await act(async () => assert.equal(await ui.c[direction](), true));
    assert.deepEqual(ui.c.selection.focus, focus);
    assert.deepEqual(ui.c.selection.ranges, [{ anchor: focus, focus }]);
    assert.equal(ui.value('F5'), direction === 'undo' ? undefined : 'pasted');
  }
  const nextFocus = { row: 6, column: 7 };
  await act(async () => {
    ui.c.selectRange({ row: 1, column: 1 }, focus);
    ui.c.selectRange({ row: 5, column: 6 }, nextFocus, true);
  });
  assert.equal(ui.c.selection.ranges.length, 2);
  const selection = structuredClone(ui.c.selection);
  for (const direction of ['undo', 'redo']) {
    await act(async () => assert.equal(await ui.c[direction](), true));
    assert.deepEqual(ui.c.selection, selection);
  }
});

test('keyboard Undo and Redo preserve the selected drawing and its focus for repeated shortcuts', async t => {
  const ui = await mount(t);
  let drawingId;
  await act(async () => {
    const result = await ui.c.executeCommand({ type: 'shapes.insert', sheetId: 'one', shape: 'rectangle',
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
    await ui.drawingKey(undo.key, undo);
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
  ui.assertGridFocus();
  await ui.key('y', { ctrlKey: true });
  assert.equal(ui.c.selectedDrawingId, null, 'Redo does not revive a discarded selection');
  ui.assertGridFocus();
});

test('history clamps the active cell when Undo or Redo shrinks rows and columns', async t => {
  const ui = await mount(t);
  await act(async () => assert.equal((await ui.c.executeCommands([
    { type: 'rows.delete', sheetId: 'one', index: 4, count: 4 },
    { type: 'columns.delete', sheetId: 'one', index: 4, count: 4 },
  ])).ok, true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => ui.c.select({ row: 7, column: 7 }));
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.deepEqual(ui.c.selection.focus, { row: 3, column: 3 });
  await act(async () => assert.equal((await ui.c.executeCommands([
    { type: 'rows.insert', sheetId: 'one', index: 4, count: 4 },
    { type: 'columns.insert', sheetId: 'one', index: 4, count: 4 },
  ])).ok, true));
  await act(async () => ui.c.select({ row: 7, column: 7 }));
  await act(async () => assert.equal(await ui.c.undo(), true));
  const focus = { row: 3, column: 3 };
  assert.deepEqual(ui.c.selection.ranges, [{ anchor: focus, focus }]);
});

test('history clamps every disjoint range without losing its valid selected cells', async t => {
  const ui = await mount(t);
  await act(async () => assert.equal((await ui.c.executeCommands([
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
  await act(async () => assert.equal((await ui.c.executeCommand({ type: 'cells.unmerge', sheetId: 'one',
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
    const result = await ui.c.executeCommand({ type: 'sheets.duplicate', sheetId: 'one' });
    assert.equal(result.ok, true);
    copiedId = result.results[0].sheetId;
  });
  await act(async () => ui.c.selectCellInSheet(copiedId, { row: 4, column: 5 }));
  await act(async () => assert.equal(await ui.c.undo(), true));
  assert.equal(ui.c.selection.sheetId, 'one');
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
  await act(async () => assert.equal(await ui.c.redo(), true));
  await act(async () => assert.equal((await ui.c.executeCommand({ type: 'sheets.delete', sheetId: copiedId })).ok, true));
  await act(async () => assert.equal(await ui.c.undo(), true));
  await act(async () => ui.c.selectCellInSheet(copiedId, { row: 4, column: 5 }));
  await act(async () => assert.equal(await ui.c.redo(), true));
  assert.equal(ui.c.selection.sheetId, 'one');
  assert.deepEqual(ui.c.selection.focus, { row: 0, column: 0 });
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

test('refresh and discard still reset drawing and range selections after history preserves them', async t => {
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

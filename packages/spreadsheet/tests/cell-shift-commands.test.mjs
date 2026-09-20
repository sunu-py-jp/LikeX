import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, metafile: true });
const { applySpreadsheetCommands: apply, createWorkbook, normalizeWorkbook, serializeWorkbook,
  parseWorkbook, createSpreadsheetSession, SPREADSHEET_LIMITS } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sheetId = 'sheet-1';
const rectangle = { top: 2, left: 1, bottom: 3, right: 3 };
const first = result => result.workbook.sheets[0];
const value = (sheet, address) => sheet.cells[address]?.value;
const run = (workbook, ...commands) => {
  const result = apply(workbook, commands);
  assert.equal(result.ok, true, result.message);
  return result;
};
function workbookWith(values, overrides = {}, otherSheets = []) {
  const workbook = createWorkbook();
  return normalizeWorkbook({ ...workbook, sheets: [{ ...workbook.sheets[0], name: 'Data', rowCount: 8, columnCount: 8,
    cells: Object.fromEntries(Object.entries(values).map(([address, value]) => [address, { value }])),
    ...overrides }, ...otherSheets] });
}
const insert = (range = 'B3:D4', shift = 'down') => ({ type: 'cells.insert', sheetId, range, shift });
const remove = (range = 'B3:D4', shift = 'up') => ({ type: 'cells.delete', sheetId, range, shift });

test('all four directions match independent matrix splices for overlapping moves and boundary selections', () => {
  const matrix = Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => `${row}:${column}`));
  const source = workbookWith(Object.fromEntries(matrix.flatMap((row, r) => row.map((value, c) => [`${String.fromCharCode(65 + c)}${r + 1}`, value]))));
  for (const top of [0, 2, 5]) for (const left of [0, 2, 5]) for (const height of [1, 2, 3]) for (const width of [1, 2, 3]) {
    const range = { top, left, bottom: top + height - 1, right: left + width - 1 };
    for (const direction of ['down', 'right', 'up', 'left']) {
      const expected = matrix.map(row => [...row]);
      if (direction === 'down' || direction === 'up') {
        for (let column = left; column <= range.right; column++) {
          const values = matrix.map(row => row[column]);
          values.splice(top, direction === 'up' ? height : 0, ...Array(direction === 'down' ? height : 0).fill(undefined));
          for (let row = 0; row < Math.max(8, values.length); row++) {
            expected[row] ??= Array(8).fill(undefined);
            expected[row][column] = values[row];
          }
        }
      } else for (let row = top; row <= range.bottom; row++) {
        expected[row].splice(left, direction === 'left' ? width : 0, ...Array(direction === 'right' ? width : 0).fill(undefined));
      }
      const result = run(source, direction === 'down' || direction === 'right' ? insert(range, direction) : remove(range, direction));
      const cells = Object.fromEntries(expected.flatMap((row, r) => row.flatMap((value, c) => value === undefined ? [] :
        [[`${String.fromCharCode(65 + c)}${r + 1}`, { value }]])));
      assert.deepEqual({ ...first(result).cells }, cells, `${direction}: ${JSON.stringify(range)}`);
      assert.equal(first(result).rowCount, direction === 'down' ? 8 + height : 8);
      assert.equal(first(result).columnCount, direction === 'right' ? 8 + width : 8);
    }
  }
});

test('public partial-cell commands run headlessly without UI, React, DOM or CSS dependencies', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  for (const input of Object.keys(output.metafile.inputs)) {
    if (/\/core\/dist\/(?:ooxml|json)\.js$/.test(input)) continue;
    assert.doesNotMatch(input, /node_modules|\/(?:ui|state|core)\/|\/(?:core|props|spreadsheet)\.tsx?$|\.(?:css|tsx)$/);
  }
  assert.ok(Object.values(output.metafile.outputs).every(file => file.imports.length === 0));
  assert.equal(run(createWorkbook(), insert()).ok, true);
});

test('inserting down opens exactly the selected rectangle and only shifts its column lanes', () => {
  const workbook = workbookWith({ A3: 'left', B2: 'above', B3: 'one', C4: 'two', D6: 'three', E3: 'right', H8: 'outside' },
    { rowHeights: { 2: 42, 6: 38 }, columnWidths: { 1: 210, 4: 170 } });
  const before = serializeWorkbook(workbook);
  const result = run(workbook, insert());
  const sheet = first(result);
  assert.equal(value(sheet, 'B3'), undefined); assert.equal(value(sheet, 'C4'), undefined);
  assert.equal(value(sheet, 'B5'), 'one'); assert.equal(value(sheet, 'C6'), 'two'); assert.equal(value(sheet, 'D8'), 'three');
  for (const address of ['A3', 'B2', 'E3', 'H8']) assert.deepEqual(sheet.cells[address], workbook.sheets[0].cells[address]);
  assert.deepEqual(sheet.rowHeights, workbook.sheets[0].rowHeights);
  assert.deepEqual(sheet.columnWidths, workbook.sheets[0].columnWidths);
  assert.equal(serializeWorkbook(workbook), before);
  assert.deepEqual(result.results[0].range, rectangle);
  assert.deepEqual(result.results[0].placement, { nextRow: 4, nextColumn: 4 });
  assert.equal(result.results[0].write.changedCount > 0, true);
  assert.equal(Object.isFrozen(result.results[0].range), true);
});

test('inserting right supports zero-based rectangles and preserves rows outside the selected lanes', () => {
  const input = { ...rectangle };
  const workbook = workbookWith({ A3: 'before', B2: 'above', B3: 'one', C4: 'two', E3: 'three', B5: 'below' });
  const result = run(workbook, insert(input, 'right'));
  const sheet = first(result);
  assert.equal(value(sheet, 'B3'), undefined); assert.equal(value(sheet, 'C4'), undefined);
  assert.equal(value(sheet, 'E3'), 'one'); assert.equal(value(sheet, 'F4'), 'two'); assert.equal(value(sheet, 'H3'), 'three');
  for (const address of ['A3', 'B2', 'B5']) assert.deepEqual(sheet.cells[address], workbook.sheets[0].cells[address]);
  assert.deepEqual(input, rectangle);
  assert.deepEqual(result.results[0].range, rectangle);
  input.top = 0;
  assert.equal(result.results[0].range.top, 2);
});

test('deleting up and left shifts following cells into the gap without shrinking logical dimensions', () => {
  const cases = [
    ['up', { A3: 'left', B2: 'above', B3: 'remove', C4: 'remove too', B5: 'one', D8: 'two', E3: 'right' },
      { B3: 'one', D6: 'two' }, ['A3', 'B2', 'E3'], ['C4', 'B5', 'D8']],
    ['left', { A3: 'before', B2: 'above', B3: 'remove', C4: 'remove too', E3: 'one', H4: 'two', B5: 'below' },
      { B3: 'one', E4: 'two' }, ['A3', 'B2', 'B5'], ['C4', 'E3', 'H4']],
  ];
  for (const [shift, values, moved, preserved, removed] of cases) {
    const workbook = workbookWith(values);
    const result = run(workbook, remove('B3:D4', shift));
    const sheet = first(result);
    for (const [address, expected] of Object.entries(moved)) assert.equal(value(sheet, address), expected);
    for (const address of preserved) assert.deepEqual(sheet.cells[address], workbook.sheets[0].cells[address]);
    for (const address of removed) assert.equal(sheet.cells[address], undefined);
    assert.equal(sheet.rowCount, 8); assert.equal(sheet.columnCount, 8);
    assert.deepEqual(result.results[0].range, rectangle);
    assert.equal(result.results[0].write.changedCount > 0, true);
  }
});

test('formats, validation rules and comment identities move with the cell rather than remain in the gap', () => {
  const cell = { value: '5', format: { bold: true, background: '#ffeeaa' }, validation: { type: 'number', min: 0, max: 10 } };
  const workbook = workbookWith({}, { cells: { B3: cell }, comments: { B3: { id: 'comment-1', text: 'Keep this comment' } } });
  const inserted = run(workbook, insert());
  assert.deepEqual(first(inserted).cells.B5, workbook.sheets[0].cells.B3);
  assert.deepEqual(first(inserted).comments.B5, workbook.sheets[0].comments.B3);
  assert.equal(first(inserted).comments.B3, undefined);
  const deleted = run(inserted.workbook, remove());
  assert.deepEqual(first(deleted).cells.B3, workbook.sheets[0].cells.B3);
  assert.equal(first(deleted).comments.B3.id, 'comment-1');
  assert.equal(first(deleted).comments.B5, undefined);
  assert.equal(serializeWorkbook(parseWorkbook(serializeWorkbook(deleted.workbook))), serializeWorkbook(deleted.workbook));
});

test('formula references follow shifted cells across sheets, preserve absolutes, and produce REF for deleted targets', () => {
  const summary = { id: 'summary', name: 'Summary', rowCount: 8, columnCount: 8,
    cells: { A1: { value: '=Data!$B$3+Data!E3' }, A2: { value: '=SUM(Data!B3:D4)' } } };
  const workbook = workbookWith({ B3: '5', D4: '7', E3: '9', B5: '=B3+$D$4', H1: '=B3+E3' }, {}, [summary]);
  const inserted = run(workbook, insert());
  assert.equal(value(first(inserted), 'B7'), '=B5+$D$6');
  assert.equal(value(first(inserted), 'H1'), '=B5+E3');
  assert.equal(inserted.workbook.sheets[1].cells.A1.value, '=Data!$B$5+Data!E3');
  assert.equal(inserted.workbook.sheets[1].cells.A2.value, '=SUM(Data!B5:D6)');
  const deleted = run(workbook, remove());
  assert.equal(value(first(deleted), 'B3'), '=#REF!+#REF!');
  assert.equal(value(first(deleted), 'H1'), '=#REF!+E3');
  assert.equal(deleted.workbook.sheets[1].cells.A1.value, '=#REF!+Data!E3');
  assert.equal(deleted.workbook.sheets[1].cells.A2.value, '=SUM(#REF!)');
});

test('blank capacity is reused and insertion grows only when displaced data needs more room', () => {
  for (const [command, values, address, expectedRows, expectedColumns] of [
    [insert(), { B8: 'edge' }, 'B10', 10, 8],
    [insert('B3:D4', 'right'), { H3: 'edge' }, 'K3', 8, 11],
    [insert(), { B3: 'inside' }, 'B5', 8, 8],
    [insert('B3:D4', 'right'), { B3: 'inside' }, 'E3', 8, 8],
  ]) {
    const result = run(workbookWith(values), command);
    assert.equal(value(first(result), address), Object.values(values)[0]);
    assert.equal(first(result).rowCount, expectedRows); assert.equal(first(result).columnCount, expectedColumns);
  }
});

test('capacity overflow fails atomically instead of dropping the last occupied row', () => {
  const workbook = workbookWith({ [`B${SPREADSHEET_LIMITS.rows}`]: 'last value' }, { rowCount: SPREADSHEET_LIMITS.rows });
  const before = serializeWorkbook(workbook);
  const result = apply(workbook, [{ type: 'cells.set', sheetId, values: { A1: 'do not commit' } }, insert()]);
  assert.equal(result.ok, false); assert.equal(result.commandIndex, 1);
  assert.equal('workbook' in result, false); assert.equal('results' in result, false);
  assert.equal(serializeWorkbook(workbook), before);
});

test('whole-contained merged cells and named ranges follow a partial shift without losing identity', () => {
  const workbook = workbookWith({ B3: 'merged' }, { merges: [{ top: 2, left: 1, bottom: 2, right: 2 }] });
  const named = run(workbook, { type: 'namedRanges.add', sheetId, name: 'DataBlock', range: 'B3:C4' }).workbook;
  const shifted = run(named, insert());
  assert.deepEqual(first(shifted).merges, [{ top: 4, left: 1, bottom: 4, right: 2 }]);
  assert.equal(shifted.workbook.namedRanges[0].id, named.namedRanges[0].id);
  assert.deepEqual(shifted.workbook.namedRanges[0].range, { top: 4, left: 1, bottom: 5, right: 2 });
  const restored = run(shifted.workbook, remove());
  assert.deepEqual(first(restored).merges, named.sheets[0].merges);
  assert.deepEqual(restored.workbook.namedRanges, named.namedRanges);
});

test('unsafe partial shifts through merges, named rectangles and tables reject the complete batch', () => {
  const merged = workbookWith({ A3: 'merged' }, { merges: [{ top: 2, left: 0, bottom: 2, right: 2 }] });
  const named = run(workbookWith({ A3: 'named' }), { type: 'namedRanges.add', sheetId, name: 'Block', range: 'A3:C5' }).workbook;
  const table = run(workbookWith({}), { type: 'tables.insert', sheetId, name: 'Orders', target: { row: 2, column: 0 },
    headers: ['Item', 'Count', 'Cost'], data: { type: 'rows', values: [['One', '1', '10'], ['Two', '2', '20']] } }).workbook;
  for (const workbook of [merged, named, table]) for (const command of [insert(), remove()]) {
    const before = serializeWorkbook(workbook);
    const result = apply(workbook, [{ type: 'cells.set', sheetId, values: { H1: 'do not commit' } }, command]);
    assert.equal(result.ok, false); assert.equal(result.commandIndex, 1);
    assert.equal('workbook' in result, false); assert.equal('results' in result, false);
    assert.equal(serializeWorkbook(workbook), before);
  }
});

test('shift is strictly validated, required on insert, and optional only for legacy delete', () => {
  const workbook = workbookWith({ B3: 'keep' });
  const invalid = [
    { type: 'cells.insert', sheetId, range: 'B3:D4' },
    ...['up', 'left', '', null, false, 0].map(shift => insert('B3:D4', shift)),
    ...['down', 'right', '', null, false, 0].map(shift => remove('B3:D4', shift)),
    insert('B0:D4'), insert('Missing!B3:D4'), insert({ ...rectangle, top: -1 }),
    { ...insert(), unexpected: true },
  ];
  for (const command of invalid) {
    const result = apply(workbook, [command]);
    assert.equal(result.ok, false, JSON.stringify(command)); assert.equal(result.commandIndex, 0);
    assert.equal('workbook' in result, false);
  }
  assert.equal(value(workbook.sheets[0], 'B3'), 'keep');
});

test('new structural feature flags and parent flag reject shifts independently of formatting', () => {
  const workbook = workbookWith({ B3: 'remove', B5: 'move' });
  for (const [command, key] of [[insert(), 'insertCells'], [remove(), 'deleteCells']]) {
    assert.equal(apply(workbook, [command], { features: { formatting: false } }).ok, true);
    for (const features of [{ [key]: false }, { rowColumnOperations: false, [key]: true }]) {
      const result = apply(workbook, [command], { features });
      assert.equal(result.ok, false); assert.equal(result.code, 'FEATURE_DISABLED'); assert.equal(result.commandIndex, 0);
    }
  }
  assert.equal(apply(workbook, [insert()], { features: { deleteCells: false } }).ok, true);
  assert.equal(apply(workbook, [remove()], { features: { insertCells: false } }).ok, true);
});

test('deletion without shift keeps its legacy clear-all contract and never moves neighboring values', () => {
  const workbook = workbookWith({}, { cells: { B3: { value: 'clear', format: { bold: true } }, B5: { value: 'keep' } } });
  const command = { type: 'cells.delete', sheetId, range: 'B3:D4' };
  const result = apply(workbook, [command], { features: { deleteCells: false, rowColumnOperations: false } });
  assert.equal(result.ok, true); assert.equal(first(result).cells.B3, undefined);
  assert.equal(value(first(result), 'B5'), 'keep'); assert.equal(first(result).rowCount, 8);
  assert.equal(apply(workbook, [command], { features: { formatting: false } }).code, 'FEATURE_DISABLED');
});

test('headless sessions record each cell shift as one transaction and preserve complete snapshots through undo and redo', () => {
  const initial = workbookWith({ B3: 'A', D4: 'B', H8: 'unrelated' });
  const session = createSpreadsheetSession(initial);
  const before = serializeWorkbook(session.getWorkbook());
  const inserted = session.execute(insert());
  assert.equal(inserted.ok, true); assert.equal(session.getHistoryState().undoCount, 1);
  const afterInsert = serializeWorkbook(session.getWorkbook());
  assert.equal(session.undo(), true); assert.equal(serializeWorkbook(session.getWorkbook()), before);
  assert.equal(session.redo(), true); assert.equal(serializeWorkbook(session.getWorkbook()), afterInsert);
  const deleted = session.execute(remove());
  assert.equal(deleted.ok, true); assert.equal(session.getHistoryState().undoCount, 2);
  assert.equal(serializeWorkbook(session.getWorkbook()), before);
  assert.equal(session.undo(), true); assert.equal(serializeWorkbook(session.getWorkbook()), afterInsert);
  assert.equal(session.redo(), true); assert.equal(serializeWorkbook(session.getWorkbook()), before);
});

test('an async custom menu result cannot target stale coordinates after a shift that leaves dimensions unchanged', async t => {
  const { act, createElement, createRef } = await import('react');
  const { create } = await import('react-test-renderer');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
    plugins: [{ name: 'shared-react', setup(builder) {
      builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    } }],
  });
  const { default: Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  for (const command of [insert(), remove()]) {
    let resolve, renderer;
    const pending = new Promise(done => { resolve = done; });
    const ref = createRef(), events = [];
    const view = { addEventListener() {}, removeEventListener() {} };
    await act(async () => { renderer = create(createElement(Spreadsheet, {
      ref, initialWorkbook: workbookWith({ B3: 'current', B5: 'following' }), onSave() {},
      contextMenuExecutionMode: 'confirm', onEvent: event => events.push(event),
      getContextMenuItems: () => [{ id: 'async-result', label: '結果を挿入', onSelect: () => pending }],
    }), { createNodeMock: element => element.type === 'section' ? { ownerDocument: { defaultView: view } } : null }); });
    t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
    const cell = { dataset: { lxsRow: '2', lxsColumn: '1' }, closest: selector => selector.startsWith('[data-lxs-row]') ? cell : null };
    await act(async () => renderer.root.findByType('section').props.onContextMenu({
      target: cell, clientX: 100, clientY: 100, preventDefault() {},
    }));
    await act(async () => renderer.root.findAllByProps({ role: 'menuitem' }).find(item => item.findAllByType('span').length).props.onClick());
    let shifted;
    await act(async () => { shifted = ref.current.execute(command); });
    assert.equal(shifted.ok, true);
    assert.equal(ref.current.getWorkbook().sheets[0].rowCount, 8);
    assert.equal(ref.current.getWorkbook().sheets[0].columnCount, 8);
    await act(async () => resolve({ change: [{ type: 'cells.set', sheetId, values: { B3: 'stale result' } }] }));
    assert.notEqual(value(ref.current.getWorkbook().sheets[0], 'B3'), 'stale result');
    assert.equal(renderer.root.findAllByProps({ role: 'alertdialog' }).length, 0);
    assert.ok(events.some(event => event.type === 'context-menu' && event.status === 'error'));
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: [new URL('../src/model/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false });
const model = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { normalizeWorkbook, createWorkbook, mergeCells, unmergeCells, setCellValue, setCellValues,
  setCellComment, setCellComments, formatCells, insertRows, deleteRows, insertColumns, deleteColumns,
  addSheet, moveCells, serializeWorkbook, parseWorkbook, workbooksEqual, getMergedRange,
  mergedCellPosition, expandRangeForMerges, rangesIntersect, rangeContains, calculateWorkbook, SPREADSHEET_LIMITS } = model;
const rect = (top, left, bottom, right) => ({ top, left, bottom, right });
const id = workbook => workbook.sheets[0].id;
const sheet = workbook => workbook.sheets[0];
const filled = (values = {}) => { const wb = createWorkbook(); return setCellValues(wb, id(wb), values); };
const input = (merges, cells = {}, comments) => ({ sheets: [{ id: 's', name: 'Data', rowCount: 20,
  columnCount: 20, cells, ...(comments ? { comments } : {}), merges }] });

test('merged ranges normalize, sort, clone, freeze and roundtrip without altering legacy workbooks', () => {
  const source = input([rect(4, 2, 6, 3), rect(0, 0, 0, 2)], { A1: { value: 'Heading' }, B1: { value: '', format: { bold: true } } });
  const wb = normalizeWorkbook(source), merges = sheet(wb).merges;
  assert.deepEqual(merges, [rect(0, 0, 0, 2), rect(4, 2, 6, 3)]);
  source.sheets[0].merges[0].top = 10;
  assert.equal(merges[1].top, 4); assert.ok(Object.isFrozen(merges)); assert.ok(Object.isFrozen(merges[0]));
  assert.ok(workbooksEqual(wb, parseWorkbook(serializeWorkbook(wb))));
  assert.deepEqual(sheet(normalizeWorkbook(input([]))).merges, undefined);
  assert.ok(workbooksEqual(createWorkbook(), normalizeWorkbook({ sheets: createWorkbook().sheets })));
  assert.equal(workbooksEqual(wb, normalizeWorkbook(input([rect(0, 0, 0, 2)]))), false);
  assert.equal(workbooksEqual(createWorkbook(), { ...createWorkbook(), sheets: [{ ...sheet(createWorkbook()), merges: [] }] }), true);
});

test('invalid, overlapping, single-cell and excessive merges are rejected at the host boundary', () => {
  for (const merges of [null, {}, [null], new Array(1), [rect(0, 0, 0, 0)], [rect(2, 0, 1, 1)], [rect(-1, 0, 1, 1)],
    [rect(0, 0, 20, 1)], [rect(0, 0, 1, 20)], [rect(0, 0.5, 1, 1)], [rect(0, 0, 1, Infinity)],
    [rect(0, 0, 1, 1), rect(1, 1, 2, 2)], [rect(0, 0, 1, 1), rect(0, 0, 1, 1)],
    Array.from({ length: SPREADSHEET_LIMITS.merges + 1 }, () => rect(0, 0, 0, 1))])
    assert.throws(() => normalizeWorkbook(input(merges)));
  const merges = Array.from({ length: 501 }, (_, i) => rect(i, 0, i, 1));
  const base = { ...input(merges).sheets[0], rowCount: 1000 };
  assert.throws(() => normalizeWorkbook({ sheets: [base, { ...base, id: 'other', name: 'Other' }] }), /上限/);
});

test('incoming covered values and comments are rejected, while hidden formatting is retained', () => {
  const merges = [rect(0, 0, 1, 1)];
  assert.throws(() => normalizeWorkbook(input(merges, { B2: { value: 'would disappear' } })), /左上/);
  assert.throws(() => normalizeWorkbook(input(merges, {}, { B1: { id: 'hidden', text: 'Note' } })), /左上/);
  const wb = normalizeWorkbook(input(merges, { B2: { value: '', format: { background: '#abc' } } }, { A1: { id: 'note', text: 'Visible' } }));
  assert.equal(sheet(wb).cells.B2.format.background, '#abc'); assert.equal(sheet(wb).comments.A1.text, 'Visible');
});

test('merge keeps the top-left content and requires explicit consent for every covered value or comment', () => {
  let wb = filled({ A1: 'keep', B1: 'remove', C3: 'outside' });
  wb = formatCells(wb, id(wb), ['A1', 'B1'], { bold: true });
  wb = setCellComment(wb, id(wb), 'A1', { id: 'keep-note', text: 'Keep' });
  wb = setCellComment(wb, id(wb), 'B2', { id: 'remove-note', text: 'Remove' });
  const snapshot = serializeWorkbook(wb);
  assert.throws(() => mergeCells(wb, id(wb), rect(0, 0, 1, 1)), /失われ/);
  assert.throws(() => mergeCells(wb, id(wb), rect(0, 0, 1, 1), { discardValues: 'false' }), /true/);
  assert.equal(serializeWorkbook(wb), snapshot, 'failed merge is atomic');
  const merged = mergeCells(wb, id(wb), rect(0, 0, 1, 1), { discardValues: true });
  assert.equal(sheet(merged).cells.A1.value, 'keep'); assert.equal(sheet(merged).cells.C3.value, 'outside');
  assert.deepEqual(sheet(merged).cells.B1, { value: '', format: { bold: true } });
  assert.deepEqual(Object.keys(sheet(merged).comments), ['A1']);
  assert.equal(mergeCells(merged, id(merged), rect(0, 0, 1, 1)), merged, 'exact repeated merge is a no-op');
  assert.ok(workbooksEqual(normalizeWorkbook(merged), merged));
  const onlyComment = setCellComment(filled(), id(wb), 'B1', { id: 'comment-only', text: 'Important' });
  assert.throws(() => mergeCells(onlyComment, id(wb), rect(0, 0, 0, 1)), /失われ/);
});

test('merge replaces contained ranges but refuses partial intersections; unmerge retains anchor and hidden formatting', () => {
  const wb = mergeCells(filled({ B1: 'Existing anchor' }), 'sheet-1', rect(0, 1, 1, 2));
  assert.throws(() => mergeCells(wb, id(wb), rect(1, 0, 2, 2), { discardValues: true }), /一部分/);
  assert.throws(() => mergeCells(wb, id(wb), rect(0, 0, 2, 2)), /失われ/);
  const larger = mergeCells(wb, id(wb), rect(0, 0, 2, 2), { discardValues: true });
  assert.deepEqual(sheet(larger).merges, [rect(0, 0, 2, 2)]); assert.equal(sheet(larger).cells.B1, undefined);
  const formatted = formatCells(setCellValue(larger, id(wb), 'A1', 'Keep'), id(wb), ['B2'], { italic: true });
  const unmerged = unmergeCells(formatted, id(wb), rect(1, 1, 1, 1));
  assert.equal(sheet(unmerged).merges, undefined); assert.equal(sheet(unmerged).cells.A1.value, 'Keep');
  assert.deepEqual(sheet(unmerged).cells.B2, { value: '', format: { italic: true } });
  assert.equal(unmergeCells(unmerged, id(wb), rect(0, 0, 3, 3)), unmerged);
});

test('merged coordinate helpers resolve anchors and expand chained intersections to a fixed point', () => {
  const wb = normalizeWorkbook(input([rect(0, 0, 1, 1), rect(2, 2, 3, 3), rect(3, 1, 5, 1)]));
  assert.deepEqual(getMergedRange(sheet(wb), { row: 1, column: 1 }), rect(0, 0, 1, 1));
  assert.equal(getMergedRange(sheet(wb), { row: 6, column: 1 }), undefined);
  assert.deepEqual(mergedCellPosition(sheet(wb), { row: 1, column: 1 }), { row: 0, column: 0 });
  assert.deepEqual(mergedCellPosition(sheet(wb), { row: 6, column: 1 }), { row: 6, column: 1 });
  assert.deepEqual(expandRangeForMerges(sheet(wb), rect(1, 1, 2, 2)), rect(0, 0, 5, 3));
  assert.equal(rangesIntersect(rect(0, 0, 1, 1), rect(2, 0, 3, 1)), false);
  assert.equal(rangeContains(rect(0, 0, 5, 3), rect(2, 2, 3, 3)), true);
});

test('single-cell value/comment edits resolve the anchor; bulk nonempty covered writes reject atomically', () => {
  let wb = mergeCells(filled({ A1: 'old' }), 'sheet-1', rect(0, 0, 1, 1));
  wb = setCellValue(wb, id(wb), '$b$2', 'new'); assert.equal(sheet(wb).cells.A1.value, 'new');
  assert.equal(sheet(wb).cells.B2, undefined);
  wb = setCellComment(wb, id(wb), 'B1', { id: 'note', text: 'Anchor note' });
  assert.equal(sheet(wb).comments.A1.text, 'Anchor note'); assert.equal(sheet(wb).comments.B1, undefined);
  assert.throws(() => setCellValues(wb, id(wb), { A1: 'would change', B2: 'bad' }), /左上/);
  assert.throws(() => setCellComments(wb, id(wb), { A1: null, B1: { id: 'bad', text: 'Bad' } }), /左上/);
  assert.equal(sheet(wb).cells.A1.value, 'new'); assert.equal(sheet(wb).comments.A1.text, 'Anchor note');
  const unchanged = setCellValues(wb, id(wb), { B1: '', B2: '' }); assert.equal(unchanged, wb);
  const cleared = setCellValue(setCellComment(wb, id(wb), 'B2', null), id(wb), 'B2', '');
  assert.equal(sheet(cleared).cells.A1, undefined); assert.deepEqual(sheet(cleared).comments, {});
});

test('formulas reference the anchor explicitly; covered cells remain blank rather than duplicate the value', () => {
  let wb = mergeCells(filled({ A1: '12' }), 'sheet-1', rect(0, 0, 1, 1));
  wb = setCellValues(wb, id(wb), { C1: '=SUM(A1:B2)', C2: '=B2+1' });
  const values = calculateWorkbook(wb)[id(wb)]; assert.equal(values.C1, 12); assert.equal(values.C2, 1);
});

test('inserting rows/columns before a merge shifts it, and inserting within it expands it', () => {
  const wb = mergeCells(filled({ B2: 'anchor' }), 'sheet-1', rect(1, 1, 3, 3));
  const rowBefore = insertRows(wb, id(wb), 1, 2);
  assert.deepEqual(sheet(rowBefore).merges, [rect(3, 1, 5, 3)]); assert.equal(sheet(rowBefore).cells.B4.value, 'anchor');
  const rowInside = insertRows(wb, id(wb), 2, 2);
  assert.deepEqual(sheet(rowInside).merges, [rect(1, 1, 5, 3)]); assert.equal(sheet(rowInside).cells.B2.value, 'anchor');
  const columnBefore = insertColumns(wb, id(wb), 1);
  assert.deepEqual(sheet(columnBefore).merges, [rect(1, 2, 3, 4)]); assert.equal(sheet(columnBefore).cells.C2.value, 'anchor');
  const columnInside = insertColumns(wb, id(wb), 3, 2);
  assert.deepEqual(sheet(columnInside).merges, [rect(1, 1, 3, 5)]);
  assert.ok(workbooksEqual(normalizeWorkbook(columnInside), columnInside));
});

test('deletion contracts/removes merges; deleting the anchor row/column removes its content normally', () => {
  let wb = mergeCells(filled({ B2: 'anchor' }), 'sheet-1', rect(1, 1, 3, 3));
  wb = setCellComment(wb, id(wb), 'B2', { id: 'note', text: 'Anchor note' });
  const inside = deleteRows(wb, id(wb), 2);
  assert.deepEqual(sheet(inside).merges, [rect(1, 1, 2, 3)]); assert.equal(sheet(inside).cells.B2.value, 'anchor');
  const anchorRow = deleteRows(wb, id(wb), 1);
  assert.deepEqual(sheet(anchorRow).merges, [rect(1, 1, 2, 3)]);
  assert.equal(sheet(anchorRow).cells.B2, undefined); assert.equal(sheet(anchorRow).comments.B2, undefined);
  const anchorColumn = deleteColumns(wb, id(wb), 1);
  assert.deepEqual(sheet(anchorColumn).merges, [rect(1, 1, 3, 2)]); assert.equal(sheet(anchorColumn).cells.B2, undefined);
  assert.equal(sheet(deleteRows(wb, id(wb), 1, 3)).merges, undefined);
  const horizontal = mergeCells(filled({ A1: 'keep' }), 'sheet-1', rect(0, 0, 0, 1));
  const single = deleteColumns(horizontal, id(horizontal), 1);
  assert.equal(sheet(single).merges, undefined); assert.equal(sheet(single).cells.A1.value, 'keep');
});

test('full merged cut moves geometry, formatting, comments and dependent references across sheets', () => {
  let wb = addSheet(mergeCells(filled({ B2: '12', F1: '=B2' }), 'sheet-1', rect(1, 1, 2, 2)), 'Target');
  wb = formatCells(wb, id(wb), ['C3'], { background: '#abc' });
  wb = setCellComment(wb, id(wb), 'B2', { id: 'note', text: 'Move me' });
  const targetId = wb.sheets[1].id;
  const moved = moveCells(wb, { sheetId: id(wb), ...rect(1, 1, 2, 2) }, { sheetId: targetId, row: 4, column: 3 });
  assert.equal(sheet(moved).merges, undefined); assert.equal(sheet(moved).cells.B2, undefined);
  assert.deepEqual(moved.sheets[1].merges, [rect(4, 3, 5, 4)]);
  assert.equal(moved.sheets[1].cells.D5.value, '12'); assert.equal(moved.sheets[1].cells.E6.format.background, '#abc');
  assert.equal(moved.sheets[1].comments.D5.text, 'Move me'); assert.equal(sheet(moved).cells.F1.value, "='Target'!D5");
  assert.ok(workbooksEqual(normalizeWorkbook(moved), moved));
});

test('partial source/destination cuts fail atomically and full destination merges are replaced', () => {
  let wb = mergeCells(filled({ A1: 'from', D1: 'to' }), 'sheet-1', rect(0, 0, 1, 1));
  wb = mergeCells(wb, id(wb), rect(0, 3, 1, 4));
  const original = serializeWorkbook(wb);
  assert.throws(() => moveCells(wb, { sheetId: id(wb), ...rect(0, 0, 0, 1) }, { sheetId: id(wb), row: 3, column: 3 }), /一部分/);
  assert.throws(() => moveCells(wb, { sheetId: id(wb), ...rect(0, 0, 1, 1) }, { sheetId: id(wb), row: 1, column: 3 }), /一部分/);
  assert.equal(serializeWorkbook(wb), original);
  const replaced = moveCells(wb, { sheetId: id(wb), ...rect(0, 0, 1, 1) }, { sheetId: id(wb), row: 0, column: 3 });
  assert.deepEqual(sheet(replaced).merges, [rect(0, 3, 1, 4)]); assert.equal(sheet(replaced).cells.D1.value, 'from');
});

test('overlapping cut removes source geometry first, so a full merged cell can move one row or column', () => {
  let wb = mergeCells(filled({ A1: 'anchor', D4: '=A1' }), 'sheet-1', rect(0, 0, 1, 1));
  const original = serializeWorkbook(wb);
  wb = moveCells(wb, { sheetId: id(wb), ...rect(0, 0, 1, 1) }, { sheetId: id(wb), row: 1, column: 1 });
  assert.deepEqual(sheet(wb).merges, [rect(1, 1, 2, 2)]); assert.equal(sheet(wb).cells.B2.value, 'anchor');
  assert.equal(sheet(wb).cells.A1, undefined); assert.equal(sheet(wb).cells.D4.value, '=B2');
  assert.ok(workbooksEqual(normalizeWorkbook(wb), wb)); assert.notEqual(serializeWorkbook(wb), original);
  assert.equal(moveCells(wb, { sheetId: id(wb), ...rect(1, 1, 2, 2) }, { sheetId: id(wb), row: 1, column: 1 }), wb);
});

test('moving unmerged cells over a fully covered merge removes old geometry and retains all new values', () => {
  let wb = mergeCells(filled({ A1: '1', B1: '2', A2: '3', B2: '4', D4: 'old merge' }), 'sheet-1', rect(3, 3, 4, 4));
  wb = moveCells(wb, { sheetId: id(wb), ...rect(0, 0, 1, 1) }, { sheetId: id(wb), row: 3, column: 3 });
  assert.equal(sheet(wb).merges, undefined);
  assert.deepEqual(['D4', 'E4', 'D5', 'E5'].map(address => sheet(wb).cells[address].value), ['1', '2', '3', '4']);
  assert.ok(workbooksEqual(normalizeWorkbook(wb), wb));
});

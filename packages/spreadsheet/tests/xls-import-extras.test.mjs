import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { xls, record, R, u16, u32, f64, str, shortStr, noCch, number, labelSst, sst, defaultFont, defaultFormats } from './xls-fixture.mjs';

const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXls } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-extras-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXls: importModel } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const base = [defaultFont(), ...defaultFormats()];
const importSheet = (records, globals = base) => importModel(xls({ globals, sheets: [{ name: 'Sheet1', records }] }), measured);
const messages = result => result.warnings.map(warning => warning.message);
const int = value => [0x1e, ...u16(value)], text = value => [0x17, ...shortStr(value)];
const selfLinks = [record(R.SUPBOOK, u16(1), u16(0x0401)), record(R.EXTERNSHEET, u16(1), u16(0), u16(0), u16(0))];
const area3d = (firstRow, lastRow, firstColumn, lastColumn) => [0x3b, ...u16(0), ...u16(firstRow), ...u16(lastRow), ...u16(firstColumn), ...u16(lastColumn)];
const builtinName = (code, tokens, { hidden = false } = {}) => record(R.NAME, u16(0x20 | (hidden ? 1 : 0)), 0, 1, u16(tokens.length), u16(0), u16(1), 0, 0, 0, 0, 0, code, tokens);

/** DV record: flags, four strings (a lone NUL means empty), two expressions and the target ranges. */
function validation(flags, { first = [], second = [], error = '', ranges = [[0, 0, 0, 0]] } = {}) {
  const empty = str('\u0000');
  return record(R.DV, u32(flags), empty, empty, empty, error ? str(error) : empty, u16(first.length), u16(0), first, u16(second.length), u16(0), second,
    u16(ranges.length), ...ranges.flatMap(([firstRow, lastRow, firstColumn, lastColumn]) => [...u16(firstRow), ...u16(lastRow), ...u16(firstColumn), ...u16(lastColumn)]));
}
const SHOW_ERROR = 0x80000, ALLOW_BLANK = 0x100;

test('list, number and date rules are imported with their ranges and messages', async () => {
  const records = [
    validation(3 | 0x80 | ALLOW_BLANK | SHOW_ERROR, { first: text('未着手\u0000進行中\u0000完了'), error: '一覧から選んでください', ranges: [[0, 2, 0, 0]] }),
    validation(1 | ALLOW_BLANK | SHOW_ERROR, { first: int(1), second: int(10), ranges: [[0, 0, 1, 1], [2, 2, 1, 1]] }),
    validation(4 | 6 << 20 | ALLOW_BLANK | SHOW_ERROR, { first: [0x1f, ...f64(45292)], ranges: [[0, 0, 2, 2]] }),
  ];
  const result = await importSheet(records);
  const { A1, A3, B1, B3, C1 } = result.workbook.sheets[0].cells;
  assert.deepEqual(A1.validation, { type: 'list', values: ['未着手', '進行中', '完了'], allowBlank: true, message: '一覧から選んでください' });
  assert.deepEqual(A3.validation, A1.validation);
  assert.deepEqual([B1.validation.type, B1.validation.integer, B1.validation.min, B1.validation.max], ['number', true, 1, 10]);
  assert.deepEqual(B3.validation, B1.validation);
  assert.deepEqual([C1.validation.type, C1.validation.min], ['date', '2024-01-01']);
  assert.deepEqual(messages(result), []);
});

test('rules the model cannot enforce are omitted with the XLSX wording', async () => {
  const result = await importSheet([validation(1 | 1 << 4 | SHOW_ERROR, { first: int(1), second: int(5) }), validation(7 | SHOW_ERROR, { first: [0x1d, 1], ranges: [[1, 1, 0, 0]] }),
    validation(1, { first: int(1), second: int(5), ranges: [[2, 2, 0, 0]] })]);
  assert.equal(result.workbook.sheets[0].cells.A1?.validation, undefined);
  assert.equal(messages(result).length, 3);
  assert.ok(messages(result).every(message => /^入力規則「A[123]」を省略しました（未対応の入力規則/.test(message)));
});

/** AUTOFILTER record: column, flags, two ten-byte criteria, then the strings they announce. */
function filterColumn(column, flags, one, two = { type: 0 }) {
  const operand = ({ type = 0, sign = 0, text: value, number: numeric }) => type === 6 ? [6, sign, 0, 0, 0, 0, value.length, 0, 0, 0] : type === 4 ? [4, sign, ...f64(numeric)] : [type, sign, 0, 0, 0, 0, 0, 0, 0, 0];
  return record(R.AUTOFILTER, u16(column), u16(flags), operand(one), operand(two), ...[one, two].filter(item => item.type === 6).flatMap(item => noCch(item.text)));
}
const filterGlobals = [...base, ...selfLinks, builtinName(13, area3d(0, 3, 0, 1), { hidden: true }), sst(['Status', 'open', 'done'])];
const filterCells = [labelSst(0, 0, 0), labelSst(0, 1, 0), labelSst(1, 0, 1), number(1, 1, 5), labelSst(2, 0, 2), number(2, 1, 50), labelSst(3, 0, 1), number(3, 1, 500)];

test('an auto-filter range and a value chosen from the list are imported', async () => {
  const result = await importSheet([...filterCells, record(R.AUTOFILTERINFO, u16(2)), filterColumn(0, 0x04, { type: 6, sign: 2, text: 'open' })], filterGlobals);
  assert.deepEqual(result.workbook.sheets[0].autoFilter, { range: { top: 0, left: 0, bottom: 3, right: 1 }, columns: [{ column: 0, values: ['open'] }] });
  assert.deepEqual(messages(result), []);
});

test('blank-only filters are kept; comparisons and top-N are omitted per column as for XLSX', async () => {
  const blank = await importSheet([...filterCells, record(R.AUTOFILTERINFO, u16(2)), filterColumn(1, 0, { type: 0x0c })], filterGlobals);
  assert.deepEqual(blank.workbook.sheets[0].autoFilter.columns, [{ column: 1, values: [''] }]);
  const result = await importSheet([...filterCells, record(R.AUTOFILTERINFO, u16(2)),
    filterColumn(0, 0x10 | 10 << 7, { type: 4, sign: 6, number: 1 }), filterColumn(1, 0, { type: 4, sign: 4, number: 10 }, { type: 4, sign: 1, number: 100 })], filterGlobals);
  assert.deepEqual(result.workbook.sheets[0].autoFilter, { range: { top: 0, left: 0, bottom: 3, right: 1 } });
  assert.deepEqual(result.warnings.map(({ message, count }) => [message, count]), [['未対応のフィルター条件（日付グループ・比較式・上位件数・色など）を列単位で省略しました', 2]]);
});

test('a filter without its range name is reported instead of guessed', async () => {
  const result = await importSheet([...filterCells, record(R.AUTOFILTERINFO, u16(2))], [...base, sst(['Status', 'open', 'done'])]);
  assert.equal(result.workbook.sheets[0].autoFilter, undefined);
  assert.deepEqual(result.warnings, [{ code: 'omitted', sheetName: 'Sheet1', message: '範囲を特定できないフィルターを省略しました', count: 1 }]);
});

test('paper, orientation, scale, margins and manual page breaks become print settings', async () => {
  const setup = record(R.SETUP, u16(8), u16(80), u16(1), u16(1), u16(1), u16(0), u16(600), u16(600), f64(0.3), f64(0.3), u16(1));
  const records = [number(0, 0, 1), record(R.LEFTMARGIN, f64(0.5)), record(R.RIGHTMARGIN, f64(0.5)), record(R.TOPMARGIN, f64(1)), record(R.BOTTOMMARGIN, f64(1)), setup,
    record(R.HORIZONTALPAGEBREAKS, u16(2), u16(5), u16(0), u16(255), u16(9), u16(0), u16(255)), record(R.VERTICALPAGEBREAKS, u16(1), u16(3), u16(0), u16(65535))];
  const result = await importSheet(records);
  const settings = result.workbook.sheets[0].printSettings;
  assert.deepEqual([settings.paperSize, settings.orientation, settings.scale], ['A3', 'landscape', 80]);
  assert.deepEqual([settings.rowBreaks, settings.columnBreaks], [[5, 9], [3]]);
  assert.deepEqual(settings.margins, { top: 1, bottom: 1, left: 0.5, right: 0.5 });
  assert.deepEqual(messages(result), []);
});

test('print fields without printer data are not invented, and fit-to-page is reported', async () => {
  const noPrinter = record(R.SETUP, u16(0), u16(255), u16(1), u16(1), u16(1), u16(0x04), u16(0), u16(0), f64(0.5), f64(0.5), u16(1));
  const plain = await importSheet([number(0, 0, 1), noPrinter]);
  assert.equal(plain.workbook.sheets[0].printSettings?.scale, undefined);
  assert.equal(plain.workbook.sheets[0].printSettings?.orientation, undefined);
  const portrait = record(R.SETUP, u16(1), u16(100), u16(1), u16(1), u16(0), u16(0x02), u16(600), u16(600), f64(0.5), f64(0.5), u16(1));
  const fitted = await importSheet([number(0, 0, 1), record(R.WSBOOL, u16(0x05c1)), portrait]);
  // Portrait and 100% are the model defaults, so only the Letter paper is stored.
  assert.deepEqual(fitted.workbook.sheets[0].printSettings, { paperSize: 'Letter' });
  assert.deepEqual(messages(fitted), ['指定ページ数に収める印刷倍率は未対応のため固定倍率で表示します']);
});

/** A cell note: the anchor object, its text object and the NOTE record that ties them to a cell. */
function note(row, column, id, body, author) {
  const object = record(R.OBJ, u16(0x15), u16(0x12), u16(0x19), u16(id), u16(0x4011), ...new Array(12).fill(0), u16(0), u16(0));
  const wide = [...body].some(character => character.charCodeAt(0) > 255);
  const textObject = [record(R.TXO, u16(0x0212), u16(0), 0, 0, 0, 0, 0, 0, u16(body.length), u16(16), u16(0), u16(0)), record(R.CONTINUE, noCch(body, wide)), record(R.CONTINUE, new Array(16).fill(0))];
  return { objects: [record(R.MSODRAWING, 0, 0, 0, 0), object, ...textObject], note: record(R.NOTE, u16(row), u16(column), u16(0), u16(id), str(author), 0) };
}

test('cell notes are imported with their author and text', async () => {
  const first = note(0, 0, 1, '山田:\n確認してください', '山田'), second = note(2, 1, 2, 'Reviewer:\nLooks good', 'Reviewer');
  const result = await importSheet([number(0, 0, 1), number(2, 1, 2), ...first.objects, ...second.objects, first.note, second.note]);
  const comments = result.workbook.sheets[0].comments;
  assert.deepEqual(Object.fromEntries(Object.entries(comments).map(([address, comment]) => [address, [comment.author, comment.text]])),
    { A1: ['山田', '山田:\n確認してください'], B3: ['Reviewer', 'Reviewer:\nLooks good'] });
  assert.deepEqual(messages(result), []);
});

test('a long note split over several continuation records is joined', async () => {
  const object = record(R.OBJ, u16(0x15), u16(0x12), u16(0x19), u16(1), u16(0x4011), ...new Array(12).fill(0), u16(0), u16(0));
  const textObject = [record(R.TXO, u16(0x0212), u16(0), 0, 0, 0, 0, 0, 0, u16(11), u16(16), u16(0), u16(0)), record(R.CONTINUE, noCch('first ', false)), record(R.CONTINUE, noCch('日本語のメモ'.slice(0, 5), true)), record(R.CONTINUE, new Array(16).fill(0))];
  const result = await importSheet([number(0, 0, 1), record(R.MSODRAWING, 0, 0, 0, 0), object, ...textObject, record(R.NOTE, u16(0), u16(0), u16(0), u16(1), str('A'), 0)]);
  assert.equal(result.workbook.sheets[0].comments.A1.text, 'first 日本語のメ');
});

test('frozen panes, protection, conditional formats, hyperlinks and headers are reported as omitted', async () => {
  const records = [number(0, 0, 1), record(R.WINDOW2, u16(0x06be | 0x08), u16(0), u16(0), u16(0x40), u16(0), u16(0), u16(0), u16(0), u16(0)), record(R.PANE, u16(1), u16(2), u16(2), u16(1), 0),
    record(R.PROTECT, u16(1)), record(R.CONDFMT, u16(1), u16(0)), record(R.HLINK, u16(0), u16(0), u16(0), u16(0)), record(0x0014, str('&C Page &P'))];
  const result = await importSheet(records);
  for (const keyword of ['ウィンドウ枠の固定', 'シート保護', '条件付き書式', 'ハイパーリンク'])
    assert.ok(messages(result).some(message => message.includes(keyword) && message.includes('省略')), keyword);
  assert.equal(result.warnings.length, 5);
});

test('workbook protection is reported as for XLSX', async () => {
  const result = await importSheet([number(0, 0, 1)], [record(R.PROTECT, u16(1)), ...base]);
  assert.deepEqual(messages(result), ['ブック保護を省略しました']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { xls, record, R, bytes, u16, u32, str, cell, number, labelSst, sst, bof, eof, defaultFont, defaultFormats } from './xls-fixture.mjs';

const buildResult = await build({ stdin: { contents: `export { importSpreadsheetXls, importSpreadsheetXlsx } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-cells-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetXls: importModel } = await import(`data:text/javascript;base64,${Buffer.from(buildResult.outputFiles[0].text).toString('base64')}`);
// Measured digit metrics stand in for the browser, as the default sheet font of these files is not Calibri.
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const importSpreadsheetXls = (input, options) => importModel(input, { ...measured, ...options });
const values = sheet => Object.fromEntries(Object.entries(sheet.cells).map(([address, item]) => [address, item.value]));
const messages = result => result.warnings.map(warning => warning.message);
const base = [defaultFont(), ...defaultFormats()];
/** RK numbers pack an integer or the upper 30 bits of a double, optionally scaled by 100. */
const rkInteger = (value, scaled = false) => u32((value << 2) | 2 | (scaled ? 1 : 0));
const rkDouble = (value, scaled = false) => { const high = new DataView(new Float64Array([value]).buffer).getUint32(4, true); return u32((high & 0xfffffffc) | (scaled ? 1 : 0)); };

test('number, text, boolean, error and blank cells of every record type are imported', async () => {
  const records = [
    number(0, 0, 1.5), record(R.RK, cell(0, 1), rkInteger(42)), record(R.RK, cell(0, 2), rkInteger(1234, true)), record(R.RK, cell(0, 3), rkDouble(0.5)),
    record(R.RK, cell(0, 4), rkInteger(-7)), record(R.RK, cell(0, 5), rkDouble(250, true)),
    record(R.MULRK, u16(1), u16(0), u16(15), rkInteger(1), u16(15), rkInteger(2), u16(15), rkInteger(3), u16(2)),
    labelSst(2, 0, 0), labelSst(2, 1, 1), record(R.LABEL, cell(2, 2), str('inline')), record(R.LABEL, cell(2, 3), str('インライン')),
    record(R.BOOLERR, cell(3, 0), 1, 0), record(R.BOOLERR, cell(3, 1), 0, 0), record(R.BOOLERR, cell(3, 2), 0x07, 1), record(R.BOOLERR, cell(3, 3), 0x2a, 1),
    record(R.BLANK, cell(4, 0)), record(R.MULBLANK, u16(4), u16(1), u16(15), u16(15), u16(2)),
  ];
  const { workbook, warnings } = await importSpreadsheetXls(xls({ globals: [...base, sst(['plain', '日本語の文字列'])], sheets: [{ name: '売上', records }, { name: 'Empty' }] }));
  assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ['売上', 'Empty']);
  assert.deepEqual(values(workbook.sheets[0]), {
    A1: '1.5', B1: '42', C1: '12.34', D1: '0.5', E1: '-7', F1: '2.5', A2: '1', B2: '2', C2: '3',
    A3: 'plain', B3: '日本語の文字列', C3: 'inline', D3: 'インライン', A4: 'TRUE', B4: 'FALSE', C4: '#DIV/0!', D4: '#N/A',
  });
  assert.equal(workbook.sheets[0].cells.A3.format.numberFormat, 'text');
  assert.equal(workbook.sheets[0].cells.A1.format.fontFamily, 'Arial');
  assert.deepEqual(values(workbook.sheets[1]), {});
  assert.deepEqual(warnings, []);
  assert.ok(Object.isFrozen(warnings));
});

test('shared strings continue across records, switch character width and skip rich-text and phonetic data', async () => {
  const rich = bytes(u16(4), 0x08, u16(1), [...'bold'].map(c => c.charCodeAt(0)), u16(0), u16(1));
  const phonetic = bytes(u16(2), 0x05, u32(4), u16(0x65e5), u16(0x672c), 1, 2, 3, 4);
  // "continued text" is split after "contin"; the continuation restates its own character width.
  const first = bytes(u32(4), u32(4), rich, phonetic, u16(14), 0, [...'contin'].map(c => c.charCodeAt(0)));
  const second = bytes(1, [...'ued text'].flatMap(c => u16(c.charCodeAt(0))), str('last'));
  const globals = [...base, record(R.SST, first), record(R.CONTINUE, second)];
  const { workbook } = await importSpreadsheetXls(xls({ globals, sheets: [{ name: 'S', records: [labelSst(0, 0, 0), labelSst(0, 1, 1), labelSst(0, 2, 2), labelSst(0, 3, 3)] }] }));
  assert.deepEqual(values(workbook.sheets[0]), { A1: 'bold', B1: '日本', C1: 'continued text', D1: 'last' });
});

test('a rich-text shared string reports the same adjustment as an XLSX import', async () => {
  const rich = bytes(u16(4), 0x08, u16(1), [...'bold'].map(c => c.charCodeAt(0)), u16(0), u16(1));
  const result = await importSpreadsheetXls(xls({ globals: [...base, record(R.SST, u32(1), u32(1), rich)], sheets: [{ name: 'S', records: [labelSst(0, 0, 0)] }] }));
  assert.deepEqual(messages(result), ['セル内の文字ごとの書式を単一の書式へ変更しました']);
});

test('control characters and escape-like text survive the conversion', async () => {
  const text = 'tab\there _x0041_ line\u000bbreak <&> "q"';
  const { workbook } = await importSpreadsheetXls(xls({ globals: [...base, sst([text])], sheets: [{ name: 'S', records: [labelSst(0, 0, 0)] }] }));
  assert.equal(workbook.sheets[0].cells.A1.value, text);
});

test('the 1904 date system is converted as in an XLSX import', async () => {
  const result = await importSpreadsheetXls(xls({ globals: [record(R.DATEMODE, u16(1)), ...base], sheets: [{ name: 'S', records: [number(0, 0, 1)] }] }));
  assert.deepEqual(messages(result), ['1904年基準の日付を1900年基準へ変換し、数式を保存済みの計算結果へ置き換えました']);
});

test('hidden sheets are shown and non-worksheet sheets are omitted with warnings', async () => {
  const result = await importSpreadsheetXls(xls({ globals: base, sheets: [
    { name: 'Data', records: [number(0, 0, 1)] }, { name: 'Hidden', state: 1, records: [number(0, 0, 2)] },
    { name: 'Chart1', type: 2, kind: 0x0020 }, { name: 'Macro1', type: 1, kind: 0x0040 }, { name: 'Module1', type: 6, kind: 0x0006 },
  ] }));
  assert.deepEqual(result.workbook.sheets.map(sheet => sheet.name), ['Data', 'Hidden']);
  assert.deepEqual(result.warnings.map(({ message, sheetName }) => [sheetName, message]).sort(), [
    ['Chart1', 'グラフ専用シートを省略しました'], ['Hidden', '非表示のシートを表示状態で読み込みました'],
    ['Macro1', 'マクロシートを省略しました'], ['Module1', 'マクロシートを省略しました'],
  ].sort());
});

test('charts embedded in a worksheet do not leak their records into the sheet', async () => {
  const chart = [bof(0x0020), number(9, 9, 99), eof()];
  const { workbook } = await importSpreadsheetXls(xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1), ...chart, number(1, 0, 2)] }] }));
  assert.deepEqual(values(workbook.sheets[0]), { A1: '1', A2: '2' });
});

test('macros are never loaded and are reported', async () => {
  const result = await importSpreadsheetXls(xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1)] }] },
    { extraStreams: [{ path: '_VBA_PROJECT_CUR/VBA/dir', content: new Uint8Array(16) }] }));
  assert.deepEqual(messages(result), ['マクロを読み込まずに省略しました']);
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '1' });
});

test('files that are not readable Excel 97–2003 workbooks are rejected with a reason', async () => {
  const reject = (input, pattern) => assert.rejects(importSpreadsheetXls(input), pattern);
  await reject(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(600)]), /Excelファイルを読み込めません: \.xls形式（Excel 97–2003）のブックではありません/);
  await reject(xls({ globals: base }, { streamName: 'WordDocument' }), /Excelファイルを読み込めません: \.xls形式（Excel 97–2003）のブックではありません/);
  await reject(xls({ globals: base, version: 0x0500 }, { streamName: 'Book' }), /Excel 95以前の形式には対応していません/);
  await reject(xls({ globals: base, version: 0x0500 }), /Excel 95以前の形式には対応していません/);
  await reject(xls({ globals: [record(R.FILEPASS, u16(1), u16(1), u16(1)), ...base] }), /パスワードで保護または暗号化されたファイルには対応していません/);
  await reject(xls({ globals: base, sheets: [] }), /ワークシートがありません/);
  await reject(xls({ globals: base, sheets: [{ name: 'Only chart', type: 2, kind: 0x0020 }] }), /取り込めるワークシートがありません/);
});

test('structurally broken workbooks stop the import instead of yielding partial data', async () => {
  const reject = (book, pattern) => assert.rejects(importSpreadsheetXls(xls(book)), pattern);
  await reject({ globals: base, sheets: [{ name: 'S', records: [labelSst(0, 0, 5)] }] }, /共有文字列の参照が不正です/);
  await reject({ globals: base, sheets: [{ name: 'S', records: [record(R.NUMBER, u16(0), u16(0))] }] }, /データが途中で終わっています/);
  await reject({ globals: base, sheets: [{ name: 'S', records: [record(R.BOOLERR, cell(0, 0), 0x99, 1)] }] }, /エラーセルの値が不正です/);
  await reject({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1), number(0, 0, 2)] }] }, /セルが重複しています/);
  await reject({ globals: base, sheets: [{ name: 'S', records: [record(R.MULRK, u16(0), u16(3), u16(15), rkInteger(1), u16(1))] }] }, /セルの範囲が不正です/);
  const truncated = xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1)] }] });
  await assert.rejects(importSpreadsheetXls(truncated.subarray(0, truncated.length - 512)), /Excelファイルを読み込めません/);
});

test('a record that ends before its fields is reported with the Excel wording', async () => {
  for (const records of [[record(R.NUMBER, cell(0, 0))], [record(R.RK, u16(0))], [number(0, 0, 1), record(R.MULRK, u16(1), u16(0), u16(15))]])
    await assert.rejects(importSpreadsheetXls(xls({ globals: base, sheets: [{ name: 'S', records }] })), /^Error: Excelファイルを読み込めません: /);
  await assert.rejects(importSpreadsheetXls(xls({ globals: [...base, record(R.SST, u32(1), u32(1), u16(40), bytes(0, 0x41))], sheets: [{ name: 'S', records: [] }] })), /^Error: Excelファイルを読み込めません: /);
});

test('options, limits and cancellation behave as for XLSX', async () => {
  const file = xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1)] }] });
  await assert.rejects(importSpreadsheetXls(file, { emptyCellFormatting: 'drop' }), /emptyCellFormatting は preserve または omit/);
  await assert.rejects(importSpreadsheetXls(file, { limits: { inputBytes: 100 } }), /Excelファイルを読み込めません: ファイルサイズが上限を超えています/);
  const controller = new AbortController(); controller.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(importSpreadsheetXls(file, { signal: controller.signal }), { name: 'AbortError' });
  // The converted parts are budgeted like an expanded package: one sheet against the part size, all parts against the total.
  const wide = xls({ globals: base, sheets: ['A', 'B'].map(name => ({ name, records: Array.from({ length: 400 }, (_, row) => number(row, 0, row)) })) });
  const tooLarge = /^Error: Excelファイルを読み込めません: 変換後のデータのサイズが上限を超えています$/;
  await assert.rejects(importSpreadsheetXls(wide, { limits: { expandedBytes: 4096 } }), tooLarge, 'one sheet alone is over the budget');
  await assert.rejects(importSpreadsheetXls(wide, { limits: { expandedBytes: 28_000 } }), tooLarge, 'each sheet fits, both together do not');
  assert.equal((await importSpreadsheetXls(wide, { limits: { expandedBytes: 200_000 } })).workbook.sheets.length, 2);
  for (const input of [file.buffer.slice(0), new Blob([file]), new File([file], 'book.xls')])
    assert.deepEqual(values((await importSpreadsheetXls(input)).workbook.sheets[0]), { A1: '1' });
});

test('values outside the model grid stop the import while trailing blank formatting is omitted', async () => {
  await assert.rejects(importSpreadsheetXls(xls({ globals: base, sheets: [{ name: 'S', records: [number(20_000, 0, 1)] }] })), /Excel/);
  const result = await importSpreadsheetXls(xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1), record(R.BLANK, cell(20_000, 0))] }] }));
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '1' });
});

test('without a measurer the default sheet font is approximated and reported, as for XLSX', async () => {
  const result = await importModel(xls({ globals: base, sheets: [{ name: 'S', records: [number(0, 0, 1)] }] }));
  assert.deepEqual(messages(result), ['標準フォント「Arial」の列幅を測定できないため、Calibri 11pt・96dpi相当の列幅へ近似しました']);
});

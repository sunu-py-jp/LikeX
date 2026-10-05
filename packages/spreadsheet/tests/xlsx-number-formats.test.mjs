import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { zip, fixture, xml } from './helpers/xlsx-import-fixtures.mjs';

const output = await build({ stdin: { contents: 'export * from "./src/model-entry";', resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`;
const { importSpreadsheetXlsx, exportSpreadsheetXlsx, calculateWorkbook } = await import(moduleUrl);
const workbookBytes = codes => zip(fixture({
  links: [{ id: 'styles', type: 'styles', target: 'styles.xml' }],
  parts: { 'xl/styles.xml': `<styleSheet><numFmts>${codes.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(code)}"/>`).join('')}</numFmts><fonts><font/><font><b/><color rgb="FF123456"/></font></fonts><cellXfs><xf/>${codes.map((_, i) => `<xf numFmtId="${164 + i}" fontId="1"/>`).join('')}</cellXfs></styleSheet>` },
  sheets: [{ name: 'Formats', xml: `<sheetData>${codes.map((_, i) => `<row r="${i + 1}"><c r="A${i + 1}" s="${i + 1}"><v>123.45</v></c>${i === 0 ? '<c r="B1"><f>A1*2</f><v>246.9</v></c>' : ''}</row>`).join('')}</sheetData>` }],
}));
const readCodes = codes => importSpreadsheetXlsx(workbookBytes(codes));
const number = (decimalPlaces = 2, extra = {}) => ({ numberFormat: 'number', decimalPlaces, useGrouping: false, ...extra });

// Bound a regression in an independent thread: an accidentally reintroduced regex
// cannot block the main test runner indefinitely. No hostile input runs pre-fix.
function importInWorker(bytes, timeout = 5000) {
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.moduleUrl).then(async ({ importSpreadsheetXlsx }) => {
      const started = performance.now(); const result = await importSpreadsheetXlsx(workerData.bytes);
      parentPort.postMessage({ result, duration: performance.now() - started });
    }).catch(error => { throw error; });`, { eval: true, workerData: { moduleUrl, bytes } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('Number-format import exceeded its isolated time limit')); }, timeout);
    worker.once('message', message => { clearTimeout(timer); void worker.terminate(); resolve(message); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('unmatched bracket growth is bounded through the public XLSX importer and preserves the workbook', async () => {
  const { result } = await importInWorker(workbookBytes(['['.repeat(120_000)]));
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.value, '123.45');
  assert.deepEqual(sheet.cells.A1.format, { bold: true, color: '#123456' });
  assert.equal(sheet.cells.B1.value, '=A1*2');
  assert.ok(result.warnings.some(item => item.code === 'adjusted' && item.message.includes('4,096文字')));
});

test('malformed delimiters and trailing escapes fall back only the number format, including General sections', async () => {
  const codes = ['[', '0.00[red', '0.00]', '0.00[[Red]]', '0.00"unterminated', '0.00\\', '0.00_', '0.00*', 'General;[Red](General)[', 'General;"unfinished', 'General;[Red](General)' + '['.repeat(4100)];
  const result = await readCodes(codes), sheet = result.workbook.sheets[0];
  for (let index = 0; index < codes.length; index++) {
    const cell = sheet.cells[`A${index + 1}`];
    assert.equal(cell.value, '123.45', codes[index]);
    assert.deepEqual(cell.format, { bold: true, color: '#123456' }, codes[index]);
  }
  assert.equal(calculateWorkbook(result.workbook)[sheet.id].B1, 246.9);
  const malformed = result.warnings.find(item => item.message.includes('引用符・角括弧・エスケープ'));
  assert.equal(malformed.count, 10);
  assert.ok(result.warnings.some(item => item.message.includes('4,096文字')));
  const again = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(result.workbook));
  const roundtrip = again.workbook.sheets[0].cells.A1;
  assert.equal(roundtrip.value, sheet.cells.A1.value);
  assert.equal(roundtrip.format.bold, true); assert.equal(roundtrip.format.color, '#123456');
  assert.equal(roundtrip.format.numberFormat, undefined);
});

test('4096-character formats are accepted while the next character triggers a warning before interpretation', async () => {
  const boundary = '0.00"' + 'x'.repeat(4090) + '"';
  assert.equal(boundary.length, 4096);
  const result = await readCodes([boundary, boundary + 'x', 'General;[Red](General)"' + 'x'.repeat(4100) + '"']);
  const sheet = result.workbook.sheets[0];
  assert.equal(sheet.cells.A1.format.numberFormat, 'number');
  assert.equal(sheet.cells.A1.format.decimalPlaces, 2);
  assert.equal(sheet.cells.A2.format.numberFormat, undefined);
  assert.equal(sheet.cells.A3.format.negativeFormat, undefined, 'General fast path cannot bypass the length check');
  assert.equal(result.warnings.find(item => item.message.includes('4,096文字')).count, 2);
});

test('quoted/escaped text, currency/locale tokens, elapsed times and negative sections keep normal import semantics', async () => {
  const cases = [
    ['General', {}], ['@', { numberFormat: 'text' }], ['0.00', number()],
    ['#,##0.00;[Red](#,##0.00)', number(2, { useGrouping: true, negativeFormat: 'red-parentheses' })],
    ['General;[Red](General)', { negativeFormat: 'red-parentheses' }],
    ['"¥"#,##0', { numberFormat: 'currency', decimalPlaces: 0, useGrouping: true }],
    ['[$€-407]#,##0.00', { numberFormat: 'currency', decimalPlaces: 2, useGrouping: true }],
    ['[$-409]yyyy/mm/dd', { numberFormat: 'date' }],
    ['yyyy"年"mm"月"dd"日"', { numberFormat: 'date' }],
    ['yyyy/mm/dd hh:mm:ss', { numberFormat: 'datetime' }],
    ['[h]:mm:ss', { numberFormat: 'time' }], ['[hh]:mm:ss', { numberFormat: 'time' }],
    ['0.00%', { numberFormat: 'percent', decimalPlaces: 2, useGrouping: false }],
    ['0.00"days;[Red]"', number()], ['0.00\\d\\h\\m\\s', number()],
    ['0.00\\[\\]', number()], ['0.00\\"', number()], ['0.00\\%', number()],
    ['0.00_d*h', number()], ['0.00"C:\\"', number()],
    ['[<100]0.00', {}], ['0.00E+00', {}], ['# ?/?', {}],
  ];
  const result = await readCodes(cases.map(([code]) => code)), sheet = result.workbook.sheets[0];
  for (let index = 0; index < cases.length; index++) {
    assert.deepEqual(sheet.cells[`A${index + 1}`].format, { bold: true, color: '#123456', ...cases[index][1] }, cases[index][0]);
  }
  assert.ok(!result.warnings.some(item => item.message.includes('引用符・角括弧・エスケープ') || item.message.includes('4,096文字')));
});

test('all exporter-generated number format combinations still roundtrip through public XLSX APIs', async () => {
  const cells = {}, formats = [];
  for (const numberFormat of ['general', 'number', 'currency', 'percent', 'date', 'time', 'datetime', 'text']) {
    for (const negativeFormat of ['minus', 'red', 'parentheses', 'red-parentheses']) {
      for (const decimalPlaces of [0, 2, 10]) formats.push({ numberFormat, negativeFormat, decimalPlaces, useGrouping: true });
    }
  }
  formats.forEach((format, index) => { cells[`A${index + 1}`] = { value: '123.45', format }; });
  const workbook = { sheets: [{ id: 'formats', name: 'Roundtrip', rowCount: formats.length, columnCount: 2, cells }] };
  const first = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(workbook));
  const second = await importSpreadsheetXlsx(await exportSpreadsheetXlsx(first.workbook));
  assert.deepEqual(second.workbook.sheets[0].cells, first.workbook.sheets[0].cells);
  assert.ok(!first.warnings.some(item => item.message.includes('引用符・角括弧・エスケープ') || item.message.includes('4,096文字')));
});

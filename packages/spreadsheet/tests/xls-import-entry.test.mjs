import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';
import { xls, number, labelSst, sst, defaultFont, defaultFormats } from './xls-fixture.mjs';
import { createCompoundFile } from '../../core/tests/cfb-fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const external = { name: 'react-external', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } };
const model = await build({ stdin: { contents: `export { importSpreadsheetExcel, importSpreadsheetXls, importSpreadsheetXlsx } from './src/model-entry';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'xls-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { importSpreadsheetExcel, importSpreadsheetXlsx } = await import(`data:text/javascript;base64,${Buffer.from(model.outputFiles[0].text).toString('base64')}`);
const ui = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic', plugins: [external] });
const browser = await import(`data:text/javascript;base64,${Buffer.from(ui.outputFiles[0].text).toString('base64')}`);
const { Spreadsheet } = browser;
const measured = { columnWidthMeasurement: () => ({ maximumDigitWidth: 7, pixelRatio: 1 }) };
const legacy = () => xls({ globals: [defaultFont(), ...defaultFormats(), sst(['旧形式'])], sheets: [{ name: '台帳', records: [labelSst(0, 0, 0), number(1, 0, 12)] }] });
const modern = () => readFile(new URL('./fixtures/xlsx/openpyxl-sample.xlsx', import.meta.url));
const values = sheet => Object.fromEntries(Object.entries(sheet.cells).map(([address, item]) => [address, item.value]));
const imports = events => events.filter(event => event.type === 'import');

test('importSpreadsheetExcel routes by content, whatever the input type or file name', async () => {
  const bytes = legacy(), expected = { A1: '旧形式', A2: '12' };
  for (const input of [bytes, bytes.buffer.slice(0), new Blob([bytes]), new File([bytes], 'ledger.xls'), new File([bytes], 'ledger.dat')])
    assert.deepEqual(values((await importSpreadsheetExcel(input, measured)).workbook.sheets[0]), expected);
  const xlsx = await modern(), direct = await importSpreadsheetXlsx(xlsx);
  for (const input of [xlsx, new Blob([xlsx]), new File([xlsx], 'book.xlsx'), new File([xlsx], 'renamed.xls')])
    assert.deepEqual(await importSpreadsheetExcel(input), direct);
});

test('inputs that are neither format keep the XLSX error, and encrypted OOXML is named as such', async () => {
  await assert.rejects(importSpreadsheetExcel(new TextEncoder().encode('not a workbook at all, just some text')), /Excelファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
  await assert.rejects(importSpreadsheetExcel(null), /Excelファイルを読み込めません: 入力形式が不正です/);
  const encrypted = createCompoundFile([{ path: 'EncryptedPackage', content: new Uint8Array(64) }, { path: 'EncryptionInfo', content: new Uint8Array(64) }]);
  await assert.rejects(importSpreadsheetExcel(encrypted), /Excelファイルを読み込めません: パスワードで保護または暗号化されたファイルには対応していません/);
  // A .xlsx name keeps the established XLSX path and its message.
  await assert.rejects(importSpreadsheetExcel(new File([encrypted], 'locked.xlsx')), /Excelファイルを読み込めません: 暗号化されていないOOXMLファイルを指定してください/);
});

test('the browser entry exports the same importers', () => {
  for (const name of ['importSpreadsheetExcel', 'importSpreadsheetXls', 'importSpreadsheetXlsx']) assert.equal(typeof browser[name], 'function', name);
});

const book = value => ({ sheets: [{ id: 'main', name: 'main', rowCount: 10, columnCount: 5, cells: { A1: { value } } }] });
async function mount(t, overrides = {}) {
  const ref = createRef(); let renderer;
  await act(async () => { renderer = create(createElement(Spreadsheet, { ref, initialWorkbook: book('before'), onSave() {}, ...overrides })); });
  t.after(() => act(async () => renderer.unmount()));
  return { ref, get root() { return renderer.root; } };
}

test('the handle imports an .xls file as one undoable edit and reports the format in its events', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  const before = app.ref.current.getWorkbook();
  let result;
  await act(async () => { result = await app.ref.current.importExcel(new File([legacy()], '台帳.xls'), measured); });
  assert.deepEqual(values(result.workbook.sheets[0]), { A1: '旧形式', A2: '12' });
  assert.equal(app.ref.current.getWorkbook(), result.workbook);
  assert.deepEqual(imports(events).map(event => [event.status, event.format, event.fileName]), [['start', 'xls', '台帳.xls'], ['success', 'xls', '台帳.xls']]);
  await act(async () => { assert.equal(await app.ref.current.undo(), true); });
  assert.equal(app.ref.current.getWorkbook(), before);
});

test('binary input is labelled by its signature, and .xlsx files keep the xlsx label', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  await act(async () => { await app.ref.current.importExcel(legacy(), measured); });
  await act(async () => { await app.ref.current.importExcel(new File([await modern()], 'book.xlsx'), { discardChanges: true }); });
  assert.deepEqual(imports(events).map(event => [event.status, event.format]), [['start', 'xls'], ['success', 'xls'], ['start', 'xlsx'], ['success', 'xlsx']]);
});

test('other file names are refused before reading, and a failed .xls import keeps the draft', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event) });
  const before = app.ref.current.getWorkbook();
  await act(async () => { await assert.rejects(app.ref.current.importExcel(new File([legacy()], 'ledger.csv')), /\.xlsx または \.xls 形式のExcelファイルを選択してください/); });
  await act(async () => { await assert.rejects(app.ref.current.importExcel(new File([legacy().subarray(0, 1024)], 'broken.xls')), /Excelファイルを読み込めません/); });
  assert.equal(app.ref.current.getWorkbook(), before);
  assert.deepEqual(imports(events).map(event => [event.status, event.format]), [['start', 'xlsx'], ['error', 'xlsx'], ['start', 'xls'], ['error', 'xls']]);
});

test('the file ribbon offers both Excel formats and imports a chosen .xls file', async t => {
  const events = [], app = await mount(t, { onEvent: event => events.push(event), excelImportOptions: {} });
  const tabs = app.root.findByProps({ 'aria-label': 'リボンのタブ' }).findAllByProps({ role: 'tab' });
  await act(async () => tabs[0].props.onClick());
  const fileInput = app.root.findByProps({ 'aria-label': '取り込むExcelファイル' });
  assert.equal(fileInput.props.accept, '.xlsx,.xls');
  await act(async () => { fileInput.props.onChange({ currentTarget: { files: [new File([legacy()], 'ledger.xls')], value: 'ledger.xls' } }); });
  for (let turn = 0; turn < 50 && !imports(events).some(event => event.status !== 'start'); turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  // Without a browser font measurer the non-Calibri default font is approximated, which asks for a review.
  const review = app.root.findAllByProps({ title: '取り込み内容の確認' });
  if (review.length) {
    await act(async () => { app.root.findAllByProps({ children: '取り込む' }).at(-1).props.onClick(); });
    for (let turn = 0; turn < 50 && !imports(events).some(event => event.status !== 'start'); turn++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.deepEqual(imports(events).map(event => [event.status, event.format]), [['start', 'xls'], ['success', 'xls']]);
  assert.deepEqual(values(app.ref.current.getWorkbook().sheets[0]), { A1: '旧形式', A2: '12' });
});

test('a wrong extension chosen in the ribbon is reported without starting an import', async t => {
  const events = [], errors = [], app = await mount(t, { onEvent: event => events.push(event), onError: error => errors.push(error) });
  const tabs = app.root.findByProps({ 'aria-label': 'リボンのタブ' }).findAllByProps({ role: 'tab' });
  await act(async () => tabs[0].props.onClick());
  await act(async () => { app.root.findByProps({ 'aria-label': '取り込むExcelファイル' }).props.onChange({ currentTarget: { files: [new File(['x'], 'notes.txt')], value: 'notes.txt' } }); });
  assert.deepEqual(imports(events), []);
});

test('a bundle that only re-exports from the model entry works without anything being loaded first', async () => {
  // Loading a reader on demand would defer the set-up of every module it shares with the model.
  const reexport = await build({ stdin: { contents: `export { createWorkbook } from './src/model-entry';`, resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'reexport-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
  const { createWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(reexport.outputFiles[0].text).toString('base64')}`);
  assert.equal(createWorkbook().sheets.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { generatedSkillScript } from '../../../scripts/build-skill-scripts.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const output = await build({ stdin: { contents: `export * from './packages/spreadsheet/src/model-entry';
export { replaceSpreadsheetCells } from './packages/spreadsheet/src/model/editing/search';`,
  resolveDir: repo, sourcefile: 'address-ranges-entry.ts' }, bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@likex/core': path.join(repo, 'packages/core/src/index.ts'), '@likex/core/json': path.join(repo, 'packages/core/src/json.ts'),
    '@likex/core/connectors': path.join(repo, 'packages/core/src/connectors.ts'),
    '@likex/core/ooxml': path.join(repo, 'packages/core/src/ooxml.ts') } });
const source = output.outputFiles[0].text;
const m = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const book = (cells = {}, extra = {}) => m.normalizeWorkbook({ sheets: [{ id: 'main', name: 'Main',
  rowCount: 20, columnCount: 8, cells, ...extra }] });
const command = (type, extra = {}) => ({ type, sheetId: 'main', ...extra });
const apply = (workbook, commands, features) => m.applySpreadsheetCommands(workbook, commands, { features });
const cell = value => ({ value });
const oversizedSheet = { rowCount: 10_000, columnCount: 2 };
const explicitAddresses = [...Array.from({ length: 10_000 }, (_, row) => `A${row + 1}`), 'B1'];

test('public address expansion canonicalizes mixed cells/ranges, deduplicates and preserves first occurrence order', () => {
  const result = m.expandCellAddresses(book().sheets[0], ['$b$2', '$a$1:$b$2', 'a1', 'C1:C2']);
  assert.deepEqual(result, ['B2', 'A1', 'B1', 'A2', 'C1', 'C2']);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(m.expandCellAddresses(book().sheets[0], []), []);
  for (const input of ['A0', 'A1:B0', 'B2:A1', 'A1:B2:C3', 'A1:I1', 'A20:A21', 'Other!A1', 3]) {
    assert.throws(() => m.expandCellAddresses(book().sheets[0], ['A1', input]), error => {
      assert.equal(error instanceof m.CellAddressExpansionError, true);
      assert.equal(error.index, 1); assert.equal(error.input, input);
      assert.match(error.message, /addresses\[1\]/);
      return true;
    });
  }
});

test('range expansion counts the bounded unique union and keeps explicit-only large selections compatible', () => {
  assert.equal(m.expandCellAddresses(oversizedSheet, ['A1:A10000', 'A1:A10000', '$a$1']).length, 10_000);
  for (const inputs of [['A1:B10000'], ['A1:A10000', 'B1'], ['B1', 'A1:A10000'], [...explicitAddresses, 'A1:A1']]) {
    assert.throws(() => m.expandCellAddresses(oversizedSheet, inputs), /addresses\[\d+\].*10,000/);
  }
  assert.deepEqual(m.expandCellAddresses(oversizedSheet, explicitAddresses), explicitAddresses);
  const workbook = book({}, oversizedSheet);
  assert.equal(Object.keys(m.formatCells(workbook, 'main', explicitAddresses, { bold: true }).sheets[0].cells).length, 10_001);
  assert.equal(m.replaceSpreadsheetCells(workbook, 'main', { text: 'unused' }, 'replacement', explicitAddresses), workbook);
  assert.throws(() => m.setCellDataValidation(workbook, 'main', Array(10_001).fill('A1'), null), /10,000/,
    'the existing input-validation list limit is retained');
});

test('formatting and literal replacement expand rectangles without touching outside cells or the input workbook', () => {
  const workbook = book({ A1: cell('old'), B1: cell('old'), A2: cell('old'), B2: cell('old'), C1: cell('old') });
  const formatted = m.formatCells(workbook, 'main', ['a1:b2', '$B$1'], { bold: true, background: '#123456' });
  for (const address of ['A1', 'B1', 'A2', 'B2']) assert.equal(formatted.sheets[0].cells[address].format.bold, true);
  assert.equal(formatted.sheets[0].cells.C1, workbook.sheets[0].cells.C1);
  assert.equal(workbook.sheets[0].cells.A1.format, undefined);
  const replaced = m.replaceSpreadsheetCells(formatted, 'main', { text: 'old', lookIn: 'formulas' }, 'new', ['A1:B2', 'a1']);
  for (const address of ['A1', 'B1', 'A2', 'B2']) assert.equal(replaced.sheets[0].cells[address].value, 'new');
  assert.equal(replaced.sheets[0].cells.C1.value, 'old');
  for (const update of [value => m.formatCells(value, 'main', ['A1', 'A20:A21'], { italic: true }),
    value => m.replaceSpreadsheetCells(value, 'main', { text: 'old' }, 'new', ['A1', 'A20:A21'])]) {
    assert.throws(() => update(workbook), /addresses\[1\]/);
    assert.equal(workbook.sheets[0].cells.A1.value, 'old'); assert.equal(workbook.sheets[0].cells.A1.format, undefined);
  }
});

test('validation ranges retain merge anchors, value checks, removal semantics and atomic failures', () => {
  const workbook = book({ A1: cell('1'), C2: cell('2'), D1: cell('outside') },
    { merges: [{ top: 0, left: 0, bottom: 0, right: 1 }] });
  const rule = { type: 'number', min: 0, max: 5, allowBlank: true };
  const validated = m.setCellDataValidation(workbook, 'main', ['A1:C2', '$A$1'], rule);
  for (const address of ['A1', 'C1', 'A2', 'B2', 'C2']) assert.deepEqual(validated.sheets[0].cells[address].validation, rule);
  assert.equal(validated.sheets[0].cells.B1, undefined, 'covered merge cells remain absent');
  assert.equal(validated.sheets[0].cells.D1, workbook.sheets[0].cells.D1);
  assert.throws(() => m.setCellDataValidation(workbook, 'main', ['A1:D1'], rule));
  assert.throws(() => m.setCellDataValidation(workbook, 'main', ['A1', 'A21:A22'], rule), /addresses\[1\]/);
  assert.equal(workbook.sheets[0].cells.A1.validation, undefined);
  const removed = m.setCellDataValidation(validated, 'main', ['A1:C2'], null);
  assert.equal(removed.sheets[0].cells.A1.value, '1'); assert.equal(removed.sheets[0].cells.A1.validation, undefined);
  assert.equal(removed.sheets[0].cells.C1, undefined);
});

test('range command staging retains feature, formula and write-conflict guards', () => {
  const workbook = book({ A1: cell('old'), B1: cell('old') });
  const commands = [command('cells.format', { addresses: ['A1:B2'], format: { bold: true } }),
    command('cells.validation', { addresses: ['A1:B2'], validation: { type: 'textLength', max: 5 } }),
    command('cells.replace', { addresses: ['A1:B2'], query: { text: 'old', lookIn: 'formulas' }, replacement: 'new' })];
  const result = apply(workbook, commands);
  assert.equal(result.ok, true, result.message);
  assert.equal(result.workbook.sheets[0].cells.A1.value, 'new');
  for (const [index, feature] of ['formatting', 'dataValidation', 'replace'].entries())
    assert.equal(apply(workbook, [commands[index]], { [feature]: false }).code, 'FEATURE_DISABLED');
  const text = book({ A1: { value: '=1+1', format: { numberFormat: 'text' } } });
  assert.equal(apply(text, [command('cells.format', { addresses: ['A1:B1'], format: { numberFormat: 'general' } })],
    { formulas: false }).code, 'FEATURE_DISABLED');
  assert.equal(apply(workbook, [command('cells.replace', { addresses: ['A1:B1'], query: { text: 'old', lookIn: 'formulas' },
    replacement: '=1+1' })], { formulas: false }).code, 'FEATURE_DISABLED');
  assert.equal(apply(workbook, [{ ...commands[2], onConflict: 'error' }]).code, 'WRITE_CONFLICT');
});

test('invalid ranges in later commands report the exact address index without applying earlier commands', () => {
  const workbook = book({ A1: cell('original') });
  for (const properties of [{ type: 'cells.format', format: { bold: true } }, { type: 'cells.validation', validation: null },
    { type: 'cells.replace', query: { text: 'original' }, replacement: 'changed' }]) {
    const result = apply(workbook, [command('cells.set', { values: { A1: 'changed' } }),
      command(properties.type, { ...properties, addresses: ['A1', 'A20:A21'] })]);
    assert.equal(result.ok, false); assert.equal(result.commandIndex, 1); assert.equal(result.code, 'INVALID_TARGET');
    assert.match(result.message, /addresses\[1\]/); assert.equal('workbook' in result, false);
    assert.equal(workbook.sheets[0].cells.A1.value, 'original');
    const malformed = apply(workbook, [command(properties.type, { ...properties, addresses: ['A1', null] })]);
    assert.equal(malformed.code, 'INVALID_COMMAND'); assert.match(malformed.message, /addresses\[1\]/);
  }
});

test('range formatting and validation use existing SPON and XLSX round-trip representations', async () => {
  const initial = book({ A1: cell('1'), B1: cell('2') });
  const result = apply(initial, [command('cells.format', { addresses: ['A1:B1'], format: { bold: true, background: '#123456' } }),
    command('cells.validation', { addresses: ['A1:B1'], validation: { type: 'number', min: 0, max: 10, allowBlank: true } })]);
  assert.equal(result.ok, true, result.message);
  const native = m.parseWorkbook(m.serializeWorkbook(result.workbook));
  assert.deepEqual({ ...native.sheets[0].cells }, { ...result.workbook.sheets[0].cells });
  const xlsx = await m.exportSpreadsheetXlsx(native);
  const imported = await m.importSpreadsheetXlsx(new Uint8Array(await xlsx.arrayBuffer()));
  for (const address of ['A1', 'B1']) {
    const restored = imported.workbook.sheets[0].cells[address];
    assert.equal(restored.value, initial.sheets[0].cells[address].value);
    assert.equal(restored.format.bold, true); assert.equal(restored.format.background, '#123456');
    assert.equal(restored.validation.type, 'number'); assert.equal(restored.validation.max, 10);
  }
});

test('skill CLI applies mixed A1 ranges and leaves its output untouched on indexed range failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'likex-range-cli-'));
  try {
    const installed = path.join(directory, 'node_modules/@likex/spreadsheet');
    await mkdir(installed, { recursive: true });
    const metadata = JSON.parse(await readFile(path.join(repo, 'packages/spreadsheet/package.json'), 'utf8'));
    await writeFile(path.join(installed, 'package.json'), JSON.stringify({ name: metadata.name, version: metadata.version, type: 'module',
      exports: { './model': './model.mjs', './package.json': './package.json' } }));
    await writeFile(path.join(installed, 'model.mjs'), source);
    const script = path.join(directory, 'document.mjs'), input = path.join(directory, 'input.spon');
    const target = path.join(directory, 'output.spon'), commands = path.join(directory, 'commands.json');
    await writeFile(script, await generatedSkillScript('spreadsheet'));
    await writeFile(input, m.serializeWorkbook(book({ B2: cell('old'), C2: cell('old') })));
    await writeFile(commands, JSON.stringify([
      command('cells.format', { addresses: ['B2:F2'], format: { bold: true } }),
      command('cells.validation', { addresses: ['$b$2:$f$2'], validation: { type: 'textLength', max: 8 } }),
      command('cells.replace', { addresses: ['B2:F2'], query: { text: 'old', lookIn: 'formulas' }, replacement: 'new' }),
    ]));
    const args = [script, 'apply', '--project', directory, '--input', input, '--output', target, '--commands', commands];
    const { stdout } = await promisify(execFile)(process.execPath, args, { cwd: directory });
    assert.equal(JSON.parse(stdout).ok, true);
    const saved = await readFile(target, 'utf8'), restored = m.parseWorkbook(saved);
    for (const address of ['B2', 'C2', 'D2', 'E2', 'F2']) {
      assert.equal(restored.sheets[0].cells[address].format.bold, true);
      assert.equal(restored.sheets[0].cells[address].validation.max, 8);
    }
    assert.equal(restored.sheets[0].cells.B2.value, 'new');
    await writeFile(commands, JSON.stringify([command('cells.format', { addresses: ['A1', 'A20:A21'], format: { bold: true } })]));
    await assert.rejects(promisify(execFile)(process.execPath, args, { cwd: directory }), error => {
      const failure = JSON.parse(error.stdout); assert.equal(failure.ok, false);
      assert.match(JSON.stringify(failure), /addresses\[1\]/); return true;
    });
    assert.equal(await readFile(target, 'utf8'), saved);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

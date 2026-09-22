import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { buildSkillSchemas, generateSkillSchemas, schemaTargets } from '../build-skill-schemas.mjs';
import { exportedType, schemaFromType } from '../skills/schema-generator.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// ESLint already depends on Ajv 6. Reuse it through its owner instead of adding a
// production dependency or relying on npm's incidental hoisting layout.
const require = createRequire(import.meta.url);
const Ajv = createRequire(require.resolve('eslint/package.json'))('ajv');

// The generated 2020-12 schemas use only draft-07 validation keywords plus
// $defs and prefixItems. Translate those two keywords losslessly for Ajv 6.
function draft7(schema) {
  if (Array.isArray(schema)) return schema.map(draft7);
  if (!schema || typeof schema !== 'object') return schema;
  const converted = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') converted.$schema = 'http://json-schema.org/draft-07/schema#';
    else if (key === '$defs') converted.definitions = draft7(value);
    else if (key === '$ref') converted.$ref = value.replace('#/$defs/', '#/definitions/');
    else if (key === 'prefixItems') { converted.items = draft7(value); converted.additionalItems = draft7(schema.items); }
    else if (key !== 'items' || !schema.prefixItems) converted[key] = draft7(value);
  }
  return converted;
}
const compile = schema => new Ajv({ allErrors: true, schemaId: 'auto', logger: false }).compile(draft7(schema));
const schemaFile = (module, file) => `packages/${module}/skills/likex-${module}/references/${file}.schema.json`;
const readSchema = async (module, file) => JSON.parse(await readFile(path.join(repository, schemaFile(module, file)), 'utf8'));
const valid = (validator, value) => assert.equal(validator(value), true, JSON.stringify(validator.errors));
const invalid = (validator, value) => assert.equal(validator(value), false, `Unexpectedly accepted ${JSON.stringify(value).slice(0, 500)}`);

test('committed schemas reproduce from current TypeScript types, package versions, and command limits', async () => {
  const outputs = await buildSkillSchemas({ check: true });
  assert.equal(outputs.size, schemaTargets.length);
  for (const text of outputs.values()) {
    const schema = JSON.parse(text);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$comment, /generator v1; TypeScript [\d.]+; @likex\//);
    assert.match(schema.$comment, /runtime parsers and command APIs are authoritative/);
    assert.ok(Object.keys(schema.$defs).length > 0);
    compile(schema);
    if (schema.title.endsWith('[]')) { assert.equal(schema.type, 'array'); assert.ok(Number.isInteger(schema.maxItems) && schema.maxItems >= 1000); }
  }
});

test('SPON validates stored rows, nested definitions, literal formats, and numeric Record keys', async () => {
  const validate = compile(await readSchema('spreadsheet', 'spon'));
  const file = { format: 'likex.spreadsheet', schemaVersion: 1, sheets: [{
    id: 'sheet-1', name: 'Sheet', rowCount: 20, columnCount: 10,
    columnWidths: { 0: 120, 2: 200 },
    rows: [{ height: 28, cells: { A: { value: 'Title', format: { bold: true, borders: { bottom: { width: 2, style: 'solid' } } } },
      B: { value: 'Yes', validation: { type: 'list', values: ['Yes', 'No'] } } } }, {}, { cells: { C: { value: '=A1' } } }],
    conditionalFormats: [{ id: 'rule', type: 'colorScale', ranges: [{ top: 0, left: 0, bottom: 2, right: 2 }], colors: ['#ff0000', '#00ff00'] }],
    tables: [{ id: 't', name: 'Table', range: { top: 0, left: 0, bottom: 2, right: 0 }, columns: [{ id: 'c', name: 'Title' }] }],
  }] };
  valid(validate, file);
  const rejectChange = change => { const changed = structuredClone(file); change(changed); invalid(validate, changed); };
  rejectChange(value => { delete value.format; });
  rejectChange(value => { value.format = 'likex.slide'; });
  rejectChange(value => { value.schemaVersion = 2; });
  rejectChange(value => { value.sheets[0].cells = {}; });
  rejectChange(value => { value.sheets[0].rowHeights = { 0: 28 }; });
  rejectChange(value => { delete value.sheets[0].rows; });
  rejectChange(value => { value.sheets[0].rows[0].extra = true; });
  rejectChange(value => { value.sheets[0].rows[0].cells.A.value = 42; });
  rejectChange(value => { value.sheets[0].rows[0].cells.A.format.align = 'diagonal'; });
  rejectChange(value => { value.sheets[0].rows[0].cells.A.format.borders.bottom.width = 4; });
  rejectChange(value => { value.sheets[0].rows[0].cells.A.format.borders.middle = {}; });
  rejectChange(value => { value.sheets[0].rows[0].cells.B.validation.values = [42]; });
  rejectChange(value => { value.sheets[0].columnWidths = { A: 100 }; });
  rejectChange(value => { value.sheets[0].columnWidths = { 0: '100' }; });
  rejectChange(value => { value.sheets[0].conditionalFormats[0].colors.push('#ffffff', '#000000'); });
  rejectChange(value => { delete value.sheets[0].tables[0].columns[0].name; });
});

test('SLON requires explicit stackOrder for each discriminated stored element', async () => {
  const validate = compile(await readSchema('slide', 'slon'));
  const base = { id: 'text-1', name: 'Text', x: 10, y: 20, width: 300, height: 100, rotation: 0, opacity: 1, locked: false };
  const file = { format: 'likex.slide', version: 1, id: 'deck', title: 'Deck', width: 1280, height: 720, slides: [{
    id: 'page-1', name: 'Page', background: '#ffffff', notes: '', elements: [
      { ...base, type: 'text', text: 'Hello', fontSize: 32, fontFamily: 'Arial', color: '#000000', bold: false,
        italic: false, align: 'left', verticalAlign: 'top', fill: 'none', stackOrder: 0 },
      { ...base, id: 'shape-1', type: 'shape', shape: 'rect', fill: '#ffffff', stroke: '#000000', strokeWidth: 1,
        text: '', fontSize: 20, textColor: '#000000', stackOrder: 1 },
      { ...base, id: 'image-1', type: 'image', src: 'data:image/png;base64,AAAA', alt: 'Image', stackOrder: 2 },
    ],
  }] };
  valid(validate, file);
  const rejectChange = change => { const changed = structuredClone(file); change(changed); invalid(validate, changed); };
  rejectChange(value => { delete value.format; });
  rejectChange(value => { value.version = 2; });
  rejectChange(value => { delete value.slides[0].elements[0].stackOrder; });
  rejectChange(value => { value.slides[0].elements[0].stackOrder = '0'; });
  rejectChange(value => { value.slides[0].elements[0].type = 'image'; });
  rejectChange(value => { value.slides[0].elements[0].align = 'justify'; });
  rejectChange(value => { value.slides[0].elements[1].shape = 'star'; });
  rejectChange(value => { value.slides[0].elements[2].remote = true; });
});

test('spreadsheet command arrays preserve nested readonly inputs and optional/null distinctions', async () => {
  const validate = compile(await readSchema('spreadsheet', 'commands'));
  valid(validate, [
    { type: 'cells.set', sheetId: 's', values: { A1: '1', B1: 'Hello' }, onConflict: 'overwrite' },
    { type: 'rows.insert', sheetId: 's', index: 1, values: [[1, '2', true, null]] },
    { type: 'cells.paste', sheetId: 's', target: { row: 0, column: 0 }, payload: { values: [['Hello']], formats: [[null]], validations: [[null]] } },
    { type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { bold: true, align: 'left' } },
    { type: 'conditionalFormats.set', sheetId: 's', rules: [{ id: 'r', type: 'colorScale', ranges: [], colors: ['red', 'green', 'blue'] }] },
    { type: 'cells.validation', sheetId: 's', addresses: ['A1'], validation: null },
    { type: 'cells.validation', sheetId: 's', addresses: ['A1'], validation: { type: 'number', min: 1, integer: true } },
    { type: 'comments.set', sheetId: 's', address: 'A1', comment: null },
    { type: 'dimensions.resize', sheetId: 's', rowHeights: { 0: 20 } },
    { type: 'tables.insert', sheetId: 's', name: 'Table', target: { row: 0, column: 0 }, headers: ['Item'], data: { type: 'rows', values: [['Item']] }, rowNumbers: false },
    { type: 'shapes.insert', sheetId: 's', shape: 'rectangle', anchor: { row: 0, column: 0 } },
    { type: 'images.update', sheetId: 's', drawingId: 'd', patch: { anchor: { row: 2, column: 1 }, alt: 'Image' } },
  ]);
  for (const commands of [
    { type: 'sheets.add' },
    [{ type: 'unknown' }],
    [{ type: 'cells.set', values: { A1: '1' } }],
    [{ type: 'cells.set', sheetId: 's', values: { A1: 1 } }],
    [{ type: 'sheets.add', unexpected: true }],
    [{ type: 'rows.insert', sheetId: 's', index: 0, values: [[{}]] }],
    [{ type: 'cells.validation', sheetId: 's', addresses: ['A1'], validation: { type: 'list' } }],
    [{ type: 'cells.validation', sheetId: 's', addresses: ['A1'], validation: { type: 'checkbox', values: ['yes'] } }],
    [{ type: 'cells.format', sheetId: 's', addresses: ['A1'], format: { align: 'diagonal' } }],
    [{ type: 'comments.set', sheetId: 's', address: 'A1' }],
    [{ type: 'shapes.insert', sheetId: 's', shape: 'rect', anchor: { row: 0, column: 0 } }],
    [{ type: 'dimensions.resize', sheetId: 's', rowHeights: { zero: 20 } }],
    [{ type: 'images.update', sheetId: 's', drawingId: 'd', patch: { id: 'other' } }],
    Array.from({ length: 1001 }, () => ({ type: 'sheets.add' })),
  ]) invalid(validate, commands);
  valid(validate, []);
});

test('slide command schemas derive Partial/Omit/Pick inputs without allowing fields from other variants', async () => {
  const validate = compile(await readSchema('slide', 'commands'));
  valid(validate, [
    { type: 'deck.rename', title: 'New title' },
    { type: 'slide.add', slide: { name: 'Page', notes: '' } },
    { type: 'slide.update', slideId: 'p', patch: { background: '#ffffff' } },
    { type: 'element.add', slideId: 'p', element: { type: 'text', text: 'Hi', x: 10, y: 20 } },
    { type: 'element.add', slideId: 'p', element: { type: 'shape', shape: 'ellipse' } },
    { type: 'element.add', slideId: 'p', element: { type: 'image', src: 'data:image/png;base64,AAAA' } },
    { type: 'element.update', slideId: 'p', elementId: 'e', patch: { x: 100, fill: '#00ff00' } },
    { type: 'element.order', slideId: 'p', elementIds: ['e'], direction: 'front' },
  ]);
  for (const commands of [
    { type: 'deck.rename', title: 'Title' },
    [{ type: 'deck.rename' }],
    [{ type: 'deck.resize', width: 'wide', height: 720 }],
    [{ type: 'slide.update', slideId: 'p', patch: { id: 'other' } }],
    [{ type: 'element.add', slideId: 'p', element: { type: 'image' } }],
    [{ type: 'element.add', slideId: 'p', element: { type: 'text', src: 'data:image/png;base64,AAAA' } }],
    [{ type: 'element.update', slideId: 'p', elementId: 'e', patch: { stackOrder: 1 } }],
    [{ type: 'element.order', slideId: 'p', elementIds: ['e'], direction: 'up' }],
    Array.from({ length: 1001 }, () => ({ type: 'deck.rename', title: 'Title' })),
  ]) invalid(validate, commands);
  valid(validate, []);
});

test('DCON preserves recursive block/mark structure and command arrays include JSON-only Steps', async () => {
  const document = compile(await readSchema('document', 'dcon'));
  const file = { format: 'likex.document', version: 1, id: 'document-1', title: 'Document',
    page: { width: 210, height: 297, margins: { top: 20, right: 20, bottom: 20, left: 20 } },
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'paragraph-1', align: 'left' },
      content: [{ type: 'text', text: 'Hello', marks: [{ type: 'strong' }] }] }] } };
  valid(document, file);
  invalid(document, { ...file, version: 2 });
  invalid(document, { ...file, format: 'likex.slide' });
  invalid(document, { ...file, content: { type: 'doc', content: [{ type: 'video', src: 'remote' }] } });
  invalid(document, { ...file, page: { ...file.page, width: '210' } });
  const commands = compile(await readSchema('document', 'commands'));
  valid(commands, [
    { type: 'text.insert', from: 1, text: 'New text' },
    { type: 'mark.set', from: 1, to: 3, mark: 'text_style', attrs: { fontSize: 14 } },
    { type: 'document.update', page: { margins: { left: 25 } } },
    { type: 'transaction.apply', steps: [{ stepType: 'replace', from: 1, to: 1,
      slice: { content: [{ type: 'text', text: 'A' }], openStart: 0, openEnd: 0 } }] },
  ]);
  invalid(commands, { type: 'text.insert', from: 1, text: 'No array' });
  invalid(commands, [{ type: 'text.insert', from: '1', text: 'Wrong position type' }]);
  invalid(commands, [{ type: 'mark.set', from: 1, to: 3, mark: 'script' }]);
  invalid(commands, [{ type: 'document.update', page: { margins: { sideways: 25 } } }]);
});

function sourceSchema(source) {
  const file = path.join(repository, '__schema_test__.ts');
  const options = { strict: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const readSource = host.getSourceFile;
  host.getSourceFile = (name, ...args) => name === file ? ts.createSourceFile(file, source, options.target, true) : readSource(name, ...args);
  const program = ts.createProgram({ rootNames: [file], options, host });
  return schemaFromType(program.getTypeChecker(), exportedType(program, file, 'Example'), { title: 'Example', comment: 'Test fixture' });
}

test('generator rejects unsupported/unresolved types instead of silently emitting permissive schemas', () => {
  for (const type of ['any', 'unknown', 'object', '{}', 'bigint', 'symbol', '() => void', 'Date', '`id-${string}`', '[string, ...string[]]', 'Record<symbol, string>'])
    assert.throws(() => sourceSchema(`export type Example = ${type};`), /Cannot generate JSON Schema/);
});

test('generator uses current field and enum declarations, supports recursion, and enforces tuple lengths', () => {
  const schema = sourceSchema(`export type Example = {
    state: 'draft' | 'done'; pair: readonly [string, number];
    nested?: Example; optional?: never;
    variants: readonly ({ type: 'text'; value: string } | { type: 'number'; value: number })[];
  };`);
  const validate = compile(schema);
  valid(validate, { state: 'draft', pair: ['value', 1], variants: [{ type: 'number', value: 1 }] });
  invalid(validate, { state: 'old', pair: ['value', 1], variants: [] });
  invalid(validate, { state: 'done', pair: ['value', 1, 2], variants: [] });
  invalid(validate, { state: 'done', pair: ['value'], variants: [] });
  invalid(validate, { state: 'done', pair: ['value', 1], variants: [{ type: 'text', value: 1 }] });
  invalid(validate, { state: 'done', pair: ['value', 1], variants: [], optional: null });
  valid(validate, { state: 'done', pair: ['value', 1], variants: [], nested: { state: 'draft', pair: ['nested', 2], variants: [] } });
});

test('--check reports drift and never rewrites a stale schema', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'likex-skill-schemas-'));
  try {
    await symlink(path.join(repository, 'tsconfig.base.json'), path.join(directory, 'tsconfig.base.json'));
    await symlink(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'));
    for (const packageName of new Set(['core', ...schemaTargets.map(target => target.package)])) {
      const destination = path.join(directory, 'packages', packageName);
      await mkdir(destination, { recursive: true });
      await symlink(path.join(repository, 'packages', packageName, 'src'), path.join(destination, 'src'));
      await symlink(path.join(repository, 'packages', packageName, 'package.json'), path.join(destination, 'package.json'));
    }
    const outputs = await generateSkillSchemas({ root: directory });
    for (const [file, text] of outputs) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), text);
    }
    const changed = path.join(directory, schemaFile('slide', 'slon'));
    await writeFile(changed, '{}\n');
    await assert.rejects(buildSkillSchemas({ root: directory, check: true }), /Skill schemas are stale.*\npackages\/slide\/skills\/likex-slide\/references\/slon.schema.json/);
    assert.equal(await readFile(changed, 'utf8'), '{}\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

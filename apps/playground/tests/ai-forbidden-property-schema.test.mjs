import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/command-schema.ts';" }, bundle: true, platform: 'node', format: 'esm', write: false });
const { commandSchemas, normalizeCommands, normalizeCommandValue, strictSchema, validateSchema } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

// The schema generator writes `false` for a property that must be absent (`name?: never`), which is how
// commands with several forms keep the fields of one form out of the others.
const native = { type: 'array', items: { anyOf: [{ $ref: '#/$defs/ByRow' }, { $ref: '#/$defs/ByColumn' }] }, $defs: {
  ByRow: { type: 'object', properties: { type: { const: 'pick' }, row: { type: 'number' }, note: { type: 'string' }, column: false }, required: ['type', 'row'], additionalProperties: false },
  ByColumn: { type: 'object', properties: { type: { const: 'pick' }, column: { type: 'number' }, note: { type: 'string' }, row: false }, required: ['type', 'column'], additionalProperties: false },
} };

test('the strict schema leaves out properties that must be absent', () => {
  const strict = strictSchema(native);
  assert.deepEqual(Object.keys(strict.$defs.ByRow.properties), ['type', 'row', 'note']);
  assert.deepEqual(strict.$defs.ByRow.required, ['type', 'row', 'note']);
  assert.equal(strict.$defs.ByRow.additionalProperties, false);
  assert.deepEqual(Object.keys(strict.$defs.ByColumn.properties), ['type', 'column', 'note']);
  assert.equal(JSON.stringify(strict).includes('false,'), false, 'no boolean schema is sent to the model');
});

test('a value is read as the form that allows its properties, and a forbidden property is refused', () => {
  const strict = strictSchema(native);
  // The optional note arrives as a synthetic null and is removed again, whichever form the value has.
  for (const wire of [{ type: 'pick', row: 2, note: null }, { type: 'pick', column: 3, note: null }]) {
    validateSchema([wire], strict);
    const normalized = normalizeCommandValue([wire], native, native);
    assert.deepEqual(normalized, [Object.fromEntries(Object.entries(wire).filter(([, value]) => value !== null))]);
    validateSchema(normalized, native);
  }
  for (const mixed of [{ type: 'pick', row: 2, column: 3 }, { type: 'pick', row: 2, column: null }])
    assert.throws(() => validateSchema(normalizeCommandValue([mixed], native, native), native), error => /^commands\[0\]\.(row|column)$/.test(error.details.path));
  // Forbidden means forbidden even where unknown properties would otherwise pass.
  const open = { type: 'object', properties: { gone: false } };
  validateSchema({ other: 1 }, open);
  assert.throws(() => validateSchema({ gone: 1 }, open), error => error.details.path === 'commands.gone');
});

test('a tuple that allows no further items refuses them', () => {
  const pair = { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false };
  validateSchema([1, 2], pair);
  assert.throws(() => validateSchema([1, 2, 3], pair), error => error.details.path === 'commands[2]');
});

test('the spreadsheet lookup command is offered and accepted in each of its three forms', () => {
  const { strict } = commandSchemas(root, 'spreadsheet');
  const dereference = value => value.$ref ? dereference(strict.$defs[value.$ref.split('/').at(-1)]) : value;
  const offered = dereference(strict.items).anyOf.map(dereference).filter(value => value.properties.type.enum?.[0] === 'cells.setByLookup');
  assert.deepEqual(offered.map(value => ['updates', 'value'].filter(key => key in value.properties)), [['updates'], ['updates'], ['value']]);
  assert.deepEqual(offered.map(value => Object.keys(dereference(value.properties.lookup).properties)), [['axis', 'column', 'value'], ['axis', 'row', 'value'], ['axis', 'row', 'column']]);

  const base = { type: 'cells.setByLookup', sheetId: 'sheet-1', range: 'A1:D9' }, unset = { lookIn: null, matchCase: null, onMultiple: null, onNotFound: null, onConflict: null };
  const forms = [
    { lookup: { axis: 'rows', column: 1, value: 'East' }, updates: [{ column: 3, value: '10' }] },
    { lookup: { axis: 'columns', row: 1, value: 'Q1' }, updates: [{ row: 3, value: '10' }] },
    { lookup: { axis: 'both', row: { column: 1, value: 'East' }, column: { row: 1, value: 'Q1' } }, value: '10' },
  ];
  for (const form of forms) {
    // As the model sends it, with every optional field stated as null, and as a caller writes it.
    validateSchema([{ ...base, ...unset, ...form }], strict);
    assert.deepEqual(normalizeCommands(root, 'spreadsheet', [{ ...base, ...unset, ...form }]), [{ ...base, ...form }]);
    assert.deepEqual(normalizeCommands(root, 'spreadsheet', [{ ...base, ...form }]), [{ ...base, ...form }]);
  }
  // The row form may leave its axis out; the model then states it as null.
  assert.deepEqual(normalizeCommands(root, 'spreadsheet', [{ ...base, ...unset, lookup: { axis: null, column: 1, value: 'East' }, updates: [] }]), [{ ...base, lookup: { column: 1, value: 'East' }, updates: [] }]);
  // Fields of one form are refused in another.
  for (const mixed of [{ ...forms[0], value: '10' }, { lookup: { ...forms[0].lookup, row: 2 }, updates: [] }, { lookup: forms[2].lookup, updates: [] }])
    assert.throws(() => normalizeCommands(root, 'spreadsheet', [{ ...base, ...mixed }]), error => error.details.code === 'invalid_argument');
});

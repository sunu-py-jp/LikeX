import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/model-entry.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { createForm, normalizeForm, executeFormCommands: execute, serializeForm, parseForm, getFormField, getDefaultFormAnswers, getVisibleFormFields, validateFormAnswers, normalizeFormAnswers } = api;
const sample = () => createForm({ id: 'survey', title: 'Review', fields: [{ id: 'name', type: 'text', label: 'Name', required: true, minLength: 2, maxLength: 5 }, { id: 'age', type: 'number', label: 'Age', min: 18, max: 99 }, { id: 'followup', type: 'checkbox', label: 'Follow up' }, { id: 'date', type: 'date', label: 'Date', required: true, visibleWhen: { fieldId: 'followup', operator: 'equals', value: true } }] });
test('definition roundtrip is deterministic, immutable and independent of answer data', () => {
 const form = sample(), saved = serializeForm(form); assert.equal(serializeForm(parseForm(saved)), saved); assert.ok(Object.isFrozen(form.fields[0]));
 assert.deepEqual(getDefaultFormAnswers(form), { name: '', age: null, followup: false, date: '' }); assert.equal(getFormField(form, 'name').label, 'Name'); assert.equal(getFormField(form, 'none'), null);
});
test('commands add edit reorder remove fields atomically and preserve IDs', () => {
 const form = sample(), next = execute(form, [{ type: 'field.add', index: 1, field: { id: 'note', type: 'textarea', label: 'Note' } }, { type: 'field.update', fieldId: 'name', patch: { label: 'Full name' } }, { type: 'field.move', fieldId: 'note', index: 4 }]);
 assert.equal(next.fields.at(-1).id, 'note'); assert.equal(form.fields[0].label, 'Name');
 assert.throws(() => execute(form, [{ type: 'form.update', patch: { title: 'Partial' } }, { type: 'field.delete', fieldIds: ['missing'] }])); assert.equal(form.title, 'Review');
 assert.equal(execute(form, [{ type: 'field.delete', fieldIds: ['followup'] }]).fields.find(field => field.id === 'date').visibleWhen, undefined);
 assert.throws(() => execute(form, [{ type: 'field.add', field: { id: 'name', type: 'text', label: 'Duplicate' } }]));
});
test('invalid JSON, references, versions, unsafe keys and oversized input are rejected', () => {
 const form = sample(); assert.throws(() => normalizeForm({ ...form, version: 2 })); assert.throws(() => normalizeForm({ ...form, answers: {} }));
 assert.throws(() => execute(form, [{ type: 'field.update', fieldId: 'followup', patch: { visibleWhen: { fieldId: 'date', operator: 'notEmpty' } } }]));
 assert.throws(() => createForm({ fields: [{ id: '__proto__', type: 'text', label: 'Bad' }] }));
 assert.throws(() => parseForm(' '.repeat(api.FORM_LIMITS.jsonBytes + 1))); assert.throws(() => normalizeFormAnswers(form, { unknown: 'X' })); assert.throws(() => normalizeFormAnswers(form, { age: Infinity }));
});
test('only visible fields participate in submission and required validation', () => {
 const form = sample(); assert.deepEqual(getVisibleFormFields(form, {}).map(field => field.id), ['name', 'age', 'followup']);
 let result = validateFormAnswers(form, { name: 'Alex', age: 30, date: '2026-09-22' }); assert.equal(result.valid, true); assert.equal(Object.hasOwn(result.values, 'date'), false);
 result = validateFormAnswers(form, { name: 'A', age: 12, followup: true, date: '2026-02-30' }); assert.deepEqual(result.errors.map(error => error.fieldId), ['name', 'age', 'date']);
 result = validateFormAnswers(form, { name: 'Alex', age: 30, followup: true, date: '2026-02-28' }); assert.equal(result.valid, true);
});
test('typed choices and required checkboxes validate with clear per-field results', () => {
 const form = createForm({ fields: [{ id: 'choice', type: 'select', label: 'Choice', required: true, options: [{ value: 'a', label: 'A' }] }, { id: 'terms', type: 'checkbox', label: 'Terms', required: true }] });
 assert.equal(validateFormAnswers(form, { choice: 'a', terms: true }).valid, true);
 assert.deepEqual(validateFormAnswers(form, { choice: 'b', terms: false }).errors.map(error => error.fieldId), ['choice', 'terms']);
 assert.throws(() => createForm({ fields: [{ type: 'select', label: 'Bad', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] }] }));
});

test('accessor-backed input and oversized condition text are rejected without running getters',()=>{
 let reads=0;const form=sample();
 const answers={get name(){reads++;return 'Alex';}};
 assert.throws(()=>normalizeFormAnswers(form,answers),/getter/);assert.equal(reads,0);
 const hostile={...form};Object.defineProperty(hostile,'title',{enumerable:true,get(){reads++;return 'Injected';}});
 assert.throws(()=>normalizeForm(hostile),/getter/);assert.equal(reads,0);
 assert.throws(()=>execute(form,{type:'field.update',fieldId:'date',patch:{visibleWhen:{fieldId:'name',operator:'contains',value:'x'.repeat(api.FORM_LIMITS.text+1)}}}));
});

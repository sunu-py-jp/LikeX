import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: {
  contents: 'export * from "./src/state/use-workbook-draft"; export { createWorkbook, setCellValues } from "./src/model"; export { initialSheetSelection } from "./src/state/selection";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'history-state-test.ts',
}, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'same-react', setup(builder) {
  builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useWorkbookDraft, createWorkbook, setCellValues, initialSheetSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

async function mount(t, overrides = {}) {
  let draft, renderer, props = { initialWorkbook: createWorkbook(), onSave() {}, ...overrides };
  const selectionRef = { current: initialSheetSelection(props.initialWorkbook.sheets[0]) };
  const selection = { selectionRef, setSelection: next => { selectionRef.current = next; } };
  function Probe() { draft = useWorkbookDraft(props); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    get c() { return draft; },
    commit: value => draft.applyTransaction(workbook => setCellValues(workbook, 'sheet-1', { A1: value }), selection),
    step: (direction, options) => draft.changeHistory(direction, () => {}, options),
    value: () => draft.workbookRef.current.sheets[0].cells.A1?.value,
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Probe))); },
  };
}

test('GUI publication uses the shared cap, synchronous history queries and every Undo/Redo snapshot', async t => {
  let current; const observed = [];
  const ui = await mount(t, { onChange: () => observed.push(current.getHistoryState()) });
  current = ui.c;
  const initialState = ui.c.getHistoryState();
  await act(async () => {
    for (let number = 1; number <= 55; number++) assert.equal(ui.commit(String(number)).ok, true);
    assert.equal(ui.c.getHistoryState().undoCount, 50);
    for (let number = 0; number < 50; number++) assert.equal(ui.step('past'), true);
    assert.equal(ui.step('past'), false); assert.equal(ui.value(), '5');
    assert.deepEqual(ui.c.getHistoryState(), { canUndo: false, canRedo: true, undoCount: 0, redoCount: 50 });
    for (let number = 0; number < 50; number++) assert.equal(ui.step('future'), true);
    assert.equal(ui.step('future'), false); assert.equal(ui.value(), '55');
  });
  assert.equal(Object.isFrozen(initialState), true); assert.equal(initialState.undoCount, 0);
  assert.equal(observed[0].undoCount, 1); assert.equal(observed[54].undoCount, 50);
  assert.equal(ui.c.canUndo, true); assert.equal(ui.c.canRedo, false);
});

test('disabled edits invalidate obsolete GUI history and an accepted save clears the shared engine', async t => {
  const ui = await mount(t);
  await act(async () => ui.commit('one'));
  await ui.update({ features: { undoRedo: false } });
  await act(async () => { assert.equal(ui.step('past'), false); assert.equal(ui.commit('two').ok, true); });
  await ui.update({ features: { undoRedo: true } });
  assert.equal(ui.c.getHistoryState().undoCount, 0);
  await act(async () => { assert.equal(ui.step('past'), false); ui.commit('three'); });
  assert.equal(ui.c.getHistoryState().undoCount, 1);
  await act(async () => assert.equal(await ui.c.save({ commitEdit: () => true, hasPendingEdits: () => false, resetView() {} }), true));
  assert.deepEqual(ui.c.getHistoryState(), { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 });
  assert.equal(ui.c.dirty, false); assert.equal(ui.value(), 'three');
});

test('external history rechecks pending editors after asynchronous permission without consuming the entry', async t => {
  const ui = await mount(t);
  await act(async () => ui.commit('changed'));
  await ui.update({ readOnly: true });
  let grant, request, checks = 0, isCurrent = false;
  await ui.update({ readOnly: false, onEditRequest: value => { request = value; checks++; return new Promise(resolve => { grant = resolve; }); } });
  const options = { source: 'api', isCurrent: () => isCurrent };
  await act(async () => assert.equal(ui.step('past', options), false));
  assert.equal(checks, 0);
  isCurrent = true;
  let pending;
  await act(async () => { pending = ui.step('past', options); });
  assert.equal(request.source, 'api'); assert.equal(request.action, 'undo');
  isCurrent = false;
  await act(async () => { grant(true); assert.equal(await pending, false); });
  assert.equal(ui.value(), 'changed'); assert.equal(ui.c.getHistoryState().undoCount, 1);
  isCurrent = true;
  await act(async () => assert.equal(ui.step('past', options), true));
  assert.equal(ui.value(), undefined); assert.equal(ui.c.getHistoryState().redoCount, 1);
});

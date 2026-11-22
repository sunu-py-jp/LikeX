import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/editor/create-model-editor-controller.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createModelEditorController, MODEL_EDITOR_HISTORY_LIMITS: historyLimits } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const seed = () => ({ title: 'Original', value: 0, items: [] });
const adapter = {
  normalize(input) { if (!input || typeof input.title !== 'string' || !Number.isFinite(input.value) || !Array.isArray(input.items)) throw new Error('Invalid model'); return { title: input.title, value: input.value, items: [...input.items] }; },
  serialize: JSON.stringify,
  features: ['edit', 'structure', 'import', 'history'],
  getCommandFeatures: command => command.type === 'replace' ? ['import'] : [command.type === 'item' ? 'structure' : 'edit'],
  execute(input, commands) { const next = structuredClone(input); for (const command of commands) { if (command.type === 'set') next.value = command.value; else if (command.type === 'item') next.items.push(command.value); else if (command.type === 'replace') return command.model; else throw new Error('Invalid command'); } return next; },
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const edit = value => ({ type: 'set', value });
const editor = (options = {}) => createModelEditorController(adapter, seed(), { onSave() {}, ...options });

test('readonly defaults, feature checks and no-ops precede any permission request', async () => {
  let requests = 0; const readonly = createModelEditorController(adapter, seed(), { onEditRequest() { requests++; return true; } });
  assert.equal(await readonly.execute(edit(1)), null); assert.equal(await readonly.replace({ ...seed(), value: 2 }), null); assert.equal(await readonly.runTask('edit', async () => {}), false);
  const c = editor({ onEditRequest() { requests++; return true; }, features: { structure: false } });
  assert.equal(await c.execute(edit(0)), null); assert.equal(await c.execute({ type: 'item', value: 'x' }), null); assert.equal(requests, 0); assert.equal(c.getSnapshot().canUndo, false);
});
test('permitted edits commit synchronously without an asynchronous permission hook', async () => {
  const c = editor(); const pending = c.execute(edit(2)); assert.equal(c.getModel().value, 2); await pending;
  assert.equal(await c.undo(), true); assert.equal(c.getModel().value, 0); assert.equal(await c.redo(), true);
});
test('permission denial and rejection leave content/history unchanged and provide a notice', async () => {
  for (const onEditRequest of [() => false, async () => { throw new Error('Denied by host'); }]) {
    const c = editor({ onEditRequest }); assert.equal(await c.execute(edit(3)), null); assert.equal(c.getModel().value, 0); assert.equal(c.getSnapshot().editMode, 'view'); assert.equal(c.getSnapshot().busy, null); assert.equal(c.getSnapshot().canUndo, false); assert.equal(c.getSnapshot().notice.kind, 'error');
  }
});
test('commands are captured at invocation, never reinterpreted after async permission', async () => {
  const approval = deferred(), c = editor({ onEditRequest: () => approval.promise });
  const command = edit(4), pending = c.execute(command); command.value = 88; approval.resolve(true);
  assert.equal((await pending).value, 4);
});
test('cancel, changed policy and dispose invalidate pending permission including after reactivation', async () => {
  for (const invalidate of [c => c.cancelPending(), c => c.configure({ onSave() {}, readOnly: true }), c => c.configure({ onSave() {}, features: { edit: false } }), c => { c.dispose(); c.activate(); }]) {
    const approval = deferred(), c = editor({ onEditRequest: () => approval.promise }); const pending = c.execute(edit(5)); await Promise.resolve(); invalidate(c); approval.resolve(true); assert.equal(await pending, null); assert.equal(c.getModel().value, 0); assert.equal(c.getSnapshot().busy, null);
  }
});
test('cancelled permissions settle without waiting for an uncooperative host and handle late rejection', async () => {
  for (const invalidate of [c => c.cancelEditRequest(), c => c.configure({ onSave() {}, readOnly: true }), c => c.configure({ onSave() {}, features: { edit: false } }), c => c.dispose()]) {
    const waiting = deferred(), c = editor({ onEditRequest: () => waiting.promise });
    const pending = c.execute(edit(5)); await Promise.resolve();
    invalidate(c);
    const timedOut = Symbol('timed out');
    let timer;
    const result = await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve(timedOut), 100); })]);
    clearTimeout(timer);
    assert.equal(result, null, 'cancellation resolves the command before the permission handler finishes');
    assert.equal(c.getModel().value, 0);
    waiting.reject(new Error('late host failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(c.getModel().value, 0);
  }
});
test('runTask cannot start in the microtask gap after cancellation or replacement', async () => {
  for (const invalidate of [c => c.cancelPending(), c => c.replace({ ...seed(), value: 20 }), c => { c.dispose(); c.activate(); }]) {
    const c = editor(); let called = false; const pending = c.runTask('edit', async task => { called = true; task.apply(edit(99)); });
    invalidate(c); assert.equal(await pending, false); assert.equal(called, false); assert.notEqual(c.getModel().value, 99);
  }
});
test('streamed task updates remain one Undo unit across long delays and stale callbacks cannot apply', async () => {
  const c = editor(), waiting = deferred(); let taskContext; const oldNow = Date.now; let clock = 100; Date.now = () => clock;
  try {
    const pending = c.runTask('edit', async context => { taskContext = context; context.apply(edit(1)); clock += 5000; context.apply(edit(2)); await waiting.promise; context.apply(edit(3)); });
    await Promise.resolve(); await Promise.resolve(); c.cancelPending(); waiting.resolve(); assert.equal(await pending, false); assert.equal(taskContext.signal.aborted, true); assert.equal(c.getModel().value, 2); assert.equal(taskContext.apply(edit(6)), null); assert.equal(await c.undo(), true); assert.equal(c.getModel().value, 0); assert.equal(await c.undo(), false);
  } finally { Date.now = oldNow; }
});
test('prepare results do not survive cancellation, policy changes or dispose/reactivate', async () => {
  for (const invalidate of [c => c.cancelPending(), c => c.configure({ onSave() {}, features: { import: false } }), c => { c.dispose(); c.activate(); }]) {
    const wait = deferred(), c = editor(); let signal;
    const pending = c.prepare(async (_model, context) => { signal = context.signal; await wait.promise; return edit(7); }, { feature: 'import' });
    invalidate(c); wait.resolve(); assert.equal(await pending, null); assert.equal(signal.aborted, true); assert.equal(c.getModel().value, 0);
  }
});
test('save baseline preserves history and reconciled host results emit a save change', async () => {
  const events = [], c = editor({ onSave: model => ({ ...model, title: 'Server title' }), onEvent: event => events.push(event) });
  await c.execute(edit(3)); assert.equal(await c.save(), true); assert.equal(c.getSnapshot().dirty, false); assert.equal(c.getModel().title, 'Server title'); assert.ok(events.some(event => event.type === 'change' && event.source === 'save'));
  assert.equal(await c.undo(), true); assert.equal(c.getSnapshot().dirty, true); assert.equal(await c.redo(), true); assert.equal(c.getSnapshot().dirty, false);
});
test('save before-hook false/throw and host errors preserve draft and history', async () => {
  for (const before of [() => false, () => { throw new Error('Validation failed'); }]) { let saves = 0; const c = editor({ onBeforeSave: before, onSave() { saves++; } }); await c.execute(edit(1)); assert.equal(await c.save(), false); assert.equal(saves, 0); assert.equal(c.getSnapshot().dirty, true); assert.equal(c.getSnapshot().canUndo, true); assert.equal(c.getSnapshot().busy, null); }
  const c = editor({ onSave: async () => { throw new Error('Network failed'); } }); await c.execute(edit(1)); assert.equal(await c.save(), false); assert.match(c.getSnapshot().notice.text, /Network failed/);
});
test('old save completions cannot alter a new lifetime or commit after readOnly changes', async () => {
  for (const invalidate of [c => c.configure({ onSave() {}, readOnly: true }), c => { c.dispose(); c.activate(); }]) {
    const wait = deferred(), c = editor({ onSave: () => wait.promise }); await c.execute(edit(1)); const pending = c.save(); await Promise.resolve(); invalidate(c); wait.resolve({ ...seed(), value: 99 }); assert.equal(await pending, false); assert.equal(c.getModel().value, 1); assert.equal(c.getSnapshot().dirty, true);
  }
});
test('observer errors and retained host payloads cannot mutate committed models/history', async () => {
  const initial = seed(); let payload; const c = createModelEditorController(adapter, initial, { onSave() {}, onChange(value) { payload = value; throw new Error('Observer'); }, onEvent() { return Promise.reject(new Error('Observer async')); } });
  initial.items.push('outside'); assert.deepEqual(c.getModel().items, []); await c.execute({ type: 'item', value: 'inside' }); assert.throws(() => payload.items.push('outside'), TypeError); assert.equal(c.getSnapshot().dirty, true); await c.undo(); assert.deepEqual(c.getModel().items, []);
});
test('history checks the feature requirements of the operation at replay time', async () => {
  const c = editor(); await c.execute({ type: 'item', value: 'a' }); c.configure({ onSave() {}, features: { structure: false } }); assert.equal(await c.undo(), false); assert.deepEqual(c.getModel().items, ['a']); c.configure({ onSave() {} }); assert.equal(await c.undo(), true); c.configure({ onSave() {}, features: { structure: false } }); assert.equal(await c.redo(), false);
});

test('explicit edit lifecycle publishes state without changing content or history', async () => {
  let requests = 0; const states = [];
  const c = editor({ onEditRequest: () => { requests++; return true; } });
  c.subscribe(() => states.push(c.getEditState()));
  assert.equal(c.getEditState(), 'view');
  assert.equal(await c.requestEdit(), true); assert.equal(c.getEditState(), 'edit');
  assert.deepEqual(c.getModel(), seed()); assert.equal(c.getSnapshot().dirty, false); assert.equal(c.getSnapshot().canUndo, false);
  assert.equal(await c.requestEdit(), true); assert.equal(requests, 1);
  assert.equal(c.endEdit(), true); assert.equal(c.getEditState(), 'view');
  assert.ok(states.includes('requesting')); assert.ok(states.includes('edit'));
  await c.execute(edit(2)); assert.equal(c.endEdit(), false); assert.equal(c.getEditState(), 'edit');
  assert.equal(c.discard(), true); assert.equal(c.getEditState(), 'view'); assert.equal(c.getSnapshot().dirty, false);
  assert.equal(c.getSnapshot().canUndo, false); assert.equal(c.getModel().value, 0);
});

test('explicit edit entry works without a hook and respects readonly and registered editing flags', async () => {
  const c = editor(); let notifications = 0; c.subscribe(() => notifications++);
  assert.equal(await c.requestEdit(), true); assert.equal(c.getSnapshot().editMode, 'edit'); assert.equal(notifications, 1);
  const readonly = createModelEditorController(adapter, seed()); assert.equal(await readonly.requestEdit(), false);
  let requests = 0;
  const gated = createModelEditorController({ ...adapter, features: [...adapter.features, 'editing'] }, seed(), { onSave() {}, features: { editing: false }, onEditRequest() { requests++; return true; } });
  assert.equal(await gated.requestEdit(), false); assert.equal(requests, 0); assert.equal(gated.getEditState(), 'view');
});

test('permission-only cancellation cannot cancel a save and ignores stale permission results', async () => {
  const approval = deferred(); let permissionContext;
  const c = editor({ onEditRequest: (_request, context) => { permissionContext = context; return approval.promise; } });
  const pending = c.requestEdit(); await Promise.resolve();
  assert.equal(c.endEdit(), false); c.cancelEditRequest(); assert.equal(permissionContext.signal.aborted, true);
  approval.resolve(true); assert.equal(await pending, false); assert.equal(c.getEditState(), 'view'); assert.equal(c.getSnapshot().busy, null);
  const saving = deferred(); let saveContext;
  c.configure({ onSave(_model, context) { saveContext = context; return saving.promise; } });
  await c.execute(edit(1)); const save = c.save(); await Promise.resolve();
  c.cancelEditRequest(); assert.equal(saveContext.signal.aborted, false); assert.equal(c.getSnapshot().busy, 'save');
  saving.resolve(); assert.equal(await save, true);
});

test('save callbacks share a cancellation context and registered save flag gates dispatch', async () => {
  const waiting = deferred(), contexts = [], events = [];
  const c = editor({ onBeforeSave(_model, context) { contexts.push(context); }, onSave(_model, context) { contexts.push(context); return waiting.promise; }, onEvent: event => events.push(event) });
  await c.execute(edit(1)); const pending = c.save(); await Promise.resolve();
  assert.equal(contexts.length, 2); assert.equal(contexts[0], contexts[1]); assert.equal(typeof contexts[0].requestId, 'string');
  c.cancelPending(); assert.equal(contexts[0].signal.aborted, true); waiting.resolve(); assert.equal(await pending, false);
  assert.equal(c.getSnapshot().dirty, true); assert.equal(events.filter(event => event.type === 'save' && event.phase === 'cancelled').length, 1);
  let saves = 0;
  const gated = createModelEditorController({ ...adapter, features: [...adapter.features, 'save'] }, seed(), { onSave() { saves++; }, features: { save: false } });
  await gated.execute(edit(3)); assert.equal(await gated.save(), false); assert.equal(saves, 0); assert.equal(gated.getSnapshot().dirty, true);
});

test('refresh protects dirty drafts by default and replaces the saved baseline only after success', async () => {
  let loads = 0; const events = [], dirty = [], c = editor({ onRefresh() { loads++; return { ...seed(), title: 'Reloaded', value: 5 }; }, onEvent: event => events.push(event), onDirtyChange: value => dirty.push(value) });
  await c.execute(edit(1)); assert.equal(await c.refresh(), false); assert.equal(loads, 0);
  assert.equal(c.getModel().value, 1); assert.equal(c.getSnapshot().canUndo, true); assert.equal(c.getSnapshot().dirty, true);
  assert.equal(await c.refresh({ discardChanges: true }), true); assert.equal(loads, 1);
  assert.equal(c.getModel().value, 5); assert.equal(c.getModel().title, 'Reloaded'); assert.equal(c.getSnapshot().dirty, false);
  assert.equal(c.getSnapshot().canUndo, false); assert.equal(c.getSnapshot().canRedo, false); assert.equal(c.getEditState(), 'view');
  assert.deepEqual(dirty, [true, false]); assert.ok(events.some(event => event.type === 'change' && event.source === 'refresh'));
  await c.execute(edit(6)); assert.equal(c.discard(), true); assert.equal(c.getModel().value, 5); assert.equal(c.getSnapshot().dirty, false);
});

test('refresh is available in readonly mode and feature denial prevents the host call', async () => {
  const c = createModelEditorController(adapter, seed(), { onRefresh: () => ({ ...seed(), value: 3 }) });
  assert.equal(c.getSnapshot().readOnly, true); assert.equal(await c.refresh(), true); assert.equal(c.getModel().value, 3);
  assert.equal(c.getSnapshot().dirty, false); assert.equal(c.getSnapshot().readOnly, true);
  let calls = 0;
  const gated = createModelEditorController({ ...adapter, features: [...adapter.features, 'refresh'] }, seed(), { features: { refresh: false }, onRefresh() { calls++; return seed(); } });
  assert.equal(await gated.refresh(), false); assert.equal(calls, 0);
  assert.equal(await editor().refresh(), false);
});

test('failed refresh leaves draft, saved baseline and undo history intact', async () => {
  for (const onRefresh of [() => ({ ...seed(), value: NaN }), async () => { throw new Error('Refresh failed'); }]) {
    const c = editor({ onRefresh }); await c.execute(edit(2));
    assert.equal(await c.refresh({ discardChanges: true }), false); assert.equal(c.getModel().value, 2);
    assert.equal(c.getSnapshot().dirty, true); assert.equal(c.getSnapshot().canUndo, true); assert.equal(c.getSnapshot().busy, null);
    assert.equal(c.getSnapshot().notice.kind, 'error'); assert.equal(await c.undo(), true);
    assert.equal(c.getModel().value, 0); assert.equal(c.getSnapshot().dirty, false);
  }
});

test('refresh cancellation, handler changes and disposal abort old loads and ignore their results', async () => {
  for (const invalidate of [c => c.cancelPending(), c => c.configure({ onSave() {}, onRefresh: () => seed() }), c => { c.dispose(); c.activate(); }]) {
    const waiting = deferred(); let context; const events = [];
    const c = editor({ onRefresh(value) { context = value; return waiting.promise; }, onEvent: event => events.push(event) });
    const pending = c.refresh(); assert.equal(c.getSnapshot().busy, 'refresh'); assert.equal(c.getSnapshot().editable, false);
    assert.equal(await c.execute(edit(4)), null); assert.equal(await c.requestEdit(), false); assert.equal(c.endEdit(), false);
    invalidate(c); assert.equal(context.signal.aborted, true); waiting.resolve({ ...seed(), value: 99 });
    assert.equal(await pending, false); assert.equal(c.getModel().value, 0); assert.equal(c.getSnapshot().busy, null);
    assert.equal(events.some(event => event.type === 'refresh' && event.phase === 'success'), false);
  }
});

test('render-time permission wrappers do not cancel an active request', async () => {
  const waiting = deferred(); let signal;
  const request = (_request, context) => { signal = context.signal; return waiting.promise; };
  const c = editor({ onEditRequest: (...args) => request(...args) });
  const pending = c.requestEdit(); await Promise.resolve();
  c.configure({ onSave() {}, onEditRequest: (...args) => request(...args) }); assert.equal(signal.aborted, false);
  waiting.resolve(true); assert.equal(await pending, true); assert.equal(c.getEditState(), 'edit');
});

test('synchronous cancellation from lifecycle observers prevents host dispatch', async () => {
  let saves = 0, refreshes = 0;
  const c = editor({ onSave() { saves++; }, onRefresh() { refreshes++; return seed(); }, onEvent(event) { if ((event.type === 'save' || event.type === 'refresh') && event.phase === 'start') c.cancelPending(); } });
  await c.execute(edit(1)); assert.equal(await c.save(), false); assert.equal(saves, 0);
  assert.equal(await c.refresh({ discardChanges: true }), false); assert.equal(refreshes, 0);
  assert.equal(c.getModel().value, 1); assert.equal(c.getSnapshot().dirty, true); assert.equal(c.getSnapshot().busy, null);
});

// Every edit without a history group is its own undo step. `value` counts the edits, so it also tells which step is current.
const weighted = getHistoryWeight => createModelEditorController({ ...adapter, getHistoryWeight }, seed(), { onSave() {} });
async function editTimes(controller, count, from = 1) { for (let value = from; value < from + count; value++) await controller.execute(edit(value)); }
async function undoAll(controller) { let steps = 0; while (await controller.undo()) steps++; return steps; }
async function redoAll(controller) { let steps = 0; while (await controller.redo()) steps++; return steps; }

test('history without a weight hook keeps the latest 100 steps', async () => {
  assert.deepEqual(historyLimits, { entries: 100, weight: 64 * 1024 * 1024, protectedEntries: 5 }); assert.ok(Object.isFrozen(historyLimits));
  const c = editor(); await editTimes(c, 130);
  assert.equal(await undoAll(c), 100); assert.equal(c.getModel().value, 30); assert.equal(c.getSnapshot().canUndo, false);
  assert.equal(await redoAll(c), 100); assert.equal(c.getModel().value, 130);
});

test('light weighted models and invalid weights keep the same 100 steps', async () => {
  const light = Math.floor(historyLimits.weight / 101);
  for (const weight of [() => light, () => 0, () => -5, () => NaN, () => Infinity, () => '900000000', () => undefined]) {
    const c = weighted(weight); await editTimes(c, 130);
    assert.equal(await undoAll(c), 100); assert.equal(c.getModel().value, 30);
  }
});

test('weighted history drops the oldest steps first and keeps redo intact', async () => {
  const calls = [], tenth = Math.floor(historyLimits.weight / 10);
  const c = weighted(model => { calls.push(model.value); return tenth; });
  await editTimes(c, 30);
  // The current model and nine earlier ones fill the budget.
  assert.equal(c.getSnapshot().canUndo, true);
  assert.equal(await undoAll(c), 9); assert.equal(c.getModel().value, 21); assert.equal(c.getSnapshot().canUndo, false);
  assert.equal(await redoAll(c), 9); assert.equal(c.getModel().value, 30); assert.equal(c.getSnapshot().canRedo, false);
  // Undo and redo move the same models around, so they never drop a step.
  assert.equal(await undoAll(c), 9); assert.equal(await redoAll(c), 9);
  assert.equal(await c.undo(), true); assert.equal(c.getModel().value, 29);
  // Each model is weighed once, when it becomes the current model.
  assert.deepEqual(calls, Array.from({ length: 31 }, (_unused, value) => value));
});

test('models that fill the budget exactly are all kept', async () => {
  const c = weighted(() => historyLimits.weight / 8); await editTimes(c, 20);
  assert.equal(await undoAll(c), 7); assert.equal(c.getModel().value, 13);
});

test('the latest steps stay even when a single model exceeds the budget', async () => {
  const c = weighted(() => historyLimits.weight * 2); await editTimes(c, 12);
  assert.equal(await undoAll(c), historyLimits.protectedEntries); assert.equal(c.getModel().value, 12 - historyLimits.protectedEntries);
  assert.equal(await redoAll(c), historyLimits.protectedEntries);
});

test('a model that grows heavy trims older steps, and lighter models fill the history again', async () => {
  const heavy = historyLimits.weight / 8 - 1000, c = weighted(model => model.value >= 50 && model.value <= 58 ? heavy : 1);
  await editTimes(c, 49); assert.equal(await undoAll(c), 49); await redoAll(c);
  // Eight heavy models (50..57) and the 50 light ones before them fit the budget.
  await editTimes(c, 8, 50); assert.equal(await undoAll(c), 57); await redoAll(c);
  // The ninth does not: the light steps and the oldest heavy one go, the newest eight models stay.
  await editTimes(c, 1, 58); assert.equal(await undoAll(c), 7); assert.equal(c.getModel().value, 51); await redoAll(c);
  // Light edits continue. The heavy steps fit beside them, so only the count limit removes steps now.
  await editTimes(c, 200, 59); assert.equal(await undoAll(c), 100); assert.equal(c.getModel().value, 158);
});

test('grouped edits are weighed by their latest model and keep their undo step', async () => {
  const half = historyLimits.weight / 2 - 1000, c = weighted(model => model.value >= 100 ? half : 1);
  await editTimes(c, 20);
  // One group: a light model, then two heavy ones. Each replaces the current model without adding a step.
  for (const value of [21, 100, 101]) await c.execute(edit(value), { historyGroup: 'typing' });
  assert.equal(await undoAll(c), 21); assert.equal(c.getModel().value, 0); await redoAll(c); assert.equal(c.getModel().value, 101);
  // A second heavy model still fits. The third does not, so older steps go and the protected ones stay.
  await c.execute(edit(102)); assert.equal(await undoAll(c), 22); await redoAll(c);
  await c.execute(edit(103)); assert.equal(await undoAll(c), historyLimits.protectedEntries); assert.equal(c.getModel().value, 18);
  // A group whose current model outgrows the budget drops old steps without adding one, and keeps the step it started from.
  const grown = weighted(model => model.value >= 100 ? historyLimits.weight : 1); await editTimes(grown, 20);
  for (const value of [21, 100]) await grown.execute(edit(value), { historyGroup: 'typing' });
  assert.equal(await grown.undo(), true); assert.equal(grown.getModel().value, 20);
  assert.equal(await undoAll(grown), historyLimits.protectedEntries - 1); assert.equal(grown.getModel().value, 16);
});

test('refresh, discard and save keep the current weight in step with the current model', async () => {
  const getHistoryWeight = model => model.value >= 1000 ? historyLimits.weight : 1, heavy = { ...seed(), value: 1000 };
  const create = (initial, options = {}) => createModelEditorController({ ...adapter, getHistoryWeight }, initial, { onSave() {}, ...options });
  // Ten light edits keep ten steps when they start from a light model. A heavy starting model is the
  // oldest step and leaves once more than the protected steps exist, which leaves nine.
  const stepsAfter = async controller => { await editTimes(controller, 10); return undoAll(controller); };

  const refreshedToLight = create(heavy, { onRefresh: () => seed() });
  assert.equal(await refreshedToLight.refresh(), true); assert.equal(await stepsAfter(refreshedToLight), 10); assert.equal(refreshedToLight.getModel().value, 0);

  const refreshedToHeavy = create(seed(), { onRefresh: () => heavy });
  assert.equal(await refreshedToHeavy.refresh(), true); await refreshedToHeavy.execute(edit(5)); assert.equal(refreshedToHeavy.discard(), true);
  assert.equal(refreshedToHeavy.getModel().value, 1000); assert.equal(await stepsAfter(refreshedToHeavy), 9); assert.equal(refreshedToHeavy.getModel().value, 1);

  const discardedToLight = create(seed());
  await discardedToLight.execute(edit(1000)); assert.equal(discardedToLight.discard(), true);
  assert.equal(await stepsAfter(discardedToLight), 10); assert.equal(discardedToLight.getModel().value, 0);

  // Saving makes the heavy model the baseline, with or without a reconciled result from the host.
  for (const [first, onSave] of [[1000, () => {}], [1, model => ({ ...model, value: model.value + 1000 })]]) {
    const saved = create(seed(), { onSave });
    await saved.execute(edit(first)); assert.equal(await saved.save(), true);
    await saved.execute(edit(5)); assert.equal(saved.discard(), true); assert.ok(saved.getModel().value >= 1000);
    assert.equal(await stepsAfter(saved), 9); assert.equal(saved.getModel().value, 1);
  }
});

test('weight trimming keeps the feature requirements of the remaining steps', async () => {
  const c = weighted(() => historyLimits.weight / 10); await editTimes(c, 20); await c.execute({ type: 'item', value: 'a' }); await editTimes(c, 3, 21);
  c.configure({ onSave() {}, features: { structure: false } });
  assert.equal(await undoAll(c), 3); assert.equal(c.getSnapshot().canUndo, false); assert.deepEqual(c.getModel().items, ['a']);
  c.configure({ onSave() {} }); assert.equal(await undoAll(c), 6); assert.deepEqual(c.getModel().items, []);
});

test('a failing weight hook rejects the edit without leaving a partial change', async () => {
  let fail = false; const c = weighted(() => { if (fail) throw new Error('Weight failed'); return 1; });
  await editTimes(c, 2); fail = true;
  assert.equal(await c.execute(edit(3)), null); assert.equal(c.getModel().value, 2); assert.match(c.getSnapshot().notice.text, /Weight failed/);
  fail = false; assert.equal(await undoAll(c), 2); assert.equal(await redoAll(c), 2); assert.equal(c.getSnapshot().busy, null);
});

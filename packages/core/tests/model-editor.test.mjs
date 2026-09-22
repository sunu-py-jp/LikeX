import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../src/editor/create-model-editor-controller.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createModelEditorController } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useSlideEditor } from './src/state/use-slide-editor.ts';
  export { createSlideDeck, createSlideElement } from './src/model/index.ts';
  export { openOfficePackage } from './src/ooxml.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useSlideEditor, createSlideDeck, createSlideElement, openOfficePackage } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rename = title => ({ type: 'deck.rename', title });

async function mount(t, supplied = {}) {
  let editor, renderer, unmounted = false;
  let props = { initialDeck: createSlideDeck({ id: 'deck', title: 'Original' }), onSave() {}, ...supplied };
  function Probe() { editor = useSlideEditor(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  const unmount = async () => { if (!unmounted) { unmounted = true; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { get editor() { return editor; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); } };
}

function inputBuffer(app, command = rename('Buffered edit')) {
  let pending = false, commit;
  const flush = () => {
    if (!pending) return;
    commit = app.editor.execute(command);
    pending = false;
    app.editor.refreshPendingInput();
  };
  const unregister = app.editor.registerInputFlush(flush, () => pending, () => { pending = false; });
  return {
    type() { pending = true; app.editor.refreshPendingInput(); },
    cancel() { pending = false; app.editor.refreshPendingInput(); },
    blur: flush, unregister,
    get commit() { return commit; },
    get pending() { return pending; },
  };
}

test('explicit read-only and omitted persistence prevent all edits without asking permission', async t => {
  for (const options of [{ readOnly: true }, { onSave: undefined }]) {
    const permissions = [], events = [];
    const app = await mount(t, { ...options, onEditRequest: () => { permissions.push(1); return true; }, onEvent: event => events.push(event) });
    const before = app.editor.deck;
    await change(async () => {
      assert.equal(await app.editor.execute(rename('Blocked')), null);
      assert.equal(await app.editor.history('undo'), false);
      assert.equal(await app.editor.save(), false);
    });
    assert.equal(app.editor.deck, before);
    assert.equal(app.editor.dirty, false);
    assert.equal(permissions.length, 0);
    assert.equal(events.filter(event => event.type === 'change' || event.type === 'save').length, 0);
  }
});

test('invalid commands and semantic no-ops do not acquire an edit session', async t => {
  let permissions = 0;
  const app = await mount(t, { onEditRequest: () => { permissions++; return true; } });
  await change(async () => {
    assert.equal(await app.editor.execute(rename('Original')), null);
    assert.equal(await app.editor.execute({ type: 'slide.delete', slideId: 'missing' }), null);
  });
  assert.equal(permissions, 0);
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.canUndo, false);
});

test('an asynchronous edit request waits without changes and rejection retains the original deck', async t => {
  const decision = deferred(), events = [], requests = [];
  const app = await mount(t, { onEditRequest: (request, context) => { requests.push({ request, context }); return decision.promise; }, onEvent: event => events.push(event) });
  let pending;
  await change(() => { pending = app.editor.execute(rename('Denied')); });
  assert.equal(app.editor.requesting, true);
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.canUndo, false);
  assert.equal(requests[0].request.deck.title, 'Original');
  await change(async () => { decision.resolve(false); assert.equal(await pending, null); });
  assert.equal(app.editor.requesting, false);
  assert.equal(app.editor.deck.title, 'Original');
  assert.match(app.editor.notice.text, /他のユーザー/);
  assert.deepEqual(events.filter(event => event.type === 'edit-mode').map(event => event.mode), ['requesting', 'view']);
  assert.equal(events.filter(event => event.type === 'change').length, 0);
});

test('granted permission is shared by queued commands and each applies to the latest deck', async t => {
  const decision = deferred(); let permissions = 0;
  const app = await mount(t, { onEditRequest: () => { permissions++; return decision.promise; } });
  let first, second;
  await change(() => {
    first = app.editor.execute(rename('Granted'));
    second = app.editor.execute({ type: 'slide.add', slide: { id: 'new', name: 'New' } });
  });
  assert.equal(permissions, 1);
  assert.equal(app.editor.deck.slides.length, 1);
  await change(async () => { decision.resolve(true); assert.ok((await first)?.changed); assert.ok((await second)?.changed); });
  assert.equal(app.editor.deck.title, 'Granted');
  assert.equal(app.editor.deck.slides.length, 2);
  assert.equal(app.editor.selection.slideId, 'new');
  assert.equal(app.editor.dirty, true);
});

test('read-only changes and unmount abort pending permission and ignore its late approval', async t => {
  for (const reason of ['readonly', 'unmount']) {
    const decision = deferred(), events = []; let context;
    const app = await mount(t, { onEditRequest: (_request, value) => { context = value; return decision.promise; }, onEvent: event => events.push(event) });
    const before = app.editor.deck; let pending;
    await change(() => { pending = app.editor.execute(rename('Too late')); });
    if (reason === 'readonly') await app.update({ readOnly: true }); else await app.unmount();
    assert.equal(context.signal.aborted, true);
    await change(async () => { decision.resolve(true); assert.equal(await pending, null); });
    assert.equal(app.editor.deck, before);
    assert.equal(events.filter(event => event.type === 'change').length, 0);
  }
});

test('save is awaited, blocks overlapping edits and failure retains the draft and its history', async t => {
  const saving = deferred(), events = [], payloads = [];
  const app = await mount(t, { onSave: deck => { payloads.push(deck); return saving.promise; }, onEvent: event => events.push(event) });
  await change(() => app.editor.execute(rename('Changed')));
  const changed = app.editor.deck;
  let pending;
  await change(() => { pending = app.editor.save(); });
  assert.equal(app.editor.busy, 'save');
  assert.equal(app.editor.dirty, true);
  await change(async () => {
    assert.equal(await app.editor.save(), false);
    assert.equal(await app.editor.execute(rename('Overlap')), null);
    assert.equal(await app.editor.history('undo'), false);
    app.editor.discard();
  });
  assert.equal(payloads.length, 1);
  payloads[0].title = 'Host mutation';
  assert.equal(app.editor.deck, changed);
  await change(async () => { saving.reject(Error('offline')); assert.equal(await pending, false); });
  assert.equal(app.editor.busy, null);
  assert.equal(app.editor.deck, changed);
  assert.equal(app.editor.dirty, true);
  assert.equal(app.editor.canUndo, true);
  assert.deepEqual(events.filter(event => event.type === 'save').map(event => event.phase), ['start', 'error']);
});

test('save validation may cancel, while successful canonical saves keep undo and redo available', async t => {
  let allow = false, saves = 0;
  const app = await mount(t, { onBeforeSave: () => allow, onSave: deck => { saves++; return { ...deck, title: 'Canonical' }; } });
  await change(() => app.editor.execute(rename('Changed')));
  await change(async () => { assert.equal(await app.editor.save(), false); });
  assert.equal(saves, 0);
  assert.equal(app.editor.dirty, true);
  allow = true;
  await change(async () => { assert.equal(await app.editor.save(), true); });
  assert.equal(app.editor.deck.title, 'Canonical');
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.canUndo, true);
  await change(async () => { assert.equal(await app.editor.history('undo'), true); });
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.dirty, true);
  await change(async () => { assert.equal(await app.editor.history('redo'), true); });
  assert.equal(app.editor.deck.title, 'Canonical');
  assert.equal(app.editor.dirty, false);
});

test('unmount during save validation does not start a new persistence request', async t => {
  const validation = deferred(), events = []; let saves = 0;
  const app = await mount(t, { onBeforeSave: () => validation.promise, onSave: () => { saves++; }, onEvent: event => events.push(event) });
  await change(() => app.editor.execute(rename('Changed')));
  let pending;
  await change(() => { pending = app.editor.save(); });
  await app.unmount();
  const count = events.length;
  await change(async () => { validation.resolve(true); assert.equal(await pending, false); });
  assert.equal(saves, 0);
  assert.equal(events.length, count);
});

test('late save success or failure after unmount cannot publish further events', async t => {
  for (const succeeds of [true, false]) {
    const saving = deferred(), events = [];
    const app = await mount(t, { onSave: () => saving.promise, onEvent: event => events.push(event) });
    await change(() => app.editor.execute(rename('Changed')));
    let pending;
    await change(() => { pending = app.editor.save(); });
    await app.unmount();
    const count = events.length;
    await change(async () => {
      if (succeeds) saving.resolve(); else saving.reject(Error('offline'));
      assert.equal(await pending, false);
    });
    assert.equal(events.length, count);
  }
});

test('moving a multiple selection preserves all selected elements through undo and redo', async t => {
  const app = await mount(t);
  const slideId = app.editor.deck.slides[0].id;
  await change(() => app.editor.execute([
    { type: 'element.add', slideId, element: { type: 'text', id: 'first', x: 10, y: 20 } },
    { type: 'element.add', slideId, element: { type: 'shape', id: 'second', x: 200, y: 50 } },
  ]));
  assert.deepEqual(app.editor.selection, { slideId, elementIds: ['first', 'second'] });
  await change(() => app.editor.execute([
    { type: 'element.update', slideId, elementId: 'first', patch: { x: 40, y: 60 } },
    { type: 'element.update', slideId, elementId: 'second', patch: { x: 230, y: 90 } },
  ]));
  assert.deepEqual(app.editor.selection.elementIds, ['first', 'second']);
  assert.deepEqual(app.editor.deck.slides[0].elements.map(({ x, y }) => [x, y]), [[40, 60], [230, 90]]);
  await change(async () => { assert.equal(await app.editor.history('undo'), true); });
  assert.deepEqual(app.editor.selection, { slideId, elementIds: ['first', 'second'] });
  assert.deepEqual(app.editor.deck.slides[0].elements.map(({ x, y }) => [x, y]), [[10, 20], [200, 50]]);
  await change(async () => { assert.equal(await app.editor.history('redo'), true); });
  assert.deepEqual(app.editor.selection, { slideId, elementIds: ['first', 'second'] });
  assert.deepEqual(app.editor.deck.slides[0].elements.map(({ x, y }) => [x, y]), [[40, 60], [230, 90]]);
});

test('save immediately after a blur edit waits for permission and persists the completed text edit', async t => {
  const permission = deferred(), payloads = [];
  const initialDeck = createSlideDeck({ slides: [{ id: 'one', name: 'One', background: '#fff', notes: '',
    elements: [createSlideElement({ type: 'text', id: 'text', text: 'Before' })] }] });
  const app = await mount(t, { initialDeck, onEditRequest: () => permission.promise,
    onSave: deck => { payloads.push(deck); } });
  let editing, saving;
  await change(() => {
    editing = app.editor.execute({ type: 'element.update', slideId: 'one', elementId: 'text', patch: { text: 'After blur' } });
    saving = app.editor.save();
  });
  assert.equal(app.editor.busy, 'save');
  assert.equal(app.editor.deck.slides[0].elements[0].text, 'Before');
  assert.equal(payloads.length, 0);
  await change(async () => {
    permission.resolve(true);
    assert.equal((await editing).changed, true);
    assert.equal(await saving, true);
  });
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].slides[0].elements[0].text, 'After blur');
  assert.equal(app.editor.deck.slides[0].elements[0].text, 'After blur');
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.canUndo, true);
});

test('save flushes focused input before deciding whether the deck has unsaved edits', async t => {
  const permission = deferred(), payloads = [];
  const app = await mount(t, { onEditRequest: () => permission.promise, onSave: deck => { payloads.push(deck); } });
  let flushes = 0, editing, saving;
  const unregister = app.editor.registerInputFlush(() => {
    flushes++;
    editing = app.editor.execute(rename('Focused input'));
  });
  await change(() => { saving = app.editor.save(); });
  assert.equal(flushes, 1);
  assert.equal(app.editor.busy, 'save');
  assert.equal(payloads.length, 0);
  await change(async () => {
    permission.resolve(true);
    assert.equal((await editing).changed, true);
    assert.equal(await saving, true);
  });
  assert.equal(payloads[0].title, 'Focused input');
  assert.equal(app.editor.dirty, false);
  unregister();
});

test('no-op and rejected imports do not add selection history without a matching deck change', async t => {
  const initialDeck = createSlideDeck({ title: 'Original', slides: [{ id: 'one', name: 'One', background: '#fff', notes: '',
    elements: [createSlideElement({ type: 'text', id: 'first' }), createSlideElement({ type: 'text', id: 'second' })] }] });
  const events = [];
  const app = await mount(t, { initialDeck, onEvent: event => events.push(event) });
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['first'] }));
  await change(() => app.editor.execute(rename('One edit')));
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['second'] }));
  const before = app.editor.deck;
  await change(() => app.editor.importJson(JSON.stringify(before)));
  assert.equal(app.editor.deck, before);
  await change(() => app.editor.importJson('{"version":2}'));
  assert.equal(app.editor.deck, before);
  assert.equal(events.filter(event => event.type === 'change' && event.source === 'import').length, 0);
  await change(() => app.editor.execute(rename('Two edits')));
  await change(async () => { assert.equal(await app.editor.history('undo'), true); });
  assert.equal(app.editor.deck.title, 'One edit');
  await change(async () => { assert.equal(await app.editor.history('undo'), true); });
  assert.equal(app.editor.deck.title, 'Original');
  assert.deepEqual(app.editor.selection, { slideId: 'one', elementIds: ['first'] });
  assert.equal(app.editor.canUndo, false);
});

test('typing reports dirty before blur and an accepted async commit never emits a clean gap', async t => {
  const decision = deferred(), changes = [];
  const app = await mount(t, { onEditRequest: () => decision.promise, onDirtyChange: value => changes.push(value) });
  const input = inputBuffer(app);
  await change(() => input.type());
  assert.equal(app.editor.dirty, true);
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.canUndo, false);
  assert.deepEqual(changes, [false, true]);
  await change(() => input.blur());
  assert.equal(app.editor.requesting, true);
  assert.equal(app.editor.dirty, true);
  assert.deepEqual(changes, [false, true]);
  await change(async () => { decision.resolve(true); assert.equal((await input.commit).changed, true); });
  assert.equal(app.editor.deck.title, 'Buffered edit');
  assert.equal(app.editor.dirty, true);
  assert.deepEqual(changes, [false, true]);
  await change(async () => { assert.equal(await app.editor.save(), true); });
  assert.equal(app.editor.dirty, false);
  assert.deepEqual(changes, [false, true, false]);
  input.unregister();
});

test('an async edit refusal clears only the pending input after the decision arrives', async t => {
  const decision = deferred(), changes = [];
  const app = await mount(t, { onEditRequest: () => decision.promise, onDirtyChange: value => changes.push(value) });
  const input = inputBuffer(app);
  await change(() => input.type());
  await change(() => input.blur());
  assert.equal(app.editor.dirty, true);
  assert.deepEqual(changes, [false, true]);
  await change(async () => { decision.resolve(false); assert.equal(await input.commit, null); });
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.canUndo, false);
  assert.deepEqual(changes, [false, true, false]);
  input.unregister();
});

test('cancelling input or discarding it clears pending dirty without persisting the buffer', async t => {
  for (const cancel of ['escape', 'discard']) {
    const changes = [];
    const app = await mount(t, { onDirtyChange: value => changes.push(value) });
    const input = inputBuffer(app);
    await change(() => input.type());
    await change(() => cancel === 'escape' ? input.cancel() : app.editor.discard());
    assert.equal(input.pending, false);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.deck.title, 'Original');
    assert.equal(app.editor.canUndo, false);
    assert.deepEqual(changes, [false, true, false]);
    input.unregister();
  }
});

test('cancelling an input buffer cannot clear dirty changes already committed to the deck', async t => {
  const changes = [];
  const app = await mount(t, { onDirtyChange: value => changes.push(value) });
  await change(() => app.editor.execute(rename('Committed edit')));
  const input = inputBuffer(app);
  await change(() => input.type());
  await change(() => input.cancel());
  assert.equal(app.editor.dirty, true);
  assert.equal(app.editor.deck.title, 'Committed edit');
  assert.deepEqual(changes, [false, true]);
  input.unregister();
});

test('discard invalidates the buffered command even if its edit permission arrives later', async t => {
  const decision = deferred(), changes = [];
  const app = await mount(t, { onEditRequest: () => decision.promise, onDirtyChange: value => changes.push(value) });
  const input = inputBuffer(app);
  await change(() => input.type());
  await change(() => input.blur());
  await change(() => app.editor.discard());
  assert.equal(app.editor.dirty, false);
  await change(async () => { decision.resolve(true); assert.equal(await input.commit, null); });
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.dirty, false);
  assert.equal(app.editor.canUndo, false);
  assert.deepEqual(changes, [false, true, false]);
  input.unregister();
});

test('read-only invalidates an uncommitted buffer and unmount prevents later dirty notifications', async t => {
  for (const reason of ['readonly', 'unmount']) {
    const decision = deferred(), changes = [];
    const app = await mount(t, { onEditRequest: () => decision.promise, onDirtyChange: value => changes.push(value) });
    const input = inputBuffer(app);
    await change(() => input.type());
    if (reason === 'readonly') {
      await app.update({ readOnly: true });
      assert.equal(input.pending, false);
      assert.equal(app.editor.dirty, false);
      assert.deepEqual(changes, [false, true, false]);
    } else {
      await change(() => input.blur());
      await app.unmount();
      const before = [...changes];
      await change(async () => { decision.resolve(true); assert.equal(await input.commit, null); });
      assert.deepEqual(changes, before);
    }
    assert.equal(app.editor.deck.title, 'Original');
    input.unregister();
  }
});

test('handle and GUI exports await buffered input permission and preserve unsaved history', async t => {
  let downloadedBlob;
  t.mock.method(URL, 'createObjectURL', blob => { downloadedBlob = blob; return 'blob:export-test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  for (const mode of ['handle-pptx', 'download-pptx', 'download-slon']) {
    const permission = deferred(), events = [], dirtyChanges = [];
    const ref = { current: null }; let saves = 0, clicks = 0, exporting, finished = false;
    downloadedBlob = undefined;
    const initialDeck = createSlideDeck({ title: 'Export', slides: [{ id: 'one', name: 'One', background: '#fff', notes: '',
      elements: [createSlideElement({ type: 'text', id: 'text', text: 'Before export' })] }] });
    const app = await mount(t, { ref, initialDeck, onEditRequest: () => permission.promise,
      onSave: () => { saves++; }, onEvent: event => events.push(event), onDirtyChange: value => dirtyChanges.push(value) });
    const input = inputBuffer(app, { type: 'element.update', slideId: 'one', elementId: 'text', patch: { text: 'Latest buffered text' } });
    const document = { createElement: () => ({ click() { clicks++; }, remove() {} }), body: { append() {} } };
    await change(() => input.type());
    await change(() => {
      exporting = (mode === 'handle-pptx' ? ref.current.exportPptx()
        : app.editor.download(mode === 'download-slon' ? 'slon' : 'pptx', document)).then(result => { finished = true; return result; });
    });
    assert.equal(app.editor.busy, 'export');
    assert.equal(app.editor.deck.slides[0].elements[0].text, 'Before export');
    assert.equal(finished, false);
    assert.equal(clicks, 0);
    let result;
    await change(async () => {
      permission.resolve(true);
      assert.equal((await input.commit).changed, true);
      result = await exporting;
    });
    const blob = mode === 'handle-pptx' ? result : downloadedBlob;
    assert.ok(blob instanceof Blob);
    if (mode === 'download-slon') {
      assert.equal(blob.type, 'application/json');
      assert.equal(JSON.parse(await blob.text()).format, 'likex.slide');
      assert.equal(JSON.parse(await blob.text()).slides[0].elements[0].text, 'Latest buffered text');
    } else {
      const archive = await openOfficePackage(blob);
      const xml = new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'));
      assert.match(xml, /<a:t(?:\s[^>]*)?>Latest buffered text<\/a:t>/);
      assert.doesNotMatch(xml, /Before export/);
    }
    assert.equal(clicks, mode === 'handle-pptx' ? 0 : 1);
    assert.equal(saves, 0);
    assert.equal(events.filter(event => event.type === 'save').length, 0);
    assert.equal(app.editor.busy, null);
    assert.equal(app.editor.dirty, true);
    assert.equal(app.editor.canUndo, true);
    assert.equal(app.editor.canRedo, false);
    assert.deepEqual(dirtyChanges, [false, true]);
    await change(async () => { assert.equal(await app.editor.history('undo'), true); });
    assert.equal(app.editor.deck.slides[0].elements[0].text, 'Before export');
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, false);
    assert.equal(app.editor.canRedo, true);
    input.unregister();
  }
});

test('native downloads use .slon with JSON MIME and replace recognized filename suffixes', async t => {
  let blob;
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:slon-test'; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const app = await mount(t);
  for (const [exportFileName, expected] of [
    [undefined, 'Original.slon'], ['報告書', '報告書.slon'], ['報告書.json', '報告書.slon'],
    ['報告書.SLON', '報告書.slon'], ['報告書.pptx', '報告書.slon'], ['.slon', 'presentation.slon'],
  ]) {
    await app.update({ exportFileName });
    let filename;
    const document = { createElement: () => ({ click() { filename = this.download; }, remove() {} }), body: { append() {} } };
    await change(() => app.editor.download('slon', document));
    assert.equal(filename, expected);
    assert.equal(blob.type, 'application/json');
    assert.deepEqual(JSON.parse(await blob.text()), app.editor.deck);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, false);
  }
});

test('read-only and omitted onSave allow export without edit permission or history changes', async t => {
  for (const options of [{ readOnly: true }, { onSave: undefined }]) {
    const ref = { current: null }, events = []; let requests = 0;
    const app = await mount(t, { ref, ...options, onEditRequest: () => { requests++; return false; }, onEvent: event => events.push(event) });
    const before = app.editor.deck;
    let blob;
    await change(async () => { blob = await ref.current.exportPptx(); });
    const archive = await openOfficePackage(blob);
    assert.ok(archive.paths.includes('ppt/slides/slide1.xml'));
    assert.equal(app.editor.deck, before);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, false);
    assert.equal(app.editor.canRedo, false);
    assert.equal(app.editor.busy, null);
    assert.equal(requests, 0);
    assert.deepEqual(events.filter(event => event.type === 'save' || event.type === 'change'), []);
  }
});

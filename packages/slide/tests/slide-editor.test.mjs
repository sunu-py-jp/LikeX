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
  export { createSlideDeck, createSlideElement, createSlideSvgSource, parseSlideDeck, serializeSlideDeck, prepareSlideConditionalEdit } from './src/model/index.ts';
  export { openOfficePackage } from './src/ooxml.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
} }] });
const { useSlideEditor, createSlideDeck, createSlideElement, createSlideSvgSource, parseSlideDeck, serializeSlideDeck, prepareSlideConditionalEdit, openOfficePackage } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const rename = title => ({ type: 'deck.rename', title });

test('prepared image commands reject changed targets during decoding and permission waits', async t => {
  for (const changed of ['slide', 'slide-return', 'deck']) {
    let permissions = 0;
    const app = await mount(t, { onEditRequest: () => { permissions++; return true; } });
    await change(() => app.editor.execute({ type: 'slide.add', slide: { id: 'other' } }));
    const target = { deck: app.editor.deck, slideId: app.editor.selection.slideId };
    const image = deferred(); let pending;
    await change(() => { pending = app.editor.prepareCommands(() => image.promise, target); });
    if (changed.startsWith('slide')) {
      await change(() => app.editor.select({ slideId: app.editor.deck.slides[0].id, elementIds: [] }));
      if (changed === 'slide-return') await change(() => app.editor.select({ slideId: target.slideId, elementIds: [] }));
    }
    else await change(() => app.editor.execute(rename('Updated while decoding')));
    const before = app.editor.deck;
    await change(async () => { image.resolve({ type: 'element.add', slideId: target.slideId, element: { type: 'shape' } }); assert.equal(await pending, null); });
    assert.equal(app.editor.deck, before);
    assert.equal(permissions, 1);
  }
  const decision = deferred();
  const deck = createSlideDeck({ slides: ['one', 'two'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  const app = await mount(t, { initialDeck: deck, onEditRequest: () => decision.promise });
  let pending;
  await change(() => { pending = app.editor.prepareCommands(async () => ({ type: 'element.add', slideId: 'one', element: { type: 'shape' } }), { deck: app.editor.deck, slideId: 'one' }); });
  assert.equal(app.editor.requesting, true);
  await change(() => app.editor.select({ slideId: 'two', elementIds: [] }));
  await change(async () => { decision.resolve(true); assert.equal(await pending, null); });
  assert.equal(app.editor.deck.slides[0].elements.length, 0);
  assert.equal(app.editor.canUndo, false);
});

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

test('opening at a page or stable ID is view-only and later navigation works in readonly mode', async t => {
  const deck = createSlideDeck({ slides: ['one', 'two', 'three'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  for (const initial of [{ initialPageNumber: 2 }, { initialSlideId: 'two' }, { initialPageNumber: 2, initialSlideId: 'two' }]) {
    const ref = { current: null }, selections = [];
    const app = await mount(t, { initialDeck: deck, ...initial, ref, readOnly: true, onSelectionChange: value => selections.push(value) });
    assert.equal(ref.current.getPageNumber(), 2); assert.equal(app.editor.selection.slideId, 'two');
    await app.update({ initialPageNumber: 3, initialSlideId: undefined });
    assert.equal(ref.current.getPageNumber(), 2);
    await change(() => assert.equal(ref.current.goToPage(3), true));
    assert.equal(app.editor.selection.slideId, 'three'); assert.equal(selections.at(-1).slideId, 'three');
    assert.equal(app.editor.dirty, false); assert.equal(app.editor.canUndo, false); assert.equal(app.editor.deck, deck);
    for (const number of [undefined, 0, 4, 1.2, NaN, Infinity, 3]) assert.equal(ref.current.goToPage(number), false);
    const retained = ref.current; await app.unmount(); assert.equal(retained.goToPage(1), false);
  }
  for (const target of [{ initialPageNumber: 0 }, { initialPageNumber: 4 }, { initialSlideId: 'missing' }, { initialPageNumber: 1, initialSlideId: 'two' }]) {
    const app = await mount(t, { initialDeck: deck, ...target });
    assert.equal(app.editor.selection.slideId, 'one'); assert.equal(app.editor.notice.kind, 'error'); assert.equal(app.editor.dirty, false);
  }
});

test('page-targeted native import validates before replacement and preserves undo selection', async t => {
  const next = createSlideDeck({ id: 'other-deck', slides: ['first', 'second'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  const ref = { current: null }, app = await mount(t, { ref });
  const before = app.editor.deck, originalSelection = app.editor.selection;
  await change(() => ref.current.importNative(serializeSlideDeck(next), null));
  assert.equal(app.editor.deck, before); assert.equal(app.editor.notice.kind, 'error');
  await change(() => ref.current.importNative(serializeSlideDeck(next), { pageNumber: 3 }));
  assert.equal(app.editor.deck, before); assert.equal(app.editor.canUndo, false); assert.equal(app.editor.notice.kind, 'error');
  await change(() => ref.current.importNative(serializeSlideDeck(next), { pageNumber: 2, slideId: 'second' }));
  assert.equal(ref.current.getPageNumber(), 2); assert.equal(app.editor.selection.slideId, 'second');
  await change(() => ref.current.undo());
  assert.equal(app.editor.deck, before); assert.deepEqual(app.editor.selection, originalSelection);
  await change(() => ref.current.redo());
  assert.equal(ref.current.getPageNumber(), 2);
});

test('page navigation does not discard unfinished input or interrupt a pending import', async t => {
  const deck = createSlideDeck({ slides: ['one', 'two'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  const ref = { current: null }, app = await mount(t, { initialDeck: deck, ref });
  const buffer = inputBuffer(app);
  await change(() => buffer.type()); assert.equal(ref.current.goToPage(2), false); assert.equal(buffer.pending, true);
  await change(() => buffer.cancel());
  const waiting = deferred(); let pending;
  await change(() => { pending = ref.current.importNative({ size: 10, text: () => waiting.promise }, { pageNumber: 2 }); });
  assert.equal(ref.current.goToPage(2), false);
  await change(async () => { waiting.resolve(serializeSlideDeck(deck)); await pending; });
  assert.equal(ref.current.getPageNumber(), 2);
});

test('PPTX imports accept a page target and invalid targets leave the existing draft untouched', async t => {
  const sourceRef = { current: null };
  await mount(t, { ref: sourceRef, initialDeck: createSlideDeck({ slides: ['Overview', 'Architecture'].map(name => ({ id: name, name, notes: '', background: '#fff', elements: [] })) }) });
  let pptx;
  await change(async () => { pptx = await sourceRef.current.exportPptx(); });
  const ref = { current: null }, app = await mount(t, { ref }), before = app.editor.deck;
  await change(() => ref.current.importPptx(pptx, { pageNumber: 3 }));
  assert.equal(app.editor.deck, before); assert.equal(app.editor.canUndo, false); assert.equal(app.editor.notice.kind, 'error');
  await change(() => ref.current.importPptx(pptx, { pageNumber: 2 }));
  assert.equal(ref.current.getPageNumber(), 2); assert.equal(app.editor.deck.slides[1].name, 'Architecture');
  await change(() => ref.current.undo());
  assert.equal(app.editor.deck, before);
});

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
  await change(() => app.editor.importNative(serializeSlideDeck(before)));
  assert.equal(app.editor.deck, before);
  await change(() => app.editor.importNative('{"version":2}'));
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

test('rejected native imports preserve selection, the saved baseline and redo history', async t => {
  const initialDeck = createSlideDeck({ title: 'Original', slides: [{ id: 'one', name: 'One', background: '#fff', notes: '',
    elements: [createSlideElement({ type: 'text', id: 'first' }), createSlideElement({ type: 'text', id: 'second' })] }] });
  const events = [], ref = { current: null };
  const app = await mount(t, { ref, initialDeck, onEvent: event => events.push(event) });
  await change(() => app.editor.execute(rename('Saved title')));
  await change(() => app.editor.save());
  await change(() => app.editor.execute(rename('Future title')));
  await change(() => app.editor.history('undo'));
  await change(() => app.editor.select({ slideId: 'one', elementIds: ['second'] }));
  const before = app.editor.deck, selection = structuredClone(app.editor.selection);
  const valid = JSON.parse(serializeSlideDeck(before));
  const { format, ...unmarked } = valid;
  const missingLayer = structuredClone(valid);
  delete missingLayer.slides[0].elements[0].stackOrder;
  const changes = events.filter(event => event.type === 'change').length;
  for (const file of [unmarked, { ...valid, version: 2 }, before, missingLayer]) {
    await change(() => ref.current.importNative(JSON.stringify(file)));
    assert.equal(app.editor.deck, before);
    assert.deepEqual(app.editor.selection, selection);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, true);
    assert.equal(app.editor.canRedo, true);
    assert.equal(events.filter(event => event.type === 'import').length, 0);
    assert.equal(events.filter(event => event.type === 'change').length, changes);
  }
  await change(() => app.editor.history('redo'));
  assert.equal(app.editor.deck.title, 'Future title');
  assert.equal(app.editor.dirty, true);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck.title, 'Saved title');
  assert.equal(app.editor.dirty, false);
});

test('native ref import flushes queued edits and restores their selection and content on undo', async t => {
  const ref = { current: null }, permission = deferred(), events = [];
  let saves = 0, importing;
  const initialDeck = createSlideDeck({ title: 'Original', slides: [{ id: 'original', name: 'Original', background: '#fff', notes: '',
    elements: [createSlideElement({ type: 'text', id: 'text', text: 'Before' })] }] });
  const incoming = createSlideDeck({ id: 'incoming', title: 'Imported', slides: [{ id: 'new-slide', name: 'Imported', background: '#fff', notes: 'Imported notes', elements: [] }] });
  const app = await mount(t, { ref, initialDeck, onEditRequest: () => permission.promise,
    onSave: () => { saves++; }, onEvent: event => events.push(event) });
  await change(() => ref.current.select({ slideId: 'original', elementIds: ['text'] }));
  const input = inputBuffer(app, { type: 'element.update', slideId: 'original', elementId: 'text', patch: { text: 'Before import' } });
  await change(() => input.type());
  await change(() => { importing = ref.current.importNative(new Blob([serializeSlideDeck(incoming)], { type: 'application/json' })); });
  assert.equal(app.editor.busy, 'import');
  assert.equal(app.editor.deck, initialDeck);
  await change(async () => {
    assert.equal(await ref.current.execute(rename('Overlap')), null);
    assert.equal(await ref.current.save(), false);
    assert.equal(await ref.current.undo(), false);
    await assert.rejects(ref.current.exportNative(), /別の処理中/);
    permission.resolve(true);
    await importing;
  });
  assert.deepEqual(ref.current.getDeck(), incoming);
  assert.deepEqual(ref.current.getSelection(), { slideId: 'new-slide', elementIds: [] });
  assert.equal(app.editor.dirty, true);
  assert.equal(saves, 0);
  assert.equal(events.filter(event => event.type === 'import').length, 1);
  assert.deepEqual(events.filter(event => event.type === 'change').map(event => event.source), ['command', 'import']);
  await change(async () => { assert.equal(await ref.current.undo(), true); });
  assert.equal(ref.current.getDeck().slides[0].elements[0].text, 'Before import');
  assert.deepEqual(ref.current.getSelection(), { slideId: 'original', elementIds: ['text'] });
  await change(async () => { assert.equal(await ref.current.undo(), true); });
  assert.deepEqual(ref.current.getDeck(), initialDeck);
  assert.equal(app.editor.dirty, false);
  await change(async () => { await ref.current.redo(); await ref.current.redo(); });
  assert.deepEqual(ref.current.getDeck(), incoming);
  input.unregister();
});

test('native ref import respects read-only, feature and permission guards before reading the file', async t => {
  for (const options of [{ readOnly: true }, { onSave: undefined }, { features: { import: false } }, { onEditRequest: () => false }]) {
    const ref = { current: null }, events = []; let reads = 0;
    const app = await mount(t, { ref, ...options, onEvent: event => events.push(event) });
    const before = app.editor.deck;
    const file = { size: 1, async text() { reads++; return serializeSlideDeck(createSlideDeck()); } };
    await change(() => ref.current.importNative(file));
    assert.equal(reads, 0);
    assert.equal(app.editor.deck, before);
    assert.equal(app.editor.busy, null);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, false);
    assert.deepEqual(events.filter(event => event.type === 'import' || event.type === 'change'), []);
  }
});

test('native file reads hold the operation reservation and discard stale results after permission or lifecycle changes', async t => {
  for (const reason of ['readonly', 'disabled', 'unmount']) {
    const ref = { current: null }, reading = deferred(), events = [];
    const incoming = serializeSlideDeck(createSlideDeck({ title: 'Late import' }));
    const app = await mount(t, { ref, onEvent: event => events.push(event) });
    const before = app.editor.deck; let importing, reads = 0;
    await change(() => { importing = ref.current.importNative({ size: incoming.length, text: () => reading.promise }); });
    assert.equal(app.editor.busy, 'import');
    await change(async () => {
      await ref.current.importNative({ size: 1, async text() { reads++; return incoming; } });
      assert.equal(await ref.current.execute(rename('During read')), null);
      await assert.rejects(ref.current.exportNative(), /別の処理中/);
    });
    assert.equal(reads, 0);
    if (reason === 'readonly') {
      await app.update({ readOnly: true });
      await app.update({ readOnly: false }); // Reopening editing must not revive the old operation.
    } else if (reason === 'disabled') await app.update({ features: { import: false } });
    else await app.unmount();
    const previousEvents = events.length;
    await change(async () => { reading.resolve(incoming); await importing; });
    assert.equal(app.editor.deck, before);
    assert.equal(app.editor.dirty, false);
    assert.equal(events.length, previousEvents);
    assert.equal(events.filter(event => event.type === 'import' || event.type === 'change').length, 0);
  }
});

test('native ref export enforces the current feature flag including changes while awaiting buffered input', async t => {
  const ref = { current: null }, permission = deferred();
  const app = await mount(t, { ref, features: { export: false }, onEditRequest: () => permission.promise });
  await change(() => assert.rejects(ref.current.exportNative(), /機能は無効/));
  await app.update({ features: { export: true } });
  const input = inputBuffer(app);
  await change(() => input.type());
  let exporting;
  await change(() => { exporting = ref.current.exportNative(); });
  await app.update({ features: { export: false } });
  await change(async () => { permission.resolve(true); await assert.rejects(exporting, /機能は無効/); });
  assert.equal(app.editor.busy, null);
  assert.equal(app.editor.deck.title, 'Buffered edit');
  assert.equal(app.editor.dirty, true);
  input.unregister();
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
  for (const mode of ['handle-pptx', 'handle-slon', 'download-pptx', 'download-slon']) {
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
      exporting = (mode === 'handle-pptx' ? ref.current.exportPptx() : mode === 'handle-slon' ? ref.current.exportNative()
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
    const blob = mode.startsWith('handle-') ? result : downloadedBlob;
    assert.ok(blob instanceof Blob);
    if (mode.endsWith('-slon')) {
      assert.equal(blob.type, 'application/json');
      assert.equal(JSON.parse(await blob.text()).format, 'likex.slide');
      assert.equal(JSON.parse(await blob.text()).slides[0].elements[0].text, 'Latest buffered text');
    } else {
      const archive = await openOfficePackage(blob);
      const xml = new TextDecoder().decode(await archive.read('ppt/slides/slide1.xml'));
      assert.match(xml, /<a:t(?:\s[^>]*)?>Latest buffered text<\/a:t>/);
      assert.doesNotMatch(xml, /Before export/);
    }
    assert.equal(clicks, mode.startsWith('handle-') ? 0 : 1);
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
    assert.equal(JSON.parse(await blob.text()).version, 1);
    assert.deepEqual(parseSlideDeck(await blob.text()), app.editor.deck);
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
    await change(async () => { blob = await ref.current.exportNative(); });
    assert.deepEqual(parseSlideDeck(await blob.text()), before);
    assert.equal(app.editor.deck, before);
    assert.equal(app.editor.dirty, false);
    assert.equal(app.editor.canUndo, false);
    assert.equal(app.editor.canRedo, false);
    assert.equal(app.editor.busy, null);
    assert.equal(requests, 0);
    assert.deepEqual(events.filter(event => event.type === 'save' || event.type === 'change'), []);
  }
});

test('drag commands with an internal baseline cancel when another queued command changes the deck', async t => {
  const decision = deferred();
  const initialDeck = createSlideDeck({ slides: ['one', 'two'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  const app = await mount(t, { initialDeck, onEditRequest: () => decision.promise });
  const expectedDeck = app.editor.deck;
  let first, drag;
  await change(() => {
    first = app.editor.execute(rename('Concurrent edit'));
    drag = app.editor.execute({ type: 'slide.move', slideId: 'one', index: 1 }, expectedDeck);
  });
  await change(async () => { decision.resolve(true); assert.ok((await first)?.changed); assert.equal(await drag, null); });
  assert.equal(app.editor.deck.title, 'Concurrent edit');
  assert.deepEqual(app.editor.deck.slides.map(slide => slide.id), ['one', 'two']);
  await change(async () => { assert.equal(await app.editor.execute({ type: 'slide.move', slideId: 'one', index: 1 }, expectedDeck), null); });
  await change(async () => { assert.equal(await app.editor.history('undo'), true); assert.equal(await app.editor.history('undo'), false); });
});

test('a drag baseline permits the unchanged deck after asynchronous permission', async t => {
  const decision = deferred();
  const initialDeck = createSlideDeck({ slides: ['one', 'two'].map(id => ({ id, name: id, notes: '', background: '#fff', elements: [] })) });
  const app = await mount(t, { initialDeck, onEditRequest: () => decision.promise });
  let drag;
  await change(() => { drag = app.editor.execute({ type: 'slide.move', slideId: 'one', index: 1 }, app.editor.deck); });
  await change(async () => { decision.resolve(true); assert.ok((await drag)?.changed); });
  assert.deepEqual(app.editor.deck.slides.map(slide => slide.id), ['two', 'one']);
});

test('page replacement obeys content/format/notes/animation features and read-only before asking permission', async t => {
  const elements = [createSlideElement({ type: 'text', id: 'title', text: 'Old title' }), createSlideElement({ type: 'shape', id: 'box' })];
  const initialDeck = createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#fff', notes: '', elements,
    animations: [{ id: 'fade', animation: { type: 'tween', elementId: 'title', durationMs: 100, to: { opacity: 0 } } }] }] });
  for (const props of [{ readOnly: true }, { features: { formatting: false } }, { features: { text: false } }, { features: { shapes: false } },
    { features: { notes: false } }, { features: { animations: false } }]) {
    let requested = 0;
    const app = await mount(t, { initialDeck, ...props, onEditRequest() { requested++; return true; } });
    await change(async () => assert.equal(await app.editor.execute({ type: 'slide.replaceContent', slideId: 'page', notes: 'New notes', elements: [{ type: 'text', id: 'new', text: 'New' }] }), null));
    assert.equal(app.editor.deck, initialDeck);
    assert.equal(app.editor.canUndo, false);
    assert.equal(requested, 0);
  }
});

test('page replacement is one undoable UI command and cannot apply after read-only changes during authorization', async t => {
  const initialDeck = createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#fff', notes: '', elements: [createSlideElement({ type: 'text', id: 'old' })] }] });
  const app = await mount(t, { initialDeck, features: { addSlides: false, deleteSlides: false } });
  await change(() => app.editor.select({ slideId: 'page', elementIds: ['old'] }));
  await change(async () => assert.ok(await app.editor.execute({ type: 'slide.replaceContent', slideId: 'page', elements: [{ type: 'text', id: 'fresh', text: 'New title' }] })));
  assert.deepEqual(app.editor.selection, { slideId: 'page', elementIds: ['fresh'] });
  assert.equal(app.editor.deck.slides[0].elements.length, 1);
  await change(() => app.editor.history('undo'));
  assert.deepEqual(app.editor.deck, initialDeck);
  assert.deepEqual(app.editor.selection, { slideId: 'page', elementIds: ['old'] });
  await change(() => app.editor.history('redo'));
  assert.equal(app.editor.deck.slides[0].elements[0].id, 'fresh');
  const pendingPermission = deferred();
  const guarded = await mount(t, { initialDeck, onEditRequest: () => pendingPermission.promise });
  let result;
  await change(() => { result = guarded.editor.execute({ type: 'slide.replaceContent', slideId: 'page', elements: [] }); });
  await guarded.update({ readOnly: true });
  await change(async () => { pendingPermission.resolve(true); assert.equal(await result, null); });
  assert.equal(guarded.editor.deck, initialDeck);
});

test('connection command uses the shape permission gate and shared undo history', async t => {
  const initialDeck = createSlideDeck({ slides: [{ id: 'page', name: 'Page', background: '#fff', notes: '', elements: [
    createSlideElement({ type: 'text', id: 'from', x: 50, width: 200 }), createSlideElement({ type: 'text', id: 'to', x: 600, width: 200 })] }] });
  const app = await mount(t, { initialDeck, features: { shapes: false } });
  const command = { type: 'line.add', slideId: 'page', start: { x: 0, y: 0, binding: { targetId: 'from', port: 'right' } }, end: { x: 0, y: 0, binding: { targetId: 'to', port: 'left' } } };
  await change(async () => assert.equal(await app.editor.execute(command), null));
  assert.equal(app.editor.deck, initialDeck);
  await app.update({ features: { shapes: true } });
  await change(async () => assert.ok(await app.editor.execute(command)));
  assert.ok(app.editor.deck.slides[0].elements.length > 2);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck, initialDeck);
});
test('freeform SVG images use the existing image permission gate and undo/redo path', async t => {
  const initialDeck = createSlideDeck();
  const src = createSlideSvgSource('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><path d="M0 90L80 0L160 90Z" fill="#315bfb"/></svg>');
  const command = { type: 'element.add', slideId: initialDeck.slides[0].id, element: { type: 'image', id: 'art', src, alt: 'Original artwork', x: 93, y: 117, width: 640, height: 360 } };
  let requested = 0;
  const app = await mount(t, { initialDeck, features: { images: false }, onEditRequest: () => { requested++; return true; } });
  await change(async () => assert.equal(await app.editor.execute(command), null));
  assert.equal(requested, 0);
  assert.equal(app.editor.deck, initialDeck);
  await app.update({ features: { images: true } });
  await change(async () => assert.ok(await app.editor.execute(command)));
  assert.equal(requested, 1);
  assert.equal(app.editor.deck.slides[0].elements[0].x, 93);
  assert.equal(app.editor.deck.slides[0].elements[0].src, src);
  assert.deepEqual(parseSlideDeck(serializeSlideDeck(app.editor.deck)), app.editor.deck);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck, initialDeck);
  await change(() => app.editor.history('redo'));
  assert.equal(app.editor.deck.slides[0].elements[0].src, src);
});


test('conditional handle commits use the latest fields after permission and preserve user selection', async t => {
  const permission = deferred();
  const ref = { current: null };
  const app = await mount(t, { ref, onEditRequest: () => permission.promise });
  const snapshot = ref.current.getMutationSnapshot();
  const edit = prepareSlideConditionalEdit(snapshot.deck, rename('AI title'));
  let user, pending;
  await change(() => {
    user = app.editor.execute(rename('User title'));
    pending = ref.current.executeConditional(edit, { expected: snapshot.token });
  });
  await change(async () => { permission.resolve(true); await user; });
  const conflict = await pending;
  assert.equal(conflict.ok, false);
  assert.equal(app.editor.deck.title, 'User title');
  assert.equal(app.editor.canUndo, true);
  await change(() => app.editor.history('undo'));
  assert.equal(app.editor.deck.title, 'Original');
  assert.equal(app.editor.canUndo, false);

  await change(() => app.editor.execute({ type: 'slide.add', slide: { id: 'other' } }));
  const current = ref.current.getMutationSnapshot();
  const originalSlide = current.deck.slides[0].id;
  await change(() => ref.current.select({ slideId: 'other', elementIds: [] }));
  await change(async () => {
    const applied = await ref.current.executeConditional(prepareSlideConditionalEdit(current.deck, {
      type: 'element.add', slideId: originalSlide, element: { type: 'text', text: 'AI content' },
    }), { expected: current.token });
    assert.equal(applied.ok, true);
  });
  assert.equal(ref.current.getSelection().slideId, 'other');
});

test('conditional edits flush pending local input and respect cancellation, read-only and feature controls', async t => {
  const app = await mount(t), snapshot = app.editor.getMutationSnapshot();
  const buffer = inputBuffer(app, rename('Typing'));
  await change(() => buffer.type());
  await change(async () => {
    const result = await app.editor.executeConditional(prepareSlideConditionalEdit(snapshot.deck, rename('AI')), { expected: snapshot.token });
    assert.equal(result.ok, false);
  });
  assert.equal(app.editor.deck.title, 'Typing');
  buffer.unregister();
  const permission = deferred(), controller = new AbortController(), modes = [];
  let permissionSignal, requests = 0;
  const waiting = await mount(t, { onEditRequest: (_request, context) => { requests++; permissionSignal = context.signal; return permission.promise; },
    onEvent: event => { if (event.type === 'edit-mode') modes.push(event.mode); } });
  const source = waiting.editor.getMutationSnapshot();
  let pending;
  await change(() => { pending = waiting.editor.executeConditional(prepareSlideConditionalEdit(source.deck, rename('AI')), { expected: source.token, signal: controller.signal }); });
  await change(() => controller.abort());
  assert.equal(await pending, null);
  assert.equal(permissionSignal.aborted, true);
  assert.equal(waiting.editor.requesting, false);
  await change(() => permission.resolve(true));
  assert.equal(modes.at(-1), 'view');
  assert.equal(modes.includes('edit'), false);
  assert.equal(waiting.editor.deck.title, 'Original');
  assert.equal(waiting.editor.canUndo, false);
  await change(() => waiting.editor.execute(rename('User after cancellation')));
  assert.equal(requests, 2);
  for (const props of [{ readOnly: true }, { onSave: undefined }, { features: { formatting: false } }]) {
    const blocked = await mount(t, props), base = blocked.editor.getMutationSnapshot();
    await change(async () => assert.equal(await blocked.editor.executeConditional(prepareSlideConditionalEdit(base.deck, { type: 'deck.resize', width: 800, height: 600 }), { expected: base.token }), null));
    assert.equal(blocked.editor.deck.width, base.deck.width);
  }
});

test('canceling a conditional edit does not abort an existing user permission request', async t => {
  const permission = deferred(), controller = new AbortController();
  let hostSignal, pendingUser, pendingAi;
  const app = await mount(t, { onEditRequest: (_request, context) => { hostSignal = context.signal; return permission.promise; } });
  const snapshot = app.editor.getMutationSnapshot();
  await change(() => { pendingUser = app.editor.execute(rename('User')); });
  await change(() => { pendingAi = app.editor.executeConditional(prepareSlideConditionalEdit(snapshot.deck, rename('AI')), { expected: snapshot.token, signal: controller.signal }); });
  await change(() => controller.abort());
  assert.equal(await pendingAi, null);
  assert.equal(hostSignal.aborted, false);
  await change(async () => { permission.resolve(true); assert.equal((await pendingUser).changed, true); });
  assert.equal(app.editor.deck.title, 'User');
});

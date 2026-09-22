import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const listeners = new Map();
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
globalThis.document = { activeElement: null };
globalThis.HTMLElement = class {};
const output = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'external-react', setup(builder) { builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }] });
const { LikeCalendar, createCalendar, serializeCalendar } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sample = () => createCalendar({ id: 'c', title: 'Team', timeZone: 'Asia/Tokyo', events: [{ id: 'review', title: 'Design review', allDay: false, start: '2026-09-22T09:00:00+09:00', end: '2026-09-22T10:00:00+09:00' }] });
const update = async callback => act(async () => { await callback(); });
const button = (renderer, label) => renderer.root.findByProps({ 'aria-label': label });
async function mount(t, props = {}, strict = false) {
  const ref = createRef(); let renderer;
  const render = next => strict ? h(StrictMode, null, h(LikeCalendar, { ref, initialCalendar: sample(), initialDate: '2026-09-22', ...next })) : h(LikeCalendar, { ref, initialCalendar: sample(), initialDate: '2026-09-22', ...next });
  await update(() => { renderer = create(render(props)); }); t.after(() => update(() => renderer.unmount()));
  return { ref, renderer, configure: next => update(() => renderer.update(render(next))) };
}
test('SSR includes month grid, timed event, styles and read-only state', () => {
  const markup = renderToStaticMarkup(h(LikeCalendar, { initialCalendar: sample(), initialDate: '2026-09-22', primaryColor: '#123456', style: { height: 600 } }));
  assert.match(markup, /data-likex-calendar/); assert.match(markup, /Design review/); assert.match(markup, /09:00/); assert.match(markup, /閲覧専用/); assert.match(markup, /--lxc-primary:#123456/); assert.match(markup, /height:600px/);
});
test('read-only omission and feature flags gate both GUI and handle writes', async t => {
  const { ref, renderer, configure } = await mount(t);
  await update(async () => assert.equal(await ref.current.execute({ type: 'calendar.update', title: 'No' }), null));
  assert.equal(ref.current.getCalendar().title, 'Team'); assert.equal(renderer.root.findAllByProps({ className: 'lxc-primary' }).length, 0);
  await configure({ onSave() {}, features: { events: false, metadata: false, import: false, export: false, history: false } });
  for (const command of [{ type: 'event.delete', id: 'review' }, { type: 'calendar.update', title: 'No' }, { type: 'calendar.replace', calendar: createCalendar() }]) await update(async () => assert.equal(await ref.current.execute(command), null));
  await assert.rejects(ref.current.exportNative()); assert.equal(await ref.current.undo(), false);
  assert.equal(renderer.root.findAllByProps({ 'aria-label': 'タイムゾーン' }).length, 0);
});
test('navigation callbacks cover month week day and ref navigation', async t => {
  const ranges = [], { ref, renderer } = await mount(t, { onVisibleRangeChange: range => ranges.push(range) });
  assert.equal(ranges.at(-1).start, '2026-08-31');
  await update(() => button(renderer, '次へ').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 })); assert.equal(ranges.at(-1).start, '2026-09-28');
  await update(() => { ref.current.setDate('2026-09-22'); ref.current.setView('week'); }); assert.equal(ranges.at(-1).start, '2026-09-21');
  assert.equal(renderer.root.findAllByProps({ className: 'lxc-time-column' }).length, 7);
  await update(() => ref.current.setView('day')); assert.equal(renderer.root.findAllByProps({ className: 'lxc-time-column' }).length, 1);
  assert.equal(ref.current.getVisibleRange().end, '2026-09-23');
});
test('dialog creation editing deletion and drag rescheduling use shared history', async t => {
  const clicked = [], { ref, renderer } = await mount(t, { onSave() {}, onEventClick: event => clicked.push(event.id) });
  const eventButton = () => renderer.root.findAllByType('button').find(node => node.props.title === 'Design review');
  await update(() => eventButton().props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 })); assert.deepEqual(clicked, ['review']);
  const titleInput = renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000);
  await update(() => titleInput.props.onChange({ target: { value: 'Updated review' } }));
  await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(ref.current.getCalendar().events[0].title, 'Updated review');
  await update(() => ref.current.undo()); assert.equal(ref.current.getCalendar().events[0].title, 'Design review');
  // The drag hook tests validate native events; this exercises its grid-to-model callback.
  await update(() => renderer.root.findByProps({ activeDate: '2026-09-22' }).props.onMove('review', '2026-09-24'));
  assert.equal(ref.current.getCalendar().events[0].start, '2026-09-24T00:00:00.000Z');
  await update(() => button(renderer, '2026-09-25 に予定を追加').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
  await update(() => renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.onChange({ target: { value: 'New all day' } }));
  await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.equal(ref.current.getCalendar().events.length, 2); assert.equal(ref.current.getCalendar().events[1].end, '2026-09-26');
  await update(() => renderer.root.findAllByType('button').find(node => node.props.title === 'New all day').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
  await update(() => renderer.root.findAllByType('button').find(node => node.props.children === '詳細設定').props.onClick());
  await update(() => renderer.root.findAllByType('button').find(node => node.props.children === '削除').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
  assert.equal(ref.current.getCalendar().events.length, 1);
});
test('permission denial, save baseline, undo redo and JSON import/export preserve contracts', async t => {
  let allowed = false, saved = 0; const dirty = [];
  const { ref } = await mount(t, { onSave: calendar => { saved++; return calendar; }, onEditRequest: () => allowed, onDirtyChange: value => dirty.push(value) });
  await update(() => ref.current.execute({ type: 'calendar.update', title: 'Changed' })); assert.equal(ref.current.getCalendar().title, 'Team');
  allowed = true; await update(() => ref.current.execute({ type: 'calendar.update', title: 'Changed' })); assert.ok(listeners.has('beforeunload'));
  await update(() => ref.current.save()); assert.equal(saved, 1); assert.equal(ref.current.getSnapshot().dirty, false);
  await update(() => ref.current.undo()); assert.equal(ref.current.getSnapshot().dirty, true);
  await update(() => ref.current.redo()); assert.equal(ref.current.getSnapshot().dirty, false);
  const imported = createCalendar({ title: 'Imported', timeZone: 'UTC' });
  await update(async () => assert.equal(await ref.current.importNative(serializeCalendar(imported)), true));
  assert.equal(ref.current.getCalendar().title, 'Imported'); assert.equal(await (await ref.current.exportNative()).text(), serializeCalendar(imported));
  await update(() => ref.current.undo()); assert.equal(ref.current.getCalendar().title, 'Changed'); assert.ok(dirty.includes(true));
});
test('pending import is ignored after read-only change and StrictMode reactivation works', async t => {
  const host = await mount(t, { onSave() {} }, true); let resolve;
  class DelayedBlob extends Blob { text() { return new Promise(done => { resolve = done; }); } }
  let pending;
  await update(() => { pending = host.ref.current.importNative(new DelayedBlob()); });
  await host.configure({ onSave() {}, readOnly: true });
  await update(async () => { resolve(serializeCalendar(createCalendar({ title: 'Late' }))); assert.equal(await pending, false); });
  assert.equal(host.ref.current.getCalendar().title, 'Team');
  await host.configure({ onSave() {} });
  await update(() => host.ref.current.execute({ type: 'calendar.update', title: 'Active' })); assert.equal(host.ref.current.getCalendar().title, 'Active');
});
test('unmount cancels pending import without applying data or notifying host', async t => {
  const changes = [], { ref, renderer } = await mount(t, { onSave() {}, onChange: value => changes.push(value) });
  const handle = ref.current; let resolve, pending;
  class DelayedBlob extends Blob { text() { return new Promise(done => { resolve = done; }); } }
  await update(() => { pending = handle.importNative(new DelayedBlob()); });
  await update(() => renderer.unmount());
  resolve(serializeCalendar(createCalendar({ title: 'Too late' })));
  assert.equal(await pending, false); assert.equal(handle.getCalendar().title, 'Team'); assert.deepEqual(changes, []);
});
test('open dialogs report invalid edits and reject stale event snapshots', async t => {
  const { ref, renderer } = await mount(t, { onSave() {} });
  await update(() => renderer.root.findAllByType('button').find(node => node.props.title === 'Design review').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
  const times = renderer.root.findAllByProps({ type: 'datetime-local' });
  await update(() => times[1].props.onChange({ target: { value: '2026-09-22T08:00' } }));
  await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(renderer.root.findByProps({ className: 'lxc-error' }).props.children, /after start/);
  assert.equal(ref.current.getCalendar().events[0].end, '2026-09-22T10:00:00+09:00');
  await update(() => ref.current.execute({ type: 'event.update', id: 'review', changes: { title: 'External change' } }));
  await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(renderer.root.findByProps({ className: 'lxc-error' }).props.children, /予定が変更/);
  assert.equal(ref.current.getCalendar().events[0].title, 'External change');
});

test('open dialogs retain their original timezone and reject edits after a timezone change', async t => {
  for (const kind of ['existing', 'new']) {
    const { ref, renderer } = await mount(t, { onSave() {} });
    if (kind === 'existing') await update(() => renderer.root.findAllByType('button').find(node => node.props.title === 'Design review').props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
    else await update(() => renderer.root.findByProps({ activeDate: '2026-09-22' }).props.onCreate('2026-09-22', '09:00', { x: 100, y: 100 }));
    await update(() => renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.onChange({ target: { value: 'My draft' } }));
    assert.equal(renderer.root.findAllByProps({ type: 'datetime-local' })[0].props.value, '2026-09-22T09:00');
    await update(() => ref.current.execute({ type: 'calendar.update', timeZone: 'UTC' }));
    const before = ref.current.getCalendar();
    await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.match(renderer.root.findByProps({ className: 'lxc-error' }).props.children, /予定が変更/);
    assert.equal(renderer.root.findAllByProps({ type: 'datetime-local' })[0].props.value, '2026-09-22T09:00');
    assert.deepEqual(ref.current.getCalendar(), before);
    assert.equal(ref.current.getCalendar().events[0].start, '2026-09-22T09:00:00+09:00');
  }
});

for (const operation of ['save', 'delete']) test(`late dialog ${operation} completion does not close a different event opened during permission`, async t => {
  let resolve;
  const calendar = sample();
  const initialCalendar = { ...calendar, events: [...calendar.events, { ...calendar.events[0], id: 'second', title: 'Another event' }] };
  const { ref, renderer } = await mount(t, { initialCalendar, onSave() {}, onEditRequest: () => new Promise(done => { resolve = done; }) });
  const open = title => update(() => renderer.root.findAllByType('button').find(node => node.props.title === title).props.onClick({ target: { closest: () => null }, clientX: 100, clientY: 100 }));
  await open('Design review');
  if (operation === 'save') {
    await update(() => renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.onChange({ target: { value: 'Saved review' } }));
    await update(() => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  } else {
    await update(() => renderer.root.findAllByType('button').find(node => node.props.children === '詳細設定').props.onClick());
    await update(() => renderer.root.findAllByType('button').find(node => node.props.children === '削除').props.onClick());
  }
  assert.equal(ref.current.getSnapshot().busy, 'permission');
  await open('Another event');
  assert.equal(renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.value, 'Another event');
  await update(() => resolve(true));
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 1);
  assert.equal(renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.value, 'Another event');
  assert.equal(ref.current.getSnapshot().busy, null);
  assert.equal(ref.current.getCalendar().events.find(event => event.id === 'review')?.title, operation === 'save' ? 'Saved review' : undefined);
});

test('Shift right-click leaves native menus available for events and empty dates', async t => {
  const { ref, renderer } = await mount(t, { onSave() {} });
  const grid = renderer.root.findByProps({ activeDate: '2026-09-22' });
  const event = { shiftKey: true, preventDefault() { assert.fail('native menu was suppressed'); }, stopPropagation() { assert.fail('native event was stopped'); } };
  await update(() => grid.props.onEventContextMenu(event, ref.current.getCalendar().events[0]));
  await update(() => grid.props.onEmptyContextMenu(event, '2026-09-22', '09:00'));
  assert.equal(renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('quick creation expands to details without losing fields and preserves history', async t => {
  const {renderer, ref} = await mount(t, {onSave() {}});
  await update(() => button(renderer, '2026-09-25 に予定を追加').props.onClick({clientX:120,clientY:100}));
  assert.equal(renderer.root.findByProps({role:'dialog'}).props['aria-modal'],false);
  await update(() => renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.onChange({target:{value:'Quick meeting'}}));
  assert.equal(renderer.root.findAllByType('textarea').length,0);
  await update(() => renderer.root.findAllByType('button').find(node => node.props.children === '詳細設定').props.onClick());
  assert.equal(renderer.root.findByProps({role:'dialog'}).props['aria-modal'],true);
  assert.equal(renderer.root.findAllByType('input').find(node => node.props.maxLength === 1000).props.value,'Quick meeting');
  assert.equal(renderer.root.findAllByType('textarea').length,1);
  await update(() => renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(ref.current.getCalendar().events.at(-1).title,'Quick meeting');
  await update(() => ref.current.undo()); assert.equal(ref.current.getCalendar().events.length,1);
});

test('week/day begin at seven; refreshing data does not reset the user scroll position', async t => {
  let renderer;
  const viewport={scrollTop:0, querySelector(selector){return selector === '.lxc-time-body' ? {getBoundingClientRect:()=>({top:100-viewport.scrollTop})} : {offsetHeight:40}},getBoundingClientRect:()=>({top:0})};
  await update(() => {renderer=create(h(LikeCalendar,{initialCalendar:sample(),initialDate:'2026-09-22',initialView:'week',onSave() {}}),{createNodeMock:element=>element.props.className==='lxc-time-scroll'?viewport:null});});
  t.after(()=>update(()=>renderer.unmount()));
  assert.equal(viewport.scrollTop,508);
  viewport.scrollTop=700;
  await update(()=>renderer.update(h(LikeCalendar,{initialCalendar:sample(),initialDate:'2026-09-22',initialView:'week',onSave() {},title:'Renamed'})));
  assert.equal(viewport.scrollTop,700);
});

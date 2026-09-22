import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: `
export * from './src/model';
export { useDocumentEditor } from './src/state/use-document-editor';
export { createDocumentContextMenuItems, resolveDocumentContextTarget } from './src/ui/document-context-menu';
export { useDocumentContextMenu } from './src/ui/use-document-context-menu';
export { menus } from './src/browser';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'react-and-menu', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /(?:^|\/)browser$/ }, () => ({ path: 'menu', namespace: 'menu' }));
  builder.onLoad({ filter: /.*/, namespace: 'menu' }, () => ({ contents: `export const menus=[]; export function openContextMenu(options) { const entry={...options,closed:false}; menus.push(entry); return () => { if (!entry.closed) { entry.closed=true; options.onClose?.(); } }; }` }));
} }] });
const { createDocument, getBlocks, getImages, getDocumentText, executeDocumentCommands, useDocumentEditor,
  createDocumentContextMenuItems, resolveDocumentContextTarget, useDocumentContextMenu, menus } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const change = callback => act(async () => { await callback(); });
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ncAAAAASUVORK5CYII=';
const paragraph = text => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const initial = () => createDocument({ content: { type: 'doc', content: [paragraph('Before'), { type: 'image', attrs: { id: 'picture', src: pixel, width: 200, height: 100, alt: 'Image' } },
  { type: 'table', attrs: { id: 'table' }, content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [paragraph('Cell')] }] }] }, paragraph('After')] } });
async function mount(t, supplied = {}) {
  let editor, handlers, renderer, alive = true, focusCount = 0;
  let props = { initialDocument: initial(), onSave() {}, ...supplied };
  const copied = [], surface = { current: { focus() { focusCount++; } } };
  function Probe() { editor = useDocumentEditor(props); handlers = useDocumentContextMenu(editor, surface); return null; }
  await change(() => { renderer = create(h(Probe)); });
  const unmount = async () => { if (alive) { alive = false; await change(() => renderer.unmount()); } };
  t.after(unmount);
  return { get editor() { return editor; }, get handlers() { return handlers; }, get focusCount() { return focusCount; }, copied, unmount,
    items(target) { return createDocumentContextMenuItems(() => editor, target, { isCurrent: () => alive, focus: () => surface.current.focus(), copyText: async text => { copied.push(text); } }); },
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(h(Probe))); } };
}
const item = (app, kind, id, action) => app.items({ kind, ...(id ? { id } : {}) }).find(candidate => candidate.id === action);

test('image menus reuse public commands with one history entry and host notification per change', async t => {
  const changes = [], events = []; let permissions = 0;
  const app = await mount(t, { onChange: document => changes.push(document), onEvent: event => events.push(event), onEditRequest: () => { permissions++; return true; } });
  await change(() => item(app, 'image', 'picture', 'image-duplicate').onSelect());
  const images = getImages(app.editor.document);
  assert.equal(images.length, 2); assert.equal(images[0].id, 'picture'); assert.notEqual(images[1].id, 'picture');
  assert.equal(images[1].from, images[0].to); assert.equal(images[1].node.attrs.width, 200);
  assert.equal(changes.length, 1); assert.equal(permissions, 1); assert.equal(app.editor.dirty, true);
  assert.equal(events.filter(event => event.type === 'change').length, 1);
  await change(() => app.editor.history('undo')); assert.equal(getImages(app.editor.document).length, 1); assert.equal(app.editor.dirty, false);
  await change(() => item(app, 'image', 'picture', 'image-shrink').onSelect());
  assert.equal(getImages(app.editor.document)[0].node.attrs.width, 160); assert.equal(getImages(app.editor.document)[0].node.attrs.height, 80);
  await change(() => item(app, 'image', 'picture', 'image-enlarge').onSelect());
  assert.equal(getImages(app.editor.document)[0].node.attrs.width, 200); assert.equal(getImages(app.editor.document)[0].node.attrs.height, 100);
  await change(() => item(app, 'image', 'picture', 'image-delete').onSelect());
  assert.equal(getImages(app.editor.document).length, 0);
  await change(() => app.editor.history('undo')); assert.equal(getImages(app.editor.document)[0].id, 'picture');
});

test('table selection is nonmutating and delete/undo preserve the complete table', async t => {
  const app = await mount(t), original = app.editor.document;
  const table = getBlocks(original).find(block => block.id === 'table');
  await change(() => item(app, 'table', 'table', 'table-select').onSelect());
  assert.deepEqual(app.editor.selection, { from: table.from, to: table.to });
  assert.equal(app.editor.document, original); assert.equal(app.editor.dirty, false);
  await change(() => item(app, 'table', 'table', 'table-delete').onSelect());
  assert.equal(getBlocks(app.editor.document).some(block => block.id === 'table'), false);
  await change(() => app.editor.history('undo')); assert.equal(app.editor.document, original);
});

test('read-only menus omit writes, disabled resource/history features are hidden and busy disables actions', async t => {
  const app = await mount(t, { onSave: undefined });
  assert.deepEqual(app.items({ kind: 'image', id: 'picture' }).map(action => action.id), ['image-select']);
  assert.deepEqual(app.items({ kind: 'table', id: 'table' }).map(action => action.id), ['table-select']);
  assert.ok(!app.items({ kind: 'document' }).some(action => action.id === 'document-undo'));
  await app.update({ onSave() {}, features: { images: false, tables: false, history: false } });
  assert.deepEqual(app.items({ kind: 'image', id: 'picture' }), []); assert.deepEqual(app.items({ kind: 'table', id: 'table' }), []);
  assert.ok(!app.items({ kind: 'document' }).some(action => action.id === 'document-undo'));
  let allow; await app.update({ features: {}, onEditRequest: () => new Promise(resolve => { allow = resolve; }) });
  let pending; await change(() => { pending = item(app, 'image', 'picture', 'image-delete').onSelect(); });
  assert.ok(app.items({ kind: 'document' }).every(action => action.disabled));
  await change(async () => { allow(false); await pending; });
  assert.equal(getImages(app.editor.document).length, 1);
});

test('document, selection, policy, and unmount invalidate captured menu actions', async t => {
  for (const reason of ['document', 'selection', 'readonly', 'features', 'unmount']) {
    const app = await mount(t), action = item(app, 'image', 'picture', 'image-delete');
    if (reason === 'document') await change(() => app.editor.execute({ type: 'text.insert', from: 1, text: 'New' }));
    if (reason === 'selection') await change(() => { app.editor.select({ from: 2, to: 2 }); app.editor.select({ from: 1, to: 1 }); });
    if (reason === 'readonly') await app.update({ readOnly: true });
    if (reason === 'features') await app.update({ features: { images: false } });
    if (reason === 'unmount') await app.unmount();
    const document = app.editor.document;
    await change(() => action.onSelect()); assert.equal(app.editor.document, document, reason);
  }
});

test('selection changes during asynchronous permission reject image edits and undo', async t => {
  for (const operation of ['image-delete', 'document-undo']) {
    const app = await mount(t);
    if (operation === 'document-undo') { await change(() => app.editor.execute({ type: 'text.insert', from: 1, text: 'Saved' })); await change(() => app.editor.save()); }
    let allow; await app.update({ onEditRequest: () => new Promise(resolve => { allow = resolve; }) });
    const before = app.editor.document;
    const action = operation === 'image-delete' ? item(app, 'image', 'picture', operation) : item(app, 'document', null, operation);
    let pending; await change(() => { pending = action.onSelect(); });
    await change(() => app.editor.select({ from: 2, to: 2 }));
    await change(async () => { allow(true); await pending; });
    assert.equal(app.editor.document, before, operation);
  }
});

test('document copy is read-only, missing clipboard disables it and clipboard rejection propagates', async t => {
  const app = await mount(t, { onSave: undefined }), before = app.editor.document;
  await item(app, 'document', null, 'document-copy').onSelect();
  assert.deepEqual(app.copied, [getDocumentText(before)]); assert.equal(app.editor.document, before); assert.equal(app.editor.dirty, false);
  const createItems = copyText => createDocumentContextMenuItems(() => app.editor, { kind: 'document' }, { isCurrent: () => true, focus() {}, copyText });
  assert.equal(createItems().find(action => action.id === 'document-copy').disabled, true);
  await assert.rejects(createItems(async () => { throw new Error('Clipboard denied'); }).find(action => action.id === 'document-copy').onSelect(), /Clipboard denied/);
});

function domTree() {
  const ownerDocument = { defaultView: { navigator: { clipboard: { writeText: async () => {} } } } };
  const make = (tag, parent = null, attrs = {}) => {
    const node = { tag, parent, attrs, ownerDocument, isConnected: true, children: [],
      getAttribute(name) { return attrs[name] ?? null; },
      contains(other) { for (let current = other; current; current = current.parent) if (current === this) return true; return false; },
      matches(selector) { if (selector.startsWith('.')) return attrs.class === selector.slice(1); const match = /^([a-z0-9]*)(?:\[([^=\]]+)(?:=([^\]]+))?\])?$/.exec(selector); return !!match && (!match[1] || tag === match[1]) && (!match[2] || Object.hasOwn(attrs, match[2]) && (!match[3] || attrs[match[2]] === match[3])); },
      closest(selector) { for (let current = node; current; current = current.parent) if (selector.split(',').some(part => current.matches(part))) return current; return null; },
      querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); },
    }; parent?.children.push(node); return node;
  };
  const viewport = make('div'), editor = make('div', viewport, { class: 'lxd-editor', contenteditable: 'true' }), text = make('p', editor), link = make('a', text),
    table = make('table', editor, { 'data-document-id': 'table' }), cell = make('td', table), cellText = make('p', cell), image = make('img', editor, { 'data-document-id': 'picture' });
  return { viewport, editor, text, link, table, cell, cellText, image };
}
const eventFor = (dom, target, extra = {}) => ({ currentTarget: dom.viewport, target, clientX: 60, clientY: 70, prevented: false, stopped: false,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });

test('DOM routing preserves native text and table-cell text while targeting images, table chrome and margins', () => {
  const dom = domTree();
  for (const node of [dom.text, dom.link, dom.cellText, dom.editor]) assert.equal(resolveDocumentContextTarget(node, dom.viewport), null);
  assert.deepEqual(resolveDocumentContextTarget(dom.image, dom.viewport).target, { kind: 'image', id: 'picture' });
  assert.deepEqual(resolveDocumentContextTarget(dom.cell, dom.viewport).target, { kind: 'table', id: 'table' });
  assert.deepEqual(resolveDocumentContextTarget(dom.viewport, dom.viewport).target, { kind: 'document' });
});

test('hook opens shared menu with pointer or selected-resource keyboard and closes on selection changes/unmount', async t => {
  const app = await mount(t), dom = domTree();
  const textEvent = eventFor(dom, dom.cellText), start = menus.length;
  app.handlers.onContextMenu(textEvent); assert.equal(textEvent.prevented, false); assert.equal(menus.length, start);
  const event = eventFor(dom, dom.image); app.handlers.onContextMenu(event);
  assert.equal(event.prevented, true); assert.equal(event.stopped, true); assert.equal(menus.at(-1).anchor, dom.image); assert.equal(menus.at(-1).x, 60);
  const captured = menus.at(-1);
  await change(() => app.editor.select({ from: 2, to: 2 })); assert.equal(captured.closed, true);
  const image = getImages(app.editor.document)[0]; await change(() => app.editor.select({ from: image.from, to: image.to }));
  const keyboard = eventFor(dom, dom.editor, { key: 'F10', shiftKey: true, nativeEvent: { isComposing: false }, clientX: 0, clientY: 0 });
  app.handlers.onKeyDown(keyboard); assert.equal(keyboard.prevented, true); assert.equal(menus.at(-1).anchor, dom.image);
  const last = menus.at(-1); dom.image.isConnected = false;
  await last.items.find(action => action.id === 'image-delete').onSelect(); assert.equal(getImages(app.editor.document).length, 1);
  await app.unmount(); assert.equal(last.closed, true);
  await last.items.find(action => action.id === 'image-delete').onSelect(); assert.equal(getImages(app.editor.document).length, 1);
});

test('shared menu closing before onSelect does not cancel the chosen action', async t => {
  const app = await mount(t), dom = domTree();
  app.handlers.onContextMenu(eventFor(dom, dom.image));
  const menu = menus.at(-1); menu.onClose();
  await change(() => menu.items.find(action => action.id === 'image-delete').onSelect());
  assert.equal(getImages(app.editor.document).length, 0);
});

test('image scaling cannot exceed public model dimensions', async t => {
  const document = executeDocumentCommands(initial(), { type: 'image.update', id: 'picture', width: 16_384 }).document;
  const app = await mount(t, { initialDocument: document });
  const action = item(app, 'image', 'picture', 'image-enlarge'); assert.equal(action.disabled, true);
  await action.onSelect(); assert.equal(app.editor.document, document);
});

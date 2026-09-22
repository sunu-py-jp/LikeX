import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { load, tick } from './helpers.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { LikeAIChat, createAIChat } = await load('index', { mockContextMenu: true });
const change = fn => act(async () => { await fn(); });
const seed = () => createAIChat({ conversations: [{ id: 'first', title: 'First', messages: [
  { id: 'prompt', role: 'user', content: 'Question', createdAt: '2026-09-22T00:00:00Z', status: 'complete' },
  { id: 'answer', role: 'assistant', content: 'Answer', replyTo: 'prompt', createdAt: '2026-09-22T00:00:01Z', status: 'complete' },
] }, { id: 'second', title: 'Second', messages: [] }] });
async function mount(t, extra = {}) {
  let props = { initialAIChat: seed(), onSave() {}, ...extra }, renderer; const ref = createRef();
  await change(() => { renderer = create(h(LikeAIChat, { ...props, ref })); });
  t.after(() => change(() => renderer.unmount()));
  return { renderer, ref, update: async next => { props = { ...props, ...next }; await change(() => renderer.update(h(LikeAIChat, { ...props, ref }))); } };
}
async function open(node, { native = false, clipboard } = {}) {
  const event = { target: { closest: () => native ? {} : null }, currentTarget: { ownerDocument: { defaultView: { navigator: { clipboard } } } }, clientX: 10, clientY: 20, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  await change(() => node.props.onContextMenu(event));
  return { event, menu: globalThis.__likexContextMenus.at(-1) };
}
const item = (menu, id) => menu.items.find(action => action.id === id);

test('AI message context actions copy text and regenerate through the existing response/session path', async t => {
  let requests = 0; const copied = [];
  const app = await mount(t, { onSend: () => { requests++; return 'Regenerated answer'; } });
  const { menu } = await open(app.renderer.root.findByProps({ 'aria-label': 'アシスタントのメッセージ' }), { clipboard: { writeText: async text => copied.push(text) } });
  assert.deepEqual(menu.items.map(action => action.id), ['copy', 'retry', 'edit', 'delete']);
  await change(() => item(menu, 'copy').onSelect()); assert.deepEqual(copied, ['Answer']);
  await change(() => item(menu, 'retry').onSelect());
  assert.equal(requests, 1); assert.equal(app.ref.current.getAIChat().conversations[0].messages[1].content, 'Regenerated answer');
  await change(() => app.ref.current.undo());
  assert.equal(app.ref.current.getAIChat().conversations[0].messages[1].content, 'Answer');
});

test('conversation right-click targets the clicked conversation and retains rename permissions/history', async t => {
  let allowed = false;
  const app = await mount(t, { onEditRequest: () => allowed });
  const target = app.renderer.root.findAll(node => node.type === 'div' && node.props.className === 'lxai-conversation ')[0];
  const { menu } = await open(target);
  await change(() => item(menu, 'rename').onSelect());
  await change(() => app.renderer.root.findByProps({ 'aria-label': '会話の名前' }).props.onChange({ target: { value: 'Renamed second' } }));
  const apply = () => change(async () => { app.renderer.root.findByProps({ className: 'lxai-primary-button' }).props.onClick(); await tick(); });
  await apply(); assert.equal(app.ref.current.getAIChat().conversations[1].title, 'Second');
  allowed = true; await apply(); assert.equal(app.ref.current.getAIChat().conversations[1].title, 'Renamed second');
  assert.equal(app.ref.current.getAIChatConversation().id, 'first');
  await change(() => app.ref.current.undo()); assert.equal(app.ref.current.getAIChat().conversations[1].title, 'Second');
});

test('disabled features disappear, readOnly actions cannot edit, and editable targets preserve native context menus', async t => {
  const app = await mount(t, { readOnly: true, onSend: () => 'Answer' });
  let menu = (await open(app.renderer.root.findByProps({ 'aria-label': 'アシスタントのメッセージ' }))).menu;
  assert.equal(item(menu, 'edit').disabled, true); assert.equal(item(menu, 'retry').disabled, true);
  await app.update({ readOnly: false, features: { edit: false, delete: false, retry: false } });
  menu = (await open(app.renderer.root.findByProps({ 'aria-label': 'アシスタントのメッセージ' }))).menu;
  assert.deepEqual(menu.items.map(action => action.id), ['copy']);
  const count = globalThis.__likexContextMenus.length;
  const native = await open(app.renderer.root.findByProps({ 'aria-label': 'アシスタントのメッセージ' }), { native: true });
  assert.equal(native.event.prevented, false); assert.equal(globalThis.__likexContextMenus.length, count);
});

test('stale menu actions are ignored after switching conversations', async t => {
  const app = await mount(t);
  const { menu } = await open(app.renderer.root.findByProps({ 'aria-label': 'あなたのメッセージ' }));
  await change(() => app.ref.current.selectConversation('second'));
  assert.equal(menu.closed, true);
  await change(() => item(menu, 'edit').onSelect());
  assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});

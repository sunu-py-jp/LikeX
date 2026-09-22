import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, createRef } from 'react';
import { create } from 'react-test-renderer';
import { load, tick } from './helpers.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { LikeChat, createChat } = await load('index', { mockContextMenu: true });
const change = fn => act(async () => { await fn(); });
const seed = () => createChat({ participants: [{ id: 'me', name: 'Me' }, { id: 'other', name: 'Other' }], conversations: [{ id: 'space', title: 'Planning', kind: 'space', memberIds: ['me', 'other'], messages: [
  { id: 'mine', authorId: 'me', text: 'My text', createdAt: '2026-09-22T00:00:00Z' },
  { id: 'other', authorId: 'other', text: 'Their text', createdAt: '2026-09-22T00:00:00Z' },
] }, { id: 'dm', title: 'DM', kind: 'direct', memberIds: ['me', 'other'], messages: [] }] });
async function mount(t, extra = {}) {
  let props = { initialChat: seed(), currentUserId: 'me', onSave() {}, ...extra }, renderer;
  const ref = createRef();
  await change(() => { renderer = create(h(LikeChat, { ...props, ref })); });
  t.after(() => change(() => renderer.unmount()));
  return { renderer, ref, update: async next => { props = { ...props, ...next }; await change(() => renderer.update(h(LikeChat, { ...props, ref }))); } };
}
async function open(node, { native = false, shiftKey = false, clipboard } = {}) {
  const event = { target: { closest: () => native ? {} : null }, currentTarget: { ownerDocument: { defaultView: { navigator: { clipboard } } } }, clientX: 50, clientY: 60, shiftKey, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
  await change(() => node.props.onContextMenu(event));
  return { event, menu: globalThis.__likexContextMenus.at(-1) };
}
const item = (menu, id) => menu.items.find(action => action.id === id);

test('message menu copies text, opens threads, toggles reactions, and limits edits to the current author', async t => {
  const app = await mount(t), copied = [];
  const own = app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' });
  const first = await open(own, { clipboard: { writeText: async text => copied.push(text) } });
  assert.equal(first.event.prevented, true);
  assert.deepEqual(first.menu.items.map(action => action.id), ['copy', 'reply', 'reaction', 'edit', 'delete']);
  await change(() => item(first.menu, 'copy').onSelect()); assert.deepEqual(copied, ['My text']);
  await change(() => item(first.menu, 'reply').onSelect());
  assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'スレッド' }).length, 1);
  const other = await open(app.renderer.root.findByProps({ 'aria-label': 'Otherのメッセージ' }));
  assert.equal(item(other.menu, 'edit'), undefined); assert.equal(item(other.menu, 'delete'), undefined);
  await change(() => item(other.menu, 'reaction').onSelect());
  assert.deepEqual(app.ref.current.getChat().conversations[0].messages[1].reactions, [{ emoji: '👍', participantIds: ['me'] }]);
  await change(() => app.ref.current.undo());
  assert.equal(app.ref.current.getChat().conversations[0].messages[1].reactions, undefined);
});

test('conversation menu renames through edit permission and history, and offers explicit deletion confirmation', async t => {
  let allow = false, requests = 0;
  const app = await mount(t, { onEditRequest: () => { requests++; return allow; } });
  const conversation = app.renderer.root.findAllByType('button').find(node => node.props.className?.startsWith('lxh-conversation '));
  const { menu } = await open(conversation);
  await change(() => item(menu, 'rename').onSelect());
  await change(() => app.renderer.root.findByProps({ role: 'dialog' }).findByType('input').props.onChange({ target: { value: 'Renamed' } }));
  const submit = () => change(async () => { app.renderer.root.findByProps({ role: 'dialog' }).findByType('form').props.onSubmit({ preventDefault() {} }); await tick(); });
  await submit(); assert.equal(requests, 1); assert.equal(app.ref.current.getChat().conversations[0].title, 'Planning');
  allow = true; await submit(); assert.equal(app.ref.current.getChat().conversations[0].title, 'Renamed');
  await change(() => app.ref.current.undo()); assert.equal(app.ref.current.getChat().conversations[0].title, 'Planning');
  const reopened = await open(app.renderer.root.findAllByType('button').find(node => node.props.className?.startsWith('lxh-conversation ')));
  await change(() => item(reopened.menu, 'delete').onSelect());
  assert.equal(app.renderer.root.findByProps({ role: 'dialog' }).findByType('h2').children.join(''), '会話を削除しますか？');
  assert.equal(app.ref.current.getChat().conversations.length, 2, 'opening confirmation does not delete');
});

test('feature flags hide menu operations, readOnly disables writes, and editable/native targets retain their browser menu', async t => {
  const app = await mount(t, { readOnly: true });
  let menu = (await open(app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' }))).menu;
  assert.equal(item(menu, 'edit').disabled, true); assert.equal(item(menu, 'reaction').disabled, true);
  await app.update({ readOnly: false, features: { threads: false, reactions: false, edit: false, delete: false, conversations: false, read: false } });
  menu = (await open(app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' }))).menu;
  assert.deepEqual(menu.items.map(action => action.id), ['copy']);
  const node = app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' });
  const count = globalThis.__likexContextMenus.length;
  assert.equal((await open(node, { native: true })).event.prevented, false);
  assert.equal((await open(node, { shiftKey: true })).event.prevented, false);
  assert.equal(globalThis.__likexContextMenus.length, count);
});

test('an open menu closes and cannot act on stale data after model or conversation changes', async t => {
  const app = await mount(t);
  const { menu } = await open(app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' }));
  await change(() => app.ref.current.execute({ type: 'chat.update', title: 'Changed' }));
  assert.equal(menu.closed, true);
  await change(() => item(menu, 'edit').onSelect());
  assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  const next = await open(app.renderer.root.findByProps({ 'aria-label': 'Meのメッセージ' }));
  await change(() => app.ref.current.selectConversation('dm'));
  await change(() => item(next.menu, 'reaction').onSelect());
  assert.equal(app.ref.current.getChat().conversations[0].messages[0].reactions, undefined);
});

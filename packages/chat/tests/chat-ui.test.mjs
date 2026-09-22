import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { load, deferred, tick } from './helpers.mjs';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { LikeChat, createChat, serializeChat } = await load('index');
const date = '2026-09-22T01:00:00.000Z';
const seed = () => createChat({ id: 'team', title: 'Team chat', participants: [
  { id: 'me', name: 'Me', status: 'online' }, { id: 'other', name: 'Other' }, { id: 'third', name: 'Third' },
], conversations: [
  { id: 'a', kind: 'space', title: 'Planning', memberIds: ['me', 'other', 'third'], messages: [
    { id: 'other-message', authorId: 'other', text: '<b>plain</b>', createdAt: date, reactions: [{ emoji: '👍', participantIds: ['other'] }] },
    { id: 'mine', authorId: 'me', text: 'My message', createdAt: date },
  ] },
  { id: 'b', kind: 'direct', title: 'Other', memberIds: ['me', 'other'], messages: [] },
] });
const update = fn => act(async () => { await fn(); });
async function mount(t, props = {}, rendererOptions) {
  let renderer; const ref = createRef(); let currentProps = { initialChat: seed(), currentUserId: 'me', ...props };
  const render = () => h(StrictMode, null, h(LikeChat, { ...currentProps, ref }));
  await update(() => { renderer = create(render(), rendererOptions); });
  let ended = false;
  const unmount = async () => { if (!ended) { ended = true; await update(() => renderer.unmount()); } };
  t.after(unmount);
  return { renderer, ref, unmount, rerender: async props => { currentProps = { ...currentProps, ...props }; await update(() => renderer.update(render())); } };
}
const textarea = app => app.renderer.root.findAllByType('textarea')[0];
const composer = (app, index = 0) => app.renderer.root.findAllByProps({ className: 'lxh-composer' })[index];
const type = (app, text, index = 0) => update(() => app.renderer.root.findAllByType('textarea')[index].props.onChange({ target: { value: text } }));
const submit = (app, index = 0) => update(async () => { composer(app, index).props.onSubmit({ preventDefault() {} }); await tick(); });

test('SSR renders human messages as text, scoped layout and readable theme colors', () => {
  const html = renderToStaticMarkup(h(LikeChat, { initialChat: seed(), currentUserId: 'me', colorMode: 'dark', primaryColor: '#fff' }));
  for (const text of ['data-likex-chat', 'lxh-sidebar', 'lxh-composer', '&lt;b&gt;plain&lt;/b&gt;', '--lxh-primary:#ffffff', '--lxh-on-primary:#000000']) assert.ok(html.includes(text), text);
  assert.equal(html.includes('<b>plain</b>'), false);
  assert.match(html, /閲覧専用/);
});

test('selected navigation backgrounds remain distinct and readable against themed labels', () => {
  const luminance = hex => hex.match(/[\da-f]{2}/gi).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  }).reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index], 0);
  for (const colorMode of ['light', 'dark']) {
    const html = renderToStaticMarkup(h(LikeChat, { initialChat: seed(), currentUserId: 'me', colorMode }));
    const selection = html.match(/--lxh-accent:(#[\da-f]{6})/i)?.[1];
    const ink = html.match(/--lxh-ink:(#[\da-f]{6})/i)?.[1];
    assert.ok(selection && ink, 'selection and label colors have separate variables');
    const colors = [luminance(selection), luminance(ink)].sort((a, b) => a - b);
    assert.ok((colors[1] + .05) / (colors[0] + .05) >= 4.5, `${colorMode} selected label contrast`);
  }
});

test('successful human send clears its draft; host rejection preserves text and attachments', async t => {
  const received = [];
  const app = await mount(t, { onSave() {}, onSend: request => { received.push(request.message); } });
  await type(app, 'Hello team'); await submit(app);
  assert.equal(textarea(app).props.value, '');
  assert.equal(received[0].authorId, 'me');
  assert.equal(app.ref.current.getChat().conversations[0].messages.length, 3);
  await app.rerender({ onSend: async () => { throw new Error('Delivery failed'); }, onAttachmentUpload: async () => [{ id: 'upload', name: 'notes.txt', mediaType: 'text/plain', size: 12 }] });
  const picker = app.renderer.root.findAllByType('input').find(item => item.props.type === 'file' && item.props.multiple);
  await update(async () => { picker.props.onChange({ currentTarget: { files: [{ name: 'notes.txt' }], value: 'file' } }); await tick(); });
  await type(app, 'Keep this draft'); await submit(app);
  assert.equal(textarea(app).props.value, 'Keep this draft');
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxh-draft-files' }).length, 1);
  assert.equal(app.ref.current.getChat().conversations[0].messages.length, 3);
  assert.match(app.renderer.root.findByProps({ role: 'alert' }).children.join(''), /Delivery failed/);
});

test('thread composer sends author-based replies and cancels a pending reply when the thread closes', async t => {
  const app = await mount(t, { onSave() {} });
  await update(() => app.renderer.root.findAllByProps({ 'aria-label': 'スレッドで返信' })[0].props.onClick());
  await type(app, 'Thread reply', 1); await submit(app, 1);
  const reply = app.ref.current.getChat().conversations[0].messages.at(-1);
  assert.equal(reply.replyTo, 'other-message'); assert.equal(reply.authorId, 'me');
  assert.equal(app.renderer.root.findAllByType('textarea')[1].props.value, '');
  const pending = deferred(); let signal;
  await app.rerender({ onSend: (_, context) => { signal = context.signal; return pending.promise; } });
  await type(app, 'Unsent reply', 1); await submit(app, 1);
  await update(() => app.renderer.root.findByProps({ 'aria-label': 'スレッドを閉じる' }).props.onClick());
  assert.equal(signal.aborted, true);
  await update(async () => { pending.resolve(); await tick(); });
  assert.equal(app.ref.current.getChat().conversations[0].messages.length, 3);
  await update(() => app.renderer.root.findAllByProps({ 'aria-label': 'スレッドで返信' })[0].props.onClick());
  assert.equal(app.renderer.root.findAllByType('textarea')[1].props.value, 'Unsent reply');
});

test('thread scrolling follows own sends while incoming updates preserve a scrolled-up viewport', async t => {
  const node = { scrollTop: 0, scrollHeight: 500, clientHeight: 150 };
  const app = await mount(t, { onSave() {} }, { createNodeMock: element => element.props.className === 'lxh-thread-messages' ? node : null });
  await update(() => app.renderer.root.findAllByProps({ 'aria-label': 'スレッドで返信' })[0].props.onClick());
  assert.equal(node.scrollTop, 500, 'opening a thread reveals its latest content');
  node.scrollTop = 50;
  await update(() => app.renderer.root.findByProps({ 'aria-label': 'スレッドのメッセージ' }).props.onScroll({ currentTarget: node }));
  node.scrollHeight = 800;
  await update(() => app.ref.current.execute({ type: 'message.add', conversationId: 'a', message: { authorId: 'me', text: 'Incoming model update', replyTo: 'other-message' } }));
  assert.equal(node.scrollTop, 50, 'model updates do not jump away from older messages');
  node.scrollHeight = 1000;
  await type(app, 'My new reply', 1); await submit(app, 1);
  assert.equal(node.scrollTop, 1000, 'own send reveals the new reply');
});

test('feature flags hide corresponding UI and reject imperative edits; readOnly prevents delivery', async t => {
  let calls = 0;
  const app = await mount(t, { onSend() { calls++; } });
  assert.equal(app.renderer.root.findByProps({ 'aria-label': '送信' }).props.disabled, true);
  await update(async () => assert.equal(await app.ref.current.send('Blocked'), false));
  assert.equal(calls, 0);
  await app.rerender({ onSave() {}, features: { send: false, attachments: false, edit: false, delete: false, conversations: false, reactions: false, threads: false, search: false, read: false, history: false, import: false, export: false } });
  for (const label of ['送信', 'メッセージを編集', 'メッセージを削除', 'スレッドで返信', 'チャットを検索', '既読にする', 'リアクションを追加', 'JSONを書き出す', 'JSONを読み込む', '元に戻す']) assert.equal(app.renderer.root.findAllByProps({ 'aria-label': label }).length, 0, label);
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxh-reactions' }).length, 0);
  await update(async () => assert.equal(await app.ref.current.execute({ type: 'reaction.toggle', conversationId: 'a', messageId: 'other-message', participantId: 'me', emoji: '👍' }), null));
  assert.equal(app.ref.current.exportNative(), null);
});

test('disabling read state removes a previously selected unread filter and its indicators', async t => {
  const app = await mount(t, { onSave() {} });
  const unread = app.renderer.root.findAllByType('button').find(item => item.children.some(child => child === '未読'));
  await update(() => unread.props.onClick());
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxh-overview-card' }).length, 1);
  await app.rerender({ features: { read: false } });
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxh-overview-card' }).length, 2);
  assert.equal(app.renderer.root.findAllByProps({ className: 'lxh-unread-dot' }).length, 0);
});

test('own edit/delete controls do not appear for colleagues and their messages cannot be changed by ref commands', async t => {
  const app = await mount(t, { onSave() {} });
  const other = app.renderer.root.findByProps({ 'aria-label': 'Otherのメッセージ' });
  assert.equal(other.findAllByProps({ 'aria-label': 'メッセージを編集' }).length, 0);
  assert.equal(other.findAllByProps({ 'aria-label': 'メッセージを削除' }).length, 0);
  assert.equal(app.renderer.root.findAllByProps({ 'aria-label': 'メッセージを編集' }).length, 1);
  await update(async () => assert.equal(await app.ref.current.execute({ type: 'message.delete', conversationId: 'a', messageId: 'other-message' }), null));
  await update(() => app.renderer.root.findByProps({ 'aria-label': 'メッセージを編集' }).props.onClick());
  const dialog = app.renderer.root.findByProps({ role: 'dialog' });
  await update(() => dialog.findByType('textarea').props.onChange({ target: { value: 'Edited own text' } }));
  await update(async () => { app.renderer.root.findByProps({ role: 'dialog' }).findByType('form').props.onSubmit({ preventDefault() {} }); await tick(); });
  assert.equal(app.ref.current.getChat().conversations[0].messages[1].text, 'Edited own text');
  assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('conversation creation uses selected members and chooses direct or group semantics', async t => {
  const app = await mount(t, { onSave() {} });
  await update(() => app.renderer.root.findByProps({ className: 'lxh-new-chat' }).props.onClick());
  let dialog = app.renderer.root.findByProps({ role: 'dialog' });
  const choices = dialog.findAllByType('input').filter(item => item.props.type === 'checkbox');
  await update(() => choices[0].props.onChange({ target: { checked: true } }));
  dialog = app.renderer.root.findByProps({ role: 'dialog' });
  await update(() => dialog.findAllByType('input').filter(item => item.props.type === 'checkbox')[1].props.onChange({ target: { checked: true } }));
  await update(async () => { app.renderer.root.findByProps({ role: 'dialog' }).findByType('form').props.onSubmit({ preventDefault() {} }); await tick(); });
  const created = app.ref.current.getConversation();
  assert.equal(created.kind, 'group');
  assert.deepEqual(created.memberIds, ['me', 'other', 'third']);
  assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
});

test('conversation changes cancel delivery and preserve drafts only for their original target', async t => {
  const pending = deferred(); let signal;
  const app = await mount(t, { onSave() {}, onSend: (_, context) => { signal = context.signal; return pending.promise; } });
  await type(app, 'Private draft for Planning'); await submit(app);
  await update(() => app.ref.current.selectConversation('b'));
  assert.equal(signal.aborted, true);
  assert.equal(textarea(app).props.value, '');
  await update(async () => { pending.resolve(); await tick(); });
  assert.equal(app.ref.current.getChat().conversations[0].messages.length, 2);
  await update(() => app.ref.current.selectConversation('a'));
  assert.equal(textarea(app).props.value, 'Private draft for Planning');
  await app.rerender({ currentUserId: 'other' });
  assert.equal(textarea(app).props.value, '', 'another identity must never inherit private draft content');
});

test('import and host synchronization clear old drafts/dialogs even when conversation IDs are reused', async t => {
  const app = await mount(t, { onSave() {} });
  await type(app, 'Old private draft');
  await update(() => app.renderer.root.findByProps({ 'aria-label': 'メッセージを編集' }).props.onClick());
  const next = { ...seed(), title: 'Replacement' };
  await update(() => app.ref.current.importNative(serializeChat(next)));
  assert.equal(textarea(app).props.value, '');
  assert.equal(app.renderer.root.findAllByProps({ role: 'dialog' }).length, 0);
  await type(app, 'Another private draft');
  await update(() => assert.equal(app.ref.current.syncChat(seed(), { discardLocalChanges: true }), true));
  assert.equal(textarea(app).props.value, '');
  await update(() => app.ref.current.execute({ type: 'conversation.delete', conversationId: 'a' }));
  assert.equal(app.ref.current.getConversation().id, 'b');
});

test('unmount cancels host delivery and retained handles cannot mutate or revive the disposed session', async t => {
  const pending = deferred(); let changes = 0;
  const app = await mount(t, { onSave() {}, onChange() { changes++; }, onSend: () => pending.promise });
  let task; await update(() => { task = app.ref.current.send('Stale'); }); await tick();
  const handle = app.ref.current; await app.unmount();
  const before = changes; pending.resolve(); assert.equal(await task, false);
  assert.equal(changes, before);
  assert.equal(await handle.execute({ type: 'chat.update', title: 'Late' }), null);
  assert.equal(handle.syncChat(seed(), { discardLocalChanges: true }), false);
});

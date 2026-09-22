import test from 'node:test';
import assert from 'node:assert/strict';
import { load, deferred, tick } from './helpers.mjs';
const api = await load();
const create = () => api.createChat({ id: 'team', participants: [{ id: 'me', name: 'Me' }, { id: 'other', name: 'Other' }], conversations: [{ id: 'room', kind: 'space', title: 'Room', memberIds: ['me', 'other'], messages: [
  { id: 'other-message', authorId: 'other', text: 'Hello', createdAt: '2026-09-22T00:00:00.000Z' },
] }] });
const writable = { currentUserId: 'me', onSave: async model => model };

test('send acknowledges a human message, commits one history action and saves independently', async () => {
  const calls = [], changes = [];
  const session = api.createChatSession(create(), { ...writable, onSend: async (request, context) => { calls.push([request, context]); }, onChange: model => changes.push(model) });
  assert.equal(await session.send('room', 'Hi'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].message.authorId, 'me');
  assert.equal(calls[0][0].conversation.messages.length, 1);
  assert.ok(calls[0][1].signal instanceof AbortSignal);
  assert.equal(session.getChat().conversations[0].messages.length, 2, 'no assistant is generated');
  assert.equal(session.getSnapshot().dirty, true);
  assert.equal(await session.undo(), true);
  assert.equal(session.getChat().conversations[0].messages.length, 1);
  assert.equal(await session.redo(), true);
  assert.equal(await session.save(), true);
  assert.equal(session.getSnapshot().dirty, false);
  assert.ok(changes.length >= 3);
  session.dispose();
});

test('rejected or cancelled send leaves the model unchanged and ignores late responses', async () => {
  const rejected = api.createChatSession(create(), { ...writable, onSend: async () => { throw new Error('Offline'); } });
  assert.equal(await rejected.send('room', 'Keep draft'), false);
  assert.equal(rejected.getChat().conversations[0].messages.length, 1);
  assert.match(rejected.getSnapshot().notice.text, /Offline/);
  const pending = deferred(); let signal;
  const session = api.createChatSession(create(), { ...writable, onSend: (_, context) => { signal = context.signal; return pending.promise; } });
  const sent = session.send('room', 'Cancelled'); await tick(); session.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(await sent, false);
  pending.resolve(); await tick();
  assert.equal(session.getChat().conversations[0].messages.length, 1);
  session.dispose(); rejected.dispose();
});

test('session enforces current user, membership, own-only edits and feature flags before a host send', async () => {
  let sends = 0;
  const session = api.createChatSession(create(), { ...writable, onSend: () => { sends++; }, features: { threads: false } });
  assert.equal(await session.send('room', 'Reply', [], 'other-message'), false);
  assert.equal(sends, 0);
  for (const command of [
    { type: 'message.update', conversationId: 'room', messageId: 'other-message', patch: { text: 'No' } },
    { type: 'message.delete', conversationId: 'room', messageId: 'other-message' },
    { type: 'reaction.toggle', conversationId: 'room', messageId: 'other-message', participantId: 'other', emoji: '👍' },
    { type: 'message.add', conversationId: 'room', message: { authorId: 'other', text: 'Spoofed' } },
  ]) assert.equal(await session.execute(command), null);
  assert.equal(session.getChat().conversations[0].messages[0].text, 'Hello');
  session.configure({ ...writable, features: { reactions: false } });
  assert.equal(await session.execute({ type: 'reaction.toggle', conversationId: 'room', messageId: 'other-message', participantId: 'me', emoji: '👍' }), null);
  session.configure({ ...writable, readOnly: true });
  assert.equal(await session.send('room', 'No'), false);
  session.dispose();
});

test('readOnly, no-save and refused edit permission prevent host side effects', async () => {
  let sends = 0;
  for (const config of [{ currentUserId: 'me' }, { ...writable, readOnly: true }, { ...writable, onEditRequest: async () => false }]) {
    const session = api.createChatSession(create(), { ...config, onSend: () => { sends++; } });
    assert.equal(await session.send('room', 'No'), false); session.dispose();
  }
  assert.equal(sends, 0);
});

test('sync protects dirty work, replaces clean baseline, cancels stale work only on explicit discard', async () => {
  const session = api.createChatSession(create(), writable);
  await session.send('room', 'Local');
  const remote = api.executeChatCommands(create(), { type: 'chat.update', title: 'Remote' }).chat;
  assert.equal(session.syncChat(remote), false);
  assert.equal(session.getChat().title, 'チャット');
  assert.equal(session.syncChat(remote, { discardLocalChanges: true }), true);
  assert.equal(session.getChat().title, 'Remote');
  assert.equal(session.getSnapshot().dirty, false);
  assert.equal(await session.undo(), false);
  const pending = deferred(); session.configure({ ...writable, onSend: () => pending.promise });
  const sending = session.send('room', 'Stale'); await tick();
  assert.equal(session.syncChat(create()), false);
  assert.equal(session.syncChat(create(), { discardLocalChanges: true }), true);
  assert.equal(await sending, false);
  pending.resolve(); await tick();
  assert.equal(session.getChat().conversations[0].messages.length, 1);
  session.dispose();
});

test('upload validation and stale protection share session permission and cancellation', async () => {
  const session = api.createChatSession(create(), writable), pending = deferred();
  const uploading = session.prepareAttachments(() => pending.promise); await tick(); session.cancel();
  assert.equal(await uploading, null);
  pending.resolve([{ id: 'file', name: 'file', mediaType: 'text/plain', size: 1 }]);
  assert.equal(await session.prepareAttachments(async () => [{ id: 'bad', name: 'file', mediaType: 'text/plain', size: 1, url: 'javascript:bad' }]), null);
  assert.equal(await session.importNative(JSON.stringify({ format: 'likex.chat', version: 1 })), null);
  assert.match(session.getSnapshot().notice.text, /aichat/);
  session.dispose();
});

test('identity changes cancel sends and keep prior history disabled until explicit synchronization', async () => {
  const pending = deferred(), session = api.createChatSession(create(), writable);
  await session.send('room', 'First identity');
  session.configure({ ...writable, onSend: () => pending.promise });
  const sending = session.send('room', 'Stale identity'); await tick();
  session.configure({ ...writable, currentUserId: 'other' });
  assert.equal(await sending, false);
  await session.send('room', 'Second identity');
  session.configure(writable);
  assert.equal(session.getSnapshot().features.history, false);
  assert.equal(await session.undo(), false, 'switching back does not authorize undo of another identity');
  assert.equal(session.syncChat(create(), { discardLocalChanges: true }), true);
  assert.equal(session.getSnapshot().features.history, true);
  pending.resolve(); session.dispose();
});

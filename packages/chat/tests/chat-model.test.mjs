import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './helpers.mjs';
const api = await load();
const date = '2026-09-22T00:00:00.000Z';
const create = () => api.createChat({ id: 'team', participants: [{ id: 'me', name: 'Me' }, { id: 'other', name: 'Other' }] });
const add = (id, authorId = 'me', replyTo) => ({ type: 'message.add', conversationId: 'conversation-1', message: { id, authorId, text: id, createdAt: date, ...(replyTo ? { replyTo } : {}) } });

test('human model preserves participants, threads, metadata, reactions and read markers on a stable round trip', () => {
  const initial = create();
  const result = api.executeChatCommands(initial, [
    add('root', 'other'), add('reply', 'me', 'root'),
    { type: 'message.update', conversationId: 'conversation-1', messageId: 'root', patch: { text: 'Updated', editedAt: date, attachments: [{ id: 'file', name: 'plan.pdf', mediaType: 'application/pdf', size: 123, url: 'https://example.test/plan.pdf' }] } },
    { type: 'reaction.toggle', conversationId: 'conversation-1', messageId: 'root', participantId: 'me', emoji: '👍' },
    { type: 'conversation.read', conversationId: 'conversation-1', participantId: 'me', messageId: 'root' },
  ]);
  assert.equal(initial.conversations[0].messages.length, 0);
  assert.equal(result.chat.version, 2);
  assert.equal(api.getParticipant(result.chat, 'other').name, 'Other');
  assert.equal(api.getThreadMessages(result.chat, 'conversation-1', 'root')[0].id, 'reply');
  assert.equal(api.getUnreadCount(result.chat, 'conversation-1', 'me'), 0);
  assert.equal(api.getUnreadCount(result.chat, 'conversation-1', 'other'), 1);
  assert.deepEqual(api.getMessage(result.chat, 'conversation-1', 'root').reactions, [{ emoji: '👍', participantIds: ['me'] }]);
  assert.ok(Object.isFrozen(result.chat.conversations[0].messages));
  const json = api.serializeChat(result.chat);
  assert.equal(api.serializeChat(api.parseChat(json)), json);
  assert.throws(() => result.chat.participants.push({ id: 'mutation', name: 'No' }));
});

test('commands fail atomically and cannot change author or identity', () => {
  const initial = create();
  assert.throws(() => api.executeChatCommands(initial, [add('first'), { type: 'message.update', conversationId: 'conversation-1', messageId: 'absent', patch: { text: 'No' } }]));
  assert.equal(initial.conversations[0].messages.length, 0);
  const chat = api.executeChatCommands(initial, add('first')).chat;
  assert.throws(() => api.executeChatCommands(chat, { type: 'message.update', conversationId: 'conversation-1', messageId: 'first', patch: { authorId: 'other' } }));
  assert.equal(api.executeChatCommands(chat, { type: 'message.update', conversationId: 'conversation-1', messageId: 'first', patch: { text: 'first' } }).chat, chat);
  assert.throws(() => api.executeChatCommands(chat, add('first')), /unique/);
});

test('direct/group/space membership and thread integrity are validated', () => {
  const initial = create();
  assert.throws(() => api.executeChatCommands(initial, { type: 'conversation.add', kind: 'direct', memberIds: ['me'] }));
  assert.throws(() => api.executeChatCommands(initial, { type: 'conversation.add', kind: 'space', memberIds: ['missing'] }));
  const chat = api.executeChatCommands(initial, [add('root'), add('reply', 'other', 'root')]).chat;
  assert.throws(() => api.executeChatCommands(chat, add('nested', 'me', 'reply')), /top-level/);
  assert.throws(() => api.executeChatCommands(chat, add('missing', 'me', 'absent')), /top-level/);
  assert.throws(() => api.executeChatCommands(chat, { type: 'message.delete', conversationId: 'conversation-1', messageId: 'root' }), /cascadeReplies/);
  const deleted = api.executeChatCommands(chat, { type: 'message.delete', conversationId: 'conversation-1', messageId: 'root', cascadeReplies: true }).chat;
  assert.equal(deleted.conversations[0].messages.length, 0);
});

test('read markers are monotonic and repaired when referenced messages are deleted', () => {
  const chat = api.executeChatCommands(create(), [add('a', 'other'), add('b', 'other'), add('c', 'other'), { type: 'conversation.read', conversationId: 'conversation-1', participantId: 'me', messageId: 'b' }]).chat;
  const earlier = api.executeChatCommands(chat, { type: 'conversation.read', conversationId: 'conversation-1', participantId: 'me', messageId: 'a' });
  assert.equal(earlier.changed, false);
  const deleted = api.executeChatCommands(chat, { type: 'message.delete', conversationId: 'conversation-1', messageId: 'b' }).chat;
  assert.equal(deleted.conversations[0].readMarkers[0].messageId, 'a');
  assert.equal(api.getUnreadCount(deleted, 'conversation-1', 'me'), 1);
});

test('legacy AI files have an actionable incompatibility error; malformed input is rejected', () => {
  assert.throws(() => api.normalizeChat({ format: 'likex.chat', version: 1, id: 'legacy', title: 'AI', conversations: [] }), /@likex\/aichat/);
  const initial = create();
  assert.throws(() => api.parseChat(JSON.stringify({ ...initial, version: 99 })), /version/);
  assert.throws(() => api.normalizeChat({ ...initial, role: 'assistant' }), /unsupported/);
  for (const url of ['javascript:alert(1)', 'data:text/html,a', 'https://user:pass@example.test/file']) assert.throws(() => api.normalizeChatAttachment({ id: 'file', name: 'file', mediaType: 'text/plain', size: 1, url }));
  assert.throws(() => api.createChatMessage({ authorId: 'me', text: '\ud800' }), /surrogate/);
  assert.throws(() => api.createChatMessage({ authorId: 'me', text: 'hello', createdAt: '2026-02-30T00:00:00Z' }), /timestamp/);
  assert.throws(() => api.executeChatCommands(initial, [add('blank', 'me')].map(command => ({ ...command, message: { ...command.message, text: '' } }))), /requires/);
});

# Human chat commands

Call `executeChatCommands(chat, commandOrBatch)` and use its `{ chat, changed, results }`. The input is never mutated. Generated IDs/timestamps are created only for new entities; unchanged existing content is stable.

| Command | Fields | Effect |
| --- | --- | --- |
| `chat.update` | `title` | Update model title |
| `chat.replace` | `chat` | Validate and replace complete model |
| `participant.add` | `participant` | Add participant metadata |
| `participant.update` | `participantId`, `patch` | Update name/avatar/status |
| `conversation.add` | optional `id`, `kind`, optional `title`, `memberIds` | Add direct/group/space conversation |
| `conversation.update` | `conversationId`, optional `title`, optional `memberIds` | Update metadata; remove departed members' read markers |
| `conversation.delete` | `conversationId` | Delete conversation and messages |
| `conversation.read` | `conversationId`, `participantId`, `messageId` | Move read position forward |
| `message.add` | `conversationId`, `message` | Add author/text/optional timestamp, ID, thread and attachments |
| `message.update` | `conversationId`, `messageId`, `patch` | Update text/attachments/editedAt; a content edit supplies editedAt if omitted |
| `message.delete` | `conversationId`, `messageId`, optional `cascadeReplies` | Delete message; root with replies requires explicit cascade |
| `reaction.toggle` | `conversationId`, `messageId`, `participantId`, `emoji` | Add/remove that participant's reaction |

Deletion repairs a read marker pointing at a deleted message to the nearest surviving preceding message, or removes it if none remains. Deleting a thread cascades only when explicitly requested. A session refuses to cascade another author's replies even when the root belongs to the current user. The pure API is host-authorized and may perform broader edits.

Getters: `getParticipants`, `getParticipant`, `getConversations`, `getConversation`, `getMessages`, `getMessage`, `getThreadMessages`, `getUnreadCount`.

GUI right-click menus call these same session commands: own-message edit/delete, thread navigation, reaction toggle, read marker, group/space rename and confirmed conversation deletion. Disabled features are omitted; read-only/busy writes are disabled. Copying text and opening a thread only affect the clipboard/view, not saved JSON. A menu is invalidated when its model or conversation changes. Native menus remain available in editable controls and links, or with Shift+right-click.

`createChatSession(chat, {currentUserId, onSave, onSend?, ...})` shares the GUI's command, permission, save, notification, history and cancellation behavior. `send(conversationId, text, attachments?, replyTo?)` calls optional host `onSend({chat, conversation, message}, {signal, requestId})` and appends after it resolves. The handler returns void and never creates AI responses. A rejected/cancelled send returns false without appending. `execute` performs local commands; use `send` for the delivery callback. Persist and distribute command changes through the host's `onChange`/`onSave`.

`syncChat(model)` accepts a clean, idle host snapshot and resets baseline/history. Dirty or busy sessions reject it. Explicit `{discardLocalChanges: true}` cancels pending work and discards local edits. The host must merge concurrent revisions before synchronization. If the current user changes, pending work is cancelled and undo/redo is disabled until a successful sync resets history. Save/Undo/Redo do not retract already delivered messages from an external service. The host should use message IDs for delivery idempotency, honor AbortSignal and reconcile delivery outcomes after cancellation.

## Message and thread example

Apply to the complete native example in `schema-guide.md`:

```json
[
  { "type": "message.add", "conversationId": "conversation-1", "message": { "id": "m1", "authorId": "me", "text": "Please review", "createdAt": "2026-09-22T00:00:00.000Z" } },
  { "type": "message.add", "conversationId": "conversation-1", "message": { "id": "m2", "authorId": "peer", "text": "Checking now", "replyTo": "m1", "createdAt": "2026-09-22T00:01:00.000Z" } },
  { "type": "reaction.toggle", "conversationId": "conversation-1", "messageId": "m1", "participantId": "peer", "emoji": "👍" }
]
```

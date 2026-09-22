# LikeChat version 2

`ChatModel` contains `format: "likex.chat"`, `version: 2`, `id`, `title`, `participants`, and `conversations`. IDs are stable strings without whitespace. `createChat()` supplies participant `me` and a space `conversation-1`; explicit empty conversation lists are supported.

- Participant: `id`, `name`, optional HTTP(S) `avatarUrl`, optional `status` (`online`, `away`, `offline`). Presence is host-supplied metadata, not a network presence service.
- Conversation: `id`, `kind` (`direct`, `group`, `space`), `title`, `memberIds`, ordered `messages`, optional `readMarkers`. Direct messages require exactly two members, groups at least two, spaces at least one. Every member must be a known participant.
- Message: `id`, `authorId`, `text`, UTC ISO `createdAt`, optional `editedAt`, `replyTo`, `attachments`, `reactions`. A message needs nonblank text or an attachment. Authors remain known participants after leaving a conversation. New messages require current membership. IDs are unique across conversations.
- `replyTo` references an earlier top-level message in the same conversation. Thread replies stay in the conversation's ordered message array. `getThreadMessages` selects only replies to the given root.
- Attachment: `id`, `name`, `mediaType`, nonnegative byte `size`, optional HTTP(S) `url`. No file bytes or embedded HTML are accepted. URLs with credentials or unsafe schemes are rejected.
- Reaction: `emoji`, unique nonempty `participantIds`; one entry per emoji. Emoji/text labels are bounded to 64 characters.
- Read marker: `participantId`, `messageId`; one per current member, pointing into that conversation. `conversation.read` only moves forward. `getUnreadCount` counts later messages by others, including replies.

Normalization rejects unknown keys, accessors, nonplain objects, invalid Unicode, broken references, duplicate IDs, unsafe URLs and invalid dates. Limits include 32 MiB JSON, 2,000 participants, 500 conversations, 20,000 total messages, 1,000,000 characters per message, 8,000,000 total message/attachment metadata characters, 100 attachments/reactions per message and 1,000 commands per batch. See exported `CHAT_LIMITS` for exact limits. Parse and serialize explicitly; do not persist arbitrary objects.

Version 1 is the former AI LikeChat format. Version 2 is intentionally incompatible: participant authors, membership and human thread semantics cannot be inferred from assistant/user roles. Use `@likex/aichat/model` to migrate legacy AI data; do not rewrite only the version field.

## Complete native example

```json
{
  "format": "likex.chat",
  "version": 2,
  "id": "team",
  "title": "Team",
  "participants": [{ "id": "me", "name": "Me" }, { "id": "peer", "name": "Peer" }],
  "conversations": [{
    "id": "conversation-1",
    "kind": "space",
    "title": "Project",
    "memberIds": ["me", "peer"],
    "messages": []
  }]
}
```

# 画面なしで操作する

```ts
import { createChat, executeChatCommands, getConversation, getMessages,
  getMessage, getParticipants, getThreadMessages, getUnreadCount } from "@likex/chat/model";

let chat = createChat({ participants: [
  { id: "me", name: "高橋" }, { id: "yui", name: "佐藤" },
], conversations: [] });
chat = executeChatCommands(chat, [
  { type: "conversation.add", id: "design", kind: "space", title: "デザイン", memberIds: ["me", "yui"] },
  { type: "message.add", conversationId: "design", message: { id: "m1", authorId: "me", text: "レビューお願いします" } },
  { type: "message.add", conversationId: "design", message: { id: "m2", authorId: "yui", text: "確認します", replyTo: "m1" } },
]).chat;
```

`executeChatCommands(chat, command | command[])` は `{ chat, changed, results }` を返します。入力は変更しません。複数コマンドのどれかが失敗した場合、途中の変更は返しません。純粋なモデルAPIには認可や通信がありません。

## コマンド

| type | 主な引数 |
| --- | --- |
| `chat.update` | `title` |
| `chat.replace` | `chat` |
| `participant.add` | `participant: ChatParticipant` |
| `participant.update` | `participantId`, `patch` |
| `conversation.add` | `id?`, `kind`, `title?`, `memberIds` |
| `conversation.update` | `conversationId`, `title?`, `memberIds?` |
| `conversation.delete` | `conversationId` |
| `conversation.read` | `conversationId`, `participantId`, `messageId` |
| `message.add` | `conversationId`, `message: ChatMessageInput` |
| `message.update` | `conversationId`, `messageId`, `patch: { text?, attachments?, editedAt? }` |
| `message.delete` | `conversationId`, `messageId`, `cascadeReplies?` |
| `reaction.toggle` | `conversationId`, `messageId`, `participantId`, `emoji` |

## get APIの戻り値

| API | 戻り値 |
| --- | --- |
| `getParticipants(chat)` | `readonly ChatParticipant[]` |
| `getParticipant(chat, id)` | `ChatParticipant \| undefined` |
| `getConversations(chat)` | `readonly ChatConversation[]` |
| `getConversation(chat, id)` | `ChatConversation \| undefined` |
| `getMessages(chat, conversationId)` | `readonly ChatMessage[]` |
| `getMessage(chat, conversationId, messageId)` | `ChatMessage \| undefined` |
| `getThreadMessages(chat, conversationId, rootId)` | `readonly ChatMessage[]`。返信だけ |
| `getUnreadCount(chat, conversationId, participantId)` | `number`。既読位置より後の他の参加者のメッセージ数 |

## コンポーネントref

`ChatHandle` は `getChat`、`getConversation`、`selectConversation`、`execute`、`send`、`cancel`、`save`、`undo`、`redo`、`discard`、`importNative`、`exportNative`、`syncChat` を公開します。`getConversation()` は選択がなければ `undefined`、`execute()` と `importNative()` は拒否・失敗時に `null`、`send()` と履歴・保存操作は `boolean` を返します。

refとGUIは同じセッションを通り、機能フラグ・閲覧専用・編集許可・通知・Undo履歴を共有します。セッションだけ使う場合は `createChatSession(chat, { currentUserId: "me", readOnly: false })` を使えます。
